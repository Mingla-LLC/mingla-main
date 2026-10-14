import {
  createPublicParityContract,
  type PublicParityAuthState,
  type PublicParityCanonicalIdentity,
  type PublicParitySurface,
} from "@mingla/offering-rendering/publicParityContract";

export type ExplorerPublicTarget =
  | { kind: "brand"; entityId: string; brandSlug: string }
  | {
      kind: "venue";
      entityId: string;
      brandSlug: string;
      venueSlug: string;
    }
  | {
      kind: "event";
      entityKind: "event" | "rsvp";
      entityId: string;
      brandSlug: string;
      eventSlug: string;
    }
  | {
      kind: "trip";
      entityId: string;
      brandSlug: string;
      tripSlug: string;
    }
  | {
      kind: "experience";
      entityId: string;
      brandSlug: string;
      experienceSlug: string;
    }
  | { kind: "stay"; entityId: string; groupId: string }
  | {
      kind: "opaque-share";
      entityId: string;
      shareId: string;
      cardKind: "unresolved" | "place" | "curated";
    }
  | {
      kind: "content-share";
      entityId: string;
      code: string;
      contentKind: "unresolved" | "place" | "curated";
    };

export interface ExplorerPublicPathContext {
  platform: unknown;
  authState: PublicParityAuthState;
}

const surfaceForPlatform = (
  platform: unknown,
): PublicParitySurface | null => {
  if (platform === "ios") return "explorer-ios";
  if (platform === "android") return "explorer-android";
  return null;
};

const identityForTarget = (
  target: ExplorerPublicTarget,
): PublicParityCanonicalIdentity => {
  switch (target.kind) {
    case "brand":
      return {
        kind: "brand",
        entityId: target.entityId,
        route: { ...target },
      };
    case "venue":
      return {
        kind: "venue",
        entityId: target.entityId,
        route: { ...target },
      };
    case "event":
      return {
        kind: target.entityKind,
        entityId: target.entityId,
        route: { ...target },
      };
    case "trip":
      return {
        kind: "trip",
        entityId: target.entityId,
        route: { ...target },
      };
    case "experience":
      return {
        kind: "experience",
        entityId: target.entityId,
        route: { ...target },
      };
    case "stay":
      return {
        kind: "stay",
        entityId: target.entityId,
        route: { ...target },
      };
    case "opaque-share":
      return {
        kind: "opaque-share",
        entityId: target.entityId,
        route: { ...target },
      };
    case "content-share":
      return {
        kind: "content-share",
        entityId: target.entityId,
        route: { ...target, destination: null },
      };
  }
};

const visibilityForTarget = (
  target: ExplorerPublicTarget,
): "public" | "exact-link" | "protected" => {
  if (target.kind === "stay") return "protected";
  if (target.kind === "opaque-share" || target.kind === "content-share") {
    return "exact-link";
  }
  return "public";
};

const pathForIdentity = (
  identity: PublicParityCanonicalIdentity,
): string | null => {
  switch (identity.route.kind) {
    case "brand":
      return `/b/${identity.route.brandSlug}`;
    case "venue":
      return `/b/${identity.route.brandSlug}/v/${identity.route.venueSlug}`;
    case "event":
      return `/e/${identity.route.brandSlug}/${identity.route.eventSlug}`;
    case "trip":
      return `/t/${identity.route.brandSlug}/${identity.route.tripSlug}`;
    case "experience":
      return `/exp/${identity.route.brandSlug}/${identity.route.experienceSlug}`;
    case "stay":
      return `/stay/${identity.route.groupId}`;
    case "opaque-share":
      return `/p/${identity.route.shareId}`;
    case "content-share":
      return `/s/${identity.route.code}`;
  }
};

/**
 * Validate a Mingla-owned native destination through the shared parity
 * contract before handing it to Expo Router. Invalid or unknown identity is a
 * dead end; the adapter never falls back to Host web.
 */
