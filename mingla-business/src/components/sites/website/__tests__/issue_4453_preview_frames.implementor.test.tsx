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

function Harness(props: { url: string | null; marks?: PreviewMarks; tokens?: readonly string[] | null; edit?: boolean }): null {
  api = usePreviewFrames({
    url: props.url,
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
    expect(api.swap.shown).toEqual({ key: 1, url: "https://x/1" });
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
      api.onMessage(1, { type: "mingla:preview-select", section_id: "s2", rect: { top: 10, left: 0, width: 1440, height: 300 } });
      api.onMessage(1, JSON.stringify({ type: "mingla:preview-rects", sections: [{ id: "s1", top: 0, height: 400 }], scroll_y: 250 }));
      api.onMessage(1, { type: "mingla:preview-select", section_id: "<bad>", rect: {} });
      api.onMessage(9, { type: "mingla:preview-select", section_id: "s1", rect: { top: 0, left: 0, width: 1, height: 1 } });
    });
    expect(selected).toEqual([{ id: "s2", rect: { top: 10, left: 0, width: 1440, height: 300 } }]);
    expect(api.geometry.scrollY).toBe(250);
    expect(api.swap.scrollY).toBe(250);
  });

  it("a saved change loads out of sight and swaps in on ready, with the old scroll and the current state", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Harness url="https://x/1" />); });
    await act(async () => { api.onMessage(1, { type: "mingla:preview-rects", sections: [], scroll_y: 640 }); });
    await act(async () => { tree.update(<Harness url="https://x/2" />); });
    expect(api.swap.shown!.url).toBe("https://x/1");
    expect(api.swap.loading).toEqual({ key: 2, url: "https://x/2" });
    // A click in the hidden frame is not a click.
    await act(async () => { api.onMessage(2, { type: "mingla:preview-select", section_id: "s1", rect: { top: 0, left: 0, width: 1, height: 1 } }); });
    expect(selected).toEqual([]);
    sent.length = 0;
    await act(async () => { api.onMessage(2, ready(0)); });
    expect(api.swap.shown).toEqual({ key: 2, url: "https://x/2" });
    expect(api.swap.loading).toBeNull();
    expect(types(2).slice(0, 3)).toEqual(["mingla:preview-restore-scroll", "mingla:preview-mode", "mingla:preview-marks"]);
    expect(sent[0]!.message).toEqual({ type: "mingla:preview-restore-scroll", scroll_y: 640 });
    expect(api.geometry.scrollY).toBe(640);
  });

  it("a frame that never speaks still swaps in shortly after it loads, and at the latest after the fallback", async () => {
    let tree!: ReturnType<typeof create>;
    await act(async () => { tree = create(<Harness url="https://x/1" />); });
    await act(async () => { tree.update(<Harness url="https://x/2" />); });
    await act(async () => { api.onLoaded(2); });
    expect(api.swap.shown!.key).toBe(1);
    await act(async () => { jest.advanceTimersByTime(1300); });
    expect(api.swap.shown!.key).toBe(2);
    await act(async () => { tree.update(<Harness url="https://x/3" />); });
    await act(async () => { jest.advanceTimersByTime(6100); });
    expect(api.swap.shown!.url).toBe("https://x/3");
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
    await act(async () => { tree.update(<Harness url={null} />); });
    expect(api.swap.shown).toBeNull();
    expect(api.bridged).toBe(false);
  });
});
