/*
 * #4572 item 1 (D5) — the draft preview refreshes itself and never loops.
 *  - every Host preview (side panel, phone sheet, full screen) shows
 *    "Updating preview…" over a skeleton while a fresh grant is made, never
 *    the old address;
 *  - a stale report from the frame refreshes silently at most TWICE a minute
 *    per site; the third shows "We couldn't load the preview" + Try again,
 *    and Try again starts a fresh budget;
 *  - only the frame's own page can report (a message from any other window
 *    is ignored); native reads the refused page's HTTP status (409 = stale).
 * FAILS-ON-REVERT: without the budget the third stale report refreshes again;
 * without the "updating" state the panel keeps the old frame mounted.
 */
import React from "react";

const frames: Array<{ url: string; onStale?: () => void; onFailed?: () => void }> = [];
jest.mock("../WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("../preview/ScaledPreviewFrame", () => ({
  ScaledPreviewFrame: (props: { url: string; onStale?: () => void; onFailed?: () => void }) => {
    frames.push(props);
    return require("react").createElement("mock-frame", { testID: "scaled-frame", url: props.url });
  },
}));
jest.mock("../../../../sites/contentApi", () => ({ useSitePages: () => ({ data: { pages: [] } }) }));

import { previewGrantState, SitePreviewPanel, type PreviewGrantState } from "../preview/SitePreviewPanel";
import {
  createRefreshBudget,
  previewHttpRefusal,
  previewRefusalKind,
  usePreviewRefresh,
  type PreviewRefresh,
} from "../../../../sites/previewRefresh";
import { usePreviewRefusalListener } from "../../../../sites/previewRefusalListener";
import { PREVIEW_FAILED, PREVIEW_STALE } from "../../../../sites/previewBridge";

const { act, create } = require("react-test-renderer") as {
  act: (run: () => void | Promise<void>) => void | Promise<void>;
  create: (node: React.ReactElement) => { root: Root; unmount: () => void; update: (node: React.ReactElement) => void };
};
type Node = { props: Record<string, unknown>; children: (Node | string)[]; type: unknown };
type Root = { findAll: (predicate: (node: Node) => boolean) => Node[] };
const textOf = (root: Root): string =>
  root.findAll((node) => typeof node.type === "string" && node.children.some((child) => typeof child === "string"))
    .map((node) => node.children.filter((child) => typeof child === "string").join("")).join(" | ");
const has = (root: Root, id: string) => root.findAll((node) => node.props.testID === id).length > 0;

const SITE = "11111111-1111-4111-8111-111111111111";
const GRANT = { preview_url: "https://cms.test/preview?grant=old", pages: [] };
const pref = { device: "desktop", tablet: "portrait", phone: "portrait" } as const;
const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) act(() => mounted.pop()!.unmount()); frames.length = 0; });

function panel(grant: PreviewGrantState, variant: "side" | "sheet" | "full") {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<SitePreviewPanel grant={grant} preference={pref as never} onPreference={jest.fn()} purpose="Your draft" onOpenFullScreen={jest.fn()} variant={variant} />); });
  mounted.push(tree);
  return tree.root;
}

/** usePreviewRefresh in a harness: `refresh.current` is the latest value. */
function harness(input: { isFetching: boolean; refetch: () => unknown; now: () => number }) {
  const refresh: { current: PreviewRefresh | null } = { current: null };
  function Probe(props: { isFetching: boolean }) {
    refresh.current = usePreviewRefresh({ siteId: SITE, isFetching: props.isFetching, refetch: input.refetch, now: input.now });
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Probe isFetching={input.isFetching} />); });
  mounted.push(tree);
  return { refresh, setFetching: (isFetching: boolean) => act(() => tree.update(<Probe isFetching={isFetching} />)) };
}

