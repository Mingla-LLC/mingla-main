// Issue #3802 (Wave 4, first part) — independent tester suite for the My agent
// page. A different angle from the implementor suite: that one checks each
// decision once with tidy input; this one feeds the same decisions hostile
// and broken input, and checks what the pasted lines really do in a shell.
//
// [TEST-MOD-APPROVED ISSUE-3802] 2026-10-13: Seth approved the admin shell
// revamp (issue #3802, "one frame for every page, menu grouped by job").
// Changed here, and only this: TG-3 pinned My agent in its own "Help" group,
// last, after "Team". It now pins the approved place: the last item of the
// "System" group, which is the last group. Every combination of areas is still
// walked, and the page is still in the menu exactly when it may be opened.
//
//   TG-1  the lines to paste, run for real: a shell reads them back, and the
//         key lands where the page says and nowhere else
//   TG-2  nothing but a real key and a plain address is ever put in a line
//   TG-3  who may open the page and what the menu shows, for every
//         combination of areas a person could hold
//   TG-4  what an agent says about itself is shown as short plain text,
//         whatever it sends
//   TG-5  the status line and the reason a key stopped, with broken dates,
//         clocks that disagree and reasons this page has never heard of
//   TG-6  every failure becomes a sentence a person can act on: no code, no
//         statement, no internal name, whatever the server or network says
//   TG-7  the owner's list is built only from what it is meant to show, even
//         when the answer carries more
//   TG-8  the key on screen goes to the key box and the lines, and to
//         nothing else in the page's code
//   TG-9  this suite and its two siblings are run by the workflow
//
// Run: node --test src/__tests__/agent_connector_issue3802.tester.adversarial.test.js
// (from mingla-admin). Hermetic: no network, no browser. TG-1 runs `sh` with
// a throwaway HOME and removes it.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AREA, PAGE_AREA_OVERRIDES, canOpenPage, homePageFor, resolveRoute, visibleNavGroups } from "../lib/access.js";
import { NAV_GROUPS } from "../lib/constants.js";
import {
  AGENTS,
  KEY_PLACEHOLDER,
  activeKey,
  agentEndpoint,
  agentErrorWords,
  agentLoadErrorWords,
  agentStatus,
  agoWords,
  clientName,
  connectLines,
  dayWords,
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

const ENDPOINT = "https://example.supabase.co/functions/v1/team-agent";
const NOW = Date.parse("2026-10-14T12:00:00Z");
// Made up here, in the shape of a key; never a real one. Deterministic, and
// built to carry every character a key may hold, at both ends.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function madeUpKey(letter, seed) {
  let x = seed * 2654435761 % 4294967296;
  let body = "";
  for (let i = 0; i < 43; i++) {
    x = (x * 1664525 + 1013904223) % 4294967296;
    body += ALPHABET[x % 64];
  }
  return `mgla_${letter}_${body}`;
}
const EDGE_KEYS = (letter) => [
  `mgla_${letter}_${"-".repeat(43)}`,
  `mgla_${letter}_${"_".repeat(43)}`,
  `mgla_${letter}_-${"a".repeat(41)}-`,
  `mgla_${letter}__${"Z".repeat(41)}_`,
  ...Array.from({ length: 40 }, (_, i) => madeUpKey(letter, i + 1)),
];

describe("#3802 TG-1: the lines to paste, run in a real shell", () => {
  it("macOS or Linux, step 1: after the line runs, a new shell holds exactly the key, and it is in ~/.zshrc and nowhere else", () => {
    for (const agent of AGENTS) {
      for (const key of EDGE_KEYS(agent.letter).slice(0, 12)) {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "issue3802-tg1-"));
        try {
          const line = connectLines({ agent: agent.id, os: "mac", endpoint: ENDPOINT, key }).steps[0].text;
          // `source` is the shell's own word for `.`; plain sh spells it `.`.
          const portable = line.replace("&& source ~/.zshrc", "&& . ~/.zshrc");
          assert.notEqual(portable, line, "the line ends by reading the file back");
          const out = execFileSync("sh", ["-c", `${portable} && printf %s "$${agent.envVar}"`], {
            env: { HOME: home, PATH: process.env.PATH },
            encoding: "utf8",
          });
          assert.equal(out, key, `${agent.id}: the variable holds the key, character for character`);
          const files = fs.readdirSync(home);
          assert.deepEqual(files, [".zshrc"]);
          assert.equal(fs.readFileSync(path.join(home, ".zshrc"), "utf8"), `export ${agent.envVar}="${key}"\n`);
          // Run twice (a replaced key): the newest line wins in a new shell.
          const key2 = madeUpKey(agent.letter, 999);
          const line2 = connectLines({ agent: agent.id, os: "mac", endpoint: ENDPOINT, key: key2 }).steps[0].text.replace("&& source ~/.zshrc", "&& . ~/.zshrc");
          const out2 = execFileSync("sh", ["-c", `${line2} && printf %s "$${agent.envVar}"`], { env: { HOME: home, PATH: process.env.PATH }, encoding: "utf8" });
          assert.equal(out2, key2, "after a replacement the new key is the one a new shell holds");
        } finally {
          fs.rmSync(home, { recursive: true, force: true });
        }
      }
    }
  });

  it("Claude Code, step 2: a shell hands the agent one JSON value that names the variable and holds no key", () => {
    for (const osId of ["mac", "windows"]) {
      for (const key of EDGE_KEYS("c").slice(0, 6)) {
        const lines = connectLines({ agent: "claude", os: osId, endpoint: ENDPOINT, key });
        const add = lines.steps[1];
        assert.equal(add.hasKey, false);
        assert.equal(add.text.includes(key), false);
        assert.equal(add.text.includes(key.slice(7)), false);
        if (osId !== "mac") continue;
        // What the program would receive as its arguments, with the variable
        // set in the shell: the name must arrive unexpanded.
        const argv = JSON.parse(
          execFileSync("sh", ["-c", add.text.replace(/^claude /, `node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- `)], {
            env: { PATH: process.env.PATH, MINGLA_CLAUDE_KEY: key },
            encoding: "utf8",
          })
        );
        assert.deepEqual(argv.slice(0, 5), ["mcp", "add-json", "--scope", "user", "mingla"]);
        assert.equal(argv.length, 6);
        assert.deepEqual(JSON.parse(argv[5]), {
          type: "http",
          url: ENDPOINT,
          headers: { Authorization: "Bearer ${MINGLA_CLAUDE_KEY}" },
        });
        assert.equal(argv[5].includes(key.slice(7)), false, "the shell did not put the key into the line");
      }
    }
  });

  it("Claude Code, the simpler line: one program, the address, and one header that is the key", () => {
    for (const key of EDGE_KEYS("c").slice(0, 12)) {
      const simple = connectLines({ agent: "claude", os: "mac", endpoint: ENDPOINT, key }).simpler;
      assert.equal(simple.hasKey, true);
      const argv = JSON.parse(
        execFileSync("sh", ["-c", simple.text.replace(/^claude /, `node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- `)], {
          env: { PATH: process.env.PATH },
          encoding: "utf8",
        })
      );
      assert.deepEqual(argv, ["mcp", "add", "--transport", "http", "--scope", "user", "mingla", ENDPOINT, "--header", `Authorization: Bearer ${key}`]);
    }
  });

  it("Codex: the config lines are three plain settings, and only the simpler ones hold the key", () => {
    for (const osId of ["mac", "windows"]) {
      for (const key of EDGE_KEYS("x").slice(0, 12)) {
        const lines = connectLines({ agent: "codex", os: osId, endpoint: ENDPOINT, key });
        assert.deepEqual(lines.steps[1].text.split("\n"), ["[mcp_servers.mingla]", `url = "${ENDPOINT}"`, 'bearer_token_env_var = "MINGLA_CODEX_KEY"']);
        assert.equal(lines.steps[1].hasKey, false);
        assert.deepEqual(lines.simpler.text.split("\n"), ["[mcp_servers.mingla]", `url = "${ENDPOINT}"`, `http_headers = { "Authorization" = "Bearer ${key}" }`]);
        assert.equal(lines.simpler.hasKey, true);
        assert.match(lines.steps[1].label, osId === "windows" ? /%USERPROFILE%\\\.codex\\config\.toml$/ : /~\/\.codex\/config\.toml$/);
      }
    }
  });

  it("each agent's key goes into that agent's own variable, and a key for one is never put in the other's lines", () => {
    assert.deepEqual(AGENTS.map((a) => `${a.id}:${a.envVar}:${a.letter}`), ["claude:MINGLA_CLAUDE_KEY:c", "codex:MINGLA_CODEX_KEY:x"]);
    for (const osId of ["mac", "windows"]) {
      const c = connectLines({ agent: "claude", os: osId, endpoint: ENDPOINT, key: madeUpKey("c", 5) });
      const x = connectLines({ agent: "codex", os: osId, endpoint: ENDPOINT, key: madeUpKey("x", 5) });
      const all = (l) => [...l.steps, l.simpler].map((s) => s.text).join("\n");
      assert.equal(all(c).includes("MINGLA_CODEX_KEY"), false);
      assert.equal(all(x).includes("MINGLA_CLAUDE_KEY"), false);
      assert.equal(all(c).includes("mgla_x_"), false);
      assert.equal(all(x).includes("mgla_c_"), false);
    }
  });
});

