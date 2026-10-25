// Issue #4063 — bounded, service-role-only claim-link minting.
// This is the sole authority for the public /c/ link base. Callers receive a
// URL derived from the validated code rather than trusting an RPC-supplied URL.

export const CLAIM_LINK_BASE = "https://usemingla.com/c/";
export const CLAIM_LINK_DEADLINE_MS = 1500;

export type ClaimLinkKind =
  | "order"
  | "rsvp"
  | "rsvp_guest"
  | "reservation"
  | "stay_group"
  | "venue_order"
  | "ticket";

export interface MintedClaimLink {
  code: string;
  url: string;
  display: string;
  claimed?: boolean;
}

interface RpcResult {
  data: unknown;
  error: { message?: string } | null;
}

export interface ClaimLinkAdmin {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

function withDeadline<T>(work: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = Promise.resolve(work);
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("claim_link_mint_deadline")),
        CLAIM_LINK_DEADLINE_MS,
      );
    }),
  ]);
}

function objectResult(data: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(data) ? data[0] : data;
  return candidate !== null && typeof candidate === "object"
    ? candidate as Record<string, unknown>
    : null;
}

function parsedLink(data: unknown): MintedClaimLink | null {
  const result = objectResult(data);
  const rawCode = typeof result?.code === "string" ? result.code.trim() : "";
  if (!/^[0-9A-Za-z]{10}$/.test(rawCode)) return null;

  const code = rawCode.toUpperCase();
  return {
    code,
    url: `${CLAIM_LINK_BASE}${code}`,
    display: `usemingla.com/c/${code}`,
    ...(typeof result?.claimed === "boolean"
      ? { claimed: result.claimed }
      : {}),
  };
}

async function mint(
  admin: ClaimLinkAdmin,
  rpcName: "mint_claim_link" | "mint_redirect_link",
  kind: ClaimLinkKind | "waitlist_offer",
  args: Record<string, unknown>,
): Promise<MintedClaimLink | null> {
  try {
    const { data, error } = await withDeadline(admin.rpc(rpcName, args));
    const link = error === null ? parsedLink(data) : null;
    if (link !== null) return link;
  } catch {
    // The structured warning below intentionally omits subject ids and URLs.
  }

  console.warn("claim_link_mint_failed", { kind });
  return null;
}

export function mintClaimLink(
  admin: ClaimLinkAdmin,
  kind: ClaimLinkKind,
  subjectId: string,
): Promise<MintedClaimLink | null> {
  return mint(admin, "mint_claim_link", kind, {
    p_subject_kind: kind,
    p_subject_id: subjectId,
  });
}

export function mintRedirectLink(
  admin: ClaimLinkAdmin,
  kind: "waitlist_offer",
  subjectId: string,
  targetUrl: string,
  expiresAt: string,
): Promise<MintedClaimLink | null> {
  return mint(admin, "mint_redirect_link", kind, {
    p_subject_kind: kind,
    p_subject_id: subjectId,
    p_target_url: targetUrl,
    p_expires_at: expiresAt,
  });
}
