// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { validateExtendRequest, type BookingEnv } from "../entry";
import {
    appendAuditEvent,
    bookingAuditKey,
    BOOKING_EXTEND_DEFAULT_DAYS,
    createBookingRequest,
    extendBookingExpiry,
    getBookingRequest,
    listAuditEvents,
    MAX_AUDIT_EVENTS,
    sealTokenPair,
    setBookingStatus,
    type BookingAuditEvent,
    type HaloTokenPair,
} from "../kv";
import { resetRateLimitsForTests } from "../ratelimit";
import { verifyBookingToken } from "../token";
import { fakeKv } from "./fake-kv";

const SECRET = "test-secret-for-lifecycle";
const RESOURCE = "https://halo.test";
const AUTH = "https://auth.test";

const PAIR: HaloTokenPair = {
    access_token: "dispatcher-access",
    refresh_token: "dispatcher-refresh",
};
const AUTH_HEADER = { Authorization: `Bearer ${PAIR.access_token}` };

function env(): BookingEnv {
    return {
        SECRET,
        BOOKING_REQUESTS: fakeKv(),
        HALO_RESOURCE_SERVER: RESOURCE,
        HALO_AUTH_SERVER: AUTH,
        HALO_CLIENT_ID: "client-1",
    };
}

let ipCounter = 0;
function freshIp(): string {
    ipCounter += 1;
    return `10.11.0.${ipCounter}`;
}

function stubHalo() {
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method === "POST" && url === `${AUTH}/token`) {
            return Response.json({ access_token: "refreshed-access", expires_in: 3600 });
        }
        if (method === "POST" && url === `${RESOURCE}/api/appointment`) {
            return Response.json([{ id: 555 }]);
        }
        if (url.includes("/api/agent")) {
            return Response.json([]);
        }
        if (url.includes("/api/Tickets/")) {
            return Response.json({
                id: 42,
                summary: "Printer down",
                client_id: 100,
                site_id: 200,
                user_id: 300,
            });
        }
        if (url.includes("/api/Appointment") || url.includes("/api/appointment")) {
            return Response.json([]);
        }
        return new Response("unexpected halo call", { status: 500 });
    });
}

beforeEach(() => {
    resetRateLimitsForTests();
});

afterEach(() => {
    vi.unstubAllGlobals();
    resetRateLimitsForTests();
});

async function mint(testEnv: BookingEnv): Promise<{ rid: string; token: string; exp: number }> {
    const response = await worker.fetch(
        new Request("https://portal.test/api/book/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json", "cf-connecting-ip": freshIp() },
            body: JSON.stringify({
                ticketId: 42,
                agentIds: [7, 9],
                appointmentTypeId: 3,
                haloTokenPair: { ...PAIR },
            }),
        }),
        testEnv,
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { rid: string; token: string; expiresAt: string };
    const verified = await verifyBookingToken(body.token, SECRET);
    expect(verified.ok).toBe(true);
    return {
        rid: body.rid,
        token: body.token,
        exp: verified.ok ? verified.payload.exp : 0,
    };
}

