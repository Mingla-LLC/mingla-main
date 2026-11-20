/*
 * #4453 website workspace (build contract A, B, E) — Core's half:
 *   - the section editor, the look and undo / redo are content actions Core
 *     forwards to Studio exactly like the existing ones (the member's own
 *     rank from SQL, never a brand, user or rank the caller names), audits
 *     after Studio confirmed, and strips the audit before answering;
 *   - each refusal reaches the owner as one plain sentence with only bounded
 *     detail (which field, its limit, the layouts the style has);
 *   - Ari's three workspace actions are designer actions (Core signs the same
 *     evidence as for every designer write) and always start Draft.
 */
// MINGLA-INVARIANT: I-4453-WORKSPACE-ACTIONS-ONE-LIST | issue #4453 | the thirteen Website workspace content actions are named identically in Core's allow-list (CONTENT_ACTIONS), Studio's rank table (CONTENT_ACTION_MIN_RANK) and the database rank function (brand_site_content_min_rank), all at rank 20, and every content action Host sends (mingla-business contentApi.ts) is one Core lets through.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { CONTENT_ACTIONS, handleSiteContentRoute, type SiteContentContext } from "./siteContent.ts";
import { ARI_CMS_ACTIONS, ARI_DESIGNER_ACTIONS, ARI_FAILURE_MESSAGES, ariFailureFrom } from "./siteAri.ts";
import { WORKSPACE_ARI_ACTIONS, WORKSPACE_CONTENT_ACTIONS, WORKSPACE_CONTENT_MEDIA_MESSAGES, WORKSPACE_MESSAGES, workspaceDetail } from "./siteWorkspace.ts";

const SITE = "44530000-0000-4000-8000-0000000000d1";
const BRAND = "44530000-0000-4000-8000-0000000000b1";
const USER = "44530000-0000-4000-8000-0000000000a1";
const OTHER = "44530000-0000-4000-8000-0000000000a9";
const OP = "44530000-0000-4000-8000-0000000000e1";
const PAGE = "44530000-0000-4000-8000-0000000000c1";

type Json = Record<string, unknown>;
type Call = { fn: string; args: Json };
type Sent = { siteId: string; operationId: string; path: string; payload: Json };

function ctx(studio: { status: number; body: Json | null } | null, calls: Call[], sent: Sent[], rank = 20): SiteContentContext {
  const rpc = async (fn: string, args: Json) => {
    calls.push({ fn, args });
    if (fn === "brand_site_content_authorize") return { data: { brand_id: BRAND, user_id: USER, rank }, error: null };
    if (fn === "brand_site_content_person_name") return { data: "Tolu", error: null };
    return { data: null, error: null };
  };
  return {
    userId: USER,
    userRpc: rpc,
    serviceRpc: rpc,
    callCmsRaw: async (args) => {
      sent.push(args);
      return studio;
    },
    activeArtifactKey: async () => null,
    tripCovers: async () => ({}),
  };
}

const post = (action: string, args: Json, context: SiteContentContext, extra: Json = {}) =>
  handleSiteContentRoute(`/v1/sites/${SITE}/content`, "POST", { action, operation_id: OP, args, ...extra }, context);

Deno.test("#4453 workspace: the thirteen owner actions are content actions, and Ari's three are designer actions", () => {
  assertEquals([...WORKSPACE_CONTENT_ACTIONS].sort(), [
    "add_section", "edit_section", "history", "move_section", "page_sections", "redo", "remove_section",
    "section_catalog", "set_look", "set_page_enabled", "set_section_media", "undo", "workspace",
  ]);
  for (const action of WORKSPACE_CONTENT_ACTIONS) assert(CONTENT_ACTIONS.has(action), action);
  assertEquals([...WORKSPACE_ARI_ACTIONS].sort(), ["apply_site_change", "get_site_workspace", "undo_site_change_group"]);
  for (const action of WORKSPACE_ARI_ACTIONS) {
    assert(ARI_CMS_ACTIONS.has(action), action);
    // Designer actions are the ones Core signs the Mingla facts (evidence) into.
    assert(ARI_DESIGNER_ACTIONS.has(action), action);
  }
});

