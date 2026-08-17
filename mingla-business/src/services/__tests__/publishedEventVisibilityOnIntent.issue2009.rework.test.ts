/**
 * issue #2009 [published-event visibility] — REWORK regression test for the
 * on-intent code split forced by issue #2099's boot-payload ceiling.
 *
 * WHAT CHANGED AND WHY THIS EXISTS.
 * The visibility mutation, its copy and its error mapping used to sit in
 * `businessEvents.ts`, and the editor's save leg sat inline in
 * `EditPublishedScreen.tsx`. Both files are hoisted into the eager `__common`
 * boot chunk, so that shape charged every visitor 3,379 B before any route
 * rendered. The code now lives in `publishedEventVisibility.issue2009.ts`,
 * which the editor reaches through a DYNAMIC import at the moment the organiser
 * saves.
 *
 * A code split is a runtime change, not a cosmetic one: the module now resolves
 * asynchronously, and the editor's save leg now runs BEHIND that resolution. So
 * this suite drives the leg through the SAME dynamic specifier the screen uses
 * and asserts the save still behaves exactly as before the split.
 *
 * Per #2113 every test here EXECUTES the leg. Nothing reads source text — the
 * source-level half (the screen must not statically import the module) is the
 * `issue-2009-published-event-visibility` gate's M55/M56 fixtures, and the
 * measured half is the `issue-2099-boot-payload-ceiling` job.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { supabase } from "../supabase";

jest.mock("../supabase", () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

type RpcResult = { data: unknown; error: { message: string } | null };

const rpc = supabase.rpc as unknown as jest.Mock<
  (name: string, args: Record<string, unknown>) => Promise<RpcResult>
>;

const EVENT_ID = "0f2c9c40-4d1e-4a2f-9f0e-1d6d2ca9f3b1";
const LOADED_AT = "2026-08-17T09:15:00.000Z";
const REASON = "Switching to unlisted for the private preview week";

/**
 * The EXACT specifier `EditPublishedScreen.tsx` passes to `import()`, resolved
 * from this file's directory instead of the screen's. If the module is ever
 * renamed or folded back into `businessEvents.ts`, this import fails and the
 * whole suite goes red rather than silently testing nothing.
 */
const loadOnIntent = async (): Promise<
  typeof import("../publishedEventVisibility.issue2009")
> => import("../publishedEventVisibility.issue2009");

const editorEvent = (
  over: Partial<{
    serverEventId: string | null;
    updatedAt: string;
    visibility: string | null;
  }> = {},
): { serverEventId: string | null; updatedAt: string; visibility: string | null } => ({
  serverEventId: EVENT_ID,
  updatedAt: LOADED_AT,
  visibility: "public",
  ...over,
});

const okEcho = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  eventId: EVENT_ID,
  requestedVisibility: "unlisted",
  storedVisibility: "hidden",
  previousStoredVisibility: "public",
  updatedAt: "2026-08-17T10:00:00.000Z",
  changed: true,
  revokedShareCount: 0,
  ...over,
});