async function dispatcherFetch(
    testEnv: BookingEnv,
    path: string,
    init: RequestInit = {},
    authed = true,
): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers = new Headers(init.headers);
    headers.set("cf-connecting-ip", freshIp());
    if (authed) {
        headers.set("Authorization", `Bearer ${PAIR.access_token}`);
    }
    const response = await worker.fetch(
        new Request(`https://portal.test${path}`, { ...init, headers }),
        testEnv,
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

async function seedPending(
    testEnv: BookingEnv,
    rid: string,
    overrides: { exp?: number } = {},
): Promise<void> {
    await createBookingRequest(testEnv.BOOKING_REQUESTS, {
        rid,
        ticketId: 42,
        agentIds: [7],
        appointmentTypeId: 3,
        sealedTokens: await sealTokenPair(PAIR, SECRET),
        exp: overrides.exp ?? Math.floor(Date.now() / 1000) + 3600,
    });
}

describe("audit trail KV helpers", () => {
    it("appends oldest-first and reads back details", async () => {
        const kv = fakeKv();
        await appendAuditEvent(kv, "rid-1", "view", new Date("2026-10-03T10:00:00Z"));
        await appendAuditEvent(kv, "rid-1", "book", new Date("2026-10-03T11:00:00Z"), "555");
        const events = await listAuditEvents(kv, "rid-1");
        expect(events).toEqual([
            { type: "view", at: "2026-10-03T10:00:00.000Z" },
            { type: "book", at: "2026-10-03T11:00:00.000Z", detail: "555" },
        ]);
        expect(bookingAuditKey("rid-1")).toBe("book:audit:rid-1");
    });

    it("reads empty for unknown rids and corrupt values", async () => {
        const kv = fakeKv();
        await expect(listAuditEvents(kv, "missing")).resolves.toEqual([]);
        await kv.put(bookingAuditKey("rid-bad"), "{not json");
        await expect(listAuditEvents(kv, "rid-bad")).resolves.toEqual([]);
        // A corrupt trail resets instead of failing the next append.
        await appendAuditEvent(kv, "rid-bad", "view");
        const events = await listAuditEvents(kv, "rid-bad");
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe("view");
    });

    it("drops malformed entries when reading", async () => {
        const kv = fakeKv();
        await kv.put(
            bookingAuditKey("rid-mixed"),
            JSON.stringify([
                { type: "view", at: "2026-10-03T10:00:00.000Z" },
                null,
                { type: "view" },
                { nope: true },
            ]),
        );
        await expect(listAuditEvents(kv, "rid-mixed")).resolves.toEqual([
            { type: "view", at: "2026-10-03T10:00:00.000Z" },
        ]);
    });

    it("caps the trail so hot links stay bounded", async () => {
        const kv = fakeKv();
        for (let i = 0; i < MAX_AUDIT_EVENTS + 2; i++) {
            await appendAuditEvent(kv, "rid-hot", "view", new Date(), `v${i}`);
        }
        const events = await listAuditEvents(kv, "rid-hot");
        expect(events).toHaveLength(MAX_AUDIT_EVENTS);
        expect(events[0]).toMatchObject({ detail: "v2" });
        expect(events[events.length - 1]).toMatchObject({ detail: `v${MAX_AUDIT_EVENTS + 1}` });
    });
});

describe("extendBookingExpiry", () => {
    it("renews exp and touches updatedAt without changing status", async () => {
        const kv = fakeKv();
        await createBookingRequest(kv, {
            rid: "rid-ext",
            ticketId: 1,
            agentIds: [1],
            appointmentTypeId: 1,
            sealedTokens: await sealTokenPair(PAIR, SECRET),
            exp: 1_700_000_000,
        });
        const before = (await getBookingRequest(kv, "rid-ext"))?.updatedAt;
        const updated = await extendBookingExpiry(
            kv,
            "rid-ext",
            1_800_000_000,
            new Date("2026-10-04T00:00:00Z"),
        );
        expect(updated.exp).toBe(1_800_000_000);
        expect(updated.status).toBe("pending");
        expect(updated.updatedAt).not.toBe(before);
        await expect(getBookingRequest(kv, "rid-ext")).resolves.toMatchObject({
            exp: 1_800_000_000,
        });
    });

    it("refuses terminal records and unknown rids", async () => {
        const kv = fakeKv();
        await createBookingRequest(kv, {
            rid: "rid-final",
            ticketId: 1,
            agentIds: [1],
            appointmentTypeId: 1,
            sealedTokens: await sealTokenPair(PAIR, SECRET),
            exp: 1_800_000_000,
        });
        await setBookingStatus(kv, "rid-final", "cancelled");
        await expect(extendBookingExpiry(kv, "rid-final", 1_900_000_000)).rejects.toMatchObject({
            code: "illegal-transition",
        });
        await expect(extendBookingExpiry(kv, "missing", 1_900_000_000)).rejects.toMatchObject({
            code: "not-found",
        });
    });
});

describe("validateExtendRequest", () => {
    it("defaults an omitted body to a full TTL", () => {
        for (const body of [undefined, null, "", {}]) {
            expect(validateExtendRequest(body)).toEqual({
                ok: true,
                days: BOOKING_EXTEND_DEFAULT_DAYS,
            });
        }
        expect(validateExtendRequest({ days: 3 })).toEqual({ ok: true, days: 3 });
    });

    it("rejects out-of-range days with a detail", () => {
        for (const days of [0, 31, 1.5, "7", Number.NaN, null]) {
            const result = validateExtendRequest({ days });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.details).toEqual(["days must be an integer between 1 and 30"]);
            }
        }
        expect(validateExtendRequest("nope").ok).toBe(false);
    });
});

