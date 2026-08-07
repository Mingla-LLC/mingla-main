export const shareText = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
export const shareHttpsUrl = (value: unknown): string | null => {
  const text = shareText(value, 2048); if (!text) return null;
  try { const url = new URL(text); return url.protocol === "https:" ? url.toString() : null; } catch { return null; }
};
const entries = (pairs: Array<[string, unknown]>): Record<string, unknown> =>
  Object.fromEntries(pairs.filter(([, value]) => value !== "" && value !== null && value !== undefined));

export function mapPlaceSnapshot(place: Record<string, any>) {
  const metadata = entries([
    ["category", shareText(place.primary_type_display_name || place.primary_type, 80)],
    ["location", shareText(place.address || [place.city, place.country].filter(Boolean).join(", "), 180)],
    ["rating", typeof place.rating === "number" ? `${place.rating} stars` : ""],
    ["price", shareText(place.price_level, 40)],
    ["description", shareText(place.editorial_summary || place.generative_summary, 1200)],
    ["mapUrl", shareHttpsUrl(place.google_maps_uri)], ["phone", shareText(place.national_phone_number, 40)],
    ["website", shareHttpsUrl(place.website)],
  ]);
  if (place.opening_hours && typeof place.opening_hours === "object") metadata.hours = place.opening_hours;
  return {
    title: shareText(place.name, 160),
    coverUrl: shareHttpsUrl(place.photo_collage_url) || (Array.isArray(place.stored_photo_urls) ? place.stored_photo_urls.map(shareHttpsUrl).find(Boolean) ?? null : null),
    metadata, stops: [],
    sourceIds: { placePoolId: String(place.id), googlePlaceId: String(place.google_place_id) },
  };
}

export function mapCuratedSnapshot(saved: Record<string, any>) {
  const card = saved.card_data && typeof saved.card_data === "object" && !Array.isArray(saved.card_data) ? saved.card_data : {};
  const metadata = entries([
    ["category", shareText(saved.category || card.category, 80)], ["location", shareText(card.address || card.location, 180)],
    ["price", shareText(card.priceRange || card.price_range, 80)], ["duration", shareText(card.duration, 80)],
    ["description", shareText(card.description || card.fullDescription, 1200)], ["mapUrl", shareHttpsUrl(card.googleMapsUri || card.mapUrl)],
    ["phone", shareText(card.phone || card.nationalPhoneNumber, 40)], ["website", shareHttpsUrl(card.website)],
  ]);
  if (card.openingHours && typeof card.openingHours === "object") metadata.hours = card.openingHours;
  const sourceStopIds: string[] = [];
  const stops = (Array.isArray(card.stops) ? card.stops : []).slice(0, 12).map((raw: unknown) => {
    const stop = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const sourceId = shareText(stop.placeId || stop.place_id, 256); if (sourceId) sourceStopIds.push(sourceId);
    return entries([["title", shareText(stop.title || stop.name, 160)], ["category", shareText(stop.category, 80)]]);
  });
  return {
    title: shareText(saved.title || card.title || card.name, 160),
    coverUrl: shareHttpsUrl(saved.image_url) || shareHttpsUrl(card.image) || (Array.isArray(card.images) ? card.images.map(shareHttpsUrl).find(Boolean) ?? null : null),
    metadata, stops,
    sourceIds: { savedCardId: String(saved.id), experienceId: String(saved.experience_id), stopPlaceIds: sourceStopIds },
  };
}

export function sharedCardOneLink(kind: string, shareId: string, referral = ""): string {
  return `https://go.usemingla.com/w36m?pid=shared_card&deep_link_value=${encodeURIComponent(kind)}&deep_link_sub1=${encodeURIComponent(shareId)}${referral ? `&af_sub1=${encodeURIComponent(referral)}` : ""}`;
}

export function publicSnapshotResponse(row: Record<string, any>) {
  const { attribution, revoked_at: _revoked, source_ids: _sourceIds, owner_profile_id: _owner, ...snapshot } = row;
  snapshot.stops = (Array.isArray(snapshot.stops) ? snapshot.stops : []).map((raw: unknown) => {
    const stop = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return entries([["title", shareText(stop.title || stop.name, 160)], ["category", shareText(stop.category, 80)]]);
  });
  return {
    snapshot,
    appUrl: sharedCardOneLink(row.kind, row.share_id, shareText(attribution?.referralCode, 80)),
  };
}
