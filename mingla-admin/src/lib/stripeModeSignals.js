// Issue #4130 (Wave 4b) — the three Stripe-mode signals (ORCH-1056), moved
// out of the retired Stripe mode page; Platform health reads them and
// lib/systemPages.js stripeModeVerdict() decides, honestly, whether they agree.
//
//   1. the Supabase backend mode (public stripe-mode edge function) — the only
//      one the admin page can confirm;
//   2. the business web app's bundled key — the browser can't read it
//      (cross-origin), so it is "unverifiable" here;
//   3. the Vercel project settings — need an elevated token, "unverifiable".

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const BUSINESS_WEB_URL = "https://host.usemingla.com";

export async function fetchBackendMode() {
  if (!SUPABASE_URL) {
    return { status: "unconfigured", detail: "This admin build has no server address." };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/stripe-mode`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(SUPABASE_ANON_KEY
          ? {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            }
          : {}),
      },
    });
    if (!res.ok) {
      return {
        status: "error",
        detail: `The server answered ${res.status}.`,
      };
    }
    const body = await res.json();
    if (
      (body.mode !== "test" && body.mode !== "live") ||
      (body.publishablePrefix !== "pk_test_" &&
        body.publishablePrefix !== "pk_live_")
    ) {
      return {
        status: "error",
        detail: "The server's answer didn't make sense.",
        body,
      };
    }
    return {
      status: "ok",
      mode: body.mode,
      publishablePrefix: body.publishablePrefix,
    };
  } catch (err) {
    return {
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function probeBusinessWebClientPrefix() {
  // Best-effort: fetch the business web export's bundle entry. CORS will
  // almost certainly block this from arbitrary origins, so we frame the
  // probe as "unverifiable" if it fails and rely on the backend handshake
  // (which runs from the business app itself) as the authoritative check.
  try {
    const res = await fetch(`${BUSINESS_WEB_URL}/`, {
      method: "GET",
      mode: "no-cors",
    });
    void res;
    return { status: "unverifiable", detail: "The admin page can't read the business app's Stripe key from here. Open host.usemingla.com to check it." };
  } catch (err) {
    return {
      status: "unverifiable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The Vercel signal: never readable from the admin page. */
export const VERCEL_SIGNAL = Object.freeze({
  status: "unverifiable",
  detail: "Vercel project settings can't be read from here. Check them in Vercel.",
});
