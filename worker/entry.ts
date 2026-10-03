/**
 * Booking-link Worker BFF slices 1-3: mint + status + cancel + list
 * (dispatcher tracking) and public customer booking (slots + book via
 * capability token).
 *
 * The same Worker also serves the SPA as static assets (see
 * `cloudflare.config.ts`: `runWorkerFirst: ["/api/book/*"]`), so this router
 * only handles `/api/book/*` and answers 404 JSON for anything else.
 *
 * Public endpoints take the booking-link token as `Authorization: Bearer`,
 * `?token=`, or (book only) a `token` JSON body field. The token is verified
 * by signature on every request; its `rid` must match the URL rid.
 */

import { signBookingToken, verifyBookingToken } from "./token";
import {
    BOOKING_REQUEST_TTL_SECONDS,
    BookingStateError,
    createBookingRequest,
    getBookingRequest,
    listBookingRequests,
    markBookingBooked,
    markBookingClicked,
    openTokenPair,
    sealTokenPair,
    setBookingStatus,
    updateSealedTokens,
} from "./kv";
import type { BookingRequestRecord, HaloTokenPair, KeyValueClient } from "./kv";
import { createHaloClient, HaloApiError } from "./halo";
import type { HaloClient, WorkerAppointment } from "./halo";
import {
    ALLOWED_SLOT_DURATIONS,
    bookingWindowIso,
    computeSlots,
    DEFAULT_SLOT_DAYS,
    DEFAULT_SLOT_DURATION_MIN,
    parseHaloDateMs,
    validateSlot,
} from "./slots";
import type { SlotBusyBlock } from "./slots";
import { checkPublicRateLimit } from "./ratelimit";

export interface BookingEnv {
    /** HMAC/AES secret (Worker secret, never logged or returned). */
    SECRET: string;
    BOOKING_REQUESTS: KeyValueClient;
    /**
     * Halo tenant wiring for Worker-side calls (slots availability, booking).
     * Deployment-owned; when absent the public booking endpoints answer 503.
     */
    HALO_RESOURCE_SERVER?: string;
    HALO_AUTH_SERVER?: string;
    HALO_CLIENT_ID?: string;
}

export interface MintRequest {
    ticketId: number;
    agentIds: number[];
    appointmentTypeId: number;
    haloTokenPair: HaloTokenPair;
}

export type MintValidation =
    { ok: true; value: MintRequest } | { ok: false; error: string; details?: string[] };

