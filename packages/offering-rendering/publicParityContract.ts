/**
 * Issue #3859 — pure public-page parity semantics.
 *
 * Host adapters map their existing anonymous-safe readers into this contract.
 * The contract owns no read, navigation, authentication, analytics transport,
 * or provider effect. Unknown input fails closed and is never echoed back.
 */

// Kept as a literal so this leaf contract is directly Deno-checkable while
// remaining valid for Metro's extensionless bundler resolution. The issue
// regression test compares it to the slice-1 authority to prevent drift.
const INSTALLMENT_CAPABILITY_UNAVAILABLE =
  "installment_capability_unavailable" as const;

export const PUBLIC_PARITY_PAGE_KINDS = [
  "brand",
  "venue",
  "event",
  "rsvp",
  "trip",
  "experience",
  "stay",
  "opaque-share",
  "content-share",
] as const;

export type PublicParityPageKind = (typeof PUBLIC_PARITY_PAGE_KINDS)[number];

export const PUBLIC_PARITY_LIFECYCLE_STATES = [
  "loading",
  "empty",
  "error",
  "stale",
  "offline",
  "not-found",
  "withdrawn",
  "permission-denied",
  "populated",
] as const;

export type PublicParityLifecycleState =
  (typeof PUBLIC_PARITY_LIFECYCLE_STATES)[number];

export const PUBLIC_PARITY_ANALYTICS_EVENTS = [
  "public_page_viewed",
  "public_content_selected",
  "public_auth_handoff_started",
  "public_auth_handoff_returned",
  "checkout_started",
  "checkout_provider_presented",
  "checkout_provider_cancelled",
  "checkout_pending",
  "purchase_completed",
  "checkout_failed",
  "checkout_retry_selected",
  "checkout_recovered",
] as const;

export type PublicParityAnalyticsEvent =
  (typeof PUBLIC_PARITY_ANALYTICS_EVENTS)[number];

export const PUBLIC_PARITY_CAPABILITY_KINDS = [
  "share",
  "follow",
  "open-content",
  "menu",
  "map",
  "contact",
  "reservation",
  "rsvp",
  "select-occurrence",
  "select-tier",
  "select-package",
  "quantity",
  "installments",
  "intake",
  "checkout",
  "view-reservation",
  "pay-balance",
  "retry",
  "cancel",
  "view-share",
] as const;

export type PublicParityCapabilityKind =
  (typeof PUBLIC_PARITY_CAPABILITY_KINDS)[number];

export const PUBLIC_PARITY_DISABLED_REASONS = [
  "not-available",
  "closed",
  "sold-out",
  "withdrawn",
  "permission-denied",
  "offline",
  "revalidation-required",
  "authentication-required",
  "provider-unavailable",
  INSTALLMENT_CAPABILITY_UNAVAILABLE,
  "missing-selection",
  "missing-required-information",
] as const;

export type PublicParityDisabledReason =
  (typeof PUBLIC_PARITY_DISABLED_REASONS)[number];

export interface PublicParityCapability {
  kind: PublicParityCapabilityKind;
  enabled: boolean;
  disabledReason: PublicParityDisabledReason | null;
}

export type PublicParityVisibility = "public" | "exact-link" | "protected";

export type PublicParityRouteIdentity =
  | {
    kind: "brand";
    entityId: string;
    brandSlug: string;
  }
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
    contentKind:
      | "unresolved"
      | "place"
      | "curated"
      | "brand"
      | "venue"
      | "event"
      | "rsvp"
      | "trip"
      | "experience";
    destination: PublicParityCanonicalIdentity | null;
  };

export interface PublicParityCanonicalIdentity {
  kind: PublicParityPageKind;
  entityId: string;
  route: PublicParityRouteIdentity;
}

export type PublicParityExternalOwner =
  | "maps"
  | "telephone"
  | "merchant"
  | "payment-provider"
  | "social"
  | "support";

export type PublicParityActionTarget =
  | { kind: "self" }
  | { kind: "page"; identity: PublicParityCanonicalIdentity }
  | { kind: "external"; owner: PublicParityExternalOwner };

