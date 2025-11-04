// Halo PSA API Types

// ============================================================================
// Client Cache Types
// ============================================================================

export interface HaloAgent {
  id: number;
  name: string;
  team: string;
  email: string;
  agentphotopath?: string;
  agentphotodata?: string;
  jobtitle: string;
  onlinestatus_actual?: number;
  onlinestatus?: number;
  isdisabled: boolean;
  initials: string;
  colour: string;
  workhour_start?: number;
  workhour_end?: number;
  workday_id?: number;
  linemanager?: number;
  isapiagent?: boolean;
}

export interface HaloStatus {
  id: number;
  guid: string;
  name: string;
  shortname: string;
  type: number;
  sequence: number;
  colour: string;
  showonquickchange: boolean;
}

export interface HaloTicketType {
  id: number;
  guid: string;
  name: string;
  use: string; // "tickets", "projects", etc.
  sequence: number;
  cancreate: boolean;
  agentscanselect: boolean;
  visible: boolean;
}

export interface HaloTicketArea {
  guid: string;
  id: number;
  name: string;
  sequence: number;
  default_filter_id?: number;
  default_view_selectedid?: number;
  default_columns_id?: number;
}

export interface HaloFieldInfo {
  id: number;
  guid: string;
  name: string;
  label: string;
  labellong: string;
  summary: string;
  hint: string;
  type: number;
  custom: number;
  usage: number;
  tab_id: number;
  tab_name: string;
  tab_sequence: number;
  tab_columns: number;
  addunknown: boolean;
  inputtype: number;
  copytochild: boolean;
  searchable: boolean;
  user_searchable: boolean;
  calendar_searchable: boolean;
  defaultvalue: string;
  ordervaluesalphanumerically: boolean;
  ordervalueby: number;
  variable_name: string;
  database_lookup_auto: boolean;
  copytochildonupdate: boolean;
  showintable: boolean;
  showhintondetails: boolean;
  showondetailsscreen: boolean;
  selection_field_id: number;
  customextratableid: number;
  copytorelated: boolean;
  deleteafterclosure: boolean;
  deleteafterclosuredays: number;
  defaultdate: number;
  calculation: string;
  rounding: number;
  regex: string;
  excludefromallfields: boolean;
  mandatory: boolean;
  inherit_ac_from_tickettype: boolean;
  is_horizontal: boolean;
  showoncrmnote: boolean;
  isencrypted: boolean;
  sql_connection_type: number;
  max_selection: number;
  hint_type: number;
  lookup_method: number;
}

export interface ClientCache {
  agent: HaloAgent;
  statuses: HaloStatus[];
  tickettypes: HaloTicketType[];
  ticketareas: HaloTicketArea[];
  fieldinfos: HaloFieldInfo[];
  agents: HaloAgent[];
  languagepack?: Record<string, string>;
}

// ============================================================================
// ViewList Types
// ============================================================================

export interface ViewList {
  guid: string;
  id: number;
  name: string;
  use: string;
  agent_id: number;
  team_id: number;
  type: number;
  type_name: string;
  sequence: number;
  showcounts: boolean;
  column_profile_id: number;
  filter_profile_id: number;
  lock_view_type: number;
  connectedinstance_id: number;
  connectedinstance_list_id: number;
  show_in_team_tree: boolean;
  show_in_team_tree_team_id: number;
  default_kanban_view: number;
  ticket_count: number;
  group: number;
  group_name: string;
  group_seq: number;
  group_type: number;
  group_collapsed: boolean;
}

// ============================================================================
// Ticket Types
// ============================================================================

export interface TicketPriority {
  id: string;
  slaid: number;
  priorityid: number;
  name: string;
  fixtime: number;
  fixunits: string;
  enterslaexcuse: boolean;
  responsetime: number;
  responseunits: string;
  ishidden: boolean;
  fixendofday: boolean;
  responseendofday: boolean;
  colour: string;
  catprompt: number;
  workdaysoverride: number;
  responsestartofday: boolean;
  responsestartofdaytime: string;
  startofday: boolean;
  startofdaytime: string;
  setfixtostartdate: boolean;
  setfixtotargetdate: boolean;
  firstresponsetime: number;
  firstresponseunits: string;
}

export interface Ticket {
  id: number;
  dateoccurred: string;
  summary: string;
  details: string;
  status_id: number;
  tickettype_id: number;
  sla_id: number;
  sla_name: string;
  priority_id: number;
  priority: TicketPriority;
  client_id: number;
  client_name: string;
  site_id: number;
  site_name: string;
  user_id: number;
  user_name: string;
  team_id: number;
  team: string;
  agent_id: number;
  category_1: string;
  category_2: string;
  category_3: string;
  category_4: string;
  categoryid_1: number;
  estimate: number;
  estimatedays: number;
  timetaken: number;
  child_count: number;
  attachment_count: number;
  flagged: boolean;
  read: boolean;
  enduserstatus: number;
  onhold: boolean;
  respondbydate: string;
  responsedate: string;
  slaresponsestate: string;
  fixbydate: string;
  dateassigned: string;
  excludefromsla: boolean;
  slaholdtime: number;
  site_timezone: string;
  lastactiondate: string;
  last_update: string;
  organisation_id: number;
  department_id: number;
  matched_kb_id: number;
  product_id: number;
  release_id: number;
  release2_id: number;
  release3_id: number;
  lastincomingemail: string;
  nextactivitydate: string;
  nextactivityorappointmentdate: string;
  workflow_id: number;
  workflow_step: number;
  workflow_seq: number;
  pipeline_stage_id: number;
  unread_child_action_count: number;
  unread_related_action_count: number;
  is_vip: boolean;
  isimportantcontact: boolean;
  inactive: boolean;
  impact: number;
  urgency: number;
  starttime: string;
  starttimeslot: number;
  targetdate: string;
  targettime: string;
  targettimeslot: number;
  deadlinedate: string;
  reportedby?: string;
  lastnote?: string;
  // Custom field for tracking which list this ticket came from (when merging)
  _listId?: number;
  _listName?: string;
}

