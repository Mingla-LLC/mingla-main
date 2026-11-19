/**
 * #4453 Website workspace — the pure rules behind the workspace: where every
 * old address lands, the one status chip and Publish button, the preview
 * bridge, optimistic section edits, autosave, and Ari's plan as data.
 */
import { parseWebsitePath, type WebsiteRoute } from "../websiteNav";
import { detailSection, sectionJump, workspaceTarget, workspaceTargetKey } from "../workspaceRoute";
import { publishBarButton, publishGate, workspaceStatus, type PublishGateInput } from "../workspaceStatus";
import {
  ariCardPosition, buildMarks, EMPTY_SWAP, markLabel, messageFromFrame, nativeBridgeCall, parsePreviewMessage,
  PREVIEW_READY, PREVIEW_RECTS, PREVIEW_SELECT, scaleRect, sectionViewportRect, stageFrame, swapReducer, viewportRect,
} from "../previewBridge";
import { addRowBlocked, applyFieldEdits, applyLayout, applyMove, applyRemove, changeLabel, moveBlocked, removeBlocked, removeRowBlocked, splitRows, undoTooltip, unreadCount } from "../sectionEdits";
import { createDraftWriter, saveStateLine, type DraftJob, type SaveState } from "../draftWriter";
import {
  adjustedColoursLine, doneLine, failedLine, planFromProposal, questionFrom, runResultFrom, sectionSuggestions, stepStatuses, teamRequestBlocked,
  teamRequestFromCouldnt, teamRequestFromProposal, teamRequestFromSection, teamRequestStatusLine,
} from "../ariWorkspace";
import type { WorkspaceSection } from "../contentApi";

type Shown = Exclude<WebsiteRoute, { kind: "redirect" | "preview" | "setup" }>;
const target = (segments: string[], search: Record<string, string> = {}, drill = false) =>
  workspaceTarget(parseWebsitePath("b1", segments) as Shown, search, drill);

const section = (id: string, over: Partial<WorkspaceSection> = {}): WorkspaceSection => ({
  id, index: 0, type: "hero", label: id, layout: "split", layouts: [{ key: "split", label: "Side by side" }, { key: "centred", label: "Centred" }],
  review: null, feed: false, fields: [{ key: "heading", label: "Headline", kind: "text", value: "Hello", max: 80 }], media: [], can_remove: true, ...over,
});

describe("old addresses land in the workspace", () => {
  it.each([
    [[], "ari", false, null],
    [["pages"], "edit", false, null],
    [["design"], "design", false, null],
    [["publish"], "edit", true, null],
    [["addresses"], "edit", false, "addresses"],
    [["settings"], "edit", false, "settings"],
    [["destinations"], "edit", false, "destinations"],
    [["stories"], "edit", false, "stories"],
    [["reviews"], "edit", false, "reviews"],
    [["past"], "edit", false, "past"],
    [["nonsense"], "ari", false, null],
  ] as const)("/website/%s", (segments, mode, publish, detail) => {
    expect(target([...segments])).toMatchObject({ mode, publish, detail, editor: null });
  });

  it("look and domains still redirect to design and addresses, plan to setup", () => {
    expect(parseWebsitePath("b1", ["look"])).toEqual({ kind: "redirect", to: "/brand/b1/website/design" });
    expect(parseWebsitePath("b1", ["domains"])).toEqual({ kind: "redirect", to: "/brand/b1/website/addresses" });
    expect(parseWebsitePath("b1", ["plan"])).toEqual({ kind: "redirect", to: "/brand/b1/website/setup" });
  });

  it("an editor address opens that entry, and the phone's old overview shows Stats", () => {
    expect(target(["stories", "abc-1"])).toMatchObject({ detail: "stories", editor: { section: "stories", entryId: "abc-1" } });
    expect(target(["overview"], {}, true)).toMatchObject({ detail: "stats" });
  });

  it("?request, ?panel and ?mode are honoured, and junk is ignored", () => {
    expect(target([], { request: "t-123" })).toMatchObject({ detail: "requests", requestId: "t-123" });
    expect(target([], { request: "../../x" })).toMatchObject({ detail: null, requestId: null });
    expect(target([], { panel: "history" })).toMatchObject({ detail: "history" });
    expect(target([], { panel: "wat", mode: "design" })).toMatchObject({ detail: null, mode: "design" });
    expect(target(["publish"], { mode: "ari" })).toMatchObject({ mode: "ari", publish: true });
  });

  it("keys change only when the landing place changes; existing sections get the section they expect", () => {
    expect(workspaceTargetKey(target(["pages"]))).toBe(workspaceTargetKey(target(["pages"])));
    expect(workspaceTargetKey(target(["pages"]))).not.toBe(workspaceTargetKey(target(["design"])));
    expect(detailSection("history", "ari")).toBe("publish");
    expect(detailSection("stats", "ari")).toBe("overview");
    expect(detailSection(null, "design")).toBe("design");
    expect(sectionJump("publish")).toEqual({ publish: true, detail: null });
    expect(sectionJump("pages")).toEqual({ mode: "edit", detail: null });
    expect(sectionJump("addresses")).toEqual({ detail: "addresses" });
  });
});

