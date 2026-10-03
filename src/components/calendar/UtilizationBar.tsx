import { useDispatchStore } from "@/stores/useDispatchStore";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { dayUtilization } from "@/lib/capacity";

interface UtilizationBarProps {
    agentId: number;
    date: Date;
}

export function UtilizationBar({ agentId, date }: UtilizationBarProps) {
    const { agents, appointments } = useDispatchStore();

    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return null;

    const {
        isWorkingDay,
        availableHours,
        scheduledHours,
        percentage: utilizationPercentage,
    } = dayUtilization(agent, appointments, date);

    if (!isWorkingDay) {
        return (
            <div className="text-[10px] text-center text-muted-foreground py-1">
                Non-working day
            </div>
        );
    }

    // Determine color based on utilization
    const getUtilizationBarColor = () => {
        if (utilizationPercentage >= 100) return "bg-red-500";
        if (utilizationPercentage >= 80) return "bg-orange-500";
        if (utilizationPercentage >= 50) return "bg-yellow-500";
        return "bg-green-500";
    };

    const getUtilizationBadgeColor = () => {
        if (utilizationPercentage >= 100) return "bg-red-500 hover:bg-red-600 border-red-600";
        if (utilizationPercentage >= 80)
            return "bg-orange-500 hover:bg-orange-600 border-orange-600";
        if (utilizationPercentage >= 50)
            return "bg-yellow-500 hover:bg-yellow-600 border-yellow-600";
        return "bg-green-500 hover:bg-green-600 border-green-600";
    };

    return (
        <div className="relative">
            {/* Bar */}
            <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                    className={cn("h-full transition-all", getUtilizationBarColor())}
                    style={{ width: `${Math.min(utilizationPercentage, 100)}%` }}
                />
            </div>

            {/* Centered Badge overlaid on the bar */}
            <div className="absolute inset-0 flex items-center justify-center">
                <Badge
                    variant="default"
                    className={cn(
                        "h-5 px-2 text-[10px] font-semibold shadow-sm text-white",
                        getUtilizationBadgeColor(),
                    )}
                >
                    {scheduledHours.toFixed(1)}/{availableHours.toFixed(1)} (
                    {utilizationPercentage.toFixed(0)}%)
                </Badge>
            </div>
        </div>
    );
}
