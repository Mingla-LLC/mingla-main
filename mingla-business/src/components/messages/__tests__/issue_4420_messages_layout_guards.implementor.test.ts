/**
 * #4420 A1 / A2 — Host Messages layout guards (SC-9, SC-10, SC-11).
 *
 * A1: html/body had no background, so the end of the Messages list showed
 * white. The web document now paints the app canvas and never bounces, and
 * the thread and inbox scrollers keep their scroll to themselves.
 *
 * A2: inside the desktop shell (top bar ABOVE the route) the thread pinned
 * itself to the full window height, so #root scrolled 80px and the composer
 * scrolled away. Inside the shell the thread now fills its slot; phones keep
 * the visible-height pin (keyboard) capped clear of the privacy strip.
 *
 * FAILS ON REVERT: drop the canvas/overscroll CSS, the +html <style>, the
 * shell branch of messagesScreenWebSize, or put the window pin back in the
 * thread route, and the matching test fails.
 */
import { afterEach, describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Platform } from "react-native";

import { color } from "../../../constants/designSystem";
import { webDocumentCss } from "../../../utils/webDocumentCss";
import { messagesScreenWebSize } from "../webViewportPin";

const source = (relative: string): string => readFileSync(join(process.cwd(), relative), "utf8");
const platform = Platform as { OS: string };
const originalOs = platform.OS;

afterEach(() => {
  platform.OS = originalOs;
});

describe("#4420 A1 the web document is the dark canvas (SC-11)", () => {
  test("html and body take color.canvas and overscroll-behavior none", () => {
    const css = webDocumentCss();
    expect(css).toContain(`html,body{background-color:${color.canvas};overscroll-behavior:none}`);
  });

  test("the thread and inbox scrollers never chain their scroll to the page", () => {
    const css = webDocumentCss();
    expect(css).toContain('[data-testid="brand-group-message-scroll"]');
    expect(css).toContain('[data-testid="brand-group-inbox-scroll"]');
    expect(css).toMatch(/\[data-testid="brand-group-inbox-scroll"\]\{overscroll-behavior:contain\}/);
  });

  test("+html.tsx writes the document CSS into <head>", () => {
    const html = source("app/+html.tsx");
    expect(html).toContain('import { webDocumentCss } from "../src/utils/webDocumentCss";');
    expect(html).toContain("__html: webDocumentCss()");
  });

  test("the scrollers carry the testIDs the CSS matches", () => {
    expect(source("app/messages/[conversationId].tsx")).toContain('testID="brand-group-message-scroll"');
    expect(source("src/components/messages/BrandGroupInboxList.tsx")).toContain('testID="brand-group-inbox-scroll"');
  });
});

describe("#4420 A2 the thread fills the desktop shell (SC-9)", () => {
  test("inside the shell the screen fills its slot: no window-height pin", () => {
    platform.OS = "web";
    const style = messagesScreenWebSize(900, true);
    expect(style).toEqual([{ flex: 1, minHeight: 0 }]);
    expect(JSON.stringify(style)).not.toContain("900");
  });

  test("outside the shell (phone web) it keeps the visible-height pin", () => {
    platform.OS = "web";
    const style = messagesScreenWebSize(700, false);
    expect(style?.[0]).toEqual({ height: 700, flexGrow: 0, flexShrink: 0, flexBasis: "auto" });
  });

  test("native never gets a web size", () => {
    platform.OS = "ios";
    expect(messagesScreenWebSize(800, false)).toBeNull();
    platform.OS = "android";
    expect(messagesScreenWebSize(800, true)).toBeNull();
  });

  test("the thread route sizes both desktop panes through the shell-aware helper", () => {
    const route = source("app/messages/[conversationId].tsx");
    expect(route).toContain("messagesScreenWebSize(windowHeight, shellActive)");
    expect(route).toContain("messagesScreenWebSize(windowHeight, embedded || shellActive)");
    expect(route).toContain("React.useContext(HostShellInsetContext)");
    // The old full-window pin that pushed the page past the screen is gone.
    expect(route).not.toMatch(/\{ height: windowHeight, flexGrow: 0, flexShrink: 0/);
    expect(route).not.toContain("? { height: windowHeight } : null");
  });
});

describe("#4420 SC-10 the phone-web thread follows the visible band", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { visibleBandShift } = require("../webVisualViewport") as typeof import("../webVisualViewport");
  test("keyboard scrolled the visible band down: the screen moves down by offsetTop", () => {
    expect(visibleBandShift({ offsetTop: 180, visibleHeight: 420, layoutHeight: 760 })).toBe(180);
  });
  test("no shift when nothing is scrolled, and never a negative or NaN shift", () => {
    expect(visibleBandShift({ offsetTop: 0, visibleHeight: 760, layoutHeight: 760 })).toBe(0);
    expect(visibleBandShift({ offsetTop: -12, visibleHeight: 420, layoutHeight: 760 })).toBe(0);
    expect(visibleBandShift({ offsetTop: Number.NaN, visibleHeight: 420, layoutHeight: 760 })).toBe(0);
  });
  test("clamped so the screen never leaves the layout viewport (no growing feedback loop)", () => {
    expect(visibleBandShift({ offsetTop: 900, visibleHeight: 420, layoutHeight: 760 })).toBe(340);
  });
  test("rounded, so sub-pixel scroll noise does not re-render", () => {
    expect(visibleBandShift({ offsetTop: 180.4, visibleHeight: 420, layoutHeight: 760 })).toBe(180);
  });
  test("the thread applies it only off the desktop shell, as a transform", () => {
    const route = source("app/messages/[conversationId].tsx");
    expect(route).toContain("useVisibleBandShift(!embedded && !shellActive)");
    expect(route).toContain("transform: [{ translateY: bandShift }]");
    const hook = source("src/components/messages/webVisualViewport.ts");
    expect(hook).toContain("window.requestAnimationFrame(read)");
    expect(hook).toContain("current === next ? current : next");
  });
});
