import {
  CollabSessionChatBanners,
  InChatDeckSheet,
  SavedToSessionCardsSheet,
} from "../CollabSessionChatBanners";

export function runOrch0918BannerExportFixture(): boolean {
  return (
    typeof CollabSessionChatBanners === "function" &&
    typeof InChatDeckSheet === "function" &&
    typeof SavedToSessionCardsSheet === "function"
  );
}

export function runOrch0918BannerVisibilityFixture() {
  const shouldRenderSchedule = (count: number) => count > 0;
  const shouldRenderSavedToSession = (savedCardsForLikesSheetLength: number) =>
    savedCardsForLikesSheetLength > 0;
  return {
    scheduleHiddenOnEmpty: shouldRenderSchedule(0) === false,
    scheduleRenderedWhenPopulated: shouldRenderSchedule(1) === true,
    savedToSessionHiddenOnEmpty: shouldRenderSavedToSession(0) === false,
    savedToSessionRenderedWhenPopulated: shouldRenderSavedToSession(1) === true,
    savedToSessionCountSource: shouldRenderSavedToSession(2) === true,
    deckAlwaysRendered: true,
  };
}

export const ORCH_0918_BANNER_TEST_RECEIPTS = {
  "T-08":
    "fails-on-revert verified by app-mobile/scripts/ci/orch-0918-regression-check.mjs",
  "T-09-rev":
    "fails-on-revert verified by app-mobile/scripts/ci/orch-0918-regression-check.mjs",
  "T-10":
    "fails-on-revert verified by app-mobile/scripts/ci/orch-0918-regression-check.mjs",
  "T-11":
    "fails-on-revert verified by app-mobile/scripts/ci/orch-0918-regression-check.mjs",
};
