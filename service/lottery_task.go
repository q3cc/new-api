package service

import (
	"context"
	"html"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const lotteryTickInterval = 1 * time.Minute

var (
	lotteryTaskOnce    sync.Once
	lotteryTaskRunning atomic.Bool
)

// StartLotteryDrawTask draws due lottery activities every minute on the
// master node.
func StartLotteryDrawTask() {
	lotteryTaskOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			ticker := time.NewTicker(lotteryTickInterval)
			defer ticker.Stop()
			for range ticker.C {
				if !lotteryTaskRunning.CompareAndSwap(false, true) {
					continue
				}
				running := runBackgroundRound(func() {
					if err := model.RunDueLotteryDraws(); err != nil {
						logger.LogWarn(context.Background(), common.LogText("lottery draw task failed: %v", err))
					}
					emailLotteryWinners()
				})
				lotteryTaskRunning.Store(false)
				if !running {
					return
				}
			}
		})
	})
}

// emailLotteryWinners mails the winners of drawn activities, in each winner's
// language, what they won, the activity's notice and what they are asked to
// fill in. The personal message was already written with the draw.
func emailLotteryWinners() {
	notices, err := model.TakeDueLotteryWinNotices(100)
	if err != nil {
		logger.LogWarn(context.Background(), common.LogText("lottery win notices could not be read: %v", err))
	}
	link := PaymentReturnURL("/activities?tab=prizes")
	for _, notice := range notices {
		to := notice.Setting.NotificationEmail
		if to == "" {
			to = notice.Email
		}
		if to == "" {
			continue
		}
		lang := notice.Setting.Language
		// The title, prize, notice and field names are written by people.
		content := "<p>" + i18n.Translate(lang, i18n.MsgLotteryWinEmail, map[string]any{
			"Prize":    html.EscapeString(notice.PrizeName),
			"Activity": html.EscapeString(notice.ActivityTitle),
		}) + "</p>"
		if notice.WinnerNotice != "" {
			content += "<p>" + strings.ReplaceAll(html.EscapeString(notice.WinnerNotice), "\n", "<br/>") + "</p>"
		}
		action := i18n.MsgLotteryWinEmailView
		if len(notice.WinnerFields) > 0 {
			labels := make([]string, len(notice.WinnerFields))
			for i, field := range notice.WinnerFields {
				labels[i] = html.EscapeString(field.Label)
			}
			content += "<p>" + i18n.Translate(lang, i18n.MsgLotteryWinEmailFields, map[string]any{
				"Fields": strings.Join(labels, i18n.Translate(lang, i18n.MsgLotteryWinEmailFieldSeparator)),
			}) + "</p>"
			action = i18n.MsgLotteryWinEmailFill
		}
		content += common.EmailButton(i18n.Translate(lang, action), link)
		subject := i18n.Translate(lang, i18n.MsgLotteryWinEmailSubject, map[string]any{"SystemName": common.SystemName})
		if err := common.SendEmail(subject, to, content); err != nil {
			logger.LogWarn(context.Background(), common.LogText("lottery win email to user %d failed: %v", notice.UserId, err))
		}
	}
}
