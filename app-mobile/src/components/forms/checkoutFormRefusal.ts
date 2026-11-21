/**
 * #4541 R2.10 — the last brand form refusal `ticket-checkout-create` gave the
 * cart, so the questions block can explain it next to the answers (which stay
 * on screen). Client UI state only: a tiny in-memory store keyed by event,
 * written by nativeCheckoutFlow on a refusal and read by the block. Pure (no
 * React, no native modules), so the flow and its tests load it freely.
 */

export type CheckoutFormRefusalCode =
  | "form_answers_required"
  | "form_answers_invalid"
  | "form_changed"
  | "brand_form_check_failed"
  | "brand_form_stash_failed"
  | "brand_form_step_invalid";

export const CHECKOUT_FORM_REFUSAL_CODES: readonly CheckoutFormRefusalCode[] = [
  "form_answers_required",
  "form_answers_invalid",
  "form_changed",
  "brand_form_check_failed",
  "brand_form_stash_failed",
  "brand_form_step_invalid",
];

export interface CheckoutFormRefusal {
  eventId: string;
  code: CheckoutFormRefusalCode;
  /** form_answers_invalid: question id → the server's reason code. */
  errors: Record<string, string>;
  /** Grows with every refusal, so the same code twice is still news. */
  seq: number;
}

let current: CheckoutFormRefusal | null = null;
let seq = 0;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

/**
 * The form refusal in a create answer, or null. `brand_form_step_invalid`
 * arrives as `{error:"invalid_request", detail:"brand_form_step_invalid"}`.
 * Pure; exported for tests.
 */
export function checkoutFormRefusalCode(
  token: string | null,
  detail: string | null,
): CheckoutFormRefusalCode | null {
  if (detail === "brand_form_step_invalid") return "brand_form_step_invalid";
  return CHECKOUT_FORM_REFUSAL_CODES.find((code) => code === token) ?? null;
}

/** Record a refusal (no-op for any other answer). Returns whether it was one. */
export function reportCheckoutFormRefusal(
  eventId: string,
  token: string | null,
  detail: string | null,
  body: Record<string, unknown> | null,
): boolean {
  const code = checkoutFormRefusalCode(token, detail);
  if (code === null) return false;
  const errors: Record<string, string> = {};
  if (code === "form_answers_invalid" && Array.isArray(body?.errors)) {
    for (const row of body.errors as { questionId?: unknown; code?: unknown }[]) {
      if (typeof row?.questionId === "string" && typeof row.code === "string") errors[row.questionId] = row.code;
    }
  }
  seq += 1;
  current = { eventId, code, errors, seq };
  emit();
  return true;
}

export function clearCheckoutFormRefusal(eventId: string): void {
  if (current?.eventId !== eventId) return;
  current = null;
  emit();
}

export function readCheckoutFormRefusal(eventId: string): CheckoutFormRefusal | null {
  return current?.eventId === eventId ? current : null;
}

export function subscribeCheckoutFormRefusal(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
