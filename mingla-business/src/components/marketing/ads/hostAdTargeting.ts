/**
 * #4238 media-buyer — where an ad runs, per app (pure; no React, no I/O).
 *
 * Each app is matched on its own (I-4238-PER-APP-MATCH): a place keeps one
 * id per app, the app's own name for it, a wider area the app offers when it
 * only knows the state, and whether the app could be checked at all
 * (I-4238-ERROR-IS-NOT-MISSING). Nothing here compares one app's name with
 * another's.
 */

import { platformName } from "./hostAdCopy";
import { countryName } from "./hostAdCountries";

export type HostAdApp = "meta" | "tiktok" | "snapchat" | "google" | "reddit";

export type HostAdPlaceKind = "city" | "region" | "pin";

/**
 * One app's wider-area offer the Host can accept ("Use Lagos State on
 * TikTok"). `wholeCountry` marks the place's whole country (TikTok has no
 * smaller area in Nigeria): "Use all of Nigeria on TikTok".
 */
export type HostAdWiderOffer = { id: string; name: string; wholeCountry?: true };

export type HostAdPlace = {
  name: string;
  countryCode: string;
  /** Absent on places saved before #4238 media-buyer: a city. */
  kind?: HostAdPlaceKind;
  /** Absent on places saved before: the ad's shared distance applies. */
  radiusKm?: number;
  /** The id each app will use (accepted wider areas included). */
  refs: Partial<Record<HostAdApp, string>>;
  /** Each app's own name for its match. */
  labels?: Partial<Record<HostAdApp, string>>;
  /** A wider area an app offered and the Host has not accepted yet. */
  offers?: Partial<Record<HostAdApp, HostAdWiderOffer>>;
  /** Apps whose lookup errored (show "Couldn't check <App>. Try again"). */
  errors?: Partial<Record<HostAdApp, true>>;
  /** Apps whose lookup came back empty. */
  missing?: Partial<Record<HostAdApp, true>>;
  /** Apps whose accepted id is a wider area. */
  accepted?: Partial<Record<HostAdApp, true>>;
  /** Apps whose accepted wider area is the place's whole country. */
  wholeCountry?: Partial<Record<HostAdApp, true>>;
};

export type HostAdInterestPick = {
  name: string;
  refs: Partial<Record<HostAdApp, string>>;
  labels?: Partial<Record<HostAdApp, string>>;
  errors?: Partial<Record<HostAdApp, true>>;
  missing?: Partial<Record<HostAdApp, true>>;
};

export type HostAdAvailabilityRow = {
  platform: string;
  country_code: string;
  status: string;
  reason?: string | null;
};

/** Seth's decision: new places start at 17 km (Meta's floor around a city). */
export const HOST_AD_DEFAULT_RADIUS_KM = 17;

/** Mirrors AD_RADIUS_LIMITS_KM in the server compiler. */
export const HOST_AD_RADIUS_LIMITS: Record<
  HostAdApp,
  { city: [number, number]; pin: [number, number] } | null
> = {
  meta: { city: [17, 80], pin: [1, 80] },
  snapchat: { city: [0.1, 100], pin: [0.1, 100] },
  google: { city: [1, 80], pin: [1, 80] },
  tiktok: null,
  reddit: null,
};

/** Apps that look a city or region up in their own list (others don't). */
export const HOST_AD_LOOKUP_APPS: readonly HostAdApp[] = [
  "meta",
  "tiktok",
  "google",
];

export function placeKind(place: Pick<HostAdPlace, "kind">): HostAdPlaceKind {
  return place.kind === "region" || place.kind === "pin" ? place.kind : "city";
}

function normName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

/**
 * The key the server compiler reads ids under. A region or pin is prefixed
 * so it never shares a city's id. Stable across reloads.
 */
export function hostAdPlaceKey(
  place: Pick<HostAdPlace, "name" | "countryCode" | "kind">,
): string {
  const base = `${place.countryCode.trim().toUpperCase()}:${normName(place.name)}`;
  const kind = placeKind(place);
  return kind === "city" ? base : `${kind}:${base}`;
}

