const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;

export interface OneSignalEventStreamTokenRing {
  current: string;
  previous: string | null;
}

export function readOneSignalEventStreamTokenRing(
  raw = Deno.env.get("AD_CONVERSION_TOKENS"),
): OneSignalEventStreamTokenRing {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? "");
  } catch {
    throw new Error("onesignal_event_stream_auth_unavailable");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("onesignal_event_stream_auth_unavailable");
  }
  const bundle = parsed as Record<string, unknown>;
  const current = bundle.ONESIGNAL_EVENT_STREAM_TOKEN_CURRENT;
  const previous = bundle.ONESIGNAL_EVENT_STREAM_TOKEN_PREVIOUS;
  if (
    typeof current !== "string" || !TOKEN.test(current) ||
    (previous !== undefined && previous !== null &&
      (typeof previous !== "string" || !TOKEN.test(previous))) ||
    previous === current
  ) throw new Error("onesignal_event_stream_auth_unavailable");
  return { current, previous: typeof previous === "string" ? previous : null };
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length, 128);
  for (let i = 0; i < length; i++) mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return mismatch === 0;
}

export function verifyOneSignalEventStreamBearer(
  authorization: string | null,
  ring = readOneSignalEventStreamTokenRing(),
): boolean {
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const current = constantTimeEqual(supplied, ring.current);
  const previous = constantTimeEqual(supplied, ring.previous ?? "");
  return TOKEN.test(supplied) && (current || previous);
}
