/**
 * experiencesService — list live venue experiences (event_type='experience'). ORCH-0881 Ve5.
 */

import { supabase } from "./supabase";

export interface VenueExperience {
  id: string;
  brandId: string;
  title: string;
  description: string | null;
  slug: string;
  status: string;
  visibility: string;
  createdAt: string;
  intentTags: string[];
  priceMinCents: number | null;
  priceMaxCents: number | null;
  currency: string | null;
  capacityMin: number | null;
  capacityMax: number | null;
  suggestedTimeOfDay: string | null;
}

interface EventRow {
  id: string;
  brand_id: string;
  title: string;
  description: string | null;
  slug: string;
  status: string;
  visibility: string;
  created_at: string;
  theme: Record<string, unknown> | null;
}

function mapExperience(row: EventRow): VenueExperience {
  const theme = row.theme ?? {};
  const meta = (theme.experience_meta as Record<string, unknown> | undefined) ?? {};
  const intentRaw = meta.intent_tags;
  const intentTags = Array.isArray(intentRaw)
    ? intentRaw.filter((t): t is string => typeof t === "string")
    : [];

  return {
    id: row.id,
    brandId: row.brand_id,
    title: row.title,
    description: row.description,
    slug: row.slug,
    status: row.status,
    visibility: row.visibility,
    createdAt: row.created_at,
    intentTags,
    priceMinCents: typeof meta.suggested_price_min_cents === "number"
      ? meta.suggested_price_min_cents
      : null,
    priceMaxCents: typeof meta.suggested_price_max_cents === "number"
      ? meta.suggested_price_max_cents
      : null,
    currency: typeof meta.currency === "string" ? meta.currency : null,
    capacityMin: typeof meta.capacity_min === "number" ? meta.capacity_min : null,
    capacityMax: typeof meta.capacity_max === "number" ? meta.capacity_max : null,
    suggestedTimeOfDay: typeof meta.suggested_time_of_day === "string"
      ? meta.suggested_time_of_day
      : null,
  };
}

export async function getExperiencesByBrand(brandId: string): Promise<VenueExperience[]> {
  const { data, error } = await supabase
    .from("events")
    .select("id, brand_id, title, description, slug, status, visibility, created_at, theme")
    .eq("brand_id", brandId)
    .eq("event_type", "experience")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as EventRow[]).map(mapExperience);
}
