/**
 * #4514 wave 5 — the buyer checkout's two brand form reads (anonymous-tolerant:
 * never useAuth). Loaded only through the forms lazy owner
 * (`components/checkout/intake/formRenderingPrimitives`), so nothing here is in
 * the eager bundle.
 *
 * - The page's form, as `public_brand_form_for_event` returns it (§3.4, C7).
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

export interface CheckoutForm {
  mode: CheckoutFormMode;
  formId: string;
  versionId: string | null;
  name: string;
  definition: BrandFormDefinitionShape | null;
  doorFullAnswers: boolean;
  brand: BrandHeaderData;
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
    brand: brandHeaderFromServer(
      d.brand && typeof d.brand === "object" ? (d.brand as Record<string, unknown>) : null,
    ),
  };
}

/** Throws on a transport or database error, so the step can say so and retry. */
export async function fetchCheckoutForm(eventId: string): Promise<CheckoutForm | null> {
  const { data, error } = await supabase.rpc("public_brand_form_for_event", { p_event_id: eventId });
  if (error) throw new Error(`checkout_form_read_failed:${error.message}`);
  return parseCheckoutForm(data);
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

/** Where the link page picks the after-purchase token up (web, one read, then removed). */
export const purchaseTokenStorageKey = (formId: string): string => `mingla.formPurchaseToken.${formId}`;
