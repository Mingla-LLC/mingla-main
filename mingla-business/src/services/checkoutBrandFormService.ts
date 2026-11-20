/**
 * #4514 wave 5 — the buyer checkout's two brand form reads (anonymous-tolerant:
 * never useAuth). Loaded only through the forms lazy owner
 * (`components/checkout/intake/formRenderingPrimitives`), so nothing here is in
 * the eager bundle.
 *
 * - The page's form, read through brand-form-submit `{op:"checkout_form"}` with
 *   the SAME credential the buyer presents to checkout: the session bearer
 *   (attached by the client) and the private ticket link. The server applies the
 *   one visibility rule its required-answers check uses (review fix 1), and a
 *   signed-in buyer who already answered gets the step PREFILLED with their own
 *   answers (OP-5); Continue then updates their one response.
 * - "After they purchase" (§5.5): a personal link for the buyer's own order,
 *   from brand-form-submit `{op:"purchase_link"}`; possession is the checkout
 *   session's buyer status token. Never an invite (decision 17).
 */
import {
  brandHeaderFromServer,
  type BrandFormDefinitionShape,
  type BrandHeaderData,
} from "@mingla/form-rendering";

import { supabase } from "./supabase";

export type CheckoutFormMode = "required_step" | "optional_on_page" | "after_purchase";

/** OP-5: the signed-in buyer's own earlier answers, to open the step filled in. */
export interface CheckoutFormPrefill {
  answers: Record<string, string | number | string[] | null>;
  versionId: string | null;
}

export interface CheckoutForm {
  mode: CheckoutFormMode;
  formId: string;
  versionId: string | null;
  name: string;
  definition: BrandFormDefinitionShape | null;
  doorFullAnswers: boolean;
  brand: BrandHeaderData;
  /** OP-5: set when this signed-in buyer already answered (the step opens prefilled). */
  prefill: CheckoutFormPrefill | null;
}

/** The server's prefill, keeping only answer shapes a question can hold. Pure; exported for tests. */
export function parsePrefill(raw: unknown): CheckoutFormPrefill | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const a = r.answers;
  if (!a || typeof a !== "object" || Array.isArray(a)) return null;
  const answers: CheckoutFormPrefill["answers"] = {};
  for (const [id, value] of Object.entries(a as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number") answers[id] = value;
    else if (Array.isArray(value) && value.every((v) => typeof v === "string")) answers[id] = value as string[];
  }
  return { answers, versionId: typeof r.versionId === "string" ? r.versionId : null };
}

const MODES: readonly CheckoutFormMode[] = ["required_step", "optional_on_page", "after_purchase"];

/** The server payload, or null when the page has no live form. Pure; exported for tests. */
export function parseCheckoutForm(data: unknown): CheckoutForm | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.active !== true || typeof d.formId !== "string") return null;
  const mode = MODES.find((m) => m === d.mode);
  if (mode === undefined) return null;
  const def = d.definition;
  const definition =
    def && typeof def === "object" && Array.isArray((def as { questions?: unknown }).questions)
      ? (def as BrandFormDefinitionShape)
      : null;
  if (mode !== "after_purchase" && (definition === null || typeof d.versionId !== "string")) return null;
  return {
    mode,
    formId: d.formId,
    versionId: typeof d.versionId === "string" ? d.versionId : null,
    name: typeof d.name === "string" ? d.name : "",
    definition,
    doorFullAnswers: d.doorFullAnswers === true,
    // OP-5 (contract): a returning buyer's step opens prefilled, never skipped.
    prefill: d.answered === true ? parsePrefill(d.prefill) : null,
    brand: brandHeaderFromServer(
      d.brand && typeof d.brand === "object" ? (d.brand as Record<string, unknown>) : null,
    ),
  };
}

/** The error behind a failed form read: the `cause` the read keeps, else the error itself. */
export function checkoutFormReadFailure(error: unknown): unknown {
  return error instanceof Error && error.cause !== undefined ? error.cause : error;
}

/** Throws on a transport or database error, so the step can say so and retry. */
export async function fetchCheckoutForm(
  eventId: string,
  ticketLinkToken: string | null = null,
): Promise<CheckoutForm | null> {
  const { data, error } = await supabase.functions.invoke("brand-form-submit", {
    body: {
      op: "checkout_form",
      eventId,
      ...(ticketLinkToken !== null ? { ticketLinkToken } : {}),
    },
  });
  // #4518: the original error rides along as `cause` so the step can tell a
  // connection failure from a server error (`checkoutFormReadFailure`).
  if (error) throw new Error("checkout_form_read_failed", { cause: error });
  const d = (data ?? {}) as Record<string, unknown>;
  return parseCheckoutForm(d.form);
}

export type PurchaseLinkResult =
  | { outcome: "link"; formId: string; token: string }
  | { outcome: "none" | "answered" };

export async function requestPurchaseFormLink(input: {
  checkoutSessionId: string;
  buyerStatusToken: string;
}): Promise<PurchaseLinkResult> {
  const { data, error } = await supabase.functions.invoke("brand-form-submit", {
    body: {
      op: "purchase_link",
      checkoutSessionId: input.checkoutSessionId,
      buyerStatusToken: input.buyerStatusToken,
    },
  });
  if (error) throw new Error("purchase_link_failed");
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.outcome === "link" && typeof d.formId === "string" && typeof d.token === "string") {
    return { outcome: "link", formId: d.formId, token: d.token };
  }
  return { outcome: d.outcome === "answered" ? "answered" : "none" };
}

/**
 * Review fix 4: the after-purchase hand-off happens once per checkout session.
 * Set before the redirect, so a fresh load of the confirm page ("Later") stays.
 */
export const purchaseHandedOffStorageKey = (checkoutSessionId: string): string =>
  `mingla.formPurchaseHandedOff.${checkoutSessionId}`;

/** Where the link page picks the after-purchase token up (web, one read, then removed). */
export const purchaseTokenStorageKey = (formId: string): string => `mingla.formPurchaseToken.${formId}`;
