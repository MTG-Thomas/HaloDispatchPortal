import type { Ticket, EnrichedTicket, ClientCache } from '@/types/halo';
import { formatDistanceToNow, isPast } from 'date-fns';

/**
 * Enrich a ticket with lookup data from ClientCache
 * Computes display-ready fields like agentName, statusName, slaTimeLeft, etc.
 */
export function enrichTicket(
  ticket: Ticket,
  clientCache: ClientCache | null
): EnrichedTicket {
  // Default enriched values
  const enriched: EnrichedTicket = {
    ...ticket,
    clientSiteUser: `${ticket.client_name} / ${ticket.site_name} / ${ticket.user_name}`,
    statusName: 'Unknown',
    statusColour: '#cccccc',
    slaTimeLeft: 'Unknown',
    slaState: 'ok',
    agentName: 'Unassigned',
    agentPhotoUrl: null,
    ticketTypeName: 'Unknown',
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
  if (ticket.excludefromsla) {
    enriched.slaTimeLeft = 'Excluded';
    enriched.slaState = 'ok';
  } else if (ticket.onhold) {
    enriched.slaTimeLeft = 'On Hold';
    enriched.slaState = 'onhold';
  } else if (ticket.fixbydate) {
    const fixBy = new Date(ticket.fixbydate);
    const now = new Date();

    if (isPast(fixBy)) {
      // Overdue
      enriched.slaTimeLeft = `Overdue ${formatDistanceToNow(fixBy, { addSuffix: true })}`;
      enriched.slaState = 'overdue';
    } else {
      // Calculate time left
      const msLeft = fixBy.getTime() - now.getTime();
      const hoursLeft = msLeft / (1000 * 60 * 60);

      if (hoursLeft < 2) {
        enriched.slaState = 'warning';
      } else {
        enriched.slaState = 'ok';
      }

      enriched.slaTimeLeft = formatDistanceToNow(fixBy, { addSuffix: true });
    }
  } else {
    enriched.slaTimeLeft = 'No SLA';
    enriched.slaState = 'ok';
  }

  return enriched;
}