function isPositiveInt(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isTokenPair(value: unknown): value is HaloTokenPair {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const pair = value as Record<string, unknown>;
    return (
        typeof pair.access_token === "string" &&
        pair.access_token.length > 0 &&
        typeof pair.refresh_token === "string" &&
        pair.refresh_token.length > 0
    );
}

/** Pure validation for the mint body; every failure lists a 400 detail. */
export function validateMintRequest(body: unknown): MintValidation {
    if (typeof body !== "object" || body === null) {
        return { ok: false, error: "Request body must be a JSON object" };
    }
    const details: string[] = [];
    const candidate = body as Record<string, unknown>;

    if (!isPositiveInt(candidate.ticketId)) {
        details.push("ticketId must be a positive integer");
    }
    if (
        !Array.isArray(candidate.agentIds) ||
        candidate.agentIds.length === 0 ||
        !candidate.agentIds.every(isPositiveInt)
    ) {
        details.push("agentIds must be a non-empty array of positive integers");
    }
    if (!isPositiveInt(candidate.appointmentTypeId)) {
        details.push("appointmentTypeId must be a positive integer");
    }
    if (!isTokenPair(candidate.haloTokenPair)) {
        details.push("haloTokenPair must include non-empty access_token and refresh_token");
    }
    if (details.length > 0) {
        return { ok: false, error: "Invalid booking request", details };
    }
    return {
        ok: true,
        value: {
            ticketId: candidate.ticketId as number,
            agentIds: candidate.agentIds as number[],
            appointmentTypeId: candidate.appointmentTypeId as number,
            haloTokenPair: candidate.haloTokenPair as HaloTokenPair,
        },
    };
}

function json(status: number, body: unknown): Response {
    return Response.json(body, { status });
}

function bearerToken(request: Request): string | null {
    const header = request.headers.get("authorization");
    if (!header) {
        return null;
    }
    const match = /^Bearer (.+)$/.exec(header.trim());
    return match ? match[1] : null;
}

/** Constant-time string compare so bearer checks don't leak via timing. */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
        return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

/**
 * Dispatcher auth for status/cancel: the caller proves dispatchership by
 * presenting the same Halo access token that was sealed at mint time.
 */
async function isDispatcherAuthorized(
    request: Request,
    record: BookingRequestRecord,
    secret: string,
): Promise<boolean> {
    const bearer = bearerToken(request);
    if (!bearer) {
        return false;
    }
    let pair: HaloTokenPair;
    try {
        pair = await openTokenPair(record.sealedTokens, secret);
    } catch {
        return false;
    }
    return timingSafeEqual(bearer, pair.access_token);
}

function publicStatus(record: BookingRequestRecord): Record<string, unknown> {
    return {
        rid: record.rid,
        status: record.status,
        ticketId: record.ticketId,
        agentIds: record.agentIds,
        appointmentTypeId: record.appointmentTypeId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        exp: record.exp,
        // Nulls (never undefined) so dispatcher clients can rely on the keys.
        clickedAt: record.clickedAt ?? null,
        bookedAppointmentId: record.bookedAppointmentId ?? null,
    };
}

/**
 * Read-time expiry for dispatcher reads: a pending record past `exp` is
 * presented (and best-effort persisted) as expired, matching the public
 * gate's semantics. Terminal records pass through untouched.
 */
async function withReadTimeExpiry(
    kv: KeyValueClient,
    record: BookingRequestRecord,
): Promise<BookingRequestRecord> {
    if (record.status !== "pending" || record.exp > Math.floor(Date.now() / 1000)) {
        return record;
    }
    try {
        return await setBookingStatus(kv, record.rid, "expired");
    } catch {
        return { ...record, status: "expired" };
    }
}

async function handleMint(request: Request, env: BookingEnv): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return json(400, { error: "Request body must be valid JSON" });
    }
    const validation = validateMintRequest(body);
    if (!validation.ok) {
        return json(400, { error: validation.error, details: validation.details });
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = nowSec + BOOKING_REQUEST_TTL_SECONDS;
    const rid = globalThis.crypto.randomUUID();
    const sealedTokens = await sealTokenPair(validation.value.haloTokenPair, env.SECRET);
    const record = await createBookingRequest(env.BOOKING_REQUESTS, {
        rid,
        ticketId: validation.value.ticketId,
        agentIds: validation.value.agentIds,
        appointmentTypeId: validation.value.appointmentTypeId,
        sealedTokens,
        exp,
    });
    const token = await signBookingToken(
        {
            rid,
            ticketId: record.ticketId,
            agentIds: record.agentIds,
            appointmentTypeId: record.appointmentTypeId,
            exp,
        },
        env.SECRET,
    );
    return json(201, { rid, token, expiresAt: new Date(exp * 1000).toISOString() });
}

async function handleStatus(request: Request, env: BookingEnv, rid: string): Promise<Response> {
    const record = await getBookingRequest(env.BOOKING_REQUESTS, rid);
    if (!record) {
        return json(404, { error: "Booking request not found" });
    }
    if (!(await isDispatcherAuthorized(request, record, env.SECRET))) {
        return json(401, { error: "Unauthorized" });
    }
    return json(200, publicStatus(await withReadTimeExpiry(env.BOOKING_REQUESTS, record)));
}

/**
 * Dispatcher tracking list: every request the caller minted (proved per
 * record by the sealed Halo access token, same as status/cancel), newest
 * first. Unopenable rows (sealed under a rotated secret) are skipped.
 */
