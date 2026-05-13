/**
 * marketingTemplateService — read-only template lookups for the composer.
 *
 * Phase B reads templates (5 starter-pack rows seeded in Phase A + any
 * user-authored brand templates). Template authoring UI ships in
 * Sub-ORCH-0815-C.
 */

import { supabase } from "../supabase";
import type { MarketingTemplateRow } from "../../types/marketing";

export async function listStarterTemplates(): Promise<MarketingTemplateRow[]> {
  const { data, error } = await supabase
    .from("marketing_templates")
    .select(
      "id, account_id, brand_id, name, channel, subject_template, body_template, is_starter_pack, created_at, updated_at",
    )
    .eq("is_starter_pack", true)
    .eq("channel", "email")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as MarketingTemplateRow[]);
}

export async function getTemplate(
  templateId: string,
): Promise<MarketingTemplateRow | null> {
  const { data, error } = await supabase
    .from("marketing_templates")
    .select(
      "id, account_id, brand_id, name, channel, subject_template, body_template, is_starter_pack, created_at, updated_at",
    )
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as MarketingTemplateRow | null;
}
