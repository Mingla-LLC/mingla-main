export type MetaPageLinkDiagnostic =
  | "match"
  | "absent"
  | "mismatch"
  | "unavailable";

export interface ExactMetaIdentity {
  pageId: string;
  instagramUserId: string;
}

export interface MetaIdentityAuthorityDependencies {
  checkPageAuthorization(
    pageId: string,
  ): Promise<{ ok: boolean }>;
  fetchPageLinkedInstagram(pageId: string): Promise<string | null>;
  validateExactIdentity(identity: ExactMetaIdentity): Promise<{
    ok: boolean;
    createdObject: boolean;
  }>;
}

export interface MetaIdentityAuthorityResult {
  verdict: "ready" | "blocked";
  reason: "meta_page_not_authorized" | "meta_validate_only_failed" | null;
  pageLinkDiagnostic: MetaPageLinkDiagnostic | null;
}

/**
 * The Page link field is diagnostic only: shared/cross-portfolio ad identities
 * can validate even when that field is absent or names another Instagram user.
 * The exact no-object validate-only request is the provider authority.
 */
export async function evaluateMetaIdentityAuthority(
  identity: ExactMetaIdentity,
  dependencies: MetaIdentityAuthorityDependencies,
): Promise<MetaIdentityAuthorityResult> {
  const page = await dependencies.checkPageAuthorization(identity.pageId);
  if (!page.ok) {
    return {
      verdict: "blocked",
      reason: "meta_page_not_authorized",
      pageLinkDiagnostic: null,
    };
  }

  let pageLinkDiagnostic: MetaPageLinkDiagnostic;
  try {
    const linkedInstagramId = await dependencies.fetchPageLinkedInstagram(
      identity.pageId,
    );
    pageLinkDiagnostic = linkedInstagramId === null
      ? "absent"
      : linkedInstagramId === identity.instagramUserId
      ? "match"
      : "mismatch";
  } catch {
    // This lookup is deliberately non-authoritative. The exact validate-only
    // request below remains able to prove the registered pair directly.
    pageLinkDiagnostic = "unavailable";
  }

  const probe = await dependencies.validateExactIdentity(identity);
  if (!probe.ok || probe.createdObject) {
    return {
      verdict: "blocked",
      reason: "meta_validate_only_failed",
      pageLinkDiagnostic,
    };
  }

  return { verdict: "ready", reason: null, pageLinkDiagnostic };
}