describe("#4572 item 1 — Updating preview… in every preview", () => {
  for (const variant of ["side", "sheet", "full"] as const) {
    it(`${variant}: updating shows the pill over a skeleton and never mounts the old address`, () => {
      const root = panel({ kind: "updating" }, variant);
      expect(textOf(root)).toContain("Updating preview…");
      expect(has(root, "preview-updating")).toBe(true);
      expect(has(root, "scaled-frame")).toBe(false);
    });
    it(`${variant}: the error card says the draft is safe and offers Try again`, () => {
      const onRetry = jest.fn();
      const root = panel({ kind: "error", onRetry }, variant);
      expect(textOf(root)).toContain("We couldn't load the preview");
      expect(textOf(root)).toContain("Your draft is saved. Only the preview didn't load.");
      const button = root.findAll((node) => node.props.testID === "preview-retry" && typeof node.props.onPress === "function")[0]!;
      act(() => { (button.props.onPress as () => void)(); });
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  }

  it("a ready frame carries the stale and failed reports", () => {
    const refresh: PreviewRefresh = { phase: "ready", onStale: jest.fn(), onFailed: jest.fn(), retry: jest.fn() };
    const grant = previewGrantState(true, SITE, { data: GRANT, isError: false }, refresh);
    panel(grant, "side");
    expect(frames.at(-1)!.url).toContain("grant=old");
    frames.at(-1)!.onStale!();
    expect(refresh.onStale).toHaveBeenCalledTimes(1);
  });

  it("the panel state follows the refresh: updating with an old grant, error once failed", () => {
    const base = { onStale: jest.fn(), onFailed: jest.fn(), retry: jest.fn() };
    expect(previewGrantState(true, SITE, { data: GRANT, isError: false }, { ...base, phase: "updating" }).kind).toBe("updating");
    expect(previewGrantState(true, SITE, { data: undefined, isError: false }, { ...base, phase: "updating" }).kind).toBe("loading");
    const failed = previewGrantState(true, SITE, { data: GRANT, isError: false }, { ...base, phase: "failed" });
    expect(failed.kind).toBe("error");
    if (failed.kind === "error") failed.onRetry();
    expect(base.retry).toHaveBeenCalledTimes(1);
    expect(previewGrantState(false, null, { data: GRANT, isError: false }, { ...base, phase: "ready" }).kind).toBe("nodraft");
  });
});

describe("#4572 item 1 — at most two automatic refreshes a minute", () => {
  it("the budget allows two in 60 s, then none, then two again after the window", () => {
    let now = 0;
    const budget = createRefreshBudget(() => now);
    expect([budget.take(), budget.take(), budget.take()]).toEqual([true, true, false]);
    now = 60_001;
    expect(budget.take()).toBe(true);
  });

  it("stale, stale: two silent refreshes; the third stale shows the error card; Try again starts over", () => {
    const refetch = jest.fn();
    const { refresh, setFetching } = harness({ isFetching: false, refetch, now: () => 1_000 });
    act(() => refresh.current!.onStale());
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refresh.current!.phase).toBe("updating");
    setFetching(true);
    setFetching(false);
    expect(refresh.current!.phase).toBe("ready");
    act(() => refresh.current!.onStale());
    expect(refetch).toHaveBeenCalledTimes(2);
    act(() => refresh.current!.onStale());
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(refresh.current!.phase).toBe("failed");
    act(() => refresh.current!.retry());
    expect(refetch).toHaveBeenCalledTimes(3);
    expect(refresh.current!.phase).toBe("updating");
  });

  it("a failed page shows the error card at once, with no refresh", () => {
    const refetch = jest.fn();
    const { refresh } = harness({ isFetching: false, refetch, now: () => 0 });
    act(() => refresh.current!.onFailed());
    expect(refresh.current!.phase).toBe("failed");
    expect(refetch).not.toHaveBeenCalled();
  });
});

describe("#4572 item 1 — only the frame's own page may report", () => {
  it("reads the two message types and the native status codes", () => {
    expect(previewRefusalKind({ type: PREVIEW_STALE })).toBe("stale");
    expect(previewRefusalKind({ type: PREVIEW_FAILED })).toBe("failed");
    expect(previewRefusalKind({ type: "mingla:preview-ready" })).toBeNull();
    expect(previewRefusalKind("mingla:preview-stale")).toBeNull();
    expect(previewHttpRefusal(409)).toBe("stale");
    expect(previewHttpRefusal(403)).toBe("failed");
    expect(previewHttpRefusal(200)).toBeNull();
  });

  it("a message from another window is ignored", () => {
    const listeners: Array<(event: { source: unknown; data: unknown }) => void> = [];
    const realWindow = (global as { window?: unknown }).window;
    (global as { window?: unknown }).window = {
      addEventListener: (_type: string, fn: (event: { source: unknown; data: unknown }) => void) => listeners.push(fn),
      removeEventListener: jest.fn(),
    };
    let unmount = () => undefined as void;
    try {
      const own = { name: "own frame" };
      const onStale = jest.fn();
      const onFailed = jest.fn();
      function Probe() {
        usePreviewRefusalListener(() => [own as unknown as Window], onStale, onFailed);
        return null;
      }
      let tree!: ReturnType<typeof create>;
      act(() => { tree = create(<Probe />); });
      unmount = () => act(() => tree.unmount());
      listeners.forEach((fn) => fn({ source: { name: "someone else" }, data: { type: PREVIEW_STALE } }));
      listeners.forEach((fn) => fn({ source: null, data: { type: PREVIEW_FAILED } }));
      expect(onStale).not.toHaveBeenCalled();
      expect(onFailed).not.toHaveBeenCalled();
      listeners.forEach((fn) => fn({ source: own, data: { type: PREVIEW_STALE } }));
      listeners.forEach((fn) => fn({ source: own, data: { type: PREVIEW_FAILED } }));
      expect(onStale).toHaveBeenCalledTimes(1);
      expect(onFailed).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
      (global as { window?: unknown }).window = realWindow;
    }
  });
});