export type PublicParitySelectionKind =
  | "occurrence"
  | "tier"
  | "package"
  | "quantity"
  | "rsvp-response"
  | "intake"
  | "plan"
  | "reservation"
  | "card";

export interface PublicParitySelection {
  kind: PublicParitySelectionKind;
  id: string;
}

export type PublicParityTerminalExpectation =
  | "canonical-view"
  | "selection"
  | "share-sheet"
  | "external-return"
  | "server-terminal";

export interface PublicParityAction {
  id: string;
  kind: PublicParityCapabilityKind;
  target: PublicParityActionTarget;
  auth: "none" | "required";
  terminal: PublicParityTerminalExpectation;
  requiresRevalidation: boolean;
  selection: PublicParitySelection | null;
}

export type PublicParitySurface =
  | "buyer-web"
  | "explorer-ios"
  | "explorer-android"
  | "business-web-preview"
  | "business-ios"
  | "business-android";

export type PublicParityAuthState = "anonymous" | "signed-in" | "unknown";

export interface PublicParityAnalyticsContext {
  surface: PublicParitySurface;
  page_family: PublicParityPageKind;
  entity_id: string;
  entity_kind: PublicParityPageKind;
  route_kind: PublicParityRouteIdentity["kind"];
  initial_state: PublicParityLifecycleState;
  auth_state: PublicParityAuthState;
}

export interface PublicParityAccessibilitySemantics {
  identityKind: PublicParityPageKind;
  lifecycleState: PublicParityLifecycleState;
  busy: boolean;
  disabledReasons: readonly PublicParityDisabledReason[];
}

export interface PublicParityContract {
  schemaVersion: 1;
  identity: PublicParityCanonicalIdentity;
  visibility: PublicParityVisibility;
  state: PublicParityLifecycleState;
  capabilities: readonly PublicParityCapability[];
  actions: readonly PublicParityAction[];
  analyticsContext: PublicParityAnalyticsContext;
  accessibility: PublicParityAccessibilitySemantics;
}

export type PublicParityFailureReason =
  | "invalid-input"
  | "invalid-identity"
  | "invalid-visibility"
  | "invalid-state"
  | "invalid-capability"
  | "invalid-action"
  | "invalid-analytics-context"
  | "invalid-family-contract";

export type PublicParityContractResult =
  | { ok: true; model: PublicParityContract }
  | {
    ok: false;
    state: "not-found" | "error";
    reason: PublicParityFailureReason;
  };

export interface PublicParityAuthReturnIntent {
  schemaVersion: 1;
  identity: PublicParityCanonicalIdentity;
  action: Pick<PublicParityAction, "id" | "kind" | "target" | "selection">;
  revalidateBeforeResume: true;
}

const PAGE_KIND_SET = new Set<string>(PUBLIC_PARITY_PAGE_KINDS);
const STATE_SET = new Set<string>(PUBLIC_PARITY_LIFECYCLE_STATES);
const CAPABILITY_SET = new Set<string>(PUBLIC_PARITY_CAPABILITY_KINDS);
const DISABLED_REASON_SET = new Set<string>(PUBLIC_PARITY_DISABLED_REASONS);

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTENT_SHARE_CODE_RE = /^[0-9A-Za-z]{16}$/;

const SURFACES = new Set<PublicParitySurface>([
  "buyer-web",
  "explorer-ios",
  "explorer-android",
  "business-web-preview",
  "business-ios",
  "business-android",
]);
const AUTH_STATES = new Set<PublicParityAuthState>([
  "anonymous",
  "signed-in",
  "unknown",
]);
const VISIBILITIES = new Set<PublicParityVisibility>([
  "public",
  "exact-link",
  "protected",
]);
const EXTERNAL_OWNERS = new Set<PublicParityExternalOwner>([
  "maps",
  "telephone",
  "merchant",
  "payment-provider",
  "social",
  "support",
]);
const SELECTION_KINDS = new Set<PublicParitySelectionKind>([
  "occurrence",
  "tier",
  "package",
  "quantity",
  "rsvp-response",
  "intake",
  "plan",
  "reservation",
  "card",
]);
const TERMINAL_EXPECTATIONS = new Set<PublicParityTerminalExpectation>([
  "canonical-view",
  "selection",
  "share-sheet",
  "external-return",
  "server-terminal",
]);

