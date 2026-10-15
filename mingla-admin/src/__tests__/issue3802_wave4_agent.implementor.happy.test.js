// Issue #3802 (Wave 4, first part) — the My agent page: its pure decisions and
// its source contracts.
//
// [TEST-MOD-APPROVED ISSUE-3802] 2026-10-13: Seth approved the admin shell
// revamp (issue #3802, "one frame for every page, menu grouped by job").
// Changed here, and only this: A-1 pinned My agent in its own "Help" group,
// last, after "Team". It now pins the approved place: the last item of the
// "System" group, which is the last group. Who may open it is unchanged.
//
//   A-1  who may open My agent, and its own Help group in the menu
//   A-2  the lines to paste, for each agent and each kind of computer; where
//        the key appears and where it never does
//   A-3  the status line, and why a key stopped, in plain words
//   A-4  what it can do matches the connector's own list of tools; nothing
//        that is not built yet is offered
//   A-5  every answer from the server becomes words, never a code
//   A-6  the owner's view never carries a key
//   A-7  source contracts: one service file per kind of server function, a
//        key is never stored or logged, every button has an answer
//   A-8  rework: the truth after a lost answer, a key ended elsewhere, the
//        person's own date, where a key ends up, touch targets, focus
//
// Run: node --test src/__tests__/issue3802_wave4_agent.implementor.happy.test.js
// (from mingla-admin). Hermetic: no network, no browser.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { PAGE_AREA_OVERRIDES, areaForPage, canOpenPage, pageTitle, resolveRoute, visibleNavGroups } from "../lib/access.js";
import { NAV_GROUPS, NAV_ITEMS } from "../lib/constants.js";
import {
  AGENTS,
  AGENT_ABILITIES,
  AGENT_GUARDRAILS,
  AGENT_NOT_YET,
  KEY_PLACEHOLDER,
  REPLACED_ELSEWHERE_WORDS,
  abilitiesFor,
  activeKey,
  agentEndpoint,
  agentErrorWords,
  agentLoadErrorWords,
  agentStatus,
  agoWords,
  browserTimeZone,
  clientName,
  connectLines,
  createOutcome,
  isAgentKey,
  lastStoppedKey,
  overviewRows,
  shownKeyVerdict,
  stoppedWords,
  zoneWords,
} from "../lib/agentConnect.js";
import { STATUS_COLORS, TABLE_CATEGORIES } from "../lib/constants.js";
import { activityVia, localToday, weekRows } from "../lib/crmModel.js";
import { AGENT_LIMIT_LABELS, GUIDE_TABS, agentActivityLine, agentPrompt, validAgentGuide } from "../lib/agentPrompts.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const REPO = path.resolve(SRC, "..", "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

const person = (role, areas) => ({ email: `${role}@example.test`, role, status: "active", areas });
const owner = person("owner", ["admin_console", "team_manage", "crm", "beta_leads"]);
const admin = person("admin", ["admin_console", "crm", "beta_leads"]);
const growth = person("growth", ["role_home", "crm", "beta_leads"]);
const partner = person("partner", ["role_home", "crm", "beta_leads"]);

// Made up here; the shape of a key, never a real one.
const KEY_C = "mgla_c_" + "k".repeat(43);
const KEY_X = "mgla_x_" + "k".repeat(43);
const ENDPOINT = "https://example.supabase.co/functions/v1/team-agent";
const NOW = Date.parse("2026-10-14T12:00:00Z");

const APP = read("App.jsx");
const PAGE = read("pages/AgentPage.jsx");
const SERVICE = read("services/teamAgentService.js");
const HOOK = read("hooks/useAgentKeys.js");
const LIB = read("lib/agentConnect.js");
const SIDEBAR = read("components/layout/Sidebar.jsx");
const PALETTE = read("components/CommandPalette.jsx");
const SHELL = read("components/layout/AppShell.jsx");
const PARTS = ["AgentKeyCard.jsx", "AgentConnectSteps.jsx", "AgentTeamList.jsx", "CopyBlock.jsx", "AgentSetupCard.jsx", "AgentAdvanced.jsx"].map((f) => [f, read(path.join("components", "agent", f))]);
const ALL_AGENT_SRC = [["AgentPage", PAGE], ["teamAgentService", SERVICE], ["useAgentKeys", HOOK], ["agentConnect", LIB], ...PARTS];
const GUIDE_PAGE = read("pages/GuidePage.jsx");
const GUIDE_HOOK = read("hooks/useAgentGuide.js");
const ACTIVITY_HOOK = read("hooks/useMyAgentActivity.js");
const OVERVIEW_HOOK = read("hooks/useTeamAgentOverview.js");
const PROMPT_STRIP = read("components/agent/AgentPromptStrip.jsx");
const ROUTINES = read("components/agent/AgentRoutineList.jsx");
const ADMIN_PAGE = read("pages/AdminPage.jsx");
const WEEK = read("components/crm/home/WeekByPerson.jsx");

describe("#3802 A-1: who may open My agent, and where it sits", () => {
  it("is opened by the pipelines area, so all four team roles and nobody else", () => {
    assert.equal(PAGE_AREA_OVERRIDES.agent, "crm");
    assert.equal(areaForPage("agent"), "crm");
    for (const a of [owner, admin, growth, partner]) assert.equal(canOpenPage(a, "agent"), true, a.role);
    assert.equal(canOpenPage(person("growth", ["role_home", "beta_leads"]), "agent"), false, "no pipelines area, no My agent");
    assert.equal(canOpenPage({ ...growth, status: "invited" }, "agent"), false);
    assert.equal(canOpenPage(null, "agent"), false);
    assert.equal(canOpenPage(person("consumer", []), "agent"), false);
  });
  it("is a real page of the app, with its own address", () => {
    assert.ok(APP.includes('import { AgentPage } from "./pages/AgentPage";'));
    assert.ok(/\n {2}agent: AgentPage,\n/.test(APP));
    assert.deepEqual(resolveRoute("agent", growth, ["home", "agent"]), { pageId: "agent", denied: false, requestedId: "agent" });
    assert.deepEqual(resolveRoute("agent", person("growth", ["role_home"]), ["home", "agent"]), { pageId: "home", denied: true, requestedId: "agent" });
  });
  it("sits immediately before Guide in the System group, the last group, in the menu each role is shown", () => {
    // [TEST-MOD-APPROVED ISSUE-3802] was: its own "Help" group, after "Team".
    const groups = (a) => visibleNavGroups(NAV_GROUPS, a);
    for (const a of [growth, partner]) {
      // [TEST-MOD-APPROVED #3802] Drafts to send is now the third pipeline page.
      assert.deepEqual(groups(a).flatMap((g) => g.items).map((i) => i.id), ["home", "hosts", "creators", "drafts", "beta-leads", "agent", "guide"], a.role);
    }
    for (const a of [owner, admin, growth, partner]) {
      const shown = groups(a);
      const system = shown.at(-1);
      assert.equal(system.label, "System", a.role);
      assert.equal(`${system.items.at(-2).id}:${system.items.at(-2).label}:${system.items.at(-2).icon}`, "agent:My agent:Bot");
      assert.equal(`${system.items.at(-1).id}:${system.items.at(-1).label}:${system.items.at(-1).icon}`, "guide:Guide:BookOpen");
      assert.equal(shown.slice(0, -1).some((g) => g.items.some((i) => i.id === "agent")), false);
    }
    // The two non-admin roles are shown nothing else from System.
    for (const a of [growth, partner]) assert.deepEqual(groups(a).at(-1).items.map((i) => i.id), ["agent", "guide"]);
    assert.equal(NAV_GROUPS.at(-1).label, "System");
    assert.equal(NAV_GROUPS.filter((g) => g.label === "System").length, 1);
    assert.equal(NAV_GROUPS.some((g) => g.label === "Help"), false);
    // Someone with no pipelines area is shown no System group at all.
    assert.deepEqual(groups(person("growth", ["role_home"])).map((g) => g.label), [null]);
  });
  it("the menu, the title and the command palette all know it", () => {
    assert.ok(SIDEBAR.includes("const groups = visibleNavGroups(NAV_GROUPS, access);"), "the menu is drawn from the one list, like every other group");
    assert.ok(/\bBot,\n/.test(SIDEBAR) && /\n {2}Bot,\n/.test(SIDEBAR), "the Bot icon is imported and registered");
    assert.equal(NAV_ITEMS.find((i) => i.id === "agent")?.label, "My agent");
    assert.equal(pageTitle("agent", growth, NAV_ITEMS), "My agent");
    assert.ok(SHELL.includes("pageTitle(activeTab, access, NAV_ITEMS)"));
    assert.ok(PALETTE.includes("[...TEAM_NAV_GROUP.items, ...NAV_ITEMS].filter((p) => canOpenPage(access, p.id))"));
  });
});

