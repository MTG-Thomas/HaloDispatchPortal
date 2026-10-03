// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
    BookingStateError,
    bookingRequestKey,
    createBookingRequest,
    getBookingRequest,
    listBookingRequests,
    markBookingBooked,
    markBookingClicked,
    openTokenPair,
    sealTokenPair,
    setBookingStatus,
    updateSealedTokens,
    type HaloTokenPair,
    type KeyValueClient,
} from "../kv";
import { fakeKv } from "./fake-kv";

const SECRET = "test-secret-for-kv-state";

function pair(partial: Partial<HaloTokenPair> = {}): HaloTokenPair {
    return {
        access_token: "access-abc",
        refresh_token: "refresh-xyz",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "all:standard offline_access",
        ...partial,
    };
}

describe("booking KV state machine", () => {
    it("creates and reads back a pending request", async () => {
        const kv = fakeKv();
        const record = await createBookingRequest(kv, {
            rid: "rid-1",
            ticketId: 42,
            agentIds: [7],
            appointmentTypeId: 3,
            sealedTokens: await sealTokenPair(pair(), SECRET),
            exp: 1_790_003_600,
        });
        expect(record.status).toBe("pending");
        expect(record.createdAt).toBe(record.updatedAt);
        await expect(getBookingRequest(kv, "rid-1")).resolves.toEqual(record);
        expect(bookingRequestKey("rid-1")).toBe("book:req:rid-1");
    });

    it("returns null for an unknown rid", async () => {
        await expect(getBookingRequest(fakeKv(), "missing")).resolves.toBeNull();
    });

    it("rejects duplicate creates (rid collision)", async () => {
        const kv = fakeKv();
        const input = {
            rid: "rid-dup",
            ticketId: 1,
            agentIds: [1],
            appointmentTypeId: 1,
            sealedTokens: await sealTokenPair(pair(), SECRET),
            exp: 1_790_003_600,
        };
        await createBookingRequest(kv, input);
        const error = await createBookingRequest(kv, input).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(BookingStateError);
        expect((error as BookingStateError).code).toBe("already-exists");
    });

    it("transitions pending to cancelled", async () => {
        const kv = fakeKv();
        await createBookingRequest(kv, {
            rid: "rid-cancel",
            ticketId: 1,
            agentIds: [1],
            appointmentTypeId: 1,
            sealedTokens: await sealTokenPair(pair(), SECRET),
            exp: 1_790_003_600,
        });
        const updated = await setBookingStatus(kv, "rid-cancel", "cancelled");
        expect(updated.status).toBe("cancelled");
        await expect(getBookingRequest(kv, "rid-cancel")).resolves.toMatchObject({
            status: "cancelled",
        });
    });

    it("refuses transitions out of terminal states", async () => {
        const kv = fakeKv();
        await createBookingRequest(kv, {
            rid: "rid-final",
            ticketId: 1,
            agentIds: [1],
            appointmentTypeId: 1,
            sealedTokens: await sealTokenPair(pair(), SECRET),
            exp: 1_790_003_600,
        });
        await setBookingStatus(kv, "rid-final", "cancelled");
        const error = await setBookingStatus(kv, "rid-final", "booked").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(BookingStateError);
        expect((error as BookingStateError).code).toBe("illegal-transition");
    });

    it("refuses transitions for unknown rids", async () => {
        const error = await setBookingStatus(fakeKv(), "missing", "cancelled").catch(
            (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(BookingStateError);
        expect((error as BookingStateError).code).toBe("not-found");
    });
});

describe("claim-on-load and single-book redeem", () => {
    async function pending(rid: string) {
        const kv = fakeKv();
        await createBookingRequest(kv, {
            rid,
            ticketId: 1,
            agentIds: [1],
            appointmentTypeId: 1,
            sealedTokens: await sealTokenPair(pair(), SECRET),
            exp: 1_790_003_600,
        });
        return kv;
    }

    it("stamps the first view once and leaves later views untouched", async () => {
        const kv = await pending("rid-click");
        const first = await markBookingClicked(kv, "rid-click", new Date("2026-10-03T10:00:00Z"));
        expect(first.firstView).toBe(true);
        expect(first.record.clickedAt).toBe("2026-10-03T10:00:00.000Z");
        const second = await markBookingClicked(kv, "rid-click", new Date("2026-10-04T10:00:00Z"));
        expect(second.firstView).toBe(false);
        expect(second.record.clickedAt).toBe("2026-10-03T10:00:00.000Z");
    });

    it("never claims terminal records", async () => {
        const kv = await pending("rid-click-final");
        await setBookingStatus(kv, "rid-click-final", "cancelled");
        const claimed = await markBookingClicked(kv, "rid-click-final");
        expect(claimed.firstView).toBe(false);
        expect(claimed.record.clickedAt).toBeUndefined();
    });

    it("books once with the appointment id, then refuses replays", async () => {
        const kv = await pending("rid-book");
        const booked = await markBookingBooked(kv, "rid-book", 555);
        expect(booked.status).toBe("booked");
        expect(booked.bookedAppointmentId).toBe(555);
        const error = await markBookingBooked(kv, "rid-book", 556).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(BookingStateError);
        expect((error as BookingStateError).code).toBe("illegal-transition");
    });

    it("swaps the sealed pair without touching status", async () => {
        const kv = await pending("rid-reseal");
        const updated = await updateSealedTokens(
            kv,
            "rid-reseal",
            await sealTokenPair(pair({ access_token: "access-new" }), SECRET),
        );
        expect(updated.status).toBe("pending");
        await expect(openTokenPair(updated.sealedTokens, SECRET)).resolves.toMatchObject({
            access_token: "access-new",
        });
    });
});

describe("listBookingRequests", () => {
    it("stores the dispatcher offset when minted with one", async () => {
        const kv = fakeKv();
        const record = await createBookingRequest(kv, {
            rid: "rid-tz",
            ticketId: 42,
            agentIds: [7],
            appointmentTypeId: 3,
            sealedTokens: await sealTokenPair(pair(), SECRET),
            exp: 1_790_003_600,
            businessOffsetMin: -300,
        });
        expect(record.businessOffsetMin).toBe(-300);
        await expect(getBookingRequest(kv, "rid-tz")).resolves.toMatchObject({
            businessOffsetMin: -300,
        });
    });

    it("follows the KV cursor past the first page", async () => {
        const kv = fakeKv();
        for (const rid of ["rid-p1", "rid-p2", "rid-p3"]) {
            await createBookingRequest(kv, {
                rid,
                ticketId: 42,
                agentIds: [7],
                appointmentTypeId: 3,
                sealedTokens: await sealTokenPair(pair(), SECRET),
                exp: 1_790_003_600,
            });
        }
        // Force two-key pages regardless of server defaults.
        const paging: KeyValueClient = {
            ...kv,
            list: (options) => kv.list({ ...options, limit: 2 }),
        };
        const records = await listBookingRequests(paging);
        expect(records.map((r) => r.rid).sort()).toEqual(["rid-p1", "rid-p2", "rid-p3"]);
    });
});

describe("sealed token pairs", () => {
    it("round-trips through seal/open", async () => {
        const sealed = await sealTokenPair(pair(), SECRET);
        await expect(openTokenPair(sealed, SECRET)).resolves.toEqual(pair());
    });

    it("fails to open with the wrong secret", async () => {
        const sealed = await sealTokenPair(pair(), SECRET);
        await expect(openTokenPair(sealed, "wrong-secret")).rejects.toThrow();
    });

    it("sealed output does not contain the raw tokens", async () => {
        const sealed = await sealTokenPair(pair(), SECRET);
        const serialized = JSON.stringify(sealed);
        expect(serialized).not.toContain("access-abc");
        expect(serialized).not.toContain("refresh-xyz");
    });
});
