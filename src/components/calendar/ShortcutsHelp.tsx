import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { SHORTCUT_HELP } from "@/lib/shortcuts";

interface ShortcutsHelpProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** `?` overlay listing every calendar keyboard shortcut. */
export function ShortcutsHelp({ open, onOpenChange }: ShortcutsHelpProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Keyboard shortcuts</DialogTitle>
                    <DialogDescription>
                        Available anywhere on the dispatch calendar.
                    </DialogDescription>
                </DialogHeader>
                <dl className="divide-y divide-border">
                    {SHORTCUT_HELP.map((entry) => (
                        <div key={entry.keys} className="flex items-center justify-between py-2">
                            <dt className="text-sm text-muted-foreground">{entry.description}</dt>
                            <dd>
                                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                                    {entry.keys}
                                </kbd>
                            </dd>
                        </div>
                    ))}
                </dl>
            </DialogContent>
        </Dialog>
    );
}
