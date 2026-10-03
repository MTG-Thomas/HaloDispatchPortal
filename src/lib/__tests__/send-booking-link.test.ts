import { describe, it, expect, vi } from "vitest";
import {
    BOOKING_SEND_VIA_HALO_SUPPORTED,
    buildBookingEmailBody,
    buildBookingEmailSubject,
    buildBookingSmsBody,
    buildBookingUrl,
    buildMailtoHref,
    buildSmsHref,
    resolveBookingSendTarget,
    selectBookingSendChannel,
    sendBookingLink,
} from "../send-booking-link";

const DETAILS = { ticketId: 123, url: "https://app.example/book/TOKEN" };

describe("Halo direct send", () => {
    it("is disabled: no ticket email/SMS action endpoint is verified", () => {
        expect(BOOKING_SEND_VIA_HALO_SUPPORTED).toBe(false);
    });
});

describe("buildBookingUrl", () => {
    it("builds an absolute /book/<token> URL", () => {
        expect(buildBookingUrl("https://app.example", "TOKEN")).toBe(
            "https://app.example/book/TOKEN",
        );
    });

    it("tolerates a trailing slash on the origin", () => {
        expect(buildBookingUrl("https://app.example/", "TOKEN")).toBe(
            "https://app.example/book/TOKEN",
        );
    });
});

describe("body construction", () => {
    it("subjects the email with the ticket id", () => {
        expect(buildBookingEmailSubject(123)).toContain("#123");
    });

    it("email body carries the URL, ticket id, and expiry", () => {
        const body = buildBookingEmailBody({ ...DETAILS, expiresAt: "2026-10-10" });
        expect(body).toContain(DETAILS.url);
        expect(body).toContain("#123");
        expect(body).toContain("2026-10-10");
    });

    it("email body omits the expiry date when unknown", () => {
        const body = buildBookingEmailBody(DETAILS);
        expect(body).toContain(DETAILS.url);
        expect(body).not.toContain("undefined");
    });

    it("sms body is one short line with the URL and ticket id", () => {
        const body = buildBookingSmsBody({ ...DETAILS, expiresAt: "2026-10-10" });
        expect(body).not.toContain("\n");
        expect(body).toContain(DETAILS.url);
        expect(body).toContain("#123");
        expect(body.length).toBeLessThan(buildBookingEmailBody(DETAILS).length);
    });
});

describe("deep-link hrefs", () => {
    it("mailto encodes subject and body", () => {
        const href = buildMailtoHref({ to: "user@example.com", subject: "Hi #1", body: "a&b" });
        expect(href.startsWith("mailto:user@example.com?")).toBe(true);
        const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
        expect(params.get("subject")).toBe("Hi #1");
        expect(params.get("body")).toBe("a&b");
    });

    it("mailto uses URI encoding (spaces as %20, never form +)", () => {
        const href = buildMailtoHref({
            to: "user@example.com",
            subject: "Book your appointment",
            body: "pick a time",
        });
        const query = href.slice(href.indexOf("?") + 1);
        expect(query).toContain("subject=Book%20your%20appointment");
        expect(query).toContain("body=pick%20a%20time");
        expect(query).not.toContain("+");
    });

    it("mailto encodes line breaks as CRLF", () => {
        const href = buildMailtoHref({ to: "u@x.com", subject: "s", body: "line one\nline two" });
        expect(href).toContain("body=line%20one%0D%0Aline%20two");
    });

    it("mailto stays valid without a recipient", () => {
        const href = buildMailtoHref({ subject: "s", body: "b" });
        expect(href.startsWith("mailto:?")).toBe(true);
    });

    it("sms encodes the body and keeps the number", () => {
        const href = buildSmsHref({ to: "+15551234567", body: "hi there & co" });
        expect(href.startsWith("sms:+15551234567?")).toBe(true);
        expect(new URLSearchParams(href.slice(href.indexOf("?") + 1)).get("body")).toBe(
            "hi there & co",
        );
    });

    it("sms uses URI encoding (spaces as %20, never form +)", () => {
        const href = buildSmsHref({ to: "+15551234567", body: "hi there" });
        const query = href.slice(href.indexOf("?") + 1);
        expect(query).toBe("body=hi%20there");
    });
});

