// @mingla/offering-rendering — issue #2468 [maps-deep-link-coordinates].
//
// THE ONE builder for every "open in maps" deep link in the product.
//
// WHY THIS EXISTS
// ---------------
// Every map deep-link used to discard the coordinates we already store and send
// Apple/Google a FREE-TEXT query, letting the provider re-geocode from scratch.
// Apple's text resolution is fuzzy AND biased by the device location and by
// whatever the user last searched in Maps, so the SAME link resolved to
// different places on different phones — runtime-proven against production event
// `3014ea7e-f3e0-40d0-b112-a51f4e37e964` (stored pin lat 6.43273 / lng 3.423375,
// Victoria Island Lagos):
//
//   text "Didi Museum , Akin Adesola Street 175, Lagos 10, Lagos, Nigeria"
//     → Flat 10, Akintaro House, Alverton Street, London SE8 5PN  (x2)
//   text "Akin Adesola Street 175, Lagos 10, Lagos, Nigeria"
//     → 175 Gaskin Street, London N1
//   maps://?ll=6.43273,3.423375&q=Didi%20Museum
//     → the EXACT stored coordinate, Lagos, under every condition above.
//
// The same screens already drew their static-map THUMBNAIL from `locationGeo`
// while the LINK used text: two owners for one location (Constitution #2). This
// module is the single owner. `mapboxStaticProxyUrl.ts` (the thumbnail) is its
// sibling in this same package, deliberately.
//
// WHY IT LIVES IN @mingla/offering-rendering
// ------------------------------------------
// All four consumers already import this package today, so nothing here creates
// a new dependency edge: `packages/brand-rendering` (13 imports),
// `mingla-business` (src/ + app/), `app-mobile` (src/ + app/). The package is
// also the monorepo's SOLE rendering package and already owns every OTHER map
// URL builder (mapboxStaticProxyUrl / mapboxStaticImage / mapboxStaticUrl).
//
// PURITY CONTRACT
// ---------------
// This file imports NOTHING. No react, no react-native, no expo. The platform
// is INJECTED by the caller (`Platform.OS`), so the module runs unchanged under
// react-native, react-native-web, Node (mingla-business/server) and a headless
// Deno test runner. Do not add an import here.

/** The three link shapes the product needs. Anything else normalizes to "web". */
export type MapsPlatform = "ios" | "android" | "web";

export interface MapsGeoPoint {
  lat: number;
  lng: number;
}

/**
 * What a surface wants opened in maps: the coordinate we already hold, plus the
 * human label for the pin. `geo === null` is the HONEST "we hold no coordinate"
 * state and takes the text path — it is never faked (Constitution #9).
 */
export interface MapsOpenTarget {
  label: string | null;
  geo: MapsGeoPoint | null;
}

export interface MapsDeepLink {
  /** Try this first — the platform-native scheme when a maps app is installed. */
  url: string;
  /**
   * Always openable in a browser. Use this when `canOpenURL`/`openURL` rejects
   * `url` (no maps app installed). On web `url === fallbackUrl`.
   */
  fallbackUrl: string;
  /**
   * true ⇔ the link is anchored on stored coordinates, so no provider
   * re-geocoding can move the pin. false ⇔ the honest text fallback.
   */
  coordinateAnchored: boolean;
}

export interface BuildMapsUrlParams {
  geo?: MapsGeoPoint | null;
  label?: string | null;
  /** Pass `Platform.OS`. Anything that is not "ios"/"android" is treated as web. */
  platform: MapsPlatform | string;
}

const normalizePlatform = (platform: MapsPlatform | string): MapsPlatform =>
  platform === "ios" ? "ios" : platform === "android" ? "android" : "web";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * A coordinate is usable only when both halves are finite AND inside the real
 * lat/lng envelope.
 *
 * Exact (0, 0) is REJECTED as a sentinel, not honored as Null Island: `geo:0,0?q=`
 * is this repo's own long-standing "I have no coordinate" idiom (it is literally
 * the string the pre-#2468 Android text path emitted), and a venue at 0,0 would
 * be several hundred kilometres out in the Gulf of Guinea. Dropping a confident
 * pin there is worse than falling back to the text the host actually typed.
 */
export const normalizeMapsGeo = (
  geo: MapsGeoPoint | null | undefined,
): MapsGeoPoint | null => {
  if (geo === null || geo === undefined) return null;
  const { lat, lng } = geo;
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
};

