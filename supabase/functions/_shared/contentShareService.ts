import { isPublicShareMediaHost, loadAuthoritativeContentShare, type ContentShareKind } from "./contentShare.ts";

const clean = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const PUBLIC_SERVER_KINDS = new Set<ContentShareKind>(["event", "rsvp_event", "trip", "experience", "venue", "brand"]);
const PUBLIC_IDENTITY_KEYS: Record<string, string[]> = {
  event: ["brandSlug", "eventSlug"], rsvp_event: ["brandSlug", "eventSlug"],
  trip: ["brandSlug", "eventSlug"], experience: ["brandSlug", "eventSlug"],
  venue: ["brandSlug", "venueSlug"], brand: ["brandSlug"],
};

function isExactPublicIdentity(kind: string, identity: Record<string, unknown>): boolean {
  const expected = PUBLIC_IDENTITY_KEYS[kind];
  if (!expected || Object.keys(identity).sort().join("|") !== [...expected].sort().join("|")) return false;
  return expected.every((key) => clean(identity[key], 256).length > 0 && clean(identity[key], 256) === identity[key]);
}

function planningPreference(value: unknown): string | null {
  if (typeof value === "string") return clean(value, 80) || null;
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const day = clean(row.dayOfWeek, 24).toLowerCase();
  const time = clean(row.timeOfDay, 24).toLowerCase();
  const timeframe = clean(row.planningTimeframe, 40).toLowerCase();
  const text = `${day === "weekend" ? "one " : ""}${[day, time, timeframe].filter(Boolean).join(" ")}`;
  return clean(text, 80) || null;
}