describe("#3802 TG-2: nothing but a real key and a plain address is ever put in a line", () => {
  const HOSTILE_KEYS = [
    'mgla_c_' + "a".repeat(42) + '"',
    "mgla_c_" + "a".repeat(42) + "'",
    "mgla_c_" + "a".repeat(42) + "`",
    "mgla_c_" + "a".repeat(42) + "$",
    "mgla_c_" + "a".repeat(42) + "\\",
    "mgla_c_" + "a".repeat(42) + ";",
    "mgla_c_" + "a".repeat(42) + " ",
    "mgla_c_" + "a".repeat(42) + "\n",
    "mgla_c_" + "a".repeat(43) + "\n",
    "\nmgla_c_" + "a".repeat(43),
    "mgla_c_" + "a".repeat(43) + "\nrm -rf ~",
    "mgla_c_$(touch pwned)" + "a".repeat(28),
    "mgla_c_" + "a".repeat(44),
    "mgla_c_" + "a".repeat(42),
    "mgla_d_" + "a".repeat(43),
    "MGLA_C_" + "a".repeat(43),
    "mgla_c_" + "é".repeat(43),
    "<your key>",
    "",
    " ",
    null,
    undefined,
    7,
    {},
    ["mgla_c_" + "a".repeat(43)],
    { toString: () => "mgla_c_" + "a".repeat(43) },
  ];
  it("anything that is not exactly a key is shown as the placeholder, in every line, for every agent and computer", () => {
    for (const bad of HOSTILE_KEYS) {
      assert.equal(isAgentKey(bad), false, JSON.stringify(String(bad)).slice(0, 40));
      for (const agent of AGENTS) {
        for (const osId of ["mac", "windows"]) {
          const lines = connectLines({ agent: agent.id, os: osId, endpoint: ENDPOINT, key: bad });
          for (const l of [...lines.steps, lines.simpler]) {
            if (l.hasKey) assert.ok(l.text.includes(KEY_PLACEHOLDER), `${agent.id}/${osId}/${l.id}`);
            assert.equal(/pwned|rm -rf|\$\(/.test(l.text), false);
            assert.equal(l.text.split("\n").length, l.id === "keep" || agent.id === "claude" ? 1 : 3, `${agent.id}/${osId}/${l.id}: no extra line`);
          }
        }
      }
    }
  });

  it("a real key adds only itself: each line is the placeholder line with the key in its place", () => {
    for (const agent of AGENTS) {
      for (const osId of ["mac", "windows"]) {
        const blank = connectLines({ agent: agent.id, os: osId, endpoint: ENDPOINT, key: null });
        for (const key of EDGE_KEYS(agent.letter)) {
          const filled = connectLines({ agent: agent.id, os: osId, endpoint: ENDPOINT, key });
          for (const which of ["0", "1", "simpler"]) {
            const a = which === "simpler" ? blank.simpler : blank.steps[Number(which)];
            const b = which === "simpler" ? filled.simpler : filled.steps[Number(which)];
            assert.equal(b.text, a.text.split(KEY_PLACEHOLDER).join(key));
            assert.equal(b.label, a.label);
            assert.equal(b.text.includes(key), a.hasKey);
          }
          assert.deepEqual(filled.notes, blank.notes);
        }
      }
    }
  });

  it("an address that is not a plain web address gives no lines at all", () => {
    const BAD = [
      'https://example.supabase.co"; rm -rf ~; echo "',
      "https://example.supabase.co' --header 'X: y",
      "https://example.supabase.co/functions/v1/other",
      "https://example.supabase.co?x=1",
      "https://example.supabase.co#frag",
      "https://user:pass@example.supabase.co",
      "https://example.supabase.co\nhttps://evil.example",
      "https://example .supabase.co",
      "https://exa$mple.supabase.co",
      "https://example.supabase.co:999999",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "//example.supabase.co",
      "example.supabase.co",
      "",
      null,
      undefined,
      {},
    ];
    for (const bad of BAD) {
      assert.equal(agentEndpoint(bad), "", JSON.stringify(String(bad)).slice(0, 50));
      for (const agent of AGENTS) assert.equal(connectLines({ agent: agent.id, os: "mac", endpoint: agentEndpoint(bad), key: madeUpKey(agent.letter, 1) }), null);
    }
    assert.equal(agentEndpoint("https://example.supabase.co"), ENDPOINT);
    assert.equal(agentEndpoint("  https://example.supabase.co///  "), ENDPOINT);
    assert.equal(agentEndpoint("http://127.0.0.1:54321"), "http://127.0.0.1:54321/functions/v1/team-agent");
    assert.equal(connectLines({ agent: "gemini", os: "mac", endpoint: ENDPOINT, key: madeUpKey("c", 1) }), null, "an agent the page does not know gets no lines");
  });
});

describe("#3802 TG-3: who may open My agent, for every combination of areas", () => {
  const AREAS = Object.values(AREA);
  const KNOWN = ["home", "agent", "hosts", "creators", "beta-leads", "admin", "overview"];
  it("the pipelines area, and only it, opens the page and puts it in the menu", () => {
    assert.ok(AREAS.length >= 5 && AREAS.includes("crm"));
    assert.equal(PAGE_AREA_OVERRIDES.agent, "crm");
    let combos = 0;
    for (let mask = 0; mask < 1 << AREAS.length; mask++) {
      const areas = AREAS.filter((_, i) => mask & (1 << i));
      for (const role of ["owner", "admin", "growth", "partner"]) {
        for (const status of ["active", "invited", "revoked"]) {
          const who = { email: "t@example.test", role, status, areas };
          const may = status === "active" && areas.includes("crm");
          assert.equal(canOpenPage(who, "agent"), may, `${role}/${status}/${areas.join("+") || "nothing"}`);
          // (Someone with no home page at all is shown no page, whatever else they hold.)
          assert.equal(resolveRoute("agent", who, KNOWN).pageId === "agent", may && homePageFor(who) !== null, `${role}/${status}/${areas.join("+")}: the address shows the page only to someone who may open it`);
          const groups = visibleNavGroups(NAV_GROUPS, who);
          // [TEST-MOD-APPROVED ISSUE-3802] was: a "Help" group is shown only with
          // the page and holds only it. My agent is now the last item of System.
          const holders = groups.filter((g) => g.items.some((i) => i.id === "agent"));
          assert.equal(holders.length, may ? 1 : 0, `${role}/${status}/${areas.join("+")}: My agent is in the menu only with the page`);
          if (may) {
            assert.equal(groups.at(-1).label, "System");
            assert.equal(holders[0], groups.at(-1));
            assert.equal(holders[0].items.at(-1).id, "agent");
          }
          assert.equal(groups.some((g) => g.items.length === 0), false, "no empty group is ever shown");
          assert.equal(groups.flatMap((g) => g.items).filter((i) => i.id === "agent").length, may ? 1 : 0);
          combos += 1;
        }
      }
    }
    assert.ok(combos >= 384);
  });
  it("someone who is nobody is shown nothing", () => {
    for (const nobody of [null, undefined, {}, { role: "owner" }, { areas: ["crm"] }, { role: "growth", status: "active" }, { role: "growth", status: "active", areas: "crm" }]) {
      assert.equal(canOpenPage(nobody, "agent"), false, JSON.stringify(nobody));
      // [TEST-MOD-APPROVED ISSUE-3802] was: no "Help" group. Now: no group at all.
      assert.deepEqual(visibleNavGroups(NAV_GROUPS, nobody), [], JSON.stringify(nobody));
    }
  });
  it("My agent is in the one menu list once, the last item of System, the last group", () => {
    // [TEST-MOD-APPROVED ISSUE-3802] was: a "Help" group, last, after "Team".
    const labels = NAV_GROUPS.map((g) => g.label);
    assert.equal(labels.filter((l) => l === "System").length, 1);
    assert.equal(labels.at(-1), "System");
    assert.equal(labels.includes("Help"), false);
    assert.deepEqual(NAV_GROUPS.at(-1).items.at(-1), { id: "agent", label: "My agent", icon: "Bot" });
    assert.equal(NAV_GROUPS.slice(0, -1).some((g) => g.items.some((i) => i.id === "agent")), false);
    const CONSTANTS = stripComments(read("lib/constants.js"));
    assert.equal(/TEAM_AGENT_NAV_ITEMS|teamNavGroups|teamAgentTitle/.test(CONSTANTS), false, "no second list of menu items exists beside the one list");
    for (const file of ["components/layout/Sidebar.jsx", "components/CommandPalette.jsx", "components/layout/AppShell.jsx", "App.jsx"]) {
      assert.equal(/TEAM_AGENT_NAV_ITEMS|teamNavGroups|teamAgentTitle/.test(stripComments(read(file))), false, file);
    }
  });
});

describe("#3802 TG-4: what an agent says about itself", () => {
  it("the names real agents send are shown short", () => {
    assert.equal(clientName("claude-code/2.1.294 (claude-desktop, agent-sdk/0.3.295)"), "Claude Code 2.1");
    assert.equal(clientName("Claude-Code/3.0.0"), "Claude Code 3.0");
    assert.equal(clientName("codex-mcp-client/0.99.0"), "Codex 0.99");
    assert.equal(clientName("codex_cli_rs/1.4.2 (Mac OS 15.1; arm64)"), "Codex 1.4");
    assert.equal(clientName("node"), "node");
  });
  it("whatever is sent comes out as at most forty plain characters", () => {
    const HOSTILE = [
      "<img src=x onerror=alert(1)>",
      "claude-code/9.9 <script>alert(1)</script>",
      "codex/1.2‮gnp.exe",
      "\u0000\u0007\u001b[31mred\u001b[0m",
      "a".repeat(5000),
      "Claude Code 2.1 — trusted ✓",
      "\r\nSet-Cookie: x=1",
      "​‍﻿",
      "   ",
      "",
      null,
      undefined,
      7,
      { toString: () => "claude-code/1.0" },
      ["claude-code/1.0"],
    ];
    for (const raw of HOSTILE) {
      const shown = clientName(raw);
      assert.equal(typeof shown, "string");
      assert.ok(shown.length <= 40, JSON.stringify(shown));
      assert.equal(/[^\x20-\x7E…]/.test(shown), false, JSON.stringify(shown));
      assert.equal(shown, shown.trim());
    }
    assert.equal(clientName("claude-code/9.9 <script>alert(1)</script>"), "Claude Code 9.9", "nothing after the version is kept");
    assert.equal(clientName(null), "");
    assert.equal(clientName("​‍﻿"), "");
    // It only ever reaches the screen as text.
    const CARD = read("components/agent/AgentKeyCard.jsx") + read("components/agent/AgentTeamList.jsx") + read("pages/AgentPage.jsx") + read("components/agent/CopyBlock.jsx") + read("components/agent/AgentConnectSteps.jsx");
    assert.equal(/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document\.write/.test(CARD), false);
  });
});

describe("#3802 TG-5: the status line and why a key stopped, with broken input", () => {
  it("a key that was turned off is never the connected one, however recently it was used", () => {
    const keys = [
      { key_id: "1", agent: "claude", revoked_at: "2026-10-14T11:59:00Z", revoke_reason: "replaced", last_used_at: "2026-10-14T11:58:00Z" },
      { key_id: "2", agent: "claude", revoked_at: "2026-10-13T11:59:00Z", revoke_reason: "owner", last_used_at: "2026-10-13T11:58:00Z" },
      { key_id: "3", agent: "codex", revoked_at: null, last_used_at: null },
      null,
      "junk",
      { agent: "claude" === "x" ? "" : undefined },
    ];
    assert.equal(activeKey(keys, "claude"), null);
    assert.equal(agentStatus(activeKey(keys, "claude"), "claude", NOW).state, "none");
    assert.equal(lastStoppedKey(keys, "claude").key_id, "1", "the most recently stopped key is the one explained");
    assert.equal(activeKey(keys, "codex").key_id, "3");
    assert.equal(agentStatus(activeKey(keys, "codex"), "codex", NOW).text, "Key created · not used yet");
    for (const junk of [null, undefined, "x", 7, {}]) {
      assert.equal(activeKey(junk, "claude"), null);
      assert.equal(lastStoppedKey(junk, "claude"), null);
    }
  });
  it("a clock that is ahead, or a date that is not a date, never shows nonsense", () => {
    assert.equal(agoWords("2026-10-14T12:05:00Z", NOW), "just now", "the server's clock is ahead of this computer's");
    assert.equal(agoWords("2030-01-01T00:00:00Z", NOW), "just now");
    assert.equal(agoWords("not a date", NOW), "");
    assert.equal(agoWords(null, NOW), "");
    assert.equal(dayWords("not a date", NOW), "");
    for (const t of ["2026-10-14T11:58:31Z", "2026-10-14T11:00:00Z", "2026-10-13T12:00:00Z", "2026-09-01T00:00:00Z", "2025-10-14T12:00:00Z", "1970-01-01T00:00:00Z"]) {
      const words = agoWords(t, NOW);
      assert.equal(/NaN|undefined|null|-\d|Invalid/.test(words), false, words);
      assert.ok(words.length > 3, t);
    }
    const s = agentStatus({ last_used_at: "garbage", last_used_client: "<b>x</b>" }, "claude", NOW);
    assert.equal(/NaN|undefined|Invalid/.test(s.text), false, s.text);
    assert.equal(agentStatus({ last_used_at: "2026-10-14T11:59:30Z", last_used_client: null }, "claude", NOW).text, "Connected: Claude · last used just now");
    assert.equal(agentStatus({ last_used_at: "2026-10-14T11:59:30Z" }, "nobody", NOW).text, "Connected: Agent · last used just now");
  });
  it("every reason is a sentence, and a reason this page has never heard of still is", () => {
    const at = "2026-10-13T09:00:00Z";
    for (const reason of ["replaced", "self", "owner", "access_removed", "address_rule", "idle", "something_new", "", null, undefined, 7, "<b>x</b>", "DROP TABLE"]) {
      for (const mine of [true, false]) {
        const words = stoppedWords({ revoked_at: at, revoke_reason: reason, revoked_by_me: mine }, 90, NOW);
        assert.match(words, /^[A-Z].+\.$/, String(reason));
        assert.equal(/_|<|>|DROP|undefined|null|NaN/.test(words), false, words);
        assert.ok(words.includes("13 Oct"), words);
      }
    }
    assert.equal(stoppedWords({ revoked_at: at, revoke_reason: "owner", revoked_by_me: false }, 90, NOW), "The owner disconnected this agent on 13 Oct.");
    assert.equal(stoppedWords({ revoked_at: at, revoke_reason: "owner", revoked_by_me: true }, 90, NOW), "You disconnected this agent on 13 Oct.");
    assert.equal(stoppedWords({ revoked_at: "garbage", revoke_reason: "idle" }, 90, NOW), "Unused for 90 days, so this key was turned off.");
    assert.equal(stoppedWords({ revoked_at: null, revoke_reason: "idle" }, 90, NOW), "", "a key that is not stopped has no reason");
    assert.equal(stoppedWords(null, 90, NOW), "");
  });
});

describe("#3802 TG-6: every failure becomes a sentence a person can act on", () => {
  const RAW = [
    { code: "XX000", message: 'relation "public.team_agent_keys" does not exist', details: "SELECT 1 FROM public.team_agent_keys", hint: null },
    { code: "23505", message: 'duplicate key value violates unique constraint "team_agent_keys_one_active"', details: "Key (owner_email, agent)=(a@b.c, claude) already exists." },
    { code: "42501", message: "permission denied for function team_agent_key_create" },
    { code: "42501", message: "forbidden" },
    { code: "P0002", message: "not_found: That key is no longer here." },
    { code: "22023", message: "invalid_agent: Choose Claude or Codex." },
    { code: "PGRST202", message: "Could not find the function public.team_agent_key_create(p_agent) in the schema cache" },
    { code: "PGRST301", message: "JWT expired" },
    { code: "57014", message: "canceling statement due to statement timeout" },
    { code: "40001", message: "try_again: could not serialize access" },
    { message: "forbidden: An agent cannot manage keys. Open My agent in Mingla Admin." },
    { message: "forbidden: x" },
    { message: "forbidden: team_agent_keys" },
    { message: "weird_new_token: at teamAgentService.js:42 SELECT * FROM auth.users" },
    { message: "<img src=x onerror=alert(1)>" },
    { message: "a".repeat(5000) },
    new TypeError("Failed to fetch"),
    new Error("Load failed"),
    new Error(""),
    { token: "network", message: "" },
    { token: "unknown", message: "stack: at foo (bar.js:1)" },
    { token: "not_ready" },
    { token: "signed_out" },
    { token: "__proto__" },
    { token: "constructor" },
    { token: "toString" },
    {},
    null,
    undefined,
    "a string",
    7,
  ];
  const INTERNAL = /team_agent|crm_|admin_team|public\.|auth\.users|relation|constraint|PGRST|schema cache|JWT|SELECT|statement|\.js:\d|stack|<img|onerror|[a-z]+_[a-z_]+|function |\bat [a-z]+ \(|undefined|null|\[object/i;
  it("for an action", () => {
    for (const err of RAW) {
      const words = agentErrorWords(err);
      assert.equal(typeof words, "string");
      assert.match(words, /^[A-Z][\s\S]{20,220}\.$/, JSON.stringify(words).slice(0, 80));
      assert.equal(INTERNAL.test(words), false, words.slice(0, 120));
    }
    assert.equal(agentErrorWords({ message: "forbidden: An agent cannot manage keys. Open My agent in Mingla Admin." }), "An agent cannot manage keys. Open My agent in Mingla Admin.");
    assert.equal(agentErrorWords({ message: "forbidden: x" }), "Your account can't use My agent. Ask the owner to give you team access.", "a refusal that is not a sentence gets the page's own");
    assert.equal(agentErrorWords({ token: "__proto__" }), agentErrorWords({ token: "never_heard_of_it" }), "a name every object has is not mistaken for a known answer");
    assert.equal(agentErrorWords({ token: "constructor" }), agentErrorWords({}));
    assert.match(agentErrorWords(new TypeError("Failed to fetch")), /^You seem to be offline/);
    assert.match(agentErrorWords({ code: "PGRST301", message: "JWT expired" }), /^Your sign-in ran out\. Reload the page and sign in again\.$/);
    assert.match(agentErrorWords({ code: "PGRST202", message: "x" }), /isn't switched on yet/);
  });
  it("for a page that would not load", () => {
    for (const err of RAW) {
      const words = agentLoadErrorWords(err);
      assert.match(words, /^[A-Z][\s\S]{20,220}\.$/);
      assert.equal(INTERNAL.test(words), false, words.slice(0, 120));
    }
    assert.equal(agentLoadErrorWords(new TypeError("Failed to fetch")), "Couldn't load your agent settings. Check your connection and try again.");
  });
  it("the service hands the page only a token and a sentence, and logs neither an answer nor an argument", () => {
    const SERVICE = stripComments(read("services/teamAgentService.js"));
    const logs = SERVICE.match(/console\.[a-z]+\([^;]*\);/g) ?? [];
    assert.ok(logs.length >= 2);
    assert.deepEqual(logs, [
      'console.error("[agent] request failed:", err?.name || "error");',
      'console.error("[agent] server refused:", result.error.code);',
    ], "the only two log lines: a fixed label, then an error's kind or its code, never its words");
    assert.equal(/throw (err|result\.error)\b/.test(SERVICE), false, "a raw error never leaves the service");
    assert.equal((SERVICE.match(/supabase\.rpc\("([a-z_]+)"/g) ?? []).every((c) => /"team_agent_(keys_mine|key_create|key_revoke|keys_overview|guide|my_activity)"/.test(c)), true);
    assert.equal(/\.from\(|\.storage|functions\.invoke|fetch\(/.test(SERVICE), false, "the service only calls the six functions");
  });
});

describe("#3802 TG-7: the owner's list is built only from what it is meant to show", () => {
  it("extra fields in the answer, a key among them, never reach a row", () => {
    const rows = overviewRows(
      {
        people: [
          { email: "a@example.test", display_name: "A", role: "growth", agent: "claude", connected: true, key_id: "k1", key_prefix: "mgla_c_AAAAAAA", key: madeUpKey("c", 3), key_hash: "f".repeat(64), last_used_at: "2026-10-14T11:00:00Z", last_used_client: "<b>x</b>" },
          { email: "a@example.test", display_name: "A", role: "growth", agent: "codex", connected: false, key_id: null },
          { email: "b@example.test", display_name: "", role: "partner", agent: "claude", connected: true, key_id: null },
          { email: "b@example.test", role: "partner", agent: "codex", connected: "yes", key_id: "k2", last_used_at: null },
          { email: 7, agent: "claude", connected: true, key_id: "k3" },
          null,
          "junk",
        ],
      },
      NOW
    );
    assert.deepEqual(rows, [
      { email: "a@example.test", name: "A", role: "growth", agents: [{ agent: "claude", label: "Claude", keyId: "k1", line: "used 1 hour ago" }] },
      { email: "b@example.test", name: "b@example.test", role: "partner", agents: [{ agent: "codex", label: "Codex", keyId: "k2", line: "not used yet" }] },
    ]);
    const flat = JSON.stringify(rows);
    assert.equal(/mgla_|ffffffff|key_hash|key_prefix|<b>/.test(flat), false);
    for (const junk of [null, undefined, {}, { people: null }, { people: "x" }, { people: {} }, "x", 7]) assert.deepEqual(overviewRows(junk, NOW), []);
  });
  it("only the owner is asked for the list, and a teammate's page never draws it", () => {
    const HOOK = stripComments(read("hooks/useAgentKeys.js"));
    assert.match(HOOK, /const isOwner = access\?\.role === "owner";/);
    assert.match(HOOK, /isOwner \? agent\.fetchKeysOverview\(\)\.catch\(\(\) => null\) : Promise\.resolve\(null\)/);
    const PAGE = stripComments(read("pages/AgentPage.jsx"));
    assert.match(PAGE, /\{isOwner && \(\s*<SectionCard title="Agents on the team"/);
    assert.equal((PAGE.match(/<AgentTeamList\b/g) ?? []).length, 1, "drawn once");
    const at = PAGE.indexOf("<AgentTeamList");
    assert.ok(at > PAGE.indexOf("{isOwner && ("), "and only inside the owner's section");
    assert.equal(/<AgentTeamList|fetchKeysOverview|team_agent_keys_overview/.test(stripComments(read("components/agent/AgentKeyCard.jsx")) + stripComments(read("components/agent/AgentConnectSteps.jsx"))), false);
  });
});

describe("#3802 TG-8: where the key on screen goes", () => {
  const PAGE = stripComments(read("pages/AgentPage.jsx"));
  const CARD = stripComments(read("components/agent/AgentKeyCard.jsx"));
  const STEPS = stripComments(read("components/agent/AgentConnectSteps.jsx"));
  const COPY = stripComments(read("components/agent/CopyBlock.jsx"));
  const HOOK = stripComments(read("hooks/useAgentKeys.js"));
  const LIB = stripComments(read("lib/agentConnect.js"));
  it("the page keeps it in one piece of state and hands it to exactly two places", () => {
    const uses = PAGE.split("\n").filter((l) => /\bfresh\b/.test(l)).map((l) => l.trim());
    assert.deepEqual(
      uses,
      [
        "const [fresh, setFresh] = useState({});",
        "freshKey={fresh[a.id] || null}",
        "freshKey={fresh[tab] || null}",
      ],
      "the key is read in two places: the key card and the lines"
    );
    const made = PAGE.match(/\bmade\b[^\n]*/g) ?? [];
    for (const m of made) assert.equal(/console|addToast|setProblem|localStorage|sessionStorage|location|navigator\.|fetch\(|JSON\.stringify/.test(m) && /made\.key|made\)/.test(m), false, m);
    assert.match(PAGE, /setFresh\(\(f\) => \(\{ \.\.\.f, \[agentId\]: made\.key \}\)\);/);
    assert.equal((PAGE.match(/made\??\.key\b/g) ?? []).length, 3, "checked, checked again, stored: nothing else reads it");
  });
  it("nothing in the page, its parts, its hook or its decisions writes to storage, an address, a cookie, a title or a log with it", () => {
    for (const [name, src] of [["page", PAGE], ["card", CARD], ["steps", STEPS], ["copy", COPY], ["hook", HOOK], ["lib", LIB]]) {
      assert.equal(/localStorage|sessionStorage|indexedDB|document\.cookie|document\.title|history\.(push|replace)State|location\.(hash|href|search)\s*=|window\.open|postMessage|sendBeacon|new Image|BroadcastChannel/.test(src), false, name);
      for (const log of src.match(/console\.[a-z]+\([^;]*\);/g) ?? []) {
        assert.equal(/freshKey|fresh\b|\bkey\b|made|text\b|lines|\berr\)\s*;|err\.message/.test(log), false, `${name}: ${log}`);
      }
      assert.equal(/title=\{[^}]*(freshKey|fresh\[)/.test(src), false, name);
      assert.equal(/aria-label=\{[^}]*(freshKey|fresh\[)/.test(src), false, name);
      assert.equal(/href=\{[^}]*(freshKey|fresh\[|text)\b/.test(src), false, name);
    }
  });
  it("the copy button copies the text on screen and nothing else, and the key box is that text", () => {
    assert.match(COPY, /await navigator\.clipboard\.writeText\(text\);/);
    assert.equal((COPY.match(/clipboard/g) ?? []).length, 1);
    assert.match(COPY, /\{text\}\s*<\/pre>/);
    assert.match(CARD, /<CopyBlock\s+id=\{`agent-fresh-key-\$\{agent\.id\}`\}\s+text=\{freshKey\}\s+copyLabel="Copy key"\s+note="Shown once\. Copy it now: you will not see this key again\."/);
    assert.match(CARD, /\{freshKey \? \(/);
    assert.match(STEPS, /connectLines\(\{ agent: agentId, os, endpoint, key: freshKey \}\)/);
    assert.equal((STEPS.match(/freshKey/g) ?? []).length, 3, "taken in, given to the line builder, and asked 'is it on screen?'");
  });
  it("Done, a disconnect, and leaving the page each drop it", () => {
    assert.match(PAGE, /const done = useCallback\(\(agentId\) => \{\s*setFresh\(\(f\) => \(\{ \.\.\.f, \[agentId\]: null \}\)\);\s*\}, \[\]\);/);
    assert.match(PAGE, /await revokeKey\(keyId\);\s*if \(!mountedRef\.current\) return;\s*setFresh\(\(f\) => \(\{ \.\.\.f, \[agentId\]: null \}\)\);/);
    assert.equal(/useState\(\(\) =>[^)]*fresh|useRef\([^)]*fresh|createContext|zustand|create\(\(set/.test(PAGE + HOOK), false, "it lives in this page's own state, which is gone with the page");
  });
});

describe("#3802 TG-9: the workflow runs this suite and its siblings", () => {
  // The workflow is found by what it runs, never by its file name.
  const dir = path.join(REPO, ".github", "workflows");
  const WORKFLOW = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).find((t) => t.includes("run: node --test src/__tests__/issue3802_wave4_agent.implementor.happy.test.js")) ?? "";
  it("a step runs this file, in the job that runs the other My agent suite", () => {
    assert.ok(WORKFLOW.length > 0, "the workflow that runs the My agent suite was found");
    assert.match(WORKFLOW, /\n\s+working-directory: mingla-admin\n\s+run: node --test src\/__tests__\/agent_connector_issue3802\.tester\.adversarial\.test\.js\n/);
    assert.ok(fs.existsSync(path.join(HERE, "agent_connector_issue3802.tester.adversarial.test.js")));
  });
  it("the tester's database suite and connector suite are run where the implementor's are", () => {
    const sql = "supabase/migrations/__tests__/issue_3802_wave4_agent_keys_gateway.tester.adversarial.pg17.test.sql";
    const ts = "supabase/functions/team-agent/__tests__/hostile.issue3802.tester.adversarial.test.ts";
    assert.ok(fs.existsSync(path.join(REPO, sql)) && fs.existsSync(path.join(REPO, ts)));
    const sqlAt = WORKFLOW.indexOf(`-f ${sql}`);
    const implAt = WORKFLOW.indexOf("-f supabase/migrations/__tests__/issue_3802_wave4_agent_keys_gateway.implementor.happy.pg17.test.sql");
    assert.ok(implAt > 0 && sqlAt > implAt, "the tester's database suite runs after the implementor's, on the same schema");
    assert.match(WORKFLOW.slice(sqlAt - 120, sqlAt), /psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \\\n\s+$/);
    const tsAt = WORKFLOW.indexOf(ts);
    const implTs = WORKFLOW.indexOf("supabase/functions/team-agent/__tests__/spoofing.issue3802.test.ts");
    assert.ok(implTs > 0 && tsAt > implTs);
    const step = WORKFLOW.slice(WORKFLOW.lastIndexOf("\n      - name:", tsAt), tsAt);
    assert.match(step, /node --experimental-strip-types --test --test-concurrency=1/);
    assert.match(step, /PGUSER: supabase_admin/);
  });
});

// ---------------------------------------------------------------------------
// Retest additions (after the rework).
//
//   TG-10  after a create that got no answer, the page says which of three
//          things is true, from what the server holds now, for every
//          combination of "key before" and "key after"
//   TG-11  a key on screen stays only while the server lists it as active,
//          whatever the list looks like
//   TG-12  the zone a key is made in: only a plain zone name is ever sent,
//          and the card says in words which date the agent will use
//   TG-13  under every line the page says where the key ends up and how to
//          take it out; lines not run on that kind of computer say so
//   TG-14  the page's checks on a shown key start and stop with the key
// ---------------------------------------------------------------------------
const more = await import("../lib/agentConnect.js");

describe("#3802 TG-10: the truth after a create that got no answer", () => {
  const { createOutcome } = more;
  const WORDS = "You seem to be offline, so that didn't go through. Check your connection and try again.";
  const IDS = [null, "", undefined, "key-a", "key-b"];
  it("for every key before and every key after, exactly one of three things is said", () => {
    let unseen = 0, unchanged = 0, unknown = 0;
    for (const before of IDS) {
      for (const after of [...IDS, "key-c"]) {
        for (const label of ["Claude", "Codex"]) {
          const o = createOutcome({ before, after, label, words: WORDS });
          const all = `${o.problem} ${o.notice} ${o.toastTitle} ${o.toastWords}`;
          assert.equal(/undefined|null|NaN|\[object|key-[abc]/.test(all), false, all);
          assert.equal(!!o.problem !== !!o.notice, true, "one sentence on the card, never two, never none");
          assert.match(o.problem || o.notice, /^[A-Z].+\.$/);
          assert.ok(all.includes(label));
          const had = !!before;
          if (after === undefined) {
            unknown += 1;
            assert.equal(o.kind, "unknown");
            assert.match(o.problem, /^We couldn't tell whether/);
            assert.equal(/No key was created/.test(all), false, "it never says nothing happened when it does not know");
            assert.equal(/was replaced, but|was created, but/.test(all), false, "nor that something did");
            assert.equal(o.replaceAgain, false);
            if (had) assert.match(o.problem, /If it was, the key you have no longer works\./);
          } else if ((after || null) !== (before || null)) {
            unseen += 1;
            assert.equal(o.kind, "unseen");
            assert.equal(o.replaceAgain, true, "the button offers the way out");
            assert.equal(/No key was created/.test(all), false, "a key WAS made: the page must not say otherwise");
            if (had) assert.match(o.notice, /was replaced, but the new key couldn't be shown\. The old key no longer works\./);
            else assert.match(o.notice, /key was created, but it couldn't be shown\./);
            assert.equal(o.toastVariant, "warning");
          } else {
            unchanged += 1;
            assert.equal(o.kind, "unchanged");
            assert.match(o.problem, /^No key was created/);
            assert.equal(o.problem.includes("the key you have still works"), had);
            assert.ok(o.problem.endsWith(WORDS));
            assert.equal(o.replaceAgain, false);
          }
        }
      }
    }
    assert.ok(unseen > 20 && unchanged > 10 && unknown === 10, `${unseen}/${unchanged}/${unknown}`);
  });
  it("the page reads the keys again before it says anything, waits a fixed time for a create, and sends it once", () => {
    const PAGE = stripComments(read("pages/AgentPage.jsx"));
    const at = PAGE.indexOf("} catch (err) {", PAGE.indexOf("const create = useCallback("));
    const until = PAGE.indexOf("} finally {", at);
    const failed = PAGE.slice(at, until);
    assert.match(failed, /const now = await refetch\(\{ quiet: true \}\);/);
    assert.ok(failed.indexOf("await refetch(") < failed.indexOf("setProblem("), "read first, then speak");
    assert.match(failed, /const after = Array\.isArray\(now\) \? activeKey\(now, agentId\)\?\.key_id \|\| null : undefined;/);
    assert.match(failed, /createOutcome\(\{ before, after, label, words \}\)/);
    assert.equal(/No key was created/.test(failed), false, "the page itself never writes that sentence; the decision does");
    const body = PAGE.slice(PAGE.indexOf("const create = useCallback("), until);
    assert.equal((body.match(/createKey\(/g) ?? []).length, 1, "one request per press: the page never sends a create again by itself");
    assert.equal(/for \(|while \(|retry|attempt/i.test(body), false);
    assert.match(PAGE, /const CREATE_WAIT_MS = 20_000;/);
    assert.match(body, /Promise\.race\(\[\s*createKey\(agentId, browserTimeZone\(\)\),/);
    assert.match(body, /const before = activeKey\(keysRef\.current, agentId\)\?\.key_id \|\| null;/);
    assert.match(PAGE, /\} finally \{\s*clearTimeout\(timer\);/);
  });
});

describe("#3802 TG-11: a key on screen stays only while it is listed as active", () => {
  const { shownKeyVerdict } = more;
  it("for every shape of list and every state of the key", () => {
    const live = { key_id: "k1", agent: "claude", revoked_at: null };
    const dead = { key_id: "k1", agent: "claude", revoked_at: "2026-10-13T00:00:00Z" };
    const other = { key_id: "k2", agent: "claude", revoked_at: null };
    assert.equal(shownKeyVerdict([live], { keyId: "k1", listed: false }), "listed");
    assert.equal(shownKeyVerdict([live], { keyId: "k1", listed: true }), "keep");
    assert.equal(shownKeyVerdict([dead], { keyId: "k1", listed: true }), "hide");
    assert.equal(shownKeyVerdict([dead], { keyId: "k1", listed: false }), "hide", "ended before it was ever listed: still hidden");
    assert.equal(shownKeyVerdict([dead, other], { keyId: "k1", listed: true }), "hide", "replaced: the new key does not keep the old one on screen");
    assert.equal(shownKeyVerdict([other], { keyId: "k1", listed: true }), "hide", "gone from the list after having been listed");
    assert.equal(shownKeyVerdict([other], { keyId: "k1", listed: false }), "wait", "not listed yet: the read after the create has not landed");
    assert.equal(shownKeyVerdict([], { keyId: "k1", listed: false }), "wait");
    for (const junk of [null, undefined, "x", 7, {}, [null, "x", 7, {}]]) {
      assert.equal(shownKeyVerdict(junk, { keyId: "k1", listed: true }), "hide", `a list that does not name it cannot keep it: ${JSON.stringify(junk)}`);
      assert.equal(shownKeyVerdict(junk, { keyId: "k1", listed: false }), "wait");
    }
    for (const nothing of [null, undefined, {}, { keyId: "" }, { keyId: null, listed: true }]) {
      assert.equal(shownKeyVerdict([dead], nothing), "keep", "no key on screen, nothing to hide");
    }
    // A key of the same person for the OTHER agent never keeps this one.
    assert.equal(shownKeyVerdict([{ key_id: "k9", agent: "codex", revoked_at: null }], { keyId: "k1", listed: true }), "hide");
  });
  it("hiding drops the key from the page's memory and says why", () => {
    const PAGE = stripComments(read("pages/AgentPage.jsx"));
    assert.match(PAGE, /\} else if \(verdict === "hide"\) \{\s*setFresh\(\(f\) => \(\{ \.\.\.f, \[a\.id\]: null \}\)\);\s*setShownIds\(\(m\) => \(\{ \.\.\.m, \[a\.id\]: null \}\)\);\s*setNotice\(\(n\) => \(\{ \.\.\.n, \[a\.id\]: REPLACED_ELSEWHERE_WORDS \}\)\);/);
    assert.equal(more.REPLACED_ELSEWHERE_WORDS, "This key was replaced or disconnected somewhere else, so it no longer works and is hidden here.");
    assert.match(PAGE, /setShownIds\(\(m\) => \(\{ \.\.\.m, \[agentId\]: \{ keyId: made\.key_id, listed: false \} \}\)\);/, "what is remembered is the key's id, never the key");
    assert.equal(/setShownIds\([^)]*made\.key\b(?!_id)/.test(PAGE), false);
  });
});

describe("#3802 TG-12: the zone a key is made in", () => {
  const { browserTimeZone, zoneWords } = more;
  it("only a plain zone name is ever sent; anything else is sent as nothing", () => {
    const real = Intl.DateTimeFormat;
    const withZone = (zone, run) => {
      Intl.DateTimeFormat = function () { return { resolvedOptions: () => ({ timeZone: zone }) }; };
      try { return run(); } finally { Intl.DateTimeFormat = real; }
    };
    for (const ok of ["America/New_York", "Africa/Lagos", "UTC", "Etc/GMT+12", "America/Argentina/Buenos_Aires", "Asia/Ho_Chi_Minh"]) {
      assert.equal(withZone(ok, browserTimeZone), ok);
    }
    for (const bad of ["", " ", "America/New York", "UTC'; drop table x;--", "<b>", "A".repeat(65), "Europe/Paris\n", "../../etc", null, undefined, 7, {}, ["UTC"]]) {
      assert.equal(withZone(bad, browserTimeZone), null, JSON.stringify(bad));
    }
    Intl.DateTimeFormat = function () { throw new Error("no zones here"); };
    try { assert.equal(browserTimeZone(), null); } finally { Intl.DateTimeFormat = real; }
    assert.equal(typeof browserTimeZone(), "string", "this machine has a zone");
    const SERVICE = stripComments(read("services/teamAgentService.js"));
    assert.match(SERVICE, /supabase\.rpc\("team_agent_key_create", \{ p_agent: agent, p_time_zone: timeZone \}\)/);
  });
  it("the card says in words which date the agent will use, whatever the key row holds", () => {
    assert.equal(zoneWords({ time_zone: "America/New_York" }), `Your agent's "today" follows America/New York, the time zone this key was made in.`);
    for (const none of [{}, { time_zone: null }, { time_zone: "" }, { time_zone: 7 }, { time_zone: {} }]) {
      assert.equal(zoneWords(none), `No time zone is recorded for this key, so your agent's "today" is the date in UTC. Replace the key from this browser to set it.`);
    }
    assert.equal(zoneWords(null), "");
    assert.equal(zoneWords(undefined), "");
    const CARD = stripComments(read("components/agent/AgentKeyCard.jsx"));
    assert.equal((CARD.match(/\{zoneWords\(activeKey\)\}/g) ?? []).length, 2, "shown while the key is on screen and after");
  });
});

describe("#3802 TG-13: where a key ends up, and lines that were not run", () => {
  it("every line, for every agent and computer, says where the key ends up or that it holds none, and how to take it out", () => {
    for (const agent of AGENTS) {
      for (const osId of ["mac", "windows"]) {
        const lines = connectLines({ agent: agent.id, os: osId, endpoint: ENDPOINT, key: madeUpKey(agent.letter, 7) });
        for (const l of [...lines.steps, lines.simpler]) {
          const where = `${agent.id}/${osId}/${l.id}`;
          assert.equal(typeof l.where, "string", where);
          assert.match(l.where, /^[A-Z].+/, where);
          assert.equal(l.where.includes(madeUpKey(agent.letter, 7).slice(7)), false, where);
          if (l.hasKey) {
            assert.match(l.where, /The key (ends up|is saved) (in|as) /, where);
            assert.match(l.where, /readable by any program you run/, `${where}: it does not pretend the key is out of an agent's reach`);
            assert.match(l.where, /To remove it/, where);
          } else {
            assert.match(l.where, /hold(s)? no key/, where);
            assert.match(l.where, /To remove Mingla from/, where);
          }
          assert.equal(/not in a file an agent can read back/.test(`${l.label} ${l.where}`), false, where);
        }
        assert.equal(lines.untested, osId === "windows", `${agent.id}/${osId}`);
        assert.equal(lines.notes.some((n) => /were not run on Windows here/.test(n)), osId === "windows");
      }
    }
    assert.match(connectLines({ agent: "claude", os: "mac", endpoint: ENDPOINT, key: null }).steps[0].where, /~\/\.zshrc/);
    assert.match(connectLines({ agent: "claude", os: "windows", endpoint: ENDPOINT, key: null }).steps[0].where, /reg delete HKCU\\Environment \/v MINGLA_CLAUDE_KEY \/f$/);
    assert.match(connectLines({ agent: "codex", os: "windows", endpoint: ENDPOINT, key: null }).steps[0].where, /MINGLA_CODEX_KEY \/f$/);
    assert.match(connectLines({ agent: "claude", os: "mac", endpoint: ENDPOINT, key: null }).simpler.where, /claude mcp remove mingla --scope user$/);
  });
  it("the page shows that text under each line and a warning above lines that were not run", () => {
    const STEPS = stripComments(read("components/agent/AgentConnectSteps.jsx"));
    assert.match(STEPS, /note=\{line\.where\}/);
    assert.match(STEPS, /note=\{lines\.simpler\.where\}/);
    assert.match(STEPS, /\{lines\.untested && \(\s*<AlertCard variant="warning" title="Not tested on Windows">/);
    assert.match(STEPS, /We have not run these lines on a Windows computer\./);
    assert.equal((STEPS.match(/min-h-11/g) ?? []).length >= 2, true, "tabs and disclosures are full-height targets");
  });
});

describe("#3802 TG-14: the checks on a shown key start and stop with the key", () => {
  const PAGE = stripComments(read("pages/AgentPage.jsx"));
  it("they run only while a key is on screen, read and send nothing but the ordinary list, and are cleared", () => {
    assert.match(PAGE, /const SHOWN_KEY_REFRESH_MS = 5_000;/);
    assert.match(PAGE, /const showingKey = AGENTS\.some\(\(a\) => !!shownIds\[a\.id\]\);/);
    const at = PAGE.indexOf("if (!showingKey) return undefined;");
    assert.ok(at > 0);
    const effect = PAGE.slice(at, PAGE.indexOf("}, [showingKey, refetch]);", at));
    assert.match(effect, /const timer = setInterval\(\(\) => \{\s*if \(navigator\.onLine === false\) return;\s*refetch\(\{ quiet: true \}\);\s*\}, SHOWN_KEY_REFRESH_MS\);\s*return \(\) => clearInterval\(timer\);/);
    assert.equal(/fresh|made|key\b/.test(effect.replace(/showingKey/g, "")), false, "the check carries no key");
    assert.equal((PAGE.match(/setInterval\(/g) ?? []).length, 1);
    assert.match(PAGE, /const doneAndForget = useCallback\(\s*\(agentId\) => \{\s*done\(agentId\);\s*setShownIds\(\(m\) => \(\{ \.\.\.m, \[agentId\]: null \}\)\);/);
    assert.match(PAGE, /onDone=\{doneAndForget\}/);
  });
  it("nothing passes between tabs: no channel, no storage event, no shared worker", () => {
    for (const f of ["pages/AgentPage.jsx", "hooks/useAgentKeys.js", "lib/agentConnect.js", "components/agent/AgentKeyCard.jsx", "components/agent/AgentConnectSteps.jsx", "components/agent/AgentTeamList.jsx", "components/agent/CopyBlock.jsx", "services/teamAgentService.js"]) {
      assert.equal(/BroadcastChannel|SharedWorker|addEventListener\(\s*["']storage["']|localStorage|sessionStorage|postMessage|indexedDB/.test(stripComments(read(f))), false, f);
    }
  });
});