describe("extend endpoint", () => {
    it("reseals the token with a fresh exp and renews the record", async () => {
        const testEnv = env();
        const { rid, exp: oldExp } = await mint(testEnv);
        const beforeSec = Math.floor(Date.now() / 1000);

        const { status, json } = await dispatcherFetch(
            testEnv,
            `/api/book/requests/${rid}/extend`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ days: 14 }),
            },
        );
        expect(status).toBe(200);
        expect(json.rid).toBe(rid);
        expect(typeof json.token).toBe("string");
        expect(typeof json.expiresAt).toBe("string");

        const verified = await verifyBookingToken(String(json.token), SECRET);
        expect(verified).toEqual({
            ok: true,
            payload: {
                rid,
                ticketId: 42,
                agentIds: [7, 9],
                appointmentTypeId: 3,
                exp: expect.any(Number),
            },
        });
        const newExp = verified.ok ? verified.payload.exp : 0;
        expect(newExp).toBeGreaterThan(oldExp);
        expect(newExp).toBeGreaterThanOrEqual(beforeSec + 14 * 24 * 60 * 60);
        expect(newExp).toBeLessThanOrEqual(beforeSec + 14 * 24 * 60 * 60 + 30);
        expect(json.expiresAt).toBe(new Date(newExp * 1000).toISOString());

        await expect(getBookingRequest(testEnv.BOOKING_REQUESTS, rid)).resolves.toMatchObject({
            exp: newExp,
            status: "pending",
        });
        // The dispatcher read agrees on the renewed expiry.
        const reread = await dispatcherFetch(testEnv, `/api/book/requests/${rid}/status`);
        expect(reread.json).toMatchObject({ exp: newExp });
    });

    it("serves the resealed link end to end through slots", async () => {
        const testEnv = env();
        stubHalo();
        const { rid } = await mint(testEnv);
        const { json } = await dispatcherFetch(testEnv, `/api/book/requests/${rid}/extend`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        const slots = await worker.fetch(
            new Request(
                `https://portal.test/api/book/requests/${rid}/slots?token=${encodeURIComponent(String(json.token))}`,
                { headers: { "cf-connecting-ip": freshIp() } },
            ),
            testEnv,
        );
        expect(slots.status).toBe(200);
    });

    it("defaults an empty body to a full TTL", async () => {
        const testEnv = env();
        // Seed a short-lived record so the default renewal is strictly later
        // even when mint and extend land in the same second.
        await seedPending(testEnv, "rid-short", { exp: Math.floor(Date.now() / 1000) + 3600 });
        const beforeSec = Math.floor(Date.now() / 1000);
        const { status, json } = await dispatcherFetch(
            testEnv,
            "/api/book/requests/rid-short/extend",
            { method: "POST" },
        );
        expect(status).toBe(200);
        const verified = await verifyBookingToken(String(json.token), SECRET);
        const newExp = verified.ok ? verified.payload.exp : 0;
        expect(newExp).toBeGreaterThan(beforeSec + 3600);
        expect(newExp).toBeGreaterThanOrEqual(beforeSec + 7 * 24 * 60 * 60);
        expect(newExp).toBeLessThanOrEqual(beforeSec + 7 * 24 * 60 * 60 + 30);
    });

    it("requires the minting dispatcher's Bearer [REDACTED] 404s unknown rids", async () => {
        const testEnv = env();
        const { rid } = await mint(testEnv);
        const url = `/api/book/requests/${rid}/extend`;

        expect((await dispatcherFetch(testEnv, url, { method: "POST" }, false)).status).toBe(401);

        const headers = new Headers({ "cf-connecting-ip": freshIp() });
        headers.set("Authorization", "Bearer [REDACTED]");
        const wrong = await worker.fetch(
            new Request(`https://portal.test${url}`, { method: "POST", headers }),
            testEnv,
        );
        expect(wrong.status).toBe(401);

        expect(
            (await dispatcherFetch(testEnv, "/api/book/requests/nope/extend", { method: "POST" }))
                .status,
        ).toBe(404);
    });

    it("returns 400 for bad days and invalid JSON", async () => {
        const testEnv = env();
        const { rid } = await mint(testEnv);
        for (const days of [0, 31, 1.5, "7"]) {
            const { status, json } = await dispatcherFetch(
                testEnv,
                `/api/book/requests/${rid}/extend`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ days }),
                },
            );
            expect(status).toBe(400);
            expect(json.error).toBe("Invalid extend request");
        }
        const headers = new Headers({
            "Content-Type": "application/json",
            "cf-connecting-ip": freshIp(),
            ...AUTH_HEADER,
        });
        const invalid = await worker.fetch(
            new Request(`https://portal.test/api/book/requests/${rid}/extend`, {
                method: "POST",
                headers,
                body: "{not json",
            }),
            testEnv,
        );
        expect(invalid.status).toBe(400);
    });

    it("answers 409 for terminal records, carrying the current state", async () => {
        const testEnv = env();
        const { rid } = await mint(testEnv);
        const cancelled = await dispatcherFetch(testEnv, `/api/book/requests/${rid}/cancel`, {
            method: "POST",
        });
        expect(cancelled.status).toBe(200);

        const { status, json } = await dispatcherFetch(
            testEnv,
            `/api/book/requests/${rid}/extend`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            },
        );
        expect(status).toBe(409);
        expect(json).toMatchObject({ rid, status: "cancelled" });
    });

    it("flips past-expiry pending records to expired instead of extending", async () => {
        const testEnv = env();
        await seedPending(testEnv, "rid-stale", { exp: Math.floor(Date.now() / 1000) - 10 });
        const { status, json } = await dispatcherFetch(
            testEnv,
            "/api/book/requests/rid-stale/extend",
            { method: "POST" },
        );
        expect(status).toBe(409);
        expect(json).toMatchObject({ rid: "rid-stale", status: "expired" });
        await expect(
            getBookingRequest(testEnv.BOOKING_REQUESTS, "rid-stale"),
        ).resolves.toMatchObject({ status: "expired" });
    });

    it("leaves the old token's shorter expiry intact", async () => {
        const testEnv = env();
        const { rid, token: oldToken, exp: oldExp } = await mint(testEnv);
        const { status } = await dispatcherFetch(testEnv, `/api/book/requests/${rid}/extend`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ days: 30 }),
        });
        expect(status).toBe(200);
        // HMAC tokens cannot be revoked: the old link keeps working until
        // its own shorter expiry, so callers must distribute the resealed one.
        const oldVerified = await verifyBookingToken(oldToken, SECRET);
        expect(oldVerified.ok).toBe(true);
        if (oldVerified.ok) {
            expect(oldVerified.payload.exp).toBe(oldExp);
        }
    });
});

