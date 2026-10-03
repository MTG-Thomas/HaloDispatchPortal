// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import worker, { validateMintRequest, type BookingEnv } from "../entry";
import { getBookingRequest } from "../kv";
import { resetRateLimitsForTests } from "../ratelimit";
import { verifyBookingToken } from "../token";
import { fakeKv } from "./fake-kv";

beforeEach(() => {
    resetRateLimitsForTests();
});

const SECRET = "test-secret-for-mint";

const GOOD_PAIR = {
    access_token: "dispatcher-access",
    refresh_token: "dispatcher-refresh",
    expires_in: 3600,
};

function goodBody() {
    return {
        ticketId: 42,
        agentIds: [7, 9],
        appointmentTypeId: 3,
        haloTokenPair: { ...GOOD_PAIR },
    };
}

function env(): BookingEnv {
    return { SECRET, BOOKING_REQUESTS: fakeKv() };
}

async function mint(
    testEnv: BookingEnv,
    body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
    const response = await worker.fetch(
        new Request("https://portal.test/api/book/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }),
        testEnv,
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

describe("validateMintRequest", () => {
    it("accepts a valid body", () => {
        const result = validateMintRequest(goodBody());
        expect(result.ok).toBe(true);
    });

    it("rejects non-object bodies", () => {
        for (const bad of [null, "x", 42, []]) {
            const result = validateMintRequest(bad);
            expect(result.ok).toBe(false);
        }
    });

    it("rejects bad ticketId values", () => {
        for (const ticketId of [0, -1, 1.5, "42", null, undefined]) {
            const result = validateMintRequest({ ...goodBody(), ticketId });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.details).toContain("ticketId must be a positive integer");
            }
        }
    });

    it("rejects bad agentIds values", () => {
        for (const agentIds of [[], "7", [0], [7, -2], [1.5], null, undefined]) {
            const result = validateMintRequest({ ...goodBody(), agentIds });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.details).toContain(
                    "agentIds must be a non-empty array of positive integers",
                );
            }
        }
    });

    it("rejects bad appointmentTypeId values", () => {
        for (const appointmentTypeId of [0, -3, "3", null, undefined]) {
            const result = validateMintRequest({ ...goodBody(), appointmentTypeId });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.details).toContain("appointmentTypeId must be a positive integer");
            }
        }
    });

    it("rejects token pairs without both tokens", () => {
        const cases = [
            null,
            undefined,
            {},
            { access_token: "a" },
            { refresh_token: "r" },
            { access_token: "", refresh_token: "r" },
            { access_token: "a", refresh_token: "" },
        ];
        for (const haloTokenPair of cases) {
            const result = validateMintRequest({ ...goodBody(), haloTokenPair });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.details).toContain(
                    "haloTokenPair must include non-empty access_token and refresh_token",
                );
            }
        }
    });

    it("reports every problem at once", () => {
        const result = validateMintRequest({});
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.details).toHaveLength(4);
        }
    });

    it("accepts an optional dispatcher offset and rejects bad ones", () => {
        const ok = validateMintRequest({ ...goodBody(), dispatcherUtcOffset: -300 });
        expect(ok).toMatchObject({ ok: true, value: { dispatcherUtcOffset: -300 } });
        for (const dispatcherUtcOffset of [1.5, "0", -841, 841, Number.NaN]) {
            const result = validateMintRequest({ ...goodBody(), dispatcherUtcOffset });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.details).toContain(
                    "dispatcherUtcOffset must be an integer between -840 and 840",
                );
            }
        }
    });
});

describe("mint endpoint", () => {
    it("mints a verifiable booking token", async () => {
        const testEnv = env();
        const { status, json } = await mint(testEnv, goodBody());
        expect(status).toBe(201);
        expect(typeof json.rid).toBe("string");
        expect(typeof json.token).toBe("string");
        expect(typeof json.expiresAt).toBe("string");
        const verified = await verifyBookingToken(String(json.token), SECRET);
        expect(verified).toEqual({
            ok: true,
            payload: {
                rid: json.rid,
                ticketId: 42,
                agentIds: [7, 9],
                appointmentTypeId: 3,
                exp: expect.any(Number),
            },
        });
    });

    it("returns 400 with details for invalid bodies", async () => {
        const { status, json } = await mint(env(), { ticketId: "nope" });
        expect(status).toBe(400);
        expect(json.error).toBe("Invalid booking request");
        expect((json.details as unknown[]).length).toBeGreaterThan(0);
    });

    it("returns 400 for invalid JSON", async () => {
        const response = await worker.fetch(
            new Request("https://portal.test/api/book/requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{not json",
            }),
            env(),
        );
        expect(response.status).toBe(400);
    });

    it("stores the dispatcher offset for business-hours checks", async () => {
        const testEnv = env();
        const { status, json } = await mint(testEnv, {
            ...goodBody(),
            dispatcherUtcOffset: -300,
        });
        expect(status).toBe(201);
        await expect(
            getBookingRequest(testEnv.BOOKING_REQUESTS, String(json.rid)),
        ).resolves.toMatchObject({ businessOffsetMin: -300 });
    });
});

