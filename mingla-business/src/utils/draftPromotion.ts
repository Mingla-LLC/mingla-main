/**
 * draftPromotion — issue #976 [event-name-focus]: the SINGLE owner of every
 * client-draft (`d_<ts36>`) → server-draft promotion in mingla-business.
 *
 * Why this module exists (runtime-proven on the physical Samsung, issue #976):
 * promotion used to have FOUR independent call sites (the ORCH-0893 legacy
 * migration loop in useServerDraftEvents.ts, both edit routes' autosave
 * wrappers, and both preview routes' eager migrations). The legacy loop fired
 * with ZERO debounce on the first dirty keystroke from list-hook instances
 * mounted BEHIND the wizard (Home to-dos, Hub layout, hub/events,
 * GlobalSearch), each per-hook `migratingIdsRef` blind to the others — one
 * typing session minted up to 3 duplicate `events` rows, and the loop's
 * snapshot `replaceDraft` destroyed the user's live keystrokes and unmounted
 * the focused name TextInput (keyboard drop).
 *
 * The registry is module-level and single-flight per d_* id:
 *   - concurrent callers join ONE in-flight `createServerDraft` promise;
 *   - a session-resolved d_* id can never be promoted again (`resolved` map);
 *   - the store swap live-merges the user's keystrokes at resolve time
 *     (`mergeLiveDraftIntoServerDraft`) instead of landing a stale snapshot;
 *   - a draft discarded mid-flight is never resurrected — the just-created
 *     ghost row is soft-discarded.
 *
 * Enforced by `.github/scripts/strict-grep/orch-0976-single-promotion-owner.mjs`
 * (I-PROPOSED-0976-SINGLE-DRAFT-PROMOTION-OWNER): `createServerDraft(` may only
 * be called from `src/services/eventDrafts.ts` (definition) and this module.
 *
 * Pure TS module — no React.
 */

import type { QueryClient } from "@tanstack/react-query";

import { createServerDraft, discardServerDraft } from "../services/eventDrafts";
import {
  useDraftEventStore,
  type DraftEvent,
} from "../store/draftEventStore";
// NOTE: `eventDraftKeys` lives in the hooks module, which itself imports this
// registry — a benign CJS/Metro cycle: both sides dereference the other ONLY at
// call time (inside function bodies), never during module initialization.
import { eventDraftKeys } from "../hooks/useServerDraftEvents";

type ServerDraftWithLegacy = DraftEvent & { legacyLocalDraftId?: string };

/**
 * Live-merge for the d_*→server identity swap.
 *
 * DIRECTION IS INVERTED ON PURPOSE — the live Zustand draft (re-read at resolve
 * time) wins EVERY user-authored field via the spread; the server draft
 * supplies ONLY its identity/issued fields, enumerated below. The pre-#976
 * route merges spread the SERVER draft and enumerated the live fields to copy
 * over it — and those enumerated lists silently drifted (they already dropped
 * `rsvpContributionEnabled`/`rsvpContributionSuggestedCents`/
 * `rsvpContributionMinCents`, `pricingSwitches`, and the whole Step-6 settings
 * cluster, and the RSVP/event lists had drifted from each other). Spreading the
 * LIVE draft makes "a new user field survives the swap" true by construction —
 * enumerated-live-field merge lists are BANNED
 * (I-PROPOSED-0976-PROMOTION-PRESERVES-LIVE-KEYSTROKES).
 */
export const mergeLiveDraftIntoServerDraft = (
  serverDraft: ServerDraftWithLegacy,
  liveDraft: DraftEvent | null,
): ServerDraftWithLegacy => {
  if (liveDraft === null) {
    // No live state to preserve — return the SAME object identity (matches the
    // sealed ORCH-0893 merge semantic for the no-live-draft branch).
    return serverDraft;
  }
  return {
    ...liveDraft,
    // Server-owned identity/issued fields:
    id: serverDraft.id,
    brandId: serverDraft.brandId,
    serverSlug: serverDraft.serverSlug,
    status: serverDraft.status,
    createdAt: serverDraft.createdAt,
    updatedAt: serverDraft.updatedAt,
    // MUST be carried — the edit routes' safety belt scans list caches by it.
    legacyLocalDraftId: serverDraft.legacyLocalDraftId,
    // The service resolves the brand-default currency server-side when the
    // local draft has none — live must not stomp it back to null.
    currency: liveDraft.currency ?? serverDraft.currency,
    lastStepReached: Math.max(
      liveDraft.lastStepReached,
      serverDraft.lastStepReached,
    ),
    clientRevision: Math.max(
      liveDraft.clientRevision ?? 0,
      serverDraft.clientRevision ?? 0,
    ),
  };
};

