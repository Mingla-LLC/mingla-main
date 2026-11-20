/**
 * #4514 wave 5 — the few brand form pieces the EAGER checkout code needs, and
 * nothing else (no imports): the capability marker and body helpers, and which
 * refusal codes reopen the Questions step. Every other string and helper of the
 * step lives in the one lazy forms owner (components/checkout/intake).
 */

/**
 * C1: this client shows the Questions step, so a required form's answers are
 * checked before payment. Mirrors `BRAND_FORM_CHECKOUT_STEP` in
 * supabase/functions/_shared/brandFormsContract.ts.
 */
export const BRAND_FORM_CHECKOUT_STEP = 1;

interface WithBrandForm {
  brandForm?: { formId: string; versionId: string; answers: Record<string, unknown> } | null;
}

/** The marker, plus the buyer's answers when the Questions step collected them. */
export const checkoutBrandFormFields = <B extends WithBrandForm>(
  buyer: B,
): { brandFormStep: number; brandForm?: NonNullable<B["brandForm"]> } =>
  buyer.brandForm
    ? { brandFormStep: BRAND_FORM_CHECKOUT_STEP, brandForm: buyer.brandForm as NonNullable<B["brandForm"]> }
    : { brandFormStep: BRAND_FORM_CHECKOUT_STEP };

/** `buyer` as the server reads it: the answers never ride inside it. */
export const buyerWithoutBrandForm = <B extends WithBrandForm>(buyer: B): Omit<B, "brandForm"> => {
  const { brandForm: _answers, ...rest } = buyer;
  return rest;
};

/**
 * The refusal codes that reopen the Questions step. Only these: a server error
 * (`brand_form_check_failed`, `brand_form_stash_failed`) is the normal,
 * retryable checkout error and never opens a step the buyer cannot finish.
 */
export const formRefusalOf = (code: unknown): string | null =>
  code === "form_answers_required" || code === "form_answers_invalid" || code === "form_changed"
    ? code
    : null;

/** The `questions` route param payment sets: the real refusal code ("1" from an older link). */
export const questionsParamRefusal = (param: unknown): string | null =>
  param === "1" ? "form_answers_required" : formRefusalOf(param);
