import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TicketList } from "@/components/tickets/TicketListDnd";
import { useDispatchStore } from "@/stores/useDispatchStore";
import { DEFAULT_PRIORITY_BOOST_MAP, scoreBreakdown } from "@/lib/priority-score";
import type { EnrichedTicket, TicketPriority } from "@/types/halo";

const MOCK_NOW = new Date("2026-10-03T12:00:00.000Z");

vi.mock("@/hooks/useNow", () => ({
    // Stable reference like the real hook (fresh Date per render would churn
    // every `now`-keyed effect in the tree).
    useNow: () => MOCK_NOW,
}));

const NOW = new Date("2026-10-03T12:00:00.000Z");

function priorityObject(priorityid: number, name: string): TicketPriority {
    return {
        id: `00000000-0000-4000-8000-${String(priorityid).padStart(12, "0")}`,
        slaid: 1,
        priorityid,
        name,
        fixtime: 8,
        fixunits: "H",
        enterslaexcuse: false,
        responsetime: 1,
        responseunits: "H",
        ishidden: false,
        fixendofday: false,
        responseendofday: false,
        colour: "#fcdc00",
        catprompt: -1,
        workdaysoverride: -1,
        responsestartofday: false,
        responsestartofdaytime: "00:00:00",
        startofday: false,
        startofdaytime: "00:00:00",
        setfixtostartdate: false,
        setfixtotargetdate: false,
        firstresponsetime: 0,
        firstresponseunits: "H",
    };
}

function enrichedTicket(id: number, priority_id: number, name: string): EnrichedTicket {
    return {
        id,
        dateoccurred: "2026-10-03T11:00:00.000Z",
        summary: `Synthetic ticket ${id}`,
        details: "",
        status_id: 1,
        tickettype_id: 1,
        sla_id: 1,
        sla_name: "Standard",
        priority_id,
        priority: priorityObject(priority_id, name),
        client_id: 100,
        client_name: "Synthetic Client",
        site_id: 200,
        site_name: "Synthetic Site",
        user_id: 300,
        user_name: "Synthetic User",
        team_id: 9,
        team: "Synthetic Team",
        agent_id: 0,
        category_1: "General",
        category_2: "",
        category_3: "",
        category_4: "",
        categoryid_1: 1,
        estimate: 0,
        estimatedays: 0,
        timetaken: 0,
        child_count: 0,
        attachment_count: 0,
        flagged: false,
        read: true,
        enduserstatus: 0,
        onhold: false,
        respondbydate: "2026-10-10T12:00:00.000Z",
        responsedate: "2026-10-03T11:00:00.000Z",
        slaresponsestate: "",
        fixbydate: "2026-10-10T12:00:00.000Z",
        dateassigned: "2026-10-03T11:00:00.000Z",
        excludefromsla: false,
        slaholdtime: 0,
        site_timezone: "UTC",
        lastactiondate: "2026-10-03T11:30:00.000Z",
        last_update: "2026-10-03T11:30:00.000Z",
        organisation_id: 1,
        department_id: 1,
        matched_kb_id: 0,
        product_id: 0,
        release_id: 0,
        release2_id: 0,
        release3_id: 0,
        lastincomingemail: "",
        nextactivitydate: "",
        nextactivityorappointmentdate: "",
        workflow_id: 0,
        workflow_step: 0,
        workflow_seq: 0,
        pipeline_stage_id: 0,
        unread_child_action_count: 0,
        unread_related_action_count: 0,
        is_vip: false,
        isimportantcontact: false,
        inactive: false,
        impact: 1,
        urgency: 1,
        starttime: "",
        starttimeslot: 0,
        targetdate: "",
        targettime: "",
        targettimeslot: 0,
        deadlinedate: "",
        reportedby: "Synthetic Reporter",
        _listId: 11,
        _listName: "Synthetic List",
        clientSiteUser: "Synthetic Client / Synthetic Site / Synthetic User",
        statusName: "New",
        statusColour: "#a1c652",
        slaTimeLeft: "ok",
        slaState: "ok",
        agentName: "Unassigned",
        agentPhotoUrl: null,
        ticketTypeName: "Incident",
    };
}

function seedTickets(tickets: EnrichedTicket[]) {
    useDispatchStore.setState({
        haloTickets: tickets,
        selectedListIds: [11],
        selectedTicketAreaId: 7,
        ticketsLoading: false,
        ticketsRefreshing: false,
        ticketsError: null,
        currentPage: 1,
        pageSize: 25,
        totalRecords: tickets.length,
        agents: [],
    });
}

function scoreBadges(): HTMLElement[] {
    return screen.getAllByTitle(/Dispatch score/);
}

describe("TicketList tenant priority wiring", () => {
    it("scores badges with the tenant map built from loaded priority_ids", () => {
        const low = enrichedTicket(101, 50, "Low");
        const high = enrichedTicket(102, 10, "Urgent");
        seedTickets([low, high]);

        render(<TicketList />);

        const tenantMap = { 10: 15, 50: 0 };
        const expectedLow = scoreBreakdown(low, NOW, tenantMap).total;
        const expectedHigh = scoreBreakdown(high, NOW, tenantMap).total;
        // Under DEFAULT_PRIORITY_BOOST_MAP both renumbered ids score boost 0
        // and the totals would be equal, so inequality proves the tenant map.
        expect(expectedHigh).toBeGreaterThan(expectedLow);

        const badges = scoreBadges();
        expect(badges).toHaveLength(2);
        expect(badges[0]).toHaveTextContent(String(expectedLow));
        expect(badges[1]).toHaveTextContent(String(expectedHigh));
        expect(badges[1].getAttribute("title")).toContain("priority 15");
    });

    it("sorts by the tenant-mapped score when the Priority header is clicked", () => {
        const low = enrichedTicket(101, 50, "Low");
        const high = enrichedTicket(102, 10, "Urgent");
        seedTickets([low, high]);

        render(<TicketList />);

        const tenantMap = { 10: 15, 50: 0 };
        const expectedLow = String(scoreBreakdown(low, NOW, tenantMap).total);
        const expectedHigh = String(scoreBreakdown(high, NOW, tenantMap).total);

        fireEvent.click(screen.getByText("Priority"));
        expect(scoreBadges().map((badge) => badge.textContent)).toEqual([
            expectedHigh,
            expectedLow,
        ]);

        fireEvent.click(screen.getByText("Priority"));
        expect(scoreBadges().map((badge) => badge.textContent)).toEqual([
            expectedLow,
            expectedHigh,
        ]);
    });

    it("falls back to DEFAULT_PRIORITY_BOOST_MAP when no tenant ids are present", () => {
        const unprioritised = enrichedTicket(103, 0, "None");
        seedTickets([unprioritised]);

        render(<TicketList />);

        const expected = scoreBreakdown(unprioritised, NOW, DEFAULT_PRIORITY_BOOST_MAP).total;
        const badges = scoreBadges();
        expect(badges).toHaveLength(1);
        expect(badges[0]).toHaveTextContent(String(expected));
        expect(badges[0].getAttribute("title")).toContain("priority 0");
    });
});