Deno.test("#4453 workspace: every owner action is forwarded to Studio as the member Core authorised, args untouched", async () => {
  for (const action of WORKSPACE_CONTENT_ACTIONS) {
    const calls: Call[] = [];
    const sent: Sent[] = [];
    const args = { page_id: PAGE, expected_revision: "4", section_id: "abc123", edits: [{ key: "heading", value: "Lagos plays here" }], group_id: OP, group_label: "Rewrite the top" };
    // The caller may not name the brand, the member or the rank: Core's own values are signed in.
    const res = await post(action, args, ctx({ status: 200, body: { ok: true, data: { page_revision: "5" } } }, calls, sent), { brand_id: OTHER, user_id: OTHER, rank: 100 });
    assertEquals(res?.status, 200, action);
    assertEquals(calls[0], { fn: "brand_site_content_authorize", args: { p_site_id: SITE, p_action: action } });
    assertEquals(sent, [{
      siteId: SITE,
      operationId: OP,
      path: "/api/internal/content",
      payload: { action, site_id: SITE, brand_id: BRAND, user_id: USER, rank: 20, args },
    }]);
    assertEquals(await res!.json(), { ok: true, data: { page_revision: "5" } });
  }
});

Deno.test("#4453 workspace: a saved change is audited without its words, and the audit never reaches the app", async () => {
  const calls: Call[] = [];
  const res = await post("edit_section", { page_id: PAGE }, ctx({
    status: 200,
    body: { ok: true, data: { page_revision: "5", audit: { action: "content.updated", collection: "pages", entry: PAGE } } },
  }, calls, []));
  assertEquals(await res!.json(), { ok: true, data: { page_revision: "5" } });
  const audit = calls.find((call) => call.fn === "brand_site_content_record")!;
  assertEquals(audit.args, { p_site_id: SITE, p_actor: USER, p_action: "content.updated", p_collection: "pages", p_entry: PAGE, p_metadata: {} });
  // A read is not audited.
  const reads: Call[] = [];
  await post("page_sections", { page_id: PAGE }, ctx({ status: 200, body: { ok: true, data: { sections: [] } } }, reads, []));
  assertEquals(reads.some((call) => call.fn === "brand_site_content_record"), false);
});

Deno.test("#4453 workspace: Studio's refusals reach the owner as plain sentences with bounded detail", async () => {
  const refuse = async (error: Json, action = "edit_section") => {
    const res = await post(action, {}, ctx({ status: 409, body: { ok: false, error } }, [], []));
    return { status: res!.status, error: ((await res!.json()) as { error: Json }).error };
  };
  const long = await refuse({ code: "VALUE_TOO_LONG", key: "heading", max: 120, secret: "never passed" });
  assertEquals(long, { status: 400, error: { code: "VALUE_TOO_LONG", message: WORKSPACE_MESSAGES.VALUE_TOO_LONG, retryable: false, key: "heading", max: 120 } });
  const layout = await refuse({ code: "LAYOUT_NOT_IN_DESIGN", layouts: ["pop-stack", "fullbleed", 7], variants: ["pop-stack"] });
  assertEquals(layout.error.layouts, ["pop-stack", "fullbleed"]);
  assertEquals("variants" in layout.error, false);
  const changed = await refuse({ code: "CHANGED_SINCE", target: "page", page_id: PAGE }, "undo");
  assertEquals(changed, { status: 409, error: { code: "CHANGED_SINCE", message: WORKSPACE_MESSAGES.CHANGED_SINCE, retryable: false, target: "page", page_id: PAGE } });
  assertEquals((await refuse({ code: "SECTION_NOT_FOUND" })).status, 404);
  assertEquals((await refuse({ code: "LIST_ROW_REQUIRED", list: "items", min: 1 })).error, { code: "LIST_ROW_REQUIRED", message: WORKSPACE_MESSAGES.LIST_ROW_REQUIRED, retryable: false, min: 1, list: "items" });
  assertEquals((await refuse({ code: "HOME_ALWAYS_ON" }, "set_page_enabled")).error.message, "Your home page is always on.");
  assertEquals((await refuse({ code: "MEDIA_PROCESSING" }, "set_section_media")).error.code, "MEDIA_PROCESSING");
  assertEquals((await refuse({ code: "MEDIA_WRONG_KIND" }, "set_section_media")).error.message, WORKSPACE_CONTENT_MEDIA_MESSAGES.MEDIA_WRONG_KIND);
  const invalid = await refuse({ code: "VALIDATION_FAILED", problems: ["heading must be plain text"], key: "heading" });
  assertEquals([invalid.status, invalid.error.problems, invalid.error.key], [400, ["heading must be plain text"], "heading"]);
  // A code Core does not know is never relayed.
  assertEquals((await refuse({ code: "SOMETHING_INTERNAL", detail: "stack" })).error.code, "SERVICE_TEMPORARILY_UNAVAILABLE");

  // A stale save comes back with the latest revision and the teammate's name.
  const stale = await refuse({ code: "REVISION_CONFLICT", latest: { revision: "7", updated_by: OTHER, updated_at: "2026-11-19T10:00:00.000Z" } });
  assertEquals(stale, { status: 409, error: { code: "REVISION_CONFLICT", message: "Someone saved a newer version while you were editing.", retryable: false, latest: { revision: "7", updated_at: "2026-11-19T10:00:00.000Z", updated_by_name: "Tolu" } } });
});

