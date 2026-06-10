/**
 * ORCH-1103 — neutral shared types for the Ari tool-proposal flow.
 *
 * `ConfirmOutcome` is used by MessageList (which owns the onConfirm handler),
 * ToolProposalCard (whose onConfirm prop returns it), and AriChatScreen. It
 * lives here — not in MessageList — so ToolProposalCard does not import back
 * into MessageList (which renders ToolProposalCard), which would form a
 * require-cycle (I-PROPOSED-K).
 */

export interface ConfirmOutcome {
  ok: boolean;
  brandId?: string;
}