describe("one status chip and one Publish button", () => {
  const base = { live: true, offline: false, unpublished: 0, unread: 0, publishing: false, failed: false };
  it("says the state in words", () => {
    expect(workspaceStatus(base).text).toBe("Live · up to date");
    expect(workspaceStatus({ ...base, unpublished: 3 }).text).toBe("Live · 3 not published yet");
    expect(workspaceStatus({ ...base, unpublished: 3, unread: 2 })).toEqual({ text: "2 to read · 3 not published", tone: "warn" });
    expect(workspaceStatus({ ...base, unread: 1 }).text).toBe("1 to read first");
    expect(workspaceStatus({ ...base, live: false }).text).toBe("Draft · not live");
    expect(workspaceStatus({ ...base, publishing: true }).text).toBe("Publishing…");
    expect(workspaceStatus({ ...base, failed: true }).tone).toBe("err");
    expect(workspaceStatus({ ...base, offline: true }).text).toMatch(/^Offline/);
  });

  it("the bar button has the six approved states", () => {
    const bar = (over: object) => publishBarButton({ ...base, canPublish: true, ...over }).label;
    expect(bar({})).toBe("Published");
    expect(bar({ unpublished: 1 })).toBe("Publish 1 change");
    expect(bar({ unpublished: 4 })).toBe("Publish 4 changes");
    expect(bar({ publishing: true })).toBe("Publishing…");
    expect(bar({ failed: true })).toBe("See what went wrong");
    expect(bar({ live: false })).toBe("Go live");
  });

  const gate: PublishGateInput = {
    canPublish: true, live: true, unpublished: 3, unread: 0, unreadablePairs: 0, checking: false, blocker: null, checkFailed: false,
    publishing: false, lockedBy: false, offlineDevice: false,
  };
  it("the final button's label is the blocker", () => {
    expect(publishGate(gate)).toMatchObject({ label: "Publish 3 changes", blocked: false, reason: null });
    expect(publishGate({ ...gate, unread: 2 })).toMatchObject({ label: "Read 2 more to publish", blocked: true, next: "read" });
    expect(publishGate({ ...gate, unreadablePairs: 1 })).toMatchObject({ label: "Fix the hard-to-read text first", blocked: true, next: "design" });
    expect(publishGate({ ...gate, blocker: "Two pages use the same address." })).toMatchObject({ label: "Fix 1 thing to publish", reason: "Two pages use the same address." });
    expect(publishGate({ ...gate, checking: true })).toMatchObject({ label: "Checking your draft…", blocked: true });
    expect(publishGate({ ...gate, checkFailed: true })).toMatchObject({ label: "Check again", blocked: false, next: "retry" });
    expect(publishGate({ ...gate, publishing: true }).label).toBe("Publishing…");
    expect(publishGate({ ...gate, lockedBy: "Ada" })).toMatchObject({ label: "Ada is editing", blocked: true });
    expect(publishGate({ ...gate, lockedBy: null }).label).toBe("A teammate is editing");
    expect(publishGate({ ...gate, offlineDevice: true }).label).toBe("You’re offline");
    expect(publishGate({ ...gate, unpublished: 0 })).toMatchObject({ label: "Nothing new to publish", blocked: true });
    expect(publishGate({ ...gate, live: false, unpublished: 0 })).toMatchObject({ label: "Go live", blocked: false });
    expect(publishGate({ ...gate, canPublish: false })).toMatchObject({ label: "Ask an admin to publish", next: "ask" });
  });

  it("every blocked state gives a reason", () => {
    for (const over of [{ unread: 1 }, { unreadablePairs: 2 }, { blocker: "x" }, { publishing: true }, { lockedBy: "A" }, { offlineDevice: true }, { unpublished: 0 }]) {
      const result = publishGate({ ...gate, ...over });
      expect(result.blocked).toBe(true);
      expect(result.reason).toBeTruthy();
    }
  });
});

