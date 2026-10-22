// #3872 R1 discounts — wire contract for the SQL-owned discount engine.
//
// MINGLA-INVARIANT: I-3872-ENGINE-SINGLE-OWNER | issue #3872 | All discount money arithmetic lives in public.issue_3872_discount_apply; TypeScript only normalises codes and carries typed RPC payloads.

export type DiscountKind = "code" | "automatic" | "sale_price";
export type DiscountValueType = "percent" | "amount" | "set_price";

export interface AppliedLineDiscount {
  discountId: string;
  kind: DiscountKind;
  name: string;
  code: string | null;
  valueType: DiscountValueType;
  valueBps: number | null;
  valueMinor: number | null;
  perUnitMinor: number;
  lineMinor: number;
  units: number;
  seq: number;
}
export interface DiscountQuoteLine {
  lineRef: string;
  listUnitMinor: number;
  netUnitMinor: number;
  qty: number;
  unitsCounted: number;
  lineListMinor: number;
  lineNetMinor: number;
  lineDiscountMinor: number;
  applied: AppliedLineDiscount[];
}

export interface AppliedDiscount {
  discountId: string;
  kind: DiscountKind;
  name: string;
  code: string | null;
  amountMinor: number;
  units: number;
}

export type CodeRejectionReason =
  | "not_found"
  | "paused"
  | "not_started"
  | "ended"
  | "used_up"
  | "buyer_limit"
  | "queue"
  | "not_applicable"
  | "min_subtotal"
  | "incompatible_better_automatic";

export interface CodeOutcome {
  status: "none" | "applied" | "rejected";
  reason: CodeRejectionReason | null;
  required: number | null;
  with: string | null;
  replaced: string[];
}

export interface SaleLimitedNotice {
  type: "sale_limited";
  discountId: string;
  lineRef: string;
  remaining: number;
}

export type Notice = SaleLimitedNotice;

export interface DiscountQuote {
  lines: DiscountQuoteLine[];
  listSubtotalMinor: number;
  discountMinor: number;
  netSubtotalMinor: number;
  applied: AppliedDiscount[];
  codeOutcome: CodeOutcome;
  notices: Notice[];
  digest: string;
  listDigest: string;
}

export interface DiscountBuyerIdentity {
  email?: string | null;
  phone?: string | null;
  userId?: string | null;
}

export interface DiscountEngineLine {
  lineRef: string;
  itemKind: "ticket_type" | "menu_item" | "venue_deposit";
  itemId?: string | null;
  listingId: string;
  listingKind:
    | "event"
    | "experience"
    | "trip"
    | "venue_order"
    | "reservation_deposit";
  listUnitMinor: number;
  qty: number;
  valueScale: number;
  countScale: number;
  allowed: boolean;
  tz: string;
}

export interface DiscountQuoteLinesArgs {
  brandId: string;
  currency: string;
  lines: DiscountEngineLine[];
  code?: string | null;
  buyer?: DiscountBuyerIdentity;
  at?: string;
}

export interface ReserveDiscountUsesArgs extends DiscountQuoteLinesArgs {
  kind: "ticket" | "venue_order" | "reservation_deposit";
  refId: string;
  expectedDigest: string;
  expiresAt: string;
  consume: boolean;
  channel?: "online" | "staff";
}

export interface ReserveDiscountUsesResult {
  ok: boolean;
  quote: DiscountQuote;
}

// Keep the client structural and local: sibling functions must not acquire a
// second @supabase/supabase-js type graph merely to call two RPCs.
export interface DiscountRpcClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

export function normaliseDiscountCode(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") throw new Error("invalid_discount_code");
  const code = raw.trim().toUpperCase().replace(/[\s-]/g, "");
  if (code.length === 0) return null;
  if (code.length > 32 || !/^[A-Z0-9]{1,32}$/.test(code)) {
    throw new Error("invalid_discount_code");
  }
  return code;
}

function rpcError(name: string, error: unknown): Error {
  const message = typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error);
  return new Error(`${name}_failed:${message}`);
}

export async function callDiscountQuoteLines(
  client: DiscountRpcClient,
  args: DiscountQuoteLinesArgs,
): Promise<DiscountQuote> {
  const { data, error } = await client.rpc("issue_3872_discount_quote_lines", {
    p_brand_id: args.brandId,
    p_currency: args.currency.toUpperCase(),
    p_lines: args.lines,
    p_code: normaliseDiscountCode(args.code),
    p_buyer: args.buyer ?? {},
    ...(args.at ? { p_at: args.at } : {}),
  });
  if (error) throw rpcError("discount_quote", error);
  return data as DiscountQuote;
}

export async function callReserveDiscountUses(
  client: DiscountRpcClient,
  args: ReserveDiscountUsesArgs,
): Promise<ReserveDiscountUsesResult> {
  const { data, error } = await client.rpc("issue_3872_reserve_discount_uses", {
    p_kind: args.kind,
    p_ref_id: args.refId,
    p_brand_id: args.brandId,
    p_currency: args.currency.toUpperCase(),
    p_lines: args.lines,
    p_code: normaliseDiscountCode(args.code),
    p_buyer: args.buyer ?? {},
    p_expected_digest: args.expectedDigest,
    p_expires_at: args.expiresAt,
    p_consume: args.consume,
    p_channel: args.channel ?? "online",
  });
  if (error) throw rpcError("discount_reserve", error);
  return data as ReserveDiscountUsesResult;
}

