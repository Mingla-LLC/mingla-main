import React from "react";
import { useWebsite } from "./WebsiteContext";
import { Banner, Chip, WButton } from "./ui";
import type { WebsiteSection } from "../../../sites/websiteNav";

// #2829 W9r — the banner a member sees while a teammate holds the website lock
// (design contract: "Two admins at the same moment"). Core gives the holder's
// name or null (no name on file, #2829 W11); the wording for null is ours.
export const LOCK_DOING: Partial<Record<WebsiteSection, string>> = {
  overview: "editing the website",
  pages: "changing your pages",
  design: "changing your website design",
  plan: "working on the setup plan",
  destinations: "editing destinations",
  stories: "editing stories",
  reviews: "editing reviews",
};

export function LockBanner({ section }: { section: WebsiteSection }): React.ReactElement {
  const { lock } = useWebsite();
  const name = lock.holderName;
  return (
    <Banner
      tone="warn"
      icon="lock"
      title={`${name ?? "A teammate"} is ${LOCK_DOING[section] ?? "editing the website"} right now`}
      body={name
        ? `You can look around. Your changes are paused until ${name} finishes or you take over; nothing ${name} has saved is lost.`
        : "You can look around. Your changes are paused until they finish or you take over; nothing they have saved is lost."}
      testID="website-lock-banner"
    >
      {lock.canTakeOver
        ? <WButton label="Take over" size="sm" onPress={lock.takeOver} loading={lock.takingOver} testID="lock-takeover" />
        : <Chip label="Only admins can take over" />}
    </Banner>
  );
}

