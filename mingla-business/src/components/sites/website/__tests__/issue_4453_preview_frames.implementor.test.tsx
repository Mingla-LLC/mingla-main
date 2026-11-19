/*
 * #4453 Website workspace — the preview's message handling, with a stand-in
 * frame: what the frame is told (edit mode, marks, colours), what is accepted
 * from it (ready, rects, select), and the flash-free refresh (the next draft
 * loads hidden, swaps in on ready, and is handed the scroll it replaces).
 */
import React from "react";
import { usePreviewFrames, type FrameMessage } from "../workspace/usePreviewFrames";
import type { PreviewMarks } from "../../../../sites/previewBridge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { act, create } = require("react-test-renderer") as {
  act: (run: () => void | Promise<void>) => Promise<void>;
  create: (node: React.ReactElement) => { update: (node: React.ReactElement) => void; unmount: () => void };
};

type Api = ReturnType<typeof usePreviewFrames>;
const sent: { key: number; message: FrameMessage }[] = [];
const selected: { id: string; rect: unknown }[] = [];
let api!: Api;
const NO_MARKS: PreviewMarks = { selected: null, ari: null, unread: [] };

function Harness(props: { url: string | null; page?: string | null; marks?: PreviewMarks; tokens?: readonly string[] | null; edit?: boolean }): null {
  api = usePreviewFrames({
    url: props.url,
    pageKey: props.page ?? "home",
    editMode: props.edit ?? true,
    marks: props.marks ?? NO_MARKS,
    tokenDeclarations: props.tokens ?? null,
    send: (key, message) => sent.push({ key, message }),
    onSelect: (id, rect) => selected.push({ id, rect }),
  });
  return null;
}
const ready = (scrollY = 0) => ({ type: "mingla:preview-ready", page_path: "", sections: [{ id: "s1", type: "hero", top: 0, height: 400 }, { id: "s2", type: "faq", top: 400, height: 300 }], scroll_y: scrollY, doc_height: 2000 });
const types = (key: number) => sent.filter((entry) => entry.key === key).map((entry) => entry.message.type);

