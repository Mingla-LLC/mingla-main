/**
 * #4238 — archive and restore a brand's ad media from the Host ad builder.
 *
 * "Archive" takes a video or photo out of the brand's library so no new ad
 * can pick it; ads already running keep it. It is never a delete. The server
 * (`ad-plan` creative_archive / creative_unarchive) allows anyone who may plan
 * ads for the brand.
 */
import { edgeErrorCode } from "./edgeErrorCode";
import { supabase } from "./supabase";

export class HostAdCreativeLibraryError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "HostAdCreativeLibraryError";
    this.code = code;
  }
}

async function setArchived(creativeId: string, archived: boolean): Promise<void> {
  const { data, error } = await supabase.functions.invoke("ad-plan", {
    body: { action: archived ? "creative_archive" : "creative_unarchive", creative_id: creativeId },
  });
  if (error !== null) {
    let code = "network";
    try {
      const response = (error as { context?: Response }).context;
      if (response && typeof response.json === "function") {
        const payload = (await response.json()) as { error?: unknown };
        if (typeof payload.error === "string") code = payload.error;
      }
    } catch {
      code = "network";
    }
    throw new HostAdCreativeLibraryError(code);
  }
  const failed = edgeErrorCode(data);
  if (failed !== null) throw new HostAdCreativeLibraryError(failed);
}

/** Archives each creative; returns the ids that were archived, in order. */
export async function archiveHostAdCreatives(ids: readonly string[]): Promise<string[]> {
  const done: string[] = [];
  for (const id of ids) {
    await setArchived(id, true);
    done.push(id);
  }
  return done;
}

/** Undo: restores creatives archived a moment ago. */
export async function restoreHostAdCreatives(ids: readonly string[]): Promise<void> {
  for (const id of ids) await setArchived(id, false);
}
