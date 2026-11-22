// #4514 wave 5: the brand form check at checkout (BUILD CONTRACT v2 §3.6, C1, C8, C9).
//
// Body fields (both optional; omitted by every caller that cannot show the step):
//   brandFormStep: 1                       the capability marker (C1)
//   brandForm: {formId, versionId, answers} the buyer's answers to the page's form
//
// The decision lives in SQL (brand_form_checkout_check / _stash, migration
// 20281120034514): required + marker + missing or invalid answers is refused
// before any checkout session, payment-provider object or free order exists;
// no marker completes the order as "to answer"; the off switch checks nothing.
// Door sales (C9) never reach this module: the caller skips it for door pay.

import { captureEdgeExceptionAsync } from "../_shared/sentryEdge.ts";
import {
  BRAND_FORM_CHECKOUT_STEP,
  type BrandFormAnswers,
  unstorableAnswerErrors,
} from "../_shared/brandFormsContract.ts";

export interface CheckoutBrandForm {
  capable: boolean;
  /** The answers object sent to SQL, or null when the buyer sent none. */
  form: { formId: string; versionId: string; answers: BrandFormAnswers } | null;
}

export type CheckoutBrandFormRefusal = {
  status: number;
  body: Record<string, unknown>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape check of the two body fields; a malformed field is a 400, never ignored. */
export function parseCheckoutBrandForm(
  body: Record<string, unknown>,
): CheckoutBrandForm | CheckoutBrandFormRefusal {
  const capable = body.brandFormStep === BRAND_FORM_CHECKOUT_STEP;
  if (body.brandFormStep !== undefined && !capable) {
    return {
      status: 400,
      body: { error: "invalid_request", detail: "brand_form_step_invalid" },
    };
  }
  const raw = body.brandForm;
  if (raw === undefined || raw === null) return { capable, form: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      status: 400,
      body: { error: "invalid_request", detail: "brand_form_invalid" },
    };
  }
  const r = raw as Record<string, unknown>;
  if (
    typeof r.formId !== "string" || !UUID_RE.test(r.formId) ||
    typeof r.versionId !== "string" || !UUID_RE.test(r.versionId) ||
    !r.answers || typeof r.answers !== "object" || Array.isArray(r.answers)
  ) {
    return {
      status: 400,
      body: { error: "invalid_request", detail: "brand_form_invalid" },
    };
  }
  const answers = r.answers as BrandFormAnswers;
  const unstorable = unstorableAnswerErrors(answers);
  if (unstorable.length > 0) {
    return {
      status: 422,
      body: { error: "form_answers_invalid", errors: unstorable },
    };
  }
  return {
    capable,
    form: {
      formId: r.formId.toLowerCase(),
      versionId: r.versionId.toLowerCase(),
      answers,
    },
  };
}

export function isCheckoutBrandFormRefusal(
  v: CheckoutBrandForm | CheckoutBrandFormRefusal,
): v is CheckoutBrandFormRefusal {
  return (v as CheckoutBrandFormRefusal).status !== undefined;
}

export interface RpcError {
  message?: string | null;
  details?: string | null;
  code?: string | null;
}

function detailObject(details: string | null | undefined): unknown {
  if (!details) return null;
  try {
    return JSON.parse(details);
  } catch {
    return null;
  }
}

/**
 * [TRANSITIONAL] The forms migration is not applied yet: PostgREST cannot find
 * `brand_form_checkout_check` ITSELF (PGRST202 naming that function). Nothing
 * else fails open: a missing inner function (42883), a stale cache for another
 * function or any other error stays a retryable refusal. Exit condition: remove
 * once 20281120034514 is in the production migration ledger and PostgREST is
 * reloaded.
 */
export function isCheckFunctionMissing(error: RpcError): boolean {
  return error.code === "PGRST202" &&
    /\bbrand_form_checkout_check\b/.test(error.message ?? "");
}

type WaitUntil = (promise: Promise<unknown>) => void;

