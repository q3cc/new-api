package service

import (
	"cmp"
	"context"
	"net/netip"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	userRiskTickInterval = 1 * time.Hour
	// Stored details are capped so one heavily shared IP cannot bloat a row;
	// the counts on the row still cover every related account.
	userRiskMaxRelations = 50
	userRiskMaxMatches   = 10
)

var (
	userRiskOnce    sync.Once
	userRiskRunning atomic.Bool
)

func StartUserRiskScoreTask() {
	userRiskOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			logger.LogInfo(context.Background(), common.LogText("user risk score task started: tick=%s", userRiskTickInterval))
			ticker := time.NewTicker(userRiskTickInterval)
			defer ticker.Stop()

			runUserRiskScoreOnce()
			for range ticker.C {
				runUserRiskScoreOnce()
			}
		})
	})
}

// runUserRiskScoreOnce scores users and cancels invitations whose inviter
// and invitee share an IP; both work from the same IP observations.
func runUserRiskScoreOnce() {
	setting := *operation_setting.GetUserRiskSetting()
	cancelSharedIp := operation_setting.GetAffiliateRebateSetting().CancelSharedIp
	if !setting.Enabled && !cancelSharedIp {
		return
	}
	if !userRiskRunning.CompareAndSwap(false, true) {
		return
	}
	defer userRiskRunning.Store(false)

	ctx := context.Background()
	now := common.GetTimestamp()
	pairs, err := model.ListUserIpPairs(now - userRiskWindowSeconds(setting))
	if err != nil {
		logger.LogWarn(ctx, common.LogText("user risk score task failed to list IPs: %v", err))
		return
	}
	if cancelSharedIp {
		invites, err := model.ListCheckableAffiliateInvites()
		if err != nil {
			logger.LogWarn(ctx, common.LogText("user risk score task failed to list invitations: %v", err))
		} else {
			cancelSharedIpInvites(ctx, FindSharedIpInvites(pairs, invites))
		}
	}
	if !setting.Enabled {
		return
	}
	activeIds, err := model.ListActiveUserIds()
	if err != nil {
		logger.LogWarn(ctx, common.LogText("user risk score task failed to list users: %v", err))
		return
	}
	scores := ComputeUserRiskScores(pairs, activeIds, setting, now)
	if err := model.ReplaceUserRiskScores(scores); err != nil {
		logger.LogWarn(ctx, common.LogText("user risk score task failed to save scores: %v", err))
	}
}

func userRiskWindowSeconds(setting operation_setting.UserRiskSetting) int64 {
	return int64(max(setting.WindowDays, 1)) * 24 * 3600
}

// userRiskPublicAddr parses an IP the risk checks count. Non-public addresses
// are ignored so a misconfigured reverse proxy does not make every account
// look shared.
func userRiskPublicAddr(ip string) (netip.Addr, bool) {
	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return netip.Addr{}, false
	}
	addr = addr.Unmap().WithZone("")
	if !addr.IsGlobalUnicast() || addr.IsPrivate() {
		return netip.Addr{}, false
	}
	return addr, true
}

// SharedIpInvite is an invitation whose inviter and invitee were seen on the
// same public IPs.
type SharedIpInvite struct {
	model.AffiliateInvitePair
	Ips []string
}

// FindSharedIpInvites returns the invitations whose inviter and invitee share
// at least one public IP, with the shared IPs sorted.
func FindSharedIpInvites(pairs []model.UserIpPair, invites []model.AffiliateInvitePair) []SharedIpInvite {
	if len(invites) == 0 {
		return nil
	}
	userIps := make(map[int]map[netip.Addr]bool)
	for _, pair := range pairs {
		addr, ok := userRiskPublicAddr(pair.Ip)
		if !ok {
			continue
		}
		if userIps[pair.UserId] == nil {
			userIps[pair.UserId] = make(map[netip.Addr]bool)
		}
		userIps[pair.UserId][addr] = true
	}
	var matches []SharedIpInvite
	for _, invite := range invites {
		var shared []netip.Addr
		for addr := range userIps[invite.InviteeId] {
			if userIps[invite.InviterId][addr] {
				shared = append(shared, addr)
			}
		}
		if len(shared) == 0 {
			continue
		}
		slices.SortFunc(shared, netip.Addr.Compare)
		ips := make([]string, 0, min(len(shared), userRiskMaxMatches))
		for _, addr := range shared[:min(len(shared), userRiskMaxMatches)] {
			ips = append(ips, addr.String())
		}
		matches = append(matches, SharedIpInvite{AffiliateInvitePair: invite, Ips: ips})
	}
	return matches
}