export function resolveExplorerPublicPath(
  target: ExplorerPublicTarget,
  context: ExplorerPublicPathContext,
): string | null {
  const surface = surfaceForPlatform(context.platform);
  if (surface === null) return null;
  if (target === null || typeof target !== "object" || Array.isArray(target)) {
    return null;
  }
  if (
    ![
      "brand",
      "venue",
      "event",
      "trip",
      "experience",
      "stay",
      "opaque-share",
      "content-share",
    ].includes((target as { kind?: unknown }).kind as string)
  ) return null;
  const identity = identityForTarget(target);
  const result = createPublicParityContract({
    schemaVersion: 1,
    identity,
    visibility: visibilityForTarget(target),
    state:
      (target.kind === "opaque-share" && target.cardKind === "unresolved") ||
        (target.kind === "content-share" && target.contentKind === "unresolved")
        ? "loading"
        : "populated",
    capabilities: [],
    actions: [],
    analytics: { surface, authState: context.authState },
  });
  return result.ok ? pathForIdentity(result.model.identity) : null;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const matchesKeys = (
  row: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const keys = Object.keys(row);
  return keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(row, key));
};

export interface ExplorerCalendarOrderTarget {
  eventId: unknown;
  eventType: unknown;
  brandSlug: unknown;
  eventSlug: unknown;
}

/**
 * Turn the canonical event facts already loaded for a purchased ticket into
 * the matching native Explorer destination. Unknown types or incomplete
 * identity fail closed; this recovery path never guesses or opens Host web.
 */
export function resolveExplorerCalendarOrderPath(
  entry: ExplorerCalendarOrderTarget,
  context: ExplorerPublicPathContext,
): string | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }
  const { eventId, eventType, brandSlug, eventSlug } = entry;
  if (
    typeof eventId !== "string" || typeof brandSlug !== "string" ||
    typeof eventSlug !== "string"
  ) return null;

  switch (eventType) {
    case "event":
    case "rsvp":
      return resolveExplorerPublicPath({
        kind: "event",
        entityKind: eventType,
        entityId: eventId,
        brandSlug,
        eventSlug,
      }, context);
    case "trip":
      return resolveExplorerPublicPath({
        kind: "trip",
        entityId: eventId,
        brandSlug,
        tripSlug: eventSlug,
      }, context);
    case "experience":
      return resolveExplorerPublicPath({
        kind: "experience",
        entityId: eventId,
        brandSlug,
        experienceSlug: eventSlug,
      }, context);
    default:
      return null;
  }
}

/**
 * Accept only the canonical internal continuation returned by the share
 * service. The kind, route fields, and server webPath must agree exactly; the
 * client does not guess a destination from partial slugs.
 */
export function resolveExplorerContentShareDestination(
  shortCode: unknown,
  factsKind: unknown,
  destination: unknown,
  context: ExplorerPublicPathContext,
): string | null {
  const shareRoute = resolveExplorerPublicPath(
    {
      kind: "content-share",
      entityId: typeof shortCode === "string" ? shortCode : "",
      code: typeof shortCode === "string" ? shortCode : "",
      contentKind: "unresolved",
    },
    context,
  );
  if (shareRoute === null) return null;

  const row = asRecord(destination);
  if (row === null || row.kind !== factsKind) return null;
  const brandSlug = row.brandSlug;
  const eventSlug = row.eventSlug;
  const venueSlug = row.venueSlug;
  const webPath = row.webPath;
  if (typeof webPath !== "string") return null;

  if (factsKind === "brand") {
    return matchesKeys(row, ["kind", "brandSlug", "webPath"]) &&
        typeof brandSlug === "string" && SLUG_RE.test(brandSlug) &&
        webPath === `/b/${brandSlug}`
      ? webPath
      : null;
  }
  if (factsKind === "venue") {
    return matchesKeys(row, ["kind", "brandSlug", "venueSlug", "webPath"]) &&
        typeof brandSlug === "string" && SLUG_RE.test(brandSlug) &&
        typeof venueSlug === "string" && SLUG_RE.test(venueSlug) &&
        webPath === `/b/${brandSlug}/v/${venueSlug}`
      ? webPath
      : null;
  }
  if (
    factsKind === "event" || factsKind === "rsvp_event" ||
    factsKind === "trip" || factsKind === "experience"
  ) {
    if (
      !matchesKeys(row, ["kind", "brandSlug", "eventSlug", "webPath"]) ||
      typeof brandSlug !== "string" || !SLUG_RE.test(brandSlug) ||
      typeof eventSlug !== "string" || !SLUG_RE.test(eventSlug)
    ) return null;
    const prefix = factsKind === "trip"
      ? "/t"
      : factsKind === "experience"
        ? "/exp"
        : "/e";
    const expected = `${prefix}/${brandSlug}/${eventSlug}`;
    return webPath === expected ? webPath : null;
  }
  return null;
}