/**
 * Rejection type for a promotion request whose source draft is missing from
 * the store (already promoted + swapped, or discarded) or is not a client
 * `d_*` draft. Callers treat this as a quiet no-op — it is not a failure.
 */
export class PromotionSourceMissingError extends Error {
  code: "promotion_source_missing";
  draftId: string;

  constructor(draftId: string) {
    super(`No promotable client draft in the store for id: ${draftId}`);
    this.name = "PromotionSourceMissingError";
    this.code = "promotion_source_missing";
    this.draftId = draftId;
  }
}

const PROMOTION_FAILURE_BACKOFF_MS = 15_000;

// Module-level single-flight registry. Keys are d_* ids only.
const inFlight = new Map<string, Promise<ServerDraftWithLegacy>>();
const resolved = new Map<string, ServerDraftWithLegacy>();
const lastFailureAt = new Map<string, number>();

/**
 * Promote a client `d_*` draft to a server draft — AT MOST ONCE per id.
 *
 * Order of operations:
 *   1. Session-resolved id → resolved promise (no new request, ever).
 *      In-flight id → the SAME promise (concurrent callers join it).
 *   2. Source draft re-read from the store NOW; missing / non-d_* → reject
 *      with PromotionSourceMissingError (quiet no-op for callers).
 *   3. One `createServerDraft`; on resolve the LIVE draft is re-read and
 *      live-merged (mergeLiveDraftIntoServerDraft) before the store swap +
 *      React-Query cache writes. Discarded mid-flight → no swap, no cache
 *      writes, ghost row soft-discarded.
 *   4. On reject the failure instant is recorded for `isPromotionBackedOff`
 *      and the error is rethrown to the caller.
 */
export const promoteLegacyDraftOnce = (args: {
  queryClient: QueryClient;
  brandId: string;
  draftId: string;
}): Promise<ServerDraftWithLegacy> => {
  const { queryClient, brandId, draftId } = args;

  const alreadyResolved = resolved.get(draftId);
  if (alreadyResolved !== undefined) {
    return Promise.resolve(alreadyResolved);
  }
  const pending = inFlight.get(draftId);
  if (pending !== undefined) {
    return pending;
  }

  const sourceAtCall = useDraftEventStore.getState().getDraft(draftId);
  if (sourceAtCall === null || !sourceAtCall.id.startsWith("d_")) {
    return Promise.reject(new PromotionSourceMissingError(draftId));
  }

  const promotion = createServerDraft(brandId, sourceAtCall)
    .then((serverDraft): ServerDraftWithLegacy => {
      const store = useDraftEventStore.getState();
      const live = store.getDraft(draftId);
      if (live === null) {
        // Discard-mid-flight guard: the user discarded the d_* draft while
        // the insert was in flight. Do NOT resurrect it via replaceDraft and
        // do NOT touch caches — soft-retire the just-created ghost row.
        // Best-effort by design (#976 SPEC §4.1): the row is an orphaned
        // status:'draft' record either way; discard failure must not surface.
        void discardServerDraft(serverDraft.id).catch(() => {});
        resolved.set(draftId, serverDraft);
        return serverDraft;
      }
      const merged = mergeLiveDraftIntoServerDraft(serverDraft, live);
      store.replaceDraft(draftId, merged);
      queryClient.setQueryData<DraftEvent[]>(
        eventDraftKeys.list(brandId),
        (prev) => {
          const next = (prev ?? []).filter((d) => d.id !== merged.id);
          return [merged, ...next];
        },
      );
      queryClient.setQueryData(eventDraftKeys.detail(merged.id), merged);
      resolved.set(draftId, merged);
      return merged;
    })
    .catch((error: unknown) => {
      lastFailureAt.set(draftId, Date.now());
      throw error;
    })
    .finally(() => {
      inFlight.delete(draftId);
    });

  inFlight.set(draftId, promotion);
  return promotion;
};

/**
 * True while the last promotion attempt for this d_* id failed less than
 * 15 s ago. Consulted ONLY by the legacy migration loop — its effect re-runs
 * on every keystroke (it depends on the drafts array), so without backoff an
 * offline session would spam a failing request per keystroke. Route callers
 * ignore backoff: their retry cadence stays user-driven (next debounced save).
 */
export const isPromotionBackedOff = (draftId: string): boolean => {
  const failedAt = lastFailureAt.get(draftId);
  return (
    failedAt !== undefined && Date.now() - failedAt < PROMOTION_FAILURE_BACKOFF_MS
  );
};

/** Test-only: clears the module-level registry between test cases. */
export const __resetDraftPromotionRegistryForTests = (): void => {
  inFlight.clear();
  resolved.clear();
  lastFailureAt.clear();
};
