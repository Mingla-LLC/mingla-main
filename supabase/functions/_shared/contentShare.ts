/**
 * #1615 authoritative content-share mapping.
 *
 * Requests provide identity only. This module reads the served database truth,
 * derives ShareFactsV1, and returns the private stable-source key plus public
 * destination manifest. It deliberately has no renderer and never reads a
 * private processing-job record or provider payload.
 */

export type ContentShareKind =
  | "place" | "curated" | "event" | "rsvp_event"
  | "trip" | "experience" | "venue" | "brand";

type RecordLike = Record<string, any>;
type QueryClient = { from(table: string): any; rpc(name: string, args?: Record<string, unknown>): any };

/** Exact deployed public.place_pool columns consumed by the V1 share mapper. */
export const PLACE_POOL_SHARE_SELECT = "id,google_place_id,name,address,city,country_code,primary_type_display_name,primary_type,rating,review_count,price_level,price_min,price_max,utc_offset_minutes,editorial_summary,generative_summary,opening_hours,stored_photo_urls,google_maps_uri,national_phone_number,website,lat,lng,is_active,is_servable";

const clean = (value: unknown, max = 160): string =>
  typeof value === "string"
    ? Array.from(value.normalize("NFC").replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
      .replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim()).slice(0, max).join("")
    : "";

const compact = (value: RecordLike): RecordLike =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== "" && item !== null && item !== undefined));

const cleanPriceLevel = (value: unknown): string | undefined => ({
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
  "0": "Free", "1": "$", "2": "$$", "3": "$$$", "4": "$$$$",
} as Record<string, string>)[clean(value, 40).toUpperCase()];

const publicStop = (raw: unknown): RecordLike | null => {
  const stop = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as RecordLike : {};
  const title = clean(stop.title || stop.name, 160);
  if (!title) return null;
  return compact({
    title,
    category: clean(stop.category || stop.primaryTypeDisplayName || stop.primary_type_display_name, 80),
    area: clean(stop.neighborhood || stop.area || stop.city, 120),
    address: clean(stop.address, 180),
    description: clean(stop.description || stop.editorialSummary, 300),
    imageUrl: publicMediaUrl(stop.imageUrl || stop.image_url || stop.image),
  });
};

const publicDetailsFor = (kind: ContentShareKind, row: RecordLike, assembled: RecordLike): RecordLike => {
  if (kind === "curated") {
    const card = row.card_data && typeof row.card_data === "object" && !Array.isArray(row.card_data) ? row.card_data : {};
    return compact({
      kind,
      stops: (Array.isArray(card.stops) ? card.stops : []).slice(0, 24).map(publicStop).filter(Boolean),
      estimate: clean(card.estimate || card.estimatedCost || card.priceRange || card.price_range, 80),
    });
  }
  if (kind === "place") return compact({
    kind,
    description: clean(row.editorial_summary || row.generative_summary, 600),
    address: clean(row.address, 180),
    directionsUrl: publicExternalUrl(row.google_maps_uri),
    phone: clean(row.national_phone_number, 40),
    website: publicExternalUrl(row.website),
    utcOffsetMinutes: Number.isInteger(row.utc_offset_minutes) ? row.utc_offset_minutes : undefined,
  });
  if (["event", "rsvp_event", "trip", "experience"].includes(kind)) return compact({
    kind,
    actionEligible: assembled.actionEligible === true,
    occurrences: (assembled.relevantDates || []).slice(0, 24).map((date: RecordLike) => compact({
      startAt: clean(date.start_at, 40), endAt: clean(date.end_at, 40), timezone: clean(date.timezone || row.timezone, 80),
    })),
  });
  if (kind === "venue" || kind === "brand") return compact({
    kind,
    offerings: (assembled.offerings || []).slice(0, 8).map((item: RecordLike) => compact({
      title: clean(item.title, 160), kind: clean(item.event_type, 24),
      brandSlug: clean(item.brand_slug, 160), eventSlug: clean(item.slug, 160),
      startAt: clean(item.master_start_at, 40),
    })),
  });
  return { kind };
};

const publicMediaUrl = (value: unknown): string | null => {
  const text = clean(value, 2048);
  try {
    const url = new URL(text);
    const hasUserInfo = !url.href.startsWith(`${url.protocol}//${url.host}`);
    if (url.protocol !== "https:" || hasUserInfo || url.port) return null;
    const host = url.hostname.toLowerCase();
    const bunnyHost = clean((globalThis as any).Deno?.env?.get?.("BUNNY_STREAM_CDN_HOSTNAME"), 255).toLowerCase();
    const allowed = ["usemingla.com","www.usemingla.com","business.usemingla.com"].includes(host)
      || host === "images.pexels.com" || host === "videos.pexels.com"
      || host === "i.giphy.com" || host === "media.giphy.com"
      || host === "vz-a16fce08-6c6.b-cdn.net" || (bunnyHost.length > 0 && host === bunnyHost)
      || (host === "gqnoajqerqhnvulmnyvv.supabase.co" && url.pathname.startsWith("/storage/v1/object/public/"));
    return allowed ? url.toString() : null;
  } catch { return null; }
};

const publicExternalUrl = (value: unknown): string | null => {
  const text = clean(value, 2048);
  try { const url = new URL(text); return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null; }
  catch { return null; }
};

const imageFallback = (row: RecordLike): string | null => {
  const gallery = Array.isArray(row.cover_media_gallery) ? row.cover_media_gallery : [];
  const galleryUrl = gallery.map((item: any) => {
    const mediaKind = clean(item?.type || item?.kind || item?.mediaType || item?.media_type, 16).toLowerCase();
    if (["video", "gif", "animated"].includes(mediaKind)) return null;
    const candidate = publicMediaUrl(item?.url);
    if (!candidate) return null;
    try {
      const pathname = new URL(candidate).pathname;
      return ["image", "photo"].includes(mediaKind) || /\.(?:avif|jpe?g|png|webp)$/i.test(pathname)
        ? candidate : null;
    } catch { return null; }
  }).find(Boolean);
  const poolUrl = (Array.isArray(row.pool_photo_urls) ? row.pool_photo_urls : [])
    .map(publicMediaUrl).find(Boolean);
  const storedUrl = (Array.isArray(row.stored_photo_urls) ? row.stored_photo_urls : [])
    .map(publicMediaUrl).find(Boolean);
  const card = row.card_data && typeof row.card_data === "object" ? row.card_data : {};
  const cardUrl = [row.image_url, card.image, ...(Array.isArray(card.images) ? card.images : [])]
    .map(publicMediaUrl).find(Boolean);
  return galleryUrl || poolUrl || storedUrl || cardUrl || publicMediaUrl(row.profile_photo_url);
};

