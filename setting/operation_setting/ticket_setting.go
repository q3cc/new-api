package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

// TicketSetting holds the support response targets: how many hours a ticket
// of each priority may wait for support before it is overdue.
type TicketSetting struct {
	SLAUrgentHours int `json:"sla_urgent_hours"`
	SLAHighHours   int `json:"sla_high_hours"`
	SLANormalHours int `json:"sla_normal_hours"`
	SLALowHours    int `json:"sla_low_hours"`
}

// TicketSLAMaxHours bounds a response target to 30 days.
const TicketSLAMaxHours = 720

var ticketSetting = TicketSetting{
	SLAUrgentHours: 2,
	SLAHighHours:   8,
	SLANormalHours: 24,
	SLALowHours:    72,
}

func init() {
	config.GlobalConfig.Register("ticket_setting", &ticketSetting)
}

func GetTicketSetting() *TicketSetting {
	return &ticketSetting
}

// ResponseHours returns the response target of a ticket priority; an unknown
// priority gets the normal target.
func (s *TicketSetting) ResponseHours(priority string) int {
	switch priority {
	case "urgent":
		return s.SLAUrgentHours
	case "high":
		return s.SLAHighHours
	case "low":
		return s.SLALowHours
	}
	return s.SLANormalHours
}
