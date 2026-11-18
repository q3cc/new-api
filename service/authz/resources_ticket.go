package authz

const ResourceTicket = "ticket"

var (
	TicketRead  = Permission{Resource: ResourceTicket, Action: ActionRead}
	TicketWrite = Permission{Resource: ResourceTicket, Action: ActionWrite}
)

func init() {
	RegisterResource(ResourceDefinition{
		Resource: ResourceTicket,
		LabelKey: "Support Tickets",
		Actions: []ActionDefinition{
			{
				Action:         ActionRead,
				LabelKey:       "View all tickets",
				DescriptionKey: "View every user's tickets, messages and images.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionWrite,
				LabelKey:       "Handle tickets",
				DescriptionKey: "Reply to, close and reopen users' tickets.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
		},
	})
}