async function handleList(request: Request, env: BookingEnv): Promise<Response> {
    const bearer = bearerToken(request);
    if (!bearer) {
        return json(401, { error: "Unauthorized" });
    }
    const records = await listBookingRequests(env.BOOKING_REQUESTS);
    const mine: Record<string, unknown>[] = [];
    for (const record of records) {
        let pair: HaloTokenPair;
        try {
            pair = await openTokenPair(record.sealedTokens, env.SECRET);
        } catch {
            continue;
        }
        if (!timingSafeEqual(bearer, pair.access_token)) {
            continue;
        }
        mine.push(publicStatus(await withReadTimeExpiry(env.BOOKING_REQUESTS, record)));
    }
    return json(200, { requests: mine });
}

async function handleCancel(request: Request, env: BookingEnv, rid: string): Promise<Response> {
    const record = await getBookingRequest(env.BOOKING_REQUESTS, rid);
    if (!record) {
        return json(404, { error: "Booking request not found" });
    }
    if (!(await isDispatcherAuthorized(request, record, env.SECRET))) {
        return json(401, { error: "Unauthorized" });
    }
    try {
        const updated = await setBookingStatus(env.BOOKING_REQUESTS, rid, "cancelled");
        return json(200, publicStatus(updated));
    } catch (error) {
        if (error instanceof BookingStateError && error.code === "illegal-transition") {
            return json(409, {
                error: "Booking request is already final",
                ...publicStatus(record),
            });
        }
        throw error;
    }
}

const REQUEST_ROUTE = /^\/api\/book\/requests\/([^/]+)\/(status|cancel|slots|book)$/;

/** Best-effort client IP for rate limiting (Cloudflare-aware). */
function clientIp(request: Request): string {
    const direct = request.headers.get("cf-connecting-ip");
    if (direct && direct.trim()) {
        return direct.trim();
    }
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded && forwarded.trim()) {
        return forwarded.split(",")[0].trim() || "unknown";
    }
    return "unknown";
}

async function publicRateLimit(request: Request, env: BookingEnv): Promise<Response | null> {
    const { allowed } = await checkPublicRateLimit(env.BOOKING_REQUESTS, clientIp(request));
    return allowed ? null : json(429, { error: "rate-limited" });
}

function capabilityToken(request: Request, url: URL, bodyToken?: unknown): string | null {
    return (
        bearerToken(request) ??
        url.searchParams.get("token") ??
        (typeof bodyToken === "string" && bodyToken ? bodyToken : null)
    );
}

function haloClient(env: BookingEnv): HaloClient | null {
    if (!env.HALO_RESOURCE_SERVER || !env.HALO_AUTH_SERVER || !env.HALO_CLIENT_ID) {
        return null;
    }
    return createHaloClient({
        fetchImpl: (input, init) => fetch(input, init),
        resourceServer: env.HALO_RESOURCE_SERVER,
        authServer: env.HALO_AUTH_SERVER,
        clientId: env.HALO_CLIENT_ID,
    });
}

type BookingContext =
    { ok: true; record: BookingRequestRecord } | { ok: false; response: Response };

/**
 * Shared public gate: rate limit, capability-token verification, rid match,
 * record lookup, expiry, and status. Expiry flips pending records to
 * `expired` (best-effort) so replays stay expired after KV TTL drift.
 */