describe("issue #2009 rework — the visibility leg still works as an on-intent chunk", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---- R-1: the split target is actually loadable at runtime --------------
  test("R-1: the dynamic specifier the editor uses resolves and exposes the whole leg", async () => {
    const mod = await loadOnIntent();

    expect(typeof mod.issue2009ApplyEditorVisibility).toBe("function");
    expect(typeof mod.setPublishedEventVisibility).toBe("function");
    expect(typeof mod.issue2009VisibilityErrorCopyForLeg).toBe("function");
    expect(typeof mod.issue2009VisibilitySuccessCopy).toBe("function");
    expect(mod.ISSUE_2009_PRIVATE_UNAVAILABLE_COPY).toContain(
      "Private events are not ready to accept invited guests yet",
    );
  });

  // ---- R-2: the editor's save still reaches the RPC with the SAME arguments
  test("R-2: a visibility-only save calls business_set_event_visibility with the editor's exact arguments", async () => {
    rpc.mockResolvedValue({ data: okEcho(), error: null });
    const { issue2009ApplyEditorVisibility } = await loadOnIntent();

    const outcome = await issue2009ApplyEditorVisibility(
      editorEvent(),
      { visibility: "unlisted" },
      REASON,
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("business_set_event_visibility", {
      p_event_id: EVENT_ID,
      p_requested_visibility: "unlisted",
      p_reason: REASON,
      // The optimistic-concurrency boundary is the value the editor LOADED.
      p_expected_updated_at: LOADED_AT,
    });
    expect(outcome.ok).toBe(true);
    // SPEC §6 — exactly one success signal, naming the persisted label.
    expect(outcome.ok && outcome.successToast).toBe("Visibility updated to Unlisted.");
  });

  // ---- R-3: a WIDER patch keeps the editor's generic confirmation ---------
  test("R-3: visibility inside a wider patch saves but yields no visibility-specific toast", async () => {
    rpc.mockResolvedValue({ data: okEcho({ requestedVisibility: "public", storedVisibility: "public" }), error: null });
    const { issue2009ApplyEditorVisibility } = await loadOnIntent();

    const outcome = await issue2009ApplyEditorVisibility(
      editorEvent({ visibility: "hidden" }),
      { visibility: "public", title: "Renamed too" } as { visibility: "public" },
      REASON,
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(true);
    // null => the caller falls back to "Saved. Live now.", exactly as before.
    expect(outcome.ok && outcome.successToast).toBeNull();
  });

  // ---- R-4: both legs of the Private boundary keep their own sentence -----
  test("R-4: entering Private and leaving Private map to DIFFERENT honest sentences", async () => {
    const { issue2009ApplyEditorVisibility, ISSUE_2009_PRIVATE_UNAVAILABLE_COPY, ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY } =
      await loadOnIntent();

    rpc.mockResolvedValue({
      data: null,
      error: { message: "private_visibility_unavailable" },
    });

    const entering = await issue2009ApplyEditorVisibility(
      editorEvent({ visibility: "public" }),
      { visibility: "private" },
      REASON,
    );
    const leaving = await issue2009ApplyEditorVisibility(
      editorEvent({ visibility: "private" }),
      { visibility: "public" },
      REASON,
    );

    expect(entering.ok).toBe(false);
    expect(leaving.ok).toBe(false);
    expect(!entering.ok && entering.toast).toBe(ISSUE_2009_PRIVATE_UNAVAILABLE_COPY);
    expect(!leaving.ok && leaving.toast).toBe(ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY);
    expect(ISSUE_2009_PRIVATE_UNAVAILABLE_COPY).not.toBe(ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY);
    // P2-2 — the exit sentence must not repeat the advice the organiser took.
    expect(ISSUE_2009_PRIVATE_EXIT_UNAVAILABLE_COPY).not.toMatch(/Choose Public or Unlisted/i);
  });

  // ---- R-5: a stale editor is refused, never silently overwritten ---------
  test("R-5: a stale expected timestamp surfaces the reload sentence and saves nothing", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "stale_event_visibility" },
    });
    const { issue2009ApplyEditorVisibility } = await loadOnIntent();

    const outcome = await issue2009ApplyEditorVisibility(
      editorEvent(),
      { visibility: "unlisted" },
      REASON,
    );

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.toast).toBe(
      "This event changed elsewhere. Review the latest visibility and try again.",
    );
  });

  // ---- R-6: no server id => no RPC, and an honest sentence ----------------
  test("R-6: an event with no server id never reaches the RPC", async () => {
    const { issue2009ApplyEditorVisibility } = await loadOnIntent();

    const outcome = await issue2009ApplyEditorVisibility(
      editorEvent({ serverEventId: null }),
      { visibility: "unlisted" },
      REASON,
    );

    expect(rpc).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.toast).toBe(
      "Save failed because this event is missing its server id.",
    );
  });

  // ---- R-7: success is never claimed optimistically -----------------------
  test("R-7: an echo that disagrees with the request is a failure, not a success", async () => {
    // Server says it stored `public` while the editor asked for `unlisted`.
    rpc.mockResolvedValue({
      data: okEcho({ storedVisibility: "public" }),
      error: null,
    });
    const { issue2009ApplyEditorVisibility } = await loadOnIntent();

    const outcome = await issue2009ApplyEditorVisibility(
      editorEvent(),
      { visibility: "unlisted" },
      REASON,
    );

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.toast).toBe(
      "Couldn't save visibility. Check your connection and try again.",
    );
  });
});
