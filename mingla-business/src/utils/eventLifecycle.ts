/**
 * eventLifecycle — Derive an event's UI lifecycle status (Cycle 13 extraction).
 *
 * Originally inline in `app/event/[id]/index.tsx:191-203`. Extracted to a
 * shared util in Cycle 13 so the new reconciliation route + Event Detail share
 * the same predicate (single source of truth per Const #2).
 *
 * Three sources fold into the canonical "past" status:
 *   - event.status === "cancelled" (Cycle 9b-1 cancel flow)
 *   - event.endedAt !== null (Cycle 9b-1 manual End sales)
 *   - now > eventDate + 24h (time-based, end of natural live window)
 *
 * Live window: 4h before event.date through 24h after event.date.
 *
 * NOTE: `LiveEventStatus` enum has an "ended" value declared in liveEventStore
 * but client code never sets it — `endedAt: ISO` is used instead (D-CYCLE13-RECON-FOR-2
 * documents the dead-enum observation). This util reads `endedAt` directly.
 *
 * Per Cycle 13 SPEC §4.3.2 + Step 1 implementation order.
 */

import type { LiveEvent } from "../store/liveEventStore";
import {
  resolveEventAcquisitionState,
  type EventAcquisitionState,
  type EventTerminalSource,
} from "@mingla/offering-rendering/eventAcquisitionLifecycle";

export type EventLifecycleStatus = "live" | "upcoming" | "past" | "cancelled";

const LIVE_WINDOW_BEFORE_MS = 4 * 60 * 60 * 1000;
const LIVE_WINDOW_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Maps a LiveEvent to its UI lifecycle bucket. UI consumers branch on this
 * (e.g., HeroStatusPill on Event Detail; headline copy on Reconciliation route).
 *
 * Cycle 13 reconciliation route maps "cancelled" through to its own headline
 * branch (NOT collapsed to "past") to surface the refund/payout-audit framing.
 * Event Detail still collapses cancelled → past for its 3-bucket pill design.
 *
 * ORCH-0828 signature change: takes `masterStartAtUtc` (UTC ISO timestamp)
 * as a required second argument. The pre-0828 single-arg version did
 * `new Date(event.date).getTime()`, which parses `"YYYY-MM-DD"` as UTC
 * midnight — for any non-UTC event this shifted the live window by hours
 * (Big Party at 4pm EDT was classified "live" 20 hours before it started).
 *
 * Callers compute `masterStartAtUtc` via
 * `computeMasterStartAtUtc(event)` from `./eventDateMath`, which prefers
 * the hydrated `event.masterStartAtUtc` field (from `event_dates.start_at`)
 * and falls back to a timezone-aware parse of `event.date + event.doorsOpen`.
 *
 * NEVER pass `event.date` directly here — it is a date-only string and
 * cannot represent the event's wall-clock start time. Enforced by the
 * `forbid-new-Date-on-date-only-string` strict-grep CI gate
 * (`.github/workflows/strict-grep-mingla-business.yml`).
 */
export const deriveLiveStatus = (
  event: LiveEvent,
  masterStartAtUtc: string | null,
): EventLifecycleStatus => {
  if (event.status === "cancelled") return "cancelled";
  if (event.endedAt !== null) return "past";
  if (masterStartAtUtc === null) return "upcoming";
  const eventTime = Date.parse(masterStartAtUtc);
  if (!Number.isFinite(eventTime)) return "upcoming";
  const liveWindowStart = eventTime - LIVE_WINDOW_BEFORE_MS;
  const liveWindowEnd = eventTime + LIVE_WINDOW_AFTER_MS;
  const now = Date.now();
  if (now >= liveWindowStart && now < liveWindowEnd) return "live";
  if (now < liveWindowStart) return "upcoming";
  return "past";
};

/**
 * Single-source-of-truth past check. Returns true iff the event is genuinely
 * over: cancelled, operator-ended (endedAt set), OR master end_at has passed.
 *
 * Use when the caller only needs the past gate (e.g., "hide ticket-purchase
 * CTA", "filter into Past tab"). Pair with `deriveLiveStatus` when the caller
 * needs the full live/upcoming/past trichotomy.
 *
 * Replaces the local copies at:
 *   - mingla-business/app/(tabs)/hub/events.tsx (Past pill via deriveLiveStatus)
 *   - mingla-business/app/checkout/[eventId]/index.tsx (computeIsPast)
 *   - mingla-business/src/components/brand/PublicBrandPage.tsx (Past tab memo)
 *
 * NEVER pass `event.date` directly here — it is a date-only string and
 * cannot represent the event's wall-clock end time. Use
 * `computeMasterEndAtUtc(event)` from `./eventDateMath` to derive the
 * UTC ISO instant. Enforced by strict-grep CI gate
 * `.github/scripts/strict-grep/i-event-lifecycle-single-helper.mjs`.
 *
 * Established by ORCH-0850 [End-not-start parity systemic]. Enforces
 * I-PROPOSED-EVENT-LIFECYCLE-SINGLE-HELPER + I-PROPOSED-LIVE-STATUS-UTC-INPUT.
 */
export type EventCheckoutLifecycleGate =
  | { kind: "current" }
  | {
      kind: "closed";
      acquisitionState: Extract<
        EventAcquisitionState,
        { kind: "ended" | "cancelled" }
      >;
    }
  | {
      kind: "unavailable";
      acquisitionState: Extract<EventAcquisitionState, { kind: "unavailable" }>;
    };

export const resolveEventCheckoutLifecycleGate = (
  event: LiveEvent,
  terminalSource: EventTerminalSource,
  nowMs: number = Date.now(),
): EventCheckoutLifecycleGate => {
  const acquisitionState = resolveEventAcquisitionState(
    {
      operatorStatus:
        event.status === "cancelled"
          ? "cancelled"
          : event.status === "ended"
            ? "ended"
            : event.status === "live"
              ? "live"
              : "scheduled",
      operatorEndedAtUtc: event.endedAt,
      terminalSource,
    },
    nowMs,
  );
  if (acquisitionState.kind === "current") return { kind: "current" };
  if (acquisitionState.kind === "unavailable") {
    return { kind: "unavailable", acquisitionState };
  }
  return { kind: "closed", acquisitionState };
};

export const isEventPast = (
  event: LiveEvent,
  masterEndAtUtc: string | null,
  nowMs: number = Date.now(),
): boolean => {
  const gate = resolveEventCheckoutLifecycleGate(
    event,
    { kind: "single_end", endAtUtc: masterEndAtUtc },
    nowMs,
  );
  return gate.kind === "closed";
};
