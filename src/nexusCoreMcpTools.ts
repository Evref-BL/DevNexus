export const devNexusCoreMcpServerName = "dev_nexus" as const;

export const devNexusCoreMcpToolNames = [
  "project_status",
  "automation_status",
  "eligible_work",
  "agent_profiles",
  "setup_flow_list",
  "setup_plan",
  "setup_check",
  "setup_record",
  "target_cycle_list",
  "target_cycle_record",
  "target_report",
  "current_agent_adopt",
  "current_agent_record",
  "worktree_prepare",
  "coordination_status",
  "coordination_handoff",
  "coordination_integrate",
  "coordination_request",
  "work_item_create",
  "work_item_list",
  "work_item_get",
  "work_item_update",
  "work_item_comment",
  "work_item_set_status",
  "work_item_link",
  "work_item_show_links",
  "work_item_unlink",
  "work_item_sync_plan",
] as const;

export type DevNexusCoreMcpToolName =
  typeof devNexusCoreMcpToolNames[number];
