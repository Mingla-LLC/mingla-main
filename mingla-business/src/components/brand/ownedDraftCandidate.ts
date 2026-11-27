import type { BrandSetupChecklist } from "../../services/brandSetupService";
import type { Brand } from "../../types/brand";

type CandidateBrand = Pick<Brand, "id" | "accountId">;

/** #4627 — a direct/server draft hint is never its own authority. */
export function isOwnedDraftCandidate(
  expectedId: string,
  brand: CandidateBrand | null | undefined,
  checklist: BrandSetupChecklist | undefined,
  userId: string | null,
): boolean {
  return (
    userId !== null &&
    brand?.id === expectedId &&
    brand.accountId === userId &&
    checklist?.facts.isDraft === true
  );
}
