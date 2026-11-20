/**
 * #4420 SC-17 — the thread's details rail can be collapsed on wide desktop.
 *
 * FAILS ON REVERT: ignore a tab request while collapsed (Open Plan / deep link
 * would do nothing), treat a storage failure as collapsed, drop the collapse
 * control or the Show panel way back, or let the phone full-screen panels
 * open on desktop when the rail is hidden, and this fails.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  readThreadRailCollapsed,
  resolveThreadRail,
  THREAD_RAIL_STORAGE_KEY,
  writeThreadRailCollapsed,
} from "../threadRailPreference";

const source = (relative: string): string => readFileSync(join(process.cwd(), relative), "utf8");

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
  };
}

describe("state rule", () => {
  test("collapsed + an Open Plan request → expanded on Plan", () => {
    expect(resolveThreadRail({ collapsed: true, tab: "people" }, "plan")).toEqual({ collapsed: false, tab: "plan" });
  });
  test("collapsed + a gallery deep link → expanded on Media", () => {
    expect(resolveThreadRail({ collapsed: true, tab: "plan" }, "media")).toEqual({ collapsed: false, tab: "media" });
  });
  test("no request keeps the state", () => {
    expect(resolveThreadRail({ collapsed: true, tab: "plan" }, null)).toEqual({ collapsed: true, tab: "plan" });
  });
});

describe("the per-viewer preference", () => {
  test("a remembered collapse is read back", () => {
    const store = memoryStorage();
    writeThreadRailCollapsed(true, store);
    expect(store.data[THREAD_RAIL_STORAGE_KEY]).toBe('{"collapsed":true}');
    expect(readThreadRailCollapsed(store)).toBe(true);
  });
  test("a failed or corrupt read is expanded", () => {
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readThreadRailCollapsed(throwing)).toBe(false);
    expect(() => writeThreadRailCollapsed(true, throwing)).not.toThrow();
    expect(readThreadRailCollapsed(memoryStorage({ [THREAD_RAIL_STORAGE_KEY]: "{not json" }))).toBe(false);
    expect(readThreadRailCollapsed(undefined)).toBe(false);
  });
});

describe("the thread wiring", () => {
  const route = source("app/messages/[conversationId].tsx");
  test("the rail has a Hide panel control and the header a Show panel way back", () => {
    expect(route).toContain('testID="brand-group-rail-collapse"');
    expect(route).toContain('collapseLabel={t("messages.rail_hide")}');
    expect(route).toContain('testID="brand-group-rail-show"');
    expect(route).toContain("{railAllowed && railCollapsed ? (");
  });
  test("the rail shows only when allowed and not collapsed; phone panels never open on desktop", () => {
    expect(route).toContain("const showRail = railAllowed && !railCollapsed;");
    expect(route).toContain("if (!railAllowed && planPanelOpen && planBrandId) {");
    expect(route).toContain("if (!railAllowed && mediaPanelOpen && mediaShown && conversationId) {");
  });
  test("header buttons, Open Plan and deep links reopen the rail on their tab", () => {
    expect(route).toContain('if (railAllowed) openRailTab("plan");');
    expect(route).toContain('if (railAllowed) openRailTab("people");');
    expect(route).toContain('openRailTab("media");');
    expect(route).toContain("resolveThreadRail({ collapsed, tab: request }, request).collapsed");
  });
});
