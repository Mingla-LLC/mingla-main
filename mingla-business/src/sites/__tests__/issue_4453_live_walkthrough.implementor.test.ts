/**
 * #4453 Website workspace — regressions found by walking the workspace in a
 * browser against a local stack.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MENU_TOUCHES } from "../contentApi";

const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");

describe("a menu change made under Pages and menu is an undoable draft change like any other", () => {
  it("refreshes the workspace's undo history, its status and the publish check", () => {
    expect([...MENU_TOUCHES]).toEqual(["workspace", "history", "validation"]);
    const source = read("contentApi.ts");
    const hook = source.slice(source.indexOf("export function useSetSiteMenu"), source.indexOf("export type AriPageActionInput"));
    expect(hook).toContain('contentCall<{ revision: string }>(siteId!, "set_menu"');
    expect(hook).toContain("for (const touched of MENU_TOUCHES) void client.invalidateQueries({ queryKey: brandSiteKeys.siteData(siteId, touched) });");
  });
});

describe("a step that cannot be undone on its own says what to do next", () => {
  it("points at the Undo button at the top", () => {
    expect(read("contentApi.ts")).toContain(
      'CHANGED_SINCE: "That part of your website changed afterwards, so this step can’t be put back on its own. Use Undo at the top to step back one change at a time."',
    );
  });
});
