// @vitest-environment node
import { describe, expect, it } from "vitest";
import { signBookingToken, verifyBookingToken, type BookingTokenPayload } from "../token";

const SECRET = "test-secret-for-booking-tokens";
const NOW_SEC = 1_790_000_000;

function payload(partial: Partial<BookingTokenPayload> = {}): BookingTokenPayload {
    return {
        rid: "rid-123",
        ticketId: 42,
        agentIds: [7, 9],
        appointmentTypeId: 3,
        exp: NOW_SEC + 3600,
        ...partial,
    };
}

describe("booking tokens", () => {
    it("runs without a DOM (node environment)", () => {
        expect("document" in globalThis).toBe(false);
    });

    it("round-trips a signed payload", async () => {
        const token = await signBookingToken(payload(), SECRET);
        const result = await verifyBookingToken(token, SECRET, NOW_SEC);
        expect(result).toEqual({ ok: true, payload: payload() });
    });

    it("rejects a token signed with a different secret", async () => {
        const token = await signBookingToken(payload(), "another-secret");
        const result = await verifyBookingToken(token, SECRET, NOW_SEC);
        expect(result).toEqual({ ok: false, reason: "invalid-signature" });
    });

    it("rejects a tampered payload", async () => {
        const token = await signBookingToken(payload(), SECRET);
        const [body, sig] = token.split(".");
        const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        decoded.ticketId = 999;
        const forgedBody = Buffer.from(JSON.stringify(decoded)).toString("base64url");
        const result = await verifyBookingToken(`${forgedBody}.${sig}`, SECRET, NOW_SEC);
        expect(result).toEqual({ ok: false, reason: "invalid-signature" });
    });

    it("rejects a tampered signature", async () => {
        const token = await signBookingToken(payload(), SECRET);
        const [body, sig] = token.split(".");
        const last = sig[sig.length - 1] === "A" ? "B" : "A";
        const result = await verifyBookingToken(
            `${body}.${sig.slice(0, -1)}${last}`,
            SECRET,
            NOW_SEC,
        );
        expect(result).toEqual({ ok: false, reason: "invalid-signature" });
    });

    it("rejects an expired token", async () => {
        const token = await signBookingToken(payload({ exp: NOW_SEC - 1 }), SECRET);
        const result = await verifyBookingToken(token, SECRET, NOW_SEC);
        expect(result).toEqual({ ok: false, reason: "expired" });
    });

    it("rejects malformed tokens", async () => {
        for (const bad of ["", "no-dot-here", ".sig", "body.", "a.b.c"]) {
            await expect(verifyBookingToken(bad, SECRET, NOW_SEC)).resolves.toEqual({
                ok: false,
                reason: "malformed",
            });
        }
    });
});
