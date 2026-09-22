/**
 * #3524 — WHICH credential arrived.
 *
 *   token   — from the confirmation email. Verified against the order's stored
 *             digest. 30-day window.
 *   handoff — from the desktop scan sheet. Consumed single-use on redemption.
 *             10-minute window.
 *
 * This REPLACES the old bare `token: string` field rather than sitting beside it.
 * With both present a call site could read the wrong one and silently send a
 * handoff code where a token was expected; with one discriminated field that is
 * not representable.
 */
export type AttendanceClaimCredential =
  | { kind: "token"; value: string }
  | { kind: "handoff"; value: string };

export type ParsedAttendanceClaim = {
  version: 1;
  kind: "order" | "rsvp";
  eventId: string;
  sourceId: string;
  credential: AttendanceClaimCredential;
};

export type AttendanceClaimAuthAction = "none" | "clear" | "resume" | "preserve";

export type AttendanceClaimSingleFlight = {
  run: (task: () => Promise<void>) => Promise<void>;
  isActive: () => boolean;
};

export type AttendanceClaimReviewModalPolicy = {
  render: boolean;
};

export const attendanceClaimReviewModalPolicy = (
  attendanceClaimVisible: boolean,
  hasActiveReviewTarget: boolean,
): AttendanceClaimReviewModalPolicy => ({
  render: !attendanceClaimVisible && hasActiveReviewTarget,
});

export const createAttendanceClaimSingleFlight =
  (): AttendanceClaimSingleFlight => {
    let active: Promise<void> | null = null;
    return {
      run: (task): Promise<void> => {
        if (active !== null) return active;
        let invocation: Promise<void>;
        invocation = task().finally(() => {
          if (active === invocation) active = null;
        });
        active = invocation;
        return invocation;
      },
      isActive: (): boolean => active !== null,
    };
  };

/**
 * What the pending claim should do when the signed-in account changes.
 *
 * "clear" EXISTS FOR A REASON AND IT IS NOT NEGOTIABLE: account A's claim intent
 * must not follow the device into account B. Somebody signs out, hands the phone
 * over, and the next person must not inherit a pending ticket.
 *
 * #3524 ADDS "preserve", AND IT IS NOT A HOLE IN THAT RULE. It fires only when
 * `handoffActive` is true, and that marker is written by exactly one action — the
 * guest tapping "Use a different account" on the claim sheet, immediately before
 * sign-out — with a 30-minute life. So "preserve" means "this flow CAUSED the
 * account change", not "an account change happened".
 *
 * And even then the claim still cannot land on the wrong account: the server
 * requires the new account to independently prove it owns the order's purchase
 * email or phone (`public.account_owns_order_contact`). TWO GUARDS, NOT ONE. A
 * forged marker buys an attacker a sheet they cannot complete.
 *
 * "preserve" performs NO state change: it does not clear the intent, does not
 * clear the marker, and does not open or close the sheet. The following
 * null -> new-user-id transition is an ordinary "resume".
 */
export const attendanceClaimAuthAction = (
  previousUserId: string | null | undefined,
  nextUserId: string | null,
  hasIntent: boolean,
  handoffActive = false,
): AttendanceClaimAuthAction => {
  if (previousUserId === undefined) return "none";
  if (previousUserId !== null && previousUserId !== nextUserId) {
    return handoffActive ? "preserve" : "clear";
  }
  if (previousUserId === null && nextUserId !== null && hasIntent) {
    return "resume";
  }
  return "none";
};

export type RosterAuthorizationFailure =
  | "attendance_required"
  | "guest_list_private"
  | "event_not_available";

export const rosterDenialPolicy = (
  failure: RosterAuthorizationFailure | null,
  hadRows: boolean,
): { purge: boolean; revoked: boolean } => ({
  purge: failure !== null,
  revoked: failure !== null && hadRows,
});

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const NATIVE_PREFIX = "com.mingla.app.v2://attendance-claim#";
const WEB_PREFIX = "https://host.usemingla.com/attendance/claim#";

export const isAttendanceClaimUrl = (url: string): boolean =>
  url.startsWith(NATIVE_PREFIX) || url.startsWith(WEB_PREFIX);

export const parseAttendanceClaimUrl = (
  url: string,
): ParsedAttendanceClaim | null => {
  if (!isAttendanceClaimUrl(url)) return null;
  const hashIndex = url.indexOf("#");
  if (hashIndex < 0) return null;
  const params = new URLSearchParams(url.slice(hashIndex + 1));
  const keys = [...params.keys()];
  // #3524 — either the emailed `token` form or the scanned `hc` form. The
  // exhaustiveness stays exhaustive: five keys, no duplicates, no strangers, and
  // NEVER both credentials. Relaxing that is how a claim boundary starts
  // tolerating shapes nobody designed.
  if (keys.includes("token") && keys.includes("hc")) return null;
  const credentialKey: "token" | "hc" = keys.includes("hc") ? "hc" : "token";
  const requiredKeys = ["v", "kind", "event", "source", credentialKey];
  if (
    keys.length !== requiredKeys.length ||
    requiredKeys.some((key) => params.getAll(key).length !== 1) ||
    keys.some((key) => !requiredKeys.includes(key))
  ) return null;
  const kind = params.get("kind");
  const eventId = params.get("event");
  const sourceId = params.get("source");
  const credential = params.get(credentialKey);
  if (
    params.get("v") !== "1" || (kind !== "order" && kind !== "rsvp") ||
    eventId === null || sourceId === null || credential === null ||
    !UUID.test(eventId) || !UUID.test(sourceId) || !TOKEN.test(credential)
  ) return null;
  return {
    version: 1,
    kind,
    eventId,
    sourceId,
    credential: {
      kind: credentialKey === "hc" ? "handoff" : "token",
      value: credential,
    },
  };
};