export function hostAdInterestKey(name: string): string {
  return normName(name);
}

/** One pending app lookup: which list, the item's key, and the app. */
export type HostAdPendingLookup = {
  list: "include" | "exclude" | "interest";
  key: string;
  app: HostAdApp;
};

/**
 * #4238 r8 P1-4: the pending lookups as one stable string for an effect's
 * dependency list. JSON, never a joined string: a place's key is free text
 * ("pin:NG:landmark beach, oniru, lekki") and may hold any separator.
 */
export function hostAdPendingLookupSignature(
  items: readonly HostAdPendingLookup[],
): string {
  return items.length === 0
    ? ""
    : JSON.stringify(items.map((item) => [item.list, item.key, item.app]));
}

/** The pending lookups back from hostAdPendingLookupSignature. */
export function hostAdPendingLookups(signature: string): HostAdPendingLookup[] {
  if (signature === "") return [];
  const parsed: unknown = JSON.parse(signature);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((row): HostAdPendingLookup[] => {
    if (!Array.isArray(row) || row.length !== 3) return [];
    const [list, key, app] = row as unknown[];
    if (
      (list !== "include" && list !== "exclude" && list !== "interest") ||
      typeof key !== "string" ||
      typeof app !== "string"
    ) {
      return [];
    }
    return [{ list, key, app: app as HostAdApp }];
  });
}

/**
 * #4238 r9 P3: a pin's address parts without a trailing country ("…, Lagos,
 * Nigeria" or "…, Lagos, NG" in Nigeria → […, "Lagos"]). The country is
 * already the place's country; as the last part it would be looked up as a
 * city and shown twice.
 */
export function hostAdPinParts(
  place: Pick<HostAdPlace, "name" | "countryCode">,
): string[] {
  const parts = place.name.split(",").map((part) => part.trim()).filter(Boolean);
  const code = place.countryCode.trim().toUpperCase();
  const names = new Set([code, countryName(code).toUpperCase()]);
  while (parts.length > 1 && names.has(parts[parts.length - 1].toUpperCase())) {
    parts.pop();
  }
  return parts;
}

/** The text an app is asked for: a pin's last part ("…, Lekki" → "Lekki"). */
export function hostAdLookupQuery(
  place: Pick<HostAdPlace, "name" | "kind"> & { countryCode?: string },
): string {
  if (placeKind(place) !== "pin") return place.name.trim();
  const parts = hostAdPinParts({ name: place.name, countryCode: place.countryCode ?? "" });
  return parts[parts.length - 1] ?? place.name.trim();
}

/** "Eko Atlantic, Lagos, Nigeria" in Nigeria → "Eko Atlantic, Lagos, Nigeria" (never "…, Nigeria, Nigeria"). */
export function hostAdPlaceDisplayName(
  place: Pick<HostAdPlace, "name" | "countryCode" | "kind">,
): string {
  const country = countryName(place.countryCode);
  const base = placeKind(place) === "pin"
    ? hostAdPinParts(place).join(", ")
    : place.name.trim();
  // r10: a pin that is only the country reads "Nigeria", never "Nigeria, Nigeria".
  const code = place.countryCode.trim().toUpperCase();
  if (base.toUpperCase() === country.toUpperCase() || base.toUpperCase() === code) {
    return country;
  }
  return `${base}, ${country}`;
}

/** Which apps need an id from their own list for this place. */
export function hostAdPlaceNeedsLookup(
  place: Pick<HostAdPlace, "kind">,
  app: HostAdApp,
): boolean {
  const kind = placeKind(place);
  // A pin is a point the server finds; only TikTok needs a wider area id.
  if (kind === "pin") return app === "tiktok";
  return HOST_AD_LOOKUP_APPS.includes(app);
}

