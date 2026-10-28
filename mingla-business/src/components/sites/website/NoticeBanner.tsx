import React from "react";
import { useWebsite } from "./WebsiteContext";
import { Banner, WButton } from "./ui";

/**
 * #3583 — every refusal surfaces: the workspace notice with its next action
 * and Core's reference. #2830 state 30 — back from the advanced editor after
 * its secure session ended, nothing changed.
 */
export function NoticeBanner(): React.ReactElement | null {
  const { controller } = useWebsite();
  const notice = controller.notice;
  // #2830 state 30 — back from the advanced editor after its secure session ended.
  if (!notice && controller.journeyState === 30) {
    return (
      <Banner tone="info" icon="alert" title="Your secure editor session ended" body="No draft or live website was changed. Open the advanced page editor again from Settings to continue." testID="website-session-expired">
        <WButton label="Open it again" size="sm" onPress={() => controller.actions.openStudio()} loading={controller.isOpeningStudio} />
      </Banner>
    );
  }
  if (!notice) return null;
  return (
    <Banner tone={notice.kind === "offline" ? "info" : "err"} icon="alert" title={notice.title} body={notice.reference ? `${notice.body} Reference: ${notice.reference}` : notice.body} alert testID="website-notice">
      <WButton label="Dismiss" size="sm" variant="ghost" onPress={controller.actions.dismissNotice} />
    </Banner>
  );
}