const ALLOWED_CAPABILITIES: Readonly<
  Record<PublicParityPageKind, ReadonlySet<PublicParityCapabilityKind>>
> = {
  brand: new Set(["share", "follow", "open-content", "contact"]),
  venue: new Set([
    "share",
    "open-content",
    "menu",
    "map",
    "contact",
    "reservation",
  ]),
  event: new Set([
    "share",
    "select-occurrence",
    "select-tier",
    "quantity",
    "checkout",
  ]),
  rsvp: new Set(["share", "select-occurrence", "rsvp"]),
  trip: new Set([
    "share",
    "select-package",
    "quantity",
    "installments",
    "intake",
    "checkout",
  ]),
  experience: new Set([
    "share",
    "select-occurrence",
    "select-tier",
    "quantity",
    "checkout",
  ]),
  stay: new Set(["view-reservation", "pay-balance", "retry", "cancel"]),
  "opaque-share": new Set(["view-share", "retry"]),
  "content-share": new Set([
    "view-share",
    "open-content",
    "retry",
    "contact",
  ]),
};

const TERMINAL_NO_ACTION_STATES = new Set<PublicParityLifecycleState>([
  "not-found",
  "withdrawn",
  "permission-denied",
]);
const OFFLINE_SAFE_CAPABILITIES = new Set<PublicParityCapabilityKind>([
  "share",
  "open-content",
  "view-reservation",
  "view-share",
  "retry",
]);
const REVALIDATED_CAPABILITIES = new Set<PublicParityCapabilityKind>([
  "follow",
  "reservation",
  "rsvp",
  "select-occurrence",
  "select-tier",
  "select-package",
  "quantity",
  "installments",
  "intake",
  "checkout",
  "pay-balance",
  "cancel",
]);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const keys = Object.keys(value);
  return keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
};

const isSafeId = (value: unknown): value is string =>
  typeof value === "string" && SAFE_ID_RE.test(value);

const isSlug = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 128 && SLUG_RE.test(value);

const isPageKind = (value: unknown): value is PublicParityPageKind =>
  typeof value === "string" && PAGE_KIND_SET.has(value);

const isLifecycleState = (
  value: unknown,
): value is PublicParityLifecycleState =>
  typeof value === "string" && STATE_SET.has(value);