/** The search kind to send for a place on one app. */
export function hostAdLookupKind(
  place: Pick<HostAdPlace, "kind">,
): "city" | "region" {
  return placeKind(place) === "region" ? "region" : "city";
}

export type HostAdSearchResponse = {
  results?: { id: string; name: string; meta?: Record<string, unknown> }[];
  unavailable?: boolean;
  match?: {
    state?: string;
    best?: { id: string; name: string };
    wider?: { id: string; name: string; meta?: Record<string, unknown> };
  };
};

/**
 * "Lagos,Lagos,Nigeria" (Google's own name) → "Lagos, Lagos, Nigeria".
 * Display only: the id each app gets is never touched.
 */
export function hostAdAppPlaceLabel(name: string): string {
  return name
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

/** True when a search's wider answer is the place's whole country. */
function isWholeCountryAnswer(wider: { meta?: Record<string, unknown> } | undefined): boolean {
  return String(wider?.meta?.level ?? "").trim().toUpperCase() === "COUNTRY";
}

/**
 * The name shown for a wider area: "all of Nigeria" for the whole country,
 * else the app's own name ("Lagos State").
 */
export function hostAdWiderAreaName(
  place: Pick<HostAdPlace, "countryCode">,
  area: { name: string; wholeCountry?: boolean },
): string {
  return area.wholeCountry
    ? `all of ${countryName(place.countryCode)}`
    : hostAdAppPlaceLabel(area.name);
}

/** "all of Nigeria" → "All of Nigeria" at the start of a line. */
function sentenceStart(value: string): string {
  return value.charAt(0).toLocaleUpperCase("en-US") + value.slice(1);
}

/**
 * Applies one app's search answer to a place. An error is recorded as an
 * error (never as missing); a wider area is an offer the Host must accept,
 * except for a pin, whose wider area is the only option on TikTok.
 */
export function applyPlaceLookup(
  place: HostAdPlace,
  app: HostAdApp,
  response: HostAdSearchResponse | null,
): HostAdPlace {
  const next: HostAdPlace = {
    ...place,
    refs: { ...place.refs },
    labels: { ...(place.labels ?? {}) },
    offers: { ...(place.offers ?? {}) },
    errors: { ...(place.errors ?? {}) },
    missing: { ...(place.missing ?? {}) },
    accepted: { ...(place.accepted ?? {}) },
    wholeCountry: { ...(place.wholeCountry ?? {}) },
  };
  delete next.refs[app];
  delete next.labels![app];
  delete next.offers![app];
  delete next.errors![app];
  delete next.missing![app];
  delete next.accepted![app];
  delete next.wholeCountry![app];
  if (response === null || response.unavailable === true) {
    next.errors![app] = true;
    return next;
  }
  const match = response.match;
  if (match?.state === "match" && match.best?.id) {
    next.refs[app] = String(match.best.id);
    next.labels![app] = match.best.name;
    if (placeKind(place) === "pin") next.accepted![app] = true;
    return next;
  }
  if (match?.state === "wider" && match.wider?.id) {
    const wholeCountry = isWholeCountryAnswer(match.wider);
    if (placeKind(place) === "pin") {
      next.refs[app] = String(match.wider.id);
      next.labels![app] = match.wider.name;
      next.accepted![app] = true;
      if (wholeCountry) next.wholeCountry![app] = true;
    } else {
      next.offers![app] = {
        id: String(match.wider.id),
        name: match.wider.name,
        ...(wholeCountry ? { wholeCountry: true as const } : {}),
      };
    }
    return next;
  }
  next.missing![app] = true;
  return next;
}

/**
 * The Host taps "Use Lagos State on TikTok (wider area)" or "Use all of
 * Nigeria on TikTok (wider area)": that app targets the wider area; the
 * place stays as it is on every other app.
 */
export function acceptWiderOffer(place: HostAdPlace, app: HostAdApp): HostAdPlace {
  const offer = place.offers?.[app];
  if (!offer) return place;
  const offers = { ...(place.offers ?? {}) };
  delete offers[app];
  const wholeCountry = { ...(place.wholeCountry ?? {}) };
  if (offer.wholeCountry) wholeCountry[app] = true;
  else delete wholeCountry[app];
  return withWholeCountry({
    ...place,
    refs: { ...place.refs, [app]: offer.id },
    labels: { ...(place.labels ?? {}), [app]: offer.name },
    accepted: { ...(place.accepted ?? {}), [app]: true },
    offers,
  }, wholeCountry);
}

function withWholeCountry(
  place: HostAdPlace,
  wholeCountry: Partial<Record<HostAdApp, true>>,
): HostAdPlace {
  const next: HostAdPlace = { ...place };
  if (Object.keys(wholeCountry).length > 0) next.wholeCountry = wholeCountry;
  else delete next.wholeCountry;
  return next;
}

/** "Undo": the wider area goes back to being an offer. */
export function undoWiderOffer(place: HostAdPlace, app: HostAdApp): HostAdPlace {
  if (!place.accepted?.[app] || !place.refs[app] || placeKind(place) === "pin") {
    return place;
  }
  const refs = { ...place.refs };
  const labels = { ...(place.labels ?? {}) };
  const accepted = { ...(place.accepted ?? {}) };
  const wholeCountry = { ...(place.wholeCountry ?? {}) };
  const offer: HostAdWiderOffer = {
    id: refs[app] as string,
    name: labels[app] ?? place.name,
    ...(wholeCountry[app] ? { wholeCountry: true as const } : {}),
  };
  delete refs[app];
  delete labels[app];
  delete accepted[app];
  delete wholeCountry[app];
  return withWholeCountry({
    ...place,
    refs,
    labels,
    accepted,
    offers: { ...(place.offers ?? {}), [app]: offer },
  }, wholeCountry);
}

export function applyInterestLookup(
  interest: HostAdInterestPick,
  app: HostAdApp,
  response: HostAdSearchResponse | null,
): HostAdInterestPick {
  const refs = { ...interest.refs };
  const labels = { ...(interest.labels ?? {}) };
  const errors = { ...(interest.errors ?? {}) };
  const missing = { ...(interest.missing ?? {}) };
  delete refs[app];
  delete labels[app];
  delete errors[app];
  delete missing[app];
  if (response === null || response.unavailable === true) {
    errors[app] = true;
  } else if (response.match?.state === "match" && response.match.best?.id) {
    refs[app] = String(response.match.best.id);
    labels[app] = response.match.best.name;
  } else {
    missing[app] = true;
  }
  return { ...interest, refs, labels, errors, missing };
}

/** Decision (a): the Host picked a different entry from one app's own list. */
export function swapInterestOnApp(
  interest: HostAdInterestPick,
  app: HostAdApp,
  pick: { id: string; name: string },
): HostAdInterestPick {
  const errors = { ...(interest.errors ?? {}) };
  const missing = { ...(interest.missing ?? {}) };
  delete errors[app];
  delete missing[app];
  return {
    ...interest,
    refs: { ...interest.refs, [app]: pick.id },
    labels: { ...(interest.labels ?? {}), [app]: pick.name },
    errors,
    missing,
  };
}

/** Countries (of those chosen) an app is marked as not running in. */
export function hostAdAppBlockedCountries(
  app: string,
  countries: readonly string[],
  availability: readonly HostAdAvailabilityRow[],
): HostAdAvailabilityRow[] {
  return countries.flatMap((country) =>
    availability.filter((row) =>
      row.platform === app &&
      row.country_code.toUpperCase() === country.toUpperCase() &&
      row.status === "not_available"
    )
  );
}

/**
 * "Works here": an app is greyed out when it runs in none of the chosen
 * countries. Unknown pairs work (staff haven't marked them).
 */
export function hostAdAppAvailability(
  app: string,
  countries: readonly string[],
  availability: readonly HostAdAvailabilityRow[],
): { works: boolean; reason: string | null } {
  if (countries.length === 0) return { works: true, reason: null };
  const blocked = hostAdAppBlockedCountries(app, countries, availability);
  if (blocked.length < countries.length) return { works: true, reason: null };
  const names = blocked.map((row) => countryName(row.country_code));
  return {
    works: false,
    reason: blocked.length === 1 && blocked[0].reason
      ? blocked[0].reason
      : `${platformName(app)} doesn't run in ${names.join(" or ")}.`,
  };
}

export type HostAdPlaceAppState =
  | "ok"
  | "accepted"
  | "wider"
  | "offer"
  | "error"
  | "checking"
  | "missing"
  | "radius"
  | "country"
  | "skip";

function radiusLine(app: HostAdApp, place: HostAdPlace, radiusKm: number): string | null {
  const limits = HOST_AD_RADIUS_LIMITS[app];
  const kind = placeKind(place);
  if (!limits || kind === "region") return null;
  const [min, max] = kind === "pin" ? limits.pin : limits.city;
  const around = kind === "pin" ? "a pin" : "a city";
  if (radiusKm < min) {
    return `Needs at least ${min} km around ${around}. Move the distance up, or turn ${platformName(app)} off.`;
  }
  if (radiusKm > max) return `Allows at most ${max} km around ${around}.`;
  return null;
}

/**
 * The plain line one app shows under one place (the design's match rows).
 */
export function hostAdPlaceAppStatus(
  place: HostAdPlace,
  app: HostAdApp,
  context: {
    radiusKm: number;
    availability: readonly HostAdAvailabilityRow[];
    checking?: boolean;
  },
): { state: HostAdPlaceAppState; text: string; offer?: HostAdWiderOffer } {
  const kind = placeKind(place);
  const name = platformName(app);
  const blocked = hostAdAppBlockedCountries(app, [place.countryCode], context.availability);
  if (blocked.length > 0) {
    return {
      state: "country",
      text: `${name} doesn't run in ${countryName(place.countryCode)}.`,
    };
  }
  if (context.checking) return { state: "checking", text: `Checking ${name}…` };
  if (place.errors?.[app]) {
    return { state: "error", text: `Couldn't check ${name}. Try again.` };
  }
  const radius = radiusLine(app, place, context.radiusKm);
  if (radius) return { state: "radius", text: radius };
  if (app === "reddit") {
    return {
      state: "wider",
      text: `Shows across ${countryName(place.countryCode)} (wider area).`,
    };
  }
  if (kind === "pin") {
    if (app === "tiktok") {
      return place.refs.tiktok
        ? {
          state: "wider",
          text: `Uses ${
            place.wholeCountry?.tiktok
              ? hostAdWiderAreaName(place, { name: "", wholeCountry: true })
              : place.labels?.tiktok
              ? hostAdAppPlaceLabel(place.labels.tiktok)
              : "the area around it"
          } (wider area).`,
        }
        : place.missing?.tiktok
        ? {
          state: "missing",
          text: "TikTok has no area for this pin. Turn TikTok off, or add a city.",
        }
        : { state: "checking", text: "Checking TikTok…" };
    }
    if (app === "google") {
      return {
        state: "wider",
        text: `Shows across ${countryName(place.countryCode)} (wider area).`,
      };
    }
    return { state: "ok", text: `Pin, ${context.radiusKm} km.` };
  }
  if (!hostAdPlaceNeedsLookup(place, app)) {
    return {
      state: "ok",
      text: kind === "city" ? `${place.name}, ${context.radiusKm} km` : place.name,
    };
  }
  const offer = place.offers?.[app];
  if (offer) {
    // The chip names the area: "Use all of Nigeria on TikTok (wider area)".
    const shown = { ...offer, name: hostAdWiderAreaName(place, offer) };
    return {
      state: "offer",
      text: offer.wholeCountry
        ? `${name} has no smaller area for ${place.name}.`
        : `${name} only knows ${shown.name}, not ${place.name}.`,
      offer: shown,
    };
  }
  const id = place.refs[app];
  if (id) {
    const label = hostAdAppPlaceLabel(place.labels?.[app] ?? place.name);
    if (place.accepted?.[app]) {
      const area = hostAdWiderAreaName(place, {
        name: label,
        wholeCountry: place.wholeCountry?.[app] === true,
      });
      return { state: "accepted", text: `${sentenceStart(area)} (wider area)` };
    }
    if (app === "tiktok" && kind === "city") {
      return { state: "ok", text: `${label} (whole city, no distance)` };
    }
    return {
      state: "ok",
      text: kind === "city" ? `${label}, ${context.radiusKm} km` : label,
    };
  }
  if (place.missing?.[app]) {
    return {
      state: "missing",
      text: `${name} couldn't find ${place.name}. Remove it, or turn ${name} off.`,
    };
  }
  return { state: "checking", text: `Checking ${name}…` };
}

/** True when an app needs the Host to choose or retry before Check my ad. */
export function hostAdPlaceNeedsAction(state: HostAdPlaceAppState): boolean {
  return state === "offer" || state === "error" || state === "radius" ||
    state === "missing";
}

/** The plain line one app shows under one interest. */
export function hostAdInterestAppStatus(
  interest: HostAdInterestPick,
  app: HostAdApp,
): { state: "ok" | "error" | "missing" | "checking" | "free"; text: string } {
  const name = platformName(app);
  if (app === "reddit") return { state: "free", text: interest.name };
  if (interest.errors?.[app]) {
    return { state: "error", text: `Couldn't check ${name}. Try again.` };
  }
  if (interest.refs[app]) {
    return { state: "ok", text: interest.labels?.[app] ?? interest.name };
  }
  if (interest.missing?.[app]) {
    return {
      state: "missing",
      text: `${name} has nothing like this. Pick a different ${name} interest, or remove it.`,
    };
  }
  return { state: "checking", text: `Checking ${name}…` };
}

/**
 * The plain per-app status Check my ad shows: Ready, Needs a choice,
 * Couldn't check, or Can't run yet.
 */
export function hostAdAppReviewStatus(input: {
  app: HostAdApp;
  verdict: string;
  places: readonly HostAdPlace[];
  interests: readonly HostAdInterestPick[];
  /** The server check's lines; a failed server lookup is "Couldn't check". */
  checks?: readonly string[];
}): "Ready" | "Ready (wider area)" | "Needs a choice" | "Couldn't check" | "Can't run yet" {
  const { app } = input;
  if (
    input.places.some((place) => place.errors?.[app]) ||
    input.interests.some((interest) => interest.errors?.[app]) ||
    (input.checks ?? []).some((line) => /^Couldn't check .+\. Try again\.$/.test(line))
  ) return "Couldn't check";
  if (input.places.some((place) => place.offers?.[app])) return "Needs a choice";
  if (input.verdict === "unavailable") return "Can't run yet";
  if (input.verdict === "check_required") return "Needs a choice";
  if (input.verdict === "broader") return "Ready (wider area)";
  // #4238 live check: an accepted wider area is said plainly, even when the
  // app's own check has nothing else to widen.
  if (input.places.some((place) => place.accepted?.[app] && place.refs[app])) {
    return "Ready (wider area)";
  }
  return "Ready";
}

/**
 * #4238 live check: the Check my ad lines for one app's accepted wider
 * areas ("Lagos: all of Nigeria (wider area)").
 */
export function hostAdAcceptedWiderLines(
  app: HostAdApp,
  places: readonly HostAdPlace[],
): string[] {
  return places.flatMap((place) => {
    if (!place.accepted?.[app] || !place.refs[app]) return [];
    const area = hostAdWiderAreaName(place, {
      name: place.labels?.[app] ?? place.name,
      wholeCountry: place.wholeCountry?.[app] === true,
    });
    const where = placeKind(place) === "pin"
      ? hostAdPinParts(place).join(", ")
      : place.name;
    return [`${where}: ${area} (wider area)`];
  });
}

/**
 * The ids each app gets, keyed the way the server compiler reads them. The
 * apps' ids never move between places: they are read by key, not by order.
 */
export function hostAdRefsForApp(
  app: HostAdApp,
  places: readonly HostAdPlace[],
  interests: readonly HostAdInterestPick[],
  excluded: readonly HostAdPlace[] = [],
  languageIds: Partial<Record<string, string>> = {},
): {
  locationIds?: Record<string, string>;
  interestIds?: Record<string, string>;
  languageIds?: Record<string, string>;
} {
  const locationIds = Object.fromEntries(
    [...places, ...excluded].flatMap((place) => {
      const id = place.refs[app];
      return id ? [[hostAdPlaceKey(place), id]] : [];
    }),
  );
  const interestIds = Object.fromEntries(
    interests.flatMap((interest) => {
      const id = app === "reddit" ? interest.name : interest.refs[app];
      return id ? [[hostAdInterestKey(interest.name), id]] : [];
    }),
  );
  const languages = Object.fromEntries(
    Object.entries(languageIds).flatMap(([code, id]) =>
      typeof id === "string" && id ? [[code, id]] : []
    ),
  );
  return {
    ...(Object.keys(locationIds).length > 0 ? { locationIds } : {}),
    ...(Object.keys(interestIds).length > 0 ? { interestIds } : {}),
    ...(app === "meta" && Object.keys(languages).length > 0
      ? { languageIds: languages }
      : {}),
  };
}

/** A saved place from any earlier draft shape, cleaned (no guessing). */
export function hostAdPlaceFromSaved(value: unknown): HostAdPlace | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const countryCode = typeof row.countryCode === "string"
    ? row.countryCode.trim().toUpperCase()
    : "";
  if (!name || !/^[A-Z]{2}$/.test(countryCode)) return null;
  const record = (input: unknown): Record<string, unknown> =>
    input && typeof input === "object" && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};
  const strings = (input: unknown): Partial<Record<HostAdApp, string>> =>
    Object.fromEntries(
      Object.entries(record(input)).filter(([, v]) => typeof v === "string"),
    ) as Partial<Record<HostAdApp, string>>;
  const flags = (input: unknown): Partial<Record<HostAdApp, true>> =>
    Object.fromEntries(
      Object.entries(record(input)).filter(([, v]) => v === true),
    ) as Partial<Record<HostAdApp, true>>;
  const offers = Object.fromEntries(
    Object.entries(record(row.offers)).flatMap(([app, offer]) => {
      const o = record(offer);
      return typeof o.id === "string" && typeof o.name === "string"
        ? [[app, {
          id: o.id,
          name: o.name,
          ...(o.wholeCountry === true ? { wholeCountry: true as const } : {}),
        }]]
        : [];
    }),
  ) as Partial<Record<HostAdApp, HostAdWiderOffer>>;
  const kind = row.kind === "region" || row.kind === "pin" ? row.kind : undefined;
  const radius = typeof row.radiusKm === "number" && Number.isFinite(row.radiusKm)
    ? row.radiusKm
    : undefined;
  return {
    name,
    countryCode,
    ...(kind ? { kind } : {}),
    ...(radius !== undefined ? { radiusKm: radius } : {}),
    refs: strings(row.refs),
    labels: strings(row.labels),
    offers,
    errors: flags(row.errors),
    missing: flags(row.missing),
    accepted: flags(row.accepted),
    ...(Object.keys(flags(row.wholeCountry)).length > 0
      ? { wholeCountry: flags(row.wholeCountry) }
      : {}),
  };
}

