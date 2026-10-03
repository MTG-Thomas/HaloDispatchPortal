import { get, post, type RequestOptions } from "@/lib/api-client";
import {
    parseHaloResponse,
    ClientCacheSchema,
    ViewListArraySchema,
    ViewFilterArraySchema,
    TicketsResponseSchema,
    HaloAppointmentArraySchema,
    HaloAppointmentTypeArraySchema,
    SearchUsersResponseSchema,
    HaloCategoryArraySchema,
    HaloTeamArraySchema,
    HaloAgentArraySchema,
    GetSitesResponseSchema,
    TicketArraySchema,
} from "@/lib/halo-schemas";
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
    SearchUsersParams,
    SearchUsersResponse,
    GetCategoriesParams,
    HaloCategory,
    GetTeamsParams,
    HaloTeam,
    GetAgentsParams,
    HaloAgent,
    GetSitesParams,
    GetSitesResponse,
    CreateTicketPayload,
    Ticket,
} from "@/types/halo";

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
    params: GetClientCacheParams = { iscachebuild: true },
    options?: RequestOptions,
): Promise<ClientCache> {
    const response = await get<unknown>("/api/ClientCache", params, options);
    return parseHaloResponse<ClientCache>(ClientCacheSchema, response, "ClientCache");
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
    utcOffset: number = 0,
    options?: RequestOptions,
): Promise<ViewList[]> {
    const params: GetViewListsParams = {
        showcounts: true,
        domain: "reqs",
        type: "reqs",
        ticketarea_id: ticketAreaId,
        utcoffset: utcOffset,
    };

    const response = await get<unknown>("/api/viewlists", params, options);
    return parseHaloResponse<ViewList[]>(ViewListArraySchema, response, "ViewLists");
}

/**
 * Get ViewFilter - Returns available filter definitions
 * Note: This call may not be necessary since filter_id is already in the list object from getViewLists
 *
 * @param ticketAreaId - The ID of the selected ticket area
 * @returns Array of ViewFilter objects
 */
