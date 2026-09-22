const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const REQUIRED_KEYS = ["v", "kind", "event", "source", "token"];
// #3524 — the desktop->phone handoff form carries `hc` (a short-lived exchange
// code) where the email form carries `token`. Same alphabet and length, a
// DIFFERENT credential: ten minutes, one use, and it is the only one a QR may
// carry. Exactly five keys either way, and exactly one of the two.
const HANDOFF_KEYS = ["v", "kind", "event", "source", "hc"];

export const ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY =
  "__minglaAttendanceClaimFragment";

export const ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP =
  `(()=>{const w=window,l=w.location,h=w.history;if(l.pathname!=="/attendance/claim"||l.hash==="")return;const f=l.hash.slice(1),u=l.pathname+l.search,s=h.state,v=Object.freeze({fragment:f,cleanUrl:u,historyState:s});Object.defineProperty(w,"${ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY}",{value:v,writable:false,enumerable:false,configurable:true});h.replaceState(s,"",u);})();`;

export type AttendanceClaimFragmentHandoff = Readonly<{
  fragment: string;
  cleanUrl: string;
  historyState: unknown;
}>;

type AttendanceClaimLocation = Readonly<{
  pathname: string;
  search: string;
}>;
type AttendanceClaimHistory = {
  readonly state?: unknown;
  replaceState(state: unknown, unused: string, url: string): void;
};
type AttendanceClaimWindow = {
  readonly history: AttendanceClaimHistory;
  readonly location: AttendanceClaimLocation & Readonly<{ hash: string }>;
  [ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY]?: unknown;
};
type AttendanceClaimFrameCallback = (timestamp: number) => void;
type AttendanceClaimRequestFrame = (
  callback: AttendanceClaimFrameCallback,
) => number;

const isAttendanceClaimFragmentHandoff = (
  value: unknown,
): value is AttendanceClaimFragmentHandoff =>
  typeof value === "object" && value !== null &&
  typeof (value as { fragment?: unknown }).fragment === "string" &&
  typeof (value as { cleanUrl?: unknown }).cleanUrl === "string" &&
  "historyState" in value;