export interface TicketColumn {
  id: number;
  columns_id: number;
  column_seq: number;
  column_name: string;
  width: number;
  order_seq: number;
  order_desc: boolean;
  groupbystatus: boolean;
}

export interface TicketsResponse {
  page_no: number;
  page_size: number;
  record_count: number;
  tickets: Ticket[];
  columns_id?: number;
  columns_tilehtml?: string;
  columns_dashboard_id?: number;
  columns_cardhtml?: string;
  columns?: TicketColumn[];
}

// ============================================================================
// ViewFilter Types
// ============================================================================

export interface ViewFilter {
  id: number;
  guid: string;
  name: string;
  agent_id: number;
  team_id: number;
  type: number;
  type_name: string;
  sys_id: string;
}

// ============================================================================
// API Request Parameter Types
// ============================================================================

export interface GetViewListsParams {
  showcounts?: boolean;
  domain?: string;
  type?: string;
  ticketarea_id: number;
  utcoffset?: number;
}

export interface GetTicketsParams {
  pageinate?: boolean;
  page_size?: number;
  page_no?: number;
  columns_id?: number;
  includecolumns?: boolean;
  cf_display_values_only?: boolean;
  view_id?: number;
  ticketarea_id: number;
  includelastnote?: boolean;
  includehoversummary?: boolean;
  includechildread?: boolean;
  fetchgrandchildren?: boolean;
  list_id: number;
  utcoffset?: number;
}

export interface GetClientCacheParams {
  iscachebuild?: boolean;
}

export interface GetViewFilterParams {
  type?: string;
  ticketarea_id: number;
}

// ============================================================================
// Appointment Types
// ============================================================================

export interface HaloAppointment {
  id: number;
  agent_id: number;
  start_date: string;
  end_date: string;
  allday: boolean;
  appointment_type_id: number;
  status: number;
  note: string;
  estimate: number;
  colour: string;
  subject: string;
  complete_status: number;
  complete_notehtml?: string;
  complete_timetaken?: number;
  _canupdate: boolean;
  _cancomplete: boolean;
  _candelete: boolean;

  // Ticket-related fields
  ticket_id?: number;

  // Client/Site/User info
  client_id?: number;
  client_name?: string;
  site_id?: number;
  site_name?: string;
  user_id?: number;
  user_name?: string;

  // Metadata
  agent_name?: string;
  appointment_type_name?: string;
  open_appointment_status?: number;
  appointment_location?: number;
  appointment_location_name?: string;
  last_modified?: string;

  // Optional fields for calendar integration
  entity?: number;
  is_private?: boolean;
  reminder_shown?: boolean;
  is_task?: boolean;
  online_meeting_url?: string;
  organizer?: number;
  entryid?: string;
  changekey?: string;
  attendees?: string;
  _recurringmaster?: boolean;
  recurring_master_id?: string;
  type?: number;
  other1?: number;
  other2?: number;
  calendar_id?: string;
  shift_type_id?: number;
}

export interface HaloAppointmentType {
  lookupid: number;
  id: number;
  name: string;
  value2: string; // Appointment color
  value3: string;
  value3_bool: boolean; // Override calendar color
  value4: string;
  value4_bool: boolean; // Microsoft Teams enabled
  value5: string;
  value5_bool: boolean; // Location Mandatory
  value6: string;
  value6_bool: boolean; // Appointment Other 1 field mandatory
  value7: string;
  value7_bool: boolean; // Appointment Other 2 field mandatory
  value8: string; // Default Agent Status
  value8_bool: boolean;
  value9: string;
  value9_bool: boolean; // Available for resource booking during appointments of this type
  value10: string;
  value10_bool: boolean; // Do not show attendees field and remove attendees from the appointment
  custom1: string;
  custom2: string;
}

export interface GetAppointmentsParams {
  selectedAgents?: string; // Comma-separated agent IDs
  selectedStatuses?: string; // Comma-separated status IDs
  alllocations?: boolean;
  showholidays?: boolean;
  showappointments?: boolean;
  showchanges?: boolean;
  workhoursonly?: boolean;
  showprojects?: boolean;
  isrecurringmaster?: boolean;
  showtasks?: boolean;
  showscheduledtickets?: boolean;
  utcoffset?: number;
  start_date?: string; // ISO format
  end_date?: string; // ISO format
  agents?: string; // Comma-separated agent IDs (same as selectedAgents)
  appointmentsonly?: boolean;
  excluderecurringmaster?: boolean;
  showshifts?: boolean;
}

export interface GetLookupParams {
  lookupid: number;
  unameaprestriction?: boolean;
}

// ============================================================================
// Enriched Ticket Type (with lookup data populated)
// ============================================================================

export interface EnrichedTicket extends Ticket {
  // Computed fields
  clientSiteUser: string; // "client / site / user"
  statusName: string;
  statusColour: string;
  slaTimeLeft: string; // "2h 30m" or "On Hold" or "Overdue"
  slaState: 'ok' | 'warning' | 'overdue' | 'onhold';
  agentName: string;
  agentPhotoUrl: string | null;
  ticketTypeName: string;
}
