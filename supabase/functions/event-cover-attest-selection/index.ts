// Issue #1972 — trusted cover-picker attestation.
// The client cannot mint a "verified" cover selection directly. This Edge
// boundary authenticates the user, verifies provider-owned media against the
// provider API (or uploaded storage in SQL), then creates the short-lived
// selection with the service-only canonical RPC.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";

type SelectionBody = {
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
