/**
 * toward #3697 Wave 0a — first-party ad click capture for Sites runtimes.
 * Proxies click/UTM/mc_id to Core attribution-capture (no Sites edge deploy).
 * Production requires SITES_CORE_ANON_KEY in the Vercel project environment;
 * changing that environment still requires a new Sites deployment to take effect.
 * Fail-open: missing config or Core errors return soft JSON, never throw.
 */
import { NextResponse } from "next/server";
import { runtimeConfig } from "../../../lib/config";

const AD_CLICK_KEY = "mingla_ad_click_v1";

export async function POST(request: Request) {
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  ) {
    return NextResponse.json({ ok: false }, { status: 415 });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, soft_error: "invalid_body" });
  }
  const input = body as Record<string, unknown>;
  const consentState =
    input.consent_state === "granted" ||
      input.consent_state === "rejected" ||
      input.consent_state === "pending"
      ? input.consent_state
      : "pending";
  // Reject: do not create new touches; consent stamp is handled client-side via
  // a separate consent kind when a click_id already exists.
  if (consentState === "rejected" && typeof input.click_id !== "string") {
    return NextResponse.json({ ok: true, skipped: "rejected" });
  }

  let config: ReturnType<typeof runtimeConfig>;
  try {
    config = runtimeConfig();
  } catch {
    return NextResponse.json({ ok: false, soft_error: "config_unavailable" });
  }
  const anon = process.env.SITES_CORE_ANON_KEY;
  if (!anon) {
    return NextResponse.json({ ok: false, soft_error: "anon_unavailable" });
  }

  const kind = input.kind === "consent" ? "consent" : "touch";
  const payload: Record<string, unknown> = {
    kind,
    surface: "web",
    lane: "consumer",
    consent_state: consentState,
  };
  if (kind === "consent") {
    if (typeof input.click_id !== "string" || !input.click_id) {
      return NextResponse.json({ ok: false, soft_error: "click_id_required" });
    }
    payload.click_id = input.click_id;
  } else {
    payload.network = typeof input.network === "string" ? input.network : "other";
    payload.external_click_id =
      typeof input.external_click_id === "string"
        ? input.external_click_id
        : null;
    payload.mc_id = typeof input.mc_id === "string" ? input.mc_id : null;
    payload.af_c_id = typeof input.af_c_id === "string" ? input.af_c_id : null;
    payload.utm =
      input.utm && typeof input.utm === "object" && !Array.isArray(input.utm)
        ? input.utm
        : {};
    payload.dest = {
      page_type: "brand",
      brand_slug:
        typeof input.brand_slug === "string" ? input.brand_slug : undefined,
    };
  }

  try {
    const res = await fetch(
      `${config.coreBaseUrl}/functions/v1/attribution-capture`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${anon}`,
          apikey: anon,
        },
        body: JSON.stringify(payload),
        cache: "no-store",
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      click_id?: string;
      ok?: boolean;
    };
    const response = NextResponse.json(
      { ok: data.ok !== false, click_id: data.click_id ?? null },
      { status: 200, headers: { "cache-control": "no-store, private" } },
    );
    if (typeof data.click_id === "string" && data.click_id) {
      // Hint only — client also stores session key; cookie is not required.
      void AD_CLICK_KEY;
    }
    return response;
  } catch {
    return NextResponse.json({ ok: false, soft_error: "upstream_unavailable" });
  }
}
