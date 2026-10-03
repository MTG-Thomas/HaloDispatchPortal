import {
    LEGACY_AREA_STORAGE_KEY,
    LEGACY_LISTS_STORAGE_KEY,
} from "@/lib/constants";
import { logger } from "@/lib/logger";

export interface LegacySelection {
    selectedTicketAreaId: number | null;
    selectedListIds: number[];
}

function clearLegacyKeys(): void {
    try {
        localStorage.removeItem(LEGACY_AREA_STORAGE_KEY);
        localStorage.removeItem(LEGACY_LISTS_STORAGE_KEY);
    } catch {
        // Storage unavailable — nothing to clean up.
    }
}

/**
 * One-time migration from the pre-P1 manual localStorage keys
 * (`halo-selected-ticket-area`, `halo-selected-lists`) to the single
 * persisted selection. Reads, validates, then removes the legacy keys so
 * they can never shadow the store again.
 */
export function readLegacySelection(): LegacySelection {
    const empty: LegacySelection = {
        selectedTicketAreaId: null,
        selectedListIds: [],
    };
    try {
        if (typeof localStorage === "undefined") {
            return empty;
        }
        let selectedTicketAreaId: number | null = null;
        let selectedListIds: number[] = [];

        const savedArea = localStorage.getItem(LEGACY_AREA_STORAGE_KEY);
        if (savedArea) {
            const areaId = parseInt(savedArea, 10);
            if (Number.isFinite(areaId)) {
                selectedTicketAreaId = areaId;
            }
        }

        const savedLists = localStorage.getItem(LEGACY_LISTS_STORAGE_KEY);
        if (savedLists) {
            const parsed: unknown = JSON.parse(savedLists);
            if (Array.isArray(parsed)) {
                selectedListIds = parsed.filter(
                    (value): value is number =>
                        typeof value === "number" && Number.isFinite(value)
                );
            }
        }

        return { selectedTicketAreaId, selectedListIds };
    } catch (error) {
        logger.warn("Ignoring corrupt legacy selection:", error);
        return empty;
    } finally {
        clearLegacyKeys();
    }
}