const parseRouteIdentity = (
  value: unknown,
  pageKind: PublicParityPageKind,
  entityId: string,
): PublicParityRouteIdentity | null => {
  const route = asRecord(value);
  if (route === null || route.entityId !== entityId) return null;

  switch (pageKind) {
    case "brand":
      return hasExactKeys(route, ["kind", "entityId", "brandSlug"]) &&
          route.kind === "brand" && isSlug(route.brandSlug)
        ? { kind: "brand", entityId, brandSlug: route.brandSlug }
        : null;
    case "venue":
      return hasExactKeys(route, [
          "kind",
          "entityId",
          "brandSlug",
          "venueSlug",
        ]) &&
          route.kind === "venue" && isSlug(route.brandSlug) &&
          isSlug(route.venueSlug)
        ? {
          kind: "venue",
          entityId,
          brandSlug: route.brandSlug,
          venueSlug: route.venueSlug,
        }
        : null;
    case "event":
    case "rsvp":
      return hasExactKeys(route, [
          "kind",
          "entityKind",
          "entityId",
          "brandSlug",
          "eventSlug",
        ]) &&
          route.kind === "event" && route.entityKind === pageKind &&
          isSlug(route.brandSlug) && isSlug(route.eventSlug)
        ? {
          kind: "event",
          entityKind: pageKind,
          entityId,
          brandSlug: route.brandSlug,
          eventSlug: route.eventSlug,
        }
        : null;
    case "trip":
      return hasExactKeys(route, [
          "kind",
          "entityId",
          "brandSlug",
          "tripSlug",
        ]) &&
          route.kind === "trip" && isSlug(route.brandSlug) &&
          isSlug(route.tripSlug)
        ? {
          kind: "trip",
          entityId,
          brandSlug: route.brandSlug,
          tripSlug: route.tripSlug,
        }
        : null;
    case "experience":
      return hasExactKeys(route, [
          "kind",
          "entityId",
          "brandSlug",
          "experienceSlug",
        ]) &&
          route.kind === "experience" && isSlug(route.brandSlug) &&
          isSlug(route.experienceSlug)
        ? {
          kind: "experience",
          entityId,
          brandSlug: route.brandSlug,
          experienceSlug: route.experienceSlug,
        }
        : null;
    case "stay":
      return hasExactKeys(route, ["kind", "entityId", "groupId"]) &&
          route.kind === "stay" && route.groupId === entityId &&
          UUID_RE.test(entityId)
        ? { kind: "stay", entityId, groupId: entityId }
        : null;
    case "opaque-share":
      return hasExactKeys(route, [
          "kind",
          "entityId",
          "shareId",
          "cardKind",
        ]) &&
          route.kind === "opaque-share" && route.shareId === entityId &&
          UUID_RE.test(entityId) &&
          (route.cardKind === "unresolved" || route.cardKind === "place" ||
            route.cardKind === "curated")
        ? {
          kind: "opaque-share",
          entityId,
          shareId: entityId,
          cardKind: route.cardKind,
        }
        : null;
    case "content-share": {
      const contentKinds = new Set([
        "unresolved",
        "place",
        "curated",
        "brand",
        "venue",
        "event",
        "rsvp",
        "trip",
        "experience",
      ]);
      if (
        !(
          hasExactKeys(route, [
            "kind",
            "entityId",
            "code",
            "contentKind",
            "destination",
          ]) &&
          route.kind === "content-share" && route.code === entityId &&
          CONTENT_SHARE_CODE_RE.test(entityId) &&
          typeof route.contentKind === "string" &&
          contentKinds.has(route.contentKind)
        )
      ) {
        return null;
      }
      const contentKind = route.contentKind as Extract<
        PublicParityRouteIdentity,
        { kind: "content-share" }
      >["contentKind"];
      let destination: PublicParityCanonicalIdentity | null = null;
      if (
        contentKind !== "unresolved" && contentKind !== "place" &&
        contentKind !== "curated"
      ) {
        const destinationSource = asRecord(route.destination);
        if (destinationSource?.kind !== contentKind) return null;
        destination = parseIdentity(route.destination);
        if (destination === null || destination.kind !== contentKind) {
          return null;
        }
      } else if (route.destination !== null) {
        return null;
      }
      return {
        kind: "content-share",
        entityId,
        code: entityId,
        contentKind,
        destination,
      };
    }
  }
};

const parseIdentity = (
  value: unknown,
): PublicParityCanonicalIdentity | null => {
  const identity = asRecord(value);
  if (
    identity === null ||
    !hasExactKeys(identity, ["kind", "entityId", "route"]) ||
    !isPageKind(identity.kind) ||
    !isSafeId(identity.entityId)
  ) return null;
  const route = parseRouteIdentity(
    identity.route,
    identity.kind,
    identity.entityId,
  );
  return route === null
    ? null
    : { kind: identity.kind, entityId: identity.entityId, route };
};

const parseCapability = (value: unknown): PublicParityCapability | null => {
  const capability = asRecord(value);
  if (
    capability === null ||
    !hasExactKeys(capability, ["kind", "enabled", "disabledReason"]) ||
    typeof capability.kind !== "string" ||
    !CAPABILITY_SET.has(capability.kind) ||
    typeof capability.enabled !== "boolean"
  ) return null;
  if (capability.enabled && capability.disabledReason !== null) return null;
  if (
    !capability.enabled &&
    (typeof capability.disabledReason !== "string" ||
      !DISABLED_REASON_SET.has(capability.disabledReason))
  ) return null;
  return {
    kind: capability.kind as PublicParityCapabilityKind,
    enabled: capability.enabled,
    disabledReason: capability.disabledReason as
      | PublicParityDisabledReason
      | null,
  };
};

