/**
 * #4420 device round 2 (Android emulator), Home:
 *  - the pull-to-refresh spinner sat over the To-do card on first load,
 *    because Recent's background refetches drove `refreshing`;
 *  - the Followers pill read "+2 this": the bold caption was measured on one
 *    line and drawn on two, cutting "week".
 * FAILS ON REVERT: put `recent.isRefreshing` back into the RefreshControl, or
 * drop the pill's single line / simple breaking.
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..", "..", "..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("#4420 Home on Android", () => {
  test("only the host's own pull shows the refresh spinner", () => {
    const home = read("app/(tabs)/home.tsx");
    expect(home).not.toMatch(/refreshing=\{[^}]*recent\.isRefreshing/);
    expect((home.match(/refreshing=\{isRefreshing\}/g) ?? []).length).toBe(2);
  });

  test("the Followers pill keeps '+N this week' on one line", () => {
    const panel = read("src/components/home/BusinessPulsePanel.tsx");
    expect(panel).toMatch(
      /<Text style=\{styles\.followerPillText\} numberOfLines=\{1\} textBreakStrategy="simple">/,
    );
  });
});
