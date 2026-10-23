import { captureDiscountEvent } from "../analytics/discountAnalytics";
import { majorFromMinor } from "../utils/currency";
import { fetchBrandDiscountById, type BrandDiscount } from "./discountService";
import {
  createDraft,
  ensureBrandBuyersAudience,
} from "./marketing/marketingCampaignService";
import { supabase } from "./supabase";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function discountBlastCopy(
  discount: Pick<
    BrandDiscount,
    | "code"
    | "currency"
    | "kind"
    | "name"
    | "valueBps"
    | "valueMinor"
    | "valueType"
  >,
  publicBrandUrl: string,
): string {
  const currency = discount.currency ?? "GBP";
  const value =
    discount.valueType === "percent"
      ? `${(discount.valueBps ?? 0) / 100}% off`
      : `${new Intl.NumberFormat("en", { style: "currency", currency }).format(
          majorFromMinor(discount.valueMinor ?? 0, currency),
        )}${discount.valueType === "set_price" ? " sale price" : " off"}`;
  return discount.kind === "code" && discount.code !== null
    ? `Use code ${discount.code} for ${value} — ${publicBrandUrl}`
    : `${discount.name}: ${value} — ${publicBrandUrl}`;
}

/**
 * #3872 — turn a Host-selected discount into an ordinary editable Blast draft.
 * The established composer remains the sole editor and send authority; this
 * hand-off only seeds a draft after the Host explicitly taps “Share in Blast”.
 */
export async function createDiscountBlastDraft(input: {
  accountId: string;
  brandId: string;
  discountId: string;
}): Promise<string> {
  const [discount, brandResult] = await Promise.all([
    fetchBrandDiscountById(input.brandId, input.discountId),
    supabase
      .from("brands")
      .select("slug")
      .eq("id", input.brandId)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  if (discount === null)
    throw new Error("That discount is no longer available.");
  if (brandResult.error) throw brandResult.error;
  const slug =
    typeof brandResult.data?.slug === "string" ? brandResult.data.slug : null;
  if (slug === null || slug.length === 0) {
    throw new Error(
      "This brand needs a public link before you can share its discount.",
    );
  }

  const audienceId = await ensureBrandBuyersAudience({
    account_id: input.accountId,
    brand_id: input.brandId,
  });
  const copy = discountBlastCopy(
    discount,
    `https://usemingla.com/b/${encodeURIComponent(slug)}`,
  );
  const draft = await createDraft({
    account_id: input.accountId,
    brand_id: input.brandId,
    audience_id: audienceId,
    name: discount.name,
    channel_payload: {
      kind: "email",
      subject: discount.name,
      body_html: `<p>${escapeHtml(copy)}</p>`,
      body_text: copy,
    },
  });
  captureDiscountEvent("discount_blast_started", { kind: discount.kind });
  return draft.id;
}
