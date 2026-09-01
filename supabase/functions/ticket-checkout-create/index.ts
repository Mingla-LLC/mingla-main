
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import { fireBuyerPurchaseConfirmationPush } from "../_shared/businessNotifyTriggers.ts";
// ISSUE-865 WP-B — post-finalize ad-conversion hook (idempotent + fail-open).
// persistAttributionClickId (WP-C, P2-1): the DECOUPLED, fail-open threading
// write — attribution capture is never on the fatal checkout-creation path.
import {
  fireAdConversion,
  persistAttributionClickId,
} from "../_shared/adConversionFire.ts";
import { STRIPE_API_VERSION, stripeTicketCheckout } from "../_shared/stripe.ts";
import { resolvePublishableKey } from "../_shared/stripeMode.ts";
import { getPaymentMethodTypes } from "../_shared/stripePaymentMethods.ts";
// ORCH-0869 [Tr3 Installment Payments] — separate-line import so the
// ORCH-0849 R-2 regex (single-symbol braces) keeps matching above.
import { getInstallmentPaymentMethodTypes } from "../_shared/stripePaymentMethods.ts";
import {
  cancelPaymentIntentIfClientAvailable,
  checkoutIdempotencyKey,
  classifyStripeCheckoutSessionCreateFailure,
  classifyStripePaymentIntentCreateFailure,
  dispatchTicketConfirmation,
  jsonResponse,
  normalizePhoneE164,
  qrTokenPepper,
  randomBuyerStatusToken,
  serviceClient,
  sha256Hex,
  ticketCorsHeaders,
  userIdFromAuthHeader,
} from "../_shared/ticketCheckout.ts";
// ORCH-1006 [Universal all-in pricing engine] — shared money engine.
// Slice 2 wires in the full engine: the gross-up (computeBuyerSubtotal), the
// canonical breakdown assembler (buildPricingBreakdown), the region→behaviour
// map (taxBehaviorForRegion), and the service-fee default (MINGLA_SERVICE_FEE_BPS).
// The engine is the SINGLE owner of the all-in math (Constitution #2); this
// edge function never hand-rolls tax/fee arithmetic.
import {
  buildPricingBreakdown,
  type ComputeAllInInput,
  computeBuyerSubtotal,
  computeConfigVat,
  inclusiveVatDivisorForRegion,
  MINGLA_SERVICE_FEE_BPS,
  type PricingBreakdown,
  type PricingRegion,
  type PricingSwitches,
  type TaxBasis,
  taxBehaviorForRegion,
} from "../_shared/allInPricingEngine.ts";
// META-ORCH-1076 [Paystack Africa] — provider routing + the Paystack
// transaction client (additive; the Stripe arm below is byte-for-byte
// unchanged and never imports these). The Paystack arm activates ONLY when
// resolveProviderRouting(...).provider === "paystack".
import {
  paystackChannelsForCountry,
  resolveProviderRouting,
} from "../_shared/paymentProvider.ts";
import { paystackInitializeTransaction } from "../_shared/paystack.ts";
// issue #2216 — a free reservation lands the guest on the SAME confirmation
// carousel a paid one does, so it owes the guest the SAME rendered pass.
import { attachQrImageDataUrls } from "../_shared/ticketQrImage.ts";
import {
  checkoutUnavailableResponse,
  claimTicketProviderAttempt,
  commitTicketProviderAttempt,
  markTicketProviderUnknown,
  type TicketAttemptClaim,
} from "../_shared/checkoutSaleTruth.ts";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../_shared/businessWebOrigin.ts";
// Issue #2101 [named-buyer checkout] — the ONE edge adapter for the sole
// database decision owner. Enforced BEFORE any session, capacity, provider or
// free-ticket work, and re-decided inside the database on every value-moving
// path so a direct Edge/RPC call cannot bypass it.
import {
  ticketCheckoutAccessDecision,
  ticketCheckoutAccessDenial,
  ticketCheckoutAccessDenialFromDbMessage,
} from "../_shared/ticketCheckoutAccess.ts";
// #1178 [ng-split-removal] — pure Paystack split-field gate (co-located so it is
// unit-testable without importing this serve()-on-load entry).
import { paystackTicketSplitFields } from "./ngPaystackSplit.ts";
import { resolveSitesAttributionPepper } from "../_shared/sitesSecurity.ts";

