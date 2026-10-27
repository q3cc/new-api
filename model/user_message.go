package model

import (
	"database/sql/driver"
	"fmt"

	"github.com/QuantumNous/new-api/common"

	"gorm.io/gorm"
)

// Personal message titles and contents are English message keys the console
// translates with the message's params.
const (
	UserMessageInviteCancelledTitle   = "Invitation cancelled"
	UserMessageInviteCancelledContent = "Your invitation relationship with {{name}} (ID: {{id}}) has been cancelled."
	UserMessageInviteRestoredTitle    = "Invitation restored"
	UserMessageInviteRestoredContent  = "Your invitation relationship with {{name}} (ID: {{id}}) has been restored."
)

// UserMessage is a personal message shown in the user's notification center.
type UserMessage struct {
	Id        int           `json:"id"`
	UserId    int           `json:"-" gorm:"index:idx_user_message_user,priority:1"`
	Title     string        `json:"title" gorm:"type:varchar(128);not null"`
	Content   string        `json:"content" gorm:"type:varchar(255);not null"`
	Params    MessageParams `json:"params" gorm:"type:text"`
	ReadAt    int64         `json:"read_at" gorm:"bigint;default:0;index"`
	CreatedAt int64         `json:"created_at" gorm:"bigint;index:idx_user_message_user,priority:2"`
}

// MessageParams fills a message's placeholders. It is stored as JSON.
type MessageParams map[string]any

func (p MessageParams) Value() (driver.Value, error) {
	if len(p) == 0 {
		return "", nil
	}
	data, err := common.Marshal(map[string]any(p))
	if err != nil {
		return nil, err
	}
	return string(data), nil
}

func (p *MessageParams) Scan(value any) error {
	var text string
	switch v := value.(type) {
	case nil:
	case string:
		text = v
	case []byte:
		text = string(v)
	default:
		return fmt.Errorf("unsupported message params value %T", value)
	}
	if text == "" {
		*p = nil
		return nil
	}
	params := map[string]any{}
	if err := common.UnmarshalJsonStr(text, &params); err != nil {
		return err
	}
	*p = params
	return nil
}

func (m *UserMessage) BeforeCreate(tx *gorm.DB) error {
	if m.CreatedAt == 0 {
		m.CreatedAt = common.GetTimestamp()
	}
	return nil
}

// ListUserMessages returns a page of the user's messages, newest first, with
// the total and how many are unread.
func ListUserMessages(userId int, pageInfo *common.PageInfo) ([]UserMessage, int64, int64, error) {
	query := DB.Model(&UserMessage{}).Where("user_id = ?", userId)
	var total, unread int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, 0, err
	}
	if err := DB.Model(&UserMessage{}).Where("user_id = ? AND read_at = 0", userId).Count(&unread).Error; err != nil {
		return nil, 0, 0, err
	}
	var messages []UserMessage
	if err := DB.Where("user_id = ?", userId).Order("id DESC").
		Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&messages).Error; err != nil {
		return nil, 0, 0, err
	}
	return messages, total, unread, nil
}

// MarkUserMessagesRead marks every unread message of the user as read.
func MarkUserMessagesRead(userId int) error {
	return DB.Model(&UserMessage{}).Where("user_id = ? AND read_at = 0", userId).
		Update("read_at", common.GetTimestamp()).Error
}

// messageAffiliateInviteChangeTx tells the inviter and the invitee that their
// invitation was cancelled or restored, each naming the other side.
func messageAffiliateInviteChangeTx(tx *gorm.DB, inviteeId int, inviterId int, title string, content string) error {
	var users []User
	if err := tx.Unscoped().Select("id", "username", "display_name").
		Where("id IN ?", []int{inviteeId, inviterId}).Find(&users).Error; err != nil {
		return err
	}
	names := make(map[int]string, len(users))
	for _, user := range users {
		names[user.Id] = user.DisplayName
		if names[user.Id] == "" {
			names[user.Id] = user.Username
		}
	}
	messages := []UserMessage{
		{UserId: inviterId, Title: title, Content: content, Params: MessageParams{"name": names[inviteeId], "id": inviteeId}},
		{UserId: inviteeId, Title: title, Content: content, Params: MessageParams{"name": names[inviterId], "id": inviterId}},
	}
	return tx.Create(&messages).Error
}
