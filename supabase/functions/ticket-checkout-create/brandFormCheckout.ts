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
