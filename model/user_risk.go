package model

import "gorm.io/gorm"

// UserRiskScore is recomputed periodically from recent client IPs. It lives in
// its own table so the scoring job never races user updates or the user cache.
type UserRiskScore struct {
	UserId          int    `json:"-" gorm:"primaryKey;autoIncrement:false"`
	Score           int    `json:"score"`
	SharedIpUsers   int    `json:"shared_ip_users"`   // other accounts sharing an exact IP
	SameSubnetUsers int    `json:"same_subnet_users"` // other accounts sharing only the IP range
	IpCount         int    `json:"ip_count"`
	UpdatedAt       int64  `json:"updated_at" gorm:"bigint"`
	Details         string `json:"-" gorm:"type:text"` // JSON-encoded UserRiskDetails
}

// UserRiskDetails explains a score: which accounts overlap and through which IPs.
type UserRiskDetails struct {
	SharedIp   []UserRiskRelation `json:"shared_ip"`
	SameSubnet []UserRiskRelation `json:"same_subnet"`
}

// UserRiskRelation lists the IPs (or IP ranges) another account has in common.
type UserRiskRelation struct {
	UserId   int      `json:"user_id"`
	Username string   `json:"username,omitempty"`
	Matches  []string `json:"matches"`
}

type UserIpPair struct {
	UserId int
	Ip     string
}

// ListUserIpPairs returns the distinct (user, IP) pairs seen since the given
// timestamp, using the same sources as GetUserRecentIps.
func ListUserIpPairs(since int64) ([]UserIpPair, error) {
	return listUserIpPairs(since, nil)
}

// ListUserIpPairsForUsers is ListUserIpPairs limited to the given users.
func ListUserIpPairsForUsers(userIds []int, since int64) ([]UserIpPair, error) {
	if len(userIds) == 0 {
		return nil, nil
	}
	return listUserIpPairs(since, userIds)
}

func listUserIpPairs(since int64, userIds []int) ([]UserIpPair, error) {
	auditQuery := LOG_DB.Model(&AuditLog{}).Where("created_at >= ? AND ip <> ''", since)
	logQuery := LOG_DB.Model(&Log{}).Where("created_at >= ? AND ip <> '' AND type IN ?", since, recentIpLogTypes)
	if userIds != nil {
		auditQuery = auditQuery.Where("user_id IN ?", userIds)
		logQuery = logQuery.Where("user_id IN ?", userIds)
	}
	var auditPairs []UserIpPair
	if err := auditQuery.Select("user_id, ip").Group("user_id, ip").Scan(&auditPairs).Error; err != nil {
		return nil, err
	}
	var logPairs []UserIpPair
	if err := logQuery.Select("user_id, ip").Group("user_id, ip").Scan(&logPairs).Error; err != nil {
		return nil, err
	}
	return append(auditPairs, logPairs...), nil
}

// ListActiveUserIds returns ids of users that are not soft-deleted.
func ListActiveUserIds() ([]int, error) {
	var ids []int
	err := DB.Model(&User{}).Pluck("id", &ids).Error
	return ids, err
}

// ReplaceUserRiskScores swaps the whole score table in one transaction so
// readers never see a partially written round.
func ReplaceUserRiskScores(scores []UserRiskScore) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("1 = 1").Delete(&UserRiskScore{}).Error; err != nil {
			return err
		}
		if len(scores) == 0 {
			return nil
		}
		return tx.CreateInBatches(scores, 500).Error
	})
}

// GetUserRiskScoresByIds returns stored scores keyed by user id; users
// without a row in the latest round are absent and count as zero.
func GetUserRiskScoresByIds(ids []int) (map[int]UserRiskScore, error) {
	byUser := make(map[int]UserRiskScore, len(ids))
	if len(ids) == 0 {
		return byUser, nil
	}
	var rows []UserRiskScore
	if err := DB.Where("user_id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		byUser[row.UserId] = row
	}
	return byUser, nil
}

// AttachUserRiskScores fills RiskScore for a page of users.
func AttachUserRiskScores(users []*User) error {
	ids := make([]int, 0, len(users))
	for _, user := range users {
		ids = append(ids, user.Id)
	}
	byUser, err := GetUserRiskScoresByIds(ids)
	if err != nil {
		return err
	}
	for _, user := range users {
		score := byUser[user.Id]
		user.RiskScore = &score
	}
	return nil
}

// GetUserRiskScore returns the stored score row of one user, or a zero row.
func GetUserRiskScore(userId int) (UserRiskScore, error) {
	var row UserRiskScore
	err := DB.Where("user_id = ?", userId).Limit(1).Find(&row).Error
	return row, err
}

// GetUsernamesByIds resolves usernames, including soft-deleted accounts.
func GetUsernamesByIds(ids []int) (map[int]string, error) {
	names := make(map[int]string, len(ids))
	if len(ids) == 0 {
		return names, nil
	}
	var users []User
	if err := DB.Unscoped().Select("id", "username").Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, err
	}
	for _, user := range users {
		names[user.Id] = user.Username
	}
	return names, nil
}
