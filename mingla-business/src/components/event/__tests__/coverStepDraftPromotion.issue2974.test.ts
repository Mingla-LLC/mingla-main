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
 * Deleting the promotion effect, or re-pointing `coverRowId` back at the local
 * draft id, turns this suite red.
 */
describe("#2974 the Cover step resolves a SERVER row before any cover upload", () => {
  const step = repoFile("src/components/event/CreatorStep4Cover.tsx");

  test("T-2974-A-01 the step drives the single promotion owner, not its own insert", () => {
    expect(step).toContain(
      'import { promoteLegacyDraftOnce } from "../../utils/draftPromotion";',
    );
    expect(step).toContain("void promoteLegacyDraftOnce({");
    // I-PROPOSED-0976-SINGLE-DRAFT-PROMOTION-OWNER: never a direct insert here.
    expect(step).not.toContain("createServerDraft(");
  });

  test("T-2974-A-02 it promotes ONLY client-only d_* ids (a real uuid is a no-op)", () => {
    expect(step).toContain('if (!localDraftRowId.startsWith("d_")) return undefined;');
  });

  test("T-2974-A-03 the cover target consumes the promoted server row id", () => {
    expect(step).toContain("const coverRowId = promotedRowId ?? localDraftRowId;");
    // The pre-fix expression handed the local draft id straight to the picker.
    expect(step).not.toContain("const coverRowId = coverMediaEventId ?? draft.id;");
    // META-ORCH-1059 parity: the target stays memoized on the resolved row id.
    expect(step).toMatch(/const\s+target\s*=\s*useMemo<CoverTarget>/);
    expect(step).toMatch(/\[draft\.brandId,\s*coverRowId,\s*coverMediaApplyMode\]/);
  });

  test("T-2974-A-04 a failed promotion is reported, never swallowed", () => {
    expect(step).toContain("[CreatorStep4Cover] draft promotion failed");
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
