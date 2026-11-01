export interface ExplorerProfileAuthRestInput {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  userId: string;
  reactivate: boolean;
}

export interface ExplorerProfileAuthRestRequest {
  url: string;
  init: RequestInit;
}

/**
 * #4202 — build the one post-auth profile request that must not depend on the
 * shared Supabase client's session timing.
 *
 * Supabase emits SIGNED_IN before every consumer of the shared client is
 * guaranteed to observe its new bearer. The auth callback already receives the
 * verified session, so this request deliberately uses that captured access
 * token. RLS still enforces `auth.uid() = profiles.id`; this is not a service
 * role or a policy bypass.
 */
export function buildExplorerProfileAuthRestRequest(
  input: ExplorerProfileAuthRestInput,
): ExplorerProfileAuthRestRequest {
  const baseUrl = input.supabaseUrl.replace(/\/+$/, "");
  const params = new URLSearchParams({
    id: `eq.${input.userId}`,
    select: "*",
  });
  const headers: Record<string, string> = {
    Accept: "application/json",
    apikey: input.anonKey,
    Authorization: `Bearer ${input.accessToken}`,
  };

  if (!input.reactivate) {
    return {
      url: `${baseUrl}/rest/v1/profiles?${params.toString()}`,
      init: { method: "GET", headers },
    };
  }

  return {
    url: `${baseUrl}/rest/v1/profiles?${params.toString()}`,
    init: {
      method: "PATCH",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        explorer_deleted_at: null,
        has_completed_onboarding: false,
      }),
    },
  };
}
