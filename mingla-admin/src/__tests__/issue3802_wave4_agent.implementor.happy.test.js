// Issue #3802 (Wave 4, first part) — the My agent page: its pure decisions and
// its source contracts.
//
//   A-1  who may open My agent, and where it sits in the menu
//   A-2  the lines to paste, for each agent and each kind of computer; where
//        the key appears and where it never does
//   A-3  the status line, and why a key stopped, in plain words
//   A-4  what it can do matches the connector's own list of tools; nothing
//        that is not built yet is offered
//   A-5  every answer from the server becomes words, never a code
//   A-6  the owner's view never carries a key
//   A-7  source contracts: one service file per kind of server function, a
//        key is never stored or logged, every button has an answer
//
// Run: node --test src/__tests__/issue3802_wave4_agent.implementor.happy.test.js
// (from mingla-admin). Hermetic: no network, no browser.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_AREA_OVERRIDES, areaForPage, canOpenPage, resolveRoute, visibleNavGroups } from "../lib/access.js";
import { NAV_GROUPS, NAV_ITEMS, TEAM_AGENT_NAV_ITEMS, teamAgentTitle, teamNavGroups } from "../lib/constants.js";
import {
  AGENTS,
  AGENT_ABILITIES,
  AGENT_GUARDRAILS,
  AGENT_NOT_YET,
  KEY_PLACEHOLDER,
  abilitiesFor,
  activeKey,
  agentEndpoint,
  agentErrorWords,
  agentLoadErrorWords,
  agentStatus,
  agoWords,
  clientName,
  connectLines,
  isAgentKey,
  lastStoppedKey,
  overviewRows,
  stoppedWords,
} from "../lib/agentConnect.js";

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
const PARTS = ["AgentKeyCard.jsx", "AgentConnectSteps.jsx", "AgentTeamList.jsx", "CopyBlock.jsx"].map((f) => [f, read(path.join("components", "agent", f))]);
const ALL_AGENT_SRC = [["AgentPage", PAGE], ["teamAgentService", SERVICE], ["useAgentKeys", HOOK], ["agentConnect", LIB], ...PARTS];

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
    assert.ok(/\n  agent: AgentPage,\n/.test(APP));
    assert.deepEqual(resolveRoute("agent", growth, ["home", "agent"]), { pageId: "agent", denied: false, requestedId: "agent" });
    assert.deepEqual(resolveRoute("agent", person("growth", ["role_home"]), ["home", "agent"]), { pageId: "home", denied: true, requestedId: "agent" });
  });
  it("sits at the end of the Team group in the menu each role is shown", () => {
    const drawn = (a) => teamNavGroups(visibleNavGroups(NAV_GROUPS, a), TEAM_AGENT_NAV_ITEMS.filter((i) => canOpenPage(a, i.id)));
    for (const a of [growth, partner]) {
      assert.deepEqual(drawn(a).flatMap((g) => g.items).map((i) => i.id), ["home", "beta-leads", "hosts", "creators", "agent"], a.role);
    }
    for (const a of [owner, admin]) {
      const team = drawn(a).at(-1);
      assert.equal(team.label, "Team");
      assert.deepEqual(team.items.map((i) => `${i.id}:${i.label}:${i.icon}`), ["team-dashboard:Team dashboard:BarChart3", "hosts:Hosts:Store", "creators:Creators:Sparkles", "agent:My agent:Bot"]);
    }
    // Someone with no pipelines area is shown no My agent, and no empty group.
    const none = person("growth", ["role_home"]);
    assert.deepEqual(drawn(none).flatMap((g) => g.items).map((i) => i.id), ["home"]);
    // A person whose menu has no Team group still gets one, holding My agent.
    assert.deepEqual(teamNavGroups([{ label: null, items: [{ id: "home" }] }], TEAM_AGENT_NAV_ITEMS).at(-1), { label: "Team", items: TEAM_AGENT_NAV_ITEMS });
    // It changes neither list it was given.
    const before = JSON.stringify(NAV_GROUPS);
    drawn(owner);
    assert.equal(JSON.stringify(NAV_GROUPS), before);
    assert.equal(NAV_ITEMS.some((i) => i.id === "agent"), false, "the earlier flat list is as it was");
  });
  it("the menu, the title and the command palette all know it", () => {
    assert.ok(SIDEBAR.includes("teamNavGroups(") && SIDEBAR.includes("TEAM_AGENT_NAV_ITEMS.filter((item) => canOpenPage(access, item.id))"));
    assert.ok(/\bBot,\n\} from "lucide-react";/.test(SIDEBAR) && /\n  Bot,\n\};/.test(SIDEBAR), "the Bot icon is imported and registered");
    assert.equal(teamAgentTitle("agent"), "My agent");
    assert.equal(teamAgentTitle("hosts"), "");
    assert.equal(teamAgentTitle("__proto__"), "");
    assert.ok(SHELL.includes("teamAgentTitle(activeTab) || pageTitle(activeTab, access, NAV_ITEMS)"));
    assert.ok(PALETTE.includes("[...TEAM_NAV_GROUP.items, ...NAV_ITEMS, ...TEAM_AGENT_NAV_ITEMS].filter((p) => canOpenPage(access, p.id))"));
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
  it("Windows: setx, a new terminal, and a way out if the line is refused", () => {
    const c = connectLines({ agent: "claude", os: "windows", endpoint: ENDPOINT, key: KEY_C });
    assert.equal(c.steps[0].text, `setx MINGLA_CLAUDE_KEY "${KEY_C}"`);
    assert.match(c.steps[1].label, /^2\. Open a new terminal window/);
    assert.ok(c.notes.includes("If the second line is refused, use the simpler line below."));
    const x = connectLines({ agent: "codex", os: "windows", endpoint: ENDPOINT, key: KEY_X });
    assert.equal(x.steps[0].text, `setx MINGLA_CODEX_KEY "${KEY_X}"`);
    assert.equal(x.steps[1].label, "2. Add these lines to %USERPROFILE%\\.codex\\config.toml");
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
    assert.deepEqual(abilitiesFor("owner").map((g) => g.group), ["Your day", "Find and check", "Beta leads", "Team"]);
  });
  it("nothing that is not built yet is offered as something to use", () => {
    const shown = ALL_AGENT_SRC.map(([, src]) => stripComments(src)).join("\n");
    // No tool of a later part is named anywhere on the page.
    for (const later of ["add_records", "move_stage", "log_activity", "save_drafts", "record_reply", "check_contactable", "set_target", "update_records"]) {
      assert.equal(shown.includes(later), false, later);
    }
    for (const promise of ["Drafts to send", "See what it wrote for me", "morning sweep", "Copy prompt", "What my agent did"]) {
      assert.equal(shown.includes(promise), false, promise);
    }
    // What is coming is under "Not yet", in plain words.
    assert.ok(PAGE.includes('title="Not yet"') && PAGE.includes('subtitle="Arriving next"'));
    assert.equal(AGENT_NOT_YET.length, 3);
    assert.ok(AGENT_NOT_YET.some((l) => /drafts for you to send\. You always send\./.test(l)));
    assert.ok(AGENT_NOT_YET.some((l) => /in the browser or on your phone/.test(l)));
    assert.ok(AGENT_GUARDRAILS.includes("Right now it reads. It cannot change a card yet."));
    assert.ok(AGENT_GUARDRAILS.includes("It never sends an email, DM or WhatsApp. A person sends."));
    assert.ok(PAGE.includes("Right now it can"));
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
    assert.deepEqual(called, ["team_agent_guide", "team_agent_key_create", "team_agent_key_revoke", "team_agent_keys_mine", "team_agent_keys_overview", "team_agent_my_activity"]);
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
    assert.equal((PAGE.match(/setFresh\(/g) || []).length, 3, "set on create, cleared on Done and on Disconnect");
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
      assert.ok(/catch \(err\) \{[\s\S]*addToast\(\{ variant: "error"/.test(body[1]), `${fn} answers on failure`);
      assert.ok(/agentErrorWords\(err\)/.test(body[1]), `${fn} uses plain words`);
    }
    // A second press while the first is on its way sends nothing.
    assert.equal((PAGE.match(/if \(busyRef\.current\[agentId\]\) return;/g) || []).length, 2, "create and disconnect each ignore a second press");
    assert.ok(PAGE.includes("if (busyKeyId) return;"));
    // A failure also stays on the card, not only in a message that disappears.
    assert.ok(PAGE.includes("setProblem((p) => ({ ...p, [agentId]: `No key was created. ${words}` }));"));
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
    assert.ok(steps.includes("Create your {agent.label} key in step 1 first."));
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
    assert.ok(/if \(quiet\) return;\s*setState\(\{ key, data: null, error, loaded: true \}\);/.test(HOOK), "a quiet refresh that fails keeps what is on screen");
    assert.ok(HOOK.includes('window.addEventListener("online", onOnline);'));
  });
});