describe("status and cancel endpoints", () => {
    it("serves status to the minting dispatcher only", async () => {
        const testEnv = env();
        const { json } = await mint(testEnv, goodBody());
        const url = `https://portal.test/api/book/requests/${json.rid}/status`;

        const anonymous = await worker.fetch(new Request(url), testEnv);
        expect(anonymous.status).toBe(401);

        const wrongBearer = await worker.fetch(
            new Request(url, { headers: { Authorization: "Bearer wrong" } }),
            testEnv,
        );
        expect(wrongBearer.status).toBe(401);

        const authorized = await worker.fetch(
            new Request(url, { headers: { Authorization: "Bearer dispatcher-access" } }),
            testEnv,
        );
        expect(authorized.status).toBe(200);
        const status = (await authorized.json()) as Record<string, unknown>;
        expect(status).toMatchObject({ rid: json.rid, status: "pending", ticketId: 42 });
        // Sealed tokens never leak through the status endpoint.
        expect(JSON.stringify(status)).not.toContain("dispatcher-access");
        expect(JSON.stringify(status)).not.toContain("dispatcher-refresh");
        expect(status).not.toHaveProperty("sealedTokens");
    });

    it("cancels once, then reports the final state", async () => {
        const testEnv = env();
        const { json } = await mint(testEnv, goodBody());
        const auth = { Authorization: "Bearer dispatcher-access" };
        const cancelUrl = `https://portal.test/api/book/requests/${json.rid}/cancel`;

        const anonymous = await worker.fetch(new Request(cancelUrl, { method: "POST" }), testEnv);
        expect(anonymous.status).toBe(401);

        const first = await worker.fetch(
            new Request(cancelUrl, { method: "POST", headers: auth }),
            testEnv,
        );
        expect(first.status).toBe(200);
        expect(((await first.json()) as Record<string, unknown>).status).toBe("cancelled");

        const second = await worker.fetch(
            new Request(cancelUrl, { method: "POST", headers: auth }),
            testEnv,
        );
        expect(second.status).toBe(409);

        const status = await worker.fetch(
            new Request(`https://portal.test/api/book/requests/${json.rid}/status`, {
                headers: auth,
            }),
            testEnv,
        );
        expect(((await status.json()) as Record<string, unknown>).status).toBe("cancelled");
    });

    it("returns 404 for unknown rids", async () => {
        const testEnv = env();
        const auth = { Authorization: "Bearer dispatcher-access" };
        const status = await worker.fetch(
            new Request("https://portal.test/api/book/requests/nope/status", { headers: auth }),
            testEnv,
        );
        expect(status.status).toBe(404);
        const cancel = await worker.fetch(
            new Request("https://portal.test/api/book/requests/nope/cancel", {
                method: "POST",
                headers: auth,
            }),
            testEnv,
        );
        expect(cancel.status).toBe(404);
    });

    it("rate-limits the dispatcher status and cancel routes", async () => {
        const testEnv = env();
        const { json } = await mint(testEnv, goodBody());
        const statusUrl = `https://portal.test/api/book/requests/${json.rid}/status`;
        const cancelUrl = `https://portal.test/api/book/requests/${json.rid}/cancel`;
        const headers = {
            Authorization: `Bearer ${GOOD_PAIR.access_token}`,
            "cf-connecting-ip": "10.7.7.7",
        };
        for (let i = 0; i < 30; i++) {
            const response = await worker.fetch(new Request(statusUrl, { headers }), testEnv);
            expect(response.status).toBe(200);
        }
        expect((await worker.fetch(new Request(statusUrl, { headers }), testEnv)).status).toBe(429);
        // The shared per-IP budget covers cancel too.
        expect(
            (await worker.fetch(new Request(cancelUrl, { method: "POST", headers }), testEnv))
                .status,
        ).toBe(429);
    });
});

describe("router", () => {
    it("answers 404 outside /api/book/*", async () => {
        const testEnv = env();
        for (const [method, path] of [
            ["GET", "/"],
            ["DELETE", "/api/book/requests"],
            ["DELETE", "/api/book/requests/x/status"],
            ["GET", "/api/other"],
        ] as const) {
            const response = await worker.fetch(
                new Request(`https://portal.test${path}`, { method }),
                testEnv,
            );
            expect(response.status).toBe(404);
        }
    });

    it("answers 500 without a configured SECRET", async () => {
        const response = await worker.fetch(
            new Request("https://portal.test/api/book/requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            }),
            { SECRET: "", BOOKING_REQUESTS: fakeKv() },
        );
        expect(response.status).toBe(500);
    });
});