describe("the preview bridge", () => {
  it("accepts only well-formed messages of ours (objects or JSON text)", () => {
    const ready = { type: PREVIEW_READY, page_path: "about", sections: [{ id: "s1", type: "hero", top: 0, height: 400 }], scroll_y: 12, doc_height: 2000 };
    expect(parsePreviewMessage(ready)).toEqual({ type: PREVIEW_READY, pagePath: "about", sections: [{ id: "s1", type: "hero", top: 0, height: 400 }], scrollY: 12, docHeight: 2000 });
    expect(parsePreviewMessage(JSON.stringify(ready))).not.toBeNull();
    expect(parsePreviewMessage({ type: PREVIEW_RECTS, sections: [{ id: "s1", top: 5, height: 9 }], scroll_y: 0 })).toMatchObject({ type: PREVIEW_RECTS, scrollY: 0 });
    expect(parsePreviewMessage({ type: PREVIEW_SELECT, section_id: "s1", rect: { top: 1, left: 2, width: 3, height: 4 } })).toEqual({ type: PREVIEW_SELECT, sectionId: "s1", rect: { top: 1, left: 2, width: 3, height: 4 }, scrollY: 0 });
    expect(parsePreviewMessage({ type: PREVIEW_SELECT, section_id: "s1", rect: { top: 900, left: 0, width: 3, height: 4 }, scroll_y: 800 })).toMatchObject({ scrollY: 800 });
    expect(viewportRect({ top: 900, left: 0, width: 3, height: 4 }, 800)).toEqual({ top: 100, left: 0, width: 3, height: 4 });
    for (const bad of [null, 4, "hello", "{", { type: "other" }, { type: PREVIEW_SELECT, section_id: "<script>", rect: {} },
      { type: PREVIEW_SELECT, section_id: "s1", rect: { top: 1, left: 2, width: -3, height: 4 } },
      { type: PREVIEW_READY, sections: [{ id: "s1", top: "0", height: 1 }], scroll_y: 0, doc_height: 1 },
      { type: PREVIEW_READY, sections: "x", scroll_y: 0, doc_height: 1 }, { type: PREVIEW_RECTS, sections: [], scroll_y: Number.NaN }]) {
      expect(parsePreviewMessage(bad)).toBeNull();
    }
  });

  it("only a message from one of our own frames counts", () => {
    const a = {}; const b = {};
    expect(messageFromFrame(b, [a, b])).toBe(1);
    expect(messageFromFrame({}, [a, b])).toBe(-1);
    expect(messageFromFrame(null, [null, a])).toBe(-1);
  });

  it("scales frame rects to Host pixels and keeps the Ari card on screen", () => {
    expect(scaleRect({ top: 100, left: 0, width: 1440, height: 400 }, 0.5, { left: 20, top: 10 })).toEqual({ top: 60, left: 20, width: 720, height: 200 });
    expect(scaleRect({ top: 10, left: 10, width: 10, height: 10 }, 0)).toEqual({ top: 10, left: 10, width: 10, height: 10 });
    expect(sectionViewportRect({ id: "s", type: null, top: 900, height: 300 }, 800, 1440)).toEqual({ top: 100, left: 0, width: 1440, height: 300 });
    const stage = { width: 800, height: 600 };
    const inside = ariCardPosition({ top: 50, left: 0, width: 800, height: 300 }, stage);
    expect(inside).toEqual({ top: 62, left: 800 - 340 - 12, width: 340 });
    expect(ariCardPosition({ top: -400, left: 0, width: 800, height: 300 }, stage).top).toBe(12);
    expect(ariCardPosition({ top: 900, left: 0, width: 800, height: 300 }, stage).top).toBe(600 - 260 - 12);
    const narrow = ariCardPosition({ top: 0, left: 0, width: 300, height: 100 }, { width: 300, height: 500 });
    expect(narrow.left).toBe(12);
    expect(narrow.width).toBe(276);
  });

  it("marks: what is selected, what Ari is changing and what is unread", () => {
    const sections = [section("a", { review: { state: "draft", source: "ari" } }), section("b", { review: { state: "draft", source: "team" } }),
      section("c", { review: { state: "reviewed", source: "person" } }), section("d", { review: { state: "draft", source: "composer" } })];
    expect(buildMarks({ sections, selected: "c", ari: "zzz" })).toEqual({ selected: "c", ari: null, unread: [{ id: "a", by: "ari" }, { id: "b", by: "team" }, { id: "d", by: "composer" }] });
    expect(markLabel("team")).toBe("Read me · made by the Mingla team");
    expect(markLabel("ari")).toBe("Read me");
    expect(markLabel(null, true)).toBe("Ari is changing this");
    expect(markLabel(null)).toBeNull();
  });

  it("a new draft loads out of sight and swaps in when ready, keeping the scroll", () => {
    let state = swapReducer(EMPTY_SWAP, { type: "url", url: "https://x/1" });
    expect(state.shown).toEqual({ key: 1, url: "https://x/1", page: null });
    expect(state.loading).toBeNull();
    state = swapReducer(state, { type: "scroll", key: 1, scrollY: 640 });
    state = swapReducer(state, { type: "url", url: "https://x/2" });
    expect(state.shown?.url).toBe("https://x/1");
    expect(state.loading).toEqual({ key: 2, url: "https://x/2", page: null });
    expect(swapReducer(state, { type: "ready", key: 1 })).toBe(state);
    state = swapReducer(state, { type: "url", url: "https://x/3" });
    expect(state.loading).toEqual({ key: 3, url: "https://x/3", page: null });
    expect(swapReducer(state, { type: "ready", key: 2 })).toBe(state);
    state = swapReducer(state, { type: "ready", key: 3 });
    expect(state).toMatchObject({ shown: { key: 3, url: "https://x/3" }, loading: null, scrollY: 640 });
    const timed = swapReducer(swapReducer(state, { type: "url", url: "https://x/4" }), { type: "timeout", key: 4 });
    expect(timed.shown?.url).toBe("https://x/4");
    expect(swapReducer(timed, { type: "url", url: null }).shown).toBeNull();
  });

  it("native commands are delivered as a message event carrying JSON text", () => {
    const call = nativeBridgeCall({ type: "mingla:preview-text", section_id: "s1", from: "a\"b", to: "</script>" });
    expect(call.startsWith("window.dispatchEvent(new MessageEvent(\"message\",{data:\"")).toBe(true);
    expect(call.endsWith("}));true;")).toBe(true);
    const literal = call.slice(call.indexOf("{data:") + 6, call.lastIndexOf("}));true;"));
    expect(JSON.parse(JSON.parse(literal))).toEqual({ type: "mingla:preview-text", section_id: "s1", from: "a\"b", to: "</script>" });
  });

  it("draws the frame at the device's width, never scaled up, as tall as the stage", () => {
    expect(stageFrame({ width: 720, height: 600 }, 1440)).toEqual({ scale: 0.5, width: 1440, height: 1200, left: 0 });
    expect(stageFrame({ width: 800, height: 600 }, 390)).toEqual({ scale: 1, width: 390, height: 600, left: 205 });
    expect(stageFrame({ width: 0, height: 600 }, 390).scale).toBe(0);
  });
});

