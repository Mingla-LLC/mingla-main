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

export interface ExplorerProfileAuthRestPlan {
  /** Reactivation only: the own-row write, sent first, returning nothing. */
  write: ExplorerProfileAuthRestRequest | null;
  /** The own-profile read (`get_my_profile`), sent last; its row is the result. */
  read: ExplorerProfileAuthRestRequest;
}

/**
 * #4202 — build the post-auth profile requests that must not depend on the
 * shared Supabase client's session timing.
 *
 * Supabase emits SIGNED_IN before every consumer of the shared client is
 * guaranteed to observe its new bearer. The auth callback already receives the
 * verified session, so these requests deliberately use that captured access
 * token. RLS still enforces `auth.uid() = profiles.id`; this is not a service
 * role or a policy bypass.
 *
 * Issue #3969 — the row is read through `get_my_profile`, never a direct
 * table read, and the reactivation write asks for no row back.
 */
export function buildExplorerProfileAuthRestRequest(
  input: ExplorerProfileAuthRestInput,
): ExplorerProfileAuthRestPlan {
  const baseUrl = input.supabaseUrl.replace(/\/+$/, "");
  const idFilter = new URLSearchParams({ id: `eq.${input.userId}` });
  const headers: Record<string, string> = {
    Accept: "application/json",
    apikey: input.anonKey,
    Authorization: `Bearer ${input.accessToken}`,
  };

  const read: ExplorerProfileAuthRestRequest = {
    url: `${baseUrl}/rest/v1/rpc/get_my_profile?${idFilter.toString()}`,
    init: {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{}",
    },
  };

  if (!input.reactivate) return { write: null, read };

  return {
    write: {
      url: `${baseUrl}/rest/v1/profiles?${idFilter.toString()}`,
      init: {
        method: "PATCH",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          explorer_deleted_at: null,
          has_completed_onboarding: false,
        }),
      },
    },
    read,
  };
}
