export type EventAcquisitionOperatorStatus =
  "scheduled" | "live" | "ended" | "cancelled";

export interface EventAcquisitionInput {
  operatorStatus: EventAcquisitionOperatorStatus;
  operatorEndedAtUtc: string | null;
  masterEndAtUtc: string | null;
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
      reason: "master_end_missing" | "master_end_invalid";
    };

const parseFiniteTimestamp = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  if (input.masterEndAtUtc === null) {
    return { kind: "unavailable", reason: "master_end_missing" };
  }
  const masterEndAtUtcMs = parseFiniteTimestamp(input.masterEndAtUtc);
  if (masterEndAtUtcMs === null) {
    return { kind: "unavailable", reason: "master_end_invalid" };
  }
  if (masterEndAtUtcMs <= nowMs) {
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
    if (input.masterEndAtUtc === null) continue;
    const endMs = parseFiniteTimestamp(input.masterEndAtUtc);
    if (endMs === null || endMs <= nowMs) continue;
    if (nearestEndMs === null || endMs < nearestEndMs) nearestEndMs = endMs;
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
