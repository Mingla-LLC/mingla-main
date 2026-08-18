/**
 * issue #2009 [published-event visibility] — the visibility mutation, its copy
 * and its error mapping, as an ON-INTENT ASYNC CHUNK.
 *
 * WHY THIS IS ITS OWN FILE, and not a section of `businessEvents.ts`.
 *
 * `businessEvents.ts` and `EditPublishedScreen.tsx` both sit in the eager
 * `__common` boot chunk — Metro hoists anything two or more async route chunks
 * import — so every byte added to them is downloaded by every visitor before
 * ANY route renders, guest or authenticated. #2009's first shape put this code
 * there and cost the boot payload 3,379 B against issue #2099's 1,024 B
 * ceiling. None of it is needed at boot: an organiser only reaches it after
 * opening a published event's editor and pressing Save.
 *
 * So the editor loads this module with `await import(...)` at the moment the
 * organiser acts. The behaviour is identical — the same RPC, the same echo
 * verification, the same approved sentences — it simply is not on the boot path.
 * KEEP IT THAT WAY: a static `import` of this module from anything reachable
 * from `__common` silently returns the whole file to the eager chunk. The
 * `issue-2009-published-event-visibility` gate asserts the editor's reference
 * stays dynamic, and `issue-2099-boot-payload-ceiling` measures the result.
 */

import { supabase } from "./supabase";
import type { DraftEventVisibility } from "../store/draftEventStore";

/**
 * issue #2009 — the stable server codes `business_set_event_visibility` raises.
 * Exported so the editor's copy map and its tests share ONE definition and a
 * renamed code cannot silently fall through to the generic retry message.
 */
export const ISSUE_2009_VISIBILITY_ERROR_CODES = {
  notAuthenticated: "not_authenticated",
  invalidVisibility: "invalid_visibility",
  invalidReason: "invalid_edit_reason",
  notFound: "event_not_found",
  notEditable: "event_not_editable",
  privateUnavailable: "private_visibility_unavailable",
  stale: "stale_event_visibility",
  directUpdateBlocked: "event_visibility_direct_update_blocked",
} as const;

/**
 * issue #2009 — the Private prerequisite copy, approved verbatim in the BINDING
 * SPEC §6 and re-pinned by AMENDMENT 3 §3. Shown when the organiser selects
 * Private, and again when the SERVER refuses because client capability state
 * was stale. The server is always the authority.
 */
export const ISSUE_2009_PRIVATE_UNAVAILABLE_COPY =
  "Private events are not ready to accept invited guests yet. Choose Public or Unlisted for now.";

/**
 * issue #2009 (pass-1 TEST REPORT P2-2) — the copy for the OTHER direction.
 *
 * The RPC raises the SAME stable code, `private_visibility_unavailable`, on
 * both legs of the boundary: entering Private, and leaving an event that is
 * already Private. Mapping one sentence to both told an organiser who had just
 * chosen Public to "Choose Public or Unlisted for now" — advice they had
 * already taken, for a save that had just failed. The entering copy above is
 * approved verbatim and is unchanged; this one exists because the exit leg
 * needs a sentence that is true of the exit leg.
 *
 * It says what is actually so: the event is stuck on the Business surface until
 * #2144, and the supported way out today is the Admin console, which
 * `admin_set_offering_visibility` now permits for this direction.
 */
export const ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY =
  "This event is Private, and Mingla Business can't move it out of Private yet. Contact support and we'll switch it to Public or Unlisted for you.";

/**
 * issue #2009 — map a stable RPC code to honest, actionable organiser copy,
 * knowing WHICH LEG of the Private boundary the refusal came from.
 *
 * Lives here rather than in the screen so it is executable in a plain node jest
 * run (per #2113 a check that only reads source text carries no information;
 * this one is CALLED with real codes).
 *
 * The server is ALWAYS the authority: `private_visibility_unavailable` is
 * mapped here too, so a client whose capability state is stale still tells the
 * organiser the truth instead of a generic failure.
 *
 * `previousVisibility` is the value the editor LOADED. It is the only thing
 * that separates the two legs, because the RPC raises the same code for both.
 * Anything other than `"private"` — including `undefined`, `null` and a value
 * this client does not recognise — is treated as the ENTERING leg, so an
 * unknown direction can never be mistaken for the exit.
 */
