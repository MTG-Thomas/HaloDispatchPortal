import {
    format,
    addDays,
    subDays,
    startOfWeek,
    endOfWeek,
    addWeeks,
    subWeeks,
    addMonths,
    subMonths,
} from "date-fns";
import {
    ChevronLeft,
    ChevronRight,
    Calendar as CalendarIcon,
    Moon,
    Sun,
    LogOut,
    RefreshCw,
    ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDispatchStore } from "@/stores/useDispatchStore";
import { getViewDateRange } from "@/lib/dates";
import { WEEK_STARTS_ON } from "@/lib/constants";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { FilterPopover } from "./FilterPopover";
import { cn } from "@/lib/utils";
import type { CalendarView } from "@/types";

export function CalendarHeader() {
    const {
        calendarView,
        selectedDate,
        setCalendarView,
        setSelectedDate,
        appointmentsLoading,
        loadAppointments,
    } = useDispatchStore();
    const { calendarZoomLevel, setCalendarZoomLevel } = usePreferencesStore();
    const { theme, toggleTheme } = useTheme();
    const { logout } = useAuth();

    const navigatePrevious = () => {
        switch (calendarView) {
            case "day":
                setSelectedDate(subDays(selectedDate, 1));
                break;
            case "week5":
            case "week7":
                setSelectedDate(subWeeks(selectedDate, 1));
                break;
            case "month":
                setSelectedDate(subMonths(selectedDate, 1));
                break;
        }
    };

    const navigateNext = () => {
        switch (calendarView) {
            case "day":
                setSelectedDate(addDays(selectedDate, 1));
                break;
            case "week5":
            case "week7":
                setSelectedDate(addWeeks(selectedDate, 1));
                break;
            case "month":
                setSelectedDate(addMonths(selectedDate, 1));
                break;
        }
    };

    const handleToday = () => {
        setSelectedDate(new Date());
    };

    const periodLabel =
        calendarView === "day" ? "day" : calendarView === "month" ? "month" : "week";

    const getDateRangeText = () => {
        switch (calendarView) {
            case "day":
                return format(selectedDate, "MMMM d, yyyy");
            case "week5":
            case "week7": {
                const start = startOfWeek(selectedDate, { weekStartsOn: WEEK_STARTS_ON });
                const end = endOfWeek(selectedDate, { weekStartsOn: WEEK_STARTS_ON });
                return `${format(start, "MMM d")} - ${format(end, "MMM d, yyyy")}`;
            }
            case "month":
                return format(selectedDate, "MMMM yyyy");
        }
    };

    const handleRefreshAppointments = async () => {
        if (appointmentsLoading) return;

        const { startDate, endDate } = getViewDateRange(calendarView, selectedDate);
        await loadAppointments(startDate, endDate);
    };

    return (
        <div className="border-b bg-card p-4">
            {/* Single Row: Navigation, Filter, View Controls, Actions */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    {/* Date Navigation */}
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={navigatePrevious}
                        aria-label={`Previous ${periodLabel}`}
                        title={`Previous ${periodLabel} (←)`}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>

                    <Button
                        variant="outline"
                        size="icon"
                        onClick={navigateNext}
                        aria-label={`Next ${periodLabel}`}
                        title={`Next ${periodLabel} (→)`}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>

                    <Button variant="outline" onClick={handleToday}>
                        Today
                    </Button>

                    <div className="flex items-center gap-2 px-3 text-sm font-medium">
                        <CalendarIcon className="h-4 w-4" />
                        {getDateRangeText()}
                    </div>

                    {/* Filter Button */}
                    <FilterPopover />
                </div>

                {/* View Switcher and Actions */}
                <div className="flex items-center gap-2">
                    <Tabs
                        value={calendarView}
                        onValueChange={(v) => setCalendarView(v as CalendarView)}
                    >
                        <TabsList>
                            <TabsTrigger value="day">Day</TabsTrigger>
                            <TabsTrigger value="week5">Week (5)</TabsTrigger>
                            <TabsTrigger value="week7">Week (7)</TabsTrigger>
                            <TabsTrigger value="month">Month</TabsTrigger>
                        </TabsList>
                    </Tabs>

                    {/* Zoom Level Selector */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-9 gap-1"
                                aria-label="Calendar zoom level"
                            >
                                <ZoomIn className="h-4 w-4" />
                                {calendarZoomLevel}%
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setCalendarZoomLevel(100)}>
                                <span className={cn(calendarZoomLevel === 100 && "font-bold")}>
                                    100%
                                </span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setCalendarZoomLevel(75)}>
                                <span className={cn(calendarZoomLevel === 75 && "font-bold")}>
                                    75%
                                </span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setCalendarZoomLevel(50)}>
                                <span className={cn(calendarZoomLevel === 50 && "font-bold")}>
                                    50%
                                </span>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setCalendarZoomLevel(25)}>
                                <span className={cn(calendarZoomLevel === 25 && "font-bold")}>
                                    25%
                                </span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Refresh Button */}
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={handleRefreshAppointments}
                        disabled={appointmentsLoading}
                        aria-label="Refresh appointments"
                    >
                        <RefreshCw
                            className={cn("h-4 w-4", appointmentsLoading && "animate-spin")}
                        />
                    </Button>

                    {/* Dark Mode Toggle */}
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={toggleTheme}
                        aria-label="Toggle theme"
                    >
                        {theme === "dark" ? (
                            <Sun className="h-4 w-4" />
                        ) : (
                            <Moon className="h-4 w-4" />
                        )}
                    </Button>

                    {/* Logout Button */}
                    <Button variant="outline" size="icon" onClick={logout} aria-label="Logout">
                        <LogOut className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
