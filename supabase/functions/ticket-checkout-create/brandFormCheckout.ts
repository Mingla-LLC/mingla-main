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

/** The migration is not applied yet (PostgREST cannot find the function). */
export function isMissingFunction(error: RpcError): boolean {
  return error.code === "PGRST202" || error.code === "42883";
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
