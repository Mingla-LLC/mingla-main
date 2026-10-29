import type { IconName } from "../ui/Icon";
import type { MarketingSubNavId } from "./marketingSubNavTabs";

export interface MarketingActionDefinition {
  label: string;
  compactLabel: string;
  icon: IconName;
  href: string;
}

/** #4168 — canonical action identity for every persistent Blast tab. */
export const MARKETING_TAB_ACTIONS: Readonly<
  Record<MarketingSubNavId, MarketingActionDefinition>
> = {
  overview: {
    label: "Send a campaign",
    compactLabel: "Send",
    icon: "send",
    href: "/(tabs)/marketing/campaigns/compose",
  },
  campaigns: {
    label: "New campaign",
    compactLabel: "New",
    icon: "send",
    href: "/(tabs)/marketing/campaigns/compose",
  },
  ads: {
    label: "Create an ad",
    compactLabel: "Create",
    icon: "sparkle",
    href: "/(tabs)/marketing/ads/create",
  },
  creators: {
    label: "Hire a creator",
    compactLabel: "Hire",
    icon: "video",
    href: "/(tabs)/marketing/creators?action=hire",
  },
  referrals: {
    label: "Create offer",
    compactLabel: "Create",
    icon: "gift",
    href: "/(tabs)/marketing/referrals?action=offer",
  },
  people: {
    label: "Import people",
    compactLabel: "Import",
    icon: "upload",
    href: "/(tabs)/people/import?returnTo=marketingPeople",
  },
  templates: {
    label: "New template",
    compactLabel: "New",
    icon: "template",
    href: "/(tabs)/marketing/templates/new",
  },
};
