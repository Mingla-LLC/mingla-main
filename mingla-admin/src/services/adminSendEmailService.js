// The admin-send-email Edge Function client: signed-in headers (refreshed near
// expiry), one refresh + retry on 401, then a SessionExpiredError the page
// turns into "Sign in again". Moved out of pages/EmailPage.jsx by #4383 so the
// Communications Overview can cancel a scheduled email through the same path.
import { supabase, SESSION_EXPIRED_MESSAGE } from "../lib/supabase";

export class SessionExpiredError extends Error {
  constructor(message = SESSION_EXPIRED_MESSAGE) {
    super(message);
    this.name = "SessionExpiredError";
    this.status = 401;
  }
}

const SUPABASE_BASE = import.meta.env.VITE_SUPABASE_URL || "";
const EDGE_FUNCTION_URL = SUPABASE_BASE ? `${SUPABASE_BASE}/functions/v1/admin-send-email` : "";

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new SessionExpiredError();
  // #3720 / #3512 — pre-refresh near expiry (same buffer as invokeWithRefresh).
  if (session.expires_at) {
    const timeLeft = session.expires_at * 1000 - Date.now();
    if (timeLeft < 60_000) {
      try {
        await supabase.auth.refreshSession();
      } catch {
        // Fall through; the request may still succeed with the current token.
      }
      const { data: { session: refreshed } } = await supabase.auth.getSession();
      if (!refreshed?.access_token) throw new SessionExpiredError();
      return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${refreshed.access_token}`,
      };
    }
  }
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${session.access_token}`,
  };
}

export async function callEdgeFunction(payload, { retried = false } = {}) {
  const headers = await getAuthHeaders();
  const response = await fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Server error (HTTP ${response.status})`);
  }
  if (!response.ok) {
    if (result.code === "NO_PROVIDER") return { _noProvider: true };
    // #3720 bug 10 — one refresh + retry on 401, then force re-sign-in.
    if (response.status === 401 && !retried) {
      try {
        await supabase.auth.refreshSession();
      } catch {
        throw new SessionExpiredError();
      }
      return callEdgeFunction(payload, { retried: true });
    }
    if (response.status === 401) throw new SessionExpiredError();
    // #4383: keep the server's code so the screen can say what it means.
    const error = new Error(result.error || `HTTP ${response.status}`);
    if (typeof result.code === "string") error.code = result.code;
    error.status = response.status;
    throw error;
  }
  return result;
}

// #4419 — the Emails tab, one email's page, and a test to yourself. Thin
// wrappers so the screens keep the 401 refresh and SessionExpiredError.
export function listCampaigns({ filter = "all", query = "", page = 0 } = {}) {
  return callEdgeFunction({ action: "list_campaigns", filter, query, page });
}

export function getCampaignDetail(campaignId) {
  return callEdgeFunction({ action: "get_campaign_detail", campaignId });
}

export function sendCampaignTest(campaignId) {
  return callEdgeFunction({ action: "send_test", campaignId });
}
