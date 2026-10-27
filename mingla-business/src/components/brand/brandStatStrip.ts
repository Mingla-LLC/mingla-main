/**
 * #3872 round 2 follow-ups (approved M-brandone) — the brand page's numbers
 * are ONE compact strip of three: Attendees · Sales · Followers. No hint text
 * ("all time", "Share your page to get your first") — the three tiles it
 * replaced truncated to "FOLLOWE…" on a phone. Followers still opens People.
 */
import type { BrandFollowerSummary } from "../../types/brandFollowers";
import { formatCount } from "../../utils/currency";

export type BrandStatItem = {
  label: string;
  value: string;
  onPress?: () => void;
  accessibilityHint?: string;
};

export function brandStatStripItems(input: {
  attendees: number;
  salesText: string;
  followers: BrandFollowerSummary | undefined;
  followersFailed: boolean;
  onOpenPeople?: () => void;
}): BrandStatItem[] {
  const followersValue =
    input.followersFailed || input.followers === undefined
      ? "—"
      : formatCount(input.followers.total);
  return [
    { label: "Attendees", value: formatCount(input.attendees) },
    { label: "Sales", value: input.salesText },
    {
      label: "Followers",
      value: followersValue,
      onPress: input.onOpenPeople,
      accessibilityHint: input.onOpenPeople ? "Opens People" : undefined,
    },
  ];
}