function edgeWaitUntil(): WaitUntil | null {
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: WaitUntil };
  }).EdgeRuntime;
  return typeof runtime?.waitUntil === "function"
    ? runtime.waitUntil.bind(runtime)
    : null;
}

/** Wave 7 (P3-F): the alert goes out once per isolate, not once per checkout. */
let failOpenAlerted = false;

/** Tests only: forget that this isolate already alerted. */
export function __resetBrandFormFailOpenAlertForTest(): void {
  failOpenAlerted = false;
}

/**
 * [TRANSITIONAL] (same exit condition) The fail-open above is an ops alert, the
 * way edge functions raise one (Sentry through the shared edge helper; the
 * function already declares SENTRY_DSN). Sent once per isolate, through
 * `EdgeRuntime.waitUntil` when the runtime has it, so the response never waits
 * on it and the isolate is not torn down before it is delivered. Never carries
 * buyer data. Returns whether this call sent the alert.
 */
export function reportBrandFormCheckFailOpen(
  error: RpcError,
  capture: (
    error: unknown,
    context: Parameters<typeof captureEdgeExceptionAsync>[1],
  ) => Promise<void> | void = captureEdgeExceptionAsync,
  waitUntil: WaitUntil | null = edgeWaitUntil(),
): boolean {
  console.error(
    "[ticket-checkout-create] brand form check unavailable (function missing): failing open",
  );
  if (failOpenAlerted) return false;
  failOpenAlerted = true;
  const sent = Promise.resolve(
    capture(new Error("brand_form_checkout_check_missing"), {
      fn: "ticket-checkout-create",
      tags: { issue: "4514", alert: "brand_form_check_fail_open" },
      extra: { code: error.code ?? null },
    }),
  ).catch(() => undefined);
  if (waitUntil !== null) waitUntil(sent);
  else void sent;
  return true;
}

/**
 * Wave 7 (P1-A / P3-E): the pre-session check said `stash` (the buyer saw the
 * form and sent valid answers) but the stash for the session did not keep them
 * (a grant or private link that ended in between). Never a silent pass: the
 * caller answers 409 `brand_form_stash_failed` and payment never starts. A
 * replay of a session that already has its order (`finalized`) is not a loss.
 */
export function stashLostAnswers(
  checkOutcome: unknown,
  stashOutcome: unknown,
): boolean {
  return checkOutcome === "stash" && stashOutcome !== "stash" &&
    stashOutcome !== "finalized";
}

/** The outcome field of a check or stash reply, or null. */
export function outcomeOf(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const o = (data as Record<string, unknown>).outcome;
  return typeof o === "string" ? o : null;
}

/**
 * The refusal for a check/stash error the buyer can act on, or null for any
 * other failure (the caller decides: the check fails open only when the
 * function is missing; the stash answers 409 and payment never starts).
 */
export function brandFormRefusal(
  error: RpcError,
): CheckoutBrandFormRefusal | null {
  const first = (error.message ?? "").trim().split(/[\s:]/)[0] ?? "";
  const detail = detailObject(error.details);
  const d = detail && typeof detail === "object" && !Array.isArray(detail)
    ? detail as Record<string, unknown>
    : {};
  if (first === "form_answers_required") {
    return {
      status: 422,
      body: {
        error: "form_answers_required",
        formId: d.formId ?? null,
        versionId: d.versionId ?? null,
      },
    };
  }
  if (first === "form_answers_invalid") {
    return {
      status: 422,
      body: {
        error: "form_answers_invalid",
        errors: Array.isArray(detail)
          ? detail
          : [{ questionId: null, code: "type" }],
      },
    };
  }
  if (first === "form_changed") {
    return {
      status: 409,
      body: {
        error: "form_changed",
        formId: d.formId ?? null,
        versionId: d.versionId ?? null,
      },
    };
  }
  return null;
}

