export type EventAcquisitionOperatorStatus =
  "scheduled" | "live" | "ended" | "cancelled";

export type EventTerminalSource =
  | { kind: "occurrences"; value: unknown }
  | { kind: "single_end"; endAtUtc: string | null };

export type EventTerminalResolution =
  | { kind: "known"; endAtUtc: string; endAtMs: number }
  | {
      kind: "unavailable";
      reason:
        | "occurrences_missing"
        | "occurrences_invalid"
        | "single_end_missing"
        | "single_end_invalid";
    };

export interface EventAcquisitionInput {
  operatorStatus: EventAcquisitionOperatorStatus;
  operatorEndedAtUtc: string | null;
  /** Canonical production source. Standard ticketed events use occurrences. */
  terminalSource?: EventTerminalSource;
  /** Legacy scalar compatibility for frozen #1902 callers and RSVP records. */
  masterEndAtUtc?: string | null;
}

export type EventAcquisitionState =
  | { kind: "current" }
  | {
      kind: "ended";
      reason: "operator_status" | "operator_ended_at" | "master_end";
    }
  | { kind: "cancelled" }
  | {
      kind: "unavailable";
      reason:
        | "master_end_missing"
        | "master_end_invalid"
        | "occurrences_missing"
        | "occurrences_invalid";
    };

const EXPLICIT_OFFSET_TIMESTAMP = /(?:Z|[+-]\d{2}:\d{2})$/;

