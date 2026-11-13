package common

import (
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"html"
	"net/smtp"
	"slices"
	"strings"
	"time"
)

func generateMessageID() (string, error) {
	split := strings.Split(SMTPFrom, "@")
	if len(split) < 2 {
		return "", fmt.Errorf("invalid SMTP account")
	}
	domain := strings.Split(SMTPFrom, "@")[1]
	return fmt.Sprintf("<%d.%s@%s>", time.Now().UnixNano(), GetRandomString(12), domain), nil
}

func shouldUseSMTPLoginAuth() bool {
	if SMTPForceAuthLogin {
		return true
	}
	return isOutlookServer(SMTPAccount) || slices.Contains(EmailLoginAuthServerList, SMTPServer)
}

func getSMTPAuth() smtp.Auth {
	return AutoSMTPAuth(SMTPAccount, SMTPToken)
}

func shouldAuthenticateSMTP() bool {
	return SMTPAccount != "" && SMTPToken != ""
}

func smtpTLSConfig() *tls.Config {
	return &tls.Config{
		ServerName:         SMTPServer,
		InsecureSkipVerify: SMTPInsecureSkipVerify, // #nosec G402 -- admin-controlled SMTP compatibility option.
	}
}

func newSMTPClient(addr string) (*smtp.Client, error) {
	if SMTPSSLEnabled || (SMTPPort == 465 && !SMTPStartTLSEnabled) {
		conn, err := tls.Dial("tcp", addr, smtpTLSConfig())
		if err != nil {
			return nil, err
		}
		client, err := smtp.NewClient(conn, SMTPServer)
		if err != nil {
			_ = conn.Close()
			return nil, err
		}
		return client, nil
	}

	client, err := smtp.Dial(addr)
	if err != nil {
		return nil, err
	}

	if SMTPStartTLSEnabled {
		startTLSSupported, _ := client.Extension("STARTTLS")
		if !startTLSSupported {
			_ = client.Close()
			return nil, fmt.Errorf("SMTP server does not support STARTTLS")
		}
		if err := client.StartTLS(smtpTLSConfig()); err != nil {
			_ = client.Close()
			return nil, err
		}
	}

	return client, nil
}

// Colors, corner radius and button shape of the web console's light theme, so
// mail reads as part of the same product. Mail clients need them inline.
const (
	emailColorPage       = "#f5f5f5"
	emailColorCard       = "#ffffff"
	emailColorText       = "#0a0a0a"
	emailColorMuted      = "#606060"
	emailColorBorder     = "#e8e8e8"
	emailColorPrimary    = "#3ea4ec"
	emailFontFamily      = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue','PingFang SC','Microsoft YaHei',sans-serif"
	emailButtonTextColor = "#ffffff"
)

// EmailButton is the main action of a mail: a link drawn as the console's
// primary button. label is text and link an address; both are escaped.
func EmailButton(label string, link string) string {
	return fmt.Sprintf(`<p style="margin:24px 0 8px;">`+"\n"+
		`<a href="%s" style="display:inline-block;padding:10px 22px;border-radius:999px;background:%s;color:%s;font-size:14px;font-weight:600;text-decoration:none;">%s</a>`+"\n"+
		`</p>`,
		html.EscapeString(link), emailColorPrimary, emailButtonTextColor, html.EscapeString(label))
}

