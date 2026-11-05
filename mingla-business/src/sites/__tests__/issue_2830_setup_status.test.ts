/**
 * #2830 — one status per step, who is on setup, how the draft is going, the
 * routes, the creators' way back. Pure, so every branch is pinned here.
 *
 * The structural half (creator routes, the migration's field map) is in
 * .github/scripts/strict-grep/issue-2830-sites-foundation.mjs.
 *
 * MINGLA-INVARIANT: I-WEBSITE-SETUP-TICK-MEANS-NOTHING-OPEN | issue #2830 | No tick while a required or recommended field is open.
 */
import {
  DRAFT_CHECK_AFTER_MS,
  DRAFT_GIVE_UP_MS,
  nameInSentence,
  setupDraftState,
  setupPresence,
  setupStepChip,
  setupStepMark,
  setupSteps,
  type RawSetupPart,
  type SetupFlowView,
} from "../setupStatus";
import { websiteTodoFor } from "../websiteTodo";
import { isSetupReturn, safeReturnTo, setupReturnTarget, setupReturnWith } from "../../utils/brandEditReturn";
import { setupStepFromRoute } from "../../screens/ari/setupFlowRoute";
import type { BrandContextField } from "../sitePlanState";

const field = (key: string, over: Partial<BrandContextField> = {}): BrandContextField => ({
  key, label: key, group: "Brand", requirement: "recommended", state: "missing", value: null,
  sourceType: null, sourceRef: null, sourceUrl: null, observedAt: null, ownerConfirmedAt: null,
  exceptionReason: null, humanActionRequired: false, ...over,
});
const part = (key: RawSetupPart["key"], over: Partial<RawSetupPart> = {}): RawSetupPart => ({ key, done: false, skipped: false, fieldCount: 0, openFields: [], ...over });
const statusFor = (parts: RawSetupPart[]) => ({ parts, doneCount: 0, nextPart: null, total: 8 });
const stepOf = (out: ReturnType<typeof setupSteps>, key: string) => out.steps.find((step) => step.key === key)!;
const run = (parts: RawSetupPart[], extra: Partial<Parameters<typeof setupSteps>[0]> = {}) =>
  setupSteps({ setupStatus: statusFor(parts), fields: [], draftFailed: false, publishFailed: false, ...extra });

describe("T-STAT-4 one status, first match wins", () => {
  it("failed beats everything for draft and publish", () => {
    const out = run([part("build", { done: true }), part("publish", { done: true })], { draftFailed: true, publishFailed: true });
    expect(stepOf(out, "build").status).toEqual({ kind: "failed", reason: "draft" });
    expect(stepOf(out, "publish").status).toEqual({ kind: "failed", reason: "publish" });
    expect(setupStepChip(stepOf(out, "build").status)).toBe("Didn't work");
    expect(setupStepMark(stepOf(out, "build").status)).toBe("ring_now");
  });
  it("done is the only tick", () => {
    const out = run([part("offer", { done: true })]);
    expect(setupStepMark(stepOf(out, "offer").status)).toBe("tick");
    expect(setupStepChip(stepOf(out, "offer").status)).toBe("Done");
  });
  it("a minimum-done step with open fields is never a tick (the mixed signal this replaces)", () => {
    const out = run(
      [part("brand", { done: false, fieldCount: 10, openFields: ["contact_email", "city_country", "cover_media"] })],
      { fields: [field("contact_email"), field("city_country"), field("cover_media", { humanActionRequired: true })] },
    );
    const status = stepOf(out, "brand").status;
    expect(status).toMatchObject({ kind: "open", left: 3 });
    expect(setupStepChip(status)).toBe("3 left");
    expect(setupStepMark(status)).toBe("ring_now");
    if (status.kind === "open") expect(status.fields.map((row) => row.key)).toEqual(["contact_email", "city_country", "cover_media"]);
  });
  it("only uploads left reads Needs your upload", () => {
    const out = run(
      [part("brand", { fieldCount: 10, openFields: ["cover_media"] })],
      { fields: [field("cover_media", { humanActionRequired: true })] },
    );
    expect(setupStepChip(stepOf(out, "brand").status)).toBe("Needs your upload");
  });
  it("skipped keeps a ring and is one tap away; not started has no words", () => {
    const out = run([part("first_offering", { skipped: true }), part("story", { fieldCount: 3, openFields: ["story.who", "story.why", "story.main_action"] })],
      { fields: [field("story.who"), field("story.why"), field("story.main_action")] });
    expect(setupStepChip(stepOf(out, "first_offering").status)).toBe("Skipped");
    expect(setupStepMark(stepOf(out, "first_offering").status)).toBe("ring");
    expect(stepOf(out, "story").status).toEqual({ kind: "not_started" });
    expect(setupStepChip(stepOf(out, "story").status)).toBeNull();
    expect(setupStepMark(stepOf(out, "story").status)).toBe("ring");
  });
  it("a stale found value counts as partly answered", () => {
    const out = run([part("look", { fieldCount: 1, openFields: ["design_key"] })], { fields: [field("design_key", { state: "stale" })] });
    expect(stepOf(out, "look").status).toMatchObject({ kind: "open", left: 1 });
  });
  it("counts done and skipped, finds the next, marks owner-only steps", () => {
    const out = run([part("offer", { done: true }), part("first_offering", { skipped: true })]);
    expect(out.doneCount).toBe(2);
    expect(out.total).toBe(8);
    expect(out.nextKey).toBe("brand");
    expect(out.steps.filter((step) => step.ownerOnly).map((step) => step.key)).toEqual(["approve", "build", "publish"]);
  });
  it("deploy window: no setup_status falls back to the plan's ticks", () => {
    const out = setupSteps({ setupStatus: null, fallbackParts: [{ key: "offer", done: true, skipped: false }, { key: "first_offering", done: true, skipped: true }], fields: [], draftFailed: false, publishFailed: false });
    expect(stepOf(out, "offer").status).toEqual({ kind: "done" });
    expect(stepOf(out, "first_offering").status).toEqual({ kind: "skipped" });
  });
});

