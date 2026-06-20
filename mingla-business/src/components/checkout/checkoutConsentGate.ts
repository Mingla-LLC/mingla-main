/**
 * META-ORCH-1161 Sub-A.2 (DEC-186) — the buyer-checkout Pay/Continue gate.
 *
 * The Pay/Continue button is GREYED OUT until all required fields are valid AND
 * the single bundled-mandatory consent box is checked (DESIGN §S3.4 — a buyer
 * cannot proceed to payment unconsented). Extracted as a pure predicate so the
 * regression test proves "disabled until checked" directly, in isolation from
 * the route file's heavy import graph (fails-on-revert if the `!termsAccepted`
 * term is removed).
 */

export interface ContinueGateParams {
  fieldsValid: boolean;
  termsAccepted: boolean;
  submitting: boolean;
}

export const isContinueDisabled = (params: ContinueGateParams): boolean =>
  !params.fieldsValid || !params.termsAccepted || params.submitting;

/**
 * META-ORCH-1161 Sub-A.2 (P1-1 rework) — when the buyer taps the VISUALLY
 * disabled Pay button, the tap is captured (never a silent dead tap,
 * Constitution Rule 1) and we must decide whether to surface the
 * "Please agree to continue." consent helper + checkbox flash (DESIGN §S3.4).
 *
 * The helper is shown ONLY when the single blocker is the unchecked consent box
 * — i.e. all required fields are valid but `termsAccepted` is false. When fields
 * are still invalid, the field-level errors carry the message instead (marking
 * the fields touched is the caller's job), so the consent helper stays hidden to
 * avoid double-messaging.
 *
 * Returns true ⇔ show the consent helper for this captured disabled-Pay tap.
 */
export const shouldShowConsentHintOnDisabledTap = (
  params: Pick<ContinueGateParams, "fieldsValid" | "termsAccepted">,
): boolean => params.fieldsValid && !params.termsAccepted;