describe("fallback selection", () => {
    it("prefers email when an address is known", () => {
        expect(selectBookingSendChannel({ email: "u@x.com", phone: "+1" })).toBe("mailto");
    });

    it("falls back to sms when only a phone is known", () => {
        expect(selectBookingSendChannel({ phone: "+1" })).toBe("sms");
    });

    it("defaults to mailto with no contact (recipientless compose still works)", () => {
        expect(selectBookingSendChannel({})).toBe("mailto");
        expect(selectBookingSendChannel()).toBe("mailto");
    });

    it("explicit dispatcher choice wins over the default", () => {
        const target = resolveBookingSendTarget({
            details: DETAILS,
            contact: { email: "u@x.com" },
            preferred: "sms",
        });
        expect(target.channel).toBe("sms");
        expect(target.href.startsWith("sms:")).toBe(true);
    });

    it("resolves a mailto target with the contact address and encoded body", () => {
        const target = resolveBookingSendTarget({
            details: DETAILS,
            contact: { email: "u@x.com" },
        });
        expect(target.channel).toBe("mailto");
        expect(target.href.startsWith("mailto:u@x.com?")).toBe(true);
        expect(decodeURIComponent(target.href)).toContain(DETAILS.url);
    });

    it("resolves an sms target with the contact number", () => {
        const target = resolveBookingSendTarget({
            details: DETAILS,
            contact: { phone: "+15551234567" },
        });
        expect(target.channel).toBe("sms");
        expect(target.href.startsWith("sms:+15551234567?")).toBe(true);
        expect(decodeURIComponent(target.href)).toContain(DETAILS.url);
    });
});

describe("sendBookingLink", () => {
    it("mints fresh, opens the deep link, and returns the mint result", async () => {
        const mintFresh = vi.fn(async () => ({ token: "FRESH", oldInvalidated: true }));
        const open = vi.fn();
        const result = await sendBookingLink({
            ticketId: 123,
            channel: "mailto",
            origin: "https://app.example",
            mintFresh,
            open,
        });
        expect(mintFresh).toHaveBeenCalledOnce();
        expect(result).toEqual({
            token: "FRESH",
            oldInvalidated: true,
            url: "https://app.example/book/FRESH",
            copied: false,
        });
        expect(open).toHaveBeenCalledOnce();
        const href = open.mock.calls[0][0] as string;
        expect(href.startsWith("mailto:")).toBe(true);
        expect(decodeURIComponent(href)).toContain("https://app.example/book/FRESH");
    });

    it("hands the fresh URL to copyFallback so the link survives a dead deep link", async () => {
        const mintFresh = vi.fn(async () => ({ token: "FRESH", oldInvalidated: true }));
        const copyFallback = vi.fn(async () => undefined);
        const result = await sendBookingLink({
            ticketId: 123,
            channel: "sms",
            origin: "https://app.example",
            mintFresh,
            open: vi.fn(),
            copyFallback,
        });
        expect(copyFallback).toHaveBeenCalledOnce();
        expect(copyFallback).toHaveBeenCalledWith("https://app.example/book/FRESH");
        expect(result.copied).toBe(true);
        expect(result.url).toBe("https://app.example/book/FRESH");
    });

    it("swallows copyFallback failures and still resolves the URL", async () => {
        const mintFresh = vi.fn(async () => ({ token: "FRESH", oldInvalidated: true }));
        const result = await sendBookingLink({
            ticketId: 123,
            channel: "sms",
            origin: "https://app.example",
            mintFresh,
            open: vi.fn(),
            copyFallback: vi.fn(async () => {
                throw new Error("clipboard denied");
            }),
        });
        expect(result.copied).toBe(false);
        expect(result.url).toBe("https://app.example/book/FRESH");
    });

    it("propagates mint failures without opening anything", async () => {
        const mintFresh = vi.fn(async () => {
            throw new Error("mint down");
        });
        const open = vi.fn();
        await expect(
            sendBookingLink({
                ticketId: 123,
                channel: "sms",
                origin: "https://app.example",
                mintFresh,
                open,
            }),
        ).rejects.toThrow("mint down");
        expect(open).not.toHaveBeenCalled();
    });
});
