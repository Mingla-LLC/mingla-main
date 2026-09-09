import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { STATS_ICON_KEYS, statsIconOptions } from "./statsIcons";
import { restaurantBlocks } from "../blocks/restaurantBlocks";

/**
 * #3149 wave 4 — the editor's icon list and the published site's icon list are
 * the same list.
 *
 * They live in two files because the two apps deploy as separate Vercel
 * projects with their own root directories, so the CMS cannot import from
 * mingla-sites without breaking its build — the same reason `fontPairings`
 * is duplicated, and the same test protects it.
 *
 * The drift that matters is asymmetric and both directions are checked. A name
 * the EDITOR offers but the contract does not accept fails the publish closed,
 * so a brand picks an icon and the whole site stops publishing with a
 * VALIDATION error naming nothing. A name the CONTRACT accepts but the site
 * cannot DRAW renders an empty box where the meaning was — so the runtime's
 * drawings are counted too.
 */
const runtime = fs.readFileSync(
  path.resolve(process.cwd(), "../mingla-sites/src/contracts/artifact.ts"),
  "utf8",
);
const drawings = fs.readFileSync(
  path.resolve(process.cwd(), "../mingla-sites/src/components/StatIcon.tsx"),
  "utf8",
);

/* The names inside the contract's own STATS_ICONS array, read out of source so
   this cannot pass by agreeing with a stale copy of itself. */
const contractNames = (() => {
  const at = runtime.indexOf("export const STATS_ICONS = [");
  expect(at).toBeGreaterThan(-1);
  const body = runtime.slice(at, runtime.indexOf("] as const;", at));
  return [...body.matchAll(/"([a-z]+)"/g)].map((match) => match[1]!);
})();

describe("#3149 one icon list", () => {
  it("the CMS copy names exactly what the contract accepts", () => {
    expect([...STATS_ICON_KEYS].sort()).toEqual([...contractNames].sort());
  });

  it("the runtime can DRAW every name the contract accepts", () => {
    const table = drawings.slice(drawings.indexOf("const PATHS"));
    for (const name of contractNames) {
      expect(table).toContain(`${name}: (`);
    }
  });

  it("the block offers those names and no others", () => {
    const stats = restaurantBlocks.find((block) => block.slug === "stats")!;
    const items = stats.fields.find(
      (field) => "name" in field && field.name === "items",
    ) as { fields: Array<Record<string, unknown>> };
    const icon = items.fields.find((field) => field.name === "icon")!;
    const offered = (icon.options as Array<{ value: string }>).map(
      (option) => option.value,
    );
    expect(offered.sort()).toEqual([...contractNames].sort());
  });

  it("every offered name carries a label an editor can choose by", () => {
    for (const option of statsIconOptions) {
      expect(option.label.length).toBeGreaterThan(4);
      // The label says what the drawing is FOR. "record-vinyl" means nothing
      // to somebody picking an icon for a Friday night.
      expect(option.label).not.toBe(option.value);
    }
  });

  it("an icon is a NAME, never markup and never an address", () => {
    for (const name of contractNames) {
      expect(name).toMatch(/^[a-z]+$/);
    }
    const table = drawings.slice(drawings.indexOf("const PATHS"));
    expect(table).not.toContain("http");
    expect(table).not.toContain("dangerouslySetInnerHTML");
  });
});