describe("optimistic section edits", () => {
  const list = [section("a"), section("b", { index: 1, review: { state: "draft", source: "ari" }, can_remove: false }), section("c", { index: 2 })];
  it("typing changes the field at once and counts as the owner having read it", () => {
    const next = applyFieldEdits(list, "b", [{ key: "heading", value: "New" }]);
    expect(next[1]!.fields[0]!.value).toBe("New");
    expect(next[1]!.review).toEqual({ state: "reviewed", source: "person" });
    expect(next[0]).toBe(list[0]);
    expect(unreadCount(list)).toBe(1);
    expect(unreadCount(next)).toBe(0);
  });
  it("layout, move and remove", () => {
    expect(applyLayout(list, "a", "centred")[0]!.layout).toBe("centred");
    expect(applyMove(list, "c", 0).map((entry) => [entry.id, entry.index])).toEqual([["c", 0], ["a", 1], ["b", 2]]);
    expect(applyMove(list, "a", 99).map((entry) => entry.id)).toEqual(["b", "c", "a"]);
    expect(applyMove(list, "zz", 0).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(applyRemove(list, "a").map((entry) => [entry.id, entry.index])).toEqual([["b", 0], ["c", 1]]);
  });
  it("every control that cannot act says why", () => {
    expect(moveBlocked(list, "a", -1)).toBe("Already at the top.");
    expect(moveBlocked(list, "c", 1)).toBe("Already at the bottom.");
    expect(moveBlocked(list, "b", 1)).toBeNull();
    expect(removeBlocked(list[1]!)).toMatch(/so it stays/);
    expect(removeBlocked(list[0]!)).toBeNull();
    expect(undoTooltip("undo", "Move Pick a time", true)).toBe("Undo: Move Pick a time");
    expect(undoTooltip("undo", null, false)).toBe("Nothing to undo yet");
    expect(undoTooltip("redo", null, true)).toBe("Redo");
    expect(changeLabel.move("Pick a time")).toBe("Move Pick a time");
  });
});

describe("rows inside a section", () => {
  const faq = section("faq", {
    fields: [
      { key: "heading", label: "Heading", kind: "text", value: "Good to know", max: 80 },
      { key: "items.0.question", label: "Question", kind: "text", value: "Parking?", max: 120 },
      { key: "items.0.answer", label: "Answer", kind: "multiline", value: "Free", max: 400 },
      { key: "items.1.question", label: "Question", kind: "text", value: "Food?", max: 120 },
      { key: "items.1.answer", label: "Answer", kind: "multiline", value: "Yes", max: 400 },
    ],
    lists: [{ name: "items", label: "Questions", item_label: "question", min: 1, max: 2, count: 2, fields: [{ key: "question", label: "Question", kind: "text", max: 120 }, { key: "answer", label: "Answer", kind: "multiline", max: 400 }] }],
  });
  it("splits a section's own words from each list's rows", () => {
    const split = splitRows(faq);
    expect(split.own.map((field) => field.key)).toEqual(["heading"]);
    expect(split.lists[0]!.rows.map((row) => row.fields.map((field) => field.key))).toEqual([["items.0.question", "items.0.answer"], ["items.1.question", "items.1.answer"]]);
    expect(splitRows(section("plain")).lists).toEqual([]);
    expect(splitRows({ fields: [], lists: [{ ...faq.lists![0]!, count: 1 }] }).lists[0]!.rows).toHaveLength(1);
  });
  it("says why a row cannot be added or removed at the limits", () => {
    const list = faq.lists![0]!;
    expect(addRowBlocked(list)).toBe("This holds up to 2. Remove one to add another.");
    expect(addRowBlocked({ ...list, count: 1 })).toBeNull();
    expect(removeRowBlocked({ ...list, count: 1 })).toBe("This needs at least 1, so this one stays.");
    expect(removeRowBlocked(list)).toBeNull();
  });
});

describe("autosave", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

  function harness(send?: (job: DraftJob, revision: string | null) => Promise<string | null>) {
    const sent: { job: DraftJob; revision: string | null }[] = [];
    const states: SaveState[] = [];
    const errors: { error: unknown; dropped: number }[] = [];
    const revisions = new Map<string, string>([["p1", "r1"]]);
    let counter = 1;
    const writer = createDraftWriter({
      send: send ?? (async (job, revision) => { sent.push({ job, revision }); counter += 1; return `r${counter}`; }),
      getRevision: (pageId) => revisions.get(pageId) ?? null,
      setRevision: (pageId, revision) => { revisions.set(pageId, revision); },
      onState: (state) => states.push(state),
      onSaved: () => undefined,
      onError: (error, _job, dropped) => errors.push({ error, dropped }),
    });
    return { writer, sent, states, errors, revisions };
  }

  it("saves typing 600 ms after the last key, as one change", async () => {
    const { writer, sent, states } = harness();
    writer.typeField("p1", "s1", "heading", "H", "Edit Top");
    jest.advanceTimersByTime(500);
    writer.typeField("p1", "s1", "heading", "He", "Edit Top");
    writer.typeField("p1", "s1", "cta", "Book", "Edit Top");
    jest.advanceTimersByTime(599);
    expect(sent).toHaveLength(0);
    expect(states.at(-1)).toBe("waiting");
    jest.advanceTimersByTime(1);
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.job).toMatchObject({ kind: "edit", sectionId: "s1", edits: [{ key: "heading", value: "He" }, { key: "cta", value: "Book" }] });
    expect(states.at(-1)).toBe("saved");
  });

  it("runs one write at a time, each on the revision the last one returned, typing first", async () => {
    const { writer, sent } = harness();
    writer.typeField("p1", "s1", "heading", "Hi", "Edit Top");
    void writer.enqueue({ kind: "move", pageId: "p1", sectionId: "s1", toIndex: 2, label: "Move Top" });
    void writer.enqueue({ kind: "remove", pageId: "p1", sectionId: "s2", label: "Remove X" });
    await settle();
    await settle();
    expect(sent.map((entry) => [entry.job.kind, entry.revision])).toEqual([["edit", "r1"], ["move", "r2"], ["remove", "r3"]]);
  });

  it("a clash stops the queue, drops what was waiting and reports once", async () => {
    let calls = 0;
    const { writer, errors, states } = harness(async () => { calls += 1; throw new Error("REVISION_CONFLICT"); });
    void writer.enqueue({ kind: "move", pageId: "p1", sectionId: "s1", toIndex: 1, label: "Move" });
    void writer.enqueue({ kind: "remove", pageId: "p1", sectionId: "s2", label: "Remove" });
    void writer.enqueue({ kind: "layout", pageId: "p1", sectionId: "s3", layout: "x", label: "Layout" });
    await settle();
    expect(calls).toBe(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.dropped).toBe(2);
    expect(states.at(-1)).toBe("error");
  });

  it("flush sends what is waiting now; a page that is not loaded is an error, not a silent drop", async () => {
    const { writer, sent, errors } = harness();
    writer.typeField("p1", "s1", "heading", "Now", "Edit Top");
    await writer.flush();
    expect(sent).toHaveLength(1);
    void writer.enqueue({ kind: "move", pageId: "p9", sectionId: "s1", toIndex: 1, label: "Move" });
    await settle();
    expect(errors).toHaveLength(1);
    expect(writer.pending()).toBe(0);
  });

  it("says where saving stands", () => {
    expect(saveStateLine("saving", false)).toBe("Website · saving…");
    expect(saveStateLine("saved", false)).toBe("Website · saved");
    expect(saveStateLine("error", false)).toBe("Website · last change not saved");
    expect(saveStateLine("saved", true)).toBe("Website · view only");
  });
});

