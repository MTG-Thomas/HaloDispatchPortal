import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ResourceSelection } from '@/types';

/**
 * Column definition for table ordering
 */
export interface ColumnConfig {
  id: string;
  label: string;
  isVisible: boolean;
  isFixed?: boolean; // If true, column cannot be reordered or hidden
  width?: number; // Column width in pixels (undefined = auto)
}

/**
 * User Preferences State
 * Persists user preferences using Zustand persist middleware
 */
interface PreferencesState {
  // Agent/Team Selections
  selectedResources: ResourceSelection[];
  setSelectedResources: (resources: ResourceSelection[]) => void;
  addResourceSelection: (resource: ResourceSelection) => void;
  removeResourceSelection: (resource: ResourceSelection) => void;
  toggleResourceSelection: (resource: ResourceSelection) => void;

  // Column Ordering
  ticketListColumns: ColumnConfig[];
  setTicketListColumns: (columns: ColumnConfig[]) => void;
  reorderColumn: (fromIndex: number, toIndex: number) => void;
  toggleColumnVisibility: (columnId: string) => void;
  setColumnWidth: (columnId: string, width: number) => void;
  resetColumns: () => void;

  // Reset all preferences
  resetAll: () => void;
}

/**
 * Default column configuration for ticket list
 * 'List' column is fixed and always first
 */
const defaultColumns: ColumnConfig[] = [
  { id: 'list', label: 'List', isVisible: true, isFixed: true },
  { id: 'id', label: 'ID', isVisible: true },
  { id: 'clientSiteUser', label: 'Client/Site/User', isVisible: true },
  { id: 'status', label: 'Status', isVisible: true },
  { id: 'slaTimeLeft', label: 'SLA Time Left', isVisible: true },
  { id: 'priority', label: 'Priority', isVisible: true },
  { id: 'team', label: 'Team', isVisible: true },
  { id: 'agent', label: 'Agent', isVisible: true },
  { id: 'summary', label: 'Summary', isVisible: true },
  { id: 'dateReported', label: 'Date Reported', isVisible: true },
  { id: 'lastAction', label: 'Last Action', isVisible: true },
  { id: 'type', label: 'Type', isVisible: true },
  { id: 'timeTaken', label: 'Time Taken', isVisible: true },
  { id: 'serviceCategory', label: 'Service Category', isVisible: true },
  { id: 'createdBy', label: 'Created By', isVisible: true },
];

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set, get) => ({
      // Initial state
      selectedResources: [],
      ticketListColumns: defaultColumns,

      // Agent/Team Selection Actions
      setSelectedResources: (resources) => set({ selectedResources: resources }),

      addResourceSelection: (resource) =>
        set((state) => ({
          selectedResources: [...state.selectedResources, resource],
        })),

      removeResourceSelection: (resource) =>
        set((state) => ({
          selectedResources: state.selectedResources.filter(
            (r) => !(r.type === resource.type && r.id === resource.id)
          ),
        })),

      toggleResourceSelection: (resource) =>
        set((state) => {
          const exists = state.selectedResources.some(
            (r) => r.type === resource.type && r.id === resource.id
          );
          if (exists) {
            return {
              selectedResources: state.selectedResources.filter(
                (r) => !(r.type === resource.type && r.id === resource.id)
              ),
            };
          } else {
            return {
              selectedResources: [...state.selectedResources, resource],
            };
          }
        }),

      // Column Ordering Actions
      setTicketListColumns: (columns) => set({ ticketListColumns: columns }),

      reorderColumn: (fromIndex, toIndex) => {
        const state = get();
        const columns = [...state.ticketListColumns];

        // Prevent reordering if either column is fixed
        if (columns[fromIndex]?.isFixed || columns[toIndex]?.isFixed) {
          console.warn('Cannot reorder fixed columns');
          return;
        }

        // Prevent moving to index 0 (reserved for 'List' column)
        if (toIndex === 0) {
          console.warn('Cannot move column to first position (reserved for List column)');
          return;
        }

        const [removed] = columns.splice(fromIndex, 1);
        columns.splice(toIndex, 0, removed);

        set({ ticketListColumns: columns });
      },

      toggleColumnVisibility: (columnId) => {
        set((state) => ({
          ticketListColumns: state.ticketListColumns.map((col) =>
            col.id === columnId && !col.isFixed
              ? { ...col, isVisible: !col.isVisible }
              : col
          ),
        }));
      },

      setColumnWidth: (columnId, width) => {
        set((state) => ({
          ticketListColumns: state.ticketListColumns.map((col) =>
            col.id === columnId ? { ...col, width } : col
          ),
        }));
      },

      resetColumns: () => set({ ticketListColumns: defaultColumns }),

      // Reset all preferences
      resetAll: () =>
        set({
          selectedResources: [],
          ticketListColumns: defaultColumns,
        }),
    }),
    {
      name: 'halo-dispatch-preferences',
      partialize: (state) => ({
        selectedResources: state.selectedResources,
        ticketListColumns: state.ticketListColumns,
      }),
    }
  )
);
