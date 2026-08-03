import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const encoder = new TextEncoder();
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function base64url(bytes: Uint8Array): string {
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decodeBase64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_cursor");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
async function sign(
  payload: string,
  secretOverride?: string,
): Promise<string> {
  const secret = secretOverride ??
    Deno.env.get("ADMIN_SOURCE_REFUND_CURSOR_HMAC_SECRET") ?? "";
  if (secret.length < 32) throw new Error("cursor_secret_unavailable");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  return base64url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
    ),
  );
}
export async function encodeCursor(
  snapshotId: string,
  nextOrdinal: number,
  secretOverride?: string,
): Promise<string> {
  const canonical = JSON.stringify({ v: 1, snapshotId, nextOrdinal });
  return `${base64url(encoder.encode(canonical))}.${await sign(
    canonical,
    secretOverride,
  )}`;
}

export async function decodeCursor(
  value: unknown,
  secretOverride?: string,
): Promise<{
  snapshotId: string;
  nextOrdinal: number;
}> {
  if (typeof value !== "string") throw new Error("invalid_cursor");
  if (value.length > 1024) throw new Error("invalid_cursor");
  const segments = value.split(".");
  if (segments.length !== 2) throw new Error("invalid_cursor");
  const [payloadSegment, signature] = segments;
  const raw = new TextDecoder().decode(decodeBase64url(payloadSegment));
  const expected = await sign(raw, secretOverride);
  const left = encoder.encode(signature);
  const right = encoder.encode(expected);
  if (left.length !== right.length) throw new Error("invalid_cursor");
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  if (difference !== 0) throw new Error("invalid_cursor");
  for (const key of ["v", "snapshotId", "nextOrdinal"]) {
    if ((raw.match(new RegExp(`"${key}"\\s*:`, "g")) ?? []).length !== 1) {
      throw new Error("invalid_cursor");
    }
  }
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (
    Object.keys(parsed).sort().join(",") !== "nextOrdinal,snapshotId,v" ||
    parsed.v !== 1 ||
    typeof parsed.snapshotId !== "string" ||
    !UUID_RE.test(parsed.snapshotId) ||
    !Number.isSafeInteger(parsed.nextOrdinal) ||
    Number(parsed.nextOrdinal) <= 0 ||
    raw !== JSON.stringify({
        v: 1,
        snapshotId: parsed.snapshotId,
        nextOrdinal: parsed.nextOrdinal,
      })
  ) {
    throw new Error("invalid_cursor");
  }
  return {
    snapshotId: parsed.snapshotId,
    nextOrdinal: Number(parsed.nextOrdinal),
  };
}

const allowedFilters = new Set([
  "sourceType",
  "provider",
  "buyerState",
  "feeState",
  "financialState",
  "webhookMatchStatus",
  "opsStatus",
  "brandId",
  "createdFrom",
  "createdTo",
  "updatedFrom",
  "updatedTo",
]);
const allowedEnumValues: Record<string, ReadonlySet<string>> = {
  sourceType: new Set(["venue_reservation", "rsvp_contribution"]),
  provider: new Set(["stripe", "paystack"]),
  buyerState: new Set([
    "queued",
    "provider_pending",
    "needs_attention",
    "processed",
    "failed_retryable",
    "failed_terminal",
  ]),
  feeState: new Set([
    "not_required",
    "queued",
    "provider_pending",
    "needs_attention",
    "processed",
    "failed_retryable",
    "failed_terminal",
  ]),
  financialState: new Set([
    "pending",
    "needs_attention",
    "reconciled",
    "failed_terminal",
  ]),
  webhookMatchStatus: new Set(["unmatched", "mismatched"]),
  opsStatus: new Set(["none", "needs_review", "escalated", "resolved"]),
};
export function normalizeFilters(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_filters");
  }
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (!allowedFilters.has(key)) throw new Error("invalid_filters");
    const raw = (value as Record<string, unknown>)[key];
    if (raw === null || raw === "") continue;
    if (key === "brandId") {
      const id = String(raw).toLowerCase();
      if (!UUID_RE.test(id)) throw new Error("invalid_filters");
      normalized[key] = id;
    } else if (key.endsWith("From") || key.endsWith("To")) {
      const date = new Date(String(raw));
      if (!Number.isFinite(date.getTime())) throw new Error("invalid_filters");
      normalized[key] = date.toISOString();
    } else if (allowedEnumValues[key]) {
      const input = Array.isArray(raw) ? raw : [raw];
      if (input.some((item) => typeof item !== "string")) {
        throw new Error("invalid_filters");
      }
      const values = [...new Set(input.filter(Boolean))].sort();
      if (values.length === 0) continue;
      if (values.some((item) => !allowedEnumValues[key].has(item))) {
        throw new Error("invalid_filters");
      }
      normalized[key] = values;
    } else {
      throw new Error("invalid_filters");
    }
  }
  return normalized;
}
function reply(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  });
}

