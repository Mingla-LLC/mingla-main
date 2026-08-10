export type BrandPersonLinkOutcome =
  | "linked"
  | "already_linked"
  | "conflict"
  | "unlinked"
  | "retired";

export interface BrandPersonResolution {
  personId: string | null;
  sourceLinkId: string | null;
  linkOutcome: BrandPersonLinkOutcome;
  conflictId: string | null;
}

export function safeBrandPersonResolution(
  value: unknown,
): BrandPersonResolution {
  if (typeof value !== "object" || value === null) {
    throw new Error("brand_person_resolution_invalid");
  }
  const row = value as Partial<BrandPersonResolution>;
  if (
    !["linked", "already_linked", "conflict", "unlinked", "retired"].includes(
      row.linkOutcome ?? "",
    ) ||
    !(row.personId === null || typeof row.personId === "string") ||
    !(row.sourceLinkId === null || typeof row.sourceLinkId === "string") ||
    !(row.conflictId === null || typeof row.conflictId === "string")
  ) throw new Error("brand_person_resolution_invalid");
  return row as BrandPersonResolution;
}