// emailDocument lays a mail's content out the way the web console looks: the
// system name over a white rounded card on a light page, with the subject as
// the heading. content is the HTML a caller wrote; it is placed as it is.
func emailDocument(subject string, content string) string {
	name := html.EscapeString(SystemName)
	brand := fmt.Sprintf(`<span style="font-size:16px;font-weight:600;color:%s;">%s</span>`, emailColorText, name)
	if strings.HasPrefix(Logo, "https://") || strings.HasPrefix(Logo, "http://") {
		brand = fmt.Sprintf(`<img src="%s" alt="" width="28" height="28" style="vertical-align:middle;border-radius:8px;margin-right:10px;" />`,
			html.EscapeString(Logo)) + "\n" + brand
	}
	return strings.Join([]string{
		`<!DOCTYPE html>`,
		`<html>`,
		`<head>`,
		`<meta charset="UTF-8" />`,
		`<meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
		`</head>`,
		fmt.Sprintf(`<body style="margin:0;padding:0;background:%s;">`, emailColorPage),
		fmt.Sprintf(`<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:%s;padding:32px 16px;font-family:%s;">`, emailColorPage, emailFontFamily),
		`<tr>`,
		`<td align="center">`,
		`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">`,
		`<tr>`,
		`<td style="padding:0 4px 16px;">`,
		brand,
		`</td>`,
		`</tr>`,
		`<tr>`,
		fmt.Sprintf(`<td style="background:%s;border:1px solid %s;border-radius:16px;padding:28px 28px 24px;color:%s;font-size:14px;line-height:1.7;">`, emailColorCard, emailColorBorder, emailColorText),
		fmt.Sprintf(`<h1 style="margin:0 0 16px;font-size:20px;line-height:1.4;font-weight:600;color:%s;">%s</h1>`, emailColorText, html.EscapeString(subject)),
		content,
		`</td>`,
		`</tr>`,
		`<tr>`,
		fmt.Sprintf(`<td style="padding:16px 4px 0;color:%s;font-size:12px;line-height:1.6;">%s</td>`, emailColorMuted, name),
		`</tr>`,
		`</table>`,
		`</td>`,
		`</tr>`,
		`</table>`,
		`</body>`,
		`</html>`,
	}, "\n")
}

func SendEmail(subject string, receiver string, content string) error {
	content = emailDocument(subject, content)
	OptionMapRWMutex.RLock()
	provider := OptionMap["EmailProvider"]
	resendKey := OptionMap["ResendApiKey"]
	resendFrom := OptionMap["ResendFrom"]
	OptionMapRWMutex.RUnlock()
	// One selector controls delivery. Never fall back to a second provider:
	// a failed response does not prove that the first provider did not send.
	switch provider {
	case "resend":
		return sendResendEmail(resendKey, resendFrom, subject, receiver, content)
	case "", "smtp": // Preserve existing installations without a selector.
	default:
		return NewMessage("Email sending method must be SMTP or Resend")
	}
	if SMTPFrom == "" { // for compatibility
		SMTPFrom = SMTPAccount
	}
	id, err2 := generateMessageID()
	if err2 != nil {
		return err2
	}
	if SMTPServer == "" && SMTPAccount == "" {
		return NewMessage("SMTP server is not configured")
	}
	encodedSubject := fmt.Sprintf("=?UTF-8?B?%s?=", base64.StdEncoding.EncodeToString([]byte(subject)))
	mail := []byte(fmt.Sprintf("To: %s\r\n"+
		"From: %s <%s>\r\n"+
		"Subject: %s\r\n"+
		"Date: %s\r\n"+
		"Message-ID: %s\r\n"+ // 添加 Message-ID 头
		"Content-Type: text/html; charset=UTF-8\r\n\r\n%s\r\n",
		receiver, SystemName, SMTPFrom, encodedSubject, time.Now().Format(time.RFC1123Z), id, content))
	auth := getSMTPAuth()
	addr := fmt.Sprintf("%s:%d", SMTPServer, SMTPPort)
	to := strings.Split(receiver, ";")
	var err error
	client, err := newSMTPClient(addr)
	if err != nil {
		return err
	}
	defer client.Close()
	if shouldAuthenticateSMTP() {
		if err = client.Auth(auth); err != nil {
			return err
		}
	}
	if err = client.Mail(SMTPFrom); err != nil {
		return err
	}
	for _, receiver := range to {
		if err = client.Rcpt(receiver); err != nil {
			return err
		}
	}
	w, err := client.Data()
	if err != nil {
		return err
	}
	_, err = w.Write(mail)
	if err != nil {
		return err
	}
	err = w.Close()
	if err != nil {
		return err
	}
	err = client.Quit()
	if err != nil {
		SysError(LogText("failed to send email to %s: %v", receiver, err))
	}
	return err
}
