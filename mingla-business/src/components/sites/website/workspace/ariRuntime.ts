/*
 * #4453 — where the Website workspace gets Ari's chat machinery.
 *
 * Metro makes each `import()` target one on-demand chunk and moves anything
 * that sits in two chunks into `__common`, the payload every Host user
 * downloads before anything draws. Ari's chat hook and everything behind it
 * (about 52 KB) already lives in the AriChatScreen chunk. Importing those
 * modules statically from the Website chunk put them in two chunks, so all of
 * it moved onto the boot path (measured: `__common` +51.9 KB).
 *
 * Two dynamic importers of the SAME module resolve to one chunk and hoist
 * nothing (invariant I-ARI-CHAT-ONE-CHUNK, issue-2830-sites-foundation.mjs),
 * so the workspace takes the hooks through AriChatScreen's own module, the
 * same target the Ari tab and Website setup load. Nothing under
 * `components/sites/` or `src/sites/` may import Ari's chat hook, its confirm
 * hook, its choices helper or its turn service statically: types only.
 */
import type { useAgentChat } from "../../../../hooks/useAgentChat";
import type { useConfirmPendingAction } from "../../../../hooks/useConfirmPendingAction";
import type { buildChoiceSubmission } from "../../../ari/agentChoices";
import type { fetchAriTurnStatus } from "../../../../services/ariTurnService";

export type AriRuntime = {
  useAgentChat: typeof useAgentChat;
  useConfirmPendingAction: typeof useConfirmPendingAction;
  buildChoiceSubmission: typeof buildChoiceSubmission;
  fetchAriTurnStatus: typeof fetchAriTurnStatus;
};

export async function loadAriRuntime(): Promise<AriRuntime> {
  const ari = await import("../../../../screens/ari/AriChatScreen");
  return {
    useAgentChat: ari.useAgentChat,
    useConfirmPendingAction: ari.useConfirmPendingAction,
    buildChoiceSubmission: ari.buildChoiceSubmission,
    fetchAriTurnStatus: ari.fetchAriTurnStatus,
  };
}
