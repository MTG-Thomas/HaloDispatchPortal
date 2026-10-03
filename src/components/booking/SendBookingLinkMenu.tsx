import { Mail, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BookingSendChannel } from "@/lib/send-booking-link";

interface SendBookingLinkMenuProps {
    ticketId: number;
    disabled?: boolean;
    onSelect: (channel: BookingSendChannel) => void;
}

/**
 * Dispatcher send action: deep-link the booking URL into the dispatcher's own
 * mail or SMS app (subject/body prefilled, recipient left to address). Used by
 * both the ticket-row booking cell and the outstanding-requests queue.
 */
export function SendBookingLinkMenu({ ticketId, disabled, onSelect }: SendBookingLinkMenuProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    disabled={disabled}
                    title="Send booking link via email or text"
                    aria-label={`Send booking link for ticket ${ticketId}`}
                >
                    <Mail className="h-4 w-4" aria-hidden />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onSelect("mailto")}>
                    <Mail className="h-4 w-4 mr-2" aria-hidden />
                    Send via email
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSelect("sms")}>
                    <MessageSquare className="h-4 w-4 mr-2" aria-hidden />
                    Send via text (SMS)
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
