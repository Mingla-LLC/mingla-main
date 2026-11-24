// Issue #1972 — trusted cover-picker attestation.
// The client cannot mint a "verified" cover selection directly. This Edge
// boundary authenticates the user, verifies provider-owned media against the
// provider API (or uploaded storage in SQL), then creates the short-lived
// selection with the service-only canonical RPC.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";

type SelectionBody = {
  action?: unknown;
  venue_id?: unknown;
  event_id?: unknown;
  selection_ref?: unknown;
  url?: unknown;
  type?: unknown;
  poster_url?: unknown;
  provider?: unknown;
  source_url?: unknown;
  credit?: unknown;
  credit_url?: unknown;
  alt?: unknown;
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const extractGiphyId = (mediaUrl: string, sourceUrl: string): string | null => {
  const media = mediaUrl.match(/\/media\/([A-Za-z0-9]+)\//)?.[1];
  if (media) return media;
  return sourceUrl.match(/-([A-Za-z0-9]+)(?:\/|$)/)?.[1] ?? null;
};

const extractPexelsId = (sourceUrl: string): string | null =>
  sourceUrl.match(/-(\d+)\/?(?:\?.*)?$/)?.[1] ??
    sourceUrl.match(/\/photo\/(\d+)\/?/)?.[1] ?? null;

type VerifiedProviderMetadata = {
  sourceUrl: string | null;
  credit: string | null;
  creditUrl: string | null;
  alt: string | null;
};

const verifiedProviderSelection = async (
  body:
    & Required<
      Pick<SelectionBody, "url" | "poster_url" | "provider" | "source_url">
    >
    & Pick<SelectionBody, "credit" | "credit_url" | "alt">,
): Promise<VerifiedProviderMetadata | null> => {
  const mediaUrl = asString(body.url);
  const posterUrl = asString(body.poster_url);
  const provider = asString(body.provider);
  const sourceUrl = asString(body.source_url);
  if (!mediaUrl || !posterUrl || !provider) return null;
  if (provider === "upload") {
    // SQL proves the storage object/job. Uploaded-media description and credit
    // are organizer-authored rather than provider claims, so they may be kept
    // only after that server-side storage proof.
    return {
      sourceUrl,
      credit: asString(body.credit),
      creditUrl: asString(body.credit_url),
      alt: asString(body.alt),
    };
  }
  if (!sourceUrl) return null;

  if (provider === "pexels") {
    const id = extractPexelsId(sourceUrl);
    const key = Deno.env.get("PEXELS_API_KEY");
    if (!id || !key) return null;
    const response = await fetch(`https://api.pexels.com/v1/photos/${id}`, {
      headers: { Authorization: key },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const photo = await response.json() as {
      url?: unknown;
      src?: Record<string, unknown>;
      photographer?: unknown;
      photographer_url?: unknown;
      alt?: unknown;
    };
    const providerUrls = Object.values(photo.src ?? {}).filter((value) =>
      typeof value === "string"
    );
    if (
      photo.url !== sourceUrl || !providerUrls.includes(mediaUrl) ||
      posterUrl !== mediaUrl
    ) return null;
    return {
      sourceUrl: asString(photo.url),
      credit: asString(photo.photographer),
      creditUrl: asString(photo.photographer_url),
      alt: asString(photo.alt),
    };
  }

  if (provider === "giphy") {
    const id = extractGiphyId(mediaUrl, sourceUrl);
    const key = Deno.env.get("GIPHY_API_KEY") ??
      Deno.env.get("EXPO_PUBLIC_GIPHY_API_KEY") ??
      Deno.env.get("EXPO_PUBLIC_GIPHY_KEY");
    if (!id || !key) return null;
    const response = await fetch(
      `https://api.giphy.com/v1/gifs/${encodeURIComponent(id)}?api_key=${
        encodeURIComponent(key)
      }`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) return null;
    const payload = await response.json() as {
      data?: {
        url?: unknown;
        title?: unknown;
        username?: unknown;
        user?: { display_name?: unknown; profile_url?: unknown };
        images?: Record<string, { url?: unknown }>;
      };
    };
    const images = Object.values(payload.data?.images ?? {})
      .map((image) => image?.url)
      .filter((value): value is string => typeof value === "string");
    if (
      payload.data?.url !== sourceUrl || !images.includes(mediaUrl) ||
      !images.includes(posterUrl)
    ) return null;
    return {
      sourceUrl: asString(payload.data.url),
      credit: asString(payload.data.user?.display_name) ??
        asString(payload.data.username),
      creditUrl: asString(payload.data.user?.profile_url) ??
        asString(payload.data.url),
      alt: asString(payload.data.title),
    };
  }
  return null;
};

// ---------------------------------------------------------------------------
// #4490 07-A/L — copy_venue_cover: use the venue's cover for an event there.
// The copy belongs to the event (a venue cover's object is deleted when the
// host removes it), so an image/GIF is copied into event_covers/<brand>/<event>/
// and then applied through the normal upload path. A video cover is returned
// as-is: the 294490 widening of assert_event_cover_selection_source accepts the
// linked venue's current, ready video.
// ---------------------------------------------------------------------------

type CoverRow = {
  cover_media_url: string | null;
  cover_media_type: string | null;
  cover_media_poster_url: string | null;
};

const PUBLIC_MARK = "/storage/v1/object/public/";

/** "…/storage/v1/object/public/<bucket>/<path>" → { bucket, path }, else null. */
export const storageObjectOf = (
  url: string | null,
): { bucket: string; path: string } | null => {
  if (url === null) return null;
  const at = url.indexOf(PUBLIC_MARK);
  if (at < 0) return null;
  const rest = url.slice(at + PUBLIC_MARK.length).split("?")[0];
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const path = decodeURIComponent(rest.slice(slash + 1));
  if (path.length === 0 || path.includes("..")) return null;
  return { bucket: rest.slice(0, slash), path };
};

/** The checks before any copy: who, which event, which venue. Pure for tests. */
export const venueCoverRefusal = (input: {
  rank: number;
  managerRank: number;
  event: {
    brand_id: string | null;
    venue_id: string | null;
    event_type: string | null;
    deleted_at: string | null;
  } | null;
  venue: ({ brand_id: string | null } & CoverRow) | null;
  venueId: string;
}): string | null => {
  if (input.event === null || input.event.deleted_at !== null) {
    return "event_not_found";
  }
  if (input.rank < input.managerRank) return "not_authorized";
  if (input.venue === null || input.venue.brand_id !== input.event.brand_id) {
    return "venue_not_found";
  }
  if (input.event.venue_id !== input.venueId) return "event_not_at_venue";
  if (
    input.venue.cover_media_url === null ||
    !["image", "gif", "video"].includes(input.venue.cover_media_type ?? "")
  ) {
    return "venue_has_no_cover";
  }
  // N122 (P0): the copy runs with the service role, and a venue cover URL is
  // host-supplied text. Only the brand's own venue cover objects
  // (brand_covers/<event brand>/...) may ever be copied: the cover and, for a
  // GIF, its poster. Anything else (a private bucket, another brand's folder)
  // is refused before any download. A video is never copied (returned as is,
  // and the SQL video branch checks it against a ready job of the brand).
  if (input.venue.cover_media_type !== "video") {
    const owned = (url: string | null): boolean => {
      const o = storageObjectOf(url);
      return o !== null && o.bucket === "brand_covers" &&
        input.event !== null &&
        input.event.brand_id !== null &&
        o.path.startsWith(`${input.event.brand_id}/`);
    };
    if (!owned(input.venue.cover_media_url)) return "venue_cover_not_copyable";
    if (
      input.venue.cover_media_type === "gif" &&
      !owned(input.venue.cover_media_poster_url)
    ) {
      return "venue_cover_not_copyable";
    }
  }
  return null;
};

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

const copyObject = async (
  service: ServiceClient,
  publicBase: string,
  source: { bucket: string; path: string },
  target: string,
): Promise<string> => {
  const download = await service.storage.from(source.bucket).download(
    source.path,
  );
  if (download.error || !download.data) {
    throw new Error("venue_cover_download_failed");
  }
  const blob = download.data as Blob;
  const upload = await service.storage.from("event_covers").upload(
    target,
    blob,
    {
      contentType: blob.type || undefined,
      upsert: false,
    },
  );
  if (upload.error) throw new Error("venue_cover_upload_failed");
  return `${publicBase}${PUBLIC_MARK}event_covers/${target}`;
};

const extOf = (path: string, fallback: string): string => {
  const m = path.match(/\.([A-Za-z0-9]{2,5})$/);
  return m ? m[1].toLowerCase() : fallback;
};

const handleCopyVenueCover = async (
  service: ServiceClient,
  supabaseUrl: string,
  userId: string,
  body: SelectionBody,
): Promise<Response> => {
  const eventId = asString(body.event_id);
  const venueId = asString(body.venue_id);
  if (!eventId || !venueId) {
    return jsonResponse(400, { error: "cover_selection_invalid" });
  }
  const { data: event } = await service.from("events")
    .select("id, brand_id, venue_id, event_type, deleted_at")
    .eq("id", eventId).maybeSingle();
  const { data: venue } = await service.from("venue_listings")
    .select(
      "id, brand_id, cover_media_url, cover_media_type, cover_media_poster_url",
    )
    .eq("id", venueId).maybeSingle();
  let rank = 0;
  let managerRank = 1;
  if (event?.brand_id) {
    const [r1, r2] = await Promise.all([
      service.rpc("biz_brand_effective_rank", {
        p_brand_id: event.brand_id,
        p_user_id: userId,
      }),
      service.rpc("biz_role_rank", { p_role: "event_manager" }),
    ]);
    rank = typeof r1.data === "number" ? r1.data : 0;
    managerRank = typeof r2.data === "number"
      ? r2.data
      : Number.MAX_SAFE_INTEGER;
  }
  const refusal = venueCoverRefusal({
    rank,
    managerRank,
    event: event ?? null,
    venue: venue ?? null,
    venueId,
  });
  if (refusal !== null) {
    const status = refusal === "not_authorized"
      ? 403
      : refusal === "event_not_found" || refusal === "venue_not_found"
      ? 404
      : 409;
    return jsonResponse(status, { error: refusal });
  }
  const type = String(venue.cover_media_type);
  if (type === "video") {
    return jsonResponse(200, {
      url: venue.cover_media_url,
      type,
      poster_url: venue.cover_media_poster_url,
      provider: "upload",
    });
  }
  const media = storageObjectOf(venue.cover_media_url);
  if (media === null) {
    return jsonResponse(409, { error: "venue_cover_not_copyable" });
  }
  const stem = `${event.brand_id}/${eventId}/venue-${crypto.randomUUID()}`;
  // The copy's public URL uses the same public origin the venue cover was
  // served from (the edge's own SUPABASE_URL can be an internal address).
  const publicBase = String(venue.cover_media_url).slice(
    0,
    String(venue.cover_media_url).indexOf(PUBLIC_MARK),
  ) || supabaseUrl;
  try {
    const url = await copyObject(
      service,
      publicBase,
      media,
      `${stem}.${extOf(media.path, type === "gif" ? "gif" : "jpg")}`,
    );
    let posterUrl = url;
    if (type === "gif") {
      const poster = storageObjectOf(venue.cover_media_poster_url);
      if (poster === null) {
        return jsonResponse(409, { error: "venue_cover_not_copyable" });
      }
      posterUrl = await copyObject(
        service,
        publicBase,
        poster,
        `${stem}-poster.${extOf(poster.path, "jpg")}`,
      );
    }
    return jsonResponse(200, {
      url,
      type,
      poster_url: posterUrl,
      provider: "upload",
    });
  } catch (error) {
    console.error(
      "[event-cover-attest-selection] copy_venue_cover failed",
      error,
    );
    return jsonResponse(502, { error: "venue_cover_copy_failed" });
  }
};

export const handleEventCoverAttestSelection = async (
  req: Request,
): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return jsonResponse(401, { error: "auth_required" });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse(500, { error: "cover_attestation_unavailable" });
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser(
    token,
  );
  if (authError || !authData.user) {
    return jsonResponse(401, { error: "auth_required" });
  }

  let body: SelectionBody;
  try {
    body = await req.json() as SelectionBody;
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }
  if (body.action === "copy_venue_cover") {
    const service = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    return await handleCopyVenueCover(
      service,
      supabaseUrl,
      authData.user.id,
      body,
    );
  }
  const eventId = asString(body.event_id);
  const selectionRef = asString(body.selection_ref);
  const mediaUrl = asString(body.url);
  const mediaType = asString(body.type);
  const posterUrl = asString(body.poster_url);
  const provider = asString(body.provider) ?? "upload";
  if (!eventId || !selectionRef || !mediaUrl || !mediaType || !posterUrl) {
    return jsonResponse(400, { error: "cover_selection_invalid" });
  }
  let verifiedMetadata: VerifiedProviderMetadata;
  try {
    const verified = await verifiedProviderSelection({
      url: mediaUrl,
      poster_url: posterUrl,
      provider,
      source_url: body.source_url,
      credit: body.credit,
      credit_url: body.credit_url,
      alt: body.alt,
    });
    if (verified === null) {
      return jsonResponse(400, { error: "cover_selection_source_unverified" });
    }
    verifiedMetadata = verified;
  } catch {
    return jsonResponse(502, { error: "cover_provider_verification_failed" });
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await serviceClient.rpc(
    "business_register_event_cover_selection",
    {
      p_user_id: authData.user.id,
      p_event_id: eventId,
      p_selection_ref: selectionRef,
      p_url: mediaUrl,
      p_type: mediaType,
      p_poster_url: posterUrl,
      p_provider: provider,
      p_source_url: verifiedMetadata.sourceUrl,
      p_credit: verifiedMetadata.credit,
      p_credit_url: verifiedMetadata.creditUrl,
      p_alt: verifiedMetadata.alt,
    },
  );
  if (error) return jsonResponse(400, { error: error.message });
  return jsonResponse(200, { selection: data, metadata: verifiedMetadata });
};

if (import.meta.main) Deno.serve(handleEventCoverAttestSelection);