const parseSelection = (value: unknown): PublicParitySelection | null => {
  const selection = asRecord(value);
  return selection !== null && hasExactKeys(selection, ["kind", "id"]) &&
      typeof selection.kind === "string" &&
      SELECTION_KINDS.has(selection.kind as PublicParitySelectionKind) &&
      isSafeId(selection.id)
    ? {
      kind: selection.kind as PublicParitySelectionKind,
      id: selection.id,
    }
    : null;
};

const parseTarget = (value: unknown): PublicParityActionTarget | null => {
  const target = asRecord(value);
  if (target === null || typeof target.kind !== "string") return null;
  if (target.kind === "self") {
    return hasExactKeys(target, ["kind"]) ? { kind: "self" } : null;
  }
  if (target.kind === "page") {
    if (!hasExactKeys(target, ["kind", "identity"])) return null;
    const identity = parseIdentity(target.identity);
    return identity === null ? null : { kind: "page", identity };
  }
  if (target.kind === "external") {
    return hasExactKeys(target, ["kind", "owner"]) &&
        typeof target.owner === "string" &&
        EXTERNAL_OWNERS.has(target.owner as PublicParityExternalOwner)
      ? {
        kind: "external",
        owner: target.owner as PublicParityExternalOwner,
      }
      : null;
  }
  return null;
};

const targetMatchesAction = (
  kind: PublicParityCapabilityKind,
  target: PublicParityActionTarget,
): boolean => {
  if (kind === "open-content") return target.kind === "page";
  if (kind === "map") {
    return target.kind === "external" && target.owner === "maps";
  }
  if (kind === "contact") {
    return target.kind === "external" &&
      ["telephone", "merchant", "social", "support"].includes(target.owner);
  }
  if (kind === "reservation") {
    return target.kind === "self" ||
      (target.kind === "external" && target.owner === "merchant");
  }
  return target.kind === "self";
};

const parseAction = (value: unknown): PublicParityAction | null => {
  const action = asRecord(value);
  if (
    action === null ||
    !hasExactKeys(action, [
      "id",
      "kind",
      "target",
      "auth",
      "terminal",
      "requiresRevalidation",
      "selection",
    ]) ||
    !isSafeId(action.id) ||
    typeof action.kind !== "string" ||
    !CAPABILITY_SET.has(action.kind) ||
    (action.auth !== "none" && action.auth !== "required") ||
    typeof action.terminal !== "string" ||
    !TERMINAL_EXPECTATIONS.has(
      action.terminal as PublicParityTerminalExpectation,
    ) ||
    typeof action.requiresRevalidation !== "boolean"
  ) return null;
  const target = parseTarget(action.target);
  const selection = action.selection === null
    ? null
    : parseSelection(action.selection);
  const kind = action.kind as PublicParityCapabilityKind;
  if (
    target === null ||
    (action.selection !== null && selection === null) ||
    !targetMatchesAction(kind, target)
  ) return null;
  return {
    id: action.id,
    kind,
    target,
    auth: action.auth,
    terminal: action.terminal as PublicParityTerminalExpectation,
    requiresRevalidation: action.requiresRevalidation,
    selection,
  };
};

const visibilityMatchesFamily = (
  kind: PublicParityPageKind,
  visibility: PublicParityVisibility,
): boolean => {
  if (kind === "stay") return visibility === "protected";
  if (kind === "opaque-share" || kind === "content-share") {
    return visibility === "exact-link";
  }
  if (kind === "event" || kind === "rsvp") {
    return visibility === "public" || visibility === "exact-link";
  }
  return visibility === "public";
};