describe("#3802 A-2: the lines to paste", () => {
  it("the address comes from the app's own server address, or there are no lines", () => {
    assert.equal(agentEndpoint("https://example.supabase.co"), ENDPOINT);
    assert.equal(agentEndpoint("https://example.supabase.co/"), ENDPOINT);
    assert.equal(agentEndpoint("http://127.0.0.1:54321"), "http://127.0.0.1:54321/functions/v1/team-agent");
    for (const bad of [undefined, null, "", "example.supabase.co", "javascript:alert(1)", "https://x.co/'; rm -rf ~ #", 'https://x.co"$(id)', "https://x.co/path", "https://x.co?y=1", "https://exa mple.co", "ftp://x.co"]) {
      assert.equal(agentEndpoint(bad), "", String(bad));
    }
    assert.equal(connectLines({ agent: "claude", os: "mac", endpoint: "", key: KEY_C }), null);
    assert.equal(connectLines({ agent: "gemini", os: "mac", endpoint: ENDPOINT, key: KEY_C }), null);
    assert.ok(PAGE.includes("agentEndpoint(import.meta.env.VITE_SUPABASE_URL)"));
  });
  it("Claude Code on macOS or Linux: the key goes in a variable, and the connector line holds only its name", () => {
    const l = connectLines({ agent: "claude", os: "mac", endpoint: ENDPOINT, key: KEY_C });
    assert.deepEqual(l.steps.map((s) => s.text), [
      `echo 'export MINGLA_CLAUDE_KEY="${KEY_C}"' >> ~/.zshrc && source ~/.zshrc`,
      `claude mcp add-json --scope user mingla '{"type":"http","url":"${ENDPOINT}","headers":{"Authorization":"Bearer \${MINGLA_CLAUDE_KEY}"}}'`,
    ]);
    assert.deepEqual(l.steps.map((s) => s.hasKey), [true, false]);
    assert.equal(l.simpler.text, `claude mcp add --transport http --scope user mingla ${ENDPOINT} --header "Authorization: Bearer ${KEY_C}"`);
    assert.equal(l.simpler.hasKey, true);
    // The JSON inside the line is real JSON.
    const json = JSON.parse(l.steps[1].text.match(/'(\{.*\})'$/)[1]);
    assert.deepEqual(json, { type: "http", url: ENDPOINT, headers: { Authorization: "Bearer ${MINGLA_CLAUDE_KEY}" } });
  });
  it("Codex: the config file names the variable; the simpler lines hold the key and say so", () => {
    const l = connectLines({ agent: "codex", os: "mac", endpoint: ENDPOINT, key: KEY_X });
    assert.equal(l.steps[0].text, `echo 'export MINGLA_CODEX_KEY="${KEY_X}"' >> ~/.zshrc && source ~/.zshrc`);
    assert.equal(l.steps[1].text, `[mcp_servers.mingla]\nurl = "${ENDPOINT}"\nbearer_token_env_var = "MINGLA_CODEX_KEY"`);
    assert.equal(l.steps[1].label, "2. Add these lines to ~/.codex/config.toml");
    assert.equal(l.simpler.text, `[mcp_servers.mingla]\nurl = "${ENDPOINT}"\nhttp_headers = { "Authorization" = "Bearer ${KEY_X}" }`);
    assert.match(l.simpler.label, /The key is stored in that file\.$/);
  });
  it("Windows: setx, a Command Prompt line that names the variable, and a plain statement that it was not tested", () => {
    const c = connectLines({ agent: "claude", os: "windows", endpoint: ENDPOINT, key: KEY_C });
    assert.equal(c.steps[0].text, `setx MINGLA_CLAUDE_KEY "${KEY_C}"`);
    assert.match(c.steps[1].label, /^2\. In a new Command Prompt window \(cmd, not PowerShell\)/);
    assert.equal(c.untested, true);
    assert.ok(c.notes.some((n) => n.startsWith("These Windows lines were not run on Windows here.")));
    const x = connectLines({ agent: "codex", os: "windows", endpoint: ENDPOINT, key: KEY_X });
    assert.equal(x.steps[0].text, `setx MINGLA_CODEX_KEY "${KEY_X}"`);
    assert.equal(x.steps[1].label, "2. Add these lines to %USERPROFILE%\\.codex\\config.toml");
    assert.equal(x.untested, true);
  });
  it("for every agent and computer: the key is only in the lines that say they hold it", () => {
    for (const agent of AGENTS) {
      for (const os of ["mac", "windows"]) {
        const key = agent.id === "claude" ? KEY_C : KEY_X;
        const l = connectLines({ agent: agent.id, os, endpoint: ENDPOINT, key });
        for (const line of [...l.steps, l.simpler]) {
          assert.equal(line.text.includes(key), line.hasKey, `${agent.id} ${os} ${line.id}`);
          assert.ok(line.label.length > 10);
        }
        assert.equal(l.steps.find((s) => s.id === "add").hasKey, false, "the recommended connector line never holds the key");
        assert.ok(l.steps.find((s) => s.id === "add").text.includes(agent.envVar));
        assert.ok(l.notes.length >= 2 && l.notes.every((n) => /\.$/.test(n)));
      }
    }
  });
  it("with no key on screen, the lines show a placeholder and never something that looks like a key", () => {
    for (const key of [null, undefined, "", "not a key", KEY_C + "x", "mgla_c_short", '"; rm -rf ~ #', "$(whoami)", { toString: () => KEY_C }]) {
      for (const agent of AGENTS) {
        const l = connectLines({ agent: agent.id, os: "mac", endpoint: ENDPOINT, key });
        const all = [...l.steps, l.simpler].map((x) => x.text).join("\n");
        assert.equal(/mgla_[cx]_/.test(all), false);
        assert.equal(/rm -rf|whoami/.test(all), false, "something typed elsewhere reached a line");
        assert.ok(l.steps[0].text.includes(KEY_PLACEHOLDER) && l.simpler.text.includes(KEY_PLACEHOLDER));
      }
    }
    assert.equal(isAgentKey(KEY_C), true);
    assert.equal(isAgentKey(KEY_X), true);
    assert.equal(isAgentKey("mgla_z_" + "k".repeat(43)), false);
    assert.equal(isAgentKey(KEY_C + "\n"), false);
  });
});

