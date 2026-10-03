import type { Ticket, EnrichedTicket, ClientCache } from "@/types/halo";
import { formatDistanceToNow } from "date-fns";

/**
 * Check if a date is the sentinel "null" date used by Halo PSA
 * "1899-12-30T00:00:00" is used to represent "no date set"
 */
function isNullDate(dateString: string): boolean {
    return dateString.startsWith("1899-12-30");
}

export interface SlaInfo {
    slaTimeLeft: string;
    slaState: "ok" | "warning" | "overdue" | "onhold";
}

/**
 * Pure SLA computation. `now` is injectable so live views can re-render the
 * countdown on a ticker without re-fetching the ticket list.
 */
export function computeSla(
    fixbydate: string | null | undefined,
    excludefromsla: boolean,
    onhold: boolean,
    now: Date = new Date(),
): SlaInfo {
    if (excludefromsla) {
        return { slaTimeLeft: "Excluded", slaState: "ok" };
    }
    if (onhold) {
        return { slaTimeLeft: "On Hold", slaState: "onhold" };
    }
    if (fixbydate && !isNullDate(fixbydate)) {
        const fixBy = new Date(fixbydate);

        if (fixBy.getTime() < now.getTime()) {
            // Overdue
            return {
                slaTimeLeft: `Overdue ${formatDistanceToNow(fixBy, { addSuffix: true })}`,
                slaState: "overdue",
            };
        }

        // Calculate time left
        const msLeft = fixBy.getTime() - now.getTime();
        const hoursLeft = msLeft / (1000 * 60 * 60);

        return {
            slaTimeLeft: formatDistanceToNow(fixBy, { addSuffix: true }),
            slaState: hoursLeft < 2 ? "warning" : "ok",
        };
    }
    return { slaTimeLeft: "None", slaState: "ok" };
}

/**
 * Enrich a ticket with lookup data from ClientCache
 * Computes display-ready fields like agentName, statusName, slaTimeLeft, etc.
 */
export function enrichTicket(ticket: Ticket, clientCache: ClientCache | null): EnrichedTicket {
    // Default enriched values
    const enriched: EnrichedTicket = {
        ...ticket,
        clientSiteUser: `${ticket.client_name} / ${ticket.site_name} / ${ticket.user_name}`,
        statusName: "Unknown",
        statusColour: "#cccccc",
        slaTimeLeft: "Unknown",
        slaState: "ok",
        agentName: "Unassigned",
        agentPhotoUrl: null,
        ticketTypeName: "Unknown",
    };

    if (!clientCache) {
        return enriched;
    }

    // Lookup Status
    const status = clientCache.statuses.find((s) => s.id === ticket.status_id);
    if (status) {
        enriched.statusName = status.name;
        enriched.statusColour = status.colour;
    }

    // Lookup Agent
    const agent = clientCache.agents.find((a) => a.id === ticket.agent_id);
    if (agent) {
        enriched.agentName = agent.name;
        // Photo URL will be built separately using resource server URL
        enriched.agentPhotoUrl = agent.agentphotopath || null;
    }

    // Lookup Ticket Type
    const ticketType = clientCache.tickettypes.find((t) => t.id === ticket.tickettype_id);
    if (ticketType) {
        enriched.ticketTypeName = ticketType.name;
    }

    // Compute SLA Time Left
    const sla = computeSla(ticket.fixbydate, ticket.excludefromsla, ticket.onhold);
    enriched.slaTimeLeft = sla.slaTimeLeft;
    enriched.slaState = sla.slaState;

    return enriched;
}