describe("audit listing endpoint", () => {
    it("serves an empty trail for a fresh link", async () => {
        const testEnv = env();
        const { rid } = await mint(testEnv);
        const { status, json } = await dispatcherFetch(testEnv, `/api/book/requests/${rid}/audit`);
        expect(status).toBe(200);
        expect(json).toEqual({ rid, viewCount: 0, events: [] });
    });

    it("requires dispatcher auth and known rids", async () => {
        const testEnv = env();
        const { rid } = await mint(testEnv);
        expect(
            (await dispatcherFetch(testEnv, `/api/book/requests/${rid}/audit`, {}, false)).status,
        ).toBe(401);
        expect((await dispatcherFetch(testEnv, "/api/book/requests/nope/audit")).status).toBe(404);
    });

    it("lists seeded events oldest-first with the view count", async () => {
        const testEnv = env();
        const { rid } = await mint(testEnv);
        const seed: [BookingAuditEvent["type"], string][] = [
            ["view", "2026-10-03T10:00:00Z"],
            ["view", "2026-10-03T11:00:00Z"],
            ["extend", "2026-10-03T12:00:00Z"],
        ];
        for (const [type, at] of seed) {
            await appendAuditEvent(testEnv.BOOKING_REQUESTS, rid, type, new Date(at));
        }
        const { status, json } = await dispatcherFetch(testEnv, `/api/book/requests/${rid}/audit`);
        expect(status).toBe(200);
        expect(json.viewCount).toBe(2);
        expect((json.events as BookingAuditEvent[]).map((event) => event.type)).toEqual([
            "view",
            "view",
            "extend",
        ]);
    });
});

