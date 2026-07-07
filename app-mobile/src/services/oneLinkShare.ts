/**
 * OneLink Share — ORCH-1318 [appsflyer-onelink-deferred-deeplinking].
 *
 * Outbound tracked-link builder (SPEC §E.2). Wraps `appsFlyer.generateInviteLink`
 * to mint a branded OneLink whose payload (`deep_link_value` / `deep_link_sub1` /
 * `deep_link_sub2` / `af_sub1` — SPEC §B.1) survives an App Store install and
 * re-emerges in the deferred `onDeepLink` callback (appsFlyerService.ts →
 * resolveOneLinkDestination → the UI sink). ONE link satisfies "land on the
 * shared experience" + "carry the referral code" at once.
 *
 * NEVER blocks a share: if the native SDK call fails / times out / is absent,
 * resolves a static install-capable fallback URL (SPEC §E.4.2). NEVER emits a
 * broken entity link (never `/e/brand/undefined`) — a missing entity slug drops
 * to the brand-only link, then to a referral / universal link.
 *
 * NO top-level `react-native-appsflyer` import: the SDK is lazily + defensively
 * required (mirrors the business service's lazy-require), so this module loads
 * cleanly under a unit-test runner and degrades to the fallback when the native
 * module is unlinked (Expo Go / `expo export -p web`).
 */

// The branded OneLink subdomain (SPEC §C.1). EXACT constant.
export const ONELINK_BRAND_DOMAIN = 'go.usemingla.com';
// Consumer entity share pages live on this origin (parity with
// mingla-business publicUrls.ts BUSINESS_PUBLIC_ORIGIN) — used only for the
// static fallback URL when the native OneLink call is unavailable.
const BUSINESS_PUBLIC_ORIGIN = 'https://business.usemingla.com';
// The share sheet must never hang on a slow native round-trip.
const GENERATE_TIMEOUT_MS = 4000;

export type ShareEntity = {
  type: 'brand' | 'event' | 'trip' | 'experience';
  brandSlug: string;
  entitySlug?: string;
};

export interface BuildReferralLinkInput {
  /**
   * The signed-in user's referral code. Optional in practice: no user-code
   * accessor exists yet (SPEC §REMAINS #6), and an unauthenticated share emits
   * an entity-only link (no `af_sub1`) per SPEC §E.4.1.
   */
  referralCode?: string;
  entity?: ShareEntity;
  channel: string; // 'whatsapp' | 'copy_link' | 'messages' | ...
}

type InviteUserParams = {
  deep_link_value: string;
  deep_link_sub1: string;
  deep_link_sub2?: string;
  af_sub1?: string;
};

type InviteSdk = {
  generateInviteLink: (
    params: {
      channel: string;
      campaign?: string;
      userParams?: Record<string, unknown>;
      brandDomain?: string;
    },
    successC: (result?: unknown) => unknown,
    errorC: (error?: unknown) => unknown,
  ) => void;
};

// ── Test seam ─────────────────────────────────────────────────────────────────
// `undefined` = not overridden → lazily require the real native SDK.
// `null`/mock  = force that SDK (used by the §E.6 unit test to inject a mocked
// generateInviteLink or simulate a missing native module).
let _sdkOverride: InviteSdk | null | undefined;
export function __setInviteSdkForTest(sdk: InviteSdk | null): void {
  _sdkOverride = sdk;
}

function loadInviteSdk(): InviteSdk | null {
  if (_sdkOverride !== undefined) return _sdkOverride;
  try {
    if (typeof require !== 'function') return null;
    // Metro resolves this at bundle time; the try/catch keeps a missing native
    // module (Expo Go / web export / unit test) a clean degrade to the fallback.
    const mod: any = require('react-native-appsflyer');
    const sdk = (mod?.default ?? mod) as InviteSdk | undefined;
    return sdk ?? null;
  } catch {
    return null;
  }
}

const enc = (s: string): string => encodeURIComponent(s.trim());

/**
 * Normalize an entity into (a) a full entity, (b) a brand-only entity when the
 * secondary slug is missing, or (c) null — so callers NEVER build
 * `/e/brand/undefined` (SPEC §E.4.5).
 */