describe("Ari's plan as data", () => {
  const args = {
    request: "Put booking first", summary: "Two changes",
    steps: [{ label: "Move Pick a time up", why: "Booking first", cites: [], step: { op: "move_section", page_id: "p1", section_id: "s3", to_index: 1 } },
      { label: "New headline", why: "From your listings", cites: [], step: { op: "edit_section", page_id: "p1", section_id: "s1", edits: [] } }],
    couldnt: [{ what: "a 360° tour", why: "There is no section for it yet" }],
  };
  it("reads the plan, and only from the change-set tool", () => {
    const plan = planFromProposal("propose_site_change_set", args)!;
    expect(plan.steps.map((step) => [step.label, step.sectionId])).toEqual([["Move Pick a time up", "s3"], ["New headline", "s1"]]);
    expect(plan.couldnt).toEqual([{ what: "a 360° tour", why: "There is no section for it yet" }]);
    expect(planFromProposal("publish_site", args)).toBeNull();
    expect(planFromProposal("propose_site_change_set", { steps: "x" })).toBeNull();
  });

  it("follows live step events with or without an index", () => {
    const ev = (event_type: string, index?: number) => ({ event_type, ...(index === undefined ? {} : { payload: { index } }) });
    expect(stepStatuses(3, [ev("planning_started"), ev("site_step_started")], "running")).toEqual(["active", "waiting", "waiting"]);
    expect(stepStatuses(3, [ev("site_step_started"), ev("site_step_done"), ev("site_step_started")], "running")).toEqual(["done", "active", "waiting"]);
    expect(stepStatuses(3, [ev("site_step_started", 0), ev("site_step_done", 0), ev("site_step_started", 1), ev("site_step_failed", 1)], "running")).toEqual(["done", "failed", "waiting"]);
    expect(stepStatuses(2, [], "done")).toEqual(["done", "done"]);
    expect(stepStatuses(3, [ev("site_step_started"), ev("site_step_done"), ev("site_step_started"), ev("site_step_failed")], "failed")).toEqual(["putback", "failed", "waiting"]);
    expect(stepStatuses(2, [], "failed", 1)).toEqual(["waiting", "failed"]);
  });

  it("reads the end of a run as built: applied, checks, adjusted colours, what it could not do", () => {
    const done = runResultFrom({ kind: "executed", result: {
      group_id: "g1", status: "applied", total: 2,
      applied: [{ index: 0, label: "Move", op: "move_section", page_id: "p1", section_id: "s3" }, { index: 1, label: "Navy", op: "set_look", page_id: null, section_id: null, adjusted_colours: [{ from: "#111111", to: "#ffffff" }] }],
      checks: { passed: true, warnings: ["A photo is small"] }, couldnt: [{ what: "a tour", why: "no section" }],
    } });
    expect(done).toEqual({ ok: true, adjustedColours: 1, groupId: "g1", applied: 2, touched: [{ pageId: "p1", sectionId: "s3" }], lookChanged: true, warnings: ["A photo is small"], checksPassed: true, checksNote: null, couldnt: [{ what: "a tour", why: "no section" }], alreadyDone: false });
    expect(adjustedColoursLine(1)).toBe("Ari used the nearest readable shade for one colour.");
    expect(adjustedColoursLine(0)).toBeNull();
    expect(doneLine(2, 0)).toBe("2 changes are on your draft. Nothing is live until you publish.");
    expect(doneLine(1, 0)).toMatch(/^1 change is/);
    expect(doneLine(0, 1)).toBe("I can’t do this one myself yet, but the Mingla team can.");
    const noChecks = runResultFrom({ kind: "executed", result: { group_id: "g", status: "applied", applied: [], checks: null, couldnt: [] } });
    expect(noChecks.ok && noChecks.checksNote).toMatch(/couldn’t run/);
  });

  it("a failed step is a rollback result, never a claim of change; a re-run refusal means already done", () => {
    const failed = runResultFrom({ kind: "executed", result: { group_id: "g1", status: "rolled_back", applied: [], failed: { index: 1, label: "New headline", reason: "That photo is still processing." } } });
    expect(failed).toEqual({ ok: false, groupId: "g1", partly: false, failedIndex: 1, failedLabel: "New headline", reason: "That photo is still processing." });
    expect(failedLine(failed as never)).toBe("“New headline” didn’t work. That photo is still processing. I put everything back, so your draft is exactly as it was.");
    const partly = runResultFrom({ kind: "executed", result: { group_id: "g2", status: "partly_applied", applied: [{}], failed: { index: 0, label: "X", reason: "It timed out" } } });
    expect(partly).toMatchObject({ ok: false, partly: true, groupId: "g2" });
    expect(failedLine(partly as never)).toMatch(/It timed out\. I couldn’t confirm everything was put back.*Undo this/);
    expect(runResultFrom({ kind: "error", code: "RPC_FAILED", message: "" }).ok).toBe(false);
    expect(runResultFrom({ kind: "error", code: "DOMAIN_ACTION_REFUSED", message: "x" })).toMatchObject({ ok: true, alreadyDone: true });
  });

  it("reads Ari's one question only when it is well formed", () => {
    expect(questionFrom({ prompt: "Is parking free?", options: ["Free", "Paid"] })).toEqual({ prompt: "Is parking free?", options: ["Free", "Paid"] });
    expect(questionFrom({ prompt: "Q", options: ["only one"] })).toBeNull();
    expect(questionFrom({ options: ["a", "b"] })).toBeNull();
    expect(questionFrom({ prompt: "Q", options: ["a", "b", "c", "d", "e"] })!.options).toHaveLength(4);
  });

  it("writes the team request three ways and guards sending", () => {
    const fromAri = teamRequestFromProposal("propose_website_team_request", { what: "Add a 360° tour", where: { page_path: "", section_label: "Experiences" }, why: "No tour section yet", missing_capability: "tour_360" }, () => "Home")!;
    expect(fromAri).toMatchObject({ what: "Add a 360° tour", whereLine: "Home › Experiences", why: "No tour section yet", missingCapability: "tour_360" });
    expect(teamRequestFromProposal("other", {}, () => null)).toBeNull();
    const fromSection = teamRequestFromSection({ typed: "Add a countdown.", pageTitle: "Home", pagePath: "", sectionId: "s1", sectionLabel: "Top of the page" });
    expect(fromSection.what).toBe("Add a countdown (in “Top of the page” on Home).");
    expect(teamRequestFromSection({ typed: " ", pageTitle: "Home", pagePath: "", sectionId: null, sectionLabel: null }).what).toBe("");
    const fromRun = teamRequestFromCouldnt({ request: "Add a 360° tour", couldnt: [{ what: "a 360° tour", why: "no section" }], pageTitle: "Home", pagePath: "", focus: null });
    expect(fromRun).toMatchObject({ what: "Add a 360° tour", why: "a 360° tour: no section", missingCapability: "a 360° tour" });
    expect(teamRequestBlocked("", false)).toBe("Say what you want changed first.");
    expect(teamRequestBlocked("x", true)).toBe("Sending…");
    expect(teamRequestBlocked("x", false)).toBeNull();
    expect(teamRequestStatusLine("received").text).toBe("Received · usually ready within 24 hours");
    expect(teamRequestStatusLine("ready").text).toBe("Ready for your review");
  });

  it("suggests requests that fit the section, never more than four", () => {
    expect(sectionSuggestions("hero", "Top of the page")).toContain("Use a different photo");
    expect(sectionSuggestions("mystery", "Something")).toHaveLength(3);
    expect(sectionSuggestions("faq", "Good to know").length).toBeLessThanOrEqual(4);
  });
});