describe("#3802 A-3: the status line, and why a key stopped", () => {
  const used = { key_id: "1", agent: "claude", key_prefix: "mgla_c_abc1234", last_used_at: "2026-10-14T11:48:00Z", last_used_client: "claude-code/2.1.294 (claude-desktop, agent-sdk/0.3.295)", revoked_at: null };
  it("no key, a key never used, a key in use", () => {
    assert.deepEqual(agentStatus(null, "claude", NOW), { state: "none", variant: "default", text: "Not connected" });
    assert.deepEqual(agentStatus({ ...used, last_used_at: null }, "claude", NOW), { state: "unused", variant: "warning", text: "Key created · not used yet" });
    assert.deepEqual(agentStatus(used, "claude", NOW), { state: "connected", variant: "success", text: "Connected: Claude · last used 12 minutes ago · Claude Code 2.1" });
    assert.equal(agentStatus({ ...used, agent: "codex", last_used_client: null }, "codex", NOW).text, "Connected: Codex · last used 12 minutes ago");
  });
  it("how long ago, in words", () => {
    const ago = (ms) => agoWords(new Date(NOW - ms).toISOString(), NOW);
    assert.equal(ago(5_000), "just now");
    assert.equal(ago(89_000), "just now");
    assert.equal(ago(5 * 60_000), "5 minutes ago");
    assert.equal(ago(100_000), "1 minute ago");
    assert.equal(ago(60 * 60_000), "1 hour ago");
    assert.equal(ago(5 * 3600_000), "5 hours ago");
    assert.equal(ago(24 * 3600_000), "1 day ago");
    assert.equal(ago(9 * 24 * 3600_000), "9 days ago");
    assert.equal(ago(45 * 24 * 3600_000), "on 30 Aug");
    assert.equal(ago(-60_000), "just now", "a clock a little ahead is not the future");
    assert.equal(agoWords("not a time", NOW), "");
  });
  it("what an agent calls itself is shown short, as plain text", () => {
    assert.equal(clientName("claude-code/2.1.294 (claude-desktop)"), "Claude Code 2.1");
    assert.equal(clientName("codex-cli/0.42.0"), "Codex 0.42");
    assert.equal(clientName("  my-own-agent/1.0  "), "my-own-agent/1.0");
    assert.equal(clientName("x".repeat(200)).length, 40);
    assert.equal(clientName("bad\u0000‮name<script>"), "badname<script>", "kept as text; the page never renders it as markup");
    for (const v of [null, undefined, 7, "", "   ", {}]) assert.equal(clientName(v), "");
  });
  it("every reason a key stopped has its own sentence, and none is a code", () => {
    const stopped = (reason, extra = {}) => stoppedWords({ revoked_at: "2026-10-14T09:00:00Z", revoke_reason: reason, ...extra }, 90, NOW);
    assert.equal(stopped("replaced"), "You replaced this key on 14 Oct.");
    assert.equal(stopped("self"), "You disconnected this agent on 14 Oct.");
    assert.equal(stopped("owner"), "The owner disconnected this agent on 14 Oct.");
    assert.equal(stopped("owner", { revoked_by_me: true }), "You disconnected this agent on 14 Oct.");
    assert.equal(stopped("access_removed"), "This key was turned off on 14 Oct when team access was removed.");
    assert.equal(stopped("address_rule"), "This key was turned off on 14 Oct because the account can now sign in another way. Ask the owner.");
    assert.equal(stopped("idle"), "Unused for 90 days, so this key was turned off on 14 Oct.");
    assert.equal(stopped("something_new"), "This key was turned off on 14 Oct.");
    assert.equal(stoppedWords({ revoked_at: "2025-03-02T09:00:00Z", revoke_reason: "idle" }, 30, NOW), "Unused for 30 days, so this key was turned off on 2 Mar 2025.");
    assert.equal(stoppedWords({ revoked_at: null }, 90, NOW), "");
    assert.equal(stoppedWords(null), "");
    for (const r of ["replaced", "self", "owner", "access_removed", "address_rule", "idle", "x"]) assert.equal(/_/.test(stopped(r)), false, r);
  });
  it("the active key and the last stopped key are picked per agent", () => {
    const keys = [
      { key_id: "a", agent: "claude", revoked_at: null },
      { key_id: "b", agent: "claude", revoked_at: "2026-10-01T00:00:00Z" },
      { key_id: "c", agent: "claude", revoked_at: "2026-10-09T00:00:00Z" },
      { key_id: "d", agent: "codex", revoked_at: "2026-10-05T00:00:00Z" },
      null,
    ];
    assert.equal(activeKey(keys, "claude").key_id, "a");
    assert.equal(activeKey(keys, "codex"), null);
    assert.equal(lastStoppedKey(keys, "claude").key_id, "c");
    assert.equal(lastStoppedKey(keys, "codex").key_id, "d");
    assert.equal(activeKey(undefined, "claude"), null);
    assert.equal(lastStoppedKey("nope", "claude"), null);
  });
});