const parseFiniteTimestamp = (value: string): number | null => {
  if (!EXPLICIT_OFFSET_TIMESTAMP.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const resolveEventTerminal = (
  source: EventTerminalSource,
): EventTerminalResolution => {
  if (source.kind === "single_end") {
    if (source.endAtUtc === null || source.endAtUtc.trim().length === 0) {
      return { kind: "unavailable", reason: "single_end_missing" };
    }
    const endAtMs = parseFiniteTimestamp(source.endAtUtc);
    return endAtMs === null
      ? { kind: "unavailable", reason: "single_end_invalid" }
      : { kind: "known", endAtUtc: new Date(endAtMs).toISOString(), endAtMs };
  }

  if (!Array.isArray(source.value) || source.value.length === 0) {
    return { kind: "unavailable", reason: "occurrences_missing" };
  }

  const ids = new Set<string>();
  let terminalEndMs = Number.NEGATIVE_INFINITY;
  for (const candidate of source.value) {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return { kind: "unavailable", reason: "occurrences_invalid" };
    }
    const row = candidate as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const startAt = typeof row.startAt === "string" ? row.startAt : null;
    const endAt = typeof row.endAt === "string" ? row.endAt : null;
    if (id.length === 0 || ids.has(id) || startAt === null || endAt === null) {
      return { kind: "unavailable", reason: "occurrences_invalid" };
    }
    const startAtMs = parseFiniteTimestamp(startAt);
    const endAtMs = parseFiniteTimestamp(endAt);
    if (startAtMs === null || endAtMs === null || endAtMs <= startAtMs) {
      return { kind: "unavailable", reason: "occurrences_invalid" };
    }
    ids.add(id);
    terminalEndMs = Math.max(terminalEndMs, endAtMs);
  }

  return {
    kind: "known",
    endAtUtc: new Date(terminalEndMs).toISOString(),
    endAtMs: terminalEndMs,
  };
};

const terminalSourceForInput = (input: EventAcquisitionInput): EventTerminalSource =>
  input.terminalSource ?? {
    kind: "single_end",
    endAtUtc: input.masterEndAtUtc ?? null,
  };

export const resolveEventAcquisitionState = (
  input: EventAcquisitionInput,
  nowMs: number = Date.now(),
): EventAcquisitionState => {
  if (input.operatorStatus === "cancelled") return { kind: "cancelled" };
  if (input.operatorStatus === "ended") {
    return { kind: "ended", reason: "operator_status" };
  }
  if (input.operatorEndedAtUtc !== null) {
    const operatorEndedAtMs = parseFiniteTimestamp(input.operatorEndedAtUtc);
    if (operatorEndedAtMs !== null) {
      return { kind: "ended", reason: "operator_ended_at" };
    }
  }
  const terminal = resolveEventTerminal(terminalSourceForInput(input));
  if (terminal.kind === "unavailable") {
    if (input.terminalSource?.kind === "occurrences") {
      return {
        kind: "unavailable",
        reason:
          terminal.reason === "occurrences_missing"
            ? "occurrences_missing"
            : "occurrences_invalid",
      };
    }
    return {
      kind: "unavailable",
      reason:
        terminal.reason === "single_end_missing"
          ? "master_end_missing"
          : "master_end_invalid",
    };
  }
  if (terminal.endAtMs <= nowMs) {
    return { kind: "ended", reason: "master_end" };
  }
  return { kind: "current" };
};

export const nextEventAcquisitionBoundaryDelayMs = (
  inputs: ReadonlyArray<EventAcquisitionInput>,
  nowMs: number = Date.now(),
): number | null => {
  let nearestEndMs: number | null = null;
  for (const input of inputs) {
    if (
      input.operatorStatus !== "scheduled" &&
      input.operatorStatus !== "live"
    ) {
      continue;
    }
    if (input.operatorEndedAtUtc !== null) continue;
    const terminal = resolveEventTerminal(terminalSourceForInput(input));
    if (terminal.kind === "unavailable" || terminal.endAtMs <= nowMs) continue;
    if (nearestEndMs === null || terminal.endAtMs < nearestEndMs) {
      nearestEndMs = terminal.endAtMs;
    }
  }
  return nearestEndMs === null
    ? null
    : Math.min(2_147_483_000, Math.max(0, nearestEndMs - nowMs));
};

export interface EventAcquisitionNoticeCopy {
  eyebrow: "PAST EVENT" | "SCHEDULE UNAVAILABLE" | "CANCELLED";
  heading: string;
  body: string;
  announcement: string;
}

export const eventAcquisitionNoticeCopy = (
  state: Exclude<EventAcquisitionState, { kind: "current" }>,
  eventType: "event" | "rsvp",
  brandName: string,
): EventAcquisitionNoticeCopy => {
  if (state.kind === "cancelled") {
    if (eventType === "event") {
      const body = `${brandName} has cancelled this event. If you purchased tickets, you will receive refund details by email.`;
      return {
        eyebrow: "CANCELLED",
        heading: "This event has been cancelled",
        body,
        announcement: `This event has been cancelled. ${body}`,
      };
    }
    const body = `${brandName} has cancelled this event. RSVPs are closed.`;
    return {
      eyebrow: "CANCELLED",
      heading: "This event has been cancelled",
      body,
      announcement: `This event has been cancelled. ${body}`,
    };
  }
  if (state.kind === "ended") {
    const body =
      eventType === "rsvp"
        ? "This event has ended. RSVPs are closed."
        : "This event has ended. Ticket sales are closed.";
    return {
      eyebrow: "PAST EVENT",
      heading: "Event ended",
      body,
      announcement: `Event ended. ${body}`,
    };
  }
  const heading =
    eventType === "rsvp" ? "RSVP unavailable" : "Booking unavailable";
  const body =
    eventType === "rsvp"
      ? "This event’s schedule is unavailable, so RSVPs are closed."
      : "This event’s schedule is unavailable, so ticket sales are closed.";
  return {
    eyebrow: "SCHEDULE UNAVAILABLE",
    heading,
    body,
    announcement: `${heading}. ${body}`,
  };
};

/**
 * issue #2562 [a past event was still purchasable] — the state a CLIENT is
 * allowed to forward to the renderer.
 *
 * `computeOfferingVariant` decides "past" from `status === "ended"` OR from
 * `acquisitionState`. Explorer set NEITHER from the clock — it forwarded the
 * operator's `status`, and a finished event is still `scheduled` (status
 * describes the LISTING, not the calendar). So the native screen offered
 * "Buy ticket" and "28 tickets left" on an event that had ended a month
 * earlier, while the buyer web showed "PAST EVENT — ticket sales are closed"
 * for that same event and the server accepted a checkout session for it.
 *
 * FAIL SAFE ON MISSING DATA, which is why this is not a pass-through. The
 * resolver above answers `unavailable` when there is no master end time, and
 * `computeOfferingVariant` treats `unavailable` as PAST. Forwarding that
 * blindly would mark a live event as finished the moment its end time went
 * missing — a worse bug than the one being fixed, because it would silently
 * stop sales on events that are still selling. So only a DEFINITE `ended` or
 * `cancelled` is forwarded; anything else is left `undefined` and the screen
 * behaves exactly as it does today.
 *
 * Same principle as the server guard in migration 20270525002562: absence of
 * data is not evidence of an ending.
 *
 * @param status         the operator's listing status as it arrives on the payload
 * @param masterEndAtUtc the last occurrence's end time, ISO-8601, or null
 * @param nowMs          injectable clock; defaults to the real one
 */
export const forwardableAcquisitionState = (
  status: string | null | undefined,
  terminalSourceOrEndAtUtc: EventTerminalSource | string | null,
  nowMs: number = Date.now(),
): EventAcquisitionState | undefined => {
  const explicitOccurrenceSource =
    typeof terminalSourceOrEndAtUtc === "object" &&
    terminalSourceOrEndAtUtc?.kind === "occurrences";
  const resolved = resolveEventAcquisitionState(
    {
      operatorStatus:
        status === "cancelled"
          ? "cancelled"
          : status === "ended"
            ? "ended"
            : "scheduled",
      operatorEndedAtUtc: null,
      ...(typeof terminalSourceOrEndAtUtc === "object" &&
      terminalSourceOrEndAtUtc !== null
        ? { terminalSource: terminalSourceOrEndAtUtc }
        : { masterEndAtUtc: terminalSourceOrEndAtUtc }),
    },
    nowMs,
  );
  return resolved.kind === "ended" ||
    resolved.kind === "cancelled" ||
    (explicitOccurrenceSource && resolved.kind === "unavailable")
    ? resolved
    : undefined;
};
