import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { CalendarHeader } from './calendar/CalendarHeader';
import { CalendarGrid } from './calendar/CalendarGrid';
import { TicketList } from './tickets/TicketListDnd';

export function DispatchView() {
  return (
    <div className="h-screen bg-background">
      <PanelGroup direction="vertical" id="dispatch-view-panels">
        {/* Calendar Section - Default 66% */}
        <Panel defaultSize={66} minSize={30}>
          <div className="h-full flex flex-col min-h-0">
            <CalendarHeader />
            <CalendarGrid />
          </div>
        </Panel>

        {/* Resizable Divider */}
        <PanelResizeHandle className="h-1 bg-border hover:bg-primary/50 active:bg-primary transition-colors cursor-row-resize" />

        {/* Ticket List Section - Default 34% */}
        <Panel defaultSize={34} minSize={20}>
          <div className="h-full overflow-hidden">
            <TicketList />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
