/**
 * Dispatcher "send booking link" helpers.
 *
 * Channel preference: a Halo-native ticket email/SMS action would be ideal,
 * but the repo's verified Halo surface has no such endpoint — see
 * `src/services/halo-api.ts` (ClientCache, viewlists, Tickets, lookup,
 * Appointment, Users, Category, team, agent, site only) and the ticket sample
 * in `api_responses/4_Tickets.json` (no action fields). Per repo rules we do
 * not invent Halo API fields, so sending falls back to `mailto:`/`sms:` deep
 * links with the booking URL prefilled. `BOOKING_SEND_VIA_HALO_SUPPORTED` is
 * the seam to flip if a ticket-action endpoint is ever verified.
 */

export const BOOKING_SEND_VIA_HALO_SUPPORTED = false as const;

export type BookingSendChannel = "mailto" | "sms";

export interface BookingContact {
    email?: string | null;
    phone?: string | null;
}

export interface BookingLinkDetails {
    ticketId: number;
    /** Absolute `/book/<token>` URL. */
    url: string;
    /** ISO expiry of the link, when known. */
    expiresAt?: string | null;
}

/** Absolute customer booking URL for a freshly minted token. */
export function buildBookingUrl(origin: string, token: string): string {
    return `${origin.replace(/\/$/, "")}/book/${token}`;
}

export function buildBookingEmailSubject(ticketId: number): string {
    return `Book your appointment — ticket #${ticketId}`;
}

export function buildBookingEmailBody(details: BookingLinkDetails): string {
    const lines = [
        `Please pick a time that works for you using this link:`,
        ``,
        details.url,
        ``,
        `It was created for ticket #${details.ticketId} and expires${details.expiresAt ? ` on ${details.expiresAt}` : " soon"} — reply to this message if it stops working.`,
    ];
    return lines.join("\n");
}

/** Short single-message variant for SMS (same link, less prose). */
export function buildBookingSmsBody(details: BookingLinkDetails): string {
    return (
        `Book your appointment for ticket #${details.ticketId}: ${details.url}` +
        (details.expiresAt ? ` (expires ${details.expiresAt})` : "")
    );
}

export function buildMailtoHref(args: {
    to?: string | null;
    subject: string;
    body: string;
}): string {
    const params = new URLSearchParams({ subject: args.subject, body: args.body });
    return `mailto:${args.to ?? ""}?${params}`;
}

export function buildSmsHref(args: { to?: string | null; body: string }): string {
    const params = new URLSearchParams({ body: args.body });
    return `sms:${args.to ?? ""}?${params}`;
}

/**
 * Default channel from what we know about the recipient: email wins (works on
 * every dispatcher desktop), else SMS, else email anyway — a recipientless
 * `mailto:` still opens a compose window with subject/body prefilled, while a
 * bare `sms:` link is a no-op on most desktops.
 */
export function selectBookingSendChannel(contact: BookingContact = {}): BookingSendChannel {
    if (contact.email) return "mailto";
    if (contact.phone) return "sms";
    return "mailto";
}

export interface BookingSendTarget {
    channel: BookingSendChannel;
    href: string;
}

/**
 * Resolve the deep-link target for a send: explicit dispatcher choice wins,
 * otherwise fall back to the contact-based default. Recipient comes from the
 * contact when present, else the link is recipientless (dispatcher addresses
 * it in their mail/SMS app).
 */
export function resolveBookingSendTarget(args: {
    details: BookingLinkDetails;
    contact?: BookingContact;
    preferred?: BookingSendChannel;
}): BookingSendTarget {
    const channel = args.preferred ?? selectBookingSendChannel(args.contact);
    if (channel === "sms") {
        return {
            channel,
            href: buildSmsHref({
                to: args.contact?.phone,
                body: buildBookingSmsBody(args.details),
            }),
        };
    }
    return {
        channel,
        href: buildMailtoHref({
            to: args.contact?.email,
            subject: buildBookingEmailSubject(args.details.ticketId),
            body: buildBookingEmailBody(args.details),
        }),
    };
}

export interface FreshBookingLink {
    token: string;
    oldInvalidated: boolean;
}

export interface SendBookingLinkArgs {
    ticketId: number;
    channel: BookingSendChannel;
    origin: string;
    contact?: BookingContact;
    expiresAt?: string | null;
    /** Mint a fresh link (tokens are single-capability and not retrievable). */
    mintFresh: () => Promise<FreshBookingLink>;
    /** Deep-link opener (window.location assignment in the UI). */
    open: (href: string) => void;
}

/**
 * Send orchestration: mint a fresh link (the stored summary carries only the
 * rid, never the token, so sends are always resend-as-new), resolve the deep
 * link, and open it. Throws when minting fails; callers toast the outcome.
 */
export async function sendBookingLink(args: SendBookingLinkArgs): Promise<FreshBookingLink> {
    const fresh = await args.mintFresh();
    const target = resolveBookingSendTarget({
        details: {
            ticketId: args.ticketId,
            url: buildBookingUrl(args.origin, fresh.token),
            expiresAt: args.expiresAt,
        },
        contact: args.contact,
        preferred: args.channel,
    });
    args.open(target.href);
    return fresh;
}