async function resolvePublicBooking(
    request: Request,
    env: BookingEnv,
    url: URL,
    rid: string,
    bodyToken?: unknown,
): Promise<BookingContext> {
    const limited = await publicRateLimit(request, env);
    if (limited) {
        return { ok: false, response: limited };
    }
    const token = capabilityToken(request, url, bodyToken);
    if (!token) {
        return { ok: false, response: json(401, { error: "invalid-token" }) };
    }
    const verified = await verifyBookingToken(token, env.SECRET);
    if (!verified.ok) {
        if (verified.reason === "expired") {
            await setBookingStatus(env.BOOKING_REQUESTS, rid, "expired").catch(() => undefined);
            return { ok: false, response: json(410, { error: "expired", rid }) };
        }
        return { ok: false, response: json(401, { error: "invalid-token" }) };
    }
    if (verified.payload.rid !== rid) {
        return { ok: false, response: json(401, { error: "invalid-token" }) };
    }
    const record = await getBookingRequest(env.BOOKING_REQUESTS, rid);
    if (!record) {
        return { ok: false, response: json(404, { error: "Booking request not found" }) };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (record.exp <= nowSec && record.status === "pending") {
        await setBookingStatus(env.BOOKING_REQUESTS, rid, "expired").catch(() => undefined);
        return { ok: false, response: json(410, { error: "expired", rid }) };
    }
    if (record.status === "cancelled") {
        return { ok: false, response: json(410, { error: "cancelled", rid }) };
    }
    if (record.status === "expired") {
        return { ok: false, response: json(410, { error: "expired", rid }) };
    }
    if (record.status === "booked") {
        return {
            ok: false,
            response: json(409, {
                error: "already-booked",
                rid,
                appointmentId: record.bookedAppointmentId ?? null,
            }),
        };
    }
    return { ok: true, record };
}

/**
 * Run one Halo call with the sealed dispatcher pair, refreshing once on 401
 * and resealing the refreshed pair back to KV.
 */
async function withRefreshedHalo<T>(
    env: BookingEnv,
    rid: string,
    client: HaloClient,
    call: (accessToken: string) => Promise<T>,
): Promise<T> {
    const record = await getBookingRequest(env.BOOKING_REQUESTS, rid);
    if (!record) {
        throw new HaloApiError(404, "Booking request not found");
    }
    let pair = await openTokenPair(record.sealedTokens, env.SECRET);
    try {
        return await call(pair.access_token);
    } catch (error) {
        if (!(error instanceof HaloApiError) || error.status !== 401) {
            throw error;
        }
        pair = await client.refreshTokenPair(pair);
        await updateSealedTokens(env.BOOKING_REQUESTS, rid, await sealTokenPair(pair, env.SECRET));
        return call(pair.access_token);
    }
}

function toBusyBlocks(appointments: WorkerAppointment[]): SlotBusyBlock[] {
    const blocks: SlotBusyBlock[] = [];
    for (const apt of appointments) {
        const startMs = parseHaloDateMs(apt.start_date);
        const endMs = parseHaloDateMs(apt.end_date);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
            continue;
        }
        blocks.push({ agentId: apt.agent_id, startMs, endMs, allDay: apt.allday });
    }
    return blocks;
}

function parseIntParam(value: string | null, fallback: number): number | null {
    if (value === null || value === "") {
        return fallback;
    }
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
}

async function handleSlots(
    request: Request,
    env: BookingEnv,
    url: URL,
    rid: string,
): Promise<Response> {
    const context = await resolvePublicBooking(request, env, url, rid);
    if (!context.ok) {
        return context.response;
    }
    const days = parseIntParam(url.searchParams.get("days"), DEFAULT_SLOT_DAYS);
    const durationMin = parseIntParam(
        url.searchParams.get("durationMin"),
        DEFAULT_SLOT_DURATION_MIN,
    );
    const utcOffsetMin = parseIntParam(url.searchParams.get("utcOffset"), 0);
    if (
        days === null ||
        days < 1 ||
        days > 30 ||
        durationMin === null ||
        !(ALLOWED_SLOT_DURATIONS as readonly number[]).includes(durationMin) ||
        utcOffsetMin === null ||
        utcOffsetMin < -840 ||
        utcOffsetMin > 840
    ) {
        return json(400, { error: "invalid-request" });
    }
    const client = haloClient(env);
    if (!client) {
        return json(503, { error: "booking-unavailable" });
    }

    // Claim-on-load: the first validated view flips sent -> clicked.
    const { firstView } = await markBookingClicked(env.BOOKING_REQUESTS, rid);

    const nowMs = Date.now();
    const window = bookingWindowIso(nowMs, utcOffsetMin, days);
    let appointments: WorkerAppointment[];
    try {
        appointments = await withRefreshedHalo(env, rid, client, (accessToken) =>
            client.getAppointments(accessToken, {
                startDate: window.startDate,
                endDate: window.endDate,
                agentIds: context.record.agentIds,
                utcOffset: utcOffsetMin,
            }),
        );
    } catch {
        return json(502, { error: "halo-unavailable" });
    }
    // Agent names are best-effort labels; ids alone still book.
    const names = new Map<number, string>();
    try {
        const agents = await withRefreshedHalo(env, rid, client, (accessToken) =>
            client.getAgents(accessToken),
        );
        for (const agent of agents) {
            names.set(agent.id, agent.name);
        }
    } catch {
        // Fall through with id-only labels.
    }
    const slots = computeSlots({
        agentIds: context.record.agentIds,
        busy: toBusyBlocks(appointments),
        nowMs,
        utcOffsetMin,
        days,
        durationMin,
    });
    return json(200, {
        rid,
        ticketId: context.record.ticketId,
        appointmentTypeId: context.record.appointmentTypeId,
        expiresAt: new Date(context.record.exp * 1000).toISOString(),
        firstView,
        agents: context.record.agentIds.map((id) => ({ id, name: names.get(id) ?? null })),
        days: slots,
        durationMin,
        utcOffset: utcOffsetMin,
    });
}

