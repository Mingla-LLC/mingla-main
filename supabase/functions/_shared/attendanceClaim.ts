const encoder = new TextEncoder();

export type AttendanceClaimKind = "order" | "rsvp";
export type AttendanceEventKind = "rsvp" | "event" | "trip" | "experience";

export type AttendanceEventRelation = {
  status: string;
  visibility: string;
  deleted_at: string | null;
  event_type?: string;
  brands: { deleted_at: string | null };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizeAttendanceEvent = (
  value: unknown,
): AttendanceEventRelation | null => {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!isRecord(candidate)) return null;
  const brandValue = Array.isArray(candidate.brands)
    ? candidate.brands[0]
    : candidate.brands;
  if (
    !isRecord(brandValue) || typeof candidate.status !== "string" ||
    typeof candidate.visibility !== "string" ||
    !(candidate.deleted_at === null ||
      typeof candidate.deleted_at === "string") ||
    !(brandValue.deleted_at === null ||
      typeof brandValue.deleted_at === "string")
  ) return null;
  return {
    status: candidate.status,
    visibility: candidate.visibility,
    deleted_at: candidate.deleted_at,
    event_type: typeof candidate.event_type === "string"
      ? candidate.event_type
      : undefined,
    brands: { deleted_at: brandValue.deleted_at },
  };
};

export const normalizeTickets = (
  value: unknown,
): Array<{ status: string; approval_status: string }> =>
  Array.isArray(value)
    ? value.flatMap((ticket) =>
      isRecord(ticket) && typeof ticket.status === "string" &&
        typeof ticket.approval_status === "string"
        ? [{ status: ticket.status, approval_status: ticket.approval_status }]
        : []
    )
    : [];

export const isExactClaimToken = (
  kind: AttendanceClaimKind,
  token: string,
): boolean =>
  kind === "order"
    ? decodeOrderClaimToken(token) !== null
    : /^[A-Za-z0-9_-]{43}$/.test(token);

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);

export const isAttendanceClaimKind = (
  value: unknown,
): value is AttendanceClaimKind => value === "order" || value === "rsvp";

export type AttendanceClaimRequest = {
  version: 1;
  kind: AttendanceClaimKind;
  eventId: string;
  sourceId: string;
  token: string;
};

export const parseAttendanceClaimRequest = (
  value: unknown,
): AttendanceClaimRequest | null => {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) =>
      !["version", "kind", "eventId", "sourceId", "token"].includes(key)
    )
  ) return null;
  if (
    value.version !== 1 || !isAttendanceClaimKind(value.kind) ||
    !isUuid(value.eventId) || !isUuid(value.sourceId) ||
    typeof value.token !== "string" ||
    !isExactClaimToken(value.kind, value.token)
  ) return null;
  return {
    version: 1,
    kind: value.kind,
    eventId: value.eventId,
    sourceId: value.sourceId,
    token: value.token,
  };
};

export type AttendanceClaimLinkRequest = {
  checkoutSessionId: string;
  buyerStatusToken: string;
};

export const parseAttendanceClaimLinkRequest = (
  value: unknown,
): AttendanceClaimLinkRequest | null => {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) =>
      !["checkoutSessionId", "buyerStatusToken"].includes(key)
    )
  ) return null;
  if (
    !isUuid(value.checkoutSessionId) ||
    typeof value.buyerStatusToken !== "string" ||
    value.buyerStatusToken.length < 32 || value.buyerStatusToken.length > 256
  ) return null;
  return {
    checkoutSessionId: value.checkoutSessionId,
    buyerStatusToken: value.buyerStatusToken,
  };
};

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
};

export const decodeOrderClaimToken = (token: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  try {
    const standard = token.replaceAll("-", "+").replaceAll("_", "/") + "=";
    const binary = atob(standard);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
};

export const mintOrderClaimToken = (): { token: string; raw: Uint8Array } => {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return { token: base64Url(raw), raw };
};

export const hmacOrderClaimDigest = async (
  rawToken: Uint8Array,
  pepper: string,
): Promise<Uint8Array> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const stableRaw = Uint8Array.from(rawToken).buffer;
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, stableRaw));
};

export const sha256Digest = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));

export const bytesToPostgresHex = (bytes: Uint8Array): string =>
  `\\x${
    Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("")
  }`;

export const attendanceClaimUrls = (input: {
  kind: AttendanceClaimKind;
  eventId: string;
  sourceId: string;
  token: string;
}): { webClaimUrl: string; appClaimUrl: string } => {
  const fragment = new URLSearchParams({
    v: "1",
    kind: input.kind,
    event: input.eventId,
    source: input.sourceId,
    token: input.token,
  }).toString();
  return {
    webClaimUrl: `https://host.usemingla.com/attendance/claim#${fragment}`,
    appClaimUrl: `com.mingla.app.v2://attendance-claim#${fragment}`,
  };
};

export const claimJson = (
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    },
  });

export const shouldIssueOrderAttendanceClaimForNotification = (input: {
  templateKey: string;
  channel: string;
  buyerUserId: string | null;
  paymentStatus: string | null;
}): boolean =>
  input.templateKey === "buyer_ticket_confirmation" &&
  input.channel === "email" && input.buyerUserId === null &&
  ["paid", "partial_refund"].includes(input.paymentStatus ?? "");
