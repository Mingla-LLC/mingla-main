/**
 * #4237 — Host sign-in landed on the Ari screen while the bottom nav
 * highlighted Home.
 *
 * Root cause: expo-router sorts a navigator's children by route-name length
 * when no initial route is set, so `ari` became the `(tabs)` Slot's default
 * screen. The fix pins `initialRouteName: "home"` via `unstable_settings`.
 *
 * This test runs expo-router's REAL route builder and child ordering over the
 * REAL file list of `app/`, so a new short tab name or a dropped setting is
 * caught. Fails on revert: remove `unstable_settings` from the layout (or the
 * setting itself) and the first `(tabs)` child is `ari` again.
 */
import fs from "fs";
import path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getRoutes } = require("expo-router/build/getRoutes");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sortRoutesWithInitial } = require("expo-router/build/sortRoutes");

import { tabsNavigatorSettings } from "../tabsNavigatorSettings";

const APP_DIR = path.resolve(__dirname, "../../../app");
const TABS_LAYOUT = path.join(APP_DIR, "(tabs)/_layout.tsx");

type RouteNode = {
  route: string;
  contextKey: string;
  initialRouteName?: string;
  children: RouteNode[];
};

function listRouteFiles(dir: string, prefix = "."): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__") continue;
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...listRouteFiles(path.join(dir, entry.name), rel));
    } else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

function buildTree(layoutSettings: unknown): RouteNode {
  const files = listRouteFiles(APP_DIR);
  const ctx = Object.assign(
    (key: string) => {
      const mod: Record<string, unknown> = { default: () => null };
      if (key === "./(tabs)/_layout.tsx" && layoutSettings !== undefined) {
        mod.unstable_settings = layoutSettings;
      }
      return mod;
    },
    { keys: () => files, resolve: (k: string) => k, id: "app" },
  );
  return getRoutes(ctx, { importMode: "sync", platform: "ios" });
}

function findTabsNode(node: RouteNode): RouteNode | null {
  if (node.route === "(tabs)") return node;
  for (const child of node.children ?? []) {
    const hit = findTabsNode(child);
    if (hit) return hit;
  }
  return null;
}

function firstTabsChild(layoutSettings: unknown): string {
  const tabs = findTabsNode(buildTree(layoutSettings));
  if (!tabs) throw new Error("(tabs) navigator not found in app/");
  const sorted = [...tabs.children].sort(
    sortRoutesWithInitial(tabs.initialRouteName),
  );
  return sorted[0].route;
}

describe("#4237 (tabs) navigator default screen", () => {
  it("defaults to home, the tab the bottom nav highlights by default", () => {
    expect(firstTabsChild(tabsNavigatorSettings)).toBe("home");
  });

  it("would default to ari without the setting (the shipped bug)", () => {
    expect(firstTabsChild(undefined)).toBe("ari");
  });

  it("is wired into the (tabs) layout as unstable_settings", () => {
    const src = fs.readFileSync(TABS_LAYOUT, "utf8");
    expect(src).toMatch(
      /export const unstable_settings = tabsNavigatorSettings;/,
    );
    expect(src).toMatch(/const DEFAULT_TAB_ID = "home";/);
  });
});
