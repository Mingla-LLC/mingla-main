/**
 * #4238 honest Review questions: the "past buyers" line an app adds when it
 * can't leave out the brand's past buyers yet, and how to tell that reason
 * apart from an area reason (the adTargetingCompiler wideningSummary lines).
 *
 * Client mirror: mingla-business/src/components/marketing/ads/hostAdCopy.ts
 * (hostAdPastBuyersLine, hostAdWideningKind). Keep the sentence identical.
 */

/** "Snapchat can't leave out your 38 past buyers yet, so they may see this ad." */
export function hostAdPastBuyersLine(appName: string, count: number): string {
  const n = Math.max(0, Math.trunc(count));
  const people = n === 1 ? "past buyer" : "past buyers";
  return `${appName} can't leave out your ${n.toLocaleString("en-US")} ${people} yet, so they may see this ad.`;
}

/** Matches exactly the sentence hostAdPastBuyersLine writes. */
export const HOST_AD_PAST_BUYERS_LINE =
  /^.+ can't leave out your \d{1,3}(,\d{3})* past buyers? yet, so they may see this ad\.$/;

export type HostAdWideningKind = "past_buyers" | "area" | "mixed";

/**
 * Why an app reaches a wider group: only past buyers, only the area (every
 * other line), or both. No lines reads as "area" (the existing question).
 */
export function hostAdWideningKind(lines: readonly string[]): HostAdWideningKind {
  const buyers = lines.filter((line) => HOST_AD_PAST_BUYERS_LINE.test(line));
  if (buyers.length === 0) return "area";
  return buyers.length === lines.length ? "past_buyers" : "mixed";
}
