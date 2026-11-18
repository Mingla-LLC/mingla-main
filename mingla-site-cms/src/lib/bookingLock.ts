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
  BOOKING_LINK_UNVERIFIED,
  OUTBOUND_ACTION_LINK,
  outboundActionLinks,
  type OutboundActionLink,
} from "../contracts/generated/publishChecks.ts";
import { normalizeBrandPhone } from "../contracts/generated/safety.ts";

/**
 * A publish refused by the booking lock; `links` names every failing button.
 * BOOKING_LINK_UNVERIFIED when the only problem is that Core couldn't name
 * the brand (the check failed closed); OUTBOUND_ACTION_LINK otherwise.
 */
export class OutboundActionLinkError extends Error {
  readonly links: readonly OutboundActionLink[];
  constructor(links: readonly OutboundActionLink[]) {
    super(links.every((link) => link.problem === "brand_unknown") ? BOOKING_LINK_UNVERIFIED : OUTBOUND_ACTION_LINK);
    this.name = "OutboundActionLinkError";
    this.links = links;
  }
}

/**
 * Core's signed `action_scope` from a publication request. A malformed field
 * is DROPPED on its own (the rest stays, so the check never loosens: a
 * missing phone or email only means no tel/mailto/WhatsApp passes). The
 * phone is normalised (extension and note text removed). Null only when
 * there is no usable brand slug, and the publish then fails closed.
 */
export function actionScopeFromCore(value: unknown): ArtifactActionScope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const slug = typeof raw.brand_slug === "string" ? raw.brand_slug.trim() : "";
  const keep = (scope: ArtifactActionScope): boolean => {
    try {
      assertArtifactActionScope(scope);
      return true;
    } catch {
      return false;
    }
  };
  const scope: ArtifactActionScope = { brand_slug: slug };
  if (!keep(scope)) return null;
  const email = typeof raw.contact_email === "string" ? raw.contact_email.trim() : "";
  if (email && keep({ brand_slug: slug, contact_email: email })) scope.contact_email = email;
  const phone = normalizeBrandPhone(raw.contact_phone);
  if (phone && keep({ brand_slug: slug, contact_phone: phone })) scope.contact_phone = phone;
  const handles = Array.isArray(raw.social_handles)
    ? [...new Set(raw.social_handles.filter((handle): handle is string => typeof handle === "string").map((handle) => handle.trim().replace(/^@/, "").toLowerCase()))]
      .filter((handle) => /^[a-z0-9._-]{1,100}$/.test(handle)).slice(0, 20)
    : [];
  if (handles.length) scope.social_handles = handles;
  return scope;
}

/** Every failing button of a built v2 artifact (empty = the publish may go ahead). */
/*
 * Deploy-order handshake. Core (brand-site-control) advertises that it signs
 * the brand's identity into a publish with `booking_identity: 1`
 * (BOOKING_IDENTITY_CAPABILITY). Only then is the identity part of the lock
 * enforced, failing closed (BOOKING_LINK_UNVERIFIED) when the identity is
 * missing. A publish from an older Core is still checked for everything that
 * needs no identity (booking and ticketing sites, redirectors and
 * shorteners, the Mingla host and route shapes, same-site pages, own media);
 * only the "is it THIS brand's page / email / phone" part is shape-only, as
 * before the lock. So Studio and Core may deploy in either order.
 */
export const BOOKING_IDENTITY_CAPABILITY = 1;

/** Does this Core publish request advertise that it sends brand identity? */
export function coreSendsBookingIdentity(body: unknown): boolean {
  return Boolean(body) && typeof body === "object" &&
    (body as Record<string, unknown>).booking_identity === BOOKING_IDENTITY_CAPABILITY;
}

export type BookingLockOptions = {
  /** The Core advertised `booking_identity` (default true: fail closed). */
  coreSendsIdentity?: boolean;
};

export function artifactOutboundActionLinks(artifact: ArtifactV2, options: BookingLockOptions = {}): OutboundActionLink[] {
  const coreSendsIdentity = options.coreSendsIdentity !== false;
  return outboundActionLinks({
    pages: artifact.pages.filter((page) => page.enabled),
    headerCtaHref: artifact.navigation.header_cta?.href,
    // Fail closed when Core advertises identity but none came; shape-only for
    // the identity checks when the Core predates it.
    scope: artifactActionScope(artifact, { failClosed: true, identityUnchecked: !coreSendsIdentity }),
  });
}

/** Throws OUTBOUND_ACTION_LINK (or BOOKING_LINK_UNVERIFIED) when a button breaks the booking lock. */
export function assertNoOutboundActionLinks(artifact: ArtifactV2, options: BookingLockOptions = {}): void {
  const links = artifactOutboundActionLinks(artifact, options);
  if (links.length) throw new OutboundActionLinkError(links);
}