/**
 * #4238 P0 (F-10): what the Host picked, read back from the plan itself.
 * The builder freezes its picks as `targeting_selection` next to the
 * audience; a plan from before that falls back to names only (the apps are
 * looked up again), never to compiled ids by array position.
 */
export function hostAdSelectionsFromCanonical(
  canonical: Record<string, unknown>,
): {
  places: HostAdPlace[];
  excluded: HostAdPlace[];
  interests: HostAdInterestPick[];
} {
  const selection = canonical.targeting_selection;
  const audience = canonical.audience_intent as Record<string, unknown> | undefined;
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const sel = selection && typeof selection === "object" && !Array.isArray(selection)
    ? selection as Record<string, unknown>
    : null;
  const places = list(sel?.places ?? audience?.cities)
    .map(hostAdPlaceFromSaved)
    .filter((place): place is HostAdPlace => place !== null);
  const excluded = list(sel?.excluded ?? audience?.excludedPlaces)
    .map(hostAdPlaceFromSaved)
    .filter((place): place is HostAdPlace => place !== null);
  const interests = list(sel?.interests ?? audience?.interests).flatMap(
    (value): HostAdInterestPick[] => {
      if (!value || typeof value !== "object") return [];
      const row = value as Record<string, unknown>;
      const name = typeof row.name === "string" ? row.name.trim() : "";
      if (!name) return [];
      const refs = row.refs && typeof row.refs === "object"
        ? Object.fromEntries(
          Object.entries(row.refs as Record<string, unknown>).filter(([, v]) =>
            typeof v === "string"
          ),
        )
        : {};
      const labels = row.labels && typeof row.labels === "object"
        ? Object.fromEntries(
          Object.entries(row.labels as Record<string, unknown>).filter(([, v]) =>
            typeof v === "string"
          ),
        )
        : {};
      return [{ name, refs, labels }];
    },
  );
  return { places, excluded, interests };
}

