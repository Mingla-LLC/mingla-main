import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const repoFile = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

/**
 * issue #2974 (a) — you could not add a cover video while CREATING an event.
 *
 * Proven in production: the Cover step handed `event-cover-video-upload-intent`
 * the wizard's client-only draft id (`eventId: "d_mtiqbzuwzsnhq9"`), the
 * function logged `event_id_invalid_uuid` and returned HTTP 400, and
 * `event_cover_video_jobs` gained ZERO rows.
 *
 * The server row was promoted lazily by a 700ms-debounced autosave that can
 * silently no-op. Reaching the Cover step is the point where a server row
 * becomes REQUIRED, so the step forces the promotion itself, through the single
 * owner of every d_*→server promotion (issue #976,
 * I-PROPOSED-0976-SINGLE-DRAFT-PROMOTION-OWNER) — which is single-flight per id
 * and session-idempotent, so it cannot mint a duplicate row alongside the
 * wizard's own promotion.
 *
 * [TEST-MOD-APPROVED #3040] FOUR SUPERSEDED ASSERTIONS, named precisely.
 *
 * T-2974-A-01..A-04 pinned that CreatorStep4Cover itself calls
 * `promoteLegacyDraftOnce`, keeps the result in its own `promotedRowId` state,
 * and reports a failure with `console.warn`. All four are invalidated by #3040,
 * because that arrangement was wrong in BOTH directions:
 *
 *   • On SUCCESS, `promoteLegacyDraftOnce` swaps the store entry from `d_*` to
 *     the server uuid. With the host route never told, the route's `renderDraft`
 *     fell back to the retained `d_*` snapshot (issue #976 D-1) and the wizard
 *     went on editing an id that no longer existed — later edits went nowhere
 *     and the URL never reconciled onto the real row.
 *   • On FAILURE, `console.warn` is invisible. The Cover step stayed silently
 *     unable to upload, which is exactly the state the user was left in.
 *
 * The REQUIREMENT #2974 actually owns — a cover upload during creation must
 * bind to a SERVER row, never a `d_*` id — is unchanged and is asserted below
 * in a stronger form: the row is a rendered PRECONDITION (the picker cannot be
 * opened without it), it is resolved by the route that owns identity, and a
 * failure is a visible, retryable message rather than a console line.
 */
describe("#3040 the Cover step makes the SERVER row a visible precondition", () => {
  const step = repoFile("src/components/event/CreatorStep4Cover.tsx");

  test("T-3040-A-01 the step no longer promotes behind the route's back", () => {
    // Asserted on the CALL and the IMPORT, never the bare identifier: the
    // prose above the effect names the old owner, and an assertion that a
    // comment can satisfy is an assertion that carries no information
    // (reference_audit_regex_matches_comments_same_file).
    expect(step).not.toContain("promoteLegacyDraftOnce({");
    expect(step).not.toContain('from "../../utils/draftPromotion"');
    // I-PROPOSED-0976-SINGLE-DRAFT-PROMOTION-OWNER: never a direct insert here.
    expect(step).not.toContain("createServerDraft(");
    // It asks the host, which owns route state and the URL.
    expect(step).toContain("onRequireServerDraft");
  });

  test("T-3040-A-02 it asks ONLY for client-only d_* ids (a real uuid is a no-op)", () => {
    expect(step).toContain(
      'const needsServerRow = localDraftRowId.startsWith("d_");',
    );
    expect(step).toContain(
      "if (!needsServerRow || onRequireServerDraft === undefined) return;",
    );
  });

  test("T-3040-A-03 the cover target consumes the resolved server row id", () => {
    expect(step).toContain("const coverRowId = serverRowId ?? localDraftRowId;");
    // The pre-fix expression handed the local draft id straight to the picker.
    expect(step).not.toContain("const coverRowId = coverMediaEventId ?? draft.id;");
    // META-ORCH-1059 parity: the target stays memoized on the resolved row id.
    expect(step).toMatch(/const\s+target\s*=\s*useMemo<CoverTarget>/);
    expect(step).toMatch(/\[draft\.brandId,\s*coverRowId,\s*coverMediaApplyMode\]/);
  });

  test("T-3040-A-04 a failed resolution is RENDERED, never a console line", () => {
    expect(step).not.toContain("[CreatorStep4Cover] draft promotion failed");
    expect(step).toContain("setPrepareError(");
    expect(step).toContain('label="Try again"');
    expect(step).toContain("onPress={prepareServerRow}");
    // And the picker cannot be opened while the row is missing.
    expect(step).toContain("disabled={!coverReady}");
  });

  test("T-2974-A-05 the upload hook refuses a non-uuid event target outright", () => {
    const hook = repoFile("src/hooks/useEventCoverVideoUpload.ts");
    expect(hook).toContain(
      'if (exactTarget.serverTarget === "event" && !isServerRowId(exactTarget.eventId)) {',
    );
    expect(hook).toContain('"event_not_ready"');
    // `event_not_ready` must be classified terminal — a 400 is never a spinner.
    expect(hook).toMatch(/const terminalCodes = new Set\(\[[\s\S]*?"event_not_ready"/);
  });
});
