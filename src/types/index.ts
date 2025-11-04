// Ticket and Appointment Status
export type TicketStatus =
  | 'new'
  | 'in_progress'
  | 'scheduled'
  | 'on_hold'
  | 'resolved'
  | 'closed';

export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export type AppointmentStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

// Base Ticket Interface
export interface Ticket {
  id: string;
  ticketNumber: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  siteName?: string;
  category: string;
  subcategory?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  estimatedDuration: number; // in minutes
  notes?: string;
}

// Appointment (Scheduled Ticket)
export interface Appointment {
  id: string;
  ticketId: string;
  ticket?: Ticket;
  agentId: number; // Changed from string to number - no prefix
  startTime: Date;
  endTime: Date;
  status: AppointmentStatus;
  location?: string;
  isAllDay: boolean;
  isTentative: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;

  // Halo PSA specific fields
  subject?: string; // Appointment title/subject
  colour?: string; // Hex color code
  complete_status?: number; // 0 = completed, -1 = not completed
  client_name?: string;
  site_name?: string;
  user_name?: string;
  appointment_type_name?: string;
  canUpdate?: boolean;
  canDelete?: boolean;
  canComplete?: boolean;
}

// Agent/Resource
export interface Agent {
  id: number; // Changed from string to number - no prefix
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  role: string;
  teamIds: string[];
  skills: string[];
  workingHours: WorkingHours;
  isActive: boolean;
  color: string; // for calendar display
}

// Working Hours
export interface WorkingHours {
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
}

export interface DaySchedule {
  isWorking: boolean;
  startTime: string; // HH:mm format (e.g., "09:00")
  endTime: string; // HH:mm format (e.g., "17:00")
  breaks?: TimeRange[];
}

export interface TimeRange {
  startTime: string;
  endTime: string;
}

// Team
export interface Team {
  id: string;
  name: string;
  description?: string;
  memberIds: number[]; // Changed from string[] to number[]
  color: string; // for calendar display
  isActive: boolean;
}

// Calendar View Types
export type CalendarView = 'day' | 'week5' | 'week7' | 'month';

// Resource Selection
export interface ResourceSelection {
  type: 'agent' | 'team';
  id: string;
}

// Calendar Event (unified view of appointments)
export interface CalendarEvent {
  id: string;
  appointmentId: string;
  appointment: Appointment;
  title: string;
  startTime: Date;
  endTime: Date;
  agentId: string;
  status: AppointmentStatus;
  priority: TicketPriority;
  color: string;
  isDraggable: boolean;
  isResizable: boolean;
}

// Resource Utilization Data
export interface ResourceUtilization {
  agentId: string;
  agent: Agent;
  date: Date;
  scheduledHours: number;
  availableHours: number;
  utilizationPercentage: number;
  appointments: Appointment[];
}

// Filter and Sort Options
export interface TicketFilters {
  status?: TicketStatus[];
  priority?: TicketPriority[];
  agentId?: string;
  category?: string;
  searchTerm?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export type TicketSortField = 'priority' | 'createdAt' | 'updatedAt' | 'ticketNumber' | 'status';
export type SortDirection = 'asc' | 'desc';

export interface TicketSort {
  field: TicketSortField;
  direction: SortDirection;
}

// Context Menu Actions
export type AppointmentAction =
  | 'open'
  | 'enter_action'
  | 'mark_complete'
  | 'edit'
  | 'delete'
  | 'change_status';

// Drag and Drop Types
export interface DragData {
  type: 'ticket' | 'appointment';
  data: Ticket | Appointment;
}

export interface DropTarget {
  agentId: string;
  startTime: Date;
  endTime: Date;
}

// UI State
export interface CalendarState {
  view: CalendarView;
  selectedDate: Date;
  selectedResources: ResourceSelection[];
  visibleTimeRange: {
    start: Date;
    end: Date;
  };
}