interface AdminRpcError {
  message: string;
}

interface AdminRpcResult {
  data: unknown;
  error: AdminRpcError | null;
}

interface AdminRequestContext {
  userId: string | null;
  isActiveAdmin: boolean;
  rpc?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<AdminRpcResult>;
}

type ResolveAdminRequestContext = (
  authorization: string,
) => Promise<AdminRequestContext>;

async function resolveAdminRequestContext(
  authorization: string,
): Promise<AdminRequestContext> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const user = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: authData } = await user.auth.getUser();
  if (!authData.user) {
    return { userId: null, isActiveAdmin: false };
  }
  const service = createClient(url, serviceKey);
  const { data: admin } = await service.from("admin_users").select("status")
    .eq("user_id", authData.user.id).eq("status", "active").maybeSingle();
  return {
    userId: authData.user.id,
    isActiveAdmin: Boolean(admin),
    rpc: async (name, args) => await service.rpc(name, args),
  };
}

export function createAdminSourceRefundOperationsHandler(
  resolveContext: ResolveAdminRequestContext = resolveAdminRequestContext,
  cursorSecret?: string,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") {
      return reply({ error: "method_not_allowed" }, 405);
    }
    const auth = req.headers.get("authorization") ?? "";
    const context = await resolveContext(auth);
    if (!context.userId) {
      return reply({ error: "not_authenticated" }, 401);
    }
    if (!context.isActiveAdmin || !context.rpc) {
      return reply({ error: "not_authorized" }, 403);
    }
    const body = await req.json().catch(() => ({}));
    if (body.mode === "detail") {
      if (typeof body.refundId !== "string" || !UUID_RE.test(body.refundId)) {
        return reply({ error: "invalid_request" }, 400);
      }
      const { data, error } = await context.rpc(
        "admin_get_source_refund_operation",
        {
          p_refund_id: body.refundId,
        },
      );
      return reply(
        error ? { error: "not_found" } : { item: data },
        error ? 404 : 200,
      );
    }
    if (body.mode !== "list") return reply({ error: "invalid_request" }, 400);
    if (body.cursor && body.limit !== undefined) {
      return reply({ error: "invalid_cursor" }, 400);
    }
    let filters: Record<string, unknown>;
    try {
      filters = normalizeFilters(body.filters ?? {});
    } catch {
      return reply({ error: "invalid_filters" }, 400);
    }
    const canonical = JSON.stringify(filters);
    const hashBytes = new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(canonical)),
    );
    const filterHash = Array.from(hashBytes).map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
    let cursor: { snapshotId: string; nextOrdinal: number } | null = null;
    try {
      // decodeCursor(body.cursor) is intentionally reached only after active-Admin authorization.
      cursor = body.cursor
        ? await decodeCursor(body.cursor, cursorSecret)
        : null;
    } catch {
      return reply({ error: "invalid_cursor" }, 400);
    }
    const limit = cursor ? null : Number(body.limit ?? 50);
    if (
      !cursor &&
      (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 ||
        limit > 100)
    ) {
      return reply({ error: "invalid_request" }, 400);
    }
    const { data, error } = await context.rpc(
      "admin_list_source_refund_operations",
      {
        p_admin_user_id: context.userId,
        p_normalized_filters: filters,
        p_normalized_filter_hash: filterHash,
        p_snapshot_id: cursor?.snapshotId ?? null,
        p_next_ordinal: cursor?.nextOrdinal ?? 0,
        p_page_size: cursor ? null : limit,
      },
    );
    if (error) {
      const errorCode = error.message.includes("query_too_broad")
        ? "query_too_broad"
        : error.message.includes("snapshot_expired")
        ? "snapshot_expired"
        : error.message.includes("snapshot_binding_mismatch") ||
            error.message.includes("invalid_cursor") ||
            error.message.includes("invalid_page")
        ? "invalid_cursor"
        : "list_failed";
      return reply(
        { error: errorCode },
        errorCode === "snapshot_expired"
          ? 410
          : errorCode === "query_too_broad"
          ? 422
          : errorCode === "invalid_cursor"
          ? 400
          : 500,
      );
    }
    const envelope = Array.isArray(data) ? data[0] : data;
    const next = envelope && envelope.items?.length === envelope.page_size &&
        envelope.items.at(-1)?.ordinal + 1 < envelope.item_count
      ? await encodeCursor(
        envelope.snapshot_id,
        envelope.items.at(-1).ordinal + 1,
        cursorSecret,
      )
      : null;
    return reply({ ...envelope, nextCursor: next });
  };
}

if (import.meta.main) {
  serve(createAdminSourceRefundOperationsHandler());
}
