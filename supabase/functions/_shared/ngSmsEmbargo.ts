// ===========================================================================
// #2218 — THE NIGERIAN OPERATOR EMBARGO ON THE `generic` ROUTE.
// ===========================================================================
// WHAT A PERSON SAW: a ticket bought at 06:10 WAT with a +234 handset never
// produced a text, while `ticket_order_notifications` recorded status='sent',
// provider='termii', attempt_count=1, last_error=NULL. Termii ACCEPTED the
// request and returned an id; the network never carried the message.
//
// WHY. #1518 moved ALL Nigerian traffic — transactional included — onto
// Termii's `generic` channel, because `dnd` returns 400 "Country Inactive" on
// this account (tracked in #1480, a provider-side activation we do not control).
// `generic` is the PROMOTIONAL route, and Termii's own documentation states the
// constraint plainly:
//
//   "Promotional messages sent through the generic route are subject to time
//    restrictions in Nigeria, telecom operators do not allow delivery between
//    8:00 PM and 8:00 AM."
//   — https://developers.termii.com/campaign
//
// The #1518 header comment already named this cost — "(a) NIGHTLY MTN
// BLACKOUT … Transactional SMS to MTN recipients WILL FAIL every night inside
// that window. Expected behaviour here, not a bug." What was NOT expected, and
// what this module exists to end, is that the failure was INVISIBLE: the send
// path handed the message to a route that cannot carry it, took the provider's
// acceptance as delivery, and wrote `sent`.
//
// THE RULE NOW: inside the embargo, a Nigerian `generic` send is DEFERRED, not
// attempted. Deferral is not a new idea in this codebase — `marketing-send` has
// enforced NG quiet hours of 08:00–20:00 WAT since META-ORCH-1161, which is the
// EXACT COMPLEMENT of this window. The transactional rail simply never learned
// it, because transactional was designed to ride `dnd`, which is exempt. Until
// #1480 lands, both rails share one window and one source of truth: this file.
//
// A DEFERRED MESSAGE IS NOT A DROPPED ONE. It is held and re-attempted when the
// window opens, so the buyer's text ARRIVES — late, but real — and the ledger
// says "held until 08:00 WAT" rather than the false "sent".
//
// WHEN #1480 LANDS: NG transactional moves back to `dnd`, which carries no
// time restriction. At that point the transactional caller stops passing
// `generic` and this guard stops firing for it on its own — no code here has to
// change, and no revert removes the marketing-side protection.
// ===========================================================================

/**
 * Nigeria observes WAT (UTC+1) year-round with NO daylight saving, so a fixed
 * offset would be correct today. We resolve through the IANA zone anyway: a
 * hardcoded +1 is a silent liability the day a zone rule changes, and it is the
 * same class of unfalsifiable constant (`?? "US"`, a hardcoded provider) this
 * area of the codebase has been burned by three times.
 */
export const NG_EMBARGO_TIME_ZONE = "Africa/Lagos";

/** Operators stop carrying `generic` traffic at 20:00 WAT. */
export const NG_GENERIC_EMBARGO_START_HOUR = 20;
/** Operators resume carrying `generic` traffic at 08:00 WAT. */
export const NG_GENERIC_EMBARGO_END_HOUR = 8;

interface LagosWallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const LAGOS_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: NG_EMBARGO_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The Lagos wall clock for an instant. */
export function lagosWallClock(at: Date): LagosWallClock {
  const parts = LAGOS_PARTS.formatToParts(at);
  const read = (type: string): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };
  // Intl renders midnight as hour "24" in some ICU versions under hour12:false.
  const hour = read("hour") % 24;
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour,
    minute: read("minute"),
    second: read("second"),
  };
}

/**
 * TRUE while Nigerian operators refuse `generic` traffic: 20:00 ≤ WAT < 08:00.
 *
 * The window WRAPS MIDNIGHT, so this is an OR, not an AND. Writing it as
 * `hour >= 20 && hour < 8` is vacuously false for every hour of the day — a
 * guard that can never fire, which is precisely the "check that carries no
 * information" family this repo keeps finding. The unit tests below assert
 * both 21:00 and 03:00 to keep that mistake impossible to reintroduce.
 */
export function isNgGenericEmbargoed(at: Date = new Date()): boolean {
  const { hour } = lagosWallClock(at);
  return hour >= NG_GENERIC_EMBARGO_START_HOUR ||
    hour < NG_GENERIC_EMBARGO_END_HOUR;
}

