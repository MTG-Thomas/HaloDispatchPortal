import { useState, useCallback, useMemo, useEffect } from 'react';
import type {
  TriageFormData,
  DispatchFormData,
  HaloUser,
  Ticket as HaloTicket,
  ClientCache,
} from '@/types/halo';

interface UseTriageDispatchFormProps {
  ticket: HaloTicket;
  clientCache: ClientCache | null;
  dropLocation?: {
    agentId: number;
    startTime: Date;
  };
}

export interface TriageDispatchFormValues {
  triage: TriageFormData;
  dispatch: DispatchFormData;
}

export interface FormValidationErrors {
  triage?: Partial<Record<keyof TriageFormData, string>>;
  dispatch?: Partial<Record<keyof DispatchFormData, string>>;
}

export function useTriageDispatchForm({
  ticket,
  clientCache,
  dropLocation,
}: UseTriageDispatchFormProps) {
  // Calculate initial end time (30 minutes from start)
  const initialEndTime = dropLocation?.startTime
    ? new Date(dropLocation.startTime.getTime() + 30 * 60 * 1000)
    : null;

  // Get default ticket type (first by ID)
  const defaultTicketTypeId = useMemo(() => {
    if (ticket.tickettype_id) return ticket.tickettype_id;
    const ticketTypes = clientCache?.tickettypes
      .filter((type) => type.cancreate && type.visible)
      .sort((a, b) => a.id - b.id);
    return ticketTypes?.[0]?.id || null;
  }, [ticket.tickettype_id, clientCache]);

  // Get default appointment type (first by ID from lookup 63)
  const defaultAppointmentTypeId = useMemo(() => {
    const appointmentTypes = clientCache?.lookups
      ?.filter((l) => l.lookupid === 63)
      .sort((a, b) => a.id - b.id);
    const firstId = appointmentTypes?.[0]?.id;
    return firstId ?? null;
  }, [clientCache]);

  // Construct user object from ticket data if available
  const initialUser: HaloUser | null = useMemo(() => {
    if (!ticket.user_id) return null;
    return {
      id: ticket.user_id,
      name: ticket.user_name || '',
      client_id: ticket.client_id,
      client_name: ticket.client_name || '',
      site_id: ticket.site_id,
      site_name: ticket.site_name || '',
      // Required fields with defaults
      site_id_int: ticket.site_id,
      firstname: '',
      surname: '',
      initials: '',
      title: '',
      emailaddress: '',
      phonenumber_preferred: '',
      sitephonenumber: '',
      phonenumber: '',
      fax: '',
      telpref: 0,
      activedirectory_dn: '',
      onpremise_activedirectory_dn: '',
      login: '',
      inactive: false,
      colour: '',
      isimportantcontact: false,
      other1: '',
      other2: '',
      neversendemails: false,
      priority_id: 0,
      linked_agent_id: 0,
      isserviceaccount: false,
      isimportantcontact2: false,
      connectwiseid: 0,
      autotaskid: 0,
      messagegroup_id: 0,
      sitetimezone: '',
      client_account_manager_id: 0,
      use: '',
      key: 0,
      table: 0,
      overridepdftemplatequote: 0,
      is_prospect: false,
      azureoid: '',
      approver_note_hint: '',
    };
  }, [ticket]);

  // Get agent and team from drop location
  const dropAgent = useMemo(() => {
    if (!dropLocation?.agentId || !clientCache) return null;
    const agent = clientCache.agents.find((a) => a.id === dropLocation.agentId);
    return agent;
  }, [dropLocation, clientCache]);

  // Initial form state
  const [triage, setTriage] = useState<TriageFormData>({
    user_id: ticket.user_id || null,
    user: initialUser,
    tickettype_id: defaultTicketTypeId,
    summary: ticket.summary || '',
    impact: ticket.impact || 3, // Default to Medium (3)
    urgency: ticket.urgency || 3, // Default to Medium (3)
    category_1: ticket.category_1 || '',
    // If dropped on specific agent's calendar, use that agent's team and id
    team: dropAgent?.team || ticket.team || '',
    agent_id: dropAgent?.id || ticket.agent_id || 1, // Default to Unassigned (1)
  });

  const [dispatch, setDispatch] = useState<DispatchFormData>({
    subject: ticket.summary || '',
    start_date: dropLocation?.startTime || null,
    end_date: initialEndTime,
    // Use drop agent if available, otherwise ticket agent
    agent_id: dropAgent?.id || ticket.agent_id || null,
    appointment_type_id: defaultAppointmentTypeId,
    attendees: '',
    note_html: '',
    appointment_location: null, // Leave empty per user preference
  });

  // Track initial values to determine what changed
  const [initialTriage] = useState(triage);
  const [errors, setErrors] = useState<FormValidationErrors>({});

  // Update agent and team when dropped on specific agent's calendar
  useEffect(() => {
    if (dropAgent) {
      setTriage((prev) => ({
        ...prev,
        agent_id: dropAgent.id,
        team: dropAgent.team,
      }));
      setDispatch((prev) => ({
        ...prev,
        agent_id: dropAgent.id,
      }));
    }
  }, [dropAgent]);

  // Update ticket type when default is calculated (if not already set)
  useEffect(() => {
    if (defaultTicketTypeId !== null && triage.tickettype_id === null) {
      setTriage((prev) => ({ ...prev, tickettype_id: defaultTicketTypeId }));
    }
  }, [defaultTicketTypeId, triage.tickettype_id]);

  // Update appointment type when default is calculated (if not already set)
  useEffect(() => {
    if (defaultAppointmentTypeId !== null && dispatch.appointment_type_id === null) {
      setDispatch((prev) => ({ ...prev, appointment_type_id: defaultAppointmentTypeId }));
    }
  }, [defaultAppointmentTypeId, dispatch.appointment_type_id]);

  // Update triage fields
  const updateTriage = useCallback(
    (updates: Partial<TriageFormData>) => {
      setTriage((prev) => ({ ...prev, ...updates }));

      // Sync agent to dispatch section when changed in triage
      if (updates.agent_id !== undefined) {
        setDispatch((prev) => ({ ...prev, agent_id: updates.agent_id }));
      }
    },
    []
  );

  // Update dispatch fields
  const updateDispatch = useCallback(
    (updates: Partial<DispatchFormData>) => {
      setDispatch((prev) => ({ ...prev, ...updates }));
    },
    []
  );

  // When user is selected, update related fields
  const handleUserSelect = useCallback(
    (user: HaloUser | null) => {
      if (user) {
        updateTriage({
          user_id: user.id,
          user,
        });
      } else {
        updateTriage({
          user_id: null,
          user: null,
        });
      }
    },
    [updateTriage]
  );

  // Calculate duration from start and end dates
  const calculateDuration = useCallback(
    (startDate: Date, endDate: Date): number => {
      return Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60));
    },
    []
  );

  // Set duration using preset buttons (15, 30, 45, 60 minutes)
  const setDuration = useCallback(
    (minutes: number) => {
      if (dispatch.start_date) {
        const endDate = new Date(
          dispatch.start_date.getTime() + minutes * 60 * 1000
        );
        updateDispatch({ end_date: endDate });
      }
    },
    [dispatch.start_date, updateDispatch]
  );

  // Determine if triage fields have changed
  const triageHasChanged = useMemo(() => {
    return (
      triage.user_id !== initialTriage.user_id ||
      triage.tickettype_id !== initialTriage.tickettype_id ||
      triage.summary !== initialTriage.summary ||
      triage.impact !== initialTriage.impact ||
      triage.urgency !== initialTriage.urgency ||
      triage.category_1 !== initialTriage.category_1 ||
      triage.team !== initialTriage.team ||
      triage.agent_id !== initialTriage.agent_id
    );
  }, [triage, initialTriage]);

  // Validate form
  const validate = useCallback((): boolean => {
    const newErrors: FormValidationErrors = {};

    // Validate triage
    if (!triage.user_id) {
      newErrors.triage = { ...newErrors.triage, user_id: 'User is required' };
    }
    if (!triage.summary.trim()) {
      newErrors.triage = { ...newErrors.triage, summary: 'Summary is required' };
    }
    if (!triage.tickettype_id) {
      newErrors.triage = {
        ...newErrors.triage,
        tickettype_id: 'Ticket type is required',
      };
    }

    // Validate dispatch
    if (!dispatch.start_date) {
      newErrors.dispatch = {
        ...newErrors.dispatch,
        start_date: 'Start date is required',
      };
    }
    if (!dispatch.end_date) {
      newErrors.dispatch = {
        ...newErrors.dispatch,
        end_date: 'End date is required',
      };
    }
    if (dispatch.start_date && dispatch.end_date) {
      if (dispatch.end_date <= dispatch.start_date) {
        newErrors.dispatch = {
          ...newErrors.dispatch,
          end_date: 'End date must be after start date',
        };
      }
    }
    if (!dispatch.agent_id) {
      newErrors.dispatch = {
        ...newErrors.dispatch,
        agent_id: 'Agent is required',
      };
    }
    if (!dispatch.appointment_type_id) {
      newErrors.dispatch = {
        ...newErrors.dispatch,
        appointment_type_id: 'Appointment type is required',
      };
    }
    if (!dispatch.subject.trim()) {
      newErrors.dispatch = {
        ...newErrors.dispatch,
        subject: 'Subject is required',
      };
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [triage, dispatch]);

  // Get error for a specific field
  const getError = useCallback(
    (section: 'triage' | 'dispatch', field: string): string | undefined => {
      return errors[section]?.[field as keyof (TriageFormData | DispatchFormData)];
    },
    [errors]
  );

  return {
    triage,
    dispatch,
    updateTriage,
    updateDispatch,
    handleUserSelect,
    setDuration,
    calculateDuration,
    triageHasChanged,
    validate,
    getError,
    errors,
  };
}
