/**
 * OneLink Resolver — ORCH-1318 [appsflyer-onelink-deferred-deeplinking].
 *
 * The ONE pure function that converts a resolved AppsFlyer OneLink payload
 * (`UnifiedDeepLinkData.data`) into a typed navigation destination. This is the
 * single dispatch point (invariant I-ONELINK-SINGLE-RESOLVER): exactly ONE
 * definition lives here and exactly ONE call site consumes it (the `onDeepLink`
 * handler in `appsFlyerService.ts`, forwarded to the UI dispatcher in
 * `app/index.tsx`). There is NO second inline payload→nav mapping anywhere.
 *
 * Payload contract (SPEC §B.1):
 *   deep_link_value ∈ {brand, event, trip, experience, referral, internal}
 *   deep_link_sub1  = primary slug (brandSlug for entities; referral_code for
 *                     `referral`; a `mingla://` path for `internal`)
 *   deep_link_sub2  = secondary slug (eventSlug/tripSlug/experienceSlug)
 *   af_sub1         = optional referral_code carried alongside ANY entity link
 *   deep_link_sub3  = optional landing discriminator ('guest-list') — ORCH-1342
 *
 * PURE by contract: no imports, no RN deps, never throws, never navigates,
 * returns `null` on unknown / half-formed input — mirroring
 * `deepLinkService.parseDeepLink`'s null-on-unknown contract so the two nav
 * systems can never disagree (SPEC §B.2 / §1).
 */

export type OneLinkDestination =
  | { kind: 'content_share'; code: string }
  | { kind: 'share'; shareType: 'place' | 'curated'; shareId: string; referralCode?: string }
  | { kind: 'entity'; entity: 'brand'; brandSlug: string; referralCode?: string }
  | {
      kind: 'entity';
      entity: 'event' | 'trip' | 'experience' | 'venue';
      brandSlug: string;
      entitySlug: string;
      referralCode?: string;
      /**
       * ORCH-1342 [web-see-whos-going-funnel] — optional landing discriminator
       * (`deep_link_sub3`). Present ONLY on the exact lowercase token
       * 'guest-list'; any other value is OMITTED so the entity link still
       * resolves and navigates normally (graceful degrade — a bad landing must
       * never kill the link). The `brand` variant does NOT carry it (a guest
       * list is event-scoped). Parsed HERE and ONLY here
       * (I-PROPOSED-1342-LANDING-SINGLE-PARSE; I-ONELINK-SINGLE-RESOLVER —
       * extended IN PLACE, no second parser anywhere).
       */
      landing?: 'guest-list';
    }
  | { kind: 'internal'; url: string } // a mingla:// path → deepLinkService
  | { kind: 'referral'; referralCode: string }
  | null;

const OPAQUE_SHARE_ID_RE = /^[a-f0-9]{36}$/;
const CONTENT_SHARE_CODE_RE = /^[0-9A-Za-z]{16}$/;
export const isOpaqueShareId = (value: unknown): value is string =>
  typeof value === 'string' && OPAQUE_SHARE_ID_RE.test(value);
export const isContentShareCode = (value: unknown): value is string =>
  typeof value === 'string' && CONTENT_SHARE_CODE_RE.test(value);

export function resolveOneLinkDestination(data: Record<string, any>): OneLinkDestination {
  try {
    if (!data || typeof data !== 'object') return null;

    const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

    const rawType = str(data.deep_link_value).toLowerCase();
    const sub1 = str(data.deep_link_sub1);
    const sub2 = str(data.deep_link_sub2);
    // Any entity link may carry a referral code alongside it (referral + content
    // in one link — SPEC §B.1 af_sub1).
    const referralCode = str(data.af_sub1) || undefined;

    // Missing type OR explicit `internal` may only route an actual `mingla://`
    // path through the existing deepLinkService state machine. Never reinterpret
    // an opaque share id or malformed payload as an internal destination.
    if (rawType === '' || rawType === 'internal') {
      return sub1.startsWith('mingla://') ? { kind: 'internal', url: sub1 } : null;
    }

    switch (rawType) {
      case 'content_share':
        return isContentShareCode(sub1) ? { kind: 'content_share', code: sub1 } : null;
      case 'place':
      case 'curated':
        if (!isOpaqueShareId(sub1)) return null;
        return referralCode
          ? { kind: 'share', shareType: rawType, shareId: sub1, referralCode }
          : { kind: 'share', shareType: rawType, shareId: sub1 };
      case 'brand':
        if (!sub1) return null;
        return referralCode
          ? { kind: 'entity', entity: 'brand', brandSlug: sub1, referralCode }
          : { kind: 'entity', entity: 'brand', brandSlug: sub1 };

      case 'event':
      case 'trip':
      case 'experience':
      case 'venue': {
        // Never a half-formed route: both slugs are required, else `null`
        // (SPEC §B.5.1 — never push `/e/brand/undefined`).
        if (!sub1 || !sub2) return null;
        const entity = rawType as 'event' | 'trip' | 'experience' | 'venue';
        const dest: Exclude<
          Extract<OneLinkDestination, { kind: 'entity' }>,
          { entity: 'brand' }
        > = referralCode
          ? { kind: 'entity', entity, brandSlug: sub1, entitySlug: sub2, referralCode }
          : { kind: 'entity', entity, brandSlug: sub1, entitySlug: sub2 };
        // ORCH-1342 — landing discriminator (SPEC §4.5). Conditional inclusion
        // mirrors referralCode above: the key is added ONLY on the exact
        // lowercase token, so every pre-1342 payload produces a byte-identical
        // destination (the ORCH-1318 suite stays green unmodified). Absent /
        // garbage / future tokens → field omitted, destination unchanged.
        const landing = str(data.deep_link_sub3);
        if (landing === 'guest-list') dest.landing = 'guest-list';
        return dest;
      }

      case 'referral':
        // Attribution-only capture target (SPEC §E.1(b)); credit-apply is out of
        // scope for this build.
        if (!sub1) return null;
        return { kind: 'referral', referralCode: sub1 };

      default:
        // Unknown discriminator — log, never guess (SPEC §B.2).
        console.warn('[oneLinkResolver] Unknown deep_link_value:', rawType);
        return null;
    }
  } catch (err) {
    // Pure + never throws: a malformed payload degrades to "no destination".
    console.warn('[oneLinkResolver] Failed to resolve OneLink payload:', err);
    return null;
  }
}