/**
 * The next instant Nigerian operators will carry `generic` traffic — 08:00 WAT,
 * today if it has not yet passed, otherwise tomorrow.
 *
 * Derived by CONSTRUCTION AND CHECK rather than arithmetic on a fixed offset:
 * we build a candidate UTC instant from the Lagos calendar date, then correct
 * it by the difference between the Lagos wall clock it actually produces and
 * the 08:00 we wanted. One correction pass is exact for any fixed-offset zone
 * and converges for any offset change smaller than a day.
 */
export function nextNgGenericWindowOpen(at: Date = new Date()): Date {
  const wall = lagosWallClock(at);
  // After the window opened today, the next opening is tomorrow.
  const rollDay = wall.hour >= NG_GENERIC_EMBARGO_END_HOUR ? 1 : 0;
  const candidate = new Date(
    Date.UTC(
      wall.year,
      wall.month - 1,
      wall.day + rollDay,
      NG_GENERIC_EMBARGO_END_HOUR,
      0,
      0,
      0,
    ),
  );
  const produced = lagosWallClock(candidate);
  const producedMinutes = produced.hour * 60 + produced.minute;
  const wantedMinutes = NG_GENERIC_EMBARGO_END_HOUR * 60;
  // Shortest signed correction across the day boundary.
  let driftMinutes = producedMinutes - wantedMinutes;
  if (driftMinutes > 720) driftMinutes -= 1440;
  if (driftMinutes < -720) driftMinutes += 1440;
  return new Date(candidate.getTime() - driftMinutes * 60_000);
}

// ===========================================================================
// #2218 — THE CLOCK IS A SEAM, BECAUSE A TIME GUARD NOBODY CAN ENTER IS A
// GUARD NOBODY CAN TEST.
// ===========================================================================
// Production never touches this: `ngEmbargoNow()` reads the wall clock. Tests
// pin it, and they MUST — every existing suite that asserts "a +234 send
// reaches Termii" was, before #2218, silently asserting "…and CI happens to be
// running between 08:00 and 20:00 WAT". Those suites were never wrong, they
// were merely unpinned; pinning them is what turns thirteen-hours-a-day-correct
// into always-correct, in both directions.
//
// Restore with `__setNgEmbargoClock(null)` — the harnesses do it in `finally`,
// so a pinned clock can never leak into a neighbouring file.
let embargoClock: () => Date = () => new Date();

export function ngEmbargoNow(): Date {
  return embargoClock();
}

export function __setNgEmbargoClock(fn: (() => Date) | null): void {
  embargoClock = fn ?? (() => new Date());
}

/**
 * Test helper: pin the module clock to an instant that is unambiguously INSIDE
 * the Nigerian carrying window (12:00 WAT), so a suite exercising the ordinary
 * send path is not silently coupled to the hour CI happens to run.
 */
export function __pinNgClockInsideWindow(): void {
  __setNgEmbargoClock(() => new Date("2026-08-18T11:00:00Z")); // 12:00 WAT
}

// ===========================================================================
// #2218 — TERMII ACCEPT-ID RECONCILABILITY.
// ===========================================================================
// Termii identifies a message by a long NUMERIC id — every documented example
// on the send endpoint, the History endpoint (`/api/sms/inbox?message_id=`) and
// the delivery-report webhook uses that one form, and every Nigerian send this
// account has ever made returned it (`3017858407816658717238173`, 2026-08-04;
// `30178310418…`, 2026-07-03/04).
//
// The failing send returned `sig_7678b296aa6240b4864a6dcb294124b4`, and a
// controlled re-send returned `sig_d39356e5a21e477d82194175970f0552`. That
// shape appears NOWHERE in Termii's published API. Whatever it denotes upstream,
// the operational fact is decisive and does not depend on knowing: BOTH of our
// reconciliation routes key on the numeric message id, so an id of this shape
// can never be matched by a delivery report and can never be looked up in
// History. It is an acceptance we are structurally unable to confirm.
//
// So we do not silently treat it as one. `isReconcilableTermiiMessageId` is the
// predicate the reconciler uses to decide whether a positive confirmation is
// even OBTAINABLE; when it is not, the row is surfaced to a human instead of
// resting on `sent` forever.
// ===========================================================================
export function isReconcilableTermiiMessageId(
  providerMessageId: string | null | undefined,
): boolean {
  const trimmed = providerMessageId?.trim() ?? "";
  if (trimmed.length === 0) return false;
  return /^[0-9]+$/.test(trimmed);
}