const normalizeLabel = (label: string | null | undefined): string | null => {
  if (typeof label !== "string") return null;
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const googleSearchUrl = (query: string): string =>
  `https://www.google.com/maps/search/?api=1&query=${query}`;

/**
 * Android's `geo:` label is wrapped in LITERAL parentheses — `?q=<lat>,<lng>(<label>)`
 * — and `encodeURIComponent` deliberately leaves `!'()*-._~` unescaped. So a
 * venue called "The Shed (Brixton)" closed the wrapper early and the tail landed
 * outside it. Percent-escape the two characters that are structural HERE, in the
 * one place that builds that wrapper (tester P3-2 on PR #2479).
 *
 * The pin is unaffected either way — the coordinate authority sits before the
 * `?` — so this is label fidelity, not a mis-pin fix.
 */
const encodeGeoLabel = (label: string): string =>
  encodeURIComponent(label).replace(/\(/g, "%28").replace(/\)/g, "%29");

/**
 * Build the deep link, or `null` when we hold NEITHER a coordinate NOR a label.
 *
 * `null` is a real answer: the caller must DISABLE the control rather than
 * render a tap that goes nowhere (Constitution #1). Never call `openURL` with a
 * fabricated destination.
 *
 * Coordinates present (the pin can never be re-geocoded):
 *   ios      maps://?ll=<lat>,<lng>&q=<label>
 *   android  geo:<lat>,<lng>?q=<lat>,<lng>(<label>)
 *   web      https://www.google.com/maps/search/?api=1&query=<lat>,<lng>
 *
 * No coordinates, label present (UNCHANGED pre-#2468 behaviour — the honest
 * fallback for the free-typed addresses we hold no pin for):
 *   ios      maps://?q=<label>
 *   android  geo:0,0?q=<label>
 *   web      https://www.google.com/maps/search/?api=1&query=<label>
 *
 * Every platform gets a `fallbackUrl` on the universal https form so the #1605
 * web arm can never regress into a dead tap: a `Platform.select` with only
 * ios/android keys returns `undefined` on web, and the `if (url)` guard that
 * followed it then silently no-opped.
 */
export function buildMapsDeepLink(
  params: BuildMapsUrlParams,
): MapsDeepLink | null {
  const platform = normalizePlatform(params.platform);
  const geo = normalizeMapsGeo(params.geo);
  const label = normalizeLabel(params.label);

  if (geo !== null) {
    const pair = `${geo.lat},${geo.lng}`;
    const fallbackUrl = googleSearchUrl(pair);
    const encodedLabel = label === null ? null : encodeURIComponent(label);
    if (platform === "ios") {
      const url =
        encodedLabel === null
          ? `maps://?ll=${pair}`
          : `maps://?ll=${pair}&q=${encodedLabel}`;
      return { url, fallbackUrl, coordinateAnchored: true };
    }
    if (platform === "android") {
      const url =
        label === null
          ? `geo:${pair}?q=${pair}`
          : `geo:${pair}?q=${pair}(${encodeGeoLabel(label)})`;
      return { url, fallbackUrl, coordinateAnchored: true };
    }
    return { url: fallbackUrl, fallbackUrl, coordinateAnchored: true };
  }

  if (label === null) return null;

  const encoded = encodeURIComponent(label);
  const fallbackUrl = googleSearchUrl(encoded);
  if (platform === "ios") {
    return { url: `maps://?q=${encoded}`, fallbackUrl, coordinateAnchored: false };
  }
  if (platform === "android") {
    return {
      url: `geo:0,0?q=${encoded}`,
      fallbackUrl,
      coordinateAnchored: false,
    };
  }
  return { url: fallbackUrl, fallbackUrl, coordinateAnchored: false };
}

/**
 * The primary platform URL, or `null` when nothing can honestly be opened.
 * Thin sugar over `buildMapsDeepLink` for callers that do not need the https
 * fallback (they already have their own, or they are on web).
 */
export function buildMapsUrl(params: BuildMapsUrlParams): string | null {
  return buildMapsDeepLink(params)?.url ?? null;
}

/** True when a control bound to this target would actually open something. */
export function canOpenMapsTarget(
  target: MapsOpenTarget | null | undefined,
): boolean {
  if (target === null || target === undefined) return false;
  return (
    normalizeMapsGeo(target.geo) !== null || normalizeLabel(target.label) !== null
  );
}

export interface VenueMapsTargetParams {
  venueName: string | null;
  address: string | null;
  /**
   * The privacy gate. TRUE ⇔ the exact street is withheld from this viewer
   * (`hideAddressUntilTicket` on the ticketed page, `!addressRevealed` on the
   * RSVP page).
   */
  addressHidden: boolean;
  /** The exact pin. NEVER pass `cityGeo` here — see the note below. */
  locationGeo?: MapsGeoPoint | null;
}

/**
 * THE privacy gate + label composition for the "Where you'll be" venue card.
 * One owner, so the address text, the maps control's enabled state, and the
 * link's coordinate can never disagree.
 *
 * Returns `null` — control DISABLED, nothing to open — when the street is
 * hidden, or when there is no venue name to hang the card on.
 *
 * HARD PRIVACY GUARD (#2468). When `addressHidden` is true this returns null
 * BEFORE it ever looks at `locationGeo`, so no code path can turn a
 * hidden-address event into an exact-pin deep link. The server RPC
 * `pg_public_event_by_slug` already nulls `locationGeo` (and supplies `cityGeo`
 * instead) for that case, but the AUTHENTICATED business read path
 * (`publicEventsService`) maps `locationGeo` from the row unconditionally — so
 * the renderer must not trust its own props. This is the second lock.
 *
 * `cityGeo` is deliberately NOT accepted. A city centroid is honest at city
 * zoom on a thumbnail; as a deep link labelled with the venue it would be a
 * confident pin at a place the event is not — fabricated precision
 * (Constitution #9).
 */
export function selectVenueMapsTarget(
  params: VenueMapsTargetParams,
): MapsOpenTarget | null {
  if (params.addressHidden) return null;
  const venueName = normalizeLabel(params.venueName);
  if (venueName === null) return null;
  const address = normalizeLabel(params.address);
  const label = address === null ? venueName : `${venueName}, ${address}`;
  return { label, geo: normalizeMapsGeo(params.locationGeo) };
}

// ===========================================================================
// issue #2508 [maps-app-chooser] — the SAME single owner now also owns the
// PER-APP link, so "which app" can be asked without any call site composing a
// URL. Everything above is untouched: `buildMapsDeepLink` remains the default
// one-shot link and keeps its exact #2468 output.
//
// THE ACCURACY IS NOT NEGOTIABLE. Every branch below anchors on the stored
// coordinate whenever one exists, exactly like `buildMapsDeepLink` — the
// chooser selects the APP, never the accuracy. The free-text forms survive
// only where they already did: as the honest fallback for an offering we hold
// no pin for.
// ===========================================================================

/** The map apps the product can honestly offer. */
export type MapsAppId = "apple" | "google";

export interface MapsAppChoice extends MapsDeepLink {
  id: MapsAppId;
  /** The app's real name, as the user knows it. */
  label: string;
}

export interface BuildMapsAppLinkParams extends BuildMapsUrlParams {
  app: MapsAppId;
}

/** User-facing app names. One owner, so the sheet and the a11y label agree. */
export const MAPS_APP_LABELS: Readonly<Record<MapsAppId, string>> = {
  apple: "Apple Maps",
  google: "Google Maps",
};

/**
 * Apple's documented https form. It is used as the fallback on iOS and as the
 * PRIMARY url on web.
 *
 * WEB DECISION (#2508). `maps://` is unreliable from a browser — a scheme the
 * page cannot verify, which on a desktop browser silently does nothing. That
 * is a dead tap (Constitution #1), so web NEVER emits `maps://`. It emits
 * `https://maps.apple.com/?…`, Apple's own universal link: it opens the Maps
 * app on iOS/macOS and Apple's browser map everywhere else, so the tap always
 * lands somewhere real. Same coordinate, same label, no scheme gamble.
 */
const appleMapsWebUrl = (query: string): string =>
  `https://maps.apple.com/?${query}`;

const appleMapsSchemeUrl = (query: string): string => `maps://?${query}`;

/**
 * Build the link for ONE named app, or `null` when that app cannot honestly
 * open this target on this platform.
 *
 * `null` is a real answer and it is how the Android/Apple case is handled:
 * Apple Maps does not exist on Android, so asking for it there returns null
 * and the caller renders no option (Constitution #1 — never a dead tap, and
 * never a choice that cannot open).
 */
export function buildMapsAppLink(
  params: BuildMapsAppLinkParams,
): MapsAppChoice | null {
  const platform = normalizePlatform(params.platform);
  const geo = normalizeMapsGeo(params.geo);
  const label = normalizeLabel(params.label);
  if (geo === null && label === null) return null;

  const name = MAPS_APP_LABELS[params.app];

  if (params.app === "apple") {
    // Apple Maps is an Apple-platform app. There is no Android build of it and
    // there never has been, so Android gets NO Apple option at all.
    if (platform === "android") return null;

    // No cast: the `geo === null && label === null` case already returned, but
    // the compiler cannot see that across two locals, so both arms are written
    // out and the impossible third arm returns null rather than lying.
    let query: string;
    if (geo !== null) {
      query =
        label === null
          ? `ll=${geo.lat},${geo.lng}`
          : `ll=${geo.lat},${geo.lng}&q=${encodeURIComponent(label)}`;
    } else if (label !== null) {
      query = `q=${encodeURIComponent(label)}`;
    } else {
      return null;
    }
    const fallbackUrl = appleMapsWebUrl(query);
    return {
      id: "apple",
      label: name,
      url: platform === "ios" ? appleMapsSchemeUrl(query) : fallbackUrl,
      fallbackUrl,
      coordinateAnchored: geo !== null,
    };
  }

  // Google. The https form is a universal/app link on BOTH mobile platforms —
  // it opens the Google Maps app when it is installed and the browser when it
  // is not, so it can never dead-tap and it needs no scheme whitelisting.
  if (geo !== null) {
    const pair = `${geo.lat},${geo.lng}`;
    const fallbackUrl = googleSearchUrl(pair);
    return {
      id: "google",
      label: name,
      // Android keeps the `geo:` intent it already shipped in #2468 — byte for
      // byte — because the OS itself disambiguates it across every installed
      // map app, which is strictly better than anything we could draw.
      url:
        platform === "android"
          ? label === null
            ? `geo:${pair}?q=${pair}`
            : `geo:${pair}?q=${pair}(${encodeGeoLabel(label)})`
          : fallbackUrl,
      fallbackUrl,
      coordinateAnchored: true,
    };
  }

  if (label === null) return null;
  const encoded = encodeURIComponent(label);
  const fallbackUrl = googleSearchUrl(encoded);
  return {
    id: "google",
    label: name,
    url: platform === "android" ? `geo:0,0?q=${encoded}` : fallbackUrl,
    fallbackUrl,
    coordinateAnchored: false,
  };
}

/**
 * Every map app that can ACTUALLY open this target on this platform, in the
 * order the user should see them.
 *
 * The list is the whole "no dead taps" contract in one place:
 *   ios      [Apple Maps, Google Maps]  — Apple first, it is the system default
 *   android  [Google Maps]              — Apple Maps does not exist here
 *   web      [Google Maps, Apple Maps]  — both on https, never `maps://`
 *
 * A caller renders a chooser only when this returns MORE THAN ONE entry. One
 * entry means there is nothing to ask: on Android the `geo:` intent already
 * makes the OS offer Google Maps / Waze / anything else installed, and a
 * one-row sheet in front of that would be pure ceremony.
 */
export function listMapsAppChoices(
  params: BuildMapsUrlParams,
): MapsAppChoice[] {
  const platform = normalizePlatform(params.platform);
  const order: MapsAppId[] =
    platform === "ios"
      ? ["apple", "google"]
      : platform === "android"
        ? ["google"]
        : ["google", "apple"];
  const choices: MapsAppChoice[] = [];
  for (const app of order) {
    const choice = buildMapsAppLink({ ...params, app });
    if (choice !== null) choices.push(choice);
  }
  return choices;
}

/**
 * The address text the copy button places on the clipboard, or `null` when
 * there is nothing to copy.
 *
 * IT TAKES THE GATED TARGET, NOT THE RAW ADDRESS. That is the entire privacy
 * design: `selectVenueMapsTarget` already returned `null` for a withheld
 * address, so a hidden-address offering has no target, therefore no copy text,
 * therefore no copy button. The copy affordance cannot be wired to anything
 * the maps link is not already allowed to show (#2489, #2508).
 *
 * It deliberately copies the HUMAN address, not a coordinate or a URL — the
 * whole point is pasting it into Waze, Citymapper, Uber or a message.
 */
export function selectAddressCopyText(
  target: MapsOpenTarget | null | undefined,
): string | null {
  if (target === null || target === undefined) return null;
  return normalizeLabel(target.label);
}