export function mapServedMediaIdentity(row: RecordLike): RecordLike | null {
  const primary = publicMediaUrl(row.cover_media_url);
  const type = clean(row.cover_media_type, 12);
  const authoritativePoster = publicMediaUrl(row.cover_media_poster_url);
  const fallback = imageFallback(row);
  const alt = clean(row.cover_media_alt || row.name || row.title, 240);
  // #1719: animated covers are shareable only when the same cover identity has
  // an explicitly persisted poster. A gallery/logo fallback can be unrelated
  // and must never masquerade as the video's/GIF's still.
  if (primary && type === "video" && authoritativePoster) return compact({ kind: "video", url: primary, posterUrl: authoritativePoster, alt });
  if (primary && type === "gif" && authoritativePoster) return compact({ kind: "gif", url: primary, posterUrl: authoritativePoster, alt });
  if (primary && (type === "image" || !type)) return compact({ kind: "photo", url: primary, posterUrl: primary, alt });
  if (fallback) return compact({ kind: "photo", url: fallback, posterUrl: fallback, alt });
  return null;
}

const money = (minorUnits: unknown, currency: unknown, disclosure?: string): RecordLike | undefined => {
  const code = clean(currency, 3).toUpperCase();
  return Number.isSafeInteger(minorUnits) && Number(minorUnits) >= 0 && /^[A-Z]{3}$/.test(code)
    ? compact({ minorUnits, currency: code, disclosure }) : undefined;
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const clockLabel = (value: unknown): string => {
  const match = /^(\d{2}):(\d{2})$/.exec(clean(value, 5)); if (!match) return "";
  const hour = Number(match[1]); const minute = Number(match[2]); if (hour > 23 || minute > 59) return "";
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`;
};
export function normalizeServedHours(value: unknown): RecordLike[] | undefined {
  const byDay = new Map<string, string[]>();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const source = value as RecordLike;
    const lines = Array.isArray(source.weekdayDescriptions) ? source.weekdayDescriptions
      : Array.isArray(source.weekday_text) ? source.weekday_text : null;
    if (lines) for (const item of lines) {
      if (typeof item !== "string") return undefined;
      const match = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday):\s*(.+)$/i.exec(item.trim());
      if (!match) return undefined;
      const day = DAYS.find((candidate) => candidate.toLowerCase() === match[1].toLowerCase());
      const label = clean(match[2], 80); if (!day || !label || /\[object Object\]|OpenNow:|Periods:/i.test(label)) return undefined;
      byDay.set(day, [label]);
    }
  } else if (Array.isArray(value)) {
    for (const row of value) {
      if (!row || typeof row !== "object" || Array.isArray(row) || !Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6) return undefined;
      const label = row.is_closed === true ? "Closed" : row.open_time === row.close_time ? "Open 24 hours" : `${clockLabel(row.open_time)}–${clockLabel(row.close_time)}`;
      if (!label || label.startsWith("–") || label.endsWith("–")) return undefined;
      const day=DAYS[row.weekday];const labels=byDay.get(day)||[];
      if(label==="Closed")byDay.set(day,[label]);else if(!labels.includes("Closed"))byDay.set(day,[...labels,label]);
    }
  }
  return byDay.size === 7 ? DAYS.map((day) => ({ day, label: byDay.get(day)!.join(", ") })) : undefined;
}

const nativeText = (value: unknown, max: number, required = false): string | undefined => {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error("invalid_native_snapshot");
    return undefined;
  }
  if (typeof value !== "string" || Array.from(value).length > max || /[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)) throw new Error("invalid_native_snapshot");
  return value.normalize("NFC");
};
const nativeNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("invalid_native_snapshot");
  return value;
};
const nativeBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error("invalid_native_snapshot");
  return value;
};
const exactObjectKeys = (value: RecordLike, allowed: string[]): boolean => Object.keys(value).every((key) => allowed.includes(key));
const nativeHours = (value: unknown): unknown => {
  if (value === undefined) return undefined; if (value === null) return null;
  if (typeof value === "string") return nativeText(value, 4000, true);
  if (Array.isArray(value)) return value.map((item) => nativeText(item, 500, true)!);
  if (!value || typeof value !== "object") throw new Error("invalid_native_snapshot");
  const row=value as RecordLike;
  if (exactObjectKeys(row,["open_now","weekday_text"])) return compact({open_now:nativeBoolean(row.open_now),weekday_text:nativeStrings(row.weekday_text,500)});
  if (exactObjectKeys(row,["lines"])) return {lines:nativeStrings(row.lines,500)};
  if (exactObjectKeys(row,["openNow","periods","nextOpenTime","nextCloseTime","weekdayDescriptions"])) {
    let periods:RecordLike[]|undefined;
    if(row.periods!==undefined){if(!Array.isArray(row.periods)||row.periods.length>32)throw new Error("invalid_native_snapshot");periods=row.periods.map((raw:unknown)=>{
      if(!raw||typeof raw!=="object"||Array.isArray(raw)||!exactObjectKeys(raw as RecordLike,["open","close"]))throw new Error("invalid_native_snapshot");
      const point=(candidate:unknown)=>{if(candidate===undefined)return undefined;if(!candidate||typeof candidate!=="object"||Array.isArray(candidate)||!exactObjectKeys(candidate as RecordLike,["day","hour","minute","date"]))throw new Error("invalid_native_snapshot");const p=candidate as RecordLike;return compact({day:nativeNumber(p.day),hour:nativeNumber(p.hour),minute:nativeNumber(p.minute),date:nativeText(p.date,40)});};
      return compact({open:point((raw as RecordLike).open),close:point((raw as RecordLike).close)});
    });}
    return compact({openNow:nativeBoolean(row.openNow),periods,nextOpenTime:nativeText(row.nextOpenTime,80),nextCloseTime:nativeText(row.nextCloseTime,80),weekdayDescriptions:nativeStrings(row.weekdayDescriptions,500)});
  }
  const days=["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  if(Object.keys(row).length<=7&&Object.keys(row).every((key)=>days.includes(key))) return Object.fromEntries(Object.entries(row).map(([key,item])=>[key,nativeText(item,500,true)]));
  throw new Error("invalid_native_snapshot");
};
const nativeSocialStats=(value:unknown):RecordLike|undefined=>{
  if(value===undefined||value===null)return undefined;if(typeof value!=="object"||Array.isArray(value))throw new Error("invalid_native_snapshot");
  const row=value as RecordLike;if(!exactObjectKeys(row,["views","likes","saves","shares"]))throw new Error("invalid_native_snapshot");
  const output=compact({views:nativeNumber(row.views),likes:nativeNumber(row.likes),saves:nativeNumber(row.saves),shares:nativeNumber(row.shares)});
  if(Object.values(output).some((item)=>typeof item!=="number"||item<0))throw new Error("invalid_native_snapshot");return output;
};
const nativeImages = (values: unknown): string[] => {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw new Error("invalid_native_snapshot");
  return values.map((value) => {
    const candidate = nativeText(value, 2048, true)!;
    const url = publicMediaUrl(candidate); if (!url) throw new Error("invalid_native_snapshot"); return url;
  });
};
const nativeExternalUrl = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const candidate=nativeText(value,2048,true)!; const url=publicExternalUrl(candidate);
  if (!url) throw new Error("invalid_native_snapshot"); return url;
};
const nativeStrings = (value: unknown, max: number): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error("invalid_native_snapshot");
  return value.map((item) => nativeText(item, max, true)!);
};
const priceFields = (source: RecordLike): RecordLike => compact({
  priceRangeStatus: nativeText(source.priceRangeStatus, 32), sourceMinMinor: nativeNumber(source.sourceMinMinor),
  sourceMaxMinor: nativeNumber(source.sourceMaxMinor), sourceCurrencyCode: nativeText(source.sourceCurrencyCode, 3),
  sourceMinorUnitExponent: nativeNumber(source.sourceMinorUnitExponent), displayMinMinor: nativeNumber(source.displayMinMinor),
  displayMaxMinor: nativeNumber(source.displayMaxMinor), displayCurrencyCode: nativeText(source.displayCurrencyCode, 3),
  displayMinorUnitExponent: nativeNumber(source.displayMinorUnitExponent), priceIsApproximate: nativeBoolean(source.priceIsApproximate),
  fxSnapshotId: nativeText(source.fxSnapshotId, 128), fxProvider: nativeText(source.fxProvider, 80),
  fxProviderUpdatedAt: nativeText(source.fxProviderUpdatedAt, 80), fxFreshness: nativeText(source.fxFreshness, 32),
});

/** Explicit recipient-safe allowlist. Private ownership, provider payloads,
 * processing metadata and internal notes cannot enter a native chat card. */
export function buildNativeContentCardSnapshot(kind: "place" | "curated", row: RecordLike): RecordLike {
  const card = row.card_data && typeof row.card_data === "object" && !Array.isArray(row.card_data) ? row.card_data : {};
  const source = kind === "curated" ? card : row;
  const sourceImages = source.images === undefined ? [] : nativeImages(source.images);
  const poolImages = source.image || sourceImages.length ? [] : nativeImages(row.stored_photo_urls ?? []);
  const image = source.image ? nativeImages([source.image])[0] : sourceImages[0] || poolImages[0];
  const images = sourceImages.length ? sourceImages : image ? [image, ...poolImages.filter((item) => item !== image)] : poolImages;
  let stops: RecordLike[] | undefined;
  if (kind === "curated") {
    if (!Array.isArray(card.stops) || card.stops.length === 0) throw new Error("invalid_native_snapshot");
    stops = card.stops.map((raw: unknown) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid_native_snapshot");
      const stop = raw as RecordLike;
      const imageUrl = stop.imageUrl ? nativeImages([stop.imageUrl])[0] : undefined;
      const imageUrls = stop.imageUrls === undefined ? undefined : nativeImages(stop.imageUrls);
      return compact({
        stopNumber: nativeNumber(stop.stopNumber), stopLabel: nativeText(stop.stopLabel, 40),
        placeId: nativeText(stop.placeId, 256, true), placeName: nativeText(stop.placeName, 160, true), placeType: nativeText(stop.placeType, 120),
        address: nativeText(stop.address, 500), rating: nativeNumber(stop.rating), reviewCount: nativeNumber(stop.reviewCount),
        imageUrl, imageUrls, priceLevelLabel: nativeText(stop.priceLevelLabel, 80), priceTier: nativeText(stop.priceTier, 40),
        priceMin: nativeNumber(stop.priceMin), priceMax: nativeNumber(stop.priceMax), openingHours: nativeHours(stop.openingHours),
        utcOffsetMinutes: nativeNumber(stop.utcOffsetMinutes), isOpenNow: stop.isOpenNow === null ? null : nativeBoolean(stop.isOpenNow),
        website: stop.website === null ? null : nativeExternalUrl(stop.website),
        lat: nativeNumber(stop.lat), lng: nativeNumber(stop.lng), aiDescription: nativeText(stop.aiDescription, 4000),
        estimatedDurationMinutes: nativeNumber(stop.estimatedDurationMinutes), optional: nativeBoolean(stop.optional), dismissible: nativeBoolean(stop.dismissible),
        role: nativeText(stop.role, 80), phone: stop.phone === null ? null : nativeText(stop.phone, 80),
        countryCode: stop.countryCode === null ? null : nativeText(stop.countryCode, 2), comboCategory: nativeText(stop.comboCategory, 80), rankSignal: nativeText(stop.rankSignal, 120),
      });
    });
  }
  const snapshot = compact({ contract: "native_content_card_snapshot_v1", version: 1, kind,
    id: nativeText(source.id || source.placeId || row.google_place_id || row.id, 256, true),
    title: nativeText(source.title || source.name || row.name || row.title, 160, true),
    category: nativeText(source.category || row.primary_type_display_name || row.primary_type || row.category, 80),
    categoryIcon: nativeText(source.categoryIcon, 120), image, images,
    description: nativeText(source.description || source.fullDescription || row.editorial_summary || row.generative_summary, 1200),
    fullDescription: nativeText(source.fullDescription || source.description || row.editorial_summary || row.generative_summary, 16000),
    address: nativeText(source.address || row.address, 500), rating: nativeNumber(source.rating ?? row.rating),
    reviewCount: nativeNumber(source.reviewCount ?? row.review_count), priceRange: nativeText(source.priceRange || cleanPriceLevel(row.price_level), 80),
    ...priceFields(source), lat: nativeNumber(source.lat ?? row.lat), lng: nativeNumber(source.lng ?? row.lng),
    placeId: nativeText(source.placeId || source.googlePlaceId || row.google_place_id, 256),
    openingHours: nativeHours(source.openingHours ?? row.opening_hours), utcOffsetMinutes: nativeNumber(source.utcOffsetMinutes ?? row.utc_offset_minutes),
    phone: nativeText(source.phone || row.national_phone_number, 80), countryCode: source.countryCode === null ? null : nativeText(source.countryCode || row.country_code, 2),
    website: nativeExternalUrl(source.website || row.website),
    highlights: nativeStrings(source.highlights, 240), tags: nativeStrings(source.tags, 120), socialStats: nativeSocialStats(source.socialStats),
    cardType: kind === "curated" ? "curated" : "single", stops,
    tagline: nativeText(source.tagline, 500), categoryLabel: nativeText(source.categoryLabel, 160), pairingKey: nativeText(source.pairingKey, 160),
    experienceType: nativeText(source.experienceType, 120), totalPriceMin: nativeNumber(source.totalPriceMin), totalPriceMax: nativeNumber(source.totalPriceMax),
    estimatedDurationMinutes: nativeNumber(source.estimatedDurationMinutes), shoppingList: nativeStrings(source.shoppingList, 500), tip: source.tip === null ? null : nativeText(source.tip, 2000),
  });
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 262144) throw new Error("native_snapshot_too_large");
  return snapshot;
}

const nativePreview = (snapshot: RecordLike): RecordLike => compact({
  title: snapshot.title, category: snapshot.category, image: snapshot.image, cardType: snapshot.cardType,
  stopCount: Array.isArray(snapshot.stops) ? snapshot.stops.length : undefined,
});

export function assertNativeSourceIdentity(kind: "place" | "curated", sourceRow: RecordLike, requestedPlace?: RecordLike): void {
  const card = sourceRow.card_data && typeof sourceRow.card_data === "object" && !Array.isArray(sourceRow.card_data) ? sourceRow.card_data : {};
  const curated = card.cardType === "curated" || (Array.isArray(card.stops) && card.stops.length > 0);
  if ((kind === "curated") !== curated) throw new Error("validation");
  if (kind === "place" && requestedPlace) {
    const candidates = [sourceRow.experience_id, sourceRow.saved_experience_id, card.placeId, card.googlePlaceId,
      card.google_place_id, card.placePoolId, card.place_pool_id, card.id].map((value) => clean(value, 256)).filter(Boolean);
    if (!candidates.includes(clean(requestedPlace.google_place_id, 256)) && !candidates.includes(clean(requestedPlace.id, 256))) throw new Error("validation");
  }
}

export function nativeCuratedStopFromPlaceRow(row: RecordLike,index:number,total:number):RecordLike{
  const photos=Array.isArray(row.stored_photo_urls)?row.stored_photo_urls:[];
  const hours=row.opening_hours&&typeof row.opening_hours==="object"&&!Array.isArray(row.opening_hours)?row.opening_hours:{};
  return compact({stopNumber:index+1,stopLabel:index===0?"Start Here":index===total-1?"End With":"Then",
    placeId:row.google_place_id,placeName:row.name,placeType:row.primary_type_display_name||row.primary_type,address:row.address,
    rating:row.rating,reviewCount:row.review_count,imageUrl:photos[0],imageUrls:photos,priceLevelLabel:cleanPriceLevel(row.price_level),
    priceMin:row.price_min,priceMax:row.price_max,openingHours:row.opening_hours,utcOffsetMinutes:row.utc_offset_minutes,
    isOpenNow:typeof hours.openNow==="boolean"?hours.openNow:typeof hours.open_now==="boolean"?hours.open_now:null,
    website:row.website||null,lat:row.lat,lng:row.lng,aiDescription:row.editorial_summary||row.generative_summary,
    phone:row.national_phone_number||null,countryCode:row.country_code||null});
}

export function assertSavedCuratedStopsServable(stops:unknown,rows:RecordLike[]):void{
  if(!Array.isArray(stops)||stops.length===0)throw new Error("validation");
  const ids=stops.map((raw)=>raw&&typeof raw==="object"&&!Array.isArray(raw)?clean((raw as RecordLike).placeId,256):"");
  if(ids.some((id)=>!id)||new Set(ids).size!==ids.length)throw new Error("validation");
  const byId=new Map<string,RecordLike>();for(const row of rows){const id=clean(row.google_place_id,256);if(!id||byId.has(id))throw new Error("validation");byId.set(id,row);}
  if(byId.size!==ids.length||ids.some((id)=>{const row=byId.get(id);return !row||row.is_active!==true||row.is_servable!==true;}))throw new Error("validation");
}

const durationLabel = (start: unknown, end: unknown): string | undefined => {
  if (typeof start !== "string" || typeof end !== "string") return undefined;
  const milliseconds = Date.parse(end) - Date.parse(start); if (!(milliseconds > 0)) return undefined;
  const minutes = Math.round(milliseconds / 60000); return minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minutes`;
};

const status = (row: RecordLike, assembled: RecordLike = {}): string | undefined => {
  if (row.status === "cancelled") return "cancelled";
  if (row.status === "ended") return "ended";
  if (assembled.explicitDateTbd === true) return row.is_multi_date === true ? "dates_tbd" : "date_tbd";
  if (assembled.soldOut === true) return "sold_out";
  if (assembled.rsvpClosed === true) return "rsvp_closed";
  return undefined;
};

function localSchedule(startAt: unknown, timezone: unknown): { localDate?: string; localTime?: string } {
  const zone = clean(timezone, 80) || "UTC";
  if (typeof startAt !== "string" || Number.isNaN(Date.parse(startAt))) return {};
  try {
    const date = new Date(startAt);
    return {
      localDate: new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric", year: "numeric" }).format(date),
      localTime: new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(date),
    };
  } catch {
    return {};
  }
}

function sourceId(input: RecordLike, ...keys: string[]): string {
  for (const key of keys) {
    const value = clean(input[key], 256);
    if (value) return value;
  }
  return "";
}

const exactIdentityKeys = (identity: RecordLike, expected: string[]): boolean =>
  Object.keys(identity).sort().join("|") === [...expected].sort().join("|");

const curatedCompositionIds = (identity: RecordLike): string[] | null => {
  if (!exactIdentityKeys(identity, ["stopPlaceIds"]) || !Array.isArray(identity.stopPlaceIds)
    || identity.stopPlaceIds.length < 2 || identity.stopPlaceIds.length > 24) return null;
  const ids = identity.stopPlaceIds.map((value: unknown) => clean(value, 256));
  if (ids.some((value: string, index: number) => !value || value !== identity.stopPlaceIds[index])
    || new Set(ids).size !== ids.length
    || new TextEncoder().encode(JSON.stringify(ids)).byteLength > 8192) return null;
  return ids;
};

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const mapCuratedComposition = (rows: RecordLike[]) => {
  const names = rows.map((row) => clean(row.name, 160));
  if (names.some((name) => !name)) throw new Error("not_public");
  const mediaByStop = rows.map(mapServedMediaIdentity);
  const stops = rows.map((row, index) => publicStop({
    ...row,
    description: row.editorial_summary || row.generative_summary,
    imageUrl: mediaByStop[index]?.posterUrl,
  }));
  if (stops.some((stop) => stop === null)) throw new Error("not_public");
  const stopCities = rows.map((row) => clean(row.city, 120));
  const area = stopCities.every((city) => city.length > 0 && city === stopCities[0]) ? stopCities[0] : undefined;
  const mediaIdentity = mediaByStop.find((candidate) => candidate !== null) || null;
  const facts = compact({
    schemaVersion: 1,
    kind: "curated",
    title: clean(names.join(" → "), 160),
    stopCount: rows.length,
    area,
    route: {},
  });
  if (mediaIdentity) facts.media = mediaIdentity;
  const publicDetails = { kind: "curated", stops };
  return {
    facts,
    mediaIdentity,
    publicDetails,
    destinationManifest: { kind: "curated", publicDetails },
  };
};

export function mapAuthoritativeShareFacts(kind: ContentShareKind, assembled: RecordLike) {
  const row = assembled.row || {};
  const brand = Array.isArray(row.brands) ? row.brands[0] : row.brands || assembled.brand || {};
  const date = assembled.date || {};
  const schedule = localSchedule(date.start_at, row.timezone || date.timezone);
  const eligibleTickets = (assembled.eligibleTickets || assembled.tickets || []) as RecordLike[];
  const displayCents = (ticket: RecordLike) => ticket.is_free === true ? 0
    : Number.isSafeInteger(ticket.all_in_cents) && ticket.all_in_cents >= 0 ? ticket.all_in_cents : undefined;
  const lowestTicket = [...eligibleTickets].filter((ticket) => Number.isSafeInteger(displayCents(ticket)) && displayCents(ticket) >= 0)
    .sort((a, b) => Number(displayCents(a)) - Number(displayCents(b)))[0];
  const lowestCents=lowestTicket?displayCents(lowestTicket):undefined;
  const price = lowestTicket ? money(lowestCents, lowestTicket.is_free === true ? (lowestTicket.display_currency || lowestTicket.currency) : lowestTicket.display_currency, lowestCents === 0 ? "Free" : "From") : undefined;
  const routeBase = compact({ kind, brandSlug: clean(brand.slug, 160), eventSlug: clean(row.slug, 160) });
  let facts: RecordLike;
  let destination: RecordLike;

  switch (kind) {
    case "place":
      facts = compact({
        schemaVersion: 1, kind, title: clean(row.name),
        category: clean(row.primary_type_display_name || row.primary_type, 80),
        area: clean(row.city, 120),
        rating: Number.isFinite(row.rating) && row.rating >= 0 && row.rating <= 5 ? row.rating : undefined,
        priceLevel: cleanPriceLevel(row.price_level), description: clean(row.editorial_summary || row.generative_summary, 600),
        hours: normalizeServedHours(row.opening_hours),
        timezone: clean(row.timezone || (Number.isInteger(row.utc_offset_minutes) ? `UTC_OFFSET:${row.utc_offset_minutes}` : ""), 80),
        route: { placeId: clean(row.google_place_id, 256) },
      });
      destination = { kind, placeId: clean(row.google_place_id, 256) };
      break;
    case "curated": {
      const card = row.card_data && typeof row.card_data === "object" && !Array.isArray(row.card_data) ? row.card_data : {};
      const stops = Array.isArray(card.stops) ? card.stops : [];
      facts = compact({
        schemaVersion: 1, kind, title: clean(row.title || card.title || card.name),
        stopCount: stops.length, area: clean(card.neighborhood || card.city || card.location, 120),
        duration: clean(card.duration, 80), estimate: clean(card.estimate || card.estimatedCost || card.priceRange || card.price_range, 80),
        description: clean(card.description || card.fullDescription, 600),
        route: {},
      });
      destination = { kind };
      break;
    }
    case "event":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.title), ...schedule,
        venue: clean(row.location_text, 160), price,
        availability: clean(assembled.availability, 80), status: status(row, assembled), timezone: clean(row.timezone, 80), description: clean(row.description, 600),
        route: { eventSlug: clean(row.slug, 160) } });
      destination = { ...routeBase, webPath: `/e/${clean(brand.slug, 160)}/${clean(row.slug, 160)}` };
      break;
    case "rsvp_event":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.title), ...schedule,
        venue: clean(row.location_text, 160),
        availability: clean(assembled.availability, 80), status: status(row, assembled), timezone: clean(row.timezone, 80), description: clean(row.description, 600),
        route: { eventSlug: clean(row.slug, 160) } });
      destination = { ...routeBase, webPath: `/e/${clean(brand.slug, 160)}/${clean(row.slug, 160)}` };
      break;
    case "trip":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.title), destination: clean(row.destination_text || row.location_text, 160),
        dateRange: clean(assembled.dateRange, 120), duration: clean(assembled.duration, 80), startingPrice: price,
        status: status(row, assembled), timezone: clean(row.timezone, 80), description: clean(row.description, 600),
        route: { eventSlug: clean(row.slug, 160) } });
      destination = { ...routeBase, webPath: `/t/${clean(brand.slug, 160)}/${clean(row.slug, 160)}` };
      break;
    case "experience":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.title), area: clean(row.location_text, 120),
        nextDate: [schedule.localDate, schedule.localTime].filter(Boolean).join(" at "), duration: clean(assembled.duration, 80), price,
        availability: clean(assembled.availability, 80), status: status(row, assembled), timezone: clean(row.timezone, 80), description: clean(row.description, 600),
        route: { eventSlug: clean(row.slug, 160) } });
      destination = { ...routeBase, webPath: `/exp/${clean(brand.slug, 160)}/${clean(row.slug, 160)}` };
      break;
    case "venue":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.name), category: clean(row.venue_category, 80),
        area: clean(row.city, 120), nextPublicOffering: clean(assembled.nextPublicOffering, 160),
        timezone: clean(row.iana_timezone, 80), hours: normalizeServedHours(row.hours), description: clean(row.pitch, 600),
        route: { brandSlug: clean(row.brand_slug, 160), venueSlug: clean(row.slug, 160) } });
      destination = { kind, brandSlug: clean(row.brand_slug, 160), venueSlug: clean(row.slug, 160), webPath: `/b/${clean(row.brand_slug, 160)}/v/${clean(row.slug, 160)}` };
      break;
    case "brand":
      facts = compact({ schemaVersion: 1, kind, title: clean(row.name), category: clean(row.venue_category, 80), area: clean(row.city, 120),
        upcomingPublicOfferingCount: assembled.upcomingCount > 0 ? assembled.upcomingCount : undefined,
        description: clean(row.description, 600), route: { brandSlug: clean(row.slug, 160) } });
      destination = { kind, brandSlug: clean(row.slug, 160), webPath: `/b/${clean(row.slug, 160)}` };
      break;
  }

  if (!facts.title) throw new Error("not_found");
  const mediaIdentity = mapServedMediaIdentity(row);
  if (mediaIdentity) facts.media = mediaIdentity;
  const publicDetails = publicDetailsFor(kind, row, assembled);
  return { facts, destinationManifest: { ...destination, publicDetails }, publicDetails, mediaIdentity };
}

