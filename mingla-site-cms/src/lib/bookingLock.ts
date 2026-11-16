/**
 * #4453 PR 2 (booking lock) — Studio's side of "every button goes to Mingla".
 *
 * Core signs the brand a publish is for into the publication request (its
 * Mingla slug, contact email and phone, read by Core from `brands`, never
 * from the caller). The builder freezes that into the artifact as
 * `action_scope`, and this check refuses the publish when any button on any
 * page, or the header button, fails isMinglaActionHref. The refusal names
 * itself (OUTBOUND_ACTION_LINK) so Core and the Business app tell the owner
 * what to change; the last good site stays live.
 *
 * invariant: I-SITES-ACTIONS-RESOLVE-TO-MINGLA (declared in
 * packages/site-contracts/src/safety.ts). Test: bookingLock.issue4453.test.ts.
 */
import {
  artifactActionScope,
  assertArtifactActionScope,
  type ArtifactActionScope,
  type ArtifactV2,
} from "../contracts/generated/artifactV2.ts";
import {
  OUTBOUND_ACTION_LINK,
  outboundActionLinks,
  type OutboundActionLink,
} from "../contracts/generated/publishChecks.ts";

/** A publish refused by the booking lock; `links` names every failing button. */
export class OutboundActionLinkError extends Error {
  readonly links: readonly OutboundActionLink[];
  constructor(links: readonly OutboundActionLink[]) {
    super(OUTBOUND_ACTION_LINK);
    this.name = "OutboundActionLinkError";
    this.links = links;
  }
}

/** Core's signed `action_scope` from a publication request, or null when absent or malformed. */
export function actionScopeFromCore(value: unknown): ArtifactActionScope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const text = (field: unknown): string | undefined =>
    typeof field === "string" && field.trim() ? field.trim() : undefined;
  const scope: ArtifactActionScope = { brand_slug: String(raw.brand_slug ?? "") };
  const email = text(raw.contact_email);
  const phone = text(raw.contact_phone);
  if (email) scope.contact_email = email;
  if (phone) scope.contact_phone = phone;
  try {
    assertArtifactActionScope(scope);
    return scope;
  } catch {
    // A slug, email or phone that is not well formed is treated as absent:
    // the publish then runs the brand-agnostic check below, never a looser one.
    return null;
  }
}

/** Every failing button of a built v2 artifact (empty = the publish may go ahead). */
export function artifactOutboundActionLinks(artifact: ArtifactV2): OutboundActionLink[] {
  return outboundActionLinks({
    pages: artifact.pages.filter((page) => page.enabled),
    headerCtaHref: artifact.navigation.header_cta?.href,
    scope: artifactActionScope(artifact),
  });
}

/** Throws OUTBOUND_ACTION_LINK when any button of the artifact points outside Mingla. */
export function assertNoOutboundActionLinks(artifact: ArtifactV2): void {
  const links = artifactOutboundActionLinks(artifact);
  if (links.length) throw new OutboundActionLinkError(links);
}