func cancelSharedIpInvites(ctx context.Context, matches []SharedIpInvite) {
	for _, match := range matches {
		if _, err := model.CancelAffiliateInvite(match.InviteeId, match.InviterId, model.AffiliateReasonSharedIp, match.Ips, 0, ""); err != nil {
			logger.LogWarn(ctx, common.LogText("failed to cancel invitation of user %d: %v", match.InviteeId, err))
		}
	}
}

// ComputeUserRiskScores scores every active user that has at least one public
// IP: other accounts sharing an exact IP, other accounts sharing only the
// IPv4 /24 or IPv6 /64, and distinct IPs beyond the allowed threshold.
func ComputeUserRiskScores(pairs []model.UserIpPair, activeUserIds []int, setting operation_setting.UserRiskSetting, now int64) []model.UserRiskScore {
	active := make(map[int]bool, len(activeUserIds))
	for _, id := range activeUserIds {
		active[id] = true
	}
	userIps := make(map[int]map[netip.Addr]bool)
	ipUsers := make(map[netip.Addr]map[int]bool)
	subnetUsers := make(map[netip.Prefix]map[int]bool)
	for _, pair := range pairs {
		if !active[pair.UserId] {
			continue
		}
		addr, ok := userRiskPublicAddr(pair.Ip)
		if !ok {
			continue
		}
		if userIps[pair.UserId] == nil {
			userIps[pair.UserId] = make(map[netip.Addr]bool)
		}
		userIps[pair.UserId][addr] = true
		if ipUsers[addr] == nil {
			ipUsers[addr] = make(map[int]bool)
		}
		ipUsers[addr][pair.UserId] = true
		subnet := userRiskSubnet(addr)
		if subnetUsers[subnet] == nil {
			subnetUsers[subnet] = make(map[int]bool)
		}
		subnetUsers[subnet][pair.UserId] = true
	}

	scores := make([]model.UserRiskScore, 0, len(userIps))
	for userId, ips := range userIps {
		shared := make(map[int][]string)
		subnetOnly := make(map[int][]string)
		subnetsSeen := make(map[netip.Prefix]bool)
		for addr := range ips {
			for other := range ipUsers[addr] {
				if other != userId {
					shared[other] = append(shared[other], addr.String())
				}
			}
			subnet := userRiskSubnet(addr)
			if subnetsSeen[subnet] {
				continue
			}
			subnetsSeen[subnet] = true
			for other := range subnetUsers[subnet] {
				if other != userId {
					subnetOnly[other] = append(subnetOnly[other], subnet.String())
				}
			}
		}
		for other := range shared {
			delete(subnetOnly, other)
		}

		score := len(shared)*setting.SharedIpScore +
			len(subnetOnly)*setting.SameSubnetScore +
			max(len(ips)-setting.MultiIpThreshold, 0)*setting.MultiIpScore
		if setting.MaxScore > 0 {
			score = min(score, setting.MaxScore)
		}
		details, _ := common.Marshal(model.UserRiskDetails{
			SharedIp:   userRiskRelations(shared),
			SameSubnet: userRiskRelations(subnetOnly),
		})
		scores = append(scores, model.UserRiskScore{
			UserId:          userId,
			Score:           max(score, 0),
			SharedIpUsers:   len(shared),
			SameSubnetUsers: len(subnetOnly),
			IpCount:         len(ips),
			UpdatedAt:       now,
			Details:         string(details),
		})
	}
	slices.SortFunc(scores, func(a, b model.UserRiskScore) int { return cmp.Compare(a.UserId, b.UserId) })
	return scores
}

// userRiskSubnet is the range treated as one network: IPv4 /24, IPv6 /64.
func userRiskSubnet(addr netip.Addr) netip.Prefix {
	bits := 64
	if addr.Is4() {
		bits = 24
	}
	prefix, _ := addr.Prefix(bits)
	return prefix
}

// userRiskRelations orders related accounts by overlap, most matches first.
func userRiskRelations(matches map[int][]string) []model.UserRiskRelation {
	relations := make([]model.UserRiskRelation, 0, len(matches))
	for userId, values := range matches {
		slices.Sort(values)
		relations = append(relations, model.UserRiskRelation{UserId: userId, Matches: values[:min(len(values), userRiskMaxMatches)]})
	}
	slices.SortFunc(relations, func(a, b model.UserRiskRelation) int {
		if c := cmp.Compare(len(matches[b.UserId]), len(matches[a.UserId])); c != 0 {
			return c
		}
		return cmp.Compare(a.UserId, b.UserId)
	})
	return relations[:min(len(relations), userRiskMaxRelations)]
}