function effectiveEntity(entity?: ShareEntity): ShareEntity | null {
  if (!entity) return null;
  const brandSlug = (entity.brandSlug ?? '').trim();
  if (!brandSlug) return null;
  if (entity.type === 'brand') return { type: 'brand', brandSlug };
  const entitySlug = (entity.entitySlug ?? '').trim();
  if (!entitySlug) return { type: 'brand', brandSlug }; // degrade — never a half link
  return { type: entity.type, brandSlug, entitySlug };
}

/**
 * Assemble the OneLink `userParams` per SPEC §B.1 (pure — unit-tested §E.6).
 * Entity link → `deep_link_value` = entity type, `deep_link_sub1` = brandSlug,
 * `deep_link_sub2` = entitySlug (when present), `af_sub1` = referralCode (when
 * present). No entity → a pure `referral` link (or a bare universal link).
 */
export function buildInviteUserParams(input: BuildReferralLinkInput): InviteUserParams {
  const referralCode = (input.referralCode ?? '').trim() || undefined;
  const entity = effectiveEntity(input.entity);

  if (entity) {
    const params: InviteUserParams = {
      deep_link_value: entity.type,
      deep_link_sub1: entity.brandSlug,
    };
    if (entity.type !== 'brand' && entity.entitySlug) {
      params.deep_link_sub2 = entity.entitySlug;
    }
    if (referralCode) params.af_sub1 = referralCode;
    return params;
  }

  // No entity → a pure referral (or, with no code either, a bare universal link).
  const params: InviteUserParams = {
    deep_link_value: 'referral',
    deep_link_sub1: referralCode ?? '',
  };
  if (referralCode) params.af_sub1 = referralCode;
  return params;
}

/**
 * Static, install-capable fallback URL (pure — unit-tested §E.6). NEVER empty,
 * so the share sheet / clipboard is never dead (SPEC §E.4.2).
 */
export function buildFallbackShareUrl(input: BuildReferralLinkInput): string {
  const referralCode = (input.referralCode ?? '').trim() || undefined;
  const entity = effectiveEntity(input.entity);
  if (entity) {
    const b = enc(entity.brandSlug);
    if (entity.type === 'brand' || !entity.entitySlug) {
      return `${BUSINESS_PUBLIC_ORIGIN}/b/${b}`;
    }
    const e = enc(entity.entitySlug);
    const seg =
      entity.type === 'event'
        ? `/e/${b}/${e}`
        : entity.type === 'trip'
          ? `/t/${b}/${e}`
          : `/exp/${b}/${e}`;
    return `${BUSINESS_PUBLIC_ORIGIN}${seg}`;
  }
  if (referralCode) return `https://${ONELINK_BRAND_DOMAIN}/invite/${enc(referralCode)}`;
  // Bare universal-download link (goal 3).
  return `https://${ONELINK_BRAND_DOMAIN}`;
}

/**
 * Build a tracked OneLink for share (SPEC §E.2). Resolves the native OneLink
 * URL on success, or a static install-capable fallback on error/timeout/absent
 * native module. Never rejects, never returns empty.
 */
export async function buildReferralLink(input: BuildReferralLinkInput): Promise<string> {
  const fallback = buildFallbackShareUrl(input);
  const sdk = loadInviteSdk();
  if (!sdk || typeof sdk.generateInviteLink !== 'function') {
    return fallback;
  }

  const userParams = buildInviteUserParams(input);
  try {
    return await new Promise<string>((resolve) => {
      let settled = false;
      const done = (url: string) => {
        if (settled) return;
        settled = true;
        resolve(url && url.length > 0 ? url : fallback);
      };
      const timer = setTimeout(() => done(fallback), GENERATE_TIMEOUT_MS);
      try {
        sdk.generateInviteLink(
          {
            channel: input.channel,
            campaign: 'referral',
            userParams,
            brandDomain: ONELINK_BRAND_DOMAIN,
          },
          (result?: unknown) => {
            clearTimeout(timer);
            done(typeof result === 'string' ? result : fallback);
          },
          (error?: unknown) => {
            clearTimeout(timer);
            console.warn('[oneLinkShare] generateInviteLink error — using fallback:', error);
            done(fallback);
          },
        );
      } catch (e) {
        clearTimeout(timer);
        console.warn('[oneLinkShare] generateInviteLink threw — using fallback:', e);
        done(fallback);
      }
    });
  } catch {
    return fallback;
  }
}
