import {
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    LayoutGrid,
    RefreshCw,
    Keyboard,
} from "lucide-react";
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    CommandShortcut,
} from "@/components/ui/command";
import { buildPaletteActions, type PaletteContext } from "./paletteActions";

interface CommandPaletteProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    context: PaletteContext;
}

const GROUP_ICONS: Record<string, typeof CalendarDays> = {
    "go-today": CalendarDays,
    "go-previous": ChevronLeft,
    "go-next": ChevronRight,
    refresh: RefreshCw,
    help: Keyboard,
};

function ActionIcon({ id }: { id: string }) {
    if (id.startsWith("view-")) {
        return <LayoutGrid />;
    }
    const Icon = GROUP_ICONS[id] ?? CalendarDays;
    return <Icon />;
}

/** Global Cmd/Ctrl+K palette: calendar navigation, views, and utility actions. */
export function CommandPalette({ open, onOpenChange, context }: CommandPaletteProps) {
    const groups = buildPaletteActions(context);

    return (
        <CommandDialog open={open} onOpenChange={onOpenChange}>
            <CommandInput placeholder="Type a command or search..." />
            <CommandList>
                <CommandEmpty>No commands found.</CommandEmpty>
                {groups.map((group, index) => (
                    <div key={group.heading}>
                        {index > 0 && <CommandSeparator />}
                        <CommandGroup heading={group.heading}>
                            {group.actions.map((action) => (
                                <CommandItem
                                    key={action.id}
                                    value={`${group.heading} ${action.label}`}
                                    onSelect={() => {
                                        action.run();
                                        onOpenChange(false);
                                    }}
                                >
                                    <ActionIcon id={action.id} />
                                    <span>{action.label}</span>
                                    {action.hint && (
                                        <CommandShortcut>{action.hint}</CommandShortcut>
                                    )}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </div>
                ))}
            </CommandList>
        </CommandDialog>
    );
}