Deno.test("#4453 workspace: owner sentences never say block, variant, token or revision", () => {
  for (const [code, message] of Object.entries(WORKSPACE_MESSAGES)) {
    assert(!/\b(block|variant|token|revision)s?\b/i.test(message), `${code}: ${message}`);
    assert(message.length > 0 && message.length <= 120, code);
    assertEquals(ARI_FAILURE_MESSAGES[code as keyof typeof WORKSPACE_MESSAGES], message);
  }
  for (const [code, message] of Object.entries(WORKSPACE_CONTENT_MEDIA_MESSAGES)) assert(!/\b(block|variant|token|revision)s?\b/i.test(message), code);
});

Deno.test("#4453 workspace: a below-rank member and an unknown action are refused before Studio is called", async () => {
  const sent: Sent[] = [];
  const forbidden = ctx({ status: 200, body: { ok: true, data: {} } }, [], sent);
  forbidden.userRpc = async () => ({ data: null, error: { message: "sites_forbidden" } });
  assertEquals((await post("edit_section", {}, forbidden))?.status, 403);
  assertEquals((await post("publish_section", {}, ctx({ status: 200, body: { ok: true, data: {} } }, [], sent)))?.status, 400);
  assertEquals(sent, []);
});

Deno.test("#4453 workspace: Ari's refusals carry the field, its limit and the nearest readable colour", async () => {
  const colours = ariFailureFrom({ error: {
    code: "UNREADABLE_COLOURS",
    problems: ["Body text on your page background is hard to read."],
    suggestions: [{ sentence: "Body text on your page background is hard to read.", foreground: "#fffaf1", background: "#fffaf0", nearest_readable: "#5c5c5c", extra: "dropped" }, "not a row"],
  } }, 409);
  assertEquals(colours.status, 409);
  const body = (await colours.json()) as { error: Json };
  assertEquals(body.error.code, "UNREADABLE_COLOURS");
  assertEquals(body.error.problems, ["Body text on your page background is hard to read."]);
  assertEquals(body.error.suggestions, [{ sentence: "Body text on your page background is hard to read.", foreground: "#fffaf1", background: "#fffaf0", nearest_readable: "#5c5c5c" }]);
  const long = (await ariFailureFrom({ error: { code: "VALUE_TOO_LONG", key: "heading", max: 120 } }, 409).json()) as { error: Json };
  assertEquals([long.error.key, long.error.max], ["heading", 120]);
  const layout = (await ariFailureFrom({ error: { code: "LAYOUT_NOT_IN_DESIGN", variants: ["split"], layouts: ["split"] } }, 409).json()) as { error: Json };
  assertEquals([layout.error.variants, layout.error.layouts], [["split"], ["split"]]);
  // A list refusal names the list and its limit; a step still running from an earlier try is retryable.
  const full = (await ariFailureFrom({ error: { code: "LIST_LIMIT_REACHED", list: "items", max: 12 } }, 409).json()) as { error: Json };
  assertEquals([full.error.list, full.error.max, full.error.retryable], ["items", 12, false]);
  const running = (await ariFailureFrom({ error: { code: "STEP_IN_PROGRESS" } }, 409).json()) as { error: Json };
  assertEquals([running.error.code, running.error.retryable], ["STEP_IN_PROGRESS", true]);
  // A colour that is not a colour never passes.
  assertEquals((workspaceDetail({ suggestions: [{ sentence: "x", foreground: "red; drop table", background: "#000000", nearest_readable: null }] }).suggestions as Json[])[0]!.foreground, null);
});