export const issue2009VisibilityErrorCopyForLeg = (
  code: string,
  previousVisibility: string | null | undefined,
): string => {
  if (code.includes(ISSUE_2009_VISIBILITY_ERROR_CODES.privateUnavailable)) {
    // P2-2 — one code, two directions. Leaving Private gets the exit sentence.
    return previousVisibility === "private"
      ? ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY
      : ISSUE_2009_PRIVATE_UNAVAILABLE_COPY;
  }
  if (code.includes(ISSUE_2009_VISIBILITY_ERROR_CODES.stale)) {
    return "This event changed elsewhere. Review the latest visibility and try again.";
  }
  if (
    code.includes(ISSUE_2009_VISIBILITY_ERROR_CODES.notFound) ||
    code.includes(ISSUE_2009_VISIBILITY_ERROR_CODES.notAuthenticated)
  ) {
    return "You no longer have permission to edit this event.";
  }
  if (code.includes(ISSUE_2009_VISIBILITY_ERROR_CODES.notEditable)) {
    return "This event can't be edited — it may be ended or cancelled.";
  }
  if (code.includes(ISSUE_2009_VISIBILITY_ERROR_CODES.invalidReason)) {
    return "Add a brief reason (10–200 characters) for this change.";
  }
  return "Couldn't save visibility. Check your connection and try again.";
};

/**
 * issue #2009 — the direction-free entry point, kept at ONE argument so it
 * stays usable point-free (`codes.map(issue2009VisibilityErrorCopy)`).
 *
 * It delegates to the mapping above rather than duplicating it, so there is
 * exactly one home for every sentence. With no leg supplied the Private code
 * resolves to the approved ENTERING copy, which is the pre-P2-2 behaviour
 * unchanged.
 */
export const issue2009VisibilityErrorCopy = (code: string): string =>
  issue2009VisibilityErrorCopyForLeg(code, null);

/**
 * issue #2009 — SPEC §6 requires exactly one success signal, naming the
 * persisted Business label.
 */
export const issue2009VisibilitySuccessCopy = (
  requested: DraftEventVisibility,
): string =>
  `Visibility updated to ${
    requested === "unlisted" ? "Unlisted" : requested === "private" ? "Private" : "Public"
  }.`;

export interface SetPublishedEventVisibilityInput {
  eventId: string;
  requestedVisibility: DraftEventVisibility;
  reason: string;
  /**
   * The `events.updated_at` the editor loaded. Mandatory for a real change —
   * the RPC rejects a mismatch with `stale_event_visibility` and writes
   * nothing. A same-value replay is an idempotent no-op evaluated BEFORE this
   * check, so a retry that carries a pre-success timestamp still succeeds.
   */
  expectedUpdatedAt: string;
}

export interface SetPublishedEventVisibilityResult {
  eventId: string;
  requestedVisibility: DraftEventVisibility;
  /** Stored value: Business `unlisted` maps to stored `hidden`. */
  storedVisibility: "public" | "hidden" | "private";
  previousStoredVisibility: string;
  updatedAt: string;
  changed: boolean;
  revokedShareCount: number;
}

const storedVisibilityForRequest = (
  requested: DraftEventVisibility,
): "public" | "hidden" | "private" =>
  requested === "unlisted" ? "hidden" : requested;

/**
 * issue #2009 — set a published standard ticketed event's visibility through
 * the ONLY authoritative mutation, `business_set_event_visibility`.
 *
 * There is deliberately NO direct `events` table `…update…({ visibility })`
 * path here or anywhere else: the RPC owns authorization (an
 * authorization-bearing first row lock), value/type/status validation, the
 * same-value no-op, optimistic concurrency, the Private fail-closed refusal,
 * the discovery-generation increment, share revocation cardinality and the
 * single audit row. A direct table UPDATE from an `authenticated` client is
 * refused by the database.
 *
 * (The call above is deliberately elided with `…`. Writing it out in full puts
 * a literal mutation call into prose, and `i-proposed-i-mutation-rowcount-verified`
 * does not strip comments before matching — it read this sentence as an
 * unverified mutation site. Per COMMS-0141 the house convention for naming a
 * gate-matched token inside a comment is to elide it.)
 *
 * Never claims success optimistically: the RPC echo is verified before the
 * caller may invalidate or navigate. Throws a plain Error whose message is the
 * server's stable code so the editor can map honest copy.
 */
