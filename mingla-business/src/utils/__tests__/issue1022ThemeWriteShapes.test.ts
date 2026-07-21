import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

/**
 * #1022 — the save-correctness write shapes.
 *
 * Covers SPEC test cases T-12 (Experience write), T-29 (exit flush) and
 * T-30 (post-promotion retry), plus the A/F-2 ORCH-1355 port.
 *
 * These are source gates for the same reason documented in
 * issue1022TripThemePristine.test.ts: the hosts are JSX-bearing modules that
 * transitively import react-native, which the default node/ts-jest project
 * cannot transform. Behavioural mounts belong to the tester under a dedicated
 * RN render config.
 *
 * Every assertion here maps to one of Seth's six defect classes:
 *   save/autosave  -> T-12, T-29, T-30
 *   state ownership -> A/F-2 port (stable callback, fresh store read)
 */

const src = (relativePath: string): string =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

const between = (text: string, from: string, to: string): string => {
  const a = text.indexOf(from);
  expect(a).toBeGreaterThan(-1);
  const b = text.indexOf(to, a);
  return text.slice(a, b > a ? b : undefined);
};

describe("T-12 — Experience persists theme to COLUMNS, never a publish payload key", () => {
  const wizard = (): string =>
    src("src/components/experience/ExperienceCreatorWizard.tsx");

  test("the theme is flushed as soon as ensureDraft resolves a real id", () => {
    const body = between(
      wizard(),
      "const ensureDraft = useCallback(",
      "const goNext = useCallback(",
    );
    expect(body).toContain("setExperienceId(newId)");
    expect(body).toContain("flushThemeWrite(newId)");
  });

  test("the theme is flushed again after the publish RPC returns", () => {
    const w = wizard();
    const publishAt = w.indexOf('supabase.rpc("biz_publish_experience"');
    const flushAt = w.indexOf("await flushThemeWrite(savedId)");
    expect(publishAt).toBeGreaterThan(-1);
    expect(flushAt).toBeGreaterThan(publishAt);
  });

  test("buildPayload carries NO theme override key — the RPCs write zero theme columns", () => {
    const body = between(
      wizard(),
      "const buildPayload",
      "const ensureDraft = useCallback(",
    );
    expect(body).not.toContain("theme_color_override");
    expect(body).not.toContain("theme_font_override");
    expect(body).not.toContain("theme_animation_override");
  });

  test("the write goes through the canonical module, not a bespoke supabase call", () => {
    const w = wizard();
    expect(w).toContain('from "../../services/offeringTheme"');
    expect(w).toContain("patchOfferingTheme({");
  });

  test("a failed theme write surfaces a toast — never a silent failure", () => {
    const body = between(
      wizard(),
      "const flushThemeWrite = useCallback(",
      "const handleThemeChange",
    );
    expect(body).toMatch(/catch\s*\{[\s\S]*setToast\(/);
  });
});

describe("T-29 — exit flush: a pick made inside the 700ms debounce is not lost", () => {
  test.each([
    ["Event", "src/components/event/EventCreatorWizard.tsx"],
    ["RSVP", "src/components/rsvp/RsvpCreatorWizard.tsx"],
  ])("%s wizard flushes the pending autosave on unmount", (_label, file) => {
    const body = between(
      src(file),
      "const flushPendingAutosave = useCallback(",
      "const queueAutosave = useCallback(",
    );
    // The old code only cleared the timer, discarding the pending write.
    expect(body).toContain("clearTimeout(autosaveTimerRef.current)");
    expect(body).toContain("flush(pending)");
    // and the cleanup must actually call it
    expect(body).toContain("flushPendingAutosave()");
  });

  test.each([
    ["Event", "src/components/event/EventCreatorWizard.tsx"],
    ["RSVP", "src/components/rsvp/RsvpCreatorWizard.tsx"],
  ])("%s wizard also flushes when the app backgrounds", (_label, file) => {
    const text = src(file);
    expect(text).toContain('AppState.addEventListener("change"');
    expect(text).toMatch(/next === "background" \|\| next === "inactive"/);
  });
});

describe("T-30 — a pick made during d_* promotion is retried after the swap", () => {
  test.each([
    ["event", "app/event/[id]/edit.tsx"],
    ["rsvp", "app/rsvp/[id]/edit.tsx"],
  ])("%s edit route records and flushes the owed save", (_label, file) => {
    const text = src(file);
    // the in-flight guard must RECORD rather than silently drop
    expect(text).toContain("pendingPostPromotionSaveRef.current = true");
    // and the resolve handler must re-drive exactly one save
    expect(text).toContain("pendingPostPromotionSaveRef.current = false");
    expect(text).toContain("autosave.saveDraft(freshDraft)");
    // read FRESH from the store, not the stale captured draft
    expect(text).toContain("useDraftEventStore.getState().getDraft(merged.id)");
  });
});

describe("A/F-2 — the ORCH-1355 stable-callback fix is ported to the Event wizard", () => {
  const eventBody = (): string =>
    between(
      src("src/components/event/EventCreatorWizard.tsx"),
      "const handleUpdate = useCallback(",
      "const handleShowToast",
    );

  test("handleUpdate reads the FRESH post-write draft from the store", () => {
    expect(eventBody()).toContain(
      "useDraftEventStore.getState().getDraft(draftId)",
    );
  });

  test("handleUpdate does NOT rebuild the payload from a captured liveDraft", () => {
    expect(eventBody()).not.toContain("...liveDraft,");
  });

  test("the dep array holds only stable references — never liveDraft", () => {
    const body = eventBody();
    const deps = body.slice(body.lastIndexOf("["), body.lastIndexOf("]") + 1);
    expect(deps).toContain("draftId");
    expect(deps).not.toContain("liveDraft");
  });

  test("both wizards now share the same shape (parity with RSVP)", () => {
    const rsvp = between(
      src("src/components/rsvp/RsvpCreatorWizard.tsx"),
      "const handleUpdate = useCallback(",
      "const handleShowToast",
    );
    expect(rsvp).toContain("useDraftEventStore.getState().getDraft(draftId)");
  });
});