Deno.test("#4453 workspace: Core signs Draft review in for Ari's workspace actions (source of the route)", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  assert(/if \(WORKSPACE_ARI_ACTIONS\.has\(action\)\) payload\.review_drafts = true;/.test(source));
  // Evidence is signed for every designer action except the token read, so for all three of these.
  assert(/if \(action !== "get_site_tokens"\) \{\s*const evidence = await siteEvidence\(/.test(source));
});

// ---------------------------------------------------------------------------
// One list in four places.
// Host sends an action, Core lets it through and asks the database for its
// minimum rank, Studio checks the rank again and does the work. A name
// missing from any one of them is a refusal the owner sees as "not available".
// Core's list is the loaded one; the other three are read from their sources.
// ---------------------------------------------------------------------------

const REPO_ROOT = new URL("../../../", import.meta.url);
const readRepo = (file: string): string => Deno.readTextFileSync(new URL(file, REPO_ROOT));
const quotedNames = (source: string): string[] => [...source.matchAll(/["']([a-z][a-z0-9_]*)["']/g)].map((match) => match[1]!);

const THE_THIRTEEN = [
  "workspace", "page_sections", "section_catalog",
  "edit_section", "move_section", "remove_section", "add_section", "set_section_media",
  "set_look", "set_page_enabled",
  "history", "undo", "redo",
];

function studioContentRanks(): Map<string, number> {
  const body = readRepo("mingla-site-cms/src/endpoints/contentEndpoint.ts").match(/CONTENT_ACTION_MIN_RANK[^=]*=\s*\{([\s\S]*?)\n\};/);
  assert(body, "Studio's CONTENT_ACTION_MIN_RANK was not found");
  return new Map([...body[1]!.matchAll(/^\s*([a-z_]+):\s*(\d+),/gm)].map((match) => [match[1]!, Number(match[2])]));
}

function databaseContentRanks(): Map<string, number> {
  const body = readRepo("supabase/migrations/20281119014453_issue_4453_workspace_content_ranks.sql")
    .match(/FUNCTION public\.brand_site_content_min_rank\(p_action text\)[\s\S]*?\$function\$([\s\S]*?)\$function\$/);
  assert(body, "brand_site_content_min_rank was not found");
  const ranks = new Map<string, number>();
  for (const branch of body[1]!.matchAll(/WHEN p_action IN \(([\s\S]*?)\)\s*THEN\s*(\d+)/g)) {
    for (const name of quotedNames(branch[1]!.replace(/--[^\n]*/g, ""))) ranks.set(name, Number(branch[2]));
  }
  return ranks;
}

/** Every action name Host's contentApi.ts passes to the content route. */
function hostContentActions(): string[] {
  const source = readRepo("mingla-business/src/sites/contentApi.ts");
  return [...new Set([...source.matchAll(/contentCall(?:<[\s\S]*?>)?\(\s*[A-Za-z_.!]+,\s*"([a-z_]+)"/g)].map((match) => match[1]!))].sort();
}

Deno.test("#4453 contract: the thirteen workspace actions are in Core, Studio and the database, all at rank 20", () => {
  assertEquals([...WORKSPACE_CONTENT_ACTIONS].sort(), [...THE_THIRTEEN].sort());
  const studio = studioContentRanks();
  const database = databaseContentRanks();
  for (const action of THE_THIRTEEN) {
    assertEquals([action, CONTENT_ACTIONS.has(action)], [action, true]);
    assertEquals([action, studio.get(action)], [action, 20]);
    assertEquals([action, database.get(action)], [action, 20]);
  }
});

Deno.test("#4453 contract: every content action Host sends is one Core lets through and the database ranks", () => {
  const sent = hostContentActions();
  const database = databaseContentRanks();
  assert(sent.length > 30, `only ${sent.length} Host actions were found: the reader no longer matches contentApi.ts`);
  for (const action of sent) {
    assertEquals([action, CONTENT_ACTIONS.has(action)], [action, true]);
    assertEquals([action, typeof database.get(action)], [action, "number"]);
  }
  for (const action of THE_THIRTEEN) assert(sent.includes(action), `Host never sends ${action}`);
});

Deno.test("#4453 contract: Studio and the database give the same rank to every action both know", () => {
  const studio = studioContentRanks();
  const database = databaseContentRanks();
  let compared = 0;
  for (const [action, rank] of studio) {
    if (!database.has(action)) continue;
    compared += 1;
    assertEquals([action, database.get(action)], [action, rank]);
  }
  assert(compared >= THE_THIRTEEN.length + 10);
});
