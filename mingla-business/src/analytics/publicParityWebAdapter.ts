import type {
  PublicParityAuthState,
  PublicParityCanonicalIdentity,
  PublicParityContract,
  PublicParityLifecycleState,
  PublicParitySurface,
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
  const route = target.kind === "content-share"
    ? { ...target, destination: null }
    : { ...target };
  return {
    kind: target.kind === "event" ? target.entityKind : target.kind,
    entityId: target.entityId,
    route,
  } as PublicParityCanonicalIdentity;
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
export const createBuyerWebPublicContract = async (
  input: BuyerWebPublicContractInput,
): Promise<PublicParityContract | null> => {
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

  // The semantic validator is checkout/public-route code, not application boot
  // code. Loading it at the analytics seam keeps the shared contract intact
  // without making every business-web visitor download it before first paint.
  const { createPublicParityContract } = await import(
    "@mingla/offering-rendering/publicParityContract"
  );
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
export const captureBuyerWebPublicPageViewed = async (
  input: BuyerWebPublicContractInput,
): Promise<boolean> => {
  const contract = await createBuyerWebPublicContract(input);
  if (contract === null) return false;
  captureWeb("public_page_viewed", contract.analyticsContext);
  return true;
};