export const consumeAttendanceClaimFragment = (
  browserWindow: AttendanceClaimWindow,
  directHashFragment = browserWindow.location.hash.replace(/^#/, ""),
): AttendanceClaimFragmentHandoff => {
  const hasBootstrapHandoff = Object.prototype.hasOwnProperty.call(
    browserWindow,
    ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY,
  );
  const capturedFragment = hasBootstrapHandoff
    ? browserWindow[ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY]
    : undefined;
  if (hasBootstrapHandoff) {
    delete browserWindow[ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY];
  }
  return isAttendanceClaimFragmentHandoff(capturedFragment)
    ? capturedFragment
    : {
        fragment: directHashFragment,
        cleanUrl: `${browserWindow.location.pathname}${browserWindow.location.search}`,
        historyState: browserWindow.history.state,
      };
};

type AttendanceClaimScrubCapture = Readonly<
  Pick<AttendanceClaimFragmentHandoff, "cleanUrl" | "historyState">
>;

export const scrubAttendanceClaimFragment = (
  location: AttendanceClaimLocation,
  history: AttendanceClaimHistory,
  requestFrame: AttendanceClaimRequestFrame,
  captured?: AttendanceClaimScrubCapture,
): (() => void) => {
  const cleanUrl = captured?.cleanUrl ?? `${location.pathname}${location.search}`;
  const historyState = captured ? captured.historyState : history.state;
  const scrub = (): void => history.replaceState(historyState, "", cleanUrl);
  const scrubAfterRouterReconciliation = (): void => {
    scrub();
    requestFrame(scrub);
  };
  scrub();
  requestFrame(scrubAfterRouterReconciliation);
  return (): void => {
    requestFrame(scrub);
  };
};

export const createAttendanceClaimFragmentScrubber = (
  handoff: AttendanceClaimFragmentHandoff,
) => {
  const captured: AttendanceClaimScrubCapture = {
    cleanUrl: handoff.cleanUrl,
    historyState: handoff.historyState,
  };
  return (
    location: AttendanceClaimLocation,
    history: AttendanceClaimHistory,
    requestFrame: AttendanceClaimRequestFrame,
  ): (() => void) => scrubAttendanceClaimFragment(
    location,
    history,
    requestFrame,
    captured,
  );
};

/**
 * #3524 — the VALIDATED components of a claim fragment, or null.
 *
 * One validator, two consumers: `attendanceAppUrlFromFragment` builds the app
 * scheme from it, and the desktop scan sheet needs the same `kind` / `event` /
 * `source` / token to ask the server for a handoff code. A second parser on the
 * page would be a second place for the exhaustiveness rule to drift.
 */
export type ParsedAttendanceClaimFragment = Readonly<{
  kind: "order" | "rsvp";
  eventId: string;
  sourceId: string;
  credentialKey: "token" | "hc";
  credential: string;
}>;

export const attendanceClaimFromFragment = (
  raw: string,
): ParsedAttendanceClaimFragment | null => {
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  // #3524 — pick the shape by which credential key is present, then validate
  // that shape EXHAUSTIVELY. The exhaustiveness is the #871/#2979 protection and
  // it is not relaxed: five keys, no duplicates, no strangers, and never both
  // `token` and `hc`.
  const shape = keys.includes("hc") ? HANDOFF_KEYS : REQUIRED_KEYS;
  if (keys.includes("hc") && keys.includes("token")) return null;
  if (
    keys.length !== shape.length ||
    shape.some((key) => params.getAll(key).length !== 1) ||
    keys.some((key) => !shape.includes(key))
  ) return null;
  const kind = params.get("kind");
  const event = params.get("event");
  const source = params.get("source");
  const credentialKey = shape === HANDOFF_KEYS ? "hc" : "token";
  const credential = params.get(credentialKey);
  if (
    params.get("v") !== "1" || (kind !== "order" && kind !== "rsvp") ||
    event === null || source === null || credential === null ||
    !UUID.test(event) || !UUID.test(source) || !TOKEN.test(credential)
  ) return null;
  return {
    kind,
    eventId: event,
    sourceId: source,
    credentialKey,
    credential,
  };
};

export const attendanceAppUrlFromFragment = (raw: string): string | null => {
  const parsed = attendanceClaimFromFragment(raw);
  if (parsed === null) return null;
  const fragment = new URLSearchParams({
    v: "1",
    kind: parsed.kind,
    event: parsed.eventId,
    source: parsed.sourceId,
    [parsed.credentialKey]: parsed.credential,
  }).toString();
  return `com.mingla.app.v2://attendance-claim#${fragment}`;
};

type VisibilityDocument = {
  visibilityState: string;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
};

/**
 * Open the claim deep link first, and fall back once the app has demonstrably
 * NOT taken the navigation.
 *
 * `fallbackUrl` (issue #2217) overrides the destination of that fallback
 * WITHOUT changing when it fires. The confirmation screen passes the
 * device-aware store URL there, because a buyer whose tap did not open the app
 * does not have the app — sending them to the `/attendance/claim` interstitial
 * only retries the same scheme that just failed and then shows them a CHOICE of
 * two stores, which is the two-button defect #2217 exists to delete. Every
 * other caller (the emailed recovery link, which has no browser JS context to
 * resolve a platform) omits it and keeps the interstitial verbatim.
 */
export const openAttendanceClaimWithFallback = async (
  links: { appClaimUrl: string; webClaimUrl: string; fallbackUrl?: string },
  openUrl: (url: string) => Promise<unknown>,
  visibilityDocument: VisibilityDocument | null =
    (globalThis as unknown as { document?: VisibilityDocument }).document ??
      null,
  schedule: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout> = setTimeout,
  cancelSchedule: (handle: ReturnType<typeof setTimeout>) => void =
    clearTimeout,
): Promise<void> => {
  let settled = false;
  let fallbackHandle: ReturnType<typeof setTimeout> | null = null;
  const cleanup = (): void => {
    if (fallbackHandle !== null) cancelSchedule(fallbackHandle);
    visibilityDocument?.removeEventListener(
      "visibilitychange",
      onVisibilityChange,
    );
  };
  const fallback = (): void => {
    if (settled) return;
    settled = true;
    cleanup();
    void openUrl(links.fallbackUrl ?? links.webClaimUrl);
  };
  const onVisibilityChange = (): void => {
    if (visibilityDocument?.visibilityState !== "hidden") return;
    settled = true;
    cleanup();
  };
  visibilityDocument?.addEventListener("visibilitychange", onVisibilityChange);
  try {
    await openUrl(links.appClaimUrl);
  } catch {
    fallback();
    return;
  }
  if (!settled && visibilityDocument !== null) {
    fallbackHandle = schedule(fallback, 1200);
  }
};