const eventTypeFor = (kind: ContentShareKind): string | null => ({
  event: "event", rsvp_event: "rsvp", trip: "trip", experience: "experience",
} as Record<string, string>)[kind] || null;

const relevantDatesAt = (dates: RecordLike[], nowMs = Date.now()): RecordLike[] => {
  const valid = dates.filter((date) => typeof date?.start_at === "string" && Number.isFinite(Date.parse(date.start_at)))
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const future = valid.filter((date) => Date.parse(typeof date.end_at === "string" ? date.end_at : date.start_at) >= nowMs);
  return future.length ? future : valid.slice(-1);
};

export const ticketTruthAt = (tickets: RecordLike[], remainingRows: RecordLike[], nowMs = Date.now()) => {
  const remaining = new Map(remainingRows.map((row) => [String(row.ticket_type_id), row.remaining]));
  const authored = tickets.filter((ticket) => ticket.is_hidden !== true && ticket.is_disabled !== true && ticket.available_online !== false);
  const onSale = authored.filter((ticket) => {
    const starts = typeof ticket.sale_start_at === "string" ? Date.parse(ticket.sale_start_at) : NaN;
    const ends = typeof ticket.sale_end_at === "string" ? Date.parse(ticket.sale_end_at) : NaN;
    return (!Number.isFinite(starts) || starts <= nowMs) && (!Number.isFinite(ends) || ends > nowMs);
  });
  const finiteRemaining = (ticket: RecordLike): number | null => {
    if (ticket.is_unlimited === true) return null;
    const value = remaining.get(String(ticket.id));
    return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
  };
  // Unknown remaining capacity must fail open for purchase eligibility. It may
  // never be converted into either a false sold-out state or a finite claim.
  const eligibleTickets = onSale.filter((ticket) => finiteRemaining(ticket) !== 0);
  const eligibleRemaining = eligibleTickets.map(finiteRemaining);
  const finiteAvailability = eligibleRemaining.length > 0 && eligibleRemaining.every((value) => value !== null)
    ? (eligibleRemaining as number[]).reduce((sum, value) => sum + value, 0) : null;
  return {
    eligibleTickets,
    soldOut: onSale.length > 0 && onSale.every((ticket) => finiteRemaining(ticket) === 0),
    availability: finiteAvailability !== null ? `${finiteAvailability} left` : undefined,
  };
};

