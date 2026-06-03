/**
 * experiencesService — list venue experiences (event_type='experience'). ORCH-0881 Ve5.
 *
 * META-ORCH-1059 (Hub list polish): the row mapper now also resolves the fields a
 * proper offering-card needs — cover media, a one-line date subline (computed from
 * the persisted `theme.experience_meta.when_draft`, exactly like the dashboard /
 * preview), and a price label — so `/hub/experiences` can render rows that match
 * the events + trips list cards instead of a bare title/description block.
 */

import { supabase } from "./supabase";
import { formatCurrency } from "../utils/currency";
import {
  experienceListSubline,
  type ExperienceListWhenDraft,
} from "../utils/experienceListSubline";

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
  /** META-ORCH-1059 — cover media for the list-card thumbnail (falls back to hue). */
  coverMediaUrl: string | null;
  coverMediaType: "image" | "video" | "gif" | null;
  /**
   * META-ORCH-1059 — one-line date/venue subline for the list card, computed from
   * the persisted When draft (single / recurring / multi-date). "Draft" when no
   * When has been set yet; "{venue} · Ended" when every date is in the past.
   */
  dateSubline: string;
  /**
   * META-ORCH-1059 — glanceable price label for the list card. Null when the
   * experience has no resolved whole price yet (e.g. per-stop pricing or unset).
   */
  priceLabel: string | null;
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
  currency: string | null;
  cover_media_url: string | null;
  cover_media_type: string | null;
  whole_price_cents: number | null;
  is_recurring: boolean | null;
  is_multi_date: boolean | null;
  theme: Record<string, unknown> | null;
}

function normalizeCoverType(
  value: string | null,
): "image" | "video" | "gif" | null {
  return value === "image" || value === "video" || value === "gif" ? value : null;
}

function deriveWhenMode(
  isRecurring: boolean,
  isMultiDate: boolean,
): ExperienceListWhenDraft["whenMode"] {
  if (isRecurring) return "recurring";
  if (isMultiDate) return "multi_date";
  return "single";
}

function mapExperience(row: EventRow): VenueExperience {
  const theme = row.theme ?? {};
  const meta = (theme.experience_meta as Record<string, unknown> | undefined) ?? {};
  const intentRaw = meta.intent_tags;
  const intentTags = Array.isArray(intentRaw)
    ? intentRaw.filter((t): t is string => typeof t === "string")
    : [];

  const venueText =
    typeof meta.venue_text === "string" && meta.venue_text.length > 0
      ? meta.venue_text
      : null;
  const whenDraftRaw =
    meta.when_draft !== null && typeof meta.when_draft === "object"
      ? (meta.when_draft as Record<string, unknown>)
      : null;

  const dateSubline = experienceListSubline({
    venueText,
    whenMode: deriveWhenMode(row.is_recurring === true, row.is_multi_date === true),
    whenDraft: whenDraftRaw,
  });

  const currency = typeof row.currency === "string" ? row.currency : null;
  const priceLabel =
    typeof row.whole_price_cents === "number" && row.whole_price_cents > 0
      ? formatCurrency(row.whole_price_cents, currency ?? "USD", true)
      : null;

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
    currency,
    capacityMin: typeof meta.capacity_min === "number" ? meta.capacity_min : null,
    capacityMax: typeof meta.capacity_max === "number" ? meta.capacity_max : null,
    suggestedTimeOfDay: typeof meta.suggested_time_of_day === "string"
      ? meta.suggested_time_of_day
      : null,
    coverMediaUrl: row.cover_media_url,
    coverMediaType: normalizeCoverType(row.cover_media_type),
    dateSubline,
    priceLabel,
  };
}

export async function getExperiencesByBrand(brandId: string): Promise<VenueExperience[]> {
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, brand_id, title, description, slug, status, visibility, created_at, currency, cover_media_url, cover_media_type, whole_price_cents, is_recurring, is_multi_date, theme",
    )
    .eq("brand_id", brandId)
    .eq("event_type", "experience")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as EventRow[]).map(mapExperience);
}
