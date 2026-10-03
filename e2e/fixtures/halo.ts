/**
 * Synthetic Halo fixtures for the Playwright smoke suite.
 *
 * Shapes mirror the documented API subset (see api_responses/) but all values
 * are invented. They must satisfy the zod envelopes in halo-schemas.ts and
 * carry the fields the dispatch UI reads (client/site/user names, dates).
 */

export const RESOURCE_SERVER = "https://smoke.halopsa.com";
export const AUTH_SERVER = "https://smoke.halopsa.com/auth";

export const clientCacheFixture = {
    agent: {
        id: 1,
        name: "Smoke Agent",
        team: "Smoke Team",
        email: "smoke@example.test",
        jobtitle: "Engineer",
        isdisabled: false,
        initials: "SA",
        colour: "#6366f1",
    },
    agents: [
        {
            id: 1,
            name: "Smoke Agent",
            team: "Smoke Team",
            email: "smoke@example.test",
            jobtitle: "Engineer",
            isdisabled: false,
            initials: "SA",
            colour: "#6366f1",
        },
    ],
    statuses: [
        {
            id: 1,
            guid: "00000000-0000-0000-0000-000000000001",
            name: "New",
            shortname: "New",
            type: 1,
            sequence: 1,
            colour: "#ff0000",
            showonquickchange: true,
        },
    ],
    tickettypes: [
        {
            id: 1,
            guid: "00000000-0000-0000-0000-000000000002",
            name: "Incident",
            use: "tickets",
            sequence: 1,
            cancreate: true,
            agentscanselect: true,
            visible: true,
        },
    ],
    ticketareas: [
        {
            guid: "00000000-0000-0000-0000-000000000003",
            id: 7,
            name: "Service Desk",
            sequence: 1,
        },
    ],
    fieldinfos: [],
};

export const teamsFixture = [
    {
        id: 9,
        name: "Smoke Team",
        sequence: 1,
        forrequests: true,
        foropps: false,
        forprojects: false,
        inactive: false,
    },
];

export const viewListsFixture = [
    {
        guid: "00000000-0000-0000-0000-000000000004",
        id: 11,
        name: "Smoke Triage",
        use: "reqs",
        agent_id: 1,
        team_id: 9,
        type: 1,
        type_name: "Tickets",
        sequence: 1,
        showcounts: true,
        column_profile_id: 0,
        filter_profile_id: 0,
        lock_view_type: 0,
        connectedinstance_id: 0,
        connectedinstance_list_id: 0,
        show_in_team_tree: false,
        show_in_team_tree_team_id: 0,
        default_kanban_view: 0,
        ticket_count: 1,
        group: 1,
        group_name: "Smoke",
        group_seq: 1,
        group_type: 1,
        group_collapsed: false,
    },
];

export const ticketsFixture = {
    page_no: 1,
    page_size: 100,
    record_count: 1,
    tickets: [
        {
            id: 4242,
            dateoccurred: "2026-01-05T09:00:00",
            summary: "Smoke-test printer offline",
            details: "Synthetic ticket for smoke tests.",
            status_id: 1,
            tickettype_id: 1,
            sla_id: 1,
            sla_name: "Standard",
            priority_id: 1,
            client_id: 100,
            client_name: "Smoke Client",
            site_id: 200,
            site_name: "Smoke Site",
            user_id: 300,
            user_name: "Smoke User",
            team_id: 9,
            team: "Smoke Team",
            agent_id: 1,
            category_1: "Hardware",
            estimate: 0,
            flagged: false,
            read: true,
            enduserstatus: 0,
            onhold: false,
            fixbydate: "1899-12-30T00:00:00",
            excludefromsla: true,
            lastactiondate: "2026-01-05T09:00:00",
            last_update: "2026-01-05T09:00:00",
        },
    ],
};

export const appointmentsFixture = [
    {
        id: 555,
        agent_id: 1,
        start_date: "2026-01-05T14:00:00",
        end_date: "2026-01-05T15:00:00",
        allday: false,
        appointment_type_id: 1,
        status: 0,
        note: "Synthetic appointment for smoke tests.",
        estimate: 60,
        colour: "#6366f1",
        subject: "Smoke appointment",
        complete_status: -1,
        _canupdate: true,
        _cancomplete: true,
        _candelete: false,
        ticket_id: 4242,
        client_name: "Smoke Client",
        site_name: "Smoke Site",
        user_name: "Smoke User",
        agent_name: "Smoke Agent",
    },
];

/** Fresh (non-expiring) token set; obtained_at is stamped at seed time. */
export function freshTokens() {
    return {
        access_token: "smoke-access-token",
        refresh_token: "smoke-refresh-token",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "all:standard offline_access",
        obtained_at: Date.now(),
    };
}

export function configState() {
    return {
        state: {
            config: {
                tenant: "smoke",
                authServer: AUTH_SERVER,
                resourceServer: RESOURCE_SERVER,
                clientId: "smoke-client-id",
                redirectUri: "http://localhost:4173/auth/callback",
            },
        },
        version: 0,
    };
}

export function selectionState() {
    return {
        state: { selectedTicketAreaId: 7, selectedListIds: [11] },
        version: 0,
    };
}
