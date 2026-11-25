package operation_setting

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

// ChatSyncSetting bounds the chat sessions a native client (Lyra Box) keeps in
// the cloud for its user. Clients pull all of them; uploads are explicit.
type ChatSyncSetting struct {
	Enabled            bool `json:"enabled"`
	MaxSessionsPerUser int  `json:"max_sessions_per_user"`
	// MaxMegabytesPerUser bounds the total stored session content of a user.
	MaxMegabytesPerUser int `json:"max_megabytes_per_user"`
}

// ChatSyncMaxSessionBytes bounds one session's content. It stays below the
// MySQL max_allowed_packet the server already requires for playground
// documents (8 MiB + 1 MiB).
const ChatSyncMaxSessionBytes = 8 << 20

const (
	chatSyncMaxSessionsLimit  = 100_000
	chatSyncMaxMegabytesLimit = 100_000
)

var chatSyncSetting = ChatSyncSetting{
	Enabled:             true,
	MaxSessionsPerUser:  2000,
	MaxMegabytesPerUser: 200,
}

func init() {
	config.GlobalConfig.Register("chat_sync_setting", &chatSyncSetting)
}

func GetChatSyncSetting() *ChatSyncSetting {
	return &chatSyncSetting
}

// ValidateChatSyncOption bounds the numeric chat sync options before they are
// saved.
func ValidateChatSyncOption(key, value string) error {
	var limit int
	switch key {
	case "chat_sync_setting.max_sessions_per_user":
		limit = chatSyncMaxSessionsLimit
	case "chat_sync_setting.max_megabytes_per_user":
		limit = chatSyncMaxMegabytesLimit
	default:
		return nil
	}
	n, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || n < 1 || n > limit {
		return common.NewMessage("The value must be between 1 and {{max}}", map[string]any{"max": limit})
	}
	return nil
}