export async function getViewFilter(
    ticketAreaId: number,
    options?: RequestOptions,
): Promise<ViewFilter[]> {
    const params: GetViewFilterParams = {
        type: "reqs",
        ticketarea_id: ticketAreaId,
    };

    const response = await get<unknown>("/api/ViewFilter", params, options);
    return parseHaloResponse<ViewFilter[]>(ViewFilterArraySchema, response, "ViewFilter");
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
    utcOffset: number = 0,
    options?: RequestOptions,
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

    const response = await get<unknown>("/api/Tickets", params, options);
    return parseHaloResponse<TicketsResponse>(TicketsResponseSchema, response, "Tickets");
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
 * @param resourceServer - The resource server URL (e.g., "https://example.halopsa.com")
 * @param agentPhotoPath - The agent photo path from the API (e.g., "/AgentImage/...")
 * @returns Full photo URL or null if agentPhotoPath is not provided
 */
export function getAgentPhotoUrl(resourceServer: string, agentPhotoPath?: string): string | null {
    if (!agentPhotoPath) {
        return null;
    }

    // Remove trailing slash from resource server if present
    const baseUrl = resourceServer.replace(/\/$/, "");

    // Ensure agentPhotoPath starts with /api
    if (agentPhotoPath.startsWith("/api")) {
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
export async function getLookup<T = unknown>(
    lookupId: number,
    unameaprestriction: boolean = true,
    options?: RequestOptions,
): Promise<T[]> {
    const params: GetLookupParams = {
        lookupid: lookupId,
        unameaprestriction,
    };

    // Generic lookup: no single schema fits all lookup tables, so typed
    // callers validate their own shape (see getAppointmentTypes).
    return get<T[]>("/api/lookup", params, options);
}

/**
 * Get Appointment Types - Fetch available appointment types
 * Uses the lookup endpoint with lookupId 63
 *
 * @returns Array of HaloAppointmentType objects with colors and settings
 */
export async function getAppointmentTypes(
    options?: RequestOptions,
): Promise<HaloAppointmentType[]> {
    const response = await getLookup<unknown>(63, true, options);
    return parseHaloResponse<HaloAppointmentType[]>(
        HaloAppointmentTypeArraySchema,
        response,
        "AppointmentTypes",
    );
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
    utcOffset?: number,
    options?: RequestOptions,
): Promise<HaloAppointment[]> {
    const offset = utcOffset ?? getUtcOffset();
    const agentIdsStr = agentIds?.join(",") || "";

    const params: GetAppointmentsParams = {
        selectedAgents: agentIdsStr,
        selectedStatuses: "0,1",
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

    const response = await get<unknown>("/api/Appointment", params, options);
    return parseHaloResponse<HaloAppointment[]>(
        HaloAppointmentArraySchema,
        response,
        "Appointments",
    );
}

/**
 * Create or Update Appointment - Create a new appointment or update an existing one
 * Halo requires appointments to be sent as an array even for single operations
 *
 * @param appointment - Partial appointment data (can be a completion update or full appointment)
 * @returns Array with the created/updated appointment
 */
export async function createOrUpdateAppointment(
    appointment: Partial<HaloAppointment> & { id?: number },
    options?: RequestOptions,
): Promise<HaloAppointment[]> {
    // Halo API requires appointments to be sent as an array
    const response = await post<unknown>("/api/appointment", [appointment], options);
    return parseHaloResponse<HaloAppointment[]>(
        HaloAppointmentArraySchema,
        response,
        "Appointment",
    );
}

// ============================================================================
// Triage & Dispatch API Methods
// ============================================================================

/**
 * Search Users - Search for users with optional filtering
 * Used for selecting ticket users and appointment attendees
 *
 * @param params - Search parameters including search query and filters
 * @returns SearchUsersResponse with users array and count
 */
export async function searchUsers(
    params: SearchUsersParams = {},
    options?: RequestOptions,
): Promise<SearchUsersResponse> {
    const defaultParams: SearchUsersParams = {
        count: 50,
        includeserviceaccount: false,
        onlyprospects: false,
        onlyusers: true,
        ...params,
    };

    const response = await get<unknown>("/api/Users", defaultParams, options);
    return parseHaloResponse<SearchUsersResponse>(SearchUsersResponseSchema, response, "Users");
}

/**
 * Get Categories - Fetch service categories for a ticket type and client
 * Used for ticket categorization in triage
 *
 * @param params - Parameters including ticket type ID and client ID
 * @returns Array of HaloCategory objects
 */
export async function getCategories(
    params: GetCategoriesParams,
    options?: RequestOptions,
): Promise<HaloCategory[]> {
    const response = await get<unknown>("/api/Category", params, options);
    return parseHaloResponse<HaloCategory[]>(HaloCategoryArraySchema, response, "Categories");
}

/**
 * Get Teams - Fetch available teams for a ticket type
 * Used for team selection in triage
 *
 * @param params - Parameters including optional ticket type ID
 * @returns Array of HaloTeam objects (filtered for active teams that handle requests)
 */
export async function getTeams(
    params: GetTeamsParams = {},
    options?: RequestOptions,
): Promise<HaloTeam[]> {
    const response = await get<unknown>("/api/team", params, options);
    const teams = parseHaloResponse<HaloTeam[]>(HaloTeamArraySchema, response, "Teams");
    // Filter to only active teams that handle requests
    return teams.filter((team) => team.forrequests && !team.inactive);
}

/**
 * Get Agents - Fetch agents with optional filtering by team, client, and ticket type
 * Used for agent selection in both triage and dispatch
 *
 * @param params - Optional parameters for filtering agents
 * @returns Array of HaloAgent objects
 */
export async function getAgents(
    params: GetAgentsParams = {},
    options?: RequestOptions,
): Promise<HaloAgent[]> {
    const defaultParams: GetAgentsParams = {
        reassign: true,
        basic_fields_only: true,
        ...params,
    };

    const response = await get<unknown>("/api/agent", defaultParams, options);
    return parseHaloResponse<HaloAgent[]>(HaloAgentArraySchema, response, "Agents");
}

/**
 * Get Sites - Search for sites with pagination
 * Used for appointment location selection in dispatch
 *
 * @param params - Parameters including pagination and optional search query
 * @returns GetSitesResponse with sites array and pagination metadata
 */
export async function getSites(
    params: GetSitesParams = {},
    options?: RequestOptions,
): Promise<GetSitesResponse> {
    const defaultParams: GetSitesParams = {
        pageinate: true,
        page_no: 1,
        page_size: 100,
        ...params,
    };

    const response = await get<unknown>("/api/site", defaultParams, options);
    return parseHaloResponse<GetSitesResponse>(GetSitesResponseSchema, response, "Sites");
}

/**
 * Create or Update Ticket - Create a new ticket or update an existing one
 * Halo requires tickets to be sent as an array even for single operations
 *
 * @param ticketData - Ticket data to create or update
 * @returns Array with the created/updated ticket
 */
export async function createOrUpdateTicket(
    ticketData: CreateTicketPayload,
    options?: RequestOptions,
): Promise<Ticket[]> {
    // Halo API requires tickets to be sent as an array
    const response = await post<unknown>("/api/Tickets", [ticketData], options);
    return parseHaloResponse<Ticket[]>(TicketArraySchema, response, "Ticket");
}