const SHARE_KINDS = ["place", "curated", "event", "rsvp_event", "trip", "experience", "venue", "brand"] as const;
const SHARE_STATUSES = new Set(["sold_out", "ended", "cancelled", "rsvp_closed", "date_tbd", "dates_tbd"]);
const WEEKDAYS = new Set(["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]);
const FACT_FIELDS: Record<string, string[]> = {
  place: ["category", "area", "rating", "priceLevel", "hours", "description"],
  curated: ["stopCount", "area", "duration", "estimate", "description"],
  event: ["localDate", "localTime", "venue", "area", "price", "availability", "description"],
  rsvp_event: ["localDate", "localTime", "venue", "rsvpDeadline", "availability", "description"],
  trip: ["destination", "dateRange", "duration", "startingPrice", "description"],
  experience: ["area", "nextDate", "duration", "price", "availability", "description"],
  venue: ["category", "area", "nextPublicOffering", "hours", "description"],
  brand: ["category", "area", "upcomingPublicOfferingCount", "description"],
};
const object = (value: unknown): Record<string, any> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
const exactKeys = (value: Record<string, any>, allowed: string[]): boolean => Object.keys(value).every((key) => allowed.includes(key));
const bounded = (value: unknown, max: number, required = false): boolean => typeof value === "string" && value.length <= max && value === value.trim() && (!required || value.length > 0);
const httpsUrl = (value: unknown): boolean => {
  if (!bounded(value, 2048, true)) return false;
  try { const parsed = new URL(value as string); return parsed.protocol === "https:" && !parsed.username && !parsed.password; } catch { return false; }
};
// #2589 — this used to be a hand-copied sibling of the mapper's allowlist, and
// the two had already drifted (the mapper allowed `videos.pexels.com`; this copy
// did not, so the edge could persist a poster its own validator would reject).
// The host verdict now has exactly one definition on this side of the wire. The
// `bounded`/`httpsUrl` strictness stays here on purpose: this is the fail-closed
// envelope validator and it must not accept a value that only becomes valid
// after normalisation.
const mediaUrl = (value: unknown): boolean => {
  if (!httpsUrl(value)) return false;
  return isPublicShareMediaHost(new URL(value as string));
};
const isoInstant = (value: unknown): boolean => bounded(value, 40, true) && Number.isFinite(Date.parse(value as string));
const ianaTimezone=(value:unknown):boolean=>{if(!bounded(value,80,true))return false;try{new Intl.DateTimeFormat("en-US",{timeZone:value as string}).format(0);return true}catch{return false}};
const shareTimezone=(value:unknown):boolean=>ianaTimezone(value)||(/^UTC_OFFSET:([+-]?\d{1,4})$/.test(String(value))&&(()=>{const offset=Number(String(value).slice(11));return Number.isInteger(offset)&&offset>=-840&&offset<=840})());
const slug=(value:unknown):boolean=>bounded(value,160,true)&&/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value as string);
const money = (value: unknown): boolean => {
  const row = object(value); return !!row && exactKeys(row, ["minorUnits", "currency", "disclosure"])
    && Number.isSafeInteger(row.minorUnits) && row.minorUnits >= 0 && /^[A-Z]{3}$/.test(row.currency)
    && (row.disclosure === undefined || bounded(row.disclosure, 24, true));
};
const media = (value: unknown): boolean => {
  if (value === null) return true;
  const row = object(value); if (!row || !exactKeys(row, ["kind", "url", "posterUrl", "alt", "focalPoint"]) || !["photo", "gif", "video"].includes(row.kind)
    || !mediaUrl(row.url) || !mediaUrl(row.posterUrl) || (row.alt !== undefined && !bounded(row.alt, 240, true))) return false;
  if (row.focalPoint !== undefined) { const point = object(row.focalPoint); if (!point || !exactKeys(point, ["x", "y"]) || ![point.x, point.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return false; }
  return true;
};
const destination = (kind: string, value: unknown): boolean => {
  const row = object(value); if (!row || row.kind !== kind) return false;
  const keys: Record<string, string[]> = { place:["kind","placeId"], curated:["kind"], event:["kind","brandSlug","eventSlug","webPath"], rsvp_event:["kind","brandSlug","eventSlug","webPath"], trip:["kind","brandSlug","eventSlug","webPath"], experience:["kind","brandSlug","eventSlug","webPath"], venue:["kind","brandSlug","venueSlug","webPath"], brand:["kind","brandSlug","webPath"] };
  if (!exactKeys(row, keys[kind] || [])) return false;
  return Object.entries(row).every(([key, item]) => key === "kind" || (bounded(item, key === "webPath" ? 512 : 256, true) && (key !== "webPath" || /^\/[A-Za-z0-9_~!$&'()*+,;=:@%./-]+$/.test(item))));
};
const factRoute = (kind: string, value: unknown): boolean => {
  const row=object(value); if(!row) return false;
  const required:Record<string,string[]>={place:["placeId"],curated:[],event:["eventSlug"],rsvp_event:["eventSlug"],trip:["eventSlug"],experience:["eventSlug"],venue:["brandSlug","venueSlug"],brand:["brandSlug"]};
  const keys=required[kind]; return !!keys && exactKeys(row,keys) && keys.every((key)=>bounded(row[key],256,true));
};
const hours = (value: unknown): boolean => Array.isArray(value) && value.length === 7 && new Set(value.map((item)=>object(item)?.day)).size===7 && value.every((item) => {
  const row = object(item); return !!row && exactKeys(row, ["day","label","isToday","special"]) && bounded(row.day, 12, true) && bounded(row.label, 80, true)
    && WEEKDAYS.has(row.day)
    && (row.isToday === undefined || row.isToday === true) && (row.special === undefined || bounded(row.special, 120, true));
});
const facts = (value: unknown): value is Record<string, any> => {
  const row = object(value); const kind = row?.kind;
  if (!row || !SHARE_KINDS.includes(kind) || row.schemaVersion !== 1 || !bounded(row.title, 160, true)) return false;
  if (!exactKeys(row, ["schemaVersion","kind","title","status","timezone","media","route",...(FACT_FIELDS[kind] || [])])) return false;
  if (row.status !== undefined && !SHARE_STATUSES.has(row.status)) return false;
  if (row.timezone !== undefined && !shareTimezone(row.timezone)) return false;
  if (row.media !== undefined && !media(row.media)) return false;
  if (row.route !== undefined && !factRoute(kind, row.route)) return false;
  for (const [key, item] of Object.entries(row)) {
    if (["schemaVersion","kind","title","status","timezone","media","route"].includes(key)) continue;
    if (["rating"].includes(key) && !(Number.isFinite(item) && item >= 0 && item <= 5)) return false;
    else if (["stopCount","upcomingPublicOfferingCount"].includes(key) && !(Number.isSafeInteger(item) && item >= 0)) return false;
    else if (["price","startingPrice"].includes(key) && !money(item)) return false;
    else if (key === "hours" && !hours(item)) return false;
    else if (!["rating","stopCount","upcomingPublicOfferingCount","price","startingPrice","hours"].includes(key) && !bounded(item, key === "description" ? 600 : 160, true)) return false;
  }
  return true;
};
const publicDetails = (kind: string, value: unknown): boolean => {
  const row = object(value); if (!row || row.kind !== kind) return false;
  if (kind === "place") return exactKeys(row, ["kind","description","address","directionsUrl","phone","website","utcOffsetMinutes"])
    && (row.description === undefined || bounded(row.description,600,true)) && (row.address === undefined || bounded(row.address,180,true))
    && (row.directionsUrl === undefined || httpsUrl(row.directionsUrl)) && (row.website === undefined || httpsUrl(row.website))
    && (row.phone === undefined || (bounded(row.phone,40,true) && /^[+0-9(). -]+$/.test(row.phone) && row.phone.replace(/\D/g,"").length>=7 && row.phone.replace(/\D/g,"").length<=15))
    && (row.utcOffsetMinutes === undefined || (Number.isInteger(row.utcOffsetMinutes) && row.utcOffsetMinutes >= -840 && row.utcOffsetMinutes <= 840));
  if (kind === "curated") return exactKeys(row, ["kind","estimate","stops"]) && (row.estimate === undefined || bounded(row.estimate,80,true))
    && Array.isArray(row.stops) && row.stops.length <= 24 && row.stops.every((item: unknown) => { const stop=object(item); return !!stop
      && exactKeys(stop,["title","category","area","address","description","imageUrl"]) && bounded(stop.title,160,true)
      && (stop.category===undefined||bounded(stop.category,80,true)) && (stop.area===undefined||bounded(stop.area,120,true))
      && (stop.address===undefined||bounded(stop.address,180,true)) && (stop.description===undefined||bounded(stop.description,300,true))
      && (stop.imageUrl===undefined||mediaUrl(stop.imageUrl)); });
  if (["event","rsvp_event","trip","experience"].includes(kind)) return exactKeys(row,["kind","actionEligible","occurrences"])
    && typeof row.actionEligible === "boolean" && Array.isArray(row.occurrences) && row.occurrences.length <= 24 && row.occurrences.every((item:unknown)=>{ const occurrence=object(item); return !!occurrence
      && exactKeys(occurrence,["startAt","endAt","timezone"]) && isoInstant(occurrence.startAt) && (occurrence.endAt===undefined||(isoInstant(occurrence.endAt)&&Date.parse(occurrence.endAt)>=Date.parse(occurrence.startAt)))
      && (occurrence.timezone===undefined||ianaTimezone(occurrence.timezone)); });
  if (["venue","brand"].includes(kind)) return exactKeys(row,["kind","offerings"]) && Array.isArray(row.offerings) && row.offerings.length <= 8
    && row.offerings.every((item:unknown)=>{ const offering=object(item); return !!offering && exactKeys(offering,["title","kind","brandSlug","eventSlug","startAt"])
      && bounded(offering.title,160,true) && ["event","rsvp","rsvp_event","trip","experience"].includes(offering.kind) && slug(offering.brandSlug)
      && slug(offering.eventSlug) && isoInstant(offering.startAt); });
  return false;
};

/** Fail-closed validation for both freshly mapped and immutable historical public envelopes. */
export function validatePublicContentShareEnvelope(value: unknown): Record<string, any> | null {
  const row=object(value); if(!row || !exactKeys(row,["state","gone","shortCode","version","facts","media","destination","publicDetails"]) || row.state!=="active" || row.gone!==false
    || !/^[0-9A-Za-z]{16}$/.test(row.shortCode) || !Number.isSafeInteger(row.version) || row.version<1 || !facts(row.facts) || !media(row.media)
    || !destination(row.facts.kind,row.destination) || !publicDetails(row.facts.kind,row.publicDetails)) return null;
  if(row.facts.media!==undefined && JSON.stringify(row.facts.media)!==JSON.stringify(row.media)) return null;
  return row;
}

function publicEnvelope(shortCode: string, version: number, mapped: any) {
  const manifest = mapped.destinationManifest && typeof mapped.destinationManifest === "object" ? mapped.destinationManifest : {};
  const { publicDetails = { kind: mapped.facts.kind }, ...destination } = manifest;
  return { state:"active", gone:false, shortCode, version, facts:mapped.facts, media:mapped.mediaIdentity || null, destination, publicDetails };
}

function contentShareMessageEnvelopeFits(kind: string, mapped: any): boolean {
  const destination = mapped.destinationManifest && typeof mapped.destinationManifest === "object"
    ? Object.fromEntries(Object.entries(mapped.destinationManifest).filter(([key]) => key !== "publicDetails")) : {};
  const payload: Record<string, unknown> = {
    contract:"content_share_card_v1",id:"content-share:Aa0Bb1Cc2Dd3Ee4F:v999999",title:mapped.facts?.title,
    category:kind,image:mapped.mediaIdentity ? "https://usemingla.com/og/s/Aa0Bb1Cc2Dd3Ee4F/v999999-r2.jpg" : null,
    shareCode:"Aa0Bb1Cc2Dd3Ee4F",shareVersion:999999,kind,facts:mapped.facts,destination,media:mapped.mediaIdentity,
    // 120 accepted multi-codepoint graphemes, reserving realistic worst-case
    // room before an internal recipient adds an authored note.
    senderNote:"👩🏽‍💻".repeat(120),
  };
  if (mapped.nativePreview) payload.nativeCard={contract:"native_content_card_v1",version:1,kind,
    preview:mapped.nativePreview,snapshotRef:"Aa0Bb1Cc2Dd3Ee4F:v999999",snapshotFingerprint:"a".repeat(64)};
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength<=5120;
}

async function privateInstallAttributionForCreator(db: any, creatorPrincipal: unknown) {
  if (typeof creatorPrincipal !== "string" || creatorPrincipal.length === 0) return undefined;
  const { data, error } = await db.from("profiles").select("referral_code").eq("id", creatorPrincipal).maybeSingle();
  if (error) throw new Error("db_error");
  const referralCode = clean(data?.referral_code, 64);
  return /^[0-9A-Za-z][0-9A-Za-z-]{0,63}$/.test(referralCode) ? { referralCode } : undefined;
}

export async function createContentShareV1(
  db: any, userId: string | null, raw: Record<string, unknown>, options: { serverCreated?: boolean } = {},
) {
  const requestedKind = typeof raw.kind === "string" ? raw.kind : "";
  const allowedKinds = new Set<ContentShareKind>([
    "place", "curated", "event", "rsvp_event", "trip", "experience", "venue", "brand",
  ]);
  if (!allowedKinds.has(requestedKind as ContentShareKind)) return { status: 400, body: { error: "validation" } };
  const identity = raw.identity && typeof raw.identity === "object" && !Array.isArray(raw.identity)
    ? raw.identity as Record<string, unknown> : {};
  const serverCreated = options.serverCreated === true;
  if (serverCreated && (!PUBLIC_SERVER_KINDS.has(requestedKind as ContentShareKind) || !isExactPublicIdentity(requestedKind, identity))) {
    return { status: 400, body: { error: "validation" } };
  }
  if (!serverCreated && !userId) return { status: 401, body: { error: "unauthorized" } };
  const rawAttribution = raw.attribution && typeof raw.attribution === "object" && !Array.isArray(raw.attribution)
    ? raw.attribution as Record<string, unknown> : {};
  // The opaque shortCode is the attribution handle. Raw referral codes are
  // neither trusted nor persisted for content shares.
  const attribution=Object.fromEntries([["channel",clean(rawAttribution.channel,40)]].filter(([,value])=>value));
  let mapped;
  try {
    mapped = await loadAuthoritativeContentShare(db, userId || "", requestedKind as ContentShareKind, identity);
  } catch (mappingError) {
    const reason = mappingError instanceof Error ? mappingError.message : "not_found";
    if (reason === "db_error") return { status: 503, body: { error: "unavailable" } };
    const invalid = ["validation", "invalid_native_snapshot", "native_snapshot_too_large"].includes(reason);
    return { status: invalid ? 400 : 404, body: { error: invalid ? "validation" : "not_found" } };
  }
  if (!validatePublicContentShareEnvelope(publicEnvelope("Aa0Bb1Cc2Dd3Ee4F", 1, mapped))) {
    return { status: 503, body: { error: "unavailable" } };
  }
  if (!contentShareMessageEnvelopeFits(requestedKind, mapped)) return { status: 503, body: { error: "unavailable" } };
  const native = requestedKind === "place" || requestedKind === "curated";
  const nativeSnapshot = native && "nativeSnapshot" in mapped ? mapped.nativeSnapshot : undefined;
  const nativePreview = native && "nativePreview" in mapped ? mapped.nativePreview : undefined;
  const versionArgs = {
    p_entity_kind: requestedKind,
    p_creator_principal: serverCreated ? null : userId,
    p_source_key: mapped.sourceKey,
    p_source_reference: serverCreated ? { ...mapped.sourceReference, serverCreated: true } : mapped.sourceReference,
    p_attribution: attribution,
    p_facts: mapped.facts,
    p_media_identity: mapped.mediaIdentity || null,
    p_destination_manifest: mapped.destinationManifest,
  };
  const { data: created, error } = native
    ? await db.rpc("upsert_content_share_version_with_native_snapshot", {
      ...versionArgs,
      p_native_snapshot: nativeSnapshot,
      p_native_preview: nativePreview,
    })
    : await db.rpc("upsert_content_share_version", versionArgs);
  if (error || !created?.shortCode) throw error || new Error("share_create_failed");
  const rawMessageContext = raw.messageContext && typeof raw.messageContext === "object" && !Array.isArray(raw.messageContext)
    ? raw.messageContext as Record<string, unknown> : {};
  const { data: message, error: messageError } = await db.rpc("resolve_content_share_message", {
    p_code: created.shortCode,
    p_version: created.version,
    p_planning_preference: planningPreference(rawMessageContext.planningPreference),
  });
  if (messageError || typeof message !== "string" || message.length === 0) {
    throw messageError || new Error("share_message_unavailable");
  }
  const envelope=validatePublicContentShareEnvelope(publicEnvelope(created.shortCode,created.version,mapped));
  if(!envelope) return { status:503, body:{ error:"unavailable" } };
  return {
    status: created.versionCreated ? 201 : 200,
    body: {
      shortCode: created.shortCode, version: created.version,
      versionCreated: created.versionCreated,
      message,
      facts: envelope.facts, media: envelope.media,
      destination: envelope.destination, publicDetails: envelope.publicDetails,
    },
  };
}

/** Revalidates current source truth at the served boundary. Exact historical
 * version reads deliberately do not call this function. */
export async function refreshContentShareV1(db: any, shortCode: string) {
  const { data: link, error: linkError } = await db.from("content_share_links")
    .select("id,short_code,entity_kind,creator_principal,source_key,source_reference,attribution,state,expires_at,revoked_at,deleted_at")
    .eq("short_code", shortCode).maybeSingle();
  if (linkError) return { status: 503, body: { error: "unavailable" } };
  if (!link) return { status: 404, body: { error: "not_found" } };
  if (["revoked", "deleted"].includes(link.state) || link.revoked_at || link.deleted_at
    || (link.expires_at && Date.parse(link.expires_at) <= Date.now())) return { status: 410, body: { error: "gone" } };

  // Legacy aliases are intentionally frozen: the source row may expire, while
  // its durable aliased public version remains stable and lossless.
  if (typeof link.source_key === "string" && link.source_key.startsWith("legacy_snapshot:")) {
    const { data, error } = await db.rpc("resolve_content_share_code", { p_code: shortCode });
    if (error) return { status: 503, body: { error: "unavailable" } };
    if (!data) return { status: 404, body: { error: "not_found" } };
    if (!validatePublicContentShareEnvelope(data)) return { status:503, body:{ error:"unavailable" } };
    try {
      const privateInstallAttribution = await privateInstallAttributionForCreator(db, link.creator_principal);
      return { status:200, body:{ contentShare:data, ...(privateInstallAttribution ? { privateInstallAttribution } : {}) } };
    } catch { return { status:503, body:{ error:"unavailable" } }; }
  }

  let mapped;
  try {
    mapped = await loadAuthoritativeContentShare(
      db, link.creator_principal || "", link.entity_kind as ContentShareKind,
      link.source_reference && typeof link.source_reference === "object" ? link.source_reference : {},
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "db_error";
    if (reason === "db_error") return { status: 503, body: { error: "unavailable" } };
    if (reason === "invalid_native_snapshot" || reason === "native_snapshot_too_large") return { status: 503, body: { error: "unavailable" } };
    if (reason === "not_public") return { status: 404, body: { error: "not_found" } };
    if (reason === "gone") {
      const { error: stateError } = await db.from("content_share_links").update({ state: "deleted", deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", link.id);
      return stateError ? { status: 503, body: { error: "unavailable" } } : { status: 410, body: { error: "gone" } };
    }
    return { status: 404, body: { error: "not_found" } };
  }
  const native = link.entity_kind === "place" || link.entity_kind === "curated";
  if (!contentShareMessageEnvelopeFits(link.entity_kind, mapped)) return { status:503,body:{error:"unavailable"} };
  const nativeSnapshot = native && "nativeSnapshot" in mapped ? mapped.nativeSnapshot : undefined;
  const nativePreview = native && "nativePreview" in mapped ? mapped.nativePreview : undefined;
  const versionArgs = {
    p_entity_kind: link.entity_kind,
    p_creator_principal: link.creator_principal,
    p_source_key: mapped.sourceKey,
    p_source_reference: link.source_reference,
    p_attribution: link.attribution || {},
    p_facts: mapped.facts,
    p_media_identity: mapped.mediaIdentity || null,
    p_destination_manifest: mapped.destinationManifest,
  };
  const { data: created, error: upsertError } = native
    ? await db.rpc("upsert_content_share_version_with_native_snapshot", {
      ...versionArgs,
      p_native_snapshot: nativeSnapshot,
      p_native_preview: nativePreview,
    })
    : await db.rpc("upsert_content_share_version", versionArgs);
  if (upsertError || !created?.shortCode || created.shortCode !== shortCode) return { status: 503, body: { error: "unavailable" } };
  const envelope=validatePublicContentShareEnvelope(publicEnvelope(shortCode,created.version,mapped));
  if (!envelope) return { status:503, body:{ error:"unavailable" } };
  try {
    const privateInstallAttribution = await privateInstallAttributionForCreator(db, link.creator_principal);
    return { status:200,body:{contentShare:envelope,...(privateInstallAttribution?{privateInstallAttribution}:{})} };
  } catch { return { status:503, body:{ error:"unavailable" } }; }
}
