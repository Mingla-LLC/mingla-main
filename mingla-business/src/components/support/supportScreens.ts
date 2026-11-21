/**
 * #4382 — the one module the support routes load with import().
 *
 * Expo's web build hoists any module that two route chunks import statically
 * into the eager `__common` chunk. Help & Support, the request thread and the
 * staff inbox all share the support service, model, media viewer and image
 * picker, so each route reaches them only through this module (one lazy
 * chunk, LazySupportScreens.tsx), and none of them is downloaded at boot.
 *
 * #4420 — Help & Support's "A person" pane, the Ari hand-over and the ticket
 * list read the shell needs for its first choice come through here too.
 */
export { SupportTabPanel } from "./SupportTabPanel";
export { SupportThread } from "./SupportThread";
export { SupportInboxScreen } from "./SupportInboxScreen";
export { SupportPersonPane } from "./SupportPersonPane";
export { listOwnSupportTickets } from "../../services/supportService";
export {
  HandoverError,
  handOverToSupport,
  handoverFailureMessage,
  handoverNotices,
} from "../../services/supportHandoverService";
export { handOverPayloadFromMessages } from "./supportHandover";