describe("the live preview's frames", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sent.length = 0;
    selected.length = 0;
  });
  afterEach(() => jest.useRealTimers());

  it("tells the first frame it is in edit mode with the current marks, and re-tells it when they change", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Harness url="https://x/1" />); });
    expect(api.swap.shown).toEqual({ key: 1, url: "https://x/1", page: "home" });
    expect(sent.find((entry) => entry.message.type === "mingla:preview-mode")!.message).toEqual({ type: "mingla:preview-mode", edit: true });
    expect(api.bridged).toBe(false);
    await act(async () => { api.onMessage(1, ready()); });
    expect(api.bridged).toBe(true);
    expect(api.geometry.sections.map((section) => section.id)).toEqual(["s1", "s2"]);
    sent.length = 0;
    await act(async () => { tree.update(<Harness url="https://x/1" marks={{ selected: "s2", ari: "s1", unread: [{ id: "s2", by: "team" }] }} />); });
    expect(sent.at(-1)!.message).toEqual({ type: "mingla:preview-marks", selected: "s2", ari: "s1", unread: [{ id: "s2", by: "team" }] });
  });

  it("passes a section click on, follows scrolling, and drops anything malformed or from a frame it does not own", async () => {
    await act(async () => { create(<Harness url="https://x/1" />); });
    await act(async () => {
      api.onMessage(1, { type: "mingla:preview-select", section_id: "s2", rect: { top: 410, left: 0, width: 1440, height: 300 }, scroll_y: 400 });
      api.onMessage(1, JSON.stringify({ type: "mingla:preview-rects", sections: [{ id: "s1", top: 0, height: 400 }], scroll_y: 250 }));
      api.onMessage(1, { type: "mingla:preview-select", section_id: "<bad>", rect: {} });
      api.onMessage(9, { type: "mingla:preview-select", section_id: "s1", rect: { top: 0, left: 0, width: 1, height: 1 } });
    });
    expect(selected).toEqual([{ id: "s2", rect: { top: 410, left: 0, width: 1440, height: 300 } }]);
    expect(api.geometry.scrollY).toBe(250);
    expect(api.swap.scrollY).toBe(250);
  });

  it("a saved change loads out of sight and swaps in on ready, with the old scroll and the current state", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Harness url="https://x/1" />); });
    await act(async () => { api.onMessage(1, { type: "mingla:preview-rects", sections: [], scroll_y: 640 }); });
    await act(async () => { tree.update(<Harness url="https://x/2" />); });
    expect(api.swap.shown!.url).toBe("https://x/1");
    expect(api.swap.loading).toEqual({ key: 2, url: "https://x/2", page: "home" });
    // A click in the hidden frame is not a click.
    await act(async () => { api.onMessage(2, { type: "mingla:preview-select", section_id: "s1", rect: { top: 0, left: 0, width: 1, height: 1 } }); });
    expect(selected).toEqual([]);
    sent.length = 0;
    await act(async () => { api.onMessage(2, ready(0)); });
    await act(async () => { api.onLoaded(2); });
    // Out of sight it is given the state and its place; it takes over a moment later, settled.
    expect(api.swap.shown!.key).toBe(1);
    expect(sent.filter((entry) => entry.message.type === "mingla:preview-restore-scroll")).toEqual([{ key: 2, message: { type: "mingla:preview-restore-scroll", scroll_y: 640 } }]);
    await act(async () => { jest.advanceTimersByTime(700); });
    expect(api.swap.shown).toEqual({ key: 2, url: "https://x/2", page: "home" });
    expect(api.swap.loading).toBeNull();
    expect(types(2).slice(0, 2)).toEqual(["mingla:preview-mode", "mingla:preview-marks"]);
    expect(sent.filter((entry) => entry.message.type === "mingla:preview-restore-scroll")).toEqual([{ key: 2, message: { type: "mingla:preview-restore-scroll", scroll_y: 640 } }]);
    // The frame is where it SAID it is until it reports the restored scroll itself.
    expect(api.geometry.scrollY).toBe(0);
    await act(async () => { api.onMessage(2, { type: "mingla:preview-rects", sections: [], scroll_y: 640, doc_height: 2000 }); });
    expect(api.geometry.scrollY).toBe(640);
    // A second `ready` for the same load (Firefox) refreshes the numbers and restores nothing again.
    sent.length = 0;
    await act(async () => { api.onMessage(2, ready(640)); });
    expect(types(2)).not.toContain("mingla:preview-restore-scroll");
  });

  it("another page opens at its top: the old page's scroll is not handed over", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Harness url="https://x/home" page="home" />); });
    await act(async () => { api.onMessage(1, ready(0)); });
    await act(async () => { api.onMessage(1, { type: "mingla:preview-rects", sections: [], scroll_y: 900 }); });
    await act(async () => { tree.update(<Harness url="https://x/about" page="about" />); });
    sent.length = 0;
    await act(async () => { api.onMessage(2, ready(0)); });
    expect(api.swap.shown!.page).toBe("about");
    expect(types(2)).not.toContain("mingla:preview-restore-scroll");
    expect(api.swap.scrollY).toBe(0);
    expect(api.geometry.scrollY).toBe(0);
  });

  it("\"Show me\" a section on another page scrolls the frame that has it, once that frame is ready", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Harness url="https://x/home" page="home" />); });
    await act(async () => { api.onMessage(1, ready(0)); });
    await act(async () => { api.onMessage(1, { type: "mingla:preview-rects", sections: [], scroll_y: 300 }); });
    // The workspace switches page and asks for the section in the same breath.
    await act(async () => { tree.update(<Harness url="https://x/about" page="about" />); });
    sent.length = 0;
    api.commands.post({ type: "mingla:preview-scroll-to", section_id: "about-faq" });
    // The old page's frame is still the one on screen: it does not have that section.
    expect(sent).toEqual([{ key: 1, message: { type: "mingla:preview-scroll-to", section_id: "about-faq" } }]);
    sent.length = 0;
    await act(async () => {
      api.onMessage(2, { type: "mingla:preview-ready", page_path: "about", sections: [{ id: "about-top", type: "hero", top: 0, height: 500 }, { id: "about-faq", type: "faq", top: 500, height: 300 }], scroll_y: 0, doc_height: 900 });
    });
    expect(sent.filter((entry) => entry.key === 2).map((entry) => entry.message)).toContainEqual({ type: "mingla:preview-scroll-to", section_id: "about-faq" });
    expect(types(2)).not.toContain("mingla:preview-restore-scroll");
    // Asked once: a later rebuild of that page goes back to restoring the scroll.
    await act(async () => { api.onMessage(2, { type: "mingla:preview-rects", sections: [], scroll_y: 480 }); });
    await act(async () => { tree.update(<Harness url="https://x/about-2" page="about" />); });
    sent.length = 0;
    await act(async () => { api.onMessage(3, ready(0)); });
    await act(async () => { jest.advanceTimersByTime(700); });
    expect(sent.filter((entry) => entry.key === 3).map((entry) => entry.message)).toContainEqual({ type: "mingla:preview-restore-scroll", scroll_y: 480 });
    expect(types(3)).not.toContain("mingla:preview-scroll-to");
  });

  it("a section already on screen is scrolled to at once and nothing is remembered", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Harness url="https://x/1" />); });
    await act(async () => { api.onMessage(1, ready(0)); });
    await act(async () => { api.onMessage(1, { type: "mingla:preview-rects", sections: [], scroll_y: 700 }); });
    sent.length = 0;
    api.commands.post({ type: "mingla:preview-scroll-to", section_id: "s2" });
    expect(sent).toEqual([{ key: 1, message: { type: "mingla:preview-scroll-to", section_id: "s2" } }]);
    await act(async () => { tree.update(<Harness url="https://x/2" />); });
    sent.length = 0;
    await act(async () => { api.onMessage(2, ready(0)); });
    await act(async () => { jest.advanceTimersByTime(700); });
    expect(types(2)).toContain("mingla:preview-restore-scroll");
    expect(types(2)).not.toContain("mingla:preview-scroll-to");
  });

  it("a frame that never speaks still swaps in shortly after it loads, and at the latest after the fallback", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Harness url="https://x/1" />); });
    await act(async () => { api.onMessage(1, { type: "mingla:preview-rects", sections: [], scroll_y: 640 }); });
    await act(async () => { tree.update(<Harness url="https://x/2" />); });
    sent.length = 0;
    await act(async () => { api.onLoaded(2); });
    // A first word from the parent lets a silent frame (Firefox on localhost) answer.
    expect(sent).toEqual([{ key: 2, message: { type: "mingla:preview-mode", edit: true } }]);
    expect(api.swap.shown!.key).toBe(1);
    // Still silent: it is spoken to again every half second (the bridge may not have been listening yet).
    await act(async () => { jest.advanceTimersByTime(1100); });
    expect(sent.filter((entry) => entry.key === 2 && entry.message.type === "mingla:preview-mode")).toHaveLength(3);
    await act(async () => { jest.advanceTimersByTime(200); });
    expect(api.swap.shown!.key).toBe(2);
    // It swapped in on the timer; when its bridge finally speaks it is handed the scroll it replaced.
    // Nothing is restored into a page that is not listening yet...
    expect(types(2)).not.toContain("mingla:preview-restore-scroll");
    sent.length = 0;
    await act(async () => { api.onMessage(2, ready(0)); });
    // ...it is restored when the bridge speaks.
    expect(sent.filter((entry) => entry.key === 2).map((entry) => entry.message)).toContainEqual({ type: "mingla:preview-restore-scroll", scroll_y: 640 });
  });

  it("a rebuilt page takes over only once it has settled, already at the owner's place, and is moved again only if they scrolled meanwhile", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Harness url="https://x/1" page="home" />); });
    await act(async () => { api.onMessage(1, ready(0)); });
    await act(async () => { api.onMessage(1, { type: "mingla:preview-rects", sections: [], scroll_y: 500 }); });
    await act(async () => { tree.update(<Harness url="https://x/2" page="home" />); });
    await act(async () => { api.onLoaded(2); });
    sent.length = 0;
    await act(async () => { api.onMessage(2, ready(0)); });
    await act(async () => { jest.advanceTimersByTime(600); });
    expect(api.swap.shown!.key).toBe(1);
    await act(async () => { jest.advanceTimersByTime(100); });
    expect(api.swap.shown!.key).toBe(2);
    // Given its place once, before it showed: nothing jumps after it takes over.
    expect(sent.filter((entry) => entry.message.type === "mingla:preview-restore-scroll")).toHaveLength(1);
    // The owner scrolls while the next rebuild settles: it is moved to where they are now.
    await act(async () => { tree.update(<Harness url="https://x/3" page="home" />); });
    sent.length = 0;
    await act(async () => { api.onMessage(3, ready(0)); });
    await act(async () => { api.onLoaded(3); });
    await act(async () => { api.onMessage(2, { type: "mingla:preview-rects", sections: [], scroll_y: 900 }); });
    await act(async () => { jest.advanceTimersByTime(700); });
    expect(sent.filter((entry) => entry.key === 3 && entry.message.type === "mingla:preview-restore-scroll").map((entry) => entry.message)).toEqual([
      { type: "mingla:preview-restore-scroll", scroll_y: 500 },
      { type: "mingla:preview-restore-scroll", scroll_y: 900 },
    ]);
  });

  it("a rebuilt page that is ready waits for its pictures before it takes over, but not for ever", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Harness url="https://x/1" page="home" />); });
    await act(async () => { api.onMessage(1, ready(0)); });
    await act(async () => { tree.update(<Harness url="https://x/2" page="home" />); });
    await act(async () => { api.onMessage(2, ready(0)); });
    await act(async () => { jest.advanceTimersByTime(2000); });
    expect(api.swap.shown!.key).toBe(1);
    // Its pictures arrive: a moment to settle, then it takes over.
    await act(async () => { api.onLoaded(2); });
    await act(async () => { jest.advanceTimersByTime(600); });
    expect(api.swap.shown!.key).toBe(1);
    await act(async () => { jest.advanceTimersByTime(100); });
    expect(api.swap.shown!.key).toBe(2);
    // Pictures that never finish do not hold the page back for long.
    await act(async () => { tree.update(<Harness url="https://x/3" page="home" />); });
    await act(async () => { api.onMessage(3, ready(0)); });
    await act(async () => { jest.advanceTimersByTime(4000); });
    expect(api.swap.shown!.key).toBe(2);
    await act(async () => { jest.advanceTimersByTime(700); });
    expect(api.swap.shown!.key).toBe(3);
    expect(api.stale).toBe(false);
  });

  it("a rebuilt page that never loads is not shown as a blank page: the page on screen stays, and the owner is told", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Harness url="https://x/1" />); });
    // The page on screen speaks, so a silent rebuild is a page that did not load.
    await act(async () => { api.onMessage(1, ready(0)); });
    expect(api.stale).toBe(false);
    await act(async () => { tree.update(<Harness url="https://x/2" />); });
    // It "loads" (a browser error page also fires load) and stays silent.
    await act(async () => { api.onLoaded(2); });
    await act(async () => { jest.advanceTimersByTime(1300); });
    expect(api.swap.shown!.key).toBe(1);
    expect(api.stale).toBe(false);
    await act(async () => { jest.advanceTimersByTime(2900); });
    expect(api.swap.shown!.key).toBe(1);
    expect(api.swap.loading).toBeNull();
    expect(api.stale).toBe(true);
    // Trying again loads a new address; when that one speaks it takes over and the note goes.
    await act(async () => { tree.update(<Harness url="https://x/3" />); });
    expect(api.stale).toBe(true);
    await act(async () => { api.onMessage(3, ready(0)); });
    await act(async () => { api.onLoaded(3); });
    await act(async () => { jest.advanceTimersByTime(700); });
    expect(api.swap.shown!.url).toBe("https://x/3");
    expect(api.stale).toBe(false);
  });

  it("a rebuilt page that has not even loaded is waited for, then given up on", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Harness url="https://x/1" />); });
    await act(async () => { api.onMessage(1, ready(0)); });
    await act(async () => { tree.update(<Harness url="https://x/2" />); });
    await act(async () => { jest.advanceTimersByTime(6100); });
    // Slow, not dead: still waiting, nothing blank on screen.
    expect(api.swap.shown!.key).toBe(1);
    expect(api.swap.loading!.key).toBe(2);
    expect(api.stale).toBe(false);
    await act(async () => { jest.advanceTimersByTime(14000); });
    expect(api.swap.shown!.key).toBe(1);
    expect(api.swap.loading).toBeNull();
    expect(api.stale).toBe(true);
  });

  it("with no bridge on either page (an older preview build) the rebuilt page still takes over after the fallback", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Harness url="https://x/1" />); });
    await act(async () => { tree.update(<Harness url="https://x/2" />); });
    await act(async () => { jest.advanceTimersByTime(6100); });
    expect(api.swap.shown!.url).toBe("https://x/2");
    expect(api.stale).toBe(false);
  });

  it("a page with no section list (an older preview build) or a silent page says sections can't be picked there", async () => {
    await act(async () => { create(<Harness url="https://x/1" />); });
    expect(api.noPick).toBe(false);
    // The bridge answers with no sections: the page works, nothing is clickable.
    await act(async () => { api.onMessage(1, { type: "mingla:preview-ready", page_path: "", sections: [], scroll_y: 0, doc_height: 900 }); });
    expect(api.bridged).toBe(true);
    expect(api.noPick).toBe(true);
    await act(async () => { api.onMessage(1, ready()); });
    expect(api.noPick).toBe(false);
  });

  it("a page that loads and never speaks is treated the same after a few seconds, and recovers when it does", async () => {
    await act(async () => { create(<Harness url="https://x/1" />); });
    await act(async () => { api.onLoaded(1); });
    await act(async () => { jest.advanceTimersByTime(3900); });
    expect(api.noPick).toBe(false);
    await act(async () => { jest.advanceTimersByTime(200); });
    expect(api.noPick).toBe(true);
    await act(async () => { api.onMessage(1, ready()); });
    expect(api.noPick).toBe(false);
  });

  it("posts unsaved colours after a short pause, again after a reload, and commands go to the visible frame", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Harness url="https://x/1" />); });
    sent.length = 0;
    await act(async () => { tree.update(<Harness url="https://x/1" tokens={["--c: #fff"]} />); });
    expect(types(1)).not.toContain("mingla:preview-tokens");
    await act(async () => { jest.advanceTimersByTime(160); });
    expect(sent.at(-1)!.message).toEqual({ type: "mingla:preview-tokens", declarations: ["--c: #fff"] });
    sent.length = 0;
    await act(async () => { api.onLoaded(1); });
    expect(types(1)).toEqual(["mingla:preview-mode", "mingla:preview-marks", "mingla:preview-tokens"]);
    sent.length = 0;
    api.commands.post({ type: "mingla:preview-scroll-to", section_id: "s2" });
    expect(sent).toEqual([{ key: 1, message: { type: "mingla:preview-scroll-to", section_id: "s2" } }]);
    sent.length = 0;
    await act(async () => { tree.update(<Harness url="https://x/1" tokens={null} />); });
    expect(sent).toEqual([{ key: 1, message: { type: "mingla:preview-tokens", declarations: [] } }]);
    await act(async () => { tree.update(<Harness url={null} />); });
    expect(api.swap.shown).toBeNull();
    expect(api.bridged).toBe(false);
  });
});