export const setPublishedEventVisibility = async (
  input: SetPublishedEventVisibilityInput,
): Promise<SetPublishedEventVisibilityResult> => {
  const { data, error } = await supabase.rpc("business_set_event_visibility", {
    p_event_id: input.eventId,
    p_requested_visibility: input.requestedVisibility,
    p_reason: input.reason,
    p_expected_updated_at: input.expectedUpdatedAt,
  });

  if (error !== null) {
    throw new Error(error.message ?? "set_event_visibility_failed");
  }
  const echo = data as SetPublishedEventVisibilityResult | null;
  if (echo === null || echo === undefined) {
    throw new Error("set_event_visibility_empty_response");
  }
  // Echo verification (SPEC §6: "Do not optimistically claim success. Use the
  // RPC echo; require requested/stored mapping to match.").
  if (
    echo.eventId !== input.eventId ||
    echo.requestedVisibility !== input.requestedVisibility ||
    echo.storedVisibility !== storedVisibilityForRequest(input.requestedVisibility)
  ) {
    throw new Error("set_event_visibility_echo_mismatch");
  }
  return echo;
};

/**
 * The three fields the leg needs off the loaded event. Declared structurally
 * rather than importing `LiveEvent` so the editor can hand its event straight
 * over — the call site stays one short expression, which is the whole point of
 * moving this out of the eager chunk.
 */
export interface Issue2009EditorEvent {
  /** `null` when the editor loaded a row that has no server id yet. */
  serverEventId: string | null;
  /** `events.updated_at` as loaded — the optimistic-concurrency boundary. */
  updatedAt: string;
  /** The value the editor LOADED, i.e. which leg of the Private boundary. */
  visibility: string | null | undefined;
}

export type ApplyEditorVisibilityOutcome =
  | {
      ok: true;
      /**
       * SPEC §6 requires EXACTLY ONE success signal, and for a visibility-only
       * save it names the persisted label. A wider patch keeps the editor's
       * existing generic confirmation, so this is `null` and the caller falls
       * back to it.
       */
      successToast: string | null;
    }
  | { ok: false; toast: string };

/**
 * issue #2009 — the editor's whole visibility save leg, executed here so the
 * eager boot chunk carries none of it (issue #2099 SC-4).
 *
 * Server-success-then-local: a refusal returns `ok: false` with honest copy and
 * the editor aborts without claiming a partial success. It NEVER swallows the
 * failure — every path returns a sentence the organiser can act on.
 */
export const issue2009ApplyEditorVisibility = async (
  liveEvent: Issue2009EditorEvent,
  patch: { visibility?: DraftEventVisibility },
  reason: string,
): Promise<ApplyEditorVisibilityOutcome> => {
  const requested = patch.visibility;
  if (requested === undefined) {
    // The editor only calls this when the diff carries visibility; a patch that
    // does not is a no-op rather than a failure.
    return { ok: true, successToast: null };
  }
  if (liveEvent.serverEventId === null) {
    return {
      ok: false,
      toast: "Save failed because this event is missing its server id.",
    };
  }
  try {
    await setPublishedEventVisibility({
      eventId: liveEvent.serverEventId,
      requestedVisibility: requested,
      reason,
      // The optimistic-concurrency boundary is the value this editor LOADED, so
      // a concurrent edit elsewhere is rejected rather than silently overwritten.
      expectedUpdatedAt: liveEvent.updatedAt,
    });
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "set_event_visibility_failed";
    // issue #2009 (pass-1 TEST REPORT P2-2) — `private_visibility_unavailable`
    // is raised on BOTH legs of the boundary, so hand the copy map the
    // visibility this event is currently stored at. Without it an organiser
    // moving OFF Private is told to "Choose Public or Unlisted", which is
    // exactly what they just tried.
    return { ok: false, toast: issue2009VisibilityErrorCopyForLeg(code, liveEvent.visibility) };
  }
  // SPEC §6 — a visibility-ONLY save names the persisted label; any wider patch
  // keeps the editor's existing generic confirmation.
  return {
    ok: true,
    successToast:
      Object.keys(patch).length === 1
        ? issue2009VisibilitySuccessCopy(requested)
        : null,
  };
};