describe("#3802 A-4: what it can do is what the connector offers", () => {
  const TOOLS = fs.readFileSync(path.join(REPO, "supabase", "functions", "_shared", "teamAgentTools.ts"), "utf8");
  const offered = [...TOOLS.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map((m) => m[1]);
  it("one line on the page per tool the connector lists, in the same order, and no other", () => {
    assert.ok(offered.length >= 8, "the connector's list was read");
    assert.deepEqual(AGENT_ABILITIES.map((a) => a.tool), offered);
    for (const a of AGENT_ABILITIES) {
      assert.ok(a.title.length > 5 && /\.$/.test(a.detail), a.tool);
      const adminOnly = new RegExp(`name: "${a.tool}",[\\s\\S]*?adminOnly: (true|false)`).exec(TOOLS)[1] === "true";
      assert.equal(!!a.adminOnly, adminOnly, `${a.tool}: owner-and-admin only on both sides`);
    }
  });
  it("a growth person is not shown the owner's tool; an owner is", () => {
    const tools = (role) => abilitiesFor(role).flatMap((g) => g.items.map((i) => i.tool));
    assert.equal(tools("growth").includes("team_summary"), false);
    assert.equal(tools("partner").includes("team_summary"), false);
    assert.deepEqual(tools("owner"), offered);
    assert.deepEqual(tools("admin"), offered);
    assert.deepEqual(tools(undefined), tools("growth"));
    assert.deepEqual(abilitiesFor("owner").map((g) => g.group), ["Your day", "Find and check", "Beta leads", "Team", "Add and change", "Log", "Drafts"]);
  });
  it("nothing that is not built yet is offered as something to use", () => {
    const shown = ALL_AGENT_SRC.map(([, src]) => stripComments(src)).join("\n");
    // [TEST-MOD-APPROVED #3802] Draft tools are now built; later tools remain absent.
    for (const later of ["mark_sent", "undo_move", "set_target", "add_beta_leads_to_hosts", "delete_record"]) {
      assert.equal(shown.includes(later), false, later);
    }
    for (const promise of ["Drafts to send", "See what it wrote for me", "morning sweep"]) {
      assert.equal(shown.includes(promise), false, promise);
    }
    // What is coming is under "Not yet", in plain words.
    assert.ok(PAGE.includes('title="Not yet"') && PAGE.includes('subtitle="Arriving next"'));
    assert.equal(AGENT_NOT_YET.length, 2);
    assert.ok(AGENT_NOT_YET.some((l) => /in the browser or on your phone/.test(l)));
    assert.ok(AGENT_NOT_YET.some((l) => /^Undo a move, add beta leads to Hosts, and set targets: do these in Mingla Admin for now\.$/.test(l)));
    assert.ok(AGENT_GUARDRAILS.includes("It may log only a cold first message. It writes every follow-up or answer as a draft for you."));
    assert.ok(AGENT_GUARDRAILS.includes("It cannot message a record marked Do not contact or Warm intro only, and it cannot lift that mark."));
    assert.ok(AGENT_GUARDRAILS.includes("It never sends an email, DM or WhatsApp for you."));
    assert.ok(AGENT_GUARDRAILS.includes("It cannot delete, manage keys or manage the team."));
    assert.equal(AGENT_GUARDRAILS.length, 7);
    assert.ok(PAGE.includes("It can read and"));
    assert.ok(/write drafts for you to review\. It never sends\./.test(PAGE));
  });
});

describe("#3802 A-5: every answer from the server becomes words", () => {
  it("known answers have their own sentence; anything else gets the general one; none is a code", () => {
    const cases = [
      [{ token: "network", message: "" }, /offline/],
      [{ token: "signed_out", message: "" }, /sign-in ran out/],
      [{ token: "not_ready", message: "" }, /isn't switched on yet/],
      [{ token: "not_found", message: "That key is no longer here." }, /^That key is no longer here\. Nothing was changed\.$/],
      [{ token: "invalid_agent", message: "Choose Claude or Codex." }, /^Choose Claude or Codex\.$/],
      [{ token: "forbidden", message: "An agent cannot manage keys. Open My agent in Mingla Admin." }, /^An agent cannot manage keys\./],
      [{ token: "forbidden", message: "Only the owner can see who has an agent connected." }, /^Only the owner/],
      [{ token: "forbidden", message: "" }, /^Your account can't use My agent\./],
      [{ token: "forbidden", message: "forbidden" }, /^Your account can't use My agent\./],
      [{ token: "some_new_token", message: "internal: pg_proc 42883 team_agent_keys" }, /^That didn't work\. Try again/],
      [{ token: "unknown", message: "" }, /^That didn't work\./],
      [new Error("duplicate key value violates unique constraint \"team_agent_keys_one_active\""), /^That didn't work\./],
      [{ code: "42501", message: "permission denied for function team_agent_key_create" }, /^Your account can't use My agent\./],
      [{ code: "PGRST202", message: "Could not find the function" }, /isn't switched on yet/],
      [null, /^That didn't work\./],
      [undefined, /^That didn't work\./],
    ];
    for (const [err, want] of cases) {
      const words = agentErrorWords(err);
      assert.match(words, want);
      assert.equal(/team_agent|pg_|42\d{3}|PGRST|constraint|[a-z]+_[a-z]+/.test(words), false, words);
      assert.ok(/[.!]$/.test(words) && words.split(" ").length >= 3, words);
    }
  });
  it("a failed load says so, with a way forward", () => {
    assert.equal(agentLoadErrorWords({ token: "unknown" }), "Couldn't load your agent settings. Check your connection and try again.");
    assert.equal(agentLoadErrorWords({ token: "network" }), "Couldn't load your agent settings. Check your connection and try again.");
    assert.match(agentLoadErrorWords({ token: "signed_out" }), /Reload the page and sign in again\./);
    assert.match(agentLoadErrorWords({ token: "forbidden", message: "" }), /Ask the owner/);
    assert.ok(PAGE.includes("agentLoadErrorWords(error)") && PAGE.includes("Try again"));
  });
});

describe("#3802 A-6: the owner's view", () => {
  it("one row per person, with the agents they have connected, and never a key", () => {
    const rows = overviewRows({
      people: [
        { email: "seth@example.test", display_name: "Seth", role: "owner", agent: "claude", connected: true, key_id: "k1", key_prefix: "mgla_c_abc1234", last_used_at: "2026-10-14T10:00:00Z" },
        { email: "seth@example.test", display_name: "Seth", role: "owner", agent: "codex", connected: false, key_id: null },
        { email: "tunde@example.test", display_name: "Tunde", role: "growth", agent: "claude", connected: true, key_id: "k2", last_used_at: null },
        { email: "tunde@example.test", display_name: "Tunde", role: "growth", agent: "codex", connected: true, key_id: "k3", last_used_at: "2026-10-14T11:59:30Z" },
        { email: "ada@example.test", display_name: "", role: "partner", agent: "claude", connected: false },
        null,
        { display_name: "No address" },
      ],
    }, NOW);
    assert.deepEqual(rows.map((r) => [r.name, r.agents.map((a) => `${a.label} ${a.line}`).join("; ")]), [
      ["Seth", "Claude used 2 hours ago"],
      ["Tunde", "Claude not used yet; Codex used just now"],
      ["ada@example.test", ""],
    ]);
    assert.equal(JSON.stringify(rows).includes("mgla_"), false, "not even the visible part of a key");
    assert.deepEqual(overviewRows(null), []);
    assert.deepEqual(overviewRows({ people: "nope" }), []);
  });
  it("only the owner is asked for it, and only the owner is shown it", () => {
    assert.ok(HOOK.includes('const isOwner = access?.role === "owner";'));
    assert.ok(HOOK.includes("isOwner ? agent.fetchKeysOverview().catch(() => null) : Promise.resolve(null)"));
    assert.ok(/\{isOwner && \(\s*<SectionCard title="Agents on the team"/.test(PAGE));
    assert.ok(PAGE.includes("Only you see this. A key is never shown."));
  });
});

describe("#3802 A-7: source contracts", () => {
  const files = walk(SRC).filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`) && /\.(js|jsx)$/.test(f));
  it("teamAgentService.js is the only caller of a team_agent_ function, and it calls nothing else", () => {
    const callers = files.filter((f) => /rpc\(\s*["'`]team_agent_/.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(callers.map((f) => path.relative(SRC, f)), [path.join("services", "teamAgentService.js")]);
    const called = [...SERVICE.matchAll(/rpc\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(called, ["team_agent_guide", "team_agent_key_create", "team_agent_key_revoke", "team_agent_keys_mine", "team_agent_keys_overview", "team_agent_my_activity", "team_agent_setup_create"]);
    assert.equal(/rpc\(\s*["'`]crm_/.test(SERVICE), false);
    assert.equal(/\.from\(|functions\.invoke|\bfetch\(/.test(stripComments(SERVICE)), false);
    // No file of the page reaches the gateway or anything internal.
    for (const [name, src] of ALL_AGENT_SRC) {
      assert.equal(/team_agent_call|team_agent_resolve|team_agent_records_find|team_agent_guide_def/.test(src), false, name);
    }
  });
  it("crmService.js is still the only caller of a crm_ function", () => {
    const callers = files.filter((f) => /rpc\(\s*["'`]crm_/.test(fs.readFileSync(f, "utf8")));
    assert.deepEqual(callers.map((f) => path.relative(SRC, f)), [path.join("services", "crmService.js")]);
  });
  it("the page and its parts never import the database client; only the service does", () => {
    for (const [name, src] of ALL_AGENT_SRC) {
      const imports = /from\s+["'][^"']*lib\/supabase["']/.test(src);
      assert.equal(imports, name === "teamAgentService", name);
    }
    assert.equal(/from\s+["'](\.\.\/)*services\/crmService["']/.test(PAGE), false);
  });
  it("a key is never put in browser storage, an address, a cookie or the console", () => {
    for (const [name, src] of ALL_AGENT_SRC) {
      const code = stripComments(src);
      assert.equal(/localStorage|sessionStorage|indexedDB|document\.cookie|caches\./.test(code), false, `${name} uses browser storage`);
      assert.equal(/location\.(hash|search|href)\s*=|history\.(push|replace)State|useHashQuery/.test(code), false, `${name} writes to the address`);
      // Every console call logs fixed words and a name or a token, nothing else.
      for (const call of code.matchAll(/console\.[a-z]+\(([^;]*)\);/g)) {
        assert.match(call[1], /^"\[agent\] [a-z ]+:", (err\?\.token \|\| err\?\.name \|\| "error"|err\?\.name \|\| "error"|result\.error\.code)$/, `${name}: ${call[1]}`);
      }
      assert.equal(/console\.[a-z]+\([^)]*(made|fresh|key\b|data|result\.data)/.test(code), false, `${name} logs an answer`);
    }
    // The key lives in one piece of page state and is dropped on Done and on Disconnect.
    assert.ok(PAGE.includes("const [fresh, setFresh] = useState({});"));
    assert.ok(/const done = useCallback\(\(agentId\) => \{\s*setFresh\(\(f\) => \(\{ \.\.\.f, \[agentId\]: null \}\)\);/.test(PAGE));
    assert.equal((PAGE.match(/setFresh\(/g) || []).length, 5, "set on create; cleared on Done, on Disconnect, when the key was ended elsewhere, and after 10 minutes on screen");
    assert.equal(/\bfresh/.test(HOOK) || /\bfresh/.test(SERVICE), false, "the hook and the service never hold a key");
    // It is shown through the copy box only, as text.
    assert.equal(/dangerouslySetInnerHTML/.test(ALL_AGENT_SRC.map(([, s]) => s).join("")), false);
  });
  it("the key is shown once, with a working copy and a plain warning", () => {
    const card = PARTS.find(([f]) => f === "AgentKeyCard.jsx")[1];
    assert.ok(card.includes('copyLabel="Copy key"'));
    assert.ok(card.includes('note="Shown once. Copy it now: you will not see this key again."'));
    assert.ok(card.includes("The rest was shown once") && card.includes("Lost it? Replace the key."));
    const copy = PARTS.find(([f]) => f === "CopyBlock.jsx")[1];
    assert.ok(copy.includes("await navigator.clipboard.writeText(text);"));
    // When the browser refuses, the text is selected and the person is told which keys to press.
    assert.ok(/catch \(err\) \{[\s\S]*range\.selectNodeContents\(node\);[\s\S]*setState\("blocked"\);/.test(copy));
    assert.ok(copy.includes("press Ctrl or Cmd + C to copy."));
    assert.ok(copy.includes('role="status" aria-live="polite"'));
  });
  it("Replace and Disconnect ask first, in place, say they cannot be undone, and can be backed out of", () => {
    const card = PARTS.find(([f]) => f === "AgentKeyCard.jsx")[1];
    assert.ok(card.includes('onClick={() => setAsking("replace")}') && card.includes('onClick={() => setAsking("disconnect")}'));
    assert.ok(card.includes("The old key stops working at once, and your agent needs the new one. This can't be undone."));
    assert.ok(card.includes("Its key stops working at once. This can't be undone, but a new key is one press away."));
    assert.ok(/if \(asking && event\.key === "Escape"\)/.test(card), "Escape is Keep");
    assert.ok(card.includes("keepRef.current?.focus();"), "the safe answer is focused first");
    assert.ok(card.includes("mainRef.current?.focus();"), "focus comes back when the question closes");
    // Nothing is sent until the confirm button: the two actions are only called from confirm().
    assert.equal((card.match(/onRevoke\(/g) || []).length, 1);
    assert.ok(/const confirm = async \(\) => \{[\s\S]*if \(what === "disconnect" && activeKey\) await onRevoke\(activeKey\.key_id, agent\.id\);/.test(card));
    const team = PARTS.find(([f]) => f === "AgentTeamList.jsx")[1];
    assert.ok(team.includes("onClick={() => setAsking(a.keyId)}"));
    assert.equal((team.match(/onDisconnect\(/g) || []).length, 1);
  });
  it("no button is silent: every action answers on success, on failure and offline", () => {
    for (const fn of ["create", "revoke", "disconnectFor"]) {
      const body = new RegExp(`const ${fn} = useCallback\\(\\s*async \\([^)]*\\) => \\{([\\s\\S]*?)\\n    \\},\\n    \\[`).exec(PAGE);
      assert.ok(body, `${fn} was found`);
      assert.ok(/if \(!online\) \{\s*addToast\(\{ variant: "warning", title: "You're offline"/.test(body[1]), `${fn} answers offline`);
      assert.ok(/addToast\(\{\s*variant: "success"/.test(body[1]), `${fn} answers on success`);
      assert.ok(/catch \(err\) \{[\s\S]*addToast\(\{ variant: (?:"error"|outcome\.toastVariant)/.test(body[1]), `${fn} answers on failure`);
      assert.ok(/agentErrorWords\(err\)/.test(body[1]), `${fn} uses plain words`);
    }
    // A second press while the first is on its way sends nothing.
    assert.equal((PAGE.match(/if \(busyRef\.current\[agentId\]\) return;/g) || []).length, 2, "create and disconnect each ignore a second press");
    assert.ok(PAGE.includes("if (busyKeyId) return;"));
    // A failure also stays on the card, not only in a message that disappears.
    assert.ok(PAGE.includes("setProblem((p) => ({ ...p, [agentId]: outcome.problem }));"));
    const card = PARTS.find(([f]) => f === "AgentKeyCard.jsx")[1];
    assert.ok(card.includes('<p role="alert"'));
    // Offline: the three actions are disabled and say why.
    assert.ok(card.includes("You're offline. This works again once you're back."));
    assert.ok((card.match(/disabled=\{(busy \|\| )?offline\}/g) || []).length >= 4);
    assert.ok(PAGE.includes("{!online && <AlertCard variant=\"warning\">{AGENT_OFFLINE_WORDS}</AlertCard>}"));
  });
  it("loading, a failed load and every key state are drawn", () => {
    assert.ok(/\{loading \? \(\s*<LoadingSteps \/>\s*\) : error \? \(/.test(PAGE));
    assert.ok(PAGE.includes('title="Couldn\'t load your agent settings"'));
    assert.ok(PAGE.includes("onClick={() => refetch()}"));
    const card = PARTS.find(([f]) => f === "AgentKeyCard.jsx")[1];
    assert.ok(/\{freshKey \? \([\s\S]*\) : activeKey \? \([\s\S]*\) : \(/.test(card), "just created / connected / none");
    assert.ok(card.includes('{stoppedKey ? "Create a new key" : "Create my key"}'));
    assert.ok(card.includes("stoppedWords(stoppedKey, idleDays)"));
    assert.ok(card.includes('status.state === "unused"') && card.includes("Not working?"));
    const steps = PARTS.find(([f]) => f === "AgentConnectSteps.jsx")[1];
    assert.ok(steps.includes("The connector's address isn't set up"));
    assert.ok(steps.includes("Paste these into the Terminal app on your own computer, one at a time."));
    // The setup card draws every state from one view-model, and the advanced way sits in a closed disclosure.
    const setupCard = PARTS.find(([f]) => f === "AgentSetupCard.jsx")[1];
    assert.ok(setupCard.includes("view.lines.map((line) => (") && setupCard.includes("view.buttons.map((b) => ("));
    assert.ok(setupCard.includes('role="status"') && setupCard.includes("{view.showMessage && message && ("));
    const advanced = PARTS.find(([f]) => f === "AgentAdvanced.jsx")[1];
    assert.ok(/<details className="[^"]*">\s*<summary className=\{DISCLOSURE_CLASS\}>Advanced: add the key yourself<\/summary>/.test(advanced));
    assert.equal(/<details[^>]*\bopen\b/.test(advanced), false, "closed by default");
    assert.ok(PAGE.includes("setupCardView({") && PAGE.includes("<AgentAdvanced"));
    // Touch targets on a phone.
    for (const [name, src] of [["AgentPage", PAGE], ...PARTS]) {
      const buttons = src.split("<Button").slice(1).map((rest) => rest.slice(0, rest.indexOf("</Button>")));
      for (const b of buttons) assert.ok(/max-sm:h-11/.test(b), `${name}: a button is under 44px on a phone: ${b.slice(0, 60)}`);
    }
  });
  it("the page refreshes by itself, so 'last used' appears without a reload, and never shows another person's copy", () => {
    assert.ok(HOOK.includes("export const AGENT_REFRESH_MS = 30_000;"));
    assert.ok(HOOK.includes("const keyFor = (email) => `agent:keys:${email || \"\"}`;"));
    assert.ok(HOOK.includes("const current = state.key === key;"));
    assert.ok(/if \(quiet\) return null;\s*setState\(\{ key, data: null, error, loaded: true \}\);/.test(HOOK), "a quiet refresh that fails keeps what is on screen");
    assert.ok(HOOK.includes('window.addEventListener("online", onOnline);'));
  });
});

describe("#3802 A-8: what the page says after a create or replace that did not answer", () => {
  const words = "You seem to be offline, so that didn't go through. Check your connection and try again.";
  it("the old key was replaced before the answer was lost: the page says the old key no longer works, and offers Replace again", () => {
    const o = createOutcome({ before: "key-1", after: "key-2", label: "Claude", words });
    assert.equal(o.kind, "unseen");
    assert.equal(o.notice, "Your Claude key was replaced, but the new key couldn't be shown. The old key no longer works. Replace it again to get a key you can copy.");
    assert.equal(o.problem, "");
    assert.equal(o.replaceAgain, true);
    assert.equal(o.toastVariant, "warning");
    assert.equal(o.toastTitle, "Your old Claude key no longer works");
    assert.equal(/No key was created/.test(JSON.stringify(o)), false, "it never says nothing happened");
  });
  it("a first key was made but could not be shown", () => {
    const o = createOutcome({ before: null, after: "key-1", label: "Codex", words });
    assert.equal(o.kind, "unseen");
    assert.equal(o.notice, "A Codex key was created, but it couldn't be shown. Replace it to get a key you can copy.");
    assert.equal(o.replaceAgain, true);
  });
  it("nothing was made: it says so, and that the key the person has still works", () => {
    const kept = createOutcome({ before: "key-1", after: "key-1", label: "Claude", words });
    assert.equal(kept.kind, "unchanged");
    assert.equal(kept.problem, `No key was created, and the key you have still works. ${words}`);
    assert.equal(kept.replaceAgain, false);
    const none = createOutcome({ before: null, after: null, label: "Claude", words });
    assert.equal(none.problem, `No key was created. ${words}`);
    assert.equal(createOutcome({ before: undefined, after: null, label: "Claude", words }).kind, "unchanged");
  });
  it("the keys could not be read either: it never claims nothing happened", () => {
    const had = createOutcome({ before: "key-1", after: undefined, label: "Claude", words });
    assert.equal(had.kind, "unknown");
    assert.match(had.problem, /^We couldn't tell whether your Claude key was replaced\. If it was, the key you have no longer works\./);
    const hadNone = createOutcome({ before: null, after: undefined, label: "Claude", words });
    assert.match(hadNone.problem, /^We couldn't tell whether a Claude key was created\./);
    for (const o of [had, hadNone]) assert.equal(/No key was created/.test(o.problem + o.toastWords + o.toastTitle), false);
  });
  it("every outcome is plain words with a next step, never a code", () => {
    for (const before of [null, "a"]) {
      for (const after of [undefined, null, "a", "b"]) {
        const o = createOutcome({ before, after, label: "Claude", words });
        const said = [o.problem, o.notice, o.toastTitle, o.toastWords].filter(Boolean).join(" ");
        assert.equal(/_|undefined|null|\bNaN\b/.test(said), false, said);
        assert.ok(o.problem !== "" || o.notice !== "", "something stays on the card, not only in a message that disappears");
      }
    }
  });
  it("the page reads the keys again after any failed create, waits a bounded time for an answer, and shows what it found", () => {
    const body = /const create = useCallback\(\s*async \(agentId\) => \{([\s\S]*?)\n {4}\},\n {4}\[/.exec(PAGE)[1];
    assert.ok(body.includes("const before = activeKey(keysRef.current, agentId)?.key_id || null;"), "it remembers the key the person had before asking");
    assert.ok(/catch \(err\) \{[\s\S]*const now = await refetch\(\{ quiet: true \}\);[\s\S]*const after = Array\.isArray\(now\) \? activeKey\(now, agentId\)\?\.key_id \|\| null : undefined;[\s\S]*createOutcome\(\{ before, after, label, words \}\)/.test(body));
    assert.ok(body.includes("setNotice((n) => ({ ...n, [agentId]: outcome.notice }));") && body.includes("setUnseen((u) => ({ ...u, [agentId]: outcome.replaceAgain }));"));
    assert.ok(/Promise\.race\(\[\s*createKey\(agentId, browserTimeZone\(\)\),/.test(body), "a create that never answers does not leave the button waiting for ever");
    assert.ok(PAGE.includes("const CREATE_WAIT_MS = 20_000;") && body.includes("clearTimeout(timer);"));
    assert.ok(body.includes('timer = setTimeout(() => reject({ token: "network", message: "" }), CREATE_WAIT_MS);'), "the wait is really armed");
    assert.equal(/No key was created/.test(body.replace(/"No key was created\. Try again once you're back\."/, "")), false, "the page itself never decides that nothing was made");
    // The hook hands back what it read, or null when it could not read.
    assert.ok(HOOK.includes("keys: Array.isArray(data?.mine?.keys) ? data.mine.keys : [],") && HOOK.includes("return latest.current.keys;"));
    assert.ok(/if \(quiet\) return null;/.test(HOOK));
    const card = PARTS.find(([f]) => f === "AgentKeyCard.jsx")[1];
    assert.ok(card.includes('{replaceAgain ? "Replace again" : "Replace key"}'));
    assert.ok(/\{notice && \(\s*<p role="status"/.test(card));
  });
});

describe("#3802 A-8: a key that was ended somewhere else does not stay on screen", () => {
  const active = { key_id: "k2", agent: "claude", revoked_at: null };
  const ended = { key_id: "k1", agent: "claude", revoked_at: "2026-10-14T10:00:00Z" };
  it("the key shown stays while the server lists it as active, and goes when it is turned off or gone", () => {
    assert.equal(shownKeyVerdict([active], { keyId: "k2", listed: false }), "listed");
    assert.equal(shownKeyVerdict([active], { keyId: "k2", listed: true }), "keep");
    // The read after a create has not landed yet: the old list does not hide the new key.
    assert.equal(shownKeyVerdict([{ ...ended, revoked_at: null }], { keyId: "k2", listed: false }), "wait");
    assert.equal(shownKeyVerdict([], { keyId: "k2", listed: false }), "wait");
    // Replaced in another tab: this tab's key is listed as turned off.
    assert.equal(shownKeyVerdict([active, ended], { keyId: "k1", listed: true }), "hide");
    assert.equal(shownKeyVerdict([active, ended], { keyId: "k1", listed: false }), "hide");
    // Disconnected and no longer among the recent ones.
    assert.equal(shownKeyVerdict([], { keyId: "k1", listed: true }), "hide");
    assert.equal(shownKeyVerdict([active], { keyId: "k1", listed: true }), "hide");
    for (const none of [null, undefined, {}, { keyId: "" }]) assert.equal(shownKeyVerdict([active], none), "keep");
    assert.equal(shownKeyVerdict("nope", { keyId: "k1", listed: true }), "hide");
  });
  it("the page hides it, says why, and learns of the change whenever the tab is looked at again", () => {
    assert.ok(/verdict === "hide"\) \{\s*setFresh\(\(f\) => \(\{ \.\.\.f, \[a\.id\]: null \}\)\);\s*setShownIds\(\(m\) => \(\{ \.\.\.m, \[a\.id\]: null \}\)\);\s*setNotice\(\(n\) => \(\{ \.\.\.n, \[a\.id\]: REPLACED_ELSEWHERE_WORDS \}\)\);/.test(PAGE));
    assert.equal(REPLACED_ELSEWHERE_WORDS, "This key was replaced or disconnected somewhere else, so it no longer works and is hidden here.");
    // While a key is on screen the page checks every five seconds that it still works: only while the
    // tab is visible and online, and for at most ten minutes, after which the key is hidden.
    assert.ok(PAGE.includes("const WATCH_EVERY_MS = 5_000;"));
    assert.ok(/const showingKey = AGENTS\.some\(\(a\) => !!shownIds\[a\.id\]\);\s*const lastShownAt = Math\.max\(0, \.\.\.AGENTS\.map\(\(a\) => shownIds\[a\.id\]\?\.shownAt \|\| 0\)\);\s*useWatch\(showingKey, \(\) => \{\s*hideOldKeys\(Date\.now\(\)\);\s*refetch\(\{ quiet: true \}\);\s*\}, \{\s*until: lastShownAt \+ SHOWN_KEY_MAX_MS,/.test(PAGE));
    assert.ok(/function useWatch\(active, onTick, \{ everyMs = WATCH_EVERY_MS, until, onEnd \} = \{\}\) \{/.test(PAGE));
    assert.ok(/isVisible: \(\) => document\.visibilityState === "visible",\s*isOnline: \(\) => navigator\.onLine !== false,/.test(PAGE));
    assert.equal(/setInterval\(/.test(PAGE), false, "no timer that runs in a hidden tab or without an end");
    assert.ok(PAGE.includes("setShownIds((m) => ({ ...m, [agentId]: { keyId: made.key_id, listed: false, shownAt: Date.now() } }));"));
    assert.ok(HOOK.includes('document.addEventListener("visibilitychange", onFocus);') && HOOK.includes('window.addEventListener("focus", onFocus);'));
    // Only an id is remembered beside the key, and nothing is sent to another tab or kept in storage.
    const all = ALL_AGENT_SRC.map(([, src]) => stripComments(src)).join("\n");
    assert.equal(/BroadcastChannel|postMessage|localStorage|sessionStorage|indexedDB|addEventListener\("storage"/.test(all), false);
    assert.equal(/setShownIds\([^;]*made\.key\b/.test(PAGE), false, "the id map never holds the key");
  });
});

describe("#3802 A-8: an agent's today is the date on this screen", () => {
  it("the browser's zone is sent when a key is made", () => {
    const zone = browserTimeZone();
    assert.ok(zone === null || /^[A-Za-z0-9_+/-]{1,64}$/.test(zone));
    assert.ok(SERVICE.includes('supabase.rpc("team_agent_key_create", { p_agent: agent, p_time_zone: timeZone })'));
    assert.ok(PAGE.includes("createKey(agentId, browserTimeZone())"));
    const real = Intl.DateTimeFormat;
    try {
      Intl.DateTimeFormat = () => ({ resolvedOptions: () => ({ timeZone: "America/Los_Angeles" }) });
      assert.equal(browserTimeZone(), "America/Los_Angeles");
      for (const bad of [undefined, "", "America/New York", "x".repeat(65), "a;b", 7]) {
        Intl.DateTimeFormat = () => ({ resolvedOptions: () => ({ timeZone: bad }) });
        assert.equal(browserTimeZone(), null, String(bad));
      }
      Intl.DateTimeFormat = () => {
        throw new Error("no zones here");
      };
      assert.equal(browserTimeZone(), null);
    } finally {
      Intl.DateTimeFormat = real;
    }
  });
  it("the card says which zone the agent's dates follow, or that none is recorded", () => {
    assert.equal(zoneWords({ time_zone: "America/New_York" }), 'Your agent\'s "today" follows America/New York, the time zone this key was made in.');
    assert.match(zoneWords({ time_zone: null }), /^No time zone is recorded for this key, so your agent's "today" is the date in UTC\. Replace the key from this browser to set it\.$/);
    assert.match(zoneWords({}), /^No time zone is recorded/);
    assert.equal(zoneWords(null), "");
    const card = PARTS.find(([f]) => f === "AgentKeyCard.jsx")[1];
    assert.equal((card.match(/zoneWords\(activeKey\)/g) || []).length, 2, "said with the key on screen and without");
  });
  it("around midnight in two US zones, the screen's date and the zone's date are the same date", () => {
    // The home screen sends localToday(); the server works an agent's date
    // out as the date in the key's zone. Same moments, same answers.
    const zoneDate = (zone, at) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
    const cases = [
      ["America/New_York", "2026-10-14T03:30:00Z", "2026-10-13"],
      ["America/New_York", "2026-10-14T04:30:00Z", "2026-10-14"],
      ["America/Los_Angeles", "2026-10-14T06:30:00Z", "2026-10-13"],
      ["America/Los_Angeles", "2026-10-14T07:30:00Z", "2026-10-14"],
    ];
    const saved = process.env.TZ;
    try {
      for (const [zone, at, want] of cases) {
        process.env.TZ = zone;
        assert.equal(localToday(new Date(at)), want, `${zone} ${at}: the screen`);
        assert.equal(zoneDate(zone, new Date(at)), want, `${zone} ${at}: the zone`);
      }
      // At 23:30 in New York the date in UTC is already tomorrow: that is the gap this closes.
      process.env.TZ = "America/New_York";
      assert.equal(localToday(new Date("2026-10-14T03:30:00Z")), "2026-10-13");
      assert.equal(new Date("2026-10-14T03:30:00Z").toISOString().slice(0, 10), "2026-10-14");
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});

describe("#3802 A-8: where a key ends up, lines that were not tested, touch targets, focus", () => {
  it("every line says where the key ends up and how to take it out, and nothing claims a file an agent cannot read", () => {
    for (const agent of AGENTS) {
      for (const os of ["mac", "windows"]) {
        const l = connectLines({ agent: agent.id, os, endpoint: ENDPOINT, key: agent.id === "claude" ? KEY_C : KEY_X });
        for (const line of [...l.steps, l.simpler]) {
          assert.ok(typeof line.where === "string" && line.where.length > 30, `${agent.id} ${os} ${line.id}`);
          assert.match(line.where, /To remove/, `${agent.id} ${os} ${line.id} says how to remove it`);
          assert.equal(line.where.includes("mgla_"), false);
          if (line.hasKey) assert.match(line.where, /readable by any program you run/, `${agent.id} ${os} ${line.id} is honest about who can read it`);
          else assert.match(line.where, /hold(s)? no key/);
        }
      }
    }
    const mac = connectLines({ agent: "claude", os: "mac", endpoint: ENDPOINT, key: KEY_C });
    assert.equal(mac.steps[0].label, "1. Save the key in your shell profile");
    assert.match(mac.steps[0].where, /^The key ends up as one line in ~\/\.zshrc on this computer/);
    assert.match(mac.simpler.where, /\(\.claude\.json\)/);
    const shown = ALL_AGENT_SRC.map(([, src]) => stripComments(src)).join("\n");
    assert.equal(/not in a file an agent can read back|file an agent can read/.test(shown), false);
    const steps = PARTS.find(([f]) => f === "AgentConnectSteps.jsx")[1];
    assert.ok(steps.includes("note={line.where}"));
    assert.equal(steps.includes("simpler"), false, "the one-paste line that held the key is not drawn");
    assert.ok(steps.includes("advancedLines({ agent: agentId, os, endpoint })"));
  });
  it("lines that were not run on Windows say so, on the page and in the notes", () => {
    for (const agent of AGENTS) {
      assert.equal(connectLines({ agent: agent.id, os: "mac", endpoint: ENDPOINT, key: null }).untested, false);
      const w = connectLines({ agent: agent.id, os: "windows", endpoint: ENDPOINT, key: null });
      assert.equal(w.untested, true);
      assert.ok(w.notes.includes("These Windows lines were not run on Windows here. They follow the documented forms; if one is refused, use the simpler way below and tell an admin."));
    }
    const steps = PARTS.find(([f]) => f === "AgentConnectSteps.jsx")[1];
    assert.ok(/\{lines\.untested && \(\s*<AlertCard variant="warning" title="Not tested on Windows">/.test(steps));
    // Command Prompt has no single quotes: the JSON is one double-quoted value that still names the variable only.
    const c = connectLines({ agent: "claude", os: "windows", endpoint: ENDPOINT, key: KEY_C }).steps[1];
    assert.equal(c.text, `claude mcp add-json --scope user mingla "{\\"type\\":\\"http\\",\\"url\\":\\"${ENDPOINT}\\",\\"headers\\":{\\"Authorization\\":\\"Bearer \${MINGLA_CLAUDE_KEY}\\"}}"`);
    assert.equal(c.text.includes("'"), false);
    assert.deepEqual(JSON.parse(c.text.match(/"(\{.*\})"$/)[1].replace(/\\"/g, '"')), { type: "http", url: ENDPOINT, headers: { Authorization: "Bearer ${MINGLA_CLAUDE_KEY}" } });
  });
  it("tabs and disclosures on this page are 44px targets, and the shared tab strip is not used here", () => {
    const steps = PARTS.find(([f]) => f === "AgentConnectSteps.jsx")[1];
    const card = PARTS.find(([f]) => f === "AgentKeyCard.jsx")[1];
    assert.equal(/ui\/Tabs/.test(steps + card + PAGE), false);
    assert.ok(/role="tab"[\s\S]{0,400}min-h-11/.test(steps), "each tab is at least 44px tall");
    assert.ok(/export const DISCLOSURE_CLASS = \[\s*"flex min-h-11 /.test(steps));
    assert.equal((steps.match(/<summary className=\{DISCLOSURE_CLASS\}>/g) || []).length, 0);
    assert.equal((PARTS.find(([f]) => f === "AgentAdvanced.jsx")[1].match(/<summary className=\{DISCLOSURE_CLASS\}>/g) || []).length, 1);
    assert.equal((PAGE.match(/<summary className=\{DISCLOSURE_CLASS\}>/g) || []).length, 1);
    assert.equal((card.match(/<summary className=\{DISCLOSURE_CLASS\}>/g) || []).length, 1);
    assert.equal(/<summary className="/.test(steps + card), false, "no disclosure with its own, smaller, class");
    // The tabs keep the keyboard: arrows, Home and End, one tab stop.
    for (const k of ["ArrowRight", "ArrowLeft", "Home", "End"]) assert.ok(steps.includes(`"${k}"`), k);
    assert.ok(steps.includes("tabIndex={active ? 0 : -1}") && steps.includes('role="tablist"') && steps.includes("aria-controls={`agent-tabpanel-${a.id}`}"));
    assert.ok(steps.includes('role="tabpanel" id={`agent-tabpanel-${agentId}`} aria-labelledby={`agent-tab-${agentId}`}'));
  });
  it("in the owner's list, Keep and Escape put focus back on the button that asked", () => {
    const team = PARTS.find(([f]) => f === "AgentTeamList.jsx")[1];
    assert.ok(/\} else if \(returnTo\.current\) \{\s*askRefs\.current\[returnTo\.current\]\?\.focus\(\);\s*returnTo\.current = null;/.test(team));
    assert.ok(/const keep = \(keyId\) => \{\s*returnTo\.current = keyId;\s*setAsking\(null\);/.test(team));
    assert.ok(/if \(e\.key === "Escape"\) \{\s*e\.stopPropagation\(\);\s*keep\(a\.keyId\);/.test(team));
    assert.ok(team.includes("onClick={() => keep(a.keyId)}"));
    assert.ok(/ref=\{\(el\) => \{\s*askRefs\.current\[a\.keyId\] = el;/.test(team));
    assert.equal(/setAsking\(null\)/.test(team.replace(/const keep = [\s\S]*?\};/, "").replace(/setAsking\(null\);\s*onDisconnect/, "")), false, "no way to close the question that leaves focus nowhere");
  });
  it("the two lists this work does not own are still exported", () => {
    assert.deepEqual(STATUS_COLORS, { pending: "warning", reviewed: "info", resolved: "success", dismissed: "default" });
    assert.equal(TABLE_CATEGORIES.length, 8);
    assert.equal(TABLE_CATEGORIES[0].label, "Users & Profiles");
  });
});

describe("#3802 PR-D: Guide, prompts and counts-only agent outcomes", () => {
  it("routes Guide after My agent for every CRM role and uses the guide-only reader", () => {
    assert.equal(PAGE_AREA_OVERRIDES.guide, "crm");
    for (const a of [owner, admin, growth, partner]) assert.equal(canOpenPage(a, "guide"), true, a.role);
    assert.ok(APP.includes('import { GuidePage } from "./pages/GuidePage";'));
    assert.match(APP, /\n {2}guide: GuidePage,/);
    assert.deepEqual(NAV_GROUPS.at(-1).items.slice(-2).map((item) => item.id), ["agent", "guide"]);
    assert.deepEqual(GUIDE_TABS.map((tab) => tab.id), ["stages", "icp", "agent", "rules"]);
    assert.match(GUIDE_PAGE, /requested && requested !== tab[\s\S]*setSearch\("tab=stages", \{ replace: true \}\)/);
    assert.match(GUIDE_PAGE, /const changeTab = \(next\) => setSearch\(`tab=\$\{next\}`\)/);
    assert.match(GUIDE_PAGE, /role="tabpanel"[\s\S]*aria-labelledby=\{`tab-\$\{tab\}`\}/);
    assert.match(GUIDE_HOOK, /fetchAgentGuide\(\)/);
    assert.equal(GUIDE_HOOK.includes("useAgentKeys"), false);
    assert.equal(PROMPT_STRIP.includes("useAgentKeys"), false);
    assert.match(PROMPT_STRIP, /href="#\/agent"/);
  });

  it("accepts only a complete returned guide and keeps the nine limit labels closed", () => {
    const answer = {
      config: { pipelines: { hosts: { stages: [{}], icps: [{}] }, creators: { stages: [{}], icps: [{}] } } },
      guide: { routines: [{}], rules: ["one"] }, limits: {},
    };
    assert.equal(validAgentGuide(answer), true);
    for (const broken of [null, {}, { ...answer, guide: { routines: [], rules: ["one"] } }, { ...answer, limits: null }]) {
      assert.equal(validAgentGuide(broken), false);
    }
    assert.deepEqual(Object.keys(AGENT_LIMIT_LABELS).sort(), [
      "find_page_default", "find_page_max", "idle_days", "items_per_request", "record_log_default",
      "record_log_max", "records_written_per_day", "requests_per_minute", "tool_calls_per_day",
    ]);
    assert.match(ROUTINES, /CopyBlock/);
    assert.match(GUIDE_PAGE, /mobileGrid/);
  });

  it("builds the board prompt only from the four approved visible values", () => {
    const routine = "Find {count} {icp}{pipeline} in {region} we have not contacted.";
    assert.equal(agentPrompt({ pipeline: "hosts", icp: "", region: "", mine: false }, routine), "Find 20 hosts in my regions we have not contacted.");
    assert.equal(agentPrompt({ pipeline: "creators", icp: "Food", region: "Lagos", mine: false }, routine), "Find 20 Food creators in Lagos we have not contacted.");
    assert.equal(agentPrompt({ pipeline: "hosts", icp: "Hotel", region: "none", mine: true }, routine), "Find 20 Hotel hosts with no region yet that we have not contacted. Keep the new cards assigned to me.");
    const forbidden = agentPrompt({ pipeline: "hosts", icp: "", region: "", mine: false, q: "secret", card: "uuid", cursor: "token", view: "list", url: "https://x" }, routine);
    for (const leak of ["secret", "uuid", "token", "list", "https://x"]) assert.equal(forbidden.includes(leak), false, leak);
    assert.match(PROMPT_STRIP, /This only copies the prompt\. Nothing is sent\./);
  });

  it("maps all 20 tools and failures through closed plain-English decisions", () => {
    const tools = ["get_started", "my_day", "find_records", "get_record", "check_names", "find_mingla_link", "check_contactable", "list_beta_leads", "team_summary", "add_records", "upsert_record", "update_records", "move_stage", "set_owners", "log_activity", "record_reply", "save_drafts", "update_draft", "list_drafts", "withdraw_drafts"];
    for (const tool of tools) {
      const line = agentActivityLine({ tool, outcome: "ok", items: 2, summary: { created: 2, logged: 2, updated: 2, moved: 2, saved: 2, discarded: 2 } });
      assert.equal(typeof line.text, "string", tool);
      assert.equal(line.text.includes(tool), false, tool);
    }
    assert.equal(agentActivityLine({ tool: "unknown_secret", outcome: "ok", summary: { secret: "do not show" } }).text, "Agent request completed");
    assert.equal(agentActivityLine({ tool: "x", outcome: "stage_changed" }).text, "Was refused: card had moved");
    assert.equal(agentActivityLine({ tool: "x", outcome: "not_a_real_token" }).text, "Agent request was refused");
    assert.equal(agentActivityLine({ tool: "add_records", outcome: "ok", items: 7, summary: { created: 0 } }).text, "Added 0 records");
    assert.deepEqual([agentActivityLine({ outcome: "ok", agent: "claude" }).agent, agentActivityLine({ outcome: "ok", agent: "codex" }).agent, agentActivityLine({ outcome: "ok", agent: "raw" }).agent], ["Claude", "Codex", "Agent"]);
  });

  it("loads personal history once at 100 and reveals twenty locally without exposing raw payloads", () => {
    assert.match(ACTIVITY_HOOK, /fetchMyAgentActivity\(100, null\)/);
    assert.match(PAGE, /useState\(20\)/);
    assert.match(PAGE, /activity\.calls\.slice\(0, shownActivity\)/);
    assert.match(PAGE, /setShownActivity\(\(n\) => n \+ 20\)/);
    assert.match(PAGE, /Nothing yet\. Start with What is on my plate\./);
    for (const raw of ["call.arguments", "call.result", "JSON.stringify(call", "call.summary", "call.tool", "call.outcome"]) assert.equal(PAGE.includes(raw), false, raw);
    assert.match(PAGE, /title="Couldn't load your agent activity"/);
    assert.match(PAGE, /title="Couldn't load the routines"/);
  });

  it("normalizes person/Claude/Codex buckets without changing aggregate totals", () => {
    const [row] = weekRows([{ email: "a@x.co", touches: 9, stage_moves: 4, added: 3, touches_by: { person: 5, claude: 2, codex: "2" }, stage_moves_by: { person: -1, claude: 1, codex: 2 }, added_by: null }]);
    assert.equal(row.touches, 9);
    assert.deepEqual(row.touchesBy, { person: 5, claude: 2, codex: 2 });
    assert.deepEqual(row.stageMovesBy, { person: 0, claude: 1, codex: 2 });
    assert.deepEqual(row.addedBy, { person: 0, claude: 0, codex: 0 });
    assert.match(WEEK, /min-w-\[800px\]/);
    assert.match(WEEK, /of \$\{r\.touches\} touches were by agents: Claude/);
    assert.match(WEEK, /Claude \{r\.touchesBy\.claude\} · Codex \{r\.touchesBy\.codex\}/);
  });

  it("keeps Team and roles controls available when its independent owner status read fails", () => {
    assert.match(OVERVIEW_HOOK, /access\?\.role === "owner"/);
    assert.match(OVERVIEW_HOOK, /fetchKeysOverview\(\)/);
    assert.match(ADMIN_PAGE, /Agent status unavailable/);
    assert.match(ADMIN_PAGE, /Team access controls still work\./);
    assert.match(ADMIN_PAGE, /Their agent keys will be turned off\./);
    assert.match(ADMIN_PAGE, /Their agent keys were turned off\./);
    assert.match(ADMIN_PAGE, /They can connect a new agent\./);
    assert.match(PARTS.find(([file]) => file === "AgentTeamList.jsx")[1], /Reconnect to disconnect an agent\./);
  });

  it("keeps via labels closed and title-cased", () => {
    assert.equal(activityVia({ via: "claude" }), "Claude");
    assert.equal(activityVia({ via: "codex" }), "Codex");
    for (const via of [null, undefined, "system", "unknown", "CLAUDE"]) assert.equal(activityVia({ via }), "");
  });
});
