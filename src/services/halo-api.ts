import { get } from '@/lib/api-client';
import type {
  ClientCache,
  ViewList,
  ViewFilter,
  TicketsResponse,
  GetClientCacheParams,
  GetViewListsParams,
  GetViewFilterParams,
  GetTicketsParams,
  HaloAppointment,
  HaloAppointmentType,
  GetAppointmentsParams,
  GetLookupParams,
} from '@/types/halo';

/**
 * Halo PSA API Service
 *
 * This service provides methods to interact with the Halo PSA API.
 * All methods use the apiClient which handles authentication and token refresh automatically.
 */

/**
 * Get ClientCache - Contains all reference data needed for the application
 * Should be called once after login to populate agents, ticket areas, statuses, etc.
 *
 * @param iscachebuild - Whether this is a cache build request (default: true)
 * @returns ClientCache with agents, ticket areas, statuses, ticket types, etc.
 */
export async function getClientCache(
  params: GetClientCacheParams = { iscachebuild: true }
): Promise<ClientCache> {
  const response = await get<ClientCache>('/api/ClientCache', params);
  console.log('ClientCache API response:', response);
  return response;
}

/**
 * Get ViewLists - Returns available ticket lists/views for a selected ticket area
 * Lists are grouped (e.g., "My Tickets", "Triage", "All Tickets")
 *
 * @param ticketAreaId - The ID of the selected ticket area
 * @param utcOffset - UTC offset in minutes (default: 0)
 * @returns Array of ViewList objects with groups
 */
export async function getViewLists(
  ticketAreaId: number,
  utcOffset: number = 0
): Promise<ViewList[]> {
  const params: GetViewListsParams = {
    showcounts: true,
    domain: 'reqs',
    type: 'reqs',
    ticketarea_id: ticketAreaId,
    utcoffset: utcOffset,
  };

  return get<ViewList[]>('/api/viewlists', params);
}

/**
 * Get ViewFilter - Returns available filter definitions
 * Note: This call may not be necessary since filter_id is already in the list object from getViewLists
 *
 * @param ticketAreaId - The ID of the selected ticket area
 * @returns Array of ViewFilter objects
 */
export async function getViewFilter(
  ticketAreaId: number
): Promise<ViewFilter[]> {
  const params: GetViewFilterParams = {
    type: 'reqs',
    ticketarea_id: ticketAreaId,
  };

  return get<ViewFilter[]>('/api/ViewFilter', params);
}

/**
 * Get Tickets - Fetch paginated tickets for a specific list
 *
 * @param listId - The ID of the list to fetch tickets from
 * @param ticketAreaId - The ID of the selected ticket area
 * @param pageNo - Page number (1-indexed, default: 1)
 * @param pageSize - Results per page (default: 100)
 * @param columnsId - Column profile ID from the selected list (optional)
 * @param utcOffset - UTC offset in minutes (default: 0)
 * @returns TicketsResponse with tickets array and pagination metadata
 */
export async function getTickets(
  listId: number,
  ticketAreaId: number,
  pageNo: number = 1,
  pageSize: number = 100,
  columnsId?: number,
  utcOffset: number = 0
): Promise<TicketsResponse> {
  const params: GetTicketsParams = {
    pageinate: true,
    page_size: pageSize,
    page_no: pageNo,
    ticketarea_id: ticketAreaId,
    list_id: listId,
    utcoffset: utcOffset,
    includelastnote: true,
    includehoversummary: true,
    includechildread: true,
    fetchgrandchildren: false,
    cf_display_values_only: true,
    view_id: 0,
  };

  // Add columns_id if provided
  if (columnsId !== undefined) {
    params.columns_id = columnsId;
    params.includecolumns = true;
  }

  return get<TicketsResponse>('/api/Tickets', params);
}

/**
 * Get UTC offset in minutes for the current timezone
 * Used in API calls that require timezone information
 *
 * @returns UTC offset in minutes (e.g., -300 for UTC-5)
 */
export function getUtcOffset(): number {
  const offsetMinutes = new Date().getTimezoneOffset();
  // getTimezoneOffset returns positive values for locations west of UTC
  // We need to negate it to match the API's expected format
  return -offsetMinutes;
}

/**
 * Build agent photo URL from agent photo path
 *
 * @param resourceServer - The resource server URL (e.g., "https://gocovi.halopsa.com")
 * @param agentPhotoPath - The agent photo path from the API (e.g., "/AgentImage/...")
 * @returns Full photo URL or null if agentPhotoPath is not provided
 */
export function getAgentPhotoUrl(
  resourceServer: string,
  agentPhotoPath?: string
): string | null {
  if (!agentPhotoPath) {
    return null;
  }

  // Remove trailing slash from resource server if present
  const baseUrl = resourceServer.replace(/\/$/, '');

  // Ensure agentPhotoPath starts with /api
  if (agentPhotoPath.startsWith('/api')) {
    return `${baseUrl}${agentPhotoPath}`;
  }

  return `${baseUrl}/api${agentPhotoPath}`;
}

/**
 * Get Lookup - Generic lookup endpoint for retrieving reference data
 *
 * @param lookupId - The ID of the lookup table to retrieve
 * @param unameaprestriction - Whether to apply name/appointment restrictions (default: true)
 * @returns Array of lookup items (type depends on lookupId)
 */
export async function getLookup<T = any>(
  lookupId: number,
  unameaprestriction: boolean = true
): Promise<T[]> {
  const params: GetLookupParams = {
    lookupid: lookupId,
    unameaprestriction,
  };

  return get<T[]>('/api/lookup', params);
}

/**
 * Get Appointment Types - Fetch available appointment types
 * Uses the lookup endpoint with lookupId 63
 *
 * @returns Array of HaloAppointmentType objects with colors and settings
 */
export async function getAppointmentTypes(): Promise<HaloAppointmentType[]> {
  return getLookup<HaloAppointmentType>(63, true);
}

/**
 * Get Appointments - Fetch appointments for the calendar
 *
 * @param startDate - Start date for the date range (ISO format)
 * @param endDate - End date for the date range (ISO format)
 * @param agentIds - Array of agent IDs to filter by (optional)
 * @param utcOffset - UTC offset in minutes (default: calculated from timezone)
 * @returns Array of HaloAppointment objects
 */
export async function getAppointments(
  startDate: string,
  endDate: string,
  agentIds?: number[],
  utcOffset?: number
): Promise<HaloAppointment[]> {
  const offset = utcOffset ?? getUtcOffset();
  const agentIdsStr = agentIds?.join(',') || '';

  const params: GetAppointmentsParams = {
    selectedAgents: agentIdsStr,
    selectedStatuses: '0,1',
    alllocations: true,
    showholidays: true,
    showappointments: true,
    showchanges: true,
    workhoursonly: true,
    showprojects: true,
    isrecurringmaster: false,
    showtasks: false,
    showscheduledtickets: true,
    utcoffset: offset,
    start_date: startDate,
    end_date: endDate,
    agents: agentIdsStr,
    appointmentsonly: true,
    excluderecurringmaster: true,
    showshifts: false,
  };

  return get<HaloAppointment[]>('/api/Appointment', params);
}
