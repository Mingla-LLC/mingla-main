/**
 * #4459 — "Message <Brand>" from a brand Guest chat (removed card, info sheet,
 * booking card) opens the guest's existing #4111 enquiry thread with that
 * brand; with none yet, it starts one in the shared message sheet.
 *
 * Pure (no React Native) so the decision is testable under Deno.
 */
export interface EnquiryRowLike {
  enquiryId: string;
  brandId: string;
  lastActivityAt?: string | null;
  createdAt?: string | null;
}

/** The guest's most recent enquiry thread with this brand, or null. */
export function latestEnquiryForBrand<R extends EnquiryRowLike>(
  rows: readonly R[] | null | undefined,
  brandId: string | null | undefined,
): R | null {
  if (!rows || !brandId) return null;
  const mine = rows.filter((row) => row.brandId === brandId);
  if (mine.length === 0) return null;
  const at = (row: R): number => Date.parse(row.lastActivityAt ?? row.createdAt ?? "") || 0;
  return [...mine].sort((a, b) => at(b) - at(a))[0];
}

export function enquiryThreadHref(enquiryId: string): string {
  return `/enquiry/${enquiryId}`;
}
