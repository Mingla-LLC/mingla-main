/**
 * #4339 §5 — claim a usemingla.com website description once and hand it to
 * the Ari screen as the host's first message.
 *
 * - Waits for `ready` (signed in, AI disclosure accepted, brand and
 *   conversation settled) so the message lands in a stable, new conversation.
 * - Claims at most once per draft id per page load (a module-level set
 *   survives remounts and strict-mode double effects).
 * - Missing, expired or already-claimed drafts open Ari normally: no error, no
 *   message. A failed claim call is logged and Ari opens normally too.
 * - `onSettled` runs once the id has been dealt with, so the caller can drop
 *   `?draft=` from the address and a reload never retries.
 */

import { useEffect, useRef } from "react";

import {
  claimSitePromptDraft,
  type SitePromptDraftClaim,
} from "../services/sitePromptDraftService";
import { sitePromptFirstMessage } from "../utils/sitePromptDraft";

const handledDraftIds = new Set<string>();

/**
 * A host with no brand yet: Ari makes creating the brand part zero (its
 * website rules), and creating it switches the Ari screen to the new brand's
 * own, empty conversation (#4304 State A → B). The website request is carried
 * across that switch in memory, once, so Ari continues the build in the new
 * brand's conversation instead of leaving the words in the composer.
 */
let carriedMessage: string | null = null;

export function carrySitePromptMessage(message: string): void {
  carriedMessage = message;
}

/** True once, when `message` is the carried website request (then it is spent). */
export function takeCarriedSitePromptMessage(message: string): boolean {
  if (carriedMessage === null || carriedMessage.trim() !== message.trim()) return false;
  carriedMessage = null;
  return true;
}

/** Test seam: forget which drafts this page load has handled. */
export function resetSitePromptDraftHandoffForTests(): void {
  handledDraftIds.clear();
  carriedMessage = null;
}

export interface SitePromptDraftHandoffArgs {
  draftId: string | null;
  ready: boolean;
  onMessage: (message: string) => void;
  onSettled: () => void;
  claim?: (draftId: string) => Promise<SitePromptDraftClaim>;
}

export function useSitePromptDraftHandoff({
  draftId,
  ready,
  onMessage,
  onSettled,
  claim = claimSitePromptDraft,
}: SitePromptDraftHandoffArgs): void {
  const latest = useRef({ onMessage, onSettled, claim });
  latest.current = { onMessage, onSettled, claim };
  // A claimed draft is spent server-side, so once the claim starts its answer
  // is delivered even if `ready` flickers; only an unmount drops it.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || draftId === null || handledDraftIds.has(draftId)) return;
    handledDraftIds.add(draftId);
    void latest.current
      .claim(draftId)
      .then((result) => {
        if (mounted.current && result.status === "claimed") {
          latest.current.onMessage(sitePromptFirstMessage(result.body));
        }
      })
      .catch((error: unknown) => {
        // Ari still opens normally; the host can type their request.
        console.warn(
          "[ari] website description claim failed",
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        if (mounted.current) latest.current.onSettled();
      });
  }, [draftId, ready]);
}
