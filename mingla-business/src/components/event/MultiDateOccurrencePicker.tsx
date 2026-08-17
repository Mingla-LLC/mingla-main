/**
 * MultiDateOccurrencePicker — issue #2135 [multi-date public day picker].
 *
 * The LAZY multi-date leg of the public event page. It owns exactly two things:
 *
 *   1. the anon read of this event's materialised `event_dates` occurrences, and
 *   2. the mount of the SHARED `ExperienceReservePicker` (mode="slots").
 *
 * WHY it is a separate, lazily-imported module rather than code inside
 * PublicEventPage (same reasoning as `SeeWhosGoingGate` right next to it):
 *
 *   - Bundle (ORCH-1083 budget). The picker pulls the `Sheet` primitive, which
 *     pulls expo-blur / gesture-handler / reanimated. The public event page is
 *     the hot buyer-web route; a STATIC import drags that whole chain into the
 *     eager chunk for every event, including the single-date majority that can
 *     never open a picker.
 *   - Cost. A single-date event never renders this component, so it never even
 *     resolves the module, never mounts the query, and never touches Supabase.
 *
 * The host owns the SELECTION state (it is what the checkout URL is built from);
 * this component owns only the fetch and the sheet, and reports the resolved
 * occurrences upward so the host can render its on-page day strip.
 *
 * Anon-tolerant: no useAuth anywhere in the chain.
 */

import React, { useEffect } from "react";

import type { ThemePalette } from "@mingla/offering-rendering";

import { usePublicEventOccurrences } from "../../hooks/usePublicEvents";
import type { PublicEventOccurrence } from "../../services/publicEventOccurrencesService";
import {
  ExperienceReservePicker,
  type ExperienceReserveSelection,
} from "../experience/ExperienceReservePicker";

export interface MultiDateOccurrencePickerProps {
  eventId: string;
  /** The event's IANA zone, used only when an occurrence row carries none. */
  timezone: string;
  palette: ThemePalette;
  /** Bold loaded font family (theme) — passed straight through to the picker. */
  fontFamily?: string;
  /** Open when true; the host decides why it opened (browse vs. checkout). */
  visible: boolean;
  /** Fires whenever the occurrence read resolves (or re-resolves). */
  onOccurrencesResolved: (occurrences: readonly PublicEventOccurrence[]) => void;
  onCancel: () => void;
  /** The chosen occurrence's `event_dates.id`. */
  onConfirm: (eventDateId: string) => void;
}

const EMPTY: readonly PublicEventOccurrence[] = [];

export const MultiDateOccurrencePicker: React.FC<
  MultiDateOccurrencePickerProps
> = ({
  eventId,
  timezone,
  palette,
  fontFamily,
  visible,
  onOccurrencesResolved,
  onCancel,
  onConfirm,
}) => {
  const query = usePublicEventOccurrences(eventId, true, timezone);
  const occurrences = query.data ?? EMPTY;

  useEffect(() => {
    onOccurrencesResolved(occurrences);
  }, [occurrences, onOccurrencesResolved]);

  // Nothing to choose between → render nothing at all (the host's day strip is
  // gated on the same count, so no dead affordance is ever shown).
  if (occurrences.length <= 1) return null;

  return (
    <ExperienceReservePicker
      visible={visible}
      mode="slots"
      dates={occurrences}
      timezone={timezone}
      palette={palette}
      fontFamily={fontFamily}
      // There is NO per-occurrence capacity in the schema, so no per-day count
      // is published rather than a fabricated one (Constitution #9 — see
      // publicEventOccurrencesService for the full argument).
      eventRemaining={null}
      onCancel={onCancel}
      onConfirm={(selection: ExperienceReserveSelection) =>
        onConfirm(selection.eventDateId)
      }
    />
  );
};

export default MultiDateOccurrencePicker;
