import { describe, expect, it } from "vitest";
import { computeSla } from "@/utils/enrich-ticket";

const NOW = new Date("2026-10-03T12:00:00");

describe("computeSla", () => {
    it("marks past fix-by dates overdue", () => {
        const result = computeSla("2026-10-03T10:00:00", false, false, NOW);
        expect(result.slaState).toBe("overdue");
        expect(result.slaTimeLeft).toMatch(/^Overdue /);
    });

    it("warns when under two hours remain", () => {
        const result = computeSla("2026-10-03T13:30:00", false, false, NOW);
        expect(result.slaState).toBe("warning");
    });

    it("stays ok when more than two hours remain", () => {
        const result = computeSla("2026-10-04T12:00:00", false, false, NOW);
        expect(result.slaState).toBe("ok");
    });

    it("advances state as time passes without refetching", () => {
        const fixby = "2026-10-03T13:00:00";
        expect(computeSla(fixby, false, false, NOW).slaState).toBe("warning");
        expect(computeSla(fixby, false, false, new Date("2026-10-03T14:00:00")).slaState).toBe(
            "overdue",
        );
    });

    it("handles excluded, on-hold, and missing dates", () => {
        expect(computeSla("2026-10-03T10:00:00", true, false, NOW)).toEqual({
            slaTimeLeft: "Excluded",
            slaState: "ok",
        });
        expect(computeSla("2026-10-03T10:00:00", false, true, NOW)).toEqual({
            slaTimeLeft: "On Hold",
            slaState: "onhold",
        });
        expect(computeSla(null, false, false, NOW)).toEqual({
            slaTimeLeft: "None",
            slaState: "ok",
        });
        expect(computeSla("1899-12-30T00:00:00", false, false, NOW)).toEqual({
            slaTimeLeft: "None",
            slaState: "ok",
        });
    });
});
