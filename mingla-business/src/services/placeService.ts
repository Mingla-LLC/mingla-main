import { supabase } from "./supabase";
import { extractFunctionError } from "../utils/extractFunctionError";

export interface PlacePoolItem {
  id: string;
  name: string;
  address: string;
  city: string;
  category: string;
  rating: number | null;
  review_count: number | null;
  price_level: number | null;
  photos: string[];
  opening_hours: Record<string, unknown> | null;
  is_claimed: boolean;
}

export interface BusinessProfile {
  id: string;
  creator_account_id: string;
  place_pool_id: string | null;
  status: string;
  description: string | null;
  hours_override: Record<string, unknown> | null;
  contact_email: string | null;
  contact_phone: string | null;
}

/**
 * Search places by name (for the claim flow).
 */
export async function searchPlaces(query: string): Promise<PlacePoolItem[]> {
  if (query.trim().length < 2) return [];

  const { data, error } = await supabase
    .from("place_pool")
    .select(
      "id, name, address, city, category, rating, review_count, price_level, photos, opening_hours, is_claimed"
    )
    .ilike("name", `%${query.trim()}%`)
    .limit(10);

  if (error) throw new Error(`Search failed: ${error.message}`);
  return (data ?? []) as PlacePoolItem[];
}

/**
 * Get a single place by ID (for the preview screen).
 */
export async function getPlace(placeId: string): Promise<PlacePoolItem | null> {
  const { data, error } = await supabase
    .from("place_pool")
    .select(
      "id, name, address, city, category, rating, review_count, price_level, photos, opening_hours, is_claimed"
    )
    .eq("id", placeId)
    .single();

  if (error) return null;
  return data as PlacePoolItem;
}

/**
 * Claim a place via the claim-place edge function.
 */
export async function claimPlace(
  placePoolId: string
): Promise<{ business_profile_id: string }> {
  const { data, error } = await supabase.functions.invoke("claim-place", {
    body: { place_pool_id: placePoolId },
  });

  if (error) {
    const msg = await extractFunctionError(error, "Couldn't claim this place");
    throw new Error(msg);
  }

  return data as { business_profile_id: string };
}

/**
 * Update the business profile (enrich step).
 */
export async function updateBusinessProfile(
  profileId: string,
  fields: Partial<{
    description: string;
    hours_override: Record<string, unknown>;
    contact_email: string;
    contact_phone: string;
  }>
): Promise<void> {
  const { error } = await supabase
    .from("business_profiles")
    .update(fields)
    .eq("id", profileId);

  if (error) throw new Error(`Update failed: ${error.message}`);
}

/**
 * Get the current user's business profiles.
 */
export async function getMyBusinessProfiles(): Promise<BusinessProfile[]> {
  const { data, error } = await supabase
    .from("business_profiles")
    .select("*")
    .order("claimed_at", { ascending: false });

  if (error) throw new Error(`Fetch failed: ${error.message}`);
  return (data ?? []) as BusinessProfile[];
}

/**
 * Upload a business photo to storage.
 */
export async function uploadBusinessPhoto(
  businessProfileId: string,
  uri: string
): Promise<string> {
  const fileName = `cover_${Date.now()}.jpg`;
  const path = `${businessProfileId}/${fileName}`;

  const response = await fetch(uri);
  const blob = await response.blob();

  const { error } = await supabase.storage
    .from("business-photos")
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage
    .from("business-photos")
    .getPublicUrl(path);

  return urlData.publicUrl;
}

/**
 * Generate AI description options for a business.
 */
export async function generateDescription(
  businessName: string,
  category: string,
  city: string
): Promise<string[]> {
  const { data, error } = await supabase.functions.invoke("ai-reason", {
    body: {
      prompt: `Write 3 short, appealing business descriptions (each 1-2 sentences, max 150 characters) for "${businessName}", a ${category} in ${city}. Make them warm, inviting, and highlight what makes a place like this special. Return ONLY a JSON array of 3 strings.`,
    },
  });

  if (error) {
    // Fallback if ai-reason doesn't exist or fails
    return [
      `Welcome to ${businessName} — your go-to ${category.toLowerCase()} in ${city}.`,
      `${businessName} brings the best of ${city}'s ${category.toLowerCase()} scene to your doorstep.`,
      `Discover what makes ${businessName} a local favorite in ${city}.`,
    ];
  }

  try {
    const content = data?.content ?? data?.choices?.[0]?.message?.content ?? "[]";
    let parsed = typeof content === "string" ? JSON.parse(content) : content;
    if (Array.isArray(parsed)) return parsed.slice(0, 3);
  } catch {
    // Parse failed — use fallbacks
  }

  return [
    `Welcome to ${businessName} — your go-to ${category.toLowerCase()} in ${city}.`,
  ];
}
