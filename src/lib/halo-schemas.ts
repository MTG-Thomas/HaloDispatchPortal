import { z } from "zod";
import { ApiError } from "./api-client";
import { logger } from "./logger";

/**
 * Runtime validation for Halo PSA API responses.
 *
 * Tenant field availability varies (see AGENTS.md), so item schemas require
 * only the core fields the app reads and use `.passthrough()` for the rest.
 * Envelope schemas require the arrays/counts the app iterates over.
 * A malformed item fails the whole response (safeParse rejects the
 * envelope, with a dev log naming the first issue); a malformed envelope
 * throws an ApiError with a safe message. Nothing is silently dropped.
 */

const HaloAgentSchema = z
    .object({
        id: z.number(),
        name: z.string(),
    })
    .passthrough();

const HaloStatusSchema = z
    .object({
        id: z.number(),
        name: z.string(),
    })
    .passthrough();

const HaloTicketTypeSchema = z
    .object({
        id: z.number(),
        name: z.string(),
    })
    .passthrough();

const HaloTicketAreaSchema = z
    .object({
        id: z.number(),
        name: z.string(),
    })
    .passthrough();

export const ClientCacheSchema = z
    .object({
        agent: HaloAgentSchema,
        statuses: z.array(HaloStatusSchema),
        tickettypes: z.array(HaloTicketTypeSchema),
        ticketareas: z.array(HaloTicketAreaSchema),
    })
    .passthrough();

export const ViewListSchema = z
    .object({
        id: z.number(),
        name: z.string(),
    })
    .passthrough();

export const ViewListArraySchema = z.array(ViewListSchema);

export const ViewFilterSchema = z
    .object({
        id: z.number(),
        name: z.string(),
    })
    .passthrough();

export const ViewFilterArraySchema = z.array(ViewFilterSchema);

export const TicketSchema = z
    .object({
        id: z.number(),
        summary: z.string().optional(),
    })
    .passthrough();

export const TicketsResponseSchema = z
    .object({
        tickets: z.array(TicketSchema),
        record_count: z.number(),
    })
    .passthrough();

export const HaloAppointmentSchema = z
    .object({
        id: z.number(),
        agent_id: z.number(),
        start_date: z.string(),
        end_date: z.string(),
    })
    .passthrough();

export const HaloAppointmentArraySchema = z.array(HaloAppointmentSchema);

export const HaloAppointmentTypeSchema = z
    .object({
        id: z.number(),
        name: z.string(),
    })
    .passthrough();

export const HaloAppointmentTypeArraySchema = z.array(HaloAppointmentTypeSchema);

export const HaloUserSchema = z
    .object({
        id: z.number(),
        name: z.string(),
    })
    .passthrough();

export const SearchUsersResponseSchema = z
    .object({
        record_count: z.number(),
        users: z.array(HaloUserSchema),
    })
    .passthrough();

export const HaloCategorySchema = z
    .object({
        id: z.number(),
    })
    .passthrough();

export const HaloCategoryArraySchema = z.array(HaloCategorySchema);

export const HaloTeamSchema = z
    .object({
        id: z.number(),
        name: z.string(),
    })
    .passthrough();

export const HaloTeamArraySchema = z.array(HaloTeamSchema);

export const HaloAgentArraySchema = z.array(HaloAgentSchema);

export const HaloSiteSchema = z
    .object({
        id: z.number(),
        name: z.string(),
    })
    .passthrough();

export const GetSitesResponseSchema = z
    .object({
        record_count: z.number(),
        sites: z.array(HaloSiteSchema),
    })
    .passthrough();

export const TicketArraySchema = z.array(TicketSchema);

/**
 * Parse a Halo response envelope. Throws ApiError(502) with a safe message
 * when the envelope shape is unusable.
 *
 * The schema validates only the core envelope shape (tenant field
 * availability varies); T is the full Halo type the caller consumes.
 */
export function parseHaloResponse<T>(schema: z.ZodType, data: unknown, label: string): T {
    const result = schema.safeParse(data);
    if (!result.success) {
        logger.warn(
            `Invalid ${label} response: ${result.error.issues.length} issue(s); ` +
                `first: ${result.error.issues[0]?.path.join(".") || "(root)"} ` +
                `${result.error.issues[0]?.message || ""}`,
        );
        throw new ApiError(
            502,
            "Bad Gateway",
            `Halo PSA returned an unexpected ${label} response. Please try again later.`,
        );
    }
    return result.data as T;
}
