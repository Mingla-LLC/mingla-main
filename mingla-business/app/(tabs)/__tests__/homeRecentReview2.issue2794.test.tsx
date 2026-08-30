import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
const home = fs.readFileSync(path.join(__dirname, "..", "home.tsx"), "utf8");
const recent = fs.readFileSync(path.join(root, "app", "recent.tsx"), "utf8");
const layout = fs.readFileSync(path.join(root, "app", "_layout.tsx"), "utf8");
const clearAll = fs.readFileSync(
  path.join(root, "src", "utils", "clearAllStores.ts"),
  "utf8",
);

test("See all Recent has the approved 44pt target, keyboard focus treatment, and hint", () => {
  expect(home).toContain("function SeeAllRecentButton");
  expect(home).toContain("accessibilityHint=\"Opens your complete Recent workspace\"");
  expect(home).toContain("onFocus={() => setFocused(true)}");
  expect(home).toContain("onBlur={() => setFocused(false)}");
  expect(home).toMatch(/sectionLinkButton:\s*\{[\s\S]{0,180}minHeight: 44/);
  expect(home).toMatch(
    /sectionLinkButtonFocused:\s*\{[\s\S]{0,120}borderColor: accent\.warm/,
  );
});

test("cached and later-page errors expose Retry and footer copy is state-truthful", () => {
  expect(home.match(/accessibilityLabel="Retry loading Recent"/g)).toHaveLength(
    2,
  );
  expect(recent).toContain('accessibilityLabel="Retry loading Recent"');
  expect(recent).toContain(
    'accessibilityLabel="Retry loading more Recent"',
  );
  const loading = recent.indexOf("recent.isLoadingMore");
  const pageError = recent.indexOf("recent.hasPageError", loading);
  const terminal = recent.indexOf("!recent.hasMore && rows.length > 0", pageError);
  expect(loading).toBeGreaterThan(-1);
  expect(pageError).toBeGreaterThan(loading);
  expect(terminal).toBeGreaterThan(pageError);
});

test("root keeps cache/query fencing but central clearAllStores solely resets Recent Zustand", () => {
  expect(clearAll).toContain('from "../store/businessRecentStore"');
  expect(clearAll).toContain("useBusinessRecentStore.getState().reset()");
  expect(layout).not.toContain('from "../src/store/businessRecentStore"');
  expect(layout).not.toContain("useBusinessRecentStore.getState().reset()");
  expect(layout).toContain("clearBusinessRecentCachedUser(previousUserId)");
  expect(layout).toContain("queryClient.cancelQueries");
});