interface BookBody {
    token?: unknown;
    agentId?: unknown;
    start?: unknown;
    end?: unknown;
    utcOffset?: unknown;
}

function parseBookBody(
    body: unknown,
):
    | { ok: true; value: { agentId: number; startMs: number; endMs: number; utcOffsetMin: number } }
    | { ok: false; error: string } {
    if (typeof body !== "object" || body === null) {
        return { ok: false, error: "invalid-request" };
    }
    const candidate = body as BookBody;
    if (typeof candidate.agentId !== "number" || !Number.isInteger(candidate.agentId)) {
        return { ok: false, error: "invalid-request" };
    }
    if (typeof candidate.start !== "string" || typeof candidate.end !== "string") {
        return { ok: false, error: "invalid-request" };
    }
    const startMs = Date.parse(candidate.start);
    const endMs = Date.parse(candidate.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return { ok: false, error: "invalid-slot" };
    }
    const durationMin = Math.round((endMs - startMs) / 60_000);
    if (durationMin < 15 || durationMin > 480 || durationMin % 15 !== 0) {
        return { ok: false, error: "invalid-slot" };
    }
    const utcOffsetMin = candidate.utcOffset === undefined ? 0 : candidate.utcOffset;
    if (
        typeof utcOffsetMin !== "number" ||
        !Number.isInteger(utcOffsetMin) ||
        utcOffsetMin < -840 ||
        utcOffsetMin > 840
    ) {
        return { ok: false, error: "invalid-request" };
    }
    return { ok: true, value: { agentId: candidate.agentId, startMs, endMs, utcOffsetMin } };
}

interface TicketContext {
    summary: string;
    clientId: number;
    siteId: number;
    userId: number;
}

/** Minimal ticket projection for the booking appointment; never throws. */
function toTicketContext(body: unknown, ticketId: number): TicketContext {
    const row = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const numberOr = (value: unknown, fallback: number): number =>
        typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return {
        summary:
            typeof row.summary === "string" && row.summary.trim()
                ? row.summary
                : `Ticket ${ticketId}`,
        clientId: numberOr(row.client_id, 0),
        siteId: numberOr(row.site_id, 0),
        userId: numberOr(row.user_id, 0),
    };
}

