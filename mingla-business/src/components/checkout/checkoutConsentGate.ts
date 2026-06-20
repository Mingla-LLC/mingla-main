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