const flowView = (over: Partial<SetupFlowView> = {}): SetupFlowView => ({
  runId: "r", status: "awaiting_owner", stepKey: "brand", revision: 3, mine: false, stopped: false,
  ownerName: "Ama", ownerSince: "2026-11-04T10:00:00Z", lastActivityAt: null, conversationId: null,
  canTakeOver: true, lastTakeover: null, ...over,
});

describe("T-PRES-1 who is on setup", () => {
  const presence = (over: Partial<Parameters<typeof setupPresence>[0]>) =>
    setupPresence({ paused: false, flow: null, lock: null, canManage: true, wasMine: false, ...over });
  it("paused beats everything", () => {
    expect(presence({ paused: true, flow: flowView() }).kind).toBe("paused");
  });
  it("nobody else is free; my own run is free", () => {
    expect(presence({}).kind).toBe("free");
    expect(presence({ flow: flowView({ mine: true }) }).kind).toBe("free");
    expect(presence({ lock: { active: true, heldByMe: true, holderName: "Me" } }).kind).toBe("free");
  });
  it("a teammate's live run is active, with take over for an admin only", () => {
    expect(presence({ flow: flowView() })).toEqual({ kind: "active", source: "ari", name: "Ama", stepKey: "brand", canTakeOver: true });
    expect(presence({ flow: flowView({ canTakeOver: false }), canManage: false })).toMatchObject({ kind: "active", canTakeOver: false });
  });
  it("a lock held by someone else is active by hand, even over a stale run", () => {
    expect(presence({ lock: { active: true, heldByMe: false, holderName: "Tobi" } })).toMatchObject({ kind: "active", source: "hand", name: "Tobi" });
    expect(presence({ flow: flowView({ stopped: true }), lock: { active: true, heldByMe: false, holderName: "Tobi" } })).toMatchObject({ kind: "active", source: "hand" });
  });
  it("a stopped run can be continued by an admin", () => {
    expect(presence({ flow: flowView({ stopped: true }) })).toEqual({ kind: "stopped", name: "Ama", since: "2026-11-04T10:00:00Z", stepKey: "brand", canContinue: true });
    expect(presence({ flow: flowView({ stopped: true }), canManage: false })).toMatchObject({ kind: "stopped", canContinue: false });
  });
  it("what was mine and isn't any more is displaced, naming who", () => {
    expect(presence({ flow: flowView(), wasMyRun: true })).toEqual({ kind: "displaced", name: "Ama" });
    expect(presence({ lock: { active: true, heldByMe: false, holderName: "Tobi" }, wasMine: true })).toEqual({ kind: "displaced", name: "Tobi" });
  });
  it("no name is Your teammate, never blank, and reads naturally mid-sentence", () => {
    expect(presence({ flow: flowView({ ownerName: null }) })).toMatchObject({ name: "Your teammate" });
    expect(presence({ lock: { active: true, heldByMe: false, holderName: null } })).toMatchObject({ name: "Your teammate" });
    expect(`we'll tell ${nameInSentence("Your teammate")} why`).toBe("we'll tell your teammate why");
    expect(nameInSentence("Ama")).toBe("Ama");
  });
});