async function handleBook(
    request: Request,
    env: BookingEnv,
    url: URL,
    rid: string,
): Promise<Response> {
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return json(400, { error: "invalid-request" });
    }
    const context = await resolvePublicBooking(
        request,
        env,
        url,
        rid,
        (body as BookBody | null)?.token,
    );
    if (!context.ok) {
        return context.response;
    }
    const parsed = parseBookBody(body);
    if (!parsed.ok) {
        return json(400, { error: parsed.error });
    }
    if (!context.record.agentIds.includes(parsed.value.agentId)) {
        return json(400, { error: "invalid-slot" });
    }
    const client = haloClient(env);
    if (!client) {
        return json(503, { error: "booking-unavailable" });
    }

    // Re-check the chosen slot against live appointments: the slot grid may
    // have moved since the customer loaded the picker.
    const nowMs = Date.now();
    let appointments: WorkerAppointment[];
    try {
        appointments = await withRefreshedHalo(env, rid, client, (accessToken) =>
            client.getAppointments(accessToken, {
                startDate: new Date(parsed.value.startMs - 24 * 60 * 60 * 1000).toISOString(),
                endDate: new Date(parsed.value.endMs + 24 * 60 * 60 * 1000).toISOString(),
                agentIds: context.record.agentIds,
            }),
        );
    } catch {
        return json(502, { error: "halo-unavailable" });
    }
    const check = validateSlot({
        busy: toBusyBlocks(appointments),
        nowMs,
        utcOffsetMin: parsed.value.utcOffsetMin,
        agentId: parsed.value.agentId,
        startMs: parsed.value.startMs,
        endMs: parsed.value.endMs,
    });
    if (!check.ok) {
        return check.reason === "taken"
            ? json(409, { error: "slot-taken", rid })
            : json(400, { error: "invalid-slot", rid });
    }

    let ticket: TicketContext;
    try {
        const ticketBody = await withRefreshedHalo(env, rid, client, (accessToken) =>
            client.getTicket(accessToken, context.record.ticketId),
        );
        ticket = toTicketContext(ticketBody, context.record.ticketId);
    } catch {
        return json(502, { error: "halo-unavailable" });
    }

    // Appointment payload mirrors the dispatcher flow (TriageDispatchModal):
    // same event/status/location defaults, ticket-linked. NOTE: no ticket
    // note/action write — the repo's CreateTicketPayload documents no
    // action/note field, so slice 2 books the appointment only (fallback).
    let appointmentId: number;
    try {
        appointmentId = await withRefreshedHalo(env, rid, client, (accessToken) =>
            client.createAppointment(accessToken, {
                start_date: new Date(parsed.value.startMs).toISOString(),
                end_date: new Date(parsed.value.endMs).toISOString(),
                event_type: "a",
                appointment_type_id: context.record.appointmentTypeId,
                reminderminutes: 15,
                agent_status: 1,
                open_appointment_status: 0,
                appointment_location: 0,
                subject: ticket.summary,
                ticket_id: context.record.ticketId,
                note_html: "<p>Customer self-booking via dispatch portal.</p>",
                agent_id: parsed.value.agentId,
                attendees: "",
                client_id: ticket.clientId,
                site_id: ticket.siteId,
                user_id: ticket.userId,
            }),
        );
    } catch {
        return json(502, { error: "halo-unavailable" });
    }

    try {
        await markBookingBooked(env.BOOKING_REQUESTS, rid, appointmentId);
    } catch (error) {
        // Lost a concurrent redeem race: the appointment exists, but the
        // record already flipped. Answer replay semantics, no duplicate.
        if (error instanceof BookingStateError && error.code === "illegal-transition") {
            const current = await getBookingRequest(env.BOOKING_REQUESTS, rid);
            return json(409, {
                error: "already-booked",
                rid,
                appointmentId: current?.bookedAppointmentId ?? null,
            });
        }
        throw error;
    }
    return json(201, {
        rid,
        appointmentId,
        agentId: parsed.value.agentId,
        start: new Date(parsed.value.startMs).toISOString(),
        end: new Date(parsed.value.endMs).toISOString(),
    });
}

export default {
    async fetch(request: Request, env: BookingEnv): Promise<Response> {
        if (!env.SECRET) {
            return json(500, { error: "Server misconfigured" });
        }
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname === "/api/book/requests") {
            const limited = await publicRateLimit(request, env);
            if (limited) {
                return limited;
            }
            return handleMint(request, env);
        }
        if (request.method === "GET" && url.pathname === "/api/book/requests") {
            return handleList(request, env);
        }
        const match = REQUEST_ROUTE.exec(url.pathname);
        if (match) {
            const [, rid, action] = match;
            if (request.method === "GET" && action === "status") {
                return handleStatus(request, env, rid);
            }
            if (request.method === "POST" && action === "cancel") {
                return handleCancel(request, env, rid);
            }
            if (request.method === "GET" && action === "slots") {
                return handleSlots(request, env, url, rid);
            }
            if (request.method === "POST" && action === "book") {
                return handleBook(request, env, url, rid);
            }
        }
        return json(404, { error: "Not found" });
    },
};