export async function loadAuthoritativeContentShare(
  db: QueryClient, userId: string, kind: ContentShareKind, identity: RecordLike,
) {
  const sourceScope = clean(identity.sourceScope, 20);
  const sourceRecordId = sourceId(identity, "sourceRecordId");
  let sourceCardRow: RecordLike | null = null;
  if (sourceRecordId && sourceScope === "solo") {
    const result = await db.from("saved_card").select("id,profile_id,experience_id,title,category,image_url,card_data").eq("id", sourceRecordId).eq("profile_id", userId).maybeSingle();
    if (result.error) throw new Error("db_error");
    if (!result.data) throw new Error("gone");
    sourceCardRow = result.data;
  } else if (sourceRecordId && sourceScope === "collaboration") {
    const result = await db.from("board_saved_cards").select("id,session_id,experience_id,saved_experience_id,card_data").eq("id", sourceRecordId).maybeSingle();
    if (result.error) throw new Error("db_error");
    if (!result.data) throw new Error("gone");
    const membership = await db.from("session_participants").select("id").eq("session_id", result.data.session_id).eq("user_id", userId).eq("has_accepted", true).maybeSingle();
    if (membership.error) throw new Error("db_error");
    if (!membership.data) throw new Error("gone");
    sourceCardRow = result.data;
  } else if (sourceRecordId || sourceScope) throw new Error("validation");
  if (sourceCardRow && (kind === "place" || kind === "curated")) assertNativeSourceIdentity(kind, sourceCardRow);

  if (kind === "place") {
    const poolId = sourceId(identity, "placePoolId");
    const googleId = sourceId(identity, "googlePlaceId");
    if (!poolId && !googleId) throw new Error("validation");
    let query = db.from("place_pool").select(PLACE_POOL_SHARE_SELECT).limit(1);
    query = poolId ? query.eq("id", poolId) : query.eq("google_place_id", googleId);
    const { data: row, error } = await query.maybeSingle();
    if (error) throw new Error("db_error");
    if (!row) throw new Error("gone");
    if (row.is_active !== true || row.is_servable === false) throw new Error("not_public");
    if (sourceCardRow) {
      assertNativeSourceIdentity("place", sourceCardRow, row);
    }
    const nativeSnapshot = buildNativeContentCardSnapshot("place", sourceCardRow
      ? { ...row, ...(sourceCardRow.card_data || {}), id: sourceCardRow.card_data?.id || row.id }
      : row);
    return { ...mapAuthoritativeShareFacts(kind, { row }), nativeSnapshot, nativePreview: nativePreview(nativeSnapshot),
      sourceKey: sourceCardRow ? `place:${sourceScope}:${sourceRecordId}` : `place:${row.id}`,
      sourceReference: sourceCardRow ? { sourceScope, sourceRecordId, placePoolId: row.id } : { placePoolId: row.id } };
  }

  if (kind === "curated") {
    const stopPlaceIds = curatedCompositionIds(identity);
    if (stopPlaceIds) {
      const { data, error } = await db.from("place_pool").select(PLACE_POOL_SHARE_SELECT).in("google_place_id", stopPlaceIds);
      if (error) throw new Error("db_error");
      const rows = Array.isArray(data) ? data : [];
      const rowsByGoogleId = new Map<string, RecordLike>();
      for (const row of rows) {
        const googlePlaceId = clean(row?.google_place_id, 256);
        if (!googlePlaceId || rowsByGoogleId.has(googlePlaceId)) throw new Error("gone");
        rowsByGoogleId.set(googlePlaceId, row);
      }
      const orderedRows = stopPlaceIds.map((googlePlaceId) => rowsByGoogleId.get(googlePlaceId));
      if (orderedRows.some((row) => !row)) throw new Error("gone");
      if (orderedRows.some((row) => row?.is_active !== true || row?.is_servable !== true)) throw new Error("not_public");
      const canonicalIds = JSON.stringify(stopPlaceIds);
      const mapped = mapCuratedComposition(orderedRows as RecordLike[]);
      const nativeSnapshot = buildNativeContentCardSnapshot("curated", { card_data: {
        title: mapped.facts.title, category: "Curated plan", image: mapped.mediaIdentity?.posterUrl,
        stops: (orderedRows as RecordLike[]).map((stop,index) => nativeCuratedStopFromPlaceRow(stop,index,orderedRows.length)),
      } });
      return {
        ...mapped, nativeSnapshot, nativePreview: nativePreview(nativeSnapshot),
        sourceKey: `curated-composition:${await sha256Hex(canonicalIds)}`,
        sourceReference: { stopPlaceIds },
      };
    }

    if (sourceCardRow) {
      const savedStops=sourceCardRow.card_data?.stops;
      const savedIds=Array.isArray(savedStops)?savedStops.map((stop:RecordLike)=>clean(stop?.placeId,256)):[];
      if(savedIds.length===0||savedIds.some((id:string)=>!id)||new Set(savedIds).size!==savedIds.length)throw new Error("validation");
      const served=await db.from("place_pool").select("google_place_id,is_active,is_servable").in("google_place_id",savedIds);
      if(served.error)throw new Error("db_error");
      assertSavedCuratedStopsServable(savedStops,Array.isArray(served.data)?served.data:[]);
      const nativeSnapshot = buildNativeContentCardSnapshot("curated", sourceCardRow);
      return { ...mapAuthoritativeShareFacts(kind, { row: sourceCardRow }), nativeSnapshot, nativePreview: nativePreview(nativeSnapshot),
        sourceKey: `curated:${sourceScope}:${sourceRecordId}`, sourceReference: { sourceScope, sourceRecordId } };
    }
    const id = sourceId(identity, "savedCardId");
    const legacyKeys = Object.keys(identity);
    const legacyKeysAreReadCompatible = legacyKeys.every((key) => ["savedCardId", "placePoolId", "googlePlaceId"].includes(key));
    if (!legacyKeysAreReadCompatible || !id || identity.savedCardId !== id) throw new Error("validation");
    const { data: row, error } = await db.from("saved_card").select("id,profile_id,experience_id,title,category,image_url,card_data").eq("id", id).eq("profile_id", userId).maybeSingle();
    if (error) throw new Error("db_error");
    if (!row) throw new Error("gone");
    const legacyCard = row.card_data && typeof row.card_data === "object" && !Array.isArray(row.card_data) ? row.card_data : {};
    if (!(legacyCard.cardType === "curated" || (Array.isArray(legacyCard.stops) && legacyCard.stops.length > 0))) throw new Error("validation");
    const legacyIds=legacyCard.stops.map((stop:RecordLike)=>clean(stop?.placeId,256));
    if(legacyIds.length===0||legacyIds.some((placeId:string)=>!placeId)||new Set(legacyIds).size!==legacyIds.length)throw new Error("validation");
    const legacyServed=await db.from("place_pool").select("google_place_id,is_active,is_servable").in("google_place_id",legacyIds);
    if(legacyServed.error)throw new Error("db_error");
    assertSavedCuratedStopsServable(legacyCard.stops,Array.isArray(legacyServed.data)?legacyServed.data:[]);
    const nativeSnapshot = buildNativeContentCardSnapshot("curated", row);
    return { ...mapAuthoritativeShareFacts(kind, { row }), nativeSnapshot, nativePreview: nativePreview(nativeSnapshot),
      sourceKey: `curated:${row.id}`, sourceReference: { savedCardId: row.id } };
  }

  const expectedType = eventTypeFor(kind);
  if (expectedType) {
    const id = sourceId(identity, "eventId");
    const eventSlug = sourceId(identity, "eventSlug");
    const brandSlug = sourceId(identity, "brandSlug");
    if (!id && (!eventSlug || !brandSlug)) throw new Error("validation");
    let query = db.from("events").select("id,title,description,slug,location_text,status,visibility,published_at,deleted_at,timezone,event_type,destination_text,cover_media_url,cover_media_type,cover_media_poster_url,cover_media_alt,cover_media_gallery,is_multi_date,rsvp_capacity,rsvp_waitlist_enabled,rsvp_approval_mode,bookings_closed,booking_deadline,brands!inner(name,slug,deleted_at)")
      .eq("event_type", expectedType).limit(1);
    query = id ? query.eq("id", id) : query.eq("slug", eventSlug).eq("brands.slug", brandSlug);
    const { data: row, error: rowError } = await query.maybeSingle();
    if (rowError) throw new Error("db_error");
    if (!row || row.deleted_at || (Array.isArray(row.brands) ? row.brands[0]?.deleted_at : row.brands?.deleted_at)) throw new Error("gone");
    if (!["public", "discover"].includes(row.visibility) || !row.published_at || !["scheduled", "live", "ended", "cancelled"].includes(row.status)) throw new Error("not_public");
    const [datesResult, ticketsResult, remainingResult, allInResult, rsvpResult] = await Promise.all([
      db.from("event_dates").select("start_at,end_at,timezone,is_master").eq("event_id", row.id).order("start_at", { ascending: true }),
      db.from("ticket_types").select("id,price_cents,currency,is_free,is_hidden,is_disabled,available_online,is_unlimited,sale_start_at,sale_end_at,display_order").eq("event_id", row.id).is("deleted_at", null).order("display_order", { ascending: true }),
      db.rpc("pg_public_ticket_types_remaining", { p_event_id: row.id }),
      db.rpc("pg_public_event_tier_allin", { p_event_id: row.id }),
      expectedType === "rsvp"
        ? db.from("event_rsvps").select("id,plus_count").eq("event_id", row.id).eq("rsvp_status", "going").eq("approval_status", "approved")
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (datesResult.error || ticketsResult.error || remainingResult.error || allInResult.error || rsvpResult.error) throw new Error("db_error");
    const dates = datesResult.data || [];
    const allInById=new Map<string,RecordLike>((allInResult.data||[]).map((item:RecordLike)=>[String(item.ticket_type_id),item] as [string,RecordLike]));
    const tickets = (ticketsResult.data || []).map((ticket:RecordLike)=>{
      const canonical=allInById.get(String(ticket.id));
      const canonicalAllIn=canonical?.all_in_cents;
      return {...ticket,
        all_in_cents:Number.isSafeInteger(canonicalAllIn)&&Number(canonicalAllIn)>=0?canonicalAllIn:undefined,
        display_currency:/^[A-Za-z]{3}$/.test(clean(canonical?.currency,3))?clean(canonical?.currency,3):undefined};
    });
    const relevantDates = relevantDatesAt(dates); const firstDate = relevantDates[0]; const lastDate = relevantDates[relevantDates.length - 1];
    const firstSchedule = localSchedule(firstDate?.start_at, row.timezone || firstDate?.timezone);
    const lastSchedule = localSchedule(lastDate?.start_at, row.timezone || lastDate?.timezone);
    const ticketTruth = ticketTruthAt(tickets, remainingResult.data || []);
    const rsvpGoing = (rsvpResult.data || []).reduce((sum: number, item: RecordLike) => sum + 1 + (Number.isInteger(item.plus_count) ? item.plus_count : 0), 0);
    const rsvpFull = expectedType === "rsvp" && Number.isInteger(row.rsvp_capacity) && rsvpGoing >= row.rsvp_capacity;
    const assembled = { row, date: firstDate, tickets, relevantDates, ...ticketTruth,
      rsvpClosed: rsvpFull && row.rsvp_waitlist_enabled !== true && row.rsvp_approval_mode !== "manual",
      availability: expectedType === "rsvp" && rsvpFull && row.rsvp_waitlist_enabled === true ? "Waitlist available" : ticketTruth.availability,
      actionEligible: Boolean(firstDate) && !(expectedType === "trip" && (row.bookings_closed === true
        || (typeof row.booking_deadline === "string" && Date.parse(row.booking_deadline) <= Date.now()))) && (expectedType === "rsvp"
        ? !(rsvpFull && row.rsvp_waitlist_enabled !== true && row.rsvp_approval_mode !== "manual")
        : ticketTruth.eligibleTickets.length > 0),
      dateRange: [firstSchedule.localDate, lastSchedule.localDate !== firstSchedule.localDate ? lastSchedule.localDate : ""].filter(Boolean).join(" – "),
      duration: durationLabel(firstDate?.start_at, firstDate?.end_at) };
    return { ...mapAuthoritativeShareFacts(kind, assembled), sourceKey: `${kind}:${row.id}`, sourceReference: { eventId: row.id } };
  }

  if (kind === "venue") {
    const venueId = sourceId(identity, "venueId"); const brandSlug = sourceId(identity, "brandSlug"); const venueSlug = sourceId(identity, "venueSlug");
    if (!venueId && (!brandSlug || !venueSlug)) throw new Error("validation");
    let query = db.from("venue_public_view").select("id,brand_slug,slug,name,city,venue_category,pitch,cover_media_url,cover_media_type,cover_media_poster_url,pool_photo_urls,hours,iana_timezone");
    query = venueId ? query.eq("id", venueId) : query.eq("brand_slug", brandSlug).eq("slug", venueSlug);
    const { data: row, error } = await query.maybeSingle();
    if (error) throw new Error("db_error");
    if (!row) throw new Error("not_public");
    return { ...mapAuthoritativeShareFacts(kind, { row }), sourceKey: `venue:${row.id}`, sourceReference: { venueId: row.id, brandSlug: row.brand_slug, venueSlug: row.slug } };
  }

  const brandId = sourceId(identity, "brandId"); const brandSlug = sourceId(identity, "brandSlug");
  if (!brandId && !brandSlug) throw new Error("validation");
  let brandQuery = db.from("brands").select("id,name,slug,description,cover_media_url,cover_media_type,cover_media_poster_url,profile_photo_url,venue_category,city,deleted_at");
  brandQuery = brandId ? brandQuery.eq("id", brandId) : brandQuery.eq("slug", brandSlug);
  const { data: row, error: rowError } = await brandQuery.maybeSingle();
  if (rowError) throw new Error("db_error");
  if (!row || row.deleted_at) throw new Error("gone");
  const { data: offerings, error: offeringsError } = await db.from("business_public_events_view").select("title,event_type,brand_slug,slug,master_start_at").eq("brand_slug", row.slug).gte("master_start_at", new Date().toISOString()).order("master_start_at", { ascending: true }).limit(8);
  if (offeringsError) throw new Error("db_error");
  const { count, error: countError } = await db.from("events").select("id", { count: "exact", head: true }).eq("brand_id", row.id)
    .in("visibility", ["public", "discover"]).not("published_at", "is", null).is("deleted_at", null).in("status", ["scheduled", "live"]);
  if (countError) throw new Error("db_error");
  return { ...mapAuthoritativeShareFacts("brand", { row, upcomingCount: count || 0, offerings: offerings || [] }), sourceKey: `brand:${row.id}`, sourceReference: { brandId: row.id, brandSlug: row.slug } };
}
