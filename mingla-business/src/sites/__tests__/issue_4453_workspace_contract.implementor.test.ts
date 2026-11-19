// MINGLA-INVARIANT: I-4453-WORKSPACE-ACTIONS-ONE-LIST | issue #4453 | the thirteen Website workspace content actions are named identically in Core's allow-list (brand-site-control), Studio's rank table (contentEndpoint) and the database rank function (brand_site_content_min_rank), all at rank 20, and every content action Host sends is one Core lets through.
/**
 * #4453 — the Website workspace is four programs agreeing on names: Host
 * sends a content action, Core lets it through and asks the database for its
 * minimum rank, Studio checks the rank again and does the work. A name
 * missing from any one of them is a 4xx the owner sees as "not available".
 * This reads the four sources as they are in the repo and compares them.
 *
 * FAILS-ON-REVERT: drop an action from Core's WORKSPACE_CONTENT_ACTIONS, from
 * Studio's CONTENT_ACTION_MIN_RANK, or from the SQL `IN (...)` list, or send a
 * new action from contentApi.ts without adding it to Core.
 *
 *   cd mingla-business && npx jest --maxWorkers=2 \
 *     src/sites/__tests__/issue_4453_workspace_contract.implementor.test.ts
 */
import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

const REPO = path.resolve(__dirname, "../../../..");
const read = (file: string): string => fs.readFileSync(path.join(REPO, file), "utf8");

const WORKSPACE_ACTIONS = [
  "workspace", "page_sections", "section_catalog",
  "edit_section", "move_section", "remove_section", "add_section", "set_section_media",
  "set_look", "set_page_enabled",
  "history", "undo", "redo",
] as const;

const quoted = (source: string): string[] => [...source.matchAll(/["']([a-z][a-z0-9_]*)["']/g)].map((match) => match[1]!);

/** `export const NAME ... = new Set([ ... ]);` -> the strings inside. */
function setLiteral(source: string, name: string): string[] {
  const match = source.match(new RegExp(`(?:export )?const ${name}(?::[^=]+)?= new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  if (!match) throw new Error(`${name} not found`);
  return quoted(match[1]!.replace(/\/\/[^\n]*/g, ""));
}

const CORE_DIR = "supabase/functions/brand-site-control";
const coreFiles = (): string[] => fs.readdirSync(path.join(REPO, CORE_DIR))
  .filter((file) => file.endsWith(".ts") && !file.includes(".test."))
  .map((file) => read(`${CORE_DIR}/${file}`));

function coreStudioActions(): Set<string> {
  const content = read(`${CORE_DIR}/siteContent.ts`);
  const body = content.match(/const STUDIO_ACTIONS = new Set\(\[([\s\S]*?)\]\);/);
  if (!body) throw new Error("STUDIO_ACTIONS not found");
  const names = new Set(quoted(body[1]!.replace(/\/\/[^\n]*/g, "")));
  // Spread lists are part of the allow-list too.
  for (const spread of body[1]!.matchAll(/\.\.\.([A-Z_]+)/g)) {
    const owner = coreFiles().find((file) => new RegExp(`const ${spread[1]}\\b`).test(file));
    if (!owner) throw new Error(`${spread[1]} not found`);
    for (const name of setLiteral(owner, spread[1]!)) names.add(name);
  }
  return names;
}

function coreOnlyActions(): Set<string> {
  return new Set(setLiteral(read("supabase/functions/brand-site-control/siteContent.ts"), "CORE_ONLY_ACTIONS"));
}

function studioRanks(): Map<string, number> {
  const source = read("mingla-site-cms/src/endpoints/contentEndpoint.ts");
  const body = source.match(/CONTENT_ACTION_MIN_RANK[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!body) throw new Error("CONTENT_ACTION_MIN_RANK not found");
  return new Map([...body[1]!.matchAll(/^\s*([a-z_]+):\s*(\d+),/gm)].map((match) => [match[1]!, Number(match[2])]));
}

function sqlRanks(): Map<string, number> {
  const source = read("supabase/migrations/20281119014453_issue_4453_workspace_content_ranks.sql");
  const body = source.match(/FUNCTION public\.brand_site_content_min_rank\(p_action text\)[\s\S]*?\$function\$([\s\S]*?)\$function\$/);
  if (!body) throw new Error("brand_site_content_min_rank not found");
  const ranks = new Map<string, number>();
  for (const branch of body[1]!.matchAll(/WHEN p_action IN \(([\s\S]*?)\)\s*THEN\s*(\d+)/g)) {
    for (const name of quoted(branch[1]!.replace(/--[^\n]*/g, ""))) ranks.set(name, Number(branch[2]));
  }
  return ranks;
}

/** Every action name contentApi.ts passes to the content route. */
function hostActions(): string[] {
  const source = read("mingla-business/src/sites/contentApi.ts");
  const names = [...source.matchAll(/contentCall(?:<[\s\S]*?>)?\(\s*[A-Za-z_.!]+,\s*"([a-z_]+)"/g)].map((match) => match[1]!);
  return [...new Set(names)].sort();
}

describe("#4453 — the workspace's content actions are one list in four places", () => {
  test("Core lets all thirteen through", () => {
    const core = coreStudioActions();
    expect(setLiteral(read("supabase/functions/brand-site-control/siteWorkspace.ts"), "WORKSPACE_CONTENT_ACTIONS").sort()).toEqual([...WORKSPACE_ACTIONS].sort());
    for (const action of WORKSPACE_ACTIONS) expect([action, core.has(action)]).toEqual([action, true]);
  });

  test("Studio ranks all thirteen at 20", () => {
    const studio = studioRanks();
    for (const action of WORKSPACE_ACTIONS) expect([action, studio.get(action)]).toEqual([action, 20]);
  });

  test("the database ranks all thirteen at 20", () => {
    const sql = sqlRanks();
    for (const action of WORKSPACE_ACTIONS) expect([action, sql.get(action)]).toEqual([action, 20]);
  });

  test("Studio and the database agree on the rank of every action Core forwards to Studio", () => {
    const studio = studioRanks();
    const sql = sqlRanks();
    for (const action of coreStudioActions()) {
      expect([action, sql.get(action)]).toEqual([action, studio.get(action)]);
      expect(typeof sql.get(action)).toBe("number");
    }
  });

  test("every content action Host sends is one Core lets through, and the workspace's thirteen are all sent or typed", () => {
    const core = new Set([...coreStudioActions(), ...coreOnlyActions()]);
    const sent = hostActions();
    expect(sent.length).toBeGreaterThan(30);
    for (const action of sent) expect([action, core.has(action)]).toEqual([action, true]);
    for (const action of WORKSPACE_ACTIONS) expect(sent).toContain(action);
  });
});
