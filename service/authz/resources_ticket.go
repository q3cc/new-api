package authz

const (
	ResourceTicket = "ticket"

	ActionManage = "manage"
	ActionDelete = "delete"
)

var (
	TicketRead   = Permission{Resource: ResourceTicket, Action: ActionRead}
	TicketWrite  = Permission{Resource: ResourceTicket, Action: ActionWrite}
	TicketManage = Permission{Resource: ResourceTicket, Action: ActionManage}
	TicketDelete = Permission{Resource: ResourceTicket, Action: ActionDelete}
)

func init() {
	RegisterResource(ResourceDefinition{
		Resource: ResourceTicket,
		LabelKey: "Support Tickets",
		Actions: []ActionDefinition{
			{
				Action:         ActionRead,
				LabelKey:       "View all tickets",
				DescriptionKey: "View every user's tickets, messages, notes and images.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionWrite,
				LabelKey:       "Handle tickets",
				DescriptionKey: "Reply to, add notes to, prioritize, close and reopen users' tickets.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionManage,
				LabelKey:       "Manage ticket settings",
				DescriptionKey: "Edit response targets and the shared canned replies.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionDelete,
				LabelKey:       "Delete tickets",
				DescriptionKey: "Permanently delete tickets with their messages and images.",
			},
		},
	})
}