/** Saved state without transient lookup flags. */
export function hostAdPlaceForSave(place: HostAdPlace): HostAdPlace {
  return {
    name: place.name,
    countryCode: place.countryCode,
    ...(place.kind ? { kind: place.kind } : {}),
    ...(place.radiusKm !== undefined ? { radiusKm: place.radiusKm } : {}),
    refs: place.refs,
    ...(place.labels ? { labels: place.labels } : {}),
    ...(place.offers && Object.keys(place.offers).length > 0
      ? { offers: place.offers }
      : {}),
    ...(place.accepted && Object.keys(place.accepted).length > 0
      ? { accepted: place.accepted }
      : {}),
    ...(place.wholeCountry && Object.keys(place.wholeCountry).length > 0
      ? { wholeCountry: place.wholeCountry }
      : {}),
  };
}

export const HOST_AD_PLACE_KIND_LABELS: Record<HostAdPlaceKind, string> = {
  city: "City",
  region: "Region or state",
  pin: "Drop a pin",
};

/** Apps that can leave places out (Meta by its own ids, Snapchat by circles). */
export const HOST_AD_EXCLUDE_APPS: readonly HostAdApp[] = ["meta", "snapchat"];

/** The plain line one app shows under a left-out place. */
export function hostAdExcludedAppStatus(
  place: HostAdPlace,
  app: HostAdApp,
  checking = false,
): { state: HostAdPlaceAppState; text: string } {
  const name = platformName(app);
  if (!HOST_AD_EXCLUDE_APPS.includes(app)) {
    return {
      state: "wider",
      text: `${name} can't leave out places, so it may show your ad there too.`,
    };
  }
  if (app === "snapchat") return { state: "ok", text: "Left out" };
  if (checking) return { state: "checking", text: `Checking ${name}…` };
  if (place.errors?.[app]) {
    return { state: "error", text: `Couldn't check ${name}. Try again.` };
  }
  if (place.refs[app]) return { state: "ok", text: "Left out" };
  if (place.missing?.[app]) {
    return { state: "missing", text: `${name} couldn't find ${place.name} to leave out.` };
  }
  return { state: "checking", text: `Checking ${name}…` };
}

/** Languages a Host can pick (English by default means: no limit set). */
export const HOST_AD_LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  ar: "Arabic",
  pt: "Portuguese",
  es: "Spanish",
};