const contentShareContinuationMatches = (
  identity: PublicParityCanonicalIdentity,
  state: PublicParityLifecycleState,
  actions: readonly PublicParityAction[],
  capabilities: readonly PublicParityCapability[],
): boolean => {
  if (identity.kind !== "content-share") return true;
  const route = identity.route as Extract<
    PublicParityRouteIdentity,
    { kind: "content-share" }
  >;
  const continuation = capabilities.find((item) =>
    item.kind === "open-content"
  );
  const publicTargetKinds = new Set<PublicParityPageKind>([
    "brand",
    "venue",
    "event",
    "rsvp",
    "trip",
    "experience",
  ]);
  if (
    route.contentKind === "unresolved" || route.contentKind === "place" ||
    route.contentKind === "curated"
  ) {
    if (
      route.contentKind === "unresolved" &&
      (state === "populated" || state === "stale")
    ) return false;
    return continuation === undefined &&
      actions.every((action) => action.kind !== "open-content");
  }
  if (
    !publicTargetKinds.has(route.contentKind) || route.destination === null
  ) return false;
  if (continuation === undefined) return false;
  return actions.some((action) =>
    action.kind === "open-content" && action.target.kind === "page" &&
    action.target.identity.kind === route.contentKind &&
    JSON.stringify(action.target.identity) === JSON.stringify(route.destination)
  );
};

const familyContractIsValid = (
  identity: PublicParityCanonicalIdentity,
  state: PublicParityLifecycleState,
  capabilities: readonly PublicParityCapability[],
  actions: readonly PublicParityAction[],
): boolean => {
  const allowed = ALLOWED_CAPABILITIES[identity.kind];
  if (capabilities.some((capability) => !allowed.has(capability.kind))) {
    return false;
  }
  if (
    new Set(capabilities.map((item) => item.kind)).size !== capabilities.length
  ) {
    return false;
  }
  if (new Set(actions.map((item) => item.id)).size !== actions.length) {
    return false;
  }
  const byKind = new Map(capabilities.map((item) => [item.kind, item]));
  if (actions.some((action) => !byKind.has(action.kind))) return false;

  if (state === "loading" && (capabilities.length > 0 || actions.length > 0)) {
    return false;
  }
  if (
    TERMINAL_NO_ACTION_STATES.has(state) &&
    (capabilities.length > 0 || actions.length > 0)
  ) return false;
  if (
    state === "error" &&
    capabilities.some((capability) => capability.kind !== "retry")
  ) return false;
  if (
    state === "offline" &&
    capabilities.some((capability) =>
      capability.enabled && !OFFLINE_SAFE_CAPABILITIES.has(capability.kind)
    )
  ) return false;
  if (
    state === "stale" &&
    actions.some((action) =>
      byKind.get(action.kind)?.enabled === true &&
      REVALIDATED_CAPABILITIES.has(action.kind) &&
      !action.requiresRevalidation
    )
  ) return false;

  return contentShareContinuationMatches(
    identity,
    state,
    actions,
    capabilities,
  );
};

const failure = (
  reason: PublicParityFailureReason,
  state: "not-found" | "error" = "error",
): PublicParityContractResult => ({ ok: false, state, reason });

/**
 * Build a normalized, serializable public-page contract from host-mapped input.
 * Extra fields are rejected, so contact/provider/URL payloads cannot hitchhike
 * into auth return or analytics state.
 */