/** The SQL payload for brand_form_checkout_check / _stash. */
export function checkoutFormPayload(
  parsed: CheckoutBrandForm,
): Record<string, unknown> | null {
  return parsed.form === null ? null : { ...parsed.form };
}

// deno-lint-ignore no-explicit-any
type CheckoutClient = any;

/**
 * Fail an unpaid checkout session so its held stock is released (the session
 * holds are counted from status and expires_at; private ticket-link units are
 * counted the same way). Used for an infinity hold that never joined the queue
 * (#2947) and, #4541 R1.13, for every stash refusal below. Never touches a
 * session that already has its order or any payment reference.
 */
export async function releaseUnpaidSession(
  client: CheckoutClient,
  checkoutSessionId: string,
  reason: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await client
    .from("ticket_checkout_sessions")
    .update({
      status: "failed",
      failure_reason: reason,
      expires_at: now,
      updated_at: now,
    })
    .eq("id", checkoutSessionId)
    .is("order_id", null)
    // #4541 review fix 3: a session that already has a payment reference (a
    // card payment intent or a Paystack reference, both kept in
    // stripe_payment_intent_id; a hosted checkout session; or a claimed
    // provider attempt) may still be paid. It is never released: the caller
    // returns its refusal and the payment's own outcome settles the session.
    .is("stripe_payment_intent_id", null)
    .is("stripe_checkout_session_id", null)
    .is("provider_attempt_id", null) ?? { error: null };
  if (error) {
    console.error("[ticket-checkout-create] session release failed", {
      reason,
    });
  }
}

/**
 * #4514 wave 5 / #4541 R1.13: stash the buyer's answers against this session
 * BEFORE any quote bind, free finalization or provider I/O (the trigger
 * brand_form_finalize_checkout_answers makes them the order's response in the
 * same transaction that gives the session its order). Every refusal releases
 * the session first, so a failed stash never keeps the tickets held until the
 * checkout expires. Returns null to continue, or the response to return; the
 * response bodies are unchanged.
 */
export async function stashBrandFormOrRelease(
  client: CheckoutClient,
  args: {
    checkoutSessionId: string;
    eventId: string;
    parsed: CheckoutBrandForm;
    buyerUserId: string | null;
    ticketLinkHash: string | null;
    checkOutcome: string | null;
  },
  respond: (body: Record<string, unknown>, status: number) => Promise<Response>,
): Promise<Response | null> {
  const stashed = await client.rpc("brand_form_checkout_stash", {
    p_checkout_session_id: args.checkoutSessionId,
    p_event_id: args.eventId,
    p_capable: args.parsed.capable,
    p_form: checkoutFormPayload(args.parsed),
    p_buyer_user_id: args.buyerUserId,
    p_ticket_link_hash: args.ticketLinkHash,
  });
  if (stashed.error) {
    const refusal = brandFormRefusal(stashed.error);
    if (refusal !== null) {
      await releaseUnpaidSession(
        client,
        args.checkoutSessionId,
        String(refusal.body.error ?? "brand_form_stash_failed"),
      );
      return await respond(refusal.body, refusal.status);
    }
    console.error("[ticket-checkout-create] brand form stash failed", {
      error: stashed.error.message,
    });
    await releaseUnpaidSession(
      client,
      args.checkoutSessionId,
      "brand_form_stash_failed",
    );
    return await respond({ error: "brand_form_stash_failed" }, 409);
  }
  // Wave 7 (P1-A / P3-E): the check kept answers the stash then could not
  // (a grant or link that ended in between): 409, never a silent pass.
  if (stashLostAnswers(args.checkOutcome, outcomeOf(stashed.data))) {
    console.error("[ticket-checkout-create] brand form stash lost the form", {
      outcome: outcomeOf(stashed.data),
    });
    await releaseUnpaidSession(
      client,
      args.checkoutSessionId,
      "brand_form_stash_failed",
    );
    return await respond({ error: "brand_form_stash_failed" }, 409);
  }
  return null;
}
