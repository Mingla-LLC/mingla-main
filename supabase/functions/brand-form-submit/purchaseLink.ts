// #4514 wave 5: "After they purchase" (BUILD CONTRACT v2 §5.5). The buyer's
// success screen asks for a personal link to the page's form for their own
// order, then opens /form/{formId}#t=… (the wave 3 link page).
//
//   {op:"purchase_link", checkoutSessionId, buyerStatusToken}
//     → 200 {ok:true, outcome:"link", formId, token}
//     → 200 {ok:true, outcome:"none" | "answered", formId?}
//     → 403 link_invalid (not this session's possession proof, or not completed)
//     → 429 rate_limited · 503 forms_paused handled by the caller · 500 server_error
//
// Possession is the checkout session's buyer status token, checked as
// attendance-claim-link checks it (its SHA-256 hex against the stored hash).
// The token arrives in the POST body only and is never logged. Never an invite
// (decision 17): SQL mints a brand form link through brand_form_link_issue.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PurchaseLinkRequest {
  op: "purchase_link";
  checkoutSessionId: string;
  buyerStatusToken: string;
}

export interface PurchaseLinkDeps {
  purchaseLink(
    checkoutSessionId: string,
    tokenHash: string,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
  log: (line: string) => void;
}

export function isPurchaseLinkOp(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && !Array.isArray(raw) &&
    (raw as Record<string, unknown>).op === "purchase_link";
}

export function parsePurchaseLinkRequest(
  raw: unknown,
): PurchaseLinkRequest | null {
  if (!isPurchaseLinkOp(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (
    Object.keys(r).some((k) =>
      !["op", "checkoutSessionId", "buyerStatusToken"].includes(k)
    )
  ) return null;
  if (
    typeof r.checkoutSessionId !== "string" ||
    !UUID_RE.test(r.checkoutSessionId) ||
    typeof r.buyerStatusToken !== "string" ||
    r.buyerStatusToken.length < 32 || r.buyerStatusToken.length > 256
  ) return null;
  return {
    op: "purchase_link",
    checkoutSessionId: r.checkoutSessionId.toLowerCase(),
    buyerStatusToken: r.buyerStatusToken,
  };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

export async function handlePurchaseLink(
  req: PurchaseLinkRequest,
  deps: PurchaseLinkDeps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const hash = await sha256Hex(req.buyerStatusToken);
  const { data, error } = await deps.purchaseLink(req.checkoutSessionId, hash);
  if (error) {
    const first = (error.message ?? "").trim().split(/[\s:]/)[0] ?? "";
    if (first === "link_invalid") {
      return { status: 403, body: { ok: false, error: "link_invalid" } };
    }
    if (first === "rate_limited") {
      return { status: 429, body: { ok: false, error: "rate_limited" } };
    }
    deps.log("[brand-form-submit] purchase_link server_error");
    return { status: 500, body: { ok: false, error: "server_error" } };
  }
  const d = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  if (
    d.outcome === "link" && typeof d.formId === "string" &&
    typeof d.token === "string"
  ) {
    deps.log(`[brand-form-submit] purchase_link issued form=${d.formId}`);
    return {
      status: 200,
      body: { ok: true, outcome: "link", formId: d.formId, token: d.token },
    };
  }
  if (d.outcome === "answered" && typeof d.formId === "string") {
    return {
      status: 200,
      body: { ok: true, outcome: "answered", formId: d.formId },
    };
  }
  return { status: 200, body: { ok: true, outcome: "none" } };
}
