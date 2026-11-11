/**
 * #4382 — the one module the support routes load with import().
 *
 * Expo's web build hoists any module that two route chunks import statically
 * into the eager `__common` chunk. Help & Support, the request thread and the
 * staff inbox all share the support service, model, media viewer and image
 * picker, so each route reaches them only through this module (one lazy
 * chunk, LazySupportScreens.tsx), and none of them is downloaded at boot.
 */
export { SupportTabPanel } from "./SupportTabPanel";
export { SupportThread } from "./SupportThread";
export { SupportInboxScreen } from "./SupportInboxScreen";
