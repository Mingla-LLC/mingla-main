/**
 * #4420 — sending in a brand's one thread (Team | Guests). Pure: no React.
 *
 * A send is bound to the side and conversation SHOWING when Send was pressed.
 * The target is captured at press time and never re-read, so switching sides
 * while the send is in flight (even within 50 ms) cannot redirect it: a Team
 * send only ever calls the Brand group sender, a Guests send only ever calls
 * the Guest chat sender (SC-5). Each side keeps its own draft, and a finished
 * send clears only the draft it came from (SC-4).
 */
import type { MessagesSide } from "./brandMessagesInbox";

export interface BrandThreadSendTarget {
  side: MessagesSide;
  conversationId: string;
}

export interface BrandThreadSenders<Result> {
  /** Brand group send (sendBrandGroupMessage). */
  team: (conversationId: string, content: string) => Promise<Result>;
  /** Guest chat send (issue_4459_send_brand_guest_message via postPlannerMessage). */
  guests: (conversationId: string, content: string) => Promise<Result>;
}

/** Freezes the target the moment Send is pressed. */
export function captureSendTarget(side: MessagesSide, conversationId: string | null): BrandThreadSendTarget | null {
  if (!conversationId) return null;
  return Object.freeze({ side, conversationId });
}

/** Sends to the captured target only. */
export function dispatchBrandThreadSend<Result>(
  target: BrandThreadSendTarget,
  content: string,
  senders: BrandThreadSenders<Result>,
): Promise<Result> {
  switch (target.side) {
    case "team":
      return senders.team(target.conversationId, content);
    case "guests":
      return senders.guests(target.conversationId, content);
    default: {
      const unreachable: never = target.side;
      return Promise.reject(new Error(`unknown_side:${String(unreachable)}`));
    }
  }
}

export type BrandThreadDrafts = Readonly<Record<string, string>>;

export function brandThreadDraftKey(target: BrandThreadSendTarget): string {
  return `${target.conversationId}:${target.side}`;
}

export function readBrandThreadDraft(drafts: BrandThreadDrafts, target: BrandThreadSendTarget | null): string {
  return target ? drafts[brandThreadDraftKey(target)] ?? "" : "";
}

export function writeBrandThreadDraft(drafts: BrandThreadDrafts, target: BrandThreadSendTarget, value: string): BrandThreadDrafts {
  return { ...drafts, [brandThreadDraftKey(target)]: value };
}

/** After a send lands: clears the draft it was sent from, and nothing else. */
export function clearSentBrandThreadDraft(drafts: BrandThreadDrafts, sent: BrandThreadSendTarget, sentText: string): BrandThreadDrafts {
  const key = brandThreadDraftKey(sent);
  // Typing more while the send was in flight keeps the new words.
  if ((drafts[key] ?? "").trim() !== sentText.trim()) return drafts;
  return { ...drafts, [key]: "" };
}

/**
 * The first-send check: asked before the first guest message each time the
 * thread is opened (decision 5). In Broadcast it reads as a broadcast.
 */
export function guestSendNeedsConfirm(side: MessagesSide, confirmedThisOpen: boolean): boolean {
  return side === "guests" && !confirmedThisOpen;
}
