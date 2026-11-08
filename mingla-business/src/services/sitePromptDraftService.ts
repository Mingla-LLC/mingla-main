/**
 * #4339 §5 — claim the website description a visitor typed on
 * usemingla.com/host ("Prompt your website into existence").
 *
 * `claim_site_prompt_draft` claims once, binds the draft to the signed-in user
 * and answers `{status:"unavailable"}` for a missing, expired or already
 * claimed draft. It throws only when the call itself fails.
 */

import { supabase } from "./supabase";

export type SitePromptDraftClaim =
  | { status: "claimed"; body: string }
  | { status: "unavailable" };

export async function claimSitePromptDraft(
  draftId: string,
): Promise<SitePromptDraftClaim> {
  const { data, error } = await supabase.rpc(
    "claim_site_prompt_draft" as never,
    { p_draft_id: draftId } as never,
  );
  if (error) {
    throw new Error(error.message || error.code || "SITE_PROMPT_DRAFT_CLAIM_FAILED");
  }
  const record = data as unknown as { status?: unknown; body?: unknown } | null;
  if (
    record !== null &&
    record.status === "claimed" &&
    typeof record.body === "string" &&
    record.body.trim().length > 0
  ) {
    return { status: "claimed", body: record.body };
  }
  return { status: "unavailable" };
}
