import {
  createPublicParityContract,
  type PublicParityAuthState,
  type PublicParityCanonicalIdentity,
  type PublicParityContract,
  type PublicParityLifecycleState,
  type PublicParitySurface,
} from "@mingla/offering-rendering/publicParityContract";

import { captureWeb } from "./webAnalytics";

export type BuyerWebPublicTarget =
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

export interface BuyerWebQueryLifecycle {
  hasData: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  isStale?: boolean;
}

export interface BuyerWebPublicContractInput {
  target: BuyerWebPublicTarget;
  state: PublicParityLifecycleState;
  authState?: PublicParityAuthState;
  surface?: Extract<PublicParitySurface, "buyer-web" | "business-web-preview">;
}

/**
 * Data presence owns whether a public route may keep rendering. A background
 * fetch or retained-data error is stale usable content, never a cold shell.
 */
export const resolveBuyerWebPublicLifecycle = (
  query: BuyerWebQueryLifecycle,
): PublicParityLifecycleState => {
  if (query.hasData) {
    return query.isFetching || query.isError || query.isStale === true
      ? "stale"
      : "populated";
  }
  if (query.isLoading || query.isFetching) return "loading";
  if (query.isError) return "error";
  return "not-found";
};

const identityForTarget = (
  target: BuyerWebPublicTarget,
): PublicParityCanonicalIdentity => {
  switch (target.kind) {
    case "brand":
      return { kind: "brand", entityId: target.entityId, route: { ...target } };
    case "venue":
      return { kind: "venue", entityId: target.entityId, route: { ...target } };
    case "event":
      return {
        kind: target.entityKind,
        entityId: target.entityId,
        route: { ...target },
      };
    case "trip":
      return { kind: "trip", entityId: target.entityId, route: { ...target } };
    case "experience":
      return {
        kind: "experience",
        entityId: target.entityId,
        route: { ...target },
      };
    case "stay":
      return { kind: "stay", entityId: target.entityId, route: { ...target } };
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
  target: BuyerWebPublicTarget,
): "public" | "exact-link" | "protected" => {
  if (target.kind === "stay") return "protected";
  if (target.kind === "opaque-share" || target.kind === "content-share") {
    return "exact-link";
  }
  return "public";
};

/** Validate one web host seam through the shared pure contract. */
export const createBuyerWebPublicContract = (
  input: BuyerWebPublicContractInput,
): PublicParityContract | null => {
  const target = input?.target;
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

  const result = createPublicParityContract({
    schemaVersion: 1,
    identity: identityForTarget(target),
    visibility: visibilityForTarget(target),
    state: input.state,
    capabilities: [],
    actions: [],
    analytics: {
      surface: input.surface ?? "buyer-web",
      authState: input.authState ?? "unknown",
    },
  });
  return result.ok ? result.model : null;
};

/**
 * Emit only the bounded shared analytics context. `captureWeb` remains the
 * single web transport and consent gate; invalid identity emits nothing.
 */
export const captureBuyerWebPublicPageViewed = (
  input: BuyerWebPublicContractInput,
): boolean => {
  const contract = createBuyerWebPublicContract(input);
  if (contract === null) return false;
  captureWeb("public_page_viewed", contract.analyticsContext);
  return true;
};
