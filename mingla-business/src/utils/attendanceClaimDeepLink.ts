const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const REQUIRED_KEYS = ["v", "kind", "event", "source", "token"];

export const attendanceAppUrlFromFragment = (raw: string): string | null => {
  const params = new URLSearchParams(raw);
  if (
    [...params.keys()].length !== REQUIRED_KEYS.length ||
    REQUIRED_KEYS.some((key) => params.getAll(key).length !== 1) ||
    [...params.keys()].some((key) => !REQUIRED_KEYS.includes(key))
  ) return null;
  const kind = params.get("kind");
  const event = params.get("event");
  const source = params.get("source");
  const token = params.get("token");
  if (
    params.get("v") !== "1" || (kind !== "order" && kind !== "rsvp") ||
    event === null || source === null || token === null ||
    !UUID.test(event) || !UUID.test(source) || !TOKEN.test(token)
  ) return null;
  const fragment = new URLSearchParams({
    v: "1",
    kind,
    event,
    source,
    token,
  }).toString();
  return `com.mingla.app.v2://attendance-claim#${fragment}`;
};

type VisibilityDocument = {
  visibilityState: string;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
};

export const openAttendanceClaimWithFallback = async (
  links: { appClaimUrl: string; webClaimUrl: string },
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
    void openUrl(links.webClaimUrl);
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