describe("T-DRAFT-1 draft state from server truth", () => {
  const NOW = 1_700_000_000_000;
  const at = (ms: number) => new Date(NOW - ms).toISOString();
  const base = { buildDone: false, approved: true, composePending: false, composeFailed: false, ensurePending: false, now: NOW };
  const provisioning = (status: string | null, age: number) => ({ status: "provisioning", latest_provision_operation: status ? { operation_id: "op", status, updated_at: at(age) } : null });
  it("no site", () => {
    expect(setupDraftState({ ...base, site: null })).toEqual({ kind: "can_start" });
    expect(setupDraftState({ ...base, site: null, approved: false })).toEqual({ kind: "not_ready" });
  });
  it("ready site with the build done", () => {
    expect(setupDraftState({ ...base, site: { status: "draft" }, buildDone: true })).toEqual({ kind: "ready" });
  });
  it("working now is building", () => {
    expect(setupDraftState({ ...base, site: null, ensurePending: true })).toEqual({ kind: "building" });
    expect(setupDraftState({ ...base, site: { status: "draft" }, composePending: true })).toEqual({ kind: "building" });
  });
  it("error, an error code, a failed receipt, or provisioning with no receipt is state 8, new operation", () => {
    for (const site of [
      { status: "error" },
      { status: "provisioning", provisioning_error_code: "X" },
      { status: "provisioning", latest_provision_operation: { status: "failed" } },
      { status: "provisioning", latest_provision_operation: null },
    ]) expect(setupDraftState({ ...base, site })).toEqual({ kind: "failed", retry: "new_operation" });
  });
  it("the 90 second and 5 minute boundaries", () => {
    expect(setupDraftState({ ...base, site: provisioning("executing", DRAFT_CHECK_AFTER_MS - 1) })).toEqual({ kind: "building" });
    expect(setupDraftState({ ...base, site: provisioning("executing", DRAFT_CHECK_AFTER_MS) })).toEqual({ kind: "checking" });
    expect(setupDraftState({ ...base, site: provisioning("ambiguous", 1_000) })).toEqual({ kind: "checking" });
    expect(setupDraftState({ ...base, site: provisioning("ambiguous", DRAFT_GIVE_UP_MS - 1) })).toEqual({ kind: "checking" });
    expect(setupDraftState({ ...base, site: provisioning("ambiguous", DRAFT_GIVE_UP_MS) })).toEqual({ kind: "failed", retry: "same_operation" });
  });
  it("a ready site with the build not done composes; a failed compose retries compose only", () => {
    expect(setupDraftState({ ...base, site: { status: "draft" } })).toEqual({ kind: "building" });
    expect(setupDraftState({ ...base, site: { status: "draft" }, composeFailed: true })).toEqual({ kind: "failed", retry: "compose" });
    expect(setupDraftState({ ...base, site: { status: "draft" }, approved: false })).toEqual({ kind: "not_ready" });
  });
});

describe("Home agrees with the screen", () => {
  it("reads setup_status when it is there, and links to setup", () => {
    const todo = websiteTodoFor("b", { entitled: true, can_manage: true, plan: {}, status: { done_count: 5, next_part: "story" }, setup_status: { done_count: 2, next_part: "brand" } });
    expect(todo).toEqual({ variant: "finish", route: "/brand/b/website/setup", done: 2, nextLabel: "Your brand details" });
    const old = websiteTodoFor("b", { entitled: true, can_manage: true, plan: {}, status: { done_count: 5, next_part: "story" } });
    expect(old).toMatchObject({ done: 5, nextLabel: "Your story" });
  });
});

describe("T-RET-1 the creators' way back", () => {
  it("accepts only Website setup, never another path or host", () => {
    expect(isSetupReturn("/brand/b1/website/setup")).toBe(true);
    expect(isSetupReturn("/brand/b1/website/setup?step=first_offering")).toBe(true);
    for (const bad of ["https://x.test/brand/b1/website/setup", "//x.test/brand/b1/website/setup", "/brand/b1/edit", "/brand/b1/website/setupx", "/brand//website/setup", "/brand/b1/website/setup/../../evil", " ", null, undefined, 7]) {
      expect(isSetupReturn(bad)).toBe(false);
    }
    expect(safeReturnTo("https://x.test")).toBeNull();
  });
  it("names what came back; a draft that never reached the server just comes back", () => {
    expect(setupReturnWith("/s?step=first_offering", "trip", "t 1")).toBe("/s?step=first_offering&added=trip&addedId=t%201");
    expect(setupReturnTarget("/s", "real-id")).toBe("/s?added=event&addedId=real-id");
    expect(setupReturnTarget("/s", "d_abc")).toBe("/s");
    expect(setupReturnTarget("/s", null)).toBe("/s");
  });
  it("a card's route is a step on the same screen, or a real page", () => {
    expect(setupStepFromRoute("/brand/b/edit?section=contact", "b")).toBe("brand");
    expect(setupStepFromRoute("/brand/b/website/plan?part=approve", "b")).toBe("approve");
    expect(setupStepFromRoute("/brand/b/website/plan", "b")).toBe("approve");
    expect(setupStepFromRoute("/brand/b/website/setup?step=story", "b")).toBe("story");
    expect(setupStepFromRoute("/brand/other/edit", "b")).toBeNull();
    expect(setupStepFromRoute("/trip/create", "b")).toBeNull();
  });
});

describe("#2830 setup has no tab bar to clear", () => {
  it("every Ari clearance reads one value that is 0 inside Website setup", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const screen = fs.readFileSync(path.resolve(__dirname, "../../screens/ari/AriChatScreen.tsx"), "utf8");
    expect(screen).toContain("const BOTTOM_NAV_CLEARANCE_PX = websiteSetup ? 0 : TAB_BAR_CLEARANCE_PX;");
    // No second, module-level 80 that a use could silently fall back to.
    expect(screen).not.toMatch(/^const BOTTOM_NAV_CLEARANCE_PX/m);
  });
});