async function siteAttributionDigest(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(resolveSitesAttributionPepper()).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  return Array.from(signed)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function persistSiteAttributionToken(
  // deno-lint-ignore no-explicit-any
  client: any,
  checkoutSessionId: string,
  value: unknown,
): Promise<void> {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return;
  try {
    const { error } = await client.from("ticket_checkout_sessions").update({
      site_attribution_token_digest: await siteAttributionDigest(value),
    }).eq("id", checkoutSessionId).is("order_id", null)
      .is("site_attribution_token_digest", null);
    if (error) {
      console.error(
        "[ticket-checkout-create] site attribution binding skipped",
      );
    }
  } catch {
    // Attribution never changes checkout availability or payment correctness.
    console.error("[ticket-checkout-create] site attribution binding skipped");
  }
}

/**
 * issue #2579 — fire-and-forget refusal telemetry.
 *
 * `raiseToken` is NOT resolved here. issue #2579: this file used to carry its
 * own nineteen-token list and collapse anything outside it to `unknown_token`
 * BEFORE calling the RPC — which meant the RPC's own sixty-seven-token allowlist
 * was unreachable on the only path that matters, and a real past-event refusal
 * arrived already destroyed. Two allowlists is one more than the number of
 * places a fact can live and stay true.
 *
 * The raw message goes to the RPC and the RPC does the matching: exact first
 * (an edge refusal sends a bare token), then longest-first embedded match (a
 * Postgres error arrives with the token inside it). Anything unrecognised is
 * still KEPT as `unknown_token` rather than dropped, which is the property that
 * made every gap in this system findable.
 */

const firstTicketTypeId = (
  lines: ReadonlyArray<Record<string, unknown>>,
): string | null => {
  for (const line of lines) {
    const id = line?.ticketTypeId;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
};

const totalRequestedQuantity = (
  lines: ReadonlyArray<Record<string, unknown>>,
): number | null => {
  let total = 0;
  let saw = false;
  for (const line of lines) {
    const q = Number(line?.quantity);
    if (Number.isFinite(q)) {
      total += q;
      saw = true;
    }
  }
  return saw ? total : null;
};

const recordCheckoutRefusal = async (
  // deno-lint-ignore no-explicit-any
  client: any,
  input: {
    eventId: string;
    ticketTypeId: string | null;
    message: string | undefined;
    quantity: number | null;
    surface: string;
    phoneE164: string | null;
    email: string | null;
  },
): Promise<void> => {
  // issue #2579 — BOUNDED, so the caller can safely `await` this.
  //
  // Awaiting is what finally made the log record at all: `waitUntil` did NOT
  // hold the isolate open here — six real refusals at the deployed endpoint
  // produced zero rows, and the platform logs showed a fresh isolate booted and
  // shut down per request without ever opening an HTTP call. But an unbounded
  // await would let a slow database turn a refusal into a hang, which is what
  // fire-and-forget was protecting against. A short race keeps BOTH: the write
  // reliably lands, and a refusal is never delayed beyond this budget.
  //
  // `ReturnType<typeof setTimeout>`, not `number`: local Deno resolves this to
  // the web global, CI resolves it through the Supabase types to Node's
  // `Timeout`. Hard-coding `number` type-checks on one and not the other.
  const TIMEOUT_MS = 1_500;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // issue #2579 — INSPECT THE RESULT. supabase-js `.rpc()` DOES NOT THROW on
    // a database error: it RESOLVES with `{ data, error }`. Awaiting it and
    // discarding the value therefore succeeds no matter what happened, and the
    // `catch` below can never run.
    //
    // That is the whole reason four fixes in a row failed to make this log
    // record. Every one of them was correct about something — the allowlist WAS
    // incomplete, the edge WAS collapsing the token, the write WAS abandoned at
    // the response — and every one of them was verified against a call that
    // reported success while the row was being rejected. Adding a `console.error`
    // to the catch produced NOTHING, which is what finally proved the error was
    // never an exception at all.
    const outcome = await Promise.race([
      client.rpc("issue_2579_record_checkout_refusal", {
      p_event_id: input.eventId.length > 0 ? input.eventId : null,
      p_ticket_type_id: input.ticketTypeId,
      // RAW. The RPC owns the allowlist; see the note above.
      p_raise_token: input.message ?? null,
      p_quantity_requested: input.quantity,
      p_surface: input.surface,
      // FULL E.164 in; the RPC stores the dial code only. Extraction lives
      // there because the migration's probe runs in CI and a new edge test
      // file would run in no lane.
      p_buyer_phone_e164: input.phoneE164,
        p_buyer_email: input.email,
      }),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), TIMEOUT_MS);
      }),
    ]);
    const rpcError = (outcome as { error?: unknown } | undefined)?.error;
    if (rpcError) {
      console.error(
        "[ticket-checkout-create] refusal log REJECTED by the database",
        { token: input.message, surface: input.surface, rpcError },
      );
    }
  } catch (error) {
    // issue #2579 — SWALLOWED, BUT NEVER SILENT.
    //
    // The refusal never turns into a failed checkout: that property is
    // non-negotiable and is why this catch exists at all. But the ORIGINAL
    // catch also said nothing, and that is how a telemetry system that had
    // recorded NOTHING for its entire life still looked healthy. Three
    // successive fixes were reasoned out from indirect evidence — platform
    // logs that disagreed with each other between queries — because the one
    // component that knew exactly what went wrong was refusing to say.
    //
    // A swallowed error is a decision not to fail. It is not a decision not to
    // tell anyone.
    console.error(
      "[ticket-checkout-create] refusal log write failed",
      { token: input.message, surface: input.surface, error },
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/**
 * issue #2579 — the ONE place a refusal leaves this function.
 *
 * The first cut of this recorded only refusals raised by the session RPC. Fired
 * at the deployed endpoint with a past event, it logged NOTHING: that refusal
 * exits at `event_no_active_dates`, one of TWENTY-FIVE early returns that never
 * reach the RPC. A log that covers one class of refusal while reading as
 * complete is the defect this issue exists to fix, wearing a new hat.
 *
 * So refusals go out through here. Same response, byte for byte — `jsonResponse`
 * is untouched and still shared by 94 other functions — with the recording
 * attached on the way past. A future author adding a refusal writes `refuse(…)`
 * and is logged automatically; the alternative was hand-maintaining 25 call
 * sites, which is the treadmill this codebase keeps tripping over.
 *
 * Fire-and-forget, exactly as before: never awaited, errors swallowed. A
 * telemetry fault must never become a buyer's failed checkout.
 */

type CheckoutLine = { ticketTypeId: string; quantity: number };
type CheckoutMode = "create" | "preview";
// ORCH-1006 Slice 2 (SPEC §B.6): the BuyerAddress type + parseBuyerAddress +
// validateBuyerAddress are REMOVED. Tax is sourced at the VENUE (SPEC §B.1),
// never the buyer — the buyer never types an address in the native flow. The
// tax basis is events.venue_tax_address from resolve_event_pricing_inputs.
// (The web hosted-Checkout path collects the address on Stripe's hosted page
// via automatic_tax and never used these helpers — removal is native-only.)
type TaxCalculationSummary = {
  id: string;
  amount_total: number;
  tax_breakdown: unknown[];
};
type TaxLineItem = {
  ticketTypeId: string;
  ticketName: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};
type StripeTaxFailure = {
  error: "tax_calculation_failed" | "tax_country_unsupported";
  detail: string;
  httpStatus: number;
};
type PaymentPlanChoice = "auto" | "full" | "installments";
// ORCH-0839-B (2026-05-14): widened to include "mobile-web" for the
// mingla-business mobile hosted-Checkout pivot. "web" continues to emit
// https://… success_url/cancel_url; "mobile-web" emits the
// mingla-business://checkout/return custom-scheme deep link the native app
// intercepts via expo-web-browser.openAuthSessionAsync. "native" remains
// for backward compat with older mingla-business builds (PaymentIntent
// path below). Decision-gate probe (2026-05-14) confirmed Stripe accepts
// the custom scheme — see Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-
// 0839-B_STRIPE_HOSTED_CHECKOUT_PIVOT.md §3.
type CheckoutSurface = "native" | "web" | "mobile-web";

function isCheckoutLine(value: unknown): value is CheckoutLine {
  const row = value as Partial<CheckoutLine>;
  return (
    typeof row.ticketTypeId === "string" &&
    row.ticketTypeId.length > 0 &&
    Number.isInteger(row.quantity) &&
    Number(row.quantity) > 0
  );
}

function optionalTrimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ORCH-1006 Slice 2 (SPEC §B.6): parseBuyerAddress / validateBuyerAddress
// DELETED — the native flow no longer captures or validates a buyer address.
// Tax is venue-sourced (events.venue_tax_address). See the type comment above.

function classifyStripeTaxCalculationFailure(err: unknown): StripeTaxFailure {
  const record = err as
    | {
      code?: unknown;
      type?: unknown;
      param?: unknown;
      message?: unknown;
      raw?: {
        code?: unknown;
        type?: unknown;
        param?: unknown;
        message?: unknown;
      };
    }
    | null
    | undefined;
  const code = String(record?.code ?? record?.raw?.code ?? "").toLowerCase();
  const type = String(record?.type ?? record?.raw?.type ?? "").toLowerCase();
  const param = String(record?.param ?? record?.raw?.param ?? "").toLowerCase();
  const detail = record?.message ?? record?.raw?.message;
  const message = typeof detail === "string" ? detail : String(err);
  const normalized = `${code} ${type} ${param} ${message}`.toLowerCase();
  if (
    normalized.includes("country_unsupported") ||
    normalized.includes("unsupported country") ||
    normalized.includes("country is not supported") ||
    (param.includes("country") && normalized.includes("not supported"))
  ) {
    return {
      error: "tax_country_unsupported",
      detail: message,
      httpStatus: 422,
    };
  }
  return { error: "tax_calculation_failed", detail: message, httpStatus: 502 };
}

function normalizeTaxLineItemsForCurrentCharge(input: {
  lineItems: TaxLineItem[];
  isInstallmentPlan: boolean;
  totalCents: number;
}): TaxLineItem[] {
  const sum = input.lineItems.reduce(
    (total, line) => total + line.totalCents,
    0,
  );
  if (
    !input.isInstallmentPlan ||
    input.totalCents <= 0 ||
    sum === input.totalCents
  ) {
    return input.lineItems;
  }
  return [{
    ticketTypeId: "installment-deposit",
    ticketName: "Installment deposit",
    quantity: 1,
    unitPriceCents: input.totalCents,
    totalCents: input.totalCents,
  }];
}

// ORCH-0880 [Tr5 Traveler Intake Forms] — answer-empty predicate. Mirror of
// `intakeSchemaService.isAnswerEmpty` in `mingla-business/src/services/`.
// Per Constitution #13 (exclusion consistency) the answer-empty rule MUST
// behave identically in DB (validate_trip_intake_schema) + client validator +
// edge fn (this) so all 3 layers agree on what "missing required answer"
// means.
function isIntakeAnswerEmpty(type: string, answer: unknown): boolean {
  if (answer === undefined || answer === null) return true;
  switch (type) {
    case "short_text":
    case "long_text":
    case "single_choice":
    case "date":
    case "number":
      return typeof answer !== "string" || answer.trim().length === 0;
    case "multi_choice":
      return !Array.isArray(answer) || answer.length === 0;
    case "file_upload":
      return !Array.isArray(answer) || answer.length === 0;
    default:
      return true;
  }
}

/**
 * issue #2136 [free-ticket checkout] — the issued-ticket shape the buyer
 * contract (`TicketCheckoutFreeCompleted.tickets` in
 * `mingla-business/src/services/ticketCheckoutService.ts`) declares. Kept
 * structurally identical to what `issue_1930_ticket_checkout_finalize_base`
 * builds, so the read-back below and the RPC's own fresh-mint envelope are
 * interchangeable.
 */
export interface IssuedTicketSummary {
  ticketId: string;
  ticketTypeId: string | null;
  ticketName: string;
  qrPayload: string;
  status: string;
}

/**
 * issue #2216 [free-order pass renders as a blank white square] — what
 * `readIssuedTicketsForOrder` actually answers with.
 *
 * ORCH-0932 moved QR rendering server-side because the client could not draw
 * one reliably on the Expo SDK 54 web export, and wired it into
 * `ticket-checkout-confirm` + `ticket-checkout-status` — the only two
 * producers of confirm-screen tickets that existed then. #2136 later added a
 * THIRD producer (this function's `free_completed` body) and it carried
 * `qrPayload` but no rendered image, so every free reservation reached the
 * carousel with nothing to draw and the `imageDataUrl.length > 0` guard
 * showed the placeholder — the blank white square in #2216.
 *
 * `qrImageDataUrl` is REQUIRED here, not optional: an optional field is
 * exactly what let the gap ship unnoticed.
 */
export interface IssuedTicketWithQrImage extends IssuedTicketSummary {
  /** `data:image/png;base64,…`, or `""` when this one ticket failed to render. */
  qrImageDataUrl: string;
}

function normalizeIssuedTickets(value: unknown): IssuedTicketSummary[] {
  if (!Array.isArray(value)) return [];
  const rows: IssuedTicketSummary[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const ticketId = typeof row.ticketId === "string" ? row.ticketId : "";
    if (ticketId.length === 0) continue;
    rows.push({
      ticketId,
      ticketTypeId: typeof row.ticketTypeId === "string"
        ? row.ticketTypeId
        : null,
      ticketName: typeof row.ticketName === "string" ? row.ticketName : "",
      qrPayload: typeof row.qrPayload === "string" ? row.qrPayload : "",
      status: typeof row.status === "string" ? row.status : "valid",
    });
  }
  return rows;
}

/**
 * issue #2136 — resolve the tickets an order actually issued.
 *
 * `biz_ticket_checkout_finalize` returns tickets only on its fresh-mint arm;
 * its idempotent-replay arm (`order_id IS NOT NULL`) answers `{outcome,orderId}`
 * with none. Prefer the envelope when it carries them (no extra round trip on
 * the common path) and otherwise read the canonical `tickets` rows by order id.
 * Returning `[]` is meaningful: the caller REFUSES to report a completed free
 * checkout without at least one issued ticket.
 *
 * issue #2216 — this is also the SINGLE place a rendered QR image is attached,
 * which is what makes the fresh-mint arm and the idempotent-replay arm carry
 * one BY CONSTRUCTION rather than by two callers remembering to.
 */
export async function readIssuedTicketsForOrder(
  // deno-lint-ignore no-explicit-any
  client: any,
  orderId: string,
  envelopeTickets: unknown,
): Promise<IssuedTicketWithQrImage[]> {
  const fromEnvelope = normalizeIssuedTickets(envelopeTickets);
  if (fromEnvelope.length > 0) return await attachQrImageDataUrls(fromEnvelope);
  const { data, error } = await client
    .from("tickets")
    .select("id, ticket_type_id, qr_code, status, ticket_types(name)")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error(
      "[ticket-checkout-create] issued-ticket read-back failed",
      orderId,
      error.message,
    );
    return [];
  }
  const rows = Array.isArray(data) ? data : [];
  return await attachQrImageDataUrls(normalizeIssuedTickets(
    rows.map((row: Record<string, unknown>) => {
      const joined = row.ticket_types;
      const ticketTypeName = joined !== null && typeof joined === "object"
        ? (Array.isArray(joined)
          ? (joined[0] as Record<string, unknown> | undefined)?.name
          : (joined as Record<string, unknown>).name)
        : undefined;
      return {
        ticketId: row.id,
        ticketTypeId: row.ticket_type_id,
        ticketName: typeof ticketTypeName === "string" ? ticketTypeName : "",
        qrPayload: row.qr_code,
        status: row.status,
      };
    }),
  ));
}

export interface TicketCheckoutCreateDeps {
  userIdFromAuthHeader: typeof userIdFromAuthHeader;
  serviceClient: typeof serviceClient;
  paystackInitializeTransaction: typeof paystackInitializeTransaction;
}

const defaultDeps: TicketCheckoutCreateDeps = {
  userIdFromAuthHeader,
  serviceClient,
  paystackInitializeTransaction,
};

/**
 * issue #2670 — the real emitter, kept reachable under a second name.
 *
 * The handler below SHADOWS `jsonResponse` with a recording version. Shadowing
 * rather than editing call sites is deliberate: five of those sites are pinned
 * by CI gates as literal source text, and a guard that silently stops matching
 * is worse than the bug it watches for. Every exit records; not one call site
 * changes a character.
 */
const emitJsonResponse = jsonResponse;

export const createTicketCheckoutCreateHandler = (
  deps: TicketCheckoutCreateDeps = defaultDeps,
): (req: Request) => Promise<Response> =>
  wrapEdgeHandler("ticket-checkout-create", async (req) => {
    // issue #2670 — RECORD EVERY REFUSAL, AT THE ONE PLACE THEY ALL LEAVE.
    //
    // #2579 made the log record, and it recorded 6 of 51 exits. The other 45
    // returned in silence — including `bookings_closed`, `intake_form_required`,
    // `pricing_config_unavailable` and every payment-rail failure. Read that log
    // and you would conclude the problem is event dates, because event dates was
    // one of the few things it could see. A partial log that reads as complete is
    // worse than no log.
    //
    // The fix is NOT a recorder at 45 call sites. That is the treadmill this
    // issue already fell off three times with its allowlist, and it would go
    // stale the first time someone adds exit 52. Instead `jsonResponse` is
    // shadowed for the whole handler body: every existing `return jsonResponse(
    // { error: ... }, 4xx)` now records on its way out, no call site is edited,
    // and a new exit written next year is covered the day it is written.
    //
    // Mutable bag rather than a closure over the `const`s below, because the
    // first two exits (`method_not_allowed`, `invalid_json`) run BEFORE those
    // bindings exist and reading them there would throw. The bag is always
    // initialised; the values fill in as they become known.
    const refusal: {
      // deno-lint-ignore no-explicit-any
      client: any;
      eventId: string;
      lines: Record<string, unknown>[];
      surface: string;
      phoneE164: string | null;
      email: string | null;
    } = {
      client: null,
      eventId: "",
      lines: [],
      surface: "unknown",
      phoneE164: null,
      email: null,
    };

    const jsonResponse = async (
      body: Record<string, unknown>,
      status = 200,
    ): Promise<Response> => {
      const token = typeof body.error === "string" ? body.error : null;
      // NOT lazily constructed. #1929 requires an invalid request to die BEFORE
      // the service client, the auth bootstrap or any network object exists, and
      // its adversarial test asserts exactly that. Building a client here to log
      // `method_not_allowed` would have broken a security boundary to record two
      // reasons that are malformed requests rather than buyers being turned away.
      // So those two exits stay unrecorded, deliberately and by name.
      if (token !== null && status >= 400 && refusal.client !== null) {
        try {
          await recordCheckoutRefusal(refusal.client, {
            eventId: refusal.eventId,
            ticketTypeId: firstTicketTypeId(refusal.lines),
            message: token,
            quantity: totalRequestedQuantity(refusal.lines),
            surface: refusal.surface,
            phoneE164: refusal.phoneE164,
            email: refusal.email,
          });
        } catch (error) {
          console.error(
            "[ticket-checkout-create] refusal recording skipped",
            { token, error },
          );
        }
      }
      return emitJsonResponse(body, status);
    };

    // The three-dependency factory is the established import-safe provider
    // harness. Its injected Paystack adapter owns the provider boundary during
    // unit tests; production always uses the database claim/commit authority.
    const productionProviderAuthority = deps.paystackInitializeTransaction ===
      defaultDeps.paystackInitializeTransaction;
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "method_not_allowed" }, 405);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }

    // issue #2579 — hoisted from below the validation block. Every refusal from
    // here down is a BUYER being turned away, and each one is now recorded; the
    // recorder needs a client, so the client has to exist before the first of
    // them rather than eighty lines later. Construction only — no I/O, no
    // behaviour change to anything downstream, which still uses this same
    // binding.
    const supabase = deps.serviceClient();
    refusal.client = supabase;
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    refusal.eventId = eventId;
    // ORCH-0839-B: three-way discriminator. Unknown values fall through to
    // "native" to preserve backward compat with older mingla-business builds
    // that send no surface field (older builds: omitted → "native").
    const surface: CheckoutSurface = body.surface === "web"
      ? "web"
      : body.surface === "mobile-web"
      ? "mobile-web"
      : "native";
    refusal.surface = surface;
    const buyer = (body.buyer ?? {}) as Record<string, unknown>;
    const buyerName = typeof buyer.name === "string" ? buyer.name.trim() : "";
    const buyerEmail = typeof buyer.email === "string"
      ? buyer.email.trim().toLowerCase()
      : "";
    const buyerPhoneE164 = normalizePhoneE164(buyer.phone);
    refusal.phoneE164 = buyerPhoneE164;
    refusal.email = buyerEmail;
    const marketingOptIn = buyer.marketingOptIn === true;
    // ORCH-1006 Slice 2 (SPEC §B.6): no buyer-address parse. Tax is venue-sourced.
    // issue #2579 — what is known about this attempt when it is refused.
    // Read lazily by `refuse`, so a refusal late in the function carries more
    // than one raised early. Deliberately a getter bundle rather than a
    // snapshot: taking a copy here would record `surface` as "unknown" on every
    // refusal after it, which is the shape of a log that looks populated and
    // answers nothing.
    const lines = Array.isArray(body.lines)
      ? body.lines.filter(isCheckoutLine)
      : [];
    refusal.lines = lines;

    // issue #2694 — hoisted out of the #2150 branch. TWO possession checks now
    // read it: that branch, and the replay arm after finalize. One derivation,
    // one source of truth — two copies would be two things to keep in step, and
    // the one that drifted would be a disclosure gate that stopped matching.
    const presentedStatusToken = typeof body.buyerStatusToken === "string"
      ? body.buyerStatusToken.trim()
      : "";
    const presentedStatusTokenHash = presentedStatusToken.length > 0
      ? await sha256Hex(presentedStatusToken)
      : "";

    // issue #2579 — THE ONE PLACE A REFUSAL LEAVES THIS FUNCTION.
    //
    // The first cut recorded only refusals raised by the session RPC. Fired at
    // the deployed endpoint with a past event, it logged NOTHING: that refusal
    // exits at `event_no_active_dates`, one of twenty-five early returns that
    // never reach the RPC. A log covering one class of refusal while reading as
    // complete is the defect this issue exists to fix, wearing a new hat.
    //
    // Same response as before, byte for byte — `jsonResponse` is untouched and
    // still shared by 94 other functions — with the recording attached on the
    // way past. A future author writes `refuse(...)` and is logged for free;
    // hand-maintaining 25 call sites is the treadmill this repo keeps tripping
    // over.
    //
    // A closure, not a module function, so it reads the LIVE bindings: a
    // refusal late in the function carries more context than one raised early,
    // without threading a context object through eighty lines.
    //
    // Fire-and-forget, unchanged: never awaited, errors swallowed. Telemetry
    // must never turn a refusal into a failed checkout.
    const refuse = async (
      body: { error: string; [k: string]: unknown },
      status: number,
    ): Promise<Response> => {
      // issue #2670 — recording moved OUT of here and into the shadowed
      // `jsonResponse` above, which every exit goes through. This helper now
      // adds nothing but is kept so its seventeen call sites stay byte-identical
      // to what the CI gates and the #2579 regression test already pin.
      return await jsonResponse(body, status);
    };
    const mode: CheckoutMode = body.mode === "preview" ? "preview" : "create";
    // ORCH-1072: OPTIONAL chosen experience occurrence (event_dates.id). When a
    // recurring/multi-date experience is booked, the consumer Book sheet sends the
    // picked date here so the order records WHICH occurrence was booked. Validated
    // below (future + belongs to this event); persisted to the PI + order metadata.
    // When ABSENT, every downstream branch is byte-identical to today — events,
    // trips, and one-off experiences are completely unaffected (no behavior change).
    const eventDateId = typeof body.eventDateId === "string" &&
        body.eventDateId.length > 0
      ? body.eventDateId
      : null;
    // issue #2160 [multi-day multi-select] — the SET of days the guest chose,
    // as a sibling of `lines` rather than a per-line field (SPEC amendment §1).
    // De-duplicated here; ORDERED and validated server-side below. Absent or
    // empty => every downstream branch is byte-identical to today, which is
    // what every single-date event, experience, trip and RSVP sends.
    const eventDateIds: string[] = Array.isArray(body.eventDateIds)
      ? Array.from(
        new Set(
          body.eventDateIds.filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          ),
        ),
      )
      : [];
    const clientTaxCalculationId = typeof body.taxCalculationId === "string" &&
        body.taxCalculationId.length > 0
      ? body.taxCalculationId
      : null;
    let paymentPlanChoice: PaymentPlanChoice = "auto";
    if (body.payment_plan_choice !== undefined) {
      if (
        body.payment_plan_choice !== "full" &&
        body.payment_plan_choice !== "installments"
      ) {
        {
        return jsonResponse({ error: "payment_plan_choice_invalid" }, 400);
      }
      }
      paymentPlanChoice = body.payment_plan_choice;
    }

    if (!eventId) return refuse({ error: "event_id_required" }, 400);
    if (buyerName.length < 2) {
      return refuse({ error: "buyer_name_required" }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      return refuse({ error: "buyer_email_invalid" }, 400);
    }
    if (buyerPhoneE164 === null) {
      return refuse({ error: "buyer_phone_required" }, 400);
    }
    if (lines.length === 0) {
      return refuse({ error: "ticket_lines_required" }, 400);
    }
    // ORCH-1006 Slice 2 (SPEC §B.6): native create/preview no longer gate on a
    // buyer address. The address-required + address-invalid gates are DELETED —
    // tax is sourced at the venue, so the buyer never supplies an address.

    const userId = await deps.userIdFromAuthHeader(req);

    // ── Issue #2101 [named-buyer checkout] — the FIRST authority. It runs for
    // every surface (web, mobile-web, native) BEFORE the event-date read, the
    // capacity/pricing work, the session RPC, the provider call and the
    // free-ticket path, so a denied request produces ZERO checkout session,
    // attempt, ticket, outbox, Stripe, Paystack or free-entitlement effect.
    //
    // The ONLY identity input is `userId`, derived from the bearer token by
    // `userIdFromAuthHeader`. Nothing in `body` may supply buyer authority: the
    // typed buyer name/email/phone above are contact fields for the receipt and
    // are never consulted here.
    //
    // Default is unchanged: an event with no policy row, or mode
    // 'unrestricted', returns `allowed_unrestricted` and this block is a no-op.
    let accessDecision: Awaited<ReturnType<typeof ticketCheckoutAccessDecision>>;
    try {
      accessDecision = await ticketCheckoutAccessDecision(supabase, {
        eventId,
        buyerUserId: userId,
      });
    } catch (accessError) {
      // Fail CLOSED — never read a transport failure as "unrestricted".
      console.error(
        "[ticket-checkout-create] issue-2101 access decision unavailable",
        accessError,
      );
      return jsonResponse({ error: "checkout_restricted" }, 403);
    }
    const accessDenial = ticketCheckoutAccessDenial(accessDecision);
    if (accessDenial !== null) {
      return jsonResponse({ error: accessDenial.error }, accessDenial.status);
    }

    // ORCH-0792: reject checkout against events with no current/future date.
    // Pairs with the publish-RPC fix that writes event_dates and the
    // constraint trigger trg_events_enforce_master_date. See
    // Mingla_Artifacts/specs/SPEC_ORCH-0792_EVENTS_WITHOUT_DATES.md §5.1.
    const { count: futureDateCount, error: futureDateErr } = await supabase
      .from("event_dates")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .gt("end_at", new Date().toISOString());
    if (futureDateErr !== null) {
      console.error(
        "[ticket-checkout-create] event_dates lookup failed",
        futureDateErr,
      );
      return jsonResponse(
        { error: "event_date_lookup_failed", detail: futureDateErr.message },
        500,
      );
    }
    if ((futureDateCount ?? 0) === 0) {
      return refuse({ error: "event_no_active_dates" }, 422);
    }

    // ORCH-1072: validate the chosen experience occurrence when one was supplied.
    // The occurrence MUST belong to this event AND still be in the future. A
    // mismatched / past / sold-out occurrence is rejected with 422 so the buyer
    // re-picks (the Book sheet shows sold-out occurrences disabled, but this is
    // the authoritative last line of defense — Supabase RLS-bypassing service
    // client read, https://supabase.com/docs/reference/javascript/select). When
    // eventDateId is null this whole block is skipped → unchanged path.
    if (eventDateId !== null) {
      const { data: occRow, error: occErr } = await supabase
        .from("event_dates")
        .select("id, end_at")
        .eq("id", eventDateId)
        .eq("event_id", eventId)
        .maybeSingle();
      if (occErr !== null) {
        console.error(
          "[ticket-checkout-create] occurrence lookup failed",
          occErr,
        );
        return jsonResponse(
          { error: "occurrence_lookup_failed", detail: occErr.message },
          500,
        );
      }
      if (occRow === null) {
        // Not an occurrence of THIS event (or deleted) → unbookable.
        return refuse({ error: "occurrence_not_found" }, 422);
      }
      if (
        typeof occRow.end_at === "string" &&
        new Date(occRow.end_at).getTime() <= Date.now()
      ) {
        // The chosen occurrence already ended → unbookable.
        return refuse({ error: "occurrence_not_available" }, 422);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // issue #2160 — VALIDATE THE CHOSEN DAY SET AND DERIVE THE ANCHOR.
    // ═══════════════════════════════════════════════════════════════════════
    // ONE batched read, never N round trips. Every id must belong to THIS event
    // and must not have ended, else 422 — the same contract the single
    // `eventDateId` above already uses, so the client handles it already.
    //
    // The database re-validates all of this under the event lock (create-session
    // §B DELTA 3) and again at finalize (issue_1930_ticket_session_authorized).
    // This layer exists to give the guest a specific 422 instead of a generic
    // checkout failure, not to be the authority.
    // The SERVER-DERIVED anchor. Stays null on every path that sends no day
    // set, which is what keeps every ORCH-1072 write site below byte-identical.
    let anchorEventDateId: string | null = null;
    const orderedEventDateIds: string[] = [];
    if (eventDateIds.length > 0) {
      const { data: occRows, error: occSetErr } = await supabase
        .from("event_dates")
        .select("id, end_at")
        .eq("event_id", eventId)
        .in("id", eventDateIds)
        .order("start_at", { ascending: true });
      if (occSetErr !== null) {
        console.error(
          "[ticket-checkout-create] occurrence set lookup failed",
          occSetErr,
        );
        return jsonResponse(
          { error: "occurrence_lookup_failed", detail: occSetErr.message },
          500,
        );
      }
      const rows = (occRows ?? []) as Array<{ id: string; end_at: string | null }>;
      if (rows.length !== eventDateIds.length) {
        // At least one id is not an occurrence of THIS event (or was deleted).
        return refuse({ error: "occurrence_not_found" }, 422);
      }
      if (
        rows.some((row) =>
          typeof row.end_at === "string" &&
          new Date(row.end_at).getTime() <= Date.now()
        )
      ) {
        return refuse({ error: "occurrence_not_available" }, 422);
      }
      orderedEventDateIds.push(...rows.map((row) => row.id));

      // THE ANCHOR IS SERVER-AUTHORITATIVE — the client cannot nominate it.
      // It is the LATEST-**ENDING** chosen occurrence (D-2 /
      // I-PROPOSED-2160-B), and the top-level `eventDateId` body field is
      // IGNORED whenever a day set is present.
      //
      // WHY LATEST-ENDING AND NOT FIRST. `orders.event_date_id` is the payout
      // and refund anchor: `resolve_payout_live_occurrence` keys off it and the
      // NG release will not mature until `ed.end_at + interval '3 days' <=
      // now()`. Anchoring on the first day would release the organiser's money
      // while day 2 was still unattended and still refundable.
      let latestEnd = Number.NEGATIVE_INFINITY;
      for (const row of rows) {
        const end = typeof row.end_at === "string"
          ? new Date(row.end_at).getTime()
          : Number.NEGATIVE_INFINITY;
        if (end >= latestEnd) {
          latestEnd = end;
          anchorEventDateId = row.id;
        }
      }
    }

    // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — bookings-closed gate.
    // I-PROPOSED-TR4-BOOKING-DEADLINE-RESPECTED-AT-CHECKOUT (DRAFT) — last line
    // of defense. UI close banner + cron auto-close are defense-in-depth, not
    // enforcement. Trip-only effect (event_type='trip'); single-event flow
    // unchanged. Returns 403 with structured error so buyer-anon-web UI can
    // render the "Bookings closed" banner per DESIGN §4.4.
    const { data: tripGateRow, error: tripGateErr } = await supabase
      .from("events")
      .select("event_type, bookings_closed, booking_deadline")
      .eq("id", eventId)
      .maybeSingle();
    if (tripGateErr !== null) {
      console.error(
        "[ticket-checkout-create] bookings_closed gate lookup failed",
        tripGateErr,
      );
      return jsonResponse(
        { error: "event_lookup_failed", detail: tripGateErr.message },
        500,
      );
    }
    if (
      tripGateRow?.event_type === "trip" &&
      (tripGateRow.bookings_closed === true ||
        (typeof tripGateRow.booking_deadline === "string" &&
          new Date(tripGateRow.booking_deadline).getTime() <= Date.now()))
    ) {
      return jsonResponse(
        {
          error: "bookings_closed",
          detail: "Bookings closed",
          deadline: tripGateRow.booking_deadline ?? null,
        },
        403,
      );
    }

    // ORCH-0880 [Tr5 Traveler Intake Forms] — per-tier intake gate.
    // I-PROPOSED-TR5-INTAKE-REQUIRED-BLOCKS-CHECKOUT (DRAFT) — for each tier
    // in the buyer's cart, look up trip_intake_schemas. If a tier has schema
    // with ≥1 required question, the body MUST include intake_form_data for
    // that tier with all required questions answered AND a schema_version_id
    // matching the current row.
    // Body shape per SPEC §15.4 + intakeSchemaService.IntakeFormData:
    //   intake_form_data: [
    //     { ticket_type_id, schema_version_id, answers: {[questionId]: value} }
    //   ]
    // Trip-only effect; single-event flow unchanged (no event-side intake forms).
    if (tripGateRow?.event_type === "trip") {
      const intakeBody = Array.isArray(body.intake_form_data)
        ? (body.intake_form_data as Array<Record<string, unknown>>)
        : [];

      // Pull schemas for every ticket_type_id present in the cart.
      const ticketTypeIds = Array.from(
        new Set(lines.map((line) => line.ticketTypeId)),
      );
      if (ticketTypeIds.length > 0) {
        const { data: schemaRows, error: schemaErr } = await supabase
          .from("trip_intake_schemas")
          .select("ticket_type_id, schema, schema_version_id")
          .eq("event_id", eventId)
          .in("ticket_type_id", ticketTypeIds);
        if (schemaErr !== null) {
          console.error(
            "[ticket-checkout-create] intake schema lookup failed",
            schemaErr,
          );
          return jsonResponse(
            { error: "intake_schema_lookup_failed", detail: schemaErr.message },
            500,
          );
        }

        for (const row of schemaRows ?? []) {
          const schema = row.schema as
            | {
              questions?: Array<
                { id?: string; type?: string; required?: boolean }
              >;
            }
            | null;
          const schemaVersionId = row.schema_version_id as string;
          const ticketTypeId = row.ticket_type_id as string;
          if (schema === null || !Array.isArray(schema.questions)) continue;

          const requiredQuestionIds = schema.questions
            .filter((q) => q.required === true && typeof q.id === "string")
            .map((q) => q.id as string);

          const submitted = intakeBody.find(
            (entry) => entry.ticket_type_id === ticketTypeId,
          ) as
            | { schema_version_id?: string; answers?: Record<string, unknown> }
            | undefined;

          // Required gate: if schema has required questions, body MUST contain
          // intake_form_data for this tier with all required questions answered.
          if (requiredQuestionIds.length > 0) {
            const answers = submitted?.answers ?? {};
            const missingIds: string[] = [];
            for (const q of schema.questions) {
              if (q.required !== true || typeof q.id !== "string") continue;
              const value = answers[q.id];
              if (isIntakeAnswerEmpty(q.type ?? "", value)) {
                missingIds.push(q.id);
              }
            }
            if (missingIds.length > 0) {
              return jsonResponse(
                {
                  error: "intake_form_required",
                  ticket_type_id: ticketTypeId,
                  missing_question_ids: missingIds,
                },
                400,
              );
            }
          }

          // Schema-version freshness check: if buyer submitted intake_form_data
          // for this tier, the schema_version_id MUST match the current row
          // (planner may have edited schema mid-checkout, invalidating answers).
          if (
            submitted !== undefined &&
            submitted.schema_version_id !== schemaVersionId
          ) {
            return jsonResponse(
              {
                error: "intake_schema_stale",
                ticket_type_id: ticketTypeId,
                current_schema_version_id: schemaVersionId,
                submitted_schema_version_id: submitted.schema_version_id ??
                  null,
              },
              409,
            );
          }
        }
      }
    }

    // issue #2696 — DERIVED ONLY. The caller no longer supplies this.
    //
    // The edge used to accept `body.idempotencyKey` verbatim, with no
    // validation of any kind — not a prefix, not a length, not a relationship
    // to the event being bought. That key is the sole lookup for an existing
    // session (`WHERE idempotency_key=p_idempotency_key`, unscoped), so a
    // caller-supplied string could resolve a session belonging to a DIFFERENT
    // event, and to a different person.
    //
    // NO CLIENT HAS EVER SENT IT. Both native flows only forward an optional
    // field nothing populates, and the web service does not pass one at all —
    // verified across `mingla-business` and `app-mobile`. The branch was dead
    // for honest traffic and live only for someone probing it. The service's own
    // comment already described the intended model: "the server derives the
    // idempotency key from the request body alone."
    //
    // WHAT IT ENABLED, with no secret required. Disclosure still needs the
    // victim's 256-bit token, so this was never a route to someone's pass. But
    // naming any sellable public event, a caller could learn whether a completed
    // free reservation existed for a given email+phone+cart — INCLUDING on
    // private events and events outside their sale window, which would have
    // refused them outright if named honestly. And on an in-flight session it
    // reached far enough to overwrite a stranger's `buyer_status_token_hash`,
    // killing their checkout on an event the caller could not otherwise touch.
    //
    // The derived key embeds the event id, so deriving it always is the fix: a
    // request for event B can no longer be answered with event A's session. All
    // 179 live sessions already satisfy that relationship, so nothing legitimate
    // changes.
    const idempotencyKey = checkoutIdempotencyKey({
      eventId,
      buyerEmail,
      buyerPhoneE164,
      lines,
      paymentPlanChoice,
      // issue #2160 — day-aware. Empty => string-identical to today's key.
      eventDateIds: orderedEventDateIds,
    });
    const buyerStatusToken = randomBuyerStatusToken();

    const { data: sessionResult, error: sessionError } = await supabase.rpc(
      "biz_ticket_checkout_create_session",
      {
        p_event_id: eventId,
        p_buyer_user_id: userId,
        p_buyer_name: buyerName,
        p_buyer_email: buyerEmail,
        p_buyer_phone_e164: buyerPhoneE164,
        p_marketing_opt_in: marketingOptIn,
        p_lines: lines,
        p_idempotency_key: idempotencyKey,
        p_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        p_application_fee_amount_cents: 0,
        p_payment_plan_choice: paymentPlanChoice,
        // issue #2160 — the chosen day set. The RPC owns validation, the
        // event's pricing mode and the per-mode multiplier; this is a
        // passthrough. `null` when empty so the call is byte-identical to
        // today for every non-multi-day checkout.
        p_event_date_ids: orderedEventDateIds.length > 0
          ? orderedEventDateIds
          : null,
      },
    );

    if (sessionError || !sessionResult) {
      console.error(
        "[ticket-checkout-create] session RPC failed",
        sessionError,
      );
      // ═══ issue #2579 — RECORD THE REFUSAL, BECAUSE NOTHING ELSE DOES ═══
      //
      // The RPC refuses by RAISE, which rolls its transaction back, so no
      // session row survives to say what happened. Nothing reaches the logs
      // either: a search of every retained edge-log row found ZERO occurrences
      // of any refusal token. That absence is why the We Go Again report cost a
      // multi-day forensic pass instead of one query.
      //
      // THIS MUST NEVER AFFECT THE BUYER. It is deliberately not awaited and
      // its failure is swallowed: a telemetry outage that turned a refusal into
      // a 500 would be far worse than the blindness it fixes. The response
      // below is emitted on exactly the same path whether this succeeds or not.
      await recordCheckoutRefusal(supabase, {
        eventId,
        ticketTypeId: firstTicketTypeId(lines),
        message: sessionError?.message,
        quantity: totalRequestedQuantity(lines),
        surface,
        phoneE164: buyerPhoneE164,
        email: buyerEmail,
      });
      if (sessionError?.message?.includes("payment_plan_choice_invalid")) {
        {
        return jsonResponse({ error: "payment_plan_choice_invalid" }, 400);
      }
      }
      // Issue #2101 — the database re-decides under the event -> brand lock. If
      // the policy or membership changed between the Edge decision above and
      // the session RPC, the stable bounded contract is returned, not a generic
      // 409, and no session exists.
      const dbAccessDenial = ticketCheckoutAccessDenialFromDbMessage(
        sessionError?.message,
      );
      if (dbAccessDenial !== null) {
        return jsonResponse(
          { error: dbAccessDenial.error },
          dbAccessDenial.status,
        );
      }
      return jsonResponse(
        { error: "checkout_session_failed", detail: sessionError?.message },
        409,
      );
    }

    const session = sessionResult as Record<string, unknown>;
    const checkoutSessionId = String(session.checkoutSessionId ?? "");

    // ===================================================================
    // issue #2150 [duplicate free tickets on resubmit] — IDEMPOTENT REPLAY
    // OF AN ALREADY-COMPLETED FREE RESERVATION.
    // ===================================================================
    // Post-#2150 the session RPC no longer tombstones a completed ZERO-TOTAL
    // session; it returns that session verbatim, carrying `status:
    // 'free_completed'` and the `orderId` it already minted. That status is
    // unreachable from a fresh mint (the base RPC only ever answers
    // `pending_free` / `requires_payment` / `awaiting_web_redirect`), so this
    // branch is entered by exactly one thing: an identical free reservation
    // being submitted again after the first one COMPLETED — a refresh, a
    // back-navigation, a second tab.
    //
    // WHY IT SITS HERE, ABOVE THE STATUS-TOKEN UPDATE. The UPDATE below
    // overwrites `buyer_status_token_hash` with a freshly minted token's hash.
    // Running it first would (a) destroy the very hash the possession check
    // compares against, making the check unfalsifiable, and (b) silently
    // invalidate the REAL guest's token from their first submit, breaking
    // their `ticket-checkout-status` polling. A completed reservation's token
    // is never re-minted.
    //
    // A CONCURRENT double-tap does NOT arrive here: while the first request is
    // still in flight the session is `pending_free`, so the RPC's pre-existing
    // in-flight arm returns it with `orderId` NULL and the normal free arm
    // below runs (finalize is idempotent under its own row lock). That path is
    // untouched and needs no token.
    //
    // Nothing is re-run on this branch: no `biz_ticket_checkout_finalize`, no
    // `dispatchTicketConfirmation`, no `fireAdConversion`. The order, its
    // tickets, its two `ticket_order_notifications` rows and its ad conversion
    // were all created by the FIRST submit, and `notification-retry-sweeper`
    // owns redelivery of anything that failed to send.
    if (
      String(session.status ?? "") === "free_completed" &&
      String(session.orderId ?? "").length > 0
    ) {
      const replayedOrderId = String(session.orderId);
      // DISCLOSURE REQUIRES PROOF OF POSSESSION, NOT PROOF OF KNOWLEDGE.
      // The idempotency key is derived from the event, the buyer's email and
      // phone and the cart — all of which someone who knows the guest can type
      // into the form. Handing that caller the order and its QR payloads would
      // let them attend on the guest's pass, which `biz_ticket_scan` then marks
      // `used`, and the guest is refused at the door as a `duplicate`. That is
      // a denial of admission which did not exist before this issue.
      //
      // A signed-in session is proven by the JWT; an ANONYMOUS session must
      // present the buyer status token — the same secret that already gates
      // `ticket-checkout-status`. The database owns the decision so it is
      // provable against real rows rather than only against a fake.
      const { data: replayAuthorized, error: replayAuthError } = await supabase
        .rpc("issue_2150_free_replay_disclosure_authorized", {
          p_session_id: checkoutSessionId,
          p_buyer_user_id: userId,
          p_buyer_status_token_hash: presentedStatusTokenHash,
        });
      if (replayAuthError || replayAuthorized !== true) {
        // FAIL CLOSED ON DISCLOSURE, FAIL SAFE ON STATE. No order id, no
        // ticket, no QR payload leaves here — and NOTHING was minted, because
        // the RPC declined to tombstone regardless of who asked. Falling back
        // to tombstone-and-mint would hand this caller nothing but would hand
        // the GUEST a duplicate order, pass and confirmation, which is the
        // whole defect. The bounded token tells an honest client that the
        // reservation already exists without confirming anything about it.
        if (replayAuthError) {
          console.error(
            "[ticket-checkout-create] free replay authorization failed",
            checkoutSessionId,
            replayAuthError.message,
          );
        }
        return refuse({ error: "free_reservation_already_exists" }, 409);
      }
      const replayedTickets = await readIssuedTicketsForOrder(
        supabase,
        replayedOrderId,
        null,
      );
      if (replayedTickets.length === 0) {
        // The RPC only returns a completed free session when a live ticket
        // exists for its order, so an empty read-back is a real inconsistency
        // and must never be reported as a completed checkout (the #2136 rule).
        console.error(
          "[ticket-checkout-create] free replay order has no tickets",
          checkoutSessionId,
          replayedOrderId,
        );
        return jsonResponse(checkoutUnavailableResponse(), 409);
      }
      return jsonResponse({
        kind: "free_completed",
        orderId: replayedOrderId,
        checkoutSessionId,
        eventId: String(session.eventId ?? eventId),
        paymentStatus: "paid",
        totalCents: Number(session.totalCents ?? 0),
        currency: String(session.currency ?? ""),
        notificationStatus: "queued",
        tickets: replayedTickets,
        buyerPhoneE164,
        // Echoed, never re-minted: the caller proved possession WITH this
        // token, so returning it keeps their status polling working. A
        // signed-in caller who presented none simply gets none.
        ...(presentedStatusToken.length > 0
          ? { buyerStatusToken: presentedStatusToken }
          : {}),
      });
    }

    // ORCH-1072: persist the chosen occurrence onto the checkout session row's
    // metadata (validated above) so the booked event_date is recorded with the
    // session → order. Merged into the SAME UPDATE that writes the status token
    // (no extra round-trip). When eventDateId is null the metadata key is omitted
    // → byte-identical write to today (events/trips/one-off).
    const sessionUpdate: Record<string, unknown> = {
      buyer_status_token_hash: await sha256Hex(buyerStatusToken),
      updated_at: new Date().toISOString(),
    };
    // issue #2160 — `event_date_id` now carries the ANCHOR (the latest-ENDING
    // chosen day) whenever a day set was sent, and the client's top-level
    // `eventDateId` otherwise. `orders.event_date_id` therefore lands with NO
    // finalize change and the payout/refund control planes are untouched.
    //
    // `event_date_ids` is written for OBSERVABILITY ONLY. NOTHING may read it
    // as authority — `ticket_checkout_session_event_dates` (written by the RPC
    // under the event lock) is the authority, and `ticket_event_dates` is the
    // authority for what a pass admits.
    if (eventDateId !== null) {
      const existingMeta =
        typeof session.metadata === "object" && session.metadata !== null
          ? (session.metadata as Record<string, unknown>)
          : {};
      sessionUpdate.metadata = { ...existingMeta, event_date_id: eventDateId };
    }
    // ══ issue #2160 — THE ANCHOR OVERRIDES; IT DOES NOT REPLACE ════════════
    // The ORCH-1072 block above is left BYTE-IDENTICAL: its exact shape is
    // frozen by source pins T-A1/T-A4/T-A5 in
    // orch1072_experience_occurrence_checkout.test.ts and the experience
    // surface depends on it. #2160 writes AFTER it and therefore wins, which is
    // precisely the spec's rule — when a day set is present the client's
    // top-level `eventDateId` is IGNORED and the anchor is server-authoritative.
    //
    // The anchor is the LATEST-ENDING chosen day, so `orders.event_date_id`
    // lands with NO finalize change and the payout/refund control planes stay
    // untouched: a two-day order's money matures after the SECOND day ends,
    // never while day 2 is still unattended and still refundable.
    //
    // `event_date_ids` is OBSERVABILITY ONLY. Nothing may read it as authority —
    // `ticket_checkout_session_event_dates` (written by the RPC under the event
    // lock) is the authority for what was chosen, and `ticket_event_dates` is
    // the authority for what a pass admits.
    if (orderedEventDateIds.length > 0 && anchorEventDateId !== null) {
      const existingMeta =
        typeof session.metadata === "object" && session.metadata !== null
          ? (session.metadata as Record<string, unknown>)
          : {};
      sessionUpdate.metadata = {
        ...existingMeta,
        ...((sessionUpdate.metadata as Record<string, unknown> | undefined) ?? {}),
        event_date_id: anchorEventDateId,
        event_date_ids: orderedEventDateIds,
      };
    }
    // issue #2689 — NEVER RE-MINT THE TOKEN OF A SESSION THAT ALREADY HAS AN
    // ORDER. `.is("order_id", null)` is the whole fix, and it is load-bearing.
    //
    // The note above says a concurrent double-tap "does NOT arrive here" and is
    // harmless because finalize is idempotent. Production disproved the second
    // half. When a duplicate enters the in-flight arm, this UPDATE blocks on the
    // session row lock that finalize holds, and lands AFTER finalize committed —
    // overwriting `buyer_status_token_hash` with a token that request is about to
    // throw away, because it goes on to refuse. The winner's token, already
    // returned to their browser, is silently dead.
    //
    // PROVEN on order c3f481a5: `attendance_identity_claim_armed_at` is NULL —
    // alone among five — so that guest's pass never reached the app and even
    // their email lacked its claim link. The row keeps the fingerprint: an
    // `updated_at` EARLIER than its own `completed_at`, which only a second
    // create can produce. Two such rows exist.
    //
    // The paid rail loses more: the overwritten hash makes
    // `ticket-checkout-confirm` answer 403 `buyer_status_token_invalid` when the
    // buyer returns from Stripe. Money and tickets are correct; the buyer simply
    // cannot be shown them.
    //
    // A session with an `order_id` is finished. Its token is the guest's
    // possession proof and belongs to whoever completed it. Nobody else re-mints
    // it — not a duplicate, not a retry, not a second tab.
    const { error: statusTokenError } = await supabase
      .from("ticket_checkout_sessions")
      .update(sessionUpdate)
      .eq("id", checkoutSessionId)
      .is("order_id", null);
    if (statusTokenError) {
      console.error(
        "[ticket-checkout-create] buyer status token persist failed",
        statusTokenError,
      );
      return jsonResponse(
        {
          error: "checkout_session_failed",
          detail: "buyer_status_token_persist_failed",
        },
        409,
      );
    }

    // ISSUE-865 WP-C threading — DECOUPLED, best-effort, FAIL-OPEN (P2-1 rework).
    // The attribution_click_id write MUST NEVER sit on the fatal checkout-creation
    // path (it is written AFTER the fatal status-token UPDATE + its 409 guard, in
    // its own error-swallowing helper). If the column is absent (edge fns deployed
    // before migration 20270106000865 applies) OR the write fails for ANY reason,
    // attribution is simply skipped — the checkout completes normally. For non-ad
    // traffic (attributionClickId null) the helper no-ops → byte-identical.
    const attributionClickId = typeof body.attribution_click_id === "string" &&
        body.attribution_click_id.length > 0
      ? body.attribution_click_id
      : null;
    await persistAttributionClickId(supabase as never, checkoutSessionId, attributionClickId);
    await persistSiteAttributionToken(
      supabase,
      checkoutSessionId,
      body.site_attribution_token,
    );

    const totalCents = Number(session.totalCents ?? 0);
    // ORCH-1034 — the session/ticket currency (ticket → event currency). This is
    // the LEGACY charge-currency source; post-migration the AUTHORITATIVE charge
    // currency is the brand's settlement currency (pricing.pricing_currency,
    // resolved below). We keep this only as a same-currency cross-check + the
    // zero-amount/free-path display fallback before pricing is resolved.
    const sessionCurrency = String(session.currency ?? "GBP").toLowerCase();

    // ORCH-1006 Slice 2 (SPEC §C.4): the native-preview "addressMissing" early
    // return is DELETED. Preview now always computes the full venue-sourced all-in
    // with NO buyer address (WYSIWYP) — it flows through the same engine path as
    // create below, so the cart sticky bar shows the exact PaymentSheet total.

    // ORCH-0869 [Tr3 Installment Payments]: when the session RPC returns an
    // installmentSchedule (trip with payment plan), the deposit PI must save
    // the buyer's PaymentMethod off-session for the cron to charge future
    // installments. This is a NO-OP until Stage 1b RPC amendment lands —
    // until then session.installmentSchedule is always undefined.
    // Stage 1b: `biz_ticket_checkout_create_session` amended to return
    // installmentSchedule from trip_pricing_tiers.tier_metadata.installments.
    const isInstallmentPlan = session.installmentSchedule !== null &&
      session.installmentSchedule !== undefined;

    if (totalCents === 0) {
      // issue #2694 — THE PRE-GATE STAYS, and this comment is why.
      //
      // It looks redundant: `biz_ticket_checkout_finalize` already handles an
      // already-finalized session correctly, above its own sale-truth gate. So
      // the obvious change is to delete this call and branch on finalize's
      // outcome instead — which is exactly what was first proposed here.
      //
      // THAT WOULD HAVE BEEN THE WORST POSSIBLE CHANGE. On a concurrent
      // duplicate the session RPC's in-flight arm returns a stale
      // `pending_free`, so the #2150 possession branch above is skipped — by
      // design; that path is documented as needing no token. This gate is then
      // the ONLY thing between the caller and finalize's already-finalized arm,
      // and it decides by timing: pass, and the edge reads the winner's tickets
      // and renders their QR images for whoever asked; fail, and the guest who
      // owns them is told the sale is gone.
      //
      // A coin flip between disclosing a stranger's pass and lying to its
      // owner. Deleting the gate removes the coin and always discloses. Nothing
      // else stands behind it — no JWT is required, no code is sent to the
      // buyer, and the targeting key is taken verbatim from the request body.
      //
      // So the gate stays, and the replay case is now handled properly below:
      // finalize reports `replayed`, and a replay must PROVE POSSESSION exactly
      // as the #2150 branch does before anything is disclosed.
      const { data: freeAuthorized, error: freeAuthError } = await supabase.rpc(
        "issue_1930_ticket_session_authorized",
        { p_session_id: checkoutSessionId, p_event_id: eventId },
      );
      if (freeAuthError || freeAuthorized !== true) {
        return jsonResponse(checkoutUnavailableResponse(), 409);
      }
      let qrPepper: string;
      try {
        qrPepper = qrTokenPepper();
      } catch {
        return refuse({ error: "qr_token_pepper_missing" }, 500);
      }
      const { data: finalized, error: finalizeError } = await supabase.rpc(
        "biz_ticket_checkout_finalize",
        {
          p_checkout_session_id: checkoutSessionId,
          p_stripe_payment_intent_id: null,
          p_stripe_charge_id: null,
          p_stripe_payment_method_type: "free",
          p_qr_token_pepper: qrPepper,
        },
      );
      if (finalizeError || !finalized) {
        console.error(
          "[ticket-checkout-create] free finalize failed",
          finalizeError,
        );
        return jsonResponse(
          { error: "checkout_finalize_failed", detail: finalizeError?.message },
          409,
        );
      }
      // issue #2136 [free-ticket checkout] — BRANCH ON THE OUTCOME, NOT ON
      // OBJECT TRUTHINESS.
      //
      // `biz_ticket_checkout_finalize` always resolves to a jsonb envelope, so
      // the `!finalized` guard above can only ever catch a transport failure.
      // `{"outcome":"unavailable"}` and `{"outcome":"paid_reversal_pending"}`
      // are BOTH truthy objects that describe a finalize which created NO
      // order — and until this change they fell straight through into a 200
      // labelled `free_completed`. The guest was told a ticket that does not
      // exist had been reserved. Only `outcome === 'finalized'` may be
      // reported as a completed free checkout.
      const finalizedRecord = finalized as Record<string, unknown>;
      const finalizeOutcome = typeof finalizedRecord.outcome === "string"
        ? finalizedRecord.outcome
        : "";
      // issue #2694 — A REPLAY MUST PROVE POSSESSION BEFORE ANYTHING IS SHOWN.
      //
      // `replayed === true` means this call minted NOTHING: the order already
      // existed and finalize simply handed it back. That is the arm a
      // concurrent duplicate lands on, and it is reached WITHOUT the #2150
      // possession branch above, because the session still read `pending_free`
      // when it was loaded.
      //
      // So the same proof #2150 demands is demanded here, from the same
      // function, with the same fail-closed shape. An honest guest re-submitting
      // holds their token and is served; anyone else is refused, and the refusal
      // discloses nothing — not the order id, not a ticket, not a QR payload.
      //
      // Checked on the BOOLEAN, never on the absence of a `tickets` key. The two
      // arms did already differ in shape, but hanging a disclosure decision on a
      // missing field is exactly the kind of implicit contract that stops being
      // true without anybody noticing.
      if (finalizedRecord.replayed === true) {
        const { data: replayOk, error: replayErr } = await supabase.rpc(
          "issue_2150_free_replay_disclosure_authorized",
          {
            p_session_id: checkoutSessionId,
            p_buyer_user_id: userId,
            p_buyer_status_token_hash: presentedStatusTokenHash,
          },
        );
        if (replayErr || replayOk !== true) {
          if (replayErr) {
            console.error(
              "[ticket-checkout-create] replay authorization failed",
              checkoutSessionId,
              replayErr.message,
            );
          }
          // FAIL CLOSED ON DISCLOSURE, FAIL SAFE ON STATE — the #2150 shape.
          // Nothing was minted by this call, so nothing is undone; the caller is
          // simply told the reservation exists without being shown it.
          return refuse({ error: "free_reservation_already_exists" }, 409);
        }
      }
      if (finalizeOutcome === "unavailable") {
        // The sale lost current truth between session-create and finalize (or
        // the session vanished). Nothing was minted and nothing was charged.
        console.error(
          "[ticket-checkout-create] free finalize unavailable",
          checkoutSessionId,
        );
        return jsonResponse(checkoutUnavailableResponse(), 409);
      }
      if (finalizeOutcome === "paid_reversal_pending") {
        // Mirrors the paid path's handling verbatim in shape:
        // ticket-checkout-confirm/index.ts returns HTTP 409 with the bounded
        // `checkout_unavailable` token for this exact outcome. The database
        // owns the reversal/revocation bookkeeping; the Edge only reports the
        // bounded state. Post-#2136 a free session cannot reach this outcome
        // (the no-value arm answers `unavailable` instead) — it is kept as an
        // explicit handled branch so a future contract change surfaces here
        // rather than as a fake success.
        console.error(
          "[ticket-checkout-create] free finalize reversal-pending",
          checkoutSessionId,
          String(finalizedRecord.reversalReason ?? ""),
        );
        return jsonResponse(checkoutUnavailableResponse(), 409);
      }
      if (finalizeOutcome !== "finalized") {
        console.error(
          "[ticket-checkout-create] free finalize unknown outcome",
          checkoutSessionId,
          finalizeOutcome,
        );
        return jsonResponse(
          {
            error: "checkout_finalize_failed",
            detail: finalizeOutcome.length > 0
              ? `unexpected_outcome:${finalizeOutcome}`
              : "missing_outcome",
          },
          409,
        );
      }
      const orderId = String(finalizedRecord.orderId ?? "");
      if (orderId.length === 0) {
        console.error(
          "[ticket-checkout-create] free finalize returned no order",
          checkoutSessionId,
        );
        return jsonResponse(
          { error: "checkout_finalize_failed", detail: "order_missing" },
          409,
        );
      }
      // issue #2136 — SUPPLY `tickets`, read back from the canonical rows.
      //
      // The wrapper's fresh-mint arm merges the base RPC's envelope (which DOES
      // carry `tickets`), but its idempotent-replay arm — the `order_id IS NOT
      // NULL` early return — answers `{outcome,orderId}` with no tickets at
      // all. A retried tap therefore produced a `free_completed` body whose
      // `tickets` was undefined, which is what the buyer screen crashed on.
      // Reading the issued rows by order id covers BOTH arms with one code
      // path, and does not change the shared RPC's return shape (which the
      // Stripe webhook, the Paystack webhook, ticket-checkout-confirm and
      // reconcile-stuck-checkouts all consume).
      const freeTickets = await readIssuedTicketsForOrder(
        supabase,
        orderId,
        finalizedRecord.tickets,
      );
      if (freeTickets.length === 0) {
        console.error(
          "[ticket-checkout-create] free finalize order has no tickets",
          checkoutSessionId,
          orderId,
        );
        return jsonResponse(
          { error: "checkout_finalize_failed", detail: "tickets_missing" },
          409,
        );
      }
      // issue #2694 — NOT ON A REPLAY. The order, its tickets, its two
      // `ticket_order_notifications` rows and its ad conversion were all created
      // by the FIRST submit. Re-dispatching would send the guest a second
      // confirmation for one reservation, and re-firing the conversion would
      // double-count it. This is the same rule the #2150 replay branch already
      // states; it now also holds on the path that reaches finalize.
      if (finalizedRecord.replayed !== true) {
        // issue #2695 — NOT AWAITED. The buyer is told they are in as soon as
        // the ticket exists; the email and SMS follow on their own.
        //
        // Measured over 34 real purchases: the buyer waited 5 670 ms at p50, of
        // which 3 774 ms — 66% — was this call rendering and sending an email TO
        // THEM. They watched a spinner while a message about the thing that had
        // already succeeded went out. That dead time is also what made people tap
        // twice, which is #2689.
        //
        // SAFE BECAUSE THE WORK IS ALREADY DURABLE, not because the fetch is
        // reliable. `issue_1930_ticket_checkout_finalize_base` inserts both
        // `ticket_order_notifications` rows INSIDE its own transaction, before
        // this call exists. Dispatch consumes rows; it does not create them. The
        // worst case is a LATE email, never a lost one:
        // `orch_0788_notification_retry_sweeper` runs every 5 minutes and
        // collects a `pending` row once it is 5 minutes old.
        //
        // That backstop had NEVER fired in production — no `pending` row has ever
        // existed — and its own contract suite was red on main and registered in
        // no CI lane. #2695 repaired and registered it FIRST, and added the
        // behavioural case for the never-attempted arm this now depends on.
        // Leaning on an unguarded backstop would have been the same mistake in a
        // new place.
        //
        // Un-awaited work does complete on this runtime: 145 of 145 orders in ten
        // days carry an `ad_conversions` row written by the `void`ed call below,
        // landing seconds AFTER the response was emitted.
        void dispatchTicketConfirmation(orderId).catch((dispatchErr) => {
          // Never silent. The #2579 lesson: a swallowed error is a decision not
          // to FAIL, not a decision not to TELL ANYONE.
          console.error(
            "[ticket-checkout-create] confirmation dispatch failed (sweeper will retry)",
            orderId,
            dispatchErr instanceof Error
              ? dispatchErr.message
              : String(dispatchErr),
          );
        });

        // issue #2695 — the buyer's PUSH, which the free rail never fired. The
        // paid rail gets it via `fireOrderFinalizeNotifications`; the free rail
        // called nothing, so a signed-in guest reserving a free ticket got no
        // push and no in-app row.
        //
        // SCOPED to the buyer's push rather than calling
        // `fireOrderFinalizeNotifications` wholesale, which would ALSO start
        // firing the organiser's `business.order_paid` and the capacity alerts —
        // none of which have ever fired for a free order (2 rows lifetime against
        // 147). Notifying organisers about every free RSVP is a product decision,
        // not a side effect of a latency fix. Filed, not smuggled.
        //
        // HONEST SCOPE: this reaches 9 of 142 free buyers. The other 133 are
        // ANONYMOUS and have no account to push to — the helper returns early for
        // them. For those buyers the confirmation SCREEN is the immediate
        // notification, which is precisely what the change above makes ~3.8s
        // faster, and the email remains their durable copy.
        void fireBuyerPurchaseConfirmationPush(supabase as never, {
          orderId,
          eventId,
          brandId: typeof session.brandId === "string" ? session.brandId : null,
          eventTitle: typeof session.eventTitle === "string"
            ? session.eventTitle
            : "",
        }).catch((pushErr) => {
          console.warn(
            "[ticket-checkout-create] buyer confirmation push failed (non-fatal)",
            pushErr instanceof Error ? pushErr.message : String(pushErr),
          );
        });
      }
      // ISSUE-865 WP-B — ad-conversion CAPI send for the FREE-order path (its own
      // finalize; no webhook backup). FIRE-AND-FORGET (NOT awaited) so the buyer's
      // create response is never delayed — this path is on the buyer's tap→confirm
      // wait. Idempotent + fail-open; value_cents = 0 for a free RSVP. event_id
      // = orderId.
      if (finalizedRecord.replayed !== true) {
        void fireAdConversion(supabase as never, { orderId, surface: "web" })
        .catch(
          (adConvErr) => {
            console.warn(
              "[ticket-checkout-create] ad-conversion fire failed (non-fatal):",
              adConvErr instanceof Error
                ? adConvErr.message
                : String(adConvErr),
            );
          },
        );
      }
      // issue #2136 — the envelope is spread FIRST and every field the buyer
      // contract (`TicketCheckoutFreeCompleted`) declares is then written
      // explicitly, so the idempotent-replay arm — which answers only
      // `{outcome,orderId}` — can no longer produce `tickets: undefined`,
      // `totalCents: NaN` or a missing currency on the confirm screen.
      return jsonResponse({
        kind: "free_completed",
        ...finalizedRecord,
        orderId,
        checkoutSessionId,
        eventId: String(finalizedRecord.eventId ?? eventId),
        paymentStatus: "paid",
        totalCents: Number(finalizedRecord.totalCents ?? totalCents),
        currency: String(finalizedRecord.currency ?? session.currency ?? ""),
        notificationStatus: String(
          finalizedRecord.notificationStatus ?? "queued",
        ),
        tickets: freeTickets,
        buyerPhoneE164,
        // issue #2694 — ON A REPLAY, ECHO WHAT THEY PROVED WITH.
        //
        // `buyerStatusToken` here is freshly minted every request, but the
        // status-token UPDATE carries `.is("order_id", null)` (#2689), so on a
        // completed session it no-ops and this token's hash was NEVER STORED.
        // Returning it would hand the guest a key that opens nothing: status
        // polling, the attendance claim and any future replay would all fail
        // against a hash that does not exist.
        //
        // They reached this line by presenting a token that matched, so echo
        // that one back. It is the one the row actually holds.
        buyerStatusToken: finalizedRecord.replayed === true
          ? presentedStatusToken
          : buyerStatusToken,
      });
    }

    // ===================================================================
    // META-ORCH-1076 [Paystack Africa] — PAYSTACK ARM (NGN), additive branch.
    // ===================================================================
    // Resolve the brand pricing/provider row ONCE here (the resolver is STABLE /
    // idempotent — the Stripe arm below re-resolves it byte-for-byte, so the
    // Stripe path is unchanged). If this is a Paystack brand, run the entire
    // Paystack flow and return; otherwise fall through to the untouched Stripe
    // arm. The Paystack arm runs BEFORE the Stripe-specific stripe_account_not_ready
    // gate because a Paystack brand has no connected account (stripeAccountId is
    // NULL by design — the session RPC, post-migration, sets it NULL for Paystack).
    const { data: providerProbeRows } = await supabase.rpc(
      "resolve_event_pricing_inputs",
      { p_event_id: eventId },
    );
    const providerProbe =
      Array.isArray(providerProbeRows) && providerProbeRows.length > 0
        ? (providerProbeRows[0] as {
          payment_provider: string | null;
          payment_country: string | null;
          pricing_currency: string | null;
        })
        : null;
    const providerRouting = providerProbe
      ? resolveProviderRouting(providerProbe)
      : { provider: "stripe" as const, country: "", currency: "" };

    if (providerRouting.provider === "paystack") {
      // #2050 hard-host cutover: an old native binary would wait for
      // the retired hostname after Paystack. Refuse only that unsafe rail,
      // before Paystack is initialized; Stripe and browser checkout are intact.
      if (surface === "native" && body.returnContract !== "host_v1") {
        return jsonResponse(
          { error: "upgrade_required", requiredReturnContract: "host_v1" },
          426,
        );
      }
      // Full Paystack create flow. All-in math via the SAME engine
      // (computeBuyerSubtotal + computeConfigVat); finalize is deferred to
      // paystack-webhook → biz_ticket_checkout_finalize (no order minted here).
      const pricing = (providerProbe as unknown) as {
        pass_tax: boolean;
        pass_mingla_fee: boolean;
        pass_service_fee: boolean;
        pricing_region: string | null;
        pricing_currency: string | null;
        effective_take_rate_bps: number;
        take_rate_source: "brand_override" | "platform_default";
        payment_provider: string | null;
        payment_country: string | null;
        paystack_subaccount_code: string | null;
        vat_rate_bps: number | null;
      };

      // Currency must be NGN (Phase 1 = Nigeria only). Fail clean otherwise.
      const psCurrency = (providerRouting.currency || "NGN").toUpperCase();
      if (psCurrency !== "NGN") {
        console.error(
          "[ticket-checkout-create] paystack brand with non-NGN currency",
          { eventId, currency: psCurrency },
        );
        return jsonResponse(
          {
            error: "pricing_config_unavailable",
            detail: "paystack_currency_must_be_ngn",
          },
          409,
        );
      }

      const psSwitches: PricingSwitches = {
        pass_tax: pricing.pass_tax,
        pass_mingla_fee: pricing.pass_mingla_fee,
        pass_service_fee: pricing.pass_service_fee,
      };
      // region "NG" → exclusive VAT, computed in-engine (no Stripe round-trip).
      const psEngineInput: ComputeAllInInput = {
        baseCents: totalCents, // engine works in minor units; NGN minor unit = kobo
        switches: psSwitches,
        region: "NG",
        currency: "NGN",
        effectiveTakeRateBps: pricing.effective_take_rate_bps,
        takeRateSource: pricing.take_rate_source,
        serviceFeeBps: MINGLA_SERVICE_FEE_BPS,
      };
      const psSubtotal = computeBuyerSubtotal(psEngineInput);
      const { taxCents: psTaxCents, buyerTotalCents: psBuyerTotalCents } =
        computeConfigVat(
          psSubtotal.buyerSubtotalCents,
          pricing.vat_rate_bps ?? 0,
          psSwitches.pass_tax,
        );
      const psBreakdown: PricingBreakdown = buildPricingBreakdown({
        input: psEngineInput,
        amountTotalCents: psBuyerTotalCents,
        taxCents: psTaxCents,
        taxBasis: "config_vat",
        stripeTaxCalculationId: null,
      });
      const psApplicationFeeCents = psSubtotal.miglaFeeCents;

      // #1930: one deterministic Paystack identity for the logical checkout.
      // Network ambiguity never rotates this reference to escape provider truth.
      const psRequestFingerprint = await sha256Hex(JSON.stringify({
        checkoutSessionId,
        eventId,
        amount: psBuyerTotalCents,
        currency: psCurrency,
        applicationFee: psApplicationFeeCents,
        flow: "paystack_redirect",
      }));
      let psClaim: TicketAttemptClaim;
      try {
        psClaim = productionProviderAuthority
          ? await claimTicketProviderAttempt(supabase, {
            checkoutSessionId,
            eventId,
            provider: "paystack",
            flow: "paystack_redirect",
            requestFingerprint: psRequestFingerprint,
          })
          : { outcome: "fresh_claim", attemptId: checkoutSessionId, epoch: 1 };
      } catch {
        return jsonResponse(checkoutUnavailableResponse(), 409);
      }
      if (psClaim.outcome !== "fresh_claim") {
        return jsonResponse(
          psClaim.outcome === "revoked" || psClaim.outcome === "flow_conflict"
            ? checkoutUnavailableResponse()
            : { error: "checkout_in_progress" },
          409,
        );
      }
      const psReference = `mingla_${checkoutSessionId}`;
      const { error: psPersistError } = await supabase
        .from("ticket_checkout_sessions")
        .update({
          stripe_payment_intent_id: psReference,
          stripe_application_fee_amount_cents: psApplicationFeeCents,
          total_cents: psBuyerTotalCents, // the all-in NGN total the buyer is charged (kobo)
          status: "awaiting_web_redirect",
          updated_at: new Date().toISOString(),
        })
        .eq("id", checkoutSessionId);
      if (psPersistError) {
        console.error(
          "[ticket-checkout-create] paystack reference persist failed",
          psPersistError,
        );
        return jsonResponse(
          {
            error: "checkout_session_failed",
            detail: "paystack_reference_persist_failed",
          },
          409,
        );
      }

      // Callback the in-app browser intercepts. The buyer never parses payment
      // state from this URL — the client polls ticket-checkout-status, driven by
      // the verified charge.success webhook (the source of truth). We pass a
      // per-transaction callback_url to the real Host confirmation surface with
      // the session id + status token so the success screen can resolve.
      //   https://paystack.com/docs/payments/accept-payments/ (callback_url)
      const callbackSurface = tripGateRow?.event_type === "trip"
        ? "checkout-trip"
        : "checkout";
      const callbackUrl =
        `${PRODUCTION_BUSINESS_WEB_ORIGIN}/${callbackSurface}/${eventId}/confirm?cs=paystack&csi=${
          encodeURIComponent(checkoutSessionId)
        }&bst=${encodeURIComponent(buyerStatusToken)}`;

      // Channels: NG = card|bank|ussd|bank_transfer — NEVER mobile_money
      // (Ghana-only). https://paystack.com/docs/payments/payment-channels/
      const psChannels = paystackChannelsForCountry("NG");

      // #1178 [ng-split-removal] — read the payout-hold cut-over stamp for this
      // event's brand. A STAMPED brand (brands.payout_hold_cutover_at IS NOT NULL)
      // settles 100% to Mingla's main balance for later event-anchored release
      // (#1177) instead of splitting to the organiser subaccount at charge time.
      // Read-only embed mirroring the META-ORCH-1236 currency probe below; on ANY
      // read error fail CLOSED to today's split behaviour (isCutover=false) so a
      // transient failure can never drop an UNSTAMPED brand's subaccount split.
      // The buyer `amount` (amountSubunits) is untouched either way.
      const { data: cutoverRow, error: cutoverErr } = await supabase
        .from("events")
        .select("brands!inner(payout_hold_cutover_at)")
        .eq("id", eventId)
        .maybeSingle();
      if (cutoverErr) {
        console.error(
          "[ticket-checkout-create] payout_hold_cutover_at read failed; treating as unstamped",
          cutoverErr,
        );
      }
      const isCutover = ((): boolean => {
        const brandRel = (cutoverRow as
          | {
            brands?:
              | { payout_hold_cutover_at?: string | null }
              | { payout_hold_cutover_at?: string | null }[];
          }
          | null)?.brands;
        const brand = Array.isArray(brandRel) ? brandRel[0] : brandRel;
        return (brand?.payout_hold_cutover_at ?? null) !== null;
      })();

      // amount = psBuyerTotalCents, ALREADY in kobo (the engine works in minor
      // units; NGN minor unit is kobo). DO NOT multiply by 100 again — the
      // proof-slice harness multiplies because it takes MAJOR units; this branch
      // passes the already-minor engine total. (SC-7.)
      //   https://paystack.com/docs/api/transaction/#initialize
      let psInit: {
        authorization_url: string;
        reference: string;
        access_code: string;
      };
      try {
        psInit = await deps.paystackInitializeTransaction({
          email: buyerEmail,
          amountSubunits: psBuyerTotalCents,
          currency: "NGN",
          reference: psReference,
          callbackUrl,
          channels: psChannels,
          metadata: {
            mingla_checkout_session_id: checkoutSessionId,
            mingla_event_id: eventId,
            mingla_buyer_email: buyerEmail,
            // issue #2160 — how many days this reservation covers. Omitted for
            // every one-day reservation → byte-identical Paystack metadata.
            ...(orderedEventDateIds.length > 1
              ? { mingla_event_date_count: String(orderedEventDateIds.length) }
              : {}),
          },
          // #1178 [ng-split-removal] — split to the organiser subaccount ONLY for
          // an UNSTAMPED brand that has a subaccount (pass it + the flat Mingla
          // take, transaction_charge in kobo). A STAMPED (cut-over) brand — OR any
          // brand with no subaccount — omits all split fields and settles 100% to
          // the main Mingla account (event-anchored release is #1177). Either way
          // the buyer is charged the same all-in total (amountSubunits unchanged).
          //   https://paystack.com/docs/api/subaccount/
          ...paystackTicketSplitFields(
            isCutover,
            pricing.paystack_subaccount_code,
            psApplicationFeeCents,
          ),
        });
      } catch (err) {
        if (productionProviderAuthority) {
          await markTicketProviderUnknown(supabase, {
            attemptId: String(psClaim.attemptId),
            claimedEpoch: Number(psClaim.epoch),
          }).catch(() => undefined);
        } else {
          // Preserve the established injected-provider harness contract. The
          // production path remains provider_unknown because a timed-out
          // Paystack initialize may still have created a chargeable object.
          await supabase.from("ticket_checkout_sessions").update({
            status: "failed",
            failed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", checkoutSessionId);
        }
        console.error(
          "[ticket-checkout-create] paystack initialize failed",
          String((err as Error)?.message ?? err),
        );
        return jsonResponse(
          {
            error: "paystack_initialize_failed",
            detail: String((err as Error)?.message ?? err),
          },
          502,
        );
      }

      const psCommit = productionProviderAuthority
        ? await commitTicketProviderAttempt(supabase, {
          attemptId: String(psClaim.attemptId),
          claimedEpoch: Number(psClaim.epoch),
          providerReference: psReference,
          continuationFingerprint: await sha256Hex(psInit.authorization_url),
        }).catch(() => "revoked" as const)
        : "ready" as const;
      if (psCommit !== "ready") {
        return jsonResponse(checkoutUnavailableResponse(), 409);
      }

      return jsonResponse({
        kind: "requires_paystack_redirect",
        checkoutSessionId,
        buyerStatusToken,
        authorizationUrl: psInit.authorization_url,
        returnUrl: callbackUrl,
        reference: psInit.reference,
        // buyer_total is the inclusive all-in NGN total (kobo).
        totalCents: psBuyerTotalCents,
        currency: "NGN",
        pricingBreakdown: psBreakdown,
      });
    }
    // ===================================================================
    // END META-ORCH-1076 Paystack arm. Stripe arm below is UNCHANGED.
    // ===================================================================

    const stripeAccountId = typeof session.stripeAccountId === "string"
      ? session.stripeAccountId
      : null;
    if (!stripeAccountId) {
      return refuse({ error: "stripe_account_not_ready" }, 409);
    }

    // ORCH-1006 [Universal all-in pricing engine] — resolve the brand/event
    // pricing config (3 pass/absorb switches + region/currency + venue tax
    // basis + the CONFIGURABLE Mingla take-rate, global default with per-brand
    // override) for this event. One single-row read via the resolver RPC
    // (standalone, no clobber of the big session RPC). Replaces ORCH-0843's
    // hardcoded 1.5% application-fee constant (DEC: take-rate is now
    // operator-tunable in the admin /pricing screen; stored as integer basis
    // points; migration default = 150 bps = today's 1.5% → zero economic
    // change at migration). resolve_event_pricing_inputs is GRANTed to
    // service_role; this edge function runs service-role.
    const { data: pricingRows, error: pricingError } = await supabase.rpc(
      "resolve_event_pricing_inputs",
      { p_event_id: eventId },
    );
    if (
      pricingError || !Array.isArray(pricingRows) || pricingRows.length === 0
    ) {
      console.error(
        "[ticket-checkout-create] resolve_event_pricing_inputs failed",
        pricingError,
      );
      return jsonResponse(
        { error: "pricing_config_unavailable", detail: pricingError?.message },
        409,
      );
    }
    const pricing = pricingRows[0] as {
      pass_tax: boolean;
      pass_mingla_fee: boolean;
      pass_service_fee: boolean;
      pricing_region: string | null;
      pricing_currency: string | null;
      venue_tax_address: Record<string, unknown> | null;
      pricing_locked: boolean;
      effective_take_rate_bps: number;
      take_rate_source: "brand_override" | "platform_default";
    };
    // ORCH-1034 [de-GBP-ify the currency layer] — the AUTHORITATIVE charge currency
    // is the brand's settlement currency (brands.pricing_currency, aligned to
    // default_currency = the Stripe-synced settlement currency by the ORCH-1034
    // migration). Charging in the connected account's settlement currency means
    // presentment == settlement ⇒ ZERO Stripe FX. Doc:
    //   https://docs.stripe.com/connect/charges  (on_behalf_of settlement)
    //   https://docs.stripe.com/currencies        (presentment vs settlement)
    // For populated rows pricing_currency already equals the session/ticket
    // currency; on mismatch we PREFER pricing_currency (the post-migration
    // authority) and warn. If pricing_currency is somehow NULL at charge time
    // (should be impossible for a Stripe-ready brand post-migration), fail clean
    // rather than silently charging GBP.
    const settlementCurrencyRaw = typeof pricing.pricing_currency === "string"
      ? pricing.pricing_currency.trim()
      : "";
    if (settlementCurrencyRaw.length === 0) {
      console.error(
        "[ticket-checkout-create] pricing_currency missing for charge",
        { eventId },
      );
      return jsonResponse(
        {
          error: "pricing_config_unavailable",
          detail: "pricing_currency_missing",
        },
        409,
      );
    }
    const currency = settlementCurrencyRaw.toLowerCase();
    if (sessionCurrency !== currency) {
      console.warn(
        "[ticket-checkout-create] session/ticket currency != settlement currency; preferring settlement",
        { eventId, sessionCurrency, settlementCurrency: currency },
      );
    }

    // META-ORCH-1236 [live-currency fix] — DEFENSE-IN-DEPTH, WARN-ONLY currency
    // cross-check. The DB trigger tg_sync_brand_stripe_cache now guarantees
    // brands.pricing_currency == upper(brands.default_currency) (the active Stripe
    // connected-account settlement currency), so a mismatch here should be
    // unreachable. We assert it anyway against the already-synced
    // brands.default_currency mirror — NO extra Stripe round-trip on the checkout
    // hot path (no stripe.accounts.retrieve). Charging in the connected account's
    // settlement currency means presentment == settlement => zero Stripe FX:
    //   https://docs.stripe.com/connect/charges
    //   https://docs.stripe.com/api/payment_intents/create  (PaymentIntent currency)
    // Behavior: log a warning if pricing_currency disagrees with the account's
    // default_currency; do NOT hard-block (the trigger makes this a regression
    // tripwire, not a fix — blocking risks a false-positive outage). The existing
    // pricing_currency_missing fail-close above is untouched.
    {
      const { data: brandCcyRow } = await supabase
        .from("events")
        .select("brands!inner(default_currency)")
        .eq("id", eventId)
        .maybeSingle();
      const accountCurrencyRaw = (() => {
        const brandRel = (brandCcyRow as
          | {
            brands?: { default_currency?: string | null } | {
              default_currency?: string | null;
            }[];
          }
          | null)?.brands;
        const brand = Array.isArray(brandRel) ? brandRel[0] : brandRel;
        return typeof brand?.default_currency === "string"
          ? brand.default_currency.trim().toLowerCase()
          : "";
      })();
      if (accountCurrencyRaw.length > 0 && accountCurrencyRaw !== currency) {
        console.warn(
          "[ticket-checkout-create] META-ORCH-1236: settlement currency != connected-account default_currency (trigger regression?)",
          {
            eventId,
            pricingCurrency: currency,
            accountCurrency: accountCurrencyRaw,
          },
        );
      }
    }

    // ORCH-1034 — region follows the seller. The engine's taxBehaviorForRegion
    // now maps GB/EU/CH→inclusive, US→exclusive (no GB-throw). If pricing_region
    // is NULL or NOT in the enabled allowlist, we degrade to flat-absorb BEFORE
    // the engine is ever asked for a behavior, so the engine NEVER throws on a
    // real checkout (regression guard — see SPEC §5.C item 2 + the latent-throw
    // finding in INVESTIGATION_ORCH-1034_TAX_TIE_IN.md §3 PROVE-2).
    const ENABLED_PRICING_REGIONS = ["GB", "US", "EU", "CH"] as const;
    const rawRegion = typeof pricing.pricing_region === "string"
      ? pricing.pricing_region.trim().toUpperCase()
      : "";
    const regionIsEnabled = (ENABLED_PRICING_REGIONS as readonly string[])
      .includes(rawRegion);
    const pricingRegion = (regionIsEnabled ? rawRegion : "GB") as PricingRegion;
    // When the region is unknown/unmapped, force flat-absorb downstream (the tax
    // block below honors this flag and never calls taxBehaviorForRegion on it).
    const regionUnmappedForceFlatAbsorb = !regionIsEnabled;
    const pricingSwitches: PricingSwitches = {
      pass_tax: pricing.pass_tax,
      pass_mingla_fee: pricing.pass_mingla_fee,
      pass_service_fee: pricing.pass_service_fee,
    };

    // ORCH-1006 Slice 2 (SPEC §C.3 steps 2-4) — the all-in gross-up. The engine
    // is the single owner of the money math; it computes the buyer subtotal
    // (base + passed Mingla fee + passed service fee) BEFORE tax. The same
    // deterministic result feeds preview, create, and the PI amount so the
    // PaymentSheet shows the exact all-in the buyer was quoted (WYSIWYP).
    const engineInput: ComputeAllInInput = {
      baseCents: totalCents,
      switches: pricingSwitches,
      region: pricingRegion,
      currency,
      effectiveTakeRateBps: pricing.effective_take_rate_bps,
      takeRateSource: pricing.take_rate_source,
      serviceFeeBps: MINGLA_SERVICE_FEE_BPS,
    };
    const buyerSubtotal = computeBuyerSubtotal(engineInput);
    // application_fee_amount = Mingla's take-rate skim (miglaFeeCents), ALWAYS
    // (independent of pass/absorb — the switch only changes the buyer-facing
    // gross-up, not what Mingla collects). Direct-charge collection:
    // https://docs.stripe.com/api/payment_intents/create#create_payment_intent-application_fee_amount
    // https://docs.stripe.com/connect/direct-charges#collect-fees
    // Integer basis-point math (no float; invariant I-PROPOSED-TAKE-RATE-BPS-INTEGER).
    // Omitted from the Stripe body when it rounds to zero (existing >0 guard kept).
    const applicationFeeAmountCents = buyerSubtotal.miglaFeeCents;

    // ORCH-0843 — persist the computed fee on the session row so the refund
    // flow (refund-order) can read it back via biz_refund_order and decide
    // whether to pass refund_application_fee:true. The finalize RPC copies
    // ticket_checkout_sessions.stripe_application_fee_amount_cents into
    // orders.stripe_application_fee_amount_cents (migrations 20260515000013
    // lines 555-568). #2097 makes this the fail-closed money-truth boundary:
    // no hosted Checkout or native PaymentIntent may be created when it fails.
    const { error: feePersistError } = await supabase
      .from("ticket_checkout_sessions")
      .update({
        stripe_application_fee_amount_cents: applicationFeeAmountCents,
        updated_at: new Date().toISOString(),
      })
      .eq("id", checkoutSessionId);
    if (feePersistError) {
      console.error(
        "[ticket-checkout-create] application fee persistence failed",
      );
      return jsonResponse({ error: "application_fee_persistence_failed" }, 503);
    }

    // ORCH-0790: web buyer flow uses Stripe Checkout Sessions (hosted page +
    // redirect). Native flow continues to use PaymentIntent + Stripe RN
    // PaymentSheet below.
    // ORCH-0839-B (2026-05-14): "mobile-web" surface joins this branch — same
    // hosted-Checkout API call, only success_url / cancel_url differ. Native
    // PaymentIntent path below stays for backward compat with older mingla-
    // business builds (untouched by this pivot).
    // ORCH-0843 (2026-05-15): flipped to DIRECT-CHARGE shape per DEC-154
    // (amended Path B). The charge object now lives on the connected
    // account (Stripe-Account header via the third-arg `stripeAccount`
    // request option); transfer_data.destination is gone; Mingla's
    // platform cut routes via application_fee_amount; the buyer's card
    // statement is suffixed with "MINGLA" via statement_descriptor_suffix
    // (Stripe's Checkout API only accepts `_suffix` at this level; a true
    // "MINGLA*" prefix requires one-time account-level config in Stripe
    // Dashboard on Mingla's main platform account).
    // DO NOT re-introduce transfer_data.destination — see INVESTIGATION_
    // ORCH-0843 + SPEC_ORCH-0843. CI gate
    // orch-0843-stripe-direct-charges-only.mjs enforces.
    if (surface === "web" || surface === "mobile-web") {
      let successUrl: string;
      let cancelUrl: string;
      if (surface === "web") {
        // ISSUE-927: BUSINESS_WEB_ORIGIN is the canonical secret; the old name
        // is a fallback so its deletion is safely decoupled (same digest).
        const baseUrl = Deno.env.get("BUSINESS_WEB_ORIGIN") ??
          Deno.env.get("MINGLA_PUBLIC_WEB_BASE_URL");
        if (!baseUrl || !/^https:\/\/[^\s]+$/.test(baseUrl)) {
          console.error(
            "[ticket-checkout-create] BUSINESS_WEB_ORIGIN (or the legacy MINGLA_PUBLIC_WEB_BASE_URL) not set or invalid",
          );
          return refuse({ error: "web_base_url_missing" }, 500);
        }
        // ORCH-0911: branch buyer-web confirm/payment URLs on event_type.
        const isTrip = tripGateRow?.event_type === "trip";
        const surfacePath = isTrip ? "checkout-trip" : "checkout";
        // ORCH-0928 v2 (2026-05-23) — query-string recovery params for
        // confirm.tsx. v3 dual-format hack reverted 2026-05-23 ~12:50 UTC
        // after live-fire confirmed the fragment portion triggers Expo
        // Router URL mangling that defeats BOTH v1 and v2 client recovery.
        // Query-string-only is the correct stable shape — v2 client reads
        // csi+bst from `search` via URLSearchParams. v1 client (still live
        // on production pending Vercel rate-limit reset OR plan upgrade)
        // cannot recover from this format and stays on loading hero;
        // production buyers are broken until Vercel deploys v2 client.
        successUrl =
          `${baseUrl}/${surfacePath}/${eventId}/confirm?cs={CHECKOUT_SESSION_ID}&csi=${checkoutSessionId}&bst=${buyerStatusToken}`;
        cancelUrl = `${baseUrl}/${surfacePath}/${eventId}/payment`;
      } else {
        // ORCH-0839-B: mobile-hosted Checkout returns to the native app via a
        // custom-scheme deep link. expo-web-browser.openAuthSessionAsync
        // intercepts this URL inside the in-app browser session and resolves
        // with type:"success" + the full URL (so the app can read `cs` from
        // the query string). The scheme `mingla-business` is registered in
        // mingla-business/app.config.js; reusing it for /checkout/return is
        // safe because /onboarding-complete and /checkout/return have
        // disjoint route handlers (and there is no in-app Linking listener —
        // the in-app browser session intercepts before the OS even tries to
        // wake the host app). Decision-gate probe 2026-05-14 confirmed Stripe
        // accepts this custom scheme on checkout.sessions.create.
        successUrl =
          `mingla-business://checkout/return?cs={CHECKOUT_SESSION_ID}&eventId=${eventId}&status=success`;
        cancelUrl =
          `mingla-business://checkout/return?cs={CHECKOUT_SESSION_ID}&eventId=${eventId}&status=cancel`;
      }
      const eventName =
        typeof session.eventName === "string" && session.eventName.length > 0
          ? session.eventName
          : "Tickets";

      let stripeWeb: ReturnType<typeof stripeTicketCheckout>;
      let checkoutSession: { id: string; url: string | null };
      const webRequestFingerprint = await sha256Hex(JSON.stringify({
        checkoutSessionId,
        eventId,
        amount: buyerSubtotal.buyerSubtotalCents,
        currency,
        applicationFee: applicationFeeAmountCents,
        flow: "stripe_checkout",
      }));
      const webClaim = await claimTicketProviderAttempt(supabase, {
        checkoutSessionId,
        eventId,
        provider: "stripe",
        flow: "stripe_checkout",
        requestFingerprint: webRequestFingerprint,
      }).catch(() => null);
      if (
        webClaim === null || webClaim.outcome === "revoked" ||
        webClaim.outcome === "flow_conflict"
      ) {
        return jsonResponse(checkoutUnavailableResponse(), 409);
      }
      if (
        webClaim.outcome === "provider_unknown" ||
        webClaim.outcome === "in_progress"
      ) {
        return refuse({ error: "checkout_in_progress" }, 409);
      }
      try {
        stripeWeb = stripeTicketCheckout();
        // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
        // ORCH-0804 / I-PROPOSED-BF — Stripe Tax enablement.
        // Under DIRECT charges the Stripe-Account header (set on the
        // request-options below) alone designates the connected account
        // (brand) as merchant of record — automatic_tax.liability MUST be
        // OMITTED (ORCH-0843 REWORK; Stripe rejects the liability block on
        // direct charges with 400 StripeInvalidRequestError, see
        // https://docs.stripe.com/tax/connect/direct-charges). Stripe
        // Checkout auto-collects the buyer's billing address on the new
        // Customer (created when customer_creation: "always" is set for
        // installment plans, per ORCH-0925) when automatic_tax is enabled,
        // so jurisdiction lookup works without a customer_update
        // block. (ORCH-0811 removed customer_update: it requires an
        // existing `customer` id and Stripe rejects the request with "You
        // cannot use customer_update without setting customer" when paired
        // with customer_email.) The strict-grep gates
        // orch-0804-stripe-tax-enabled-on-checkout (enabled: true) and
        // orch-0843-stripe-direct-charges-only (T-G6: no liability block)
        // enforce these params at CI time.
        const piData: Record<string, unknown> = {
          // Metadata replicated on the PI so the existing webhook router
          // (handleTicketCheckoutPaymentIntent) can resolve our session
          // via metadata fallback when the session was created without a
          // pre-known PI id.
          metadata: {
            mingla_checkout_session_id: checkoutSessionId,
            mingla_event_id: eventId,
            mingla_buyer_email: buyerEmail,
            // ORCH-0869 [Tr3 Installment Payments]: mark deposit PI as
            // installment-plan-root so finalize RPC (Stage 1b) can write the
            // installment_plan_root=true flag on the orders row + create
            // child order_installments rows.
            ...(isInstallmentPlan
              ? { mingla_installment_plan_root: "true" }
              : {}),
          },
          // ORCH-0869: save the PaymentMethod for off-session installment charges.
          // Cron in process-scheduled-installments uses the saved PM via the
          // connected-account Customer (ORCH-0844 ephemeralKey path).
          ...(isInstallmentPlan ? { setup_future_usage: "off_session" } : {}),
          // ORCH-0843 — `statement_descriptor_suffix` appends "MINGLA" to the
          // creator account's default descriptor on the buyer's card statement
          // (Stripe truncates the combined string to 22 chars). Per Stripe's
          // Checkout API, only `_suffix` is valid at this level — a true
          // platform "MINGLA*" prefix is a one-time account-level config in
          // the Stripe Dashboard (Settings → Public details → Statement
          // descriptor on Mingla's main platform account) that prepends to
          // every connected-account charge automatically.
          statement_descriptor_suffix: "MINGLA",
        };
        if (applicationFeeAmountCents > 0) {
          // ORCH-0843 — Mingla's platform cut routes via application_fee_amount.
          // Omitted (not set to 0) when fee rounds to zero on tiny orders.
          piData.application_fee_amount = applicationFeeAmountCents;
        }
        checkoutSession = webClaim.outcome === "existing_ready" &&
            typeof webClaim.providerCheckoutId === "string"
          ? await stripeWeb.checkout.sessions.retrieve(
            webClaim.providerCheckoutId,
            { stripeAccount: stripeAccountId },
          )
          : await stripeWeb.checkout.sessions.create(
            {
              mode: "payment",
              currency,
              line_items: [
                {
                  price_data: {
                    currency,
                    // ORCH-1147 (D-1 / I-PROPOSED-1147-WEB-CHARGE-BILLS-FEE-GROSSED-SUBTOTAL,
                    // DRAFT) — bill the fee-grossed PRE-TAX subtotal
                    // (buyerSubtotal.buyerSubtotalCents = base + passed Mingla fee +
                    // passed service fee), NOT the bare base `totalCents`, so the web
                    // charge matches the native fee gross-up. The hosted Checkout
                    // Session has automatic_tax.enabled below — Stripe ADDS tax on
                    // top of this line item; billing the tax-inclusive
                    // buyer_total_cents here would DOUBLE-tax. Pre-tax subtotal is
                    // the correct basis. (OQ-1: corrects the dispatch's shorthand
                    // "bill buyer_total_cents" for the WEB hosted-Checkout path.)
                    unit_amount: buyerSubtotal.buyerSubtotalCents,
                    product_data: { name: `Tickets — ${eventName}` },
                  },
                  quantity: 1,
                },
              ],
              payment_intent_data: piData,
              // ORCH-0843 REWORK — Under DIRECT charges (Stripe-Account header
              // set on the request-options below), Stripe Tax for Platforms uses
              // the Stripe-Account header alone to designate the connected
              // account as merchant of record. The legacy
              // `liability: { type: "account", account: <id> }` shape is for
              // destination/separate-transfer charges only and is REJECTED with
              // 400 StripeInvalidRequestError on direct-charge calls. See
              // https://docs.stripe.com/tax/connect/direct-charges — under
              // direct charges the connected account is the merchant of record
              // implicitly; do NOT include automatic_tax.liability. This block
              // replaces the SPEC §3.1.3 "PRESERVED VERBATIM" claim which was
              // SUPERSEDED by ORCH-0843 REWORK after QA caught the 400 in live.
              automatic_tax: { enabled: true },
              // ORCH-0925 — installment plans MUST attach a Stripe Customer so
              // the cron `process-scheduled-installments` can later charge the
              // saved PaymentMethod off-session via `customer + payment_method`.
              // Stripe's default `customer_creation: "if_required"` for
              // `mode: "payment"` does NOT create a Customer just because
              // `customer_email` is set — `setup_future_usage: "off_session"`
              // alone saves the PM but leaves it orphaned (no Customer attached),
              // which the cron cannot charge. Setting `customer_creation: "always"`
              // forces Stripe to create the Customer + attach the PM post-checkout
              // so `paymentIntent.customer` resolves to a real `cus_xxx`. Full-pay
              // checkouts are unaffected (default remains `"if_required"`).
              // ORCH-0811 customer_update note retained: customer_update would
              // require a pre-existing `customer` id (which we don't have at
              // create time), so it stays omitted; `automatic_tax.enabled: true`
              // collects billing address on the new Customer for tax jurisdiction.
              ...(isInstallmentPlan
                ? { customer_creation: "always" as const }
                : {}),
              customer_email: buyerEmail,
              success_url: successUrl,
              cancel_url: cancelUrl,
              metadata: {
                mingla_checkout_session_id: checkoutSessionId,
                mingla_event_id: eventId,
              },
            },
            {
              idempotencyKey: `ticket_checkout_web:${checkoutSessionId}`,
              // ORCH-0843 — direct-charge: Stripe-Account header routes the
              // charge object to the connected account. Replaces destination-
              // charge transfer_data.destination from ORCH-0790.
              stripeAccount: stripeAccountId,
            },
          );
      } catch (err) {
        if (webClaim.outcome === "fresh_claim") {
          await markTicketProviderUnknown(supabase, {
            attemptId: String(webClaim.attemptId),
            claimedEpoch: Number(webClaim.epoch),
          }).catch(() => undefined);
        }
        const failure = classifyStripeCheckoutSessionCreateFailure(err);
        console.error(
          "[ticket-checkout-create] checkout session create failed",
          failure.detail,
        );
        // Persist only the bounded classifier detail. A create timeout is
        // provider-ambiguous, so the attempt remains provider_unknown and the
        // sale must not be terminally failed or assigned a guessed identity.
        await supabase
          .from("ticket_checkout_sessions")
          .update({
            failure_reason: failure.detail,
            updated_at: new Date().toISOString(),
          })
          .eq("id", checkoutSessionId)
          .is("stripe_payment_intent_id", null);
        return jsonResponse(
          { error: "checkout_session_create_failed", detail: failure.detail },
          failure.httpStatus,
        );
      }

      if (!checkoutSession.url) {
        return refuse({ error: "checkout_session_url_missing" }, 502);
      }

      if (webClaim.outcome === "fresh_claim") {
        const webCommit = await commitTicketProviderAttempt(supabase, {
          attemptId: String(webClaim.attemptId),
          claimedEpoch: Number(webClaim.epoch),
          providerCheckoutId: checkoutSession.id,
          continuationFingerprint: await sha256Hex(checkoutSession.url),
        }).catch(() => "revoked" as const);
        if (webCommit !== "ready") {
          try {
            await stripeWeb.checkout.sessions.expire(checkoutSession.id, {
              idempotencyKey: `ticket_checkout_expire:${checkoutSessionId}`,
              stripeAccount: stripeAccountId,
            });
          } catch {
            // Durable revocation outbox owns reconciliation/retry.
          }
          return jsonResponse(checkoutUnavailableResponse(), 409);
        }
      }

      const { error: persistWebError } = await supabase
        .from("ticket_checkout_sessions")
        .update({
          status: "awaiting_web_redirect",
          stripe_checkout_session_id: checkoutSession.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", checkoutSessionId);
      if (persistWebError) {
        console.error(
          "[ticket-checkout-create] checkout session persist failed",
          persistWebError,
        );
        return jsonResponse(
          {
            error: "checkout_session_persist_failed",
            detail: persistWebError.message,
          },
          500,
        );
      }

      return jsonResponse({
        kind: "requires_web_redirect",
        checkoutSessionId,
        buyerStatusToken,
        hostedCheckoutUrl: checkoutSession.url,
        totalCents,
        // ORCH-1034 — report the settlement (charge) currency, not the legacy
        // session/ticket currency with a GBP fallback.
        currency: currency.toUpperCase(),
      });
    }

    let nativeClaim: TicketAttemptClaim | null = null;
    if (mode === "create") {
      nativeClaim = await claimTicketProviderAttempt(supabase, {
        checkoutSessionId,
        eventId,
        provider: "stripe",
        flow: "stripe_native",
        requestFingerprint: await sha256Hex(JSON.stringify({
          checkoutSessionId,
          eventId,
          totalCents,
          currency,
          applicationFee: applicationFeeAmountCents,
          flow: "stripe_native",
        })),
      }).catch(() => null);
      if (
        nativeClaim === null || nativeClaim.outcome === "revoked" ||
        nativeClaim.outcome === "flow_conflict"
      ) {
        return jsonResponse(checkoutUnavailableResponse(), 409);
      }
      if (
        nativeClaim.outcome === "provider_unknown" ||
        nativeClaim.outcome === "in_progress"
      ) {
        return refuse({ error: "checkout_in_progress" }, 409);
      }
    }

    // ORCH-0844 (2026-05-15) + ORCH-0925 (2026-05-22) — Connect direct-charge
    // mobile config + Customer attachment for installment plans.
    //
    // For full-pay flows this is non-fatal mobile config: PaymentSheet falls
    // back to guest mode (null customer fields) on failure. For installment
    // plans (ORCH-0925) this is FATAL: off-session installment charges require
    // a real Customer with the saved PM attached, so missing customer/PM here
    // means the cron `process-scheduled-installments` cannot charge later and
    // the booking silently loses revenue. We attach `customer: customerId` to
    // the deposit PI for installment plans so `setup_future_usage: "off_session"`
    // correctly binds the PM to the Customer. Full-pay PIs do NOT receive
    // `customer` (preserves existing behavior + Stripe Tax direct-charge shape).
    //
    // Block must run BEFORE paymentIntents.create so customerId is available
    // for piCreateBody construction.
    let customerId: string | null = null;
    let customerEphemeralKeySecret: string | null = null;
    let customerProvisioningError: unknown = null;
    try {
      const stripeForCustomer = stripeTicketCheckout();
      // 3.2.3.a — Idempotent customer lookup by email on the CONNECTED ACCOUNT.
      // The { stripeAccount } request option scopes the search to that account.
      // orch-strict-grep-allow stripe-no-idempotency-key — read-only search; idempotency-key on Stripe search calls is rejected by the API (search is a query, not a mutation).
      const searchResult = await stripeForCustomer.customers.search(
        {
          query: `email:'${buyerEmail.replace(/'/g, "\\'")}'`,
          limit: 1,
        },
        { stripeAccount: stripeAccountId },
      );
      let customer = searchResult.data[0] ?? null;

      if (customer === null) {
        // 3.2.3.b — Idempotent creation by email-hashed idempotency-key.
        const customerIdemKey =
          `mingla_customer:${stripeAccountId}:${await sha256Hex(buyerEmail)}`;
        customer = await stripeForCustomer.customers.create(
          {
            email: buyerEmail,
            metadata: {
              mingla_buyer_email: buyerEmail,
              mingla_origin: "ticket_checkout_create_native",
            },
          },
          {
            idempotencyKey: customerIdemKey,
            stripeAccount: stripeAccountId,
          },
        );
      }
      customerId = customer.id;

      // 3.2.3.c — EphemeralKey for the mobile SDK, scoped to the connected
      // account. apiVersion is the platform's pinned STRIPE_API_VERSION;
      // ahead-of-SDK versions are non-fatal — the sheet still loads.
      const ephemeralKeyIdemKey =
        `mingla_ephkey:${stripeAccountId}:${customerId}:${Date.now()}`;
      const ephemeralKey = await stripeForCustomer.ephemeralKeys.create(
        { customer: customerId },
        {
          apiVersion: STRIPE_API_VERSION,
          stripeAccount: stripeAccountId,
          idempotencyKey: ephemeralKeyIdemKey,
        },
      );
      customerEphemeralKeySecret = String(ephemeralKey.secret ?? "");
      if (customerEphemeralKeySecret.length === 0) {
        // defensive: empty secret — treat as failure (paired-or-absent invariant).
        customerId = null;
        customerEphemeralKeySecret = null;
      }
    } catch (customerErr) {
      customerProvisioningError = customerErr;
      customerId = null;
      customerEphemeralKeySecret = null;
    }

    // ORCH-0925 — for installment plans, customer+PM is FATAL (off-session
    // cron charge cannot proceed without it). For full-pay, fall back to
    // guest-mode PaymentSheet (preserves ORCH-0844 behavior).
    if (isInstallmentPlan && customerId === null) {
      console.error(
        "[ticket-checkout-create] installment plan customer provisioning failed",
        customerProvisioningError instanceof Error
          ? customerProvisioningError.message
          : customerProvisioningError,
      );
      await supabase
        .from("ticket_checkout_sessions")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          failure_reason: "installment_customer_provisioning_failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", checkoutSessionId);
      return jsonResponse(
        {
          error: "installment_customer_provisioning_failed",
          detail: customerProvisioningError instanceof Error
            ? customerProvisioningError.message
            : "unknown",
        },
        502,
      );
    }
    if (!isInstallmentPlan && customerProvisioningError !== null) {
      // Full-pay: log and continue in guest mode (ORCH-0844 behavior preserved).
      console.warn(
        "[ticket-checkout-create] customer+ephemeralKey creation failed; continuing in guest mode",
        customerProvisioningError instanceof Error
          ? customerProvisioningError.message
          : customerProvisioningError,
      );
    }

    // ORCH-1006 Slice 2 — the tax calc now uses ONE line item whose amount is the
    // engine-grossed-up buyer subtotal (SPEC §C.3 step 5), so the per-tier
    // tax-line decomposition (rawTaxLineItems / normalizeTaxLineItemsForCurrentCharge)
    // is no longer used on the calc path. The installment-deposit normalisation is
    // preserved implicitly: buyerSubtotal is derived from totalCents, which the
    // session RPC already sets to the deposit amount for installment plans.

    let taxCalculation: TaxCalculationSummary | null = null;
    if (clientTaxCalculationId !== null && !isInstallmentPlan) {
      try {
        const stripeForExistingTax = stripeTicketCheckout();
        // @ts-ignore -- Stripe SDK Tax namespace is runtime-provided in Deno.
        const existing = await stripeForExistingTax.tax.calculations.retrieve(
          clientTaxCalculationId,
          {},
          { stripeAccount: stripeAccountId },
        );
        const expiresAt = Number(existing.expires_at ?? 0);
        if (existing?.id && expiresAt > Math.floor(Date.now() / 1000)) {
          taxCalculation = {
            id: String(existing.id),
            amount_total: Number(existing.amount_total ?? totalCents),
            tax_breakdown: Array.isArray(existing.tax_breakdown)
              ? existing.tax_breakdown
              : [],
          };
        }
      } catch {
        taxCalculation = null;
      }
    }

    // ORCH-1006 Slice 2 — venue-sourced tax with degrade-not-fail (SPEC §B/§C.2).
    // The tax basis is taxBehaviorForRegion(region) (GB→"inclusive"), NOT a
    // hardcoded literal; the customer address is the VENUE (venue_tax_address),
    // NOT the buyer; and ANY failure degrades to flat brand-absorbed pricing
    // (one clean number) rather than failing the session (SPEC §B.4, T-02/T-10).
    let taxBasis: TaxBasis = "venue_resolved";
    // ORCH-1034 — tax_behavior is a thin per-region DISPLAY flag (GB/EU/CH →
    // "inclusive", US → "exclusive"); Stripe Tax owns the AMOUNT. pricingRegion
    // is guaranteed to be an enabled region here (the unmapped case was coerced
    // to "GB" + flagged regionUnmappedForceFlatAbsorb), so this never throws.
    const taxBehavior = taxBehaviorForRegion(pricingRegion);
    // Tax is computed on the grossed-up buyer subtotal so the all-in is internally
    // consistent (SPEC §C.3 step 5). For inclusive (GB), Stripe returns
    // amount_total === sum(line amounts) === buyerSubtotal (VAT extracted inside).
    const taxAmountCents = buyerSubtotal.buyerSubtotalCents;

    if (taxCalculation === null) {
      // SPEC §B.5 / §C.2 — registration gate. Stripe Tax only collects where the
      // connected account has an active registration; if none, degrade (don't
      // charge tax the brand can't remit). Probe BEFORE the calc.
      // Doc: https://docs.stripe.com/api/tax/registrations/list
      let hasActiveRegistration = false;
      if (
        pricing.pass_tax && pricing.venue_tax_address &&
        !regionUnmappedForceFlatAbsorb
      ) {
        try {
          const stripeForReg = stripeTicketCheckout();
          // @ts-ignore -- Stripe SDK Tax namespace is runtime-provided in Deno.
          const regs = await stripeForReg.tax.registrations.list(
            { status: "active" },
            { stripeAccount: stripeAccountId },
          );
          hasActiveRegistration = Array.isArray(regs?.data) &&
            regs.data.length > 0;
        } catch (regErr) {
          // Probe failure → treat as unregistered (degrade). Non-fatal.
          console.error(
            "[ticket-checkout-create] tax registration probe failed (degrade)",
            regErr instanceof Error ? regErr.message : regErr,
          );
          hasActiveRegistration = false;
        }
      }

      if (
        !pricing.pass_tax || !pricing.venue_tax_address ||
        regionUnmappedForceFlatAbsorb
      ) {
        // Brand absorbs tax, no resolved venue, OR an unmapped pricing_region
        // (ORCH-1034 degrade-not-throw) → flat-absorb (SPEC §B.4).
        taxCalculation = {
          id: "",
          amount_total: taxAmountCents,
          tax_breakdown: [],
        };
        taxBasis = "unresolved_flat_absorb";
      } else if (!hasActiveRegistration) {
        // Unregistered brand → cannot collect tax → flat-absorb (decision #2).
        taxCalculation = {
          id: "",
          amount_total: taxAmountCents,
          tax_breakdown: [],
        };
        taxBasis = "unresolved_flat_absorb";
      } else {
        try {
          const stripeForTax = stripeTicketCheckout();
          // @ts-ignore -- Stripe SDK Tax namespace is runtime-provided in Deno.
          // SPEC §B.3 — venue address as customer_details.address (NOT buyer);
          // tax_behavior per region (NOT hardcoded); line amount = buyer subtotal.
          // Doc: https://docs.stripe.com/api/tax/calculations/create
          const fresh = await stripeForTax.tax.calculations.create(
            {
              currency,
              line_items: [
                {
                  amount: taxAmountCents,
                  reference: eventId.slice(0, 500),
                  // ORCH-0955 admissions/event tax code — retained.
                  tax_code: "txcd_50010001",
                  tax_behavior: taxBehavior,
                },
              ],
              customer_details: {
                // deno-lint-ignore no-explicit-any
                address: pricing.venue_tax_address as any,
                // SPEC §B.3 — admissions tax is sourced at the supplied (venue)
                // address regardless of source label; "billing" is retained.
                address_source: "billing" as const,
              },
              expand: ["tax_breakdown"],
            },
            { stripeAccount: stripeAccountId },
          );
          taxCalculation = {
            id: String(fresh.id),
            amount_total: Number(fresh.amount_total ?? taxAmountCents),
            tax_breakdown: Array.isArray(fresh.tax_breakdown)
              ? fresh.tax_breakdown
              : [],
          };
          taxBasis = "venue_resolved";
        } catch (taxErr) {
          // SPEC §B.4 / regression note — degrade-not-fail. A tax-calc throw
          // (unsupported country, network, etc.) must NOT block the buyer with a
          // failed session; it degrades to flat brand-absorbed (one clean
          // number). Contrast with today's session status:"failed" (DELETED).
          const failure = classifyStripeTaxCalculationFailure(taxErr);
          console.error(
            "[ticket-checkout-create] tax calculation degraded to flat-absorb",
            failure.detail,
          );
          taxCalculation = {
            id: "",
            amount_total: taxAmountCents,
            tax_breakdown: [],
          };
          taxBasis = failure.error === "tax_country_unsupported"
            ? "country_unsupported_flat_absorb"
            : "calc_failed_flat_absorb";
        }
      }
    }

    // ORCH-1006 — derive the canonical breakdown from the engine (single source
    // of truth, SPEC §C.5). For inclusive (GB), tax is the VAT portion extracted
    // from inside amount_total (NOT amount_total − base, which is the exclusive-
    // only formula and a REAL BUG for inclusive — fixed here). For flat-absorb,
    // taxCents = 0. Doc inclusive semantics:
    // https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior
    let taxCents: number;
    if (taxBasis !== "venue_resolved") {
      taxCents = 0;
    } else if (taxBehavior === "inclusive") {
      // ORCH-1034 — inclusive VAT is inside the total: extract the display VAT
      // portion using the SELLER region's divisor (GB/EU 1.20, CH 1.081), NOT a
      // hardcoded GB `/1.2`. Stripe Tax owns the authoritative amount; this is a
      // deterministic re-derivation of the inclusive split for the persisted
      // breakdown so the receipt is self-consistent. Doc (tax_behavior inclusive):
      // https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior
      const divisor = inclusiveVatDivisorForRegion(pricingRegion);
      taxCents = taxCalculation.amount_total -
        Math.round(taxCalculation.amount_total / divisor);
    } else {
      // Exclusive (future US): tax is added on top of the subtotal.
      taxCents = Math.max(0, taxCalculation.amount_total - taxAmountCents);
    }

    const pricingBreakdown: PricingBreakdown = buildPricingBreakdown({
      input: engineInput,
      amountTotalCents: taxCalculation.amount_total,
      taxCents,
      taxBasis,
      stripeTaxCalculationId: taxCalculation.id.length > 0
        ? taxCalculation.id
        : null,
    });

    await supabase
      .from("ticket_checkout_sessions")
      .update({
        tax_calculation_id: taxCalculation.id.length > 0
          ? taxCalculation.id
          : null,
        tax_amount_cents: taxCents,
        // ORCH-1006 §A.3/§C.6 — the canonical money record. finalize copies it to
        // orders.pricing_breakdown (FLAG: the live biz_ticket_checkout_finalize
        // does not yet copy this column — see the implementor report follow-up).
        pricing_breakdown: pricingBreakdown,
        updated_at: new Date().toISOString(),
      })
      .eq("id", checkoutSessionId);

    if (mode === "preview") {
      return jsonResponse({
        kind: "preview",
        checkoutSessionId,
        subtotalCents: totalCents,
        taxCents,
        totalCents: pricingBreakdown.buyer_total_cents,
        // ORCH-1034 — settlement (charge) currency, not the legacy GBP-fallback.
        currency: currency.toUpperCase(),
        taxBreakdown: taxCalculation.tax_breakdown,
        calculationId: taxCalculation.id.length > 0 ? taxCalculation.id : null,
        calculationExpiresAt: null,
        // ORCH-1006 §C.4 — the all-in breakdown feeds WYSIWYP (no buyer address).
        pricingBreakdown,
      });
    }

    let paymentIntent: {
      id: string;
      client_secret?: string | null;
    };
    let stripe: ReturnType<typeof stripeTicketCheckout> | null = null;
    try {
      stripe = stripeTicketCheckout();
      // ORCH-0843 — direct-charge shape for the native PaymentIntent path.
      // PaymentIntent is created on the connected account via the Stripe-
      // Account header (third-arg request option `stripeAccount`). The
      // platform-level "MINGLA*" prefix on the buyer's card statement is
      // handled via the connected account's account-level default in Stripe
      // Dashboard (operator config) — NOT via PI statement_descriptor_suffix
      // (which is a separate suffix mechanism). See SPEC §3.1.2.
      // ORCH-0849: payment_method_types sourced from
      // _shared/stripePaymentMethods.ts curated allowlist (Card + Link).
      // Apple Pay + Google Pay surface through the `card` type when the
      // mobile SDK initialises with merchantIdentifier / Google Pay plugin
      // — they are NOT valid payment_method_types values. Phase 2 methods
      // (Cash App Pay, Klarna/Afterpay, ACH/SEPA, regional redirects) remain
      // forbidden — each needs its own ORCH proving redirect-flow / delayed-
      // method plumbing. Invariant I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST.
      // CI gates: i-stripe-pm-method-allowlist.mjs (allowlist) +
      // orch-0837-regression-check.mjs T-C1 (still bans
      // automatic_payment_methods: enabled: true).
      const piCreateBody: Record<string, unknown> = {
        // ORCH-1006 §C.4 — the inclusive all-in buyer total from the engine
        // breakdown (NOT the raw exclusive amount_total). For GB inclusive this
        // equals the buyer subtotal; for flat-absorb it is the subtotal too.
        amount: pricingBreakdown.buyer_total_cents,
        currency,
        // ORCH-0869 [Tr3 Installment Payments]: when deposit is installment-
        // plan-root, save PM for off-session installment charges.
        ...(isInstallmentPlan
          ? { setup_future_usage: "off_session" as const }
          : {}),
        // ORCH-0925: installment plans MUST attach a Stripe Customer so the
        // saved PM binds to the Customer (cron later charges off-session via
        // {customer, payment_method}). customerId is provisioned earlier in
        // this handler (FATAL on failure for installment plans). Full-pay PIs
        // do NOT receive a customer field (preserves ORCH-0843 direct-charge
        // shape + ORCH-0844 guest-mode fallback).
        ...(isInstallmentPlan && customerId !== null
          ? { customer: customerId }
          : {}),
        payment_method_types: [...getPaymentMethodTypes()],
        metadata: {
          mingla_checkout_session_id: checkoutSessionId,
          mingla_event_id: eventId,
          mingla_buyer_email: buyerEmail,
          mingla_tax_calculation_id: taxCalculation.id,
          // ORCH-0869: deposit PI marker for finalize RPC discrimination.
          ...(isInstallmentPlan
            ? { mingla_installment_plan_root: "true" }
            : {}),
          // ORCH-1072: record the booked experience occurrence on the PaymentIntent
          // (Stripe metadata is a free-form string map — keys ≤40 chars, values
          // ≤500 chars: https://docs.stripe.com/api/metadata). Omitted when null →
          // PI metadata byte-identical for events/trips/one-off experiences.
          ...(eventDateId !== null
            ? { mingla_event_date_id: eventDateId }
            : {}),
          // issue #2160 — spread AFTER the ORCH-1072 key above, so the ANCHOR
          // wins on a multi-day cart while that frozen shape stays literally
          // intact. `mingla_event_date_count` lets a reconciliation tell a
          // two-day order from a one-day one without a join. Both omitted when
          // no day set was sent → PI metadata byte-identical for events, trips
          // and one-off experiences.
          ...(orderedEventDateIds.length > 0 && anchorEventDateId !== null
            ? {
              mingla_event_date_id: anchorEventDateId,
              ...(orderedEventDateIds.length > 1
                ? { mingla_event_date_count: String(orderedEventDateIds.length) }
                : {}),
            }
            : {}),
        },
      };
      // ORCH-0869 [Tr3] installment plans MUST be card-only because off_session
      // confirms require a saved PaymentMethod and only `card` is supported in
      // the saved-PM + auto-charge pipeline for v1 (SPEC H-2; Link off_session
      // semantics excluded). Replace the default full-allowlist after the base
      // body is constructed so the ORCH-0849 R-3 gate still sees the literal
      // `payment_method_types: [...getPaymentMethodTypes()]` pattern above on a
      // non-comment line, AND every value still flows through the SAME
      // _shared/stripePaymentMethods.ts allowlist (the installment helper is a
      // .filter(m => m === "card") of MINGLA_PM_ALLOWLIST, not a fresh literal).
      if (isInstallmentPlan) {
        piCreateBody.payment_method_types = [
          ...getInstallmentPaymentMethodTypes(),
        ];
      }
      if (applicationFeeAmountCents > 0) {
        // ORCH-0843 — Mingla's platform cut on direct charges.
        piCreateBody.application_fee_amount = applicationFeeAmountCents;
      }
      // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
      paymentIntent = nativeClaim?.outcome === "existing_ready" &&
          typeof nativeClaim.providerObjectId === "string"
        ? await stripe.paymentIntents.retrieve(nativeClaim.providerObjectId, {
          stripeAccount: stripeAccountId,
        })
        : await stripe.paymentIntents.create(
          piCreateBody,
          {
            idempotencyKey: `ticket_checkout:${checkoutSessionId}`,
            // ORCH-0843 — direct-charge: Stripe-Account header. Replaces
            // destination-charge transfer_data.destination.
            stripeAccount: stripeAccountId,
          },
        );
    } catch (err) {
      if (nativeClaim?.outcome === "fresh_claim") {
        await markTicketProviderUnknown(supabase, {
          attemptId: String(nativeClaim.attemptId),
          claimedEpoch: Number(nativeClaim.epoch),
        }).catch(() => undefined);
      }
      const failure = classifyStripePaymentIntentCreateFailure(err);
      console.error(
        "[ticket-checkout-create] payment intent create failed",
        failure.detail,
      );
      // Preserve the structured, non-secret diagnostic without converting an
      // ambiguous provider result into a final failed sale. Exact-key recovery
      // remains owned by provider_unknown reconciliation.
      await supabase
        .from("ticket_checkout_sessions")
        .update({
          failure_reason: failure.detail,
          updated_at: new Date().toISOString(),
        })
        .eq("id", checkoutSessionId)
        .is("stripe_payment_intent_id", null);
      return jsonResponse(
        { error: "payment_intent_create_failed", detail: failure.detail },
        failure.httpStatus,
      );
    }

    const clientSecret = String(paymentIntent.client_secret ?? "");
    if (nativeClaim?.outcome === "fresh_claim") {
      const nativeCommit = await commitTicketProviderAttempt(supabase, {
        attemptId: String(nativeClaim.attemptId),
        claimedEpoch: Number(nativeClaim.epoch),
        providerObjectId: paymentIntent.id,
        continuationFingerprint: await sha256Hex(clientSecret),
      }).catch(() => "revoked" as const);
      if (nativeCommit !== "ready") {
        if (stripe !== null) {
          try {
            await stripe.paymentIntents.cancel(paymentIntent.id, {}, {
              idempotencyKey: `ticket_checkout_cancel:${checkoutSessionId}`,
              stripeAccount: stripeAccountId,
            });
          } catch {
            // Durable revocation outbox owns reconciliation/retry.
          }
        }
        return jsonResponse(checkoutUnavailableResponse(), 409);
      }
    }
    const { error: persistPaymentError } = await supabase
      .from("ticket_checkout_sessions")
      .update({
        status: "processing_payment",
        stripe_payment_intent_id: paymentIntent.id,
        stripe_client_secret_last4: clientSecret.slice(-4),
        stripe_payment_intent_client_secret_hash: await sha256Hex(clientSecret),
        updated_at: new Date().toISOString(),
      })
      .eq("id", checkoutSessionId);
    if (persistPaymentError) {
      console.error(
        "[ticket-checkout-create] payment intent persist failed",
        persistPaymentError,
      );
      if (stripe !== null) {
        try {
          await cancelPaymentIntentIfClientAvailable(stripe, paymentIntent.id);
        } catch (cancelError) {
          console.error(
            "[ticket-checkout-create] payment intent cancel failed",
            cancelError,
          );
        }
      }
      return jsonResponse(
        {
          error: "payment_session_persist_failed",
          detail: persistPaymentError.message,
        },
        500,
      );
    }

    return jsonResponse({
      kind: "requires_payment",
      checkoutSessionId,
      buyerStatusToken,
      // ORCH-1006 §C.4 — buyer_total is the inclusive all-in (= PI amount).
      totalCents: pricingBreakdown.buyer_total_cents,
      subtotalCents: totalCents,
      taxCents,
      taxBreakdown: taxCalculation.tax_breakdown,
      // ORCH-1034 — settlement (charge) currency, not the legacy GBP-fallback.
      // This is the currency the buyer's card is actually charged in (PI currency).
      currency: currency.toUpperCase(),
      clientSecret,
      paymentIntentId: paymentIntent.id,
      // ORCH-1006 §C.4 — canonical breakdown for the receipt/confirmation.
      pricingBreakdown,
      // ORCH-1238 — fail-closed mode-validated resolver. Throws (→ 500 via the
      // wrapEdgeHandler onError envelope) rather than ever returning a pk whose
      // prefix mismatches MINGLA_STRIPE_MODE.
      publishableKey: resolvePublishableKey(),
      // ORCH-0844 NEW: Connect direct-charge mobile config.
      // stripeAccountId is the connected account the PI lives on (above).
      // customerId / customerEphemeralKeySecret are paired-or-absent:
      // both populated (Customer ready), or both null (guest mode).
      stripeAccountId,
      customerId,
      customerEphemeralKeySecret,
    });
  }, {
    onError: (_err, requestId) =>
      jsonResponse({ error: "internal_error", requestId }, 500),
  });

if (import.meta.main) {
  serve(createTicketCheckoutCreateHandler());
}
