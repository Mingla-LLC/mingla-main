/**
 * partnerBrandLinksService — ORCH-1081 frontend reader for partner_brand_links.
 *
 * RLS allows partner self-read (partner_account_id = auth.uid()). No writes
 * exposed; the link is INSERTed by the invite-brand-member edge fn and
 * status columns are stamped by DB triggers + the accept RPC.
 *
 * Derived status is computed client-side from the raw timestamp columns
 * (mirrors public.partner_brand_link_status). We don't rely on the
 * column-function form here because Supabase JS doesn't surface derived
 * column-funcs without a view; computing locally keeps the read path
 * simple and lossless.
 */

import { supabase } from "./supabase";

export type PartnerBrandLinkStatus =
  | "awaiting_owner"
  | "awaiting_stripe"
  | "active"
  | "cancelled";

export interface PartnerBrandLinkRow {
  id: string;
  partner_account_id: string;
  brand_id: string;
  invited_owner_email: string;
  personal_note: string | null;
  invited_at: string;
  accepted_at: string | null;
  owner_stripe_connected_at: string | null;
  first_split_at: string | null;
  cancelled_at: string | null;
  // Joined brand metadata (PostgREST embedded select). Optional so the type
  // is reusable without the join.
  brand?: {
    id: string;
    name: string;
    slug: string;
    cover_media_url: string | null;
    cover_media_type: string | null;
    default_currency: string | null;
  } | null;
}

export interface PartnerBrandLinkWithStatus extends PartnerBrandLinkRow {
  status: PartnerBrandLinkStatus;
}

export const partnerBrandLinksKeys = {
  all: ["partnerBrandLinks"] as const,
  list: () => [...partnerBrandLinksKeys.all, "list"] as const,
};

export function deriveLinkStatus(
  row: PartnerBrandLinkRow,
): PartnerBrandLinkStatus {
  if (row.cancelled_at !== null) return "cancelled";
  if (row.first_split_at !== null) return "active";
  if (row.owner_stripe_connected_at !== null) return "active";
  if (row.accepted_at !== null) return "awaiting_stripe";
  return "awaiting_owner";
}

/**
 * Read the caller's partner_brand_links rows. Excludes cancelled rows by
 * default. Embeds the brand row for the list UI (name / cover / currency).
 */
export async function listPartnerBrandLinks(): Promise<
  PartnerBrandLinkWithStatus[]
> {
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    throw new Error("not_authenticated");
  }
  const userId = userResult.user.id;

  const { data, error } = await supabase
    .from("partner_brand_links")
    .select(
      "id, partner_account_id, brand_id, invited_owner_email, personal_note, invited_at, accepted_at, owner_stripe_connected_at, first_split_at, cancelled_at, brand:brands(id, name, slug, cover_media_url, cover_media_type, default_currency)",
    )
    .eq("partner_account_id", userId)
    .is("cancelled_at", null)
    .order("invited_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as PartnerBrandLinkRow[];
  return rows.map((row) => ({ ...row, status: deriveLinkStatus(row) }));
}