describe("lifecycle audit wiring", () => {
    it("counts every validated slots view and stamps the first click once", async () => {
        const testEnv = env();
        stubHalo();
        const { rid, token } = await mint(testEnv);
        const auth = { ...AUTH_HEADER };

        for (const firstView of [true, false]) {
            const slots = await worker.fetch(
                new Request(
                    `https://portal.test/api/book/requests/${rid}/slots?token=${encodeURIComponent(token)}`,
                    { headers: { "cf-connecting-ip": freshIp() } },
                ),
                testEnv,
            );
            expect(slots.status).toBe(200);
            expect(((await slots.json()) as Record<string, unknown>).firstView).toBe(firstView);
        }

        const audit = await dispatcherFetch(testEnv, `/api/book/requests/${rid}/audit`);
        expect(audit.json.viewCount).toBe(2);
        expect((audit.json.events as BookingAuditEvent[]).map((event) => event.type)).toEqual([
            "view",
            "view",
        ]);
        const status = await dispatcherFetch(testEnv, `/api/book/requests/${rid}/status`, {
            headers: auth,
        });
        expect(status.json).toMatchObject({ viewCount: 2 });
        expect(typeof status.json.clickedAt).toBe("string");
        const list = await dispatcherFetch(testEnv, "/api/book/requests");
        const row = (list.json.requests as Record<string, unknown>[]).find((r) => r.rid === rid);
        expect(row).toMatchObject({ viewCount: 2 });
    });

    it("records book and cancel transitions in the trail", async () => {
        const testEnv = env();
        stubHalo();
        const { rid, token } = await mint(testEnv);

        const slots = await worker.fetch(
            new Request(
                `https://portal.test/api/book/requests/${rid}/slots?token=${encodeURIComponent(token)}`,
                { headers: { "cf-connecting-ip": freshIp() } },
            ),
            testEnv,
        );
        expect(slots.status).toBe(200);
        const firstDay = (
            (await slots.json()) as {
                days: { slots: { agentId: number; start: string; end: string }[] }[];
            }
        ).days[0];
        expect(firstDay.slots.length).toBeGreaterThan(0);
        const slot = firstDay.slots[0];

        const booked = await worker.fetch(
            new Request(`https://portal.test/api/book/requests/${rid}/book`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "cf-connecting-ip": freshIp() },
                body: JSON.stringify({ token, ...slot, utcOffset: 0 }),
            }),
            testEnv,
        );
        expect(booked.status).toBe(201);

        const bookedAudit = await dispatcherFetch(testEnv, `/api/book/requests/${rid}/audit`);
        const bookedEvents = bookedAudit.json.events as BookingAuditEvent[];
        expect(bookedEvents.map((event) => event.type)).toEqual(["view", "book"]);
        expect(bookedEvents[1]).toMatchObject({ detail: "555" });

        const { rid: cancelRid } = await mint(testEnv);
        const cancelled = await dispatcherFetch(testEnv, `/api/book/requests/${cancelRid}/cancel`, {
            method: "POST",
        });
        expect(cancelled.status).toBe(200);
        expect(cancelled.json).toMatchObject({ status: "cancelled", viewCount: 0 });
        const cancelAudit = await dispatcherFetch(testEnv, `/api/book/requests/${cancelRid}/audit`);
        expect((cancelAudit.json.events as BookingAuditEvent[]).map((e) => e.type)).toEqual([
            "cancel",
        ]);
    });

    it("records extend renewals in the trail", async () => {
        const testEnv = env();
        const { rid } = await mint(testEnv);
        const { json } = await dispatcherFetch(testEnv, `/api/book/requests/${rid}/extend`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ days: 10 }),
        });
        const audit = await dispatcherFetch(testEnv, `/api/book/requests/${rid}/audit`);
        expect(audit.json.events).toEqual([
            { type: "extend", at: expect.any(String), detail: json.expiresAt },
        ]);
    });
});
