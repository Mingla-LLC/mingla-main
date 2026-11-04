// #3682 wave 3 (#1782) — pure model for the Friends of followers read.
// No React Native imports, so the Deno unit lane can run it.

export type FriendsReachPlatform = "ios" | "android" | "web";

export type StoppedBrand = {
  brandId: string;
  brandName: string;
  brandSlug: string | null;
  photoUrl: string | null;
  exitedAt: string | null;
};

export type FriendsReachState = {
  controlsLive: boolean;
  extendedEnabled: boolean;
  decidedAt: string | null;
  stoppedBrands: StoppedBrand[];
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Parse the RPC envelope; anything malformed is an error, never a guess. */
export function parseFriendsReach(data: unknown): FriendsReachState {
  if (data === null || typeof data !== "object") {
    throw new Error("friends_reach_malformed");
  }
  const raw = data as Record<string, unknown>;
  const exits = Array.isArray(raw.exits) ? raw.exits : [];
  const stoppedBrands: StoppedBrand[] = [];
  for (const item of exits) {
    if (item === null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const brandId = asString(row.brandId);
    const brandName = asString(row.brandName);
    if (brandId === null || brandName === null) continue;
    stoppedBrands.push({
      brandId,
      brandName,
      brandSlug: asString(row.brandSlug),
      photoUrl: asString(row.photoUrl),
      exitedAt: asString(row.exitedAt),
    });
  }
  return {
    controlsLive: raw.controlsLive === true,
    extendedEnabled: raw.extendedEnabled === true,
    decidedAt: asString(raw.decidedAt),
    stoppedBrands,
  };
}
