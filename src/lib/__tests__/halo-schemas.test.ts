import { describe, it, expect } from "vitest";
import { ApiError } from "../api-client";
import {
    parseHaloResponse,
    ClientCacheSchema,
    TicketsResponseSchema,
    HaloAppointmentArraySchema,
    ViewListArraySchema,
} from "../halo-schemas";

describe("parseHaloResponse", () => {
    it("passes a valid ClientCache through with tenant extras preserved", () => {
        const cache = {
            agent: { id: 1, name: "A", tenant_custom: "x" },
            statuses: [{ id: 1, name: "New" }],
            tickettypes: [{ id: 2, name: "Incident" }],
            ticketareas: [{ id: 3, name: "Service Desk" }],
            some_future_field: [1, 2, 3],
        };
        expect(parseHaloResponse(ClientCacheSchema, cache, "ClientCache")).toEqual(cache);
    });

    it("passes a valid Tickets envelope with sparse tenant items", () => {
        const data = {
            page_no: 1,
            page_size: 100,
            record_count: 1,
            tickets: [{ id: 42 }],
        };
        const parsed = parseHaloResponse<{ tickets: unknown[] }>(
            TicketsResponseSchema,
            data,
            "Tickets",
        );
        expect(parsed.tickets).toHaveLength(1);
    });

    it("throws ApiError 502 with a safe message on a malformed envelope", () => {
        expect(() =>
            parseHaloResponse(TicketsResponseSchema, { tickets: null }, "Tickets"),
        ).toThrow(ApiError);
        try {
            parseHaloResponse(TicketsResponseSchema, { nope: true }, "Tickets");
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(ApiError);
            const apiError = error as ApiError;
            expect(apiError.status).toBe(502);
            expect(apiError.message).toMatch(/unexpected Tickets response/);
            // Raw payload shape must not leak into the message.
            expect(apiError.message).not.toMatch(/nope/);
        }
    });

    it("rejects appointments missing core fields", () => {
        expect(() =>
            parseHaloResponse(HaloAppointmentArraySchema, [{ id: 1, agent_id: 2 }], "Appointments"),
        ).toThrow(ApiError);
        expect(
            parseHaloResponse(
                HaloAppointmentArraySchema,
                [
                    {
                        id: 1,
                        agent_id: 2,
                        start_date: "2026-01-01T09:00:00",
                        end_date: "2026-01-01T10:00:00",
                        anything_goes: true,
                    },
                ],
                "Appointments",
            ),
        ).toHaveLength(1);
    });

    it("rejects a non-array where an array is required", () => {
        expect(() => parseHaloResponse(ViewListArraySchema, { id: 1 }, "ViewLists")).toThrow(
            ApiError,
        );
    });
});