export function createPublicParityContract(
  input: unknown,
): PublicParityContractResult {
  const source = asRecord(input);
  if (
    source === null ||
    !hasExactKeys(source, [
      "schemaVersion",
      "identity",
      "visibility",
      "state",
      "capabilities",
      "actions",
      "analytics",
    ]) ||
    source.schemaVersion !== 1
  ) return failure("invalid-input");

  const identity = parseIdentity(source.identity);
  if (identity === null) return failure("invalid-identity", "not-found");
  if (
    typeof source.visibility !== "string" ||
    !VISIBILITIES.has(source.visibility as PublicParityVisibility)
  ) return failure("invalid-visibility");
  const visibility = source.visibility as PublicParityVisibility;
  if (!visibilityMatchesFamily(identity.kind, visibility)) {
    return failure("invalid-visibility");
  }
  if (!isLifecycleState(source.state)) return failure("invalid-state");
  if (!Array.isArray(source.capabilities)) {
    return failure("invalid-capability");
  }
  const capabilities = source.capabilities.map(parseCapability);
  if (capabilities.some((item) => item === null)) {
    return failure("invalid-capability");
  }
  if (!Array.isArray(source.actions)) return failure("invalid-action");
  const actions = source.actions.map(parseAction);
  if (actions.some((item) => item === null)) return failure("invalid-action");

  const analytics = asRecord(source.analytics);
  if (
    analytics === null ||
    !hasExactKeys(analytics, ["surface", "authState"]) ||
    typeof analytics.surface !== "string" ||
    !SURFACES.has(analytics.surface as PublicParitySurface) ||
    typeof analytics.authState !== "string" ||
    !AUTH_STATES.has(analytics.authState as PublicParityAuthState)
  ) return failure("invalid-analytics-context");

  const normalizedCapabilities = capabilities as PublicParityCapability[];
  const normalizedActions = actions as PublicParityAction[];
  if (
    !familyContractIsValid(
      identity,
      source.state,
      normalizedCapabilities,
      normalizedActions,
    )
  ) return failure("invalid-family-contract");

  const disabledReasons = Array.from(
    new Set(
      normalizedCapabilities.flatMap((capability) =>
        capability.disabledReason === null ? [] : [capability.disabledReason]
      ),
    ),
  );

  return {
    ok: true,
    model: {
      schemaVersion: 1,
      identity,
      visibility,
      state: source.state,
      capabilities: normalizedCapabilities,
      actions: normalizedActions,
      analyticsContext: {
        surface: analytics.surface as PublicParitySurface,
        page_family: identity.kind,
        entity_id: identity.entityId,
        entity_kind: identity.kind,
        route_kind: identity.route.kind,
        initial_state: source.state,
        auth_state: analytics.authState as PublicParityAuthState,
      },
      accessibility: {
        identityKind: identity.kind,
        lifecycleState: source.state,
        busy: source.state === "loading",
        disabledReasons,
      },
    },
  };
}

/** Provider-neutral installment capability; unknown input is unavailable. */
export function createPublicInstallmentCapability(
  supported: unknown,
): PublicParityCapability {
  return supported === true
    ? { kind: "installments", enabled: true, disabledReason: null }
    : {
      kind: "installments",
      enabled: false,
      disabledReason: INSTALLMENT_CAPABILITY_UNAVAILABLE,
    };
}

/**
 * Produce the only state an auth overlay needs to resume an action. The intent
 * contains no arbitrary URL, PII, provider reference, or reader payload and
 * explicitly requires host-side server revalidation on return.
 */
export function createPublicAuthReturnIntent(
  model: unknown,
  actionId: unknown,
): PublicParityAuthReturnIntent | null {
  if (!isSafeId(actionId)) return null;
  const source = asRecord(model);
  if (
    source === null || source.schemaVersion !== 1 ||
    !isLifecycleState(source.state) || !Array.isArray(source.capabilities) ||
    !Array.isArray(source.actions)
  ) return null;
  const identity = parseIdentity(source.identity);
  const capabilities = source.capabilities.map(parseCapability);
  const actions = source.actions.map(parseAction);
  if (
    identity === null || capabilities.some((item) => item === null) ||
    actions.some((item) => item === null)
  ) return null;
  const normalizedCapabilities = capabilities as PublicParityCapability[];
  const normalizedActions = actions as PublicParityAction[];
  if (
    !familyContractIsValid(
      identity,
      source.state,
      normalizedCapabilities,
      normalizedActions,
    )
  ) return null;
  const action = normalizedActions.find((candidate) =>
    candidate.id === actionId
  );
  if (action === undefined || action.auth !== "required") return null;
  const capability = normalizedCapabilities.find((candidate) =>
    candidate.kind === action.kind
  );
  if (capability?.enabled !== true) return null;
  return {
    schemaVersion: 1,
    identity,
    action: {
      id: action.id,
      kind: action.kind,
      target: action.target,
      selection: action.selection,
    },
    revalidateBeforeResume: true,
  };
}
