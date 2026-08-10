export type ParsedAttendanceClaim = {
  version: 1;
  kind: "order" | "rsvp";
  eventId: string;
  sourceId: string;
  token: string;
};

export type AttendanceClaimAuthAction = "none" | "clear" | "resume";

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

export const attendanceClaimAuthAction = (
  previousUserId: string | null | undefined,
  nextUserId: string | null,
  hasIntent: boolean,
): AttendanceClaimAuthAction => {
  if (previousUserId === undefined) return "none";
  if (previousUserId !== null && previousUserId !== nextUserId) return "clear";
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
const WEB_PREFIX = "https://business.usemingla.com/attendance/claim#";

export const isAttendanceClaimUrl = (url: string): boolean =>
  url.startsWith(NATIVE_PREFIX) || url.startsWith(WEB_PREFIX);

export const parseAttendanceClaimUrl = (
  url: string,
): ParsedAttendanceClaim | null => {
  if (!isAttendanceClaimUrl(url)) return null;
  const hashIndex = url.indexOf("#");
  if (hashIndex < 0) return null;
  const params = new URLSearchParams(url.slice(hashIndex + 1));
  const requiredKeys = ["v", "kind", "event", "source", "token"];
  if (
    [...params.keys()].length !== requiredKeys.length ||
    requiredKeys.some((key) => params.getAll(key).length !== 1) ||
    [...params.keys()].some((key) => !requiredKeys.includes(key))
  ) return null;
  const kind = params.get("kind");
  const eventId = params.get("event");
  const sourceId = params.get("source");
  const token = params.get("token");
  if (
    params.get("v") !== "1" || (kind !== "order" && kind !== "rsvp") ||
    eventId === null || sourceId === null || token === null ||
    !UUID.test(eventId) || !UUID.test(sourceId) || !TOKEN.test(token)
  ) return null;
  return { version: 1, kind, eventId, sourceId, token };
};
