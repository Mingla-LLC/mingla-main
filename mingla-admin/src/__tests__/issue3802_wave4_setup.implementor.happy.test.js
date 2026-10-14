// Issue #3802 (Wave 4, second part) — one-message setup on the My agent page.
//
//   S-1  the four setup messages: one command on one line, the code once, no
//        key, the words a person and an agent need, and nothing of the other
//        agent
//   S-2  the messages run in a real shell with stand-ins for curl and claude:
//        one line printed, the key only in the agent's own settings, other
//        entries kept, a second run replaces, a refusal writes nothing
//   S-3  no input makes setupMessage or advancedLines put a key, or anything
//        that is not a code, into a command
//   S-4  the lines for adding the key by hand never contain it; line 1, run
//        in a real shell with the key on standard input, writes one line
//   S-5  every state of the setup card has words and a next step
//   S-6  when a message is used, when it has run out, and when to keep waiting
//   S-7  the repeated check: only while visible and online, with an end
//   S-8  source contracts: where the message and its code may and may not go
//
// Run: node --test src/__tests__/issue3802_wave4_setup.implementor.happy.test.js
// (from mingla-admin). Hermetic: no network, no browser. S-2 and S-4 run a
// shell with a throwaway HOME and remove it. Codes and keys are made up here.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  AGENTS,
  AGENT_ABILITIES,
  COPY_WAIT_MS,
  KEY_HIDDEN_AFTER_WORDS,
  NOT_WORKING_CHECKS,
  SETUP_FIRST_USE_WATCH_MS,
  SETUP_GRACE_MS,
  SETUP_UNUSED_WARN_MS,
  SHOWN_KEY_MAX_MS,
  advancedLines,
  agentEndpoint,
  agentErrorWords,
  clockWords,
  createWatch,
  isSetupCode,
  keysToHide,
  minutesLeftWords,
  pendingSetup,
  setupCardView,
  setupCommand,
  setupMessage,
  setupVerdict,
} from "../lib/agentConnect.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ENDPOINT = agentEndpoint("https://example.supabase.co");
const tail = (ch) => ch.repeat(43);
const CODE = { claude: `mgls_c_${tail("S")}`, codex: `mgls_x_${tail("T")}` };
const KEY = { claude: `mgla_c_${"k-_K9".repeat(8)}abc`, codex: `mgla_x_${"q_-Z3".repeat(8)}xyz` };
const KEY_SHAPED = /mgla_[cx]_[A-Za-z0-9_-]{43}/;
const REFUSAL =
  "This setup code cannot be used. It works once and lasts 10 minutes. Open My agent in Mingla Admin and copy a new setup message.";
const COMBOS = AGENTS.flatMap((a) => ["mac", "windows"].map((osId) => ({ agent: a.id, os: osId })));
const SHELLS = ["bash", "zsh"].filter((sh) => spawnSync(sh, ["-c", "exit 0"]).status === 0);

describe("#3802 S-1: the setup messages", () => {
  it("each message holds one command on one line, with the code exactly once and no key", () => {
    for (const c of COMBOS) {
      const message = setupMessage({ ...c, endpoint: ENDPOINT, code: CODE[c.agent] });
      const command = setupCommand({ ...c, endpoint: ENDPOINT, code: CODE[c.agent] });
      assert.equal(typeof message, "string", `${c.agent}/${c.os}`);
      assert.ok(command.length > 100 && !command.includes("\n"), "the command is one line");
      assert.equal(message.split("\n").filter((l) => l === command).length, 1, "the command is one whole line of the message");
      assert.equal(message.split(CODE[c.agent]).length - 1, 1, "the code appears exactly once");
      assert.equal(KEY_SHAPED.test(message), false, "nothing key-shaped is in the message");
      assert.equal(/mgls_[cx]_[A-Za-z0-9_-]{43}/g.exec(message)[0], CODE[c.agent]);
      // The address appears only as the connector's own address.
      for (const m of message.matchAll(/https?:\/\/[^\s"'\\)]+/g)) {
        assert.ok(m[0] === ENDPOINT || m[0] === `${ENDPOINT}/setup`, m[0]);
      }
      assert.ok(message.includes(`${ENDPOINT}/setup`));
    }
  });
  it("each message says what an agent and a person need to hear", () => {
    for (const c of COMBOS) {
      const message = setupMessage({ ...c, endpoint: ENDPOINT, code: CODE[c.agent] });
      const where = `${c.agent}/${c.os}`;
      assert.match(message, /^Please connect yourself to Mingla Admin, my team's pipeline tool\. I am asking you to do this on my own computer\.\n/, where);
      assert.match(message, /do not print, read back or summarise anything it handles/, where);
      assert.match(message, /reopen/i, where);
      assert.match(message, /The code works once and expires 10 minutes after I copied it\./, where);
      assert.match(message, /run nothing and tell me/, where);
      assert.match(message, /Do not retry: the code is spent\./, where);
      assert.match(message, /If you would rather not run it, say so, and I will paste the command into the Terminal app myself\.$/, where);
      assert.match(message, /it is not shown on screen and is not written to shell history/, where);
      assert.match(message, /What is on my plate in Mingla\?/, where);
    }
    const claude = setupMessage({ agent: "claude", os: "mac", endpoint: ENDPOINT, code: CODE.claude });
    assert.match(claude, /If you are Cowork, Claude in a browser or on a phone, or you run in a cloud or sandboxed session, run nothing/);
    assert.match(claude, /Do not run "claude mcp get mingla" and do not open ~\/\.claude\.json to check: both show the key\. "claude mcp list" is safe\./);
    assert.match(claude, /A session that is already open does not see a new connector\./);
    const codex = setupMessage({ agent: "codex", os: "mac", endpoint: ENDPOINT, code: CODE.codex });
    assert.match(codex, /It needs network access and writes one file outside this project \(~\/\.codex\/config\.toml\), so ask me to approve it/);
    assert.match(codex, /Do not open or print ~\/\.codex\/config\.toml to check: it holds the key\./);
    assert.match(codex, /Makes that file readable by me only/);
  });
  it("a message for one agent never carries the other agent's letter or file", () => {
    for (const osId of ["mac", "windows"]) {
      const claude = setupMessage({ agent: "claude", os: osId, endpoint: ENDPOINT, code: CODE.claude });
      const codex = setupMessage({ agent: "codex", os: osId, endpoint: ENDPOINT, code: CODE.codex });
      assert.equal(/mgla_x_|mgls_x_|\.codex|Codex/.test(claude), false, `claude/${osId}`);
      assert.equal(/mgla_c_|mgls_c_|\.claude\.json|claude mcp|Claude/.test(codex), false, `codex/${osId}`);
    }
  });
  it("the Windows messages are PowerShell, name the Windows file, and point Git Bash users at the other message", () => {
    const claude = setupMessage({ agent: "claude", os: "windows", endpoint: ENDPOINT, code: CODE.claude });
    assert.match(claude, /Run this one command in PowerShell exactly as written/);
    assert.match(claude, /If your shell is Git Bash \(Claude Code's default on Windows\), use the macOS or Linux message instead: it works there\./);
    assert.match(claude, /curl\.exe -sS -X POST -H "Authorization: Bearer mgls_c_/);
    assert.match(claude, /ConvertTo-Json -Compress/);
    // The quoting of the JSON argument follows the PowerShell version in use.
    assert.match(claude, /if \(\$PSVersionTable\.PSVersion -lt \[version\]'7\.3' -or \$PSNativeCommandArgumentPassing -eq 'Legacy'\) \{ \$j = \$j -replace '"', '\\"' \}/);
    const codex = setupMessage({ agent: "codex", os: "windows", endpoint: ENDPOINT, code: CODE.codex });
    assert.match(codex, /%USERPROFILE%\\\.codex\\config\.toml/);
    assert.equal(codex.includes("~/.codex"), false);
    assert.match(codex, /\[IO\.File\]::WriteAllLines\(\$f, \$out\)/);
    // The page says the Windows message was not run on Windows.
    const PAGE = read("pages/AgentPage.jsx");
    assert.match(PAGE, /\{os === "windows" && \(\s*<AlertCard variant="warning" title="Not tested on Windows"/);
    for (const c of ["claude", "codex"]) assert.equal(advancedLines({ agent: c, os: "windows", endpoint: ENDPOINT }).untested, true);
  });
});

// Stand-ins for `curl` (answers the key, or the refusal sentence) and for
// `claude` (keeps a settings file the way the real one does: `remove` drops
// an entry, `add-json` refuses a name that is already there).
function standIns(dir, answer) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(dir, "answer.txt"), answer);
  fs.writeFileSync(
    path.join(bin, "curl"),
    `#!/bin/sh\nprintf '%s\\n' "$@" >> "${dir}/curl-args.txt"\ncat "${dir}/answer.txt"\n`,
    { mode: 0o755 }
  );
  fs.writeFileSync(
    path.join(bin, "claude"),
    `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const file = path.join(process.env.HOME, ".claude.json");
const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
cfg.mcpServers = cfg.mcpServers || {};
const a = process.argv.slice(2);
fs.appendFileSync(path.join(process.env.HOME, "claude-calls.txt"), a.slice(0, 2).join(" ") + "\\n");
if (a[0] === "mcp" && a[1] === "add-json" && fs.existsSync(path.join(process.env.HOME, "fail-add"))) { console.error("error: could not add server"); process.exit(1); }
if (a[0] === "mcp" && a[1] === "remove") {
  const name = a[2];
  if (cfg.mcpServers[name]) { delete cfg.mcpServers[name]; console.log("Removed MCP server " + name); }
  else { console.error("No MCP server found with name: " + name); fs.writeFileSync(file, JSON.stringify(cfg)); process.exit(1); }
} else if (a[0] === "mcp" && a[1] === "add-json") {
  const name = a[4], json = a[5];
  if (a[2] !== "-s" || a[3] !== "user" || a.length !== 6) { console.error("unexpected arguments"); process.exit(2); }
  if (cfg.mcpServers[name]) { console.log("MCP server " + name + " already exists in user config"); process.exit(0); }
  cfg.mcpServers[name] = JSON.parse(json);
  console.log("Added http MCP server " + name + " to user config");
} else { console.error("unexpected command"); process.exit(2); }
fs.writeFileSync(file, JSON.stringify(cfg));
`,
    { mode: 0o755 }
  );
  return bin;
}
const run = (shell, home, bin, command) =>
  spawnSync(shell, ["-c", command], { env: { HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8" });

describe("#3802 S-2: the macOS and Linux messages, run in a real shell", () => {
  it("at least one of bash and zsh is here to run them", () => {
    assert.ok(SHELLS.length >= 1, "bash or zsh is needed for this suite");
  });
  it("Claude Code: prints one line, stores the key only in Claude Code's settings, keeps other entries, and a second run replaces", () => {
    for (const shell of SHELLS) {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "issue3802-setup-"));
      try {
        const bin = standIns(home, `${KEY.claude}\n`);
        fs.writeFileSync(
          path.join(home, ".claude.json"),
          JSON.stringify({ theme: "dark", mcpServers: { other: { type: "http", url: "https://other.example" }, mingla: { type: "http", url: "https://old.example" } } })
        );
        const command = setupCommand({ agent: "claude", os: "mac", endpoint: ENDPOINT, code: CODE.claude });
        const first = run(shell, home, bin, command);
        assert.equal(first.stdout, "Mingla added to Claude Code.\n", shell);
        assert.equal(first.stderr, "", shell);
        const cfg = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));
        assert.deepEqual(cfg.mcpServers.mingla, { type: "http", url: ENDPOINT, headers: { Authorization: `Bearer ${KEY.claude}` } });
        assert.deepEqual(cfg.mcpServers.other, { type: "http", url: "https://other.example" });
        assert.equal(cfg.theme, "dark");
        // The exchange was asked once, with the code as a bearer, at the setup address.
        const sent = fs.readFileSync(path.join(home, "curl-args.txt"), "utf8").trim().split("\n");
        assert.deepEqual(sent, ["-sS", "-X", "POST", "-H", `Authorization: Bearer ${CODE.claude}`, `${ENDPOINT}/setup`]);
        // The key is in that one file and nowhere else under the home folder.
        const holders = fs.readdirSync(home).filter((f) => fs.statSync(path.join(home, f)).isFile() && fs.readFileSync(path.join(home, f), "utf8").includes(KEY.claude.slice(7)));
        assert.deepEqual(holders.sort(), [".claude.json", "answer.txt"], shell);
        // A second run (a new message) replaces the entry and never doubles it.
        const key2 = `mgla_c_${tail("2")}`;
        fs.writeFileSync(path.join(home, "answer.txt"), `${key2}\n`);
        const second = run(shell, home, bin, command);
        assert.equal(second.stdout, "Mingla added to Claude Code.\n");
        const cfg2 = JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));
        assert.equal(cfg2.mcpServers.mingla.headers.Authorization, `Bearer ${key2}`);
        assert.deepEqual(Object.keys(cfg2.mcpServers).sort(), ["mingla", "other"]);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    }
  });
  it("Claude Code: a refusal prints one line saying so and writes nothing", () => {
    for (const shell of SHELLS) {
      for (const answer of [`${REFUSAL}`, "", "mgla_x_wrong-agent", "<html>error</html>"]) {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "issue3802-setup-"));
        try {
          const bin = standIns(home, answer);
          const before = JSON.stringify({ mcpServers: { other: { type: "http", url: "https://other.example" } } });
          fs.writeFileSync(path.join(home, ".claude.json"), before);
          const out = run(shell, home, bin, setupCommand({ agent: "claude", os: "mac", endpoint: ENDPOINT, code: CODE.claude }));
          assert.equal(out.stdout, `Setup did not work: ${answer}\n`, shell);
          assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8")), JSON.parse(before));
        } finally {
          fs.rmSync(home, { recursive: true, force: true });
        }
      }
    }
  });
  it("Codex: prints one line, rewrites only its own block of config.toml, keeps every other setting, and a second run replaces", () => {
    const existing = [
      'model = "gpt"',
      "",
      "[mcp_servers.mingla]",
      'url = "https://old.example"',
      "",
      "[mcp_servers.mingla.http_headers]",
      'Authorization = "Bearer old"',
      "",
      "[mcp_servers.minglax]",
      'url = "https://x.example"',
      "",
      "[mcp_servers.other]",
      'command = "npx"',
      "",
      "[profiles.a]",
      'model = "o"',
      "",
    ].join("\n");
    for (const shell of SHELLS) {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "issue3802-setup-"));
      try {
        const bin = standIns(home, `${KEY.codex}\n`);
        fs.mkdirSync(path.join(home, ".codex"));
        const file = path.join(home, ".codex", "config.toml");
        fs.writeFileSync(file, existing);
        const command = setupCommand({ agent: "codex", os: "mac", endpoint: ENDPOINT, code: CODE.codex });
        const first = run(shell, home, bin, command);
        assert.equal(first.stdout, "Mingla added to Codex.\n", shell);
        assert.equal(first.stderr, "", shell);
        const toml = fs.readFileSync(file, "utf8");
        assert.equal(
          toml,
          [
            'model = "gpt"',
            "",
            "[mcp_servers.minglax]",
            'url = "https://x.example"',
            "",
            "[mcp_servers.other]",
            'command = "npx"',
            "",
            "[profiles.a]",
            'model = "o"',
            "",
            "[mcp_servers.mingla]",
            `url = "${ENDPOINT}"`,
            `http_headers = { "Authorization" = "Bearer ${KEY.codex}" }`,
            "",
          ].join("\n")
        );
        assert.equal((fs.statSync(file).mode & 0o777).toString(8), "600", "the file is readable by its owner only");
        assert.deepEqual(fs.readdirSync(path.join(home, ".codex")), ["config.toml"], "no working copy is left behind");
        const key2 = `mgla_x_${tail("3")}`;
        fs.writeFileSync(path.join(home, "answer.txt"), `${key2}\n`);
        run(shell, home, bin, command);
        const again = fs.readFileSync(file, "utf8");
        assert.equal(again.split("[mcp_servers.mingla]").length - 1, 1, "one block, never two");
        assert.ok(again.includes(`Bearer ${key2}`) && !again.includes(KEY.codex.slice(7)));
        assert.ok(again.includes("[mcp_servers.minglax]") && again.includes("[profiles.a]"));
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    }
  });
  it("Codex: with no file yet it makes one; a refusal writes nothing", () => {
    for (const shell of SHELLS) {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "issue3802-setup-"));
      try {
        const bin = standIns(home, `${KEY.codex}\n`);
        const command = setupCommand({ agent: "codex", os: "mac", endpoint: ENDPOINT, code: CODE.codex });
        assert.equal(run(shell, home, bin, command).stdout, "Mingla added to Codex.\n");
        assert.equal(
          fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8"),
          `\n[mcp_servers.mingla]\nurl = "${ENDPOINT}"\nhttp_headers = { "Authorization" = "Bearer ${KEY.codex}" }\n`
        );
        const home2 = fs.mkdtempSync(path.join(os.tmpdir(), "issue3802-setup-"));
        try {
          const bin2 = standIns(home2, REFUSAL);
          const out = run(shell, home2, bin2, command);
          assert.equal(out.stdout, `Setup did not work: ${REFUSAL}\n`);
          assert.equal(fs.existsSync(path.join(home2, ".codex")), false, "nothing was written");
        } finally {
          fs.rmSync(home2, { recursive: true, force: true });
        }
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    }
  });
});

// What a server answer that is not a key may look like.
const MARK = "issue3802-ran-something";
const NOT_A_KEY = (letter) => [
  ["text after the prefix that a shell would run", `mgla_${letter}_aaa$(touch ${MARK})`],
  ["backticks", `mgla_${letter}_\`touch ${MARK}\``],
  ["quotes and braces", `mgla_${letter}_x","command":"/bin/sh","args":["-c","touch ${MARK}"],"z":{"a":"b`],
  ["a key and a second line", `mgla_${letter}_${tail("a")}\n[mcp_servers.other]\ncommand = "/bin/sh"`],
  ["a second line that is a key", `not a key\nmgla_${letter}_${tail("a")}`],
  ["a key with one character too many", `mgla_${letter}_${tail("a")}a`],
  ["a key with one character too few", `mgla_${letter}_${"a".repeat(42)}`],
  ["a key with a character outside its alphabet", `mgla_${letter}_${"a".repeat(42)}+`],
  ["a key with a space in front", ` mgla_${letter}_${tail("a")}`],
  ["the other agent's key", `mgla_${letter === "c" ? "x" : "c"}_${tail("a")}`],
  ["printf directives", `mgla_${letter}_%s%n%d \\n \\x41`],
  ["terminal control characters", `not a key \u001b]0;title\u0007 \u001b[2J \r\n $(touch ${MARK}) \`touch ${MARK}\``],
  ["letters outside plain text", "clé refusée ‮ ​ fin"],
  ["300 characters", "x".repeat(300)],
];
/** What the command may print of a server answer: printable plain characters, at most 200. */
const shown = (answer) => answer.replace(/[^\x20-\x7e]/g, "").slice(0, 200);
const SAVE_FAILED = "Mingla made your key but could not save it on this computer. Copy a new setup message from My agent and try again.\n";

describe("#3802 S-2b: what the command does with every answer, and with every settings file", () => {
  const each = (fn) => {
    for (const shell of SHELLS) {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "issue3802-setup-"));
      try {
        fn(shell, home);
      } finally {
        fs.chmodSync(home, 0o700);
        for (const d of [".codex", "dotfiles"]) if (fs.existsSync(path.join(home, d))) fs.chmodSync(path.join(home, d), 0o700);
        fs.rmSync(home, { recursive: true, force: true });
      }
    }
  };
  const calls = (home) => (fs.existsSync(path.join(home, "claude-calls.txt")) ? fs.readFileSync(path.join(home, "claude-calls.txt"), "utf8").trim().split("\n") : []);
  const marked = (home) => fs.existsSync(path.join(home, MARK));
  const runIn = (shell, home, bin, command) =>
    spawnSync(shell, ["-c", command], { cwd: home, env: { HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8" });

  it("Claude Code: an answer that is not exactly a key is never run, never saved, and never costs the earlier entry", () => {
    each((shell, home) => {
      const before = JSON.stringify({ mcpServers: { mingla: { type: "http", url: "https://old.example" } } });
      const command = setupCommand({ agent: "claude", os: "mac", endpoint: ENDPOINT, code: CODE.claude });
      for (const [what, answer] of NOT_A_KEY("c")) {
        const bin = standIns(home, answer);
        fs.writeFileSync(path.join(home, ".claude.json"), before);
        fs.rmSync(path.join(home, "claude-calls.txt"), { force: true });
        const out = runIn(shell, home, bin, command);
        assert.equal(out.stdout, `Setup did not work: ${shown(answer)}\n`, `${shell}: ${what}`);
        assert.equal(out.stderr, "", `${shell}: ${what}`);
        assert.equal(/[^\x20-\x7e\n]/.test(out.stdout), false, `${shell}: ${what}: only plain characters are printed`);
        assert.ok(out.stdout.length <= "Setup did not work: ".length + 201, `${shell}: ${what}: at most 200 characters of the answer`);
        assert.deepEqual(calls(home), [], `${shell}: ${what}: the agent's own command was never called, not even to remove`);
        assert.equal(fs.readFileSync(path.join(home, ".claude.json"), "utf8"), before, `${shell}: ${what}: the earlier entry is as it was`);
        assert.equal(marked(home), false, `${shell}: ${what}: nothing in the answer was run`);
      }
    });
  });
  it("Claude Code: the key is asked for first, and the earlier entry is removed only once a key is in hand", () => {
    each((shell, home) => {
      const bin = standIns(home, `${KEY.claude}\n`);
      fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { mingla: { type: "http", url: "https://old.example" } } }));
      const command = setupCommand({ agent: "claude", os: "mac", endpoint: ENDPOINT, code: CODE.claude });
      assert.ok(command.indexOf("curl -sS") < command.indexOf("claude mcp remove"), "the exchange is written before the removal");
      assert.ok(command.indexOf("grep -Eqx 'mgla_c_[A-Za-z0-9_-]{43}'") < command.indexOf("claude mcp remove"), "and so is the check of what came back");
      assert.equal(runIn(shell, home, bin, command).stdout, "Mingla added to Claude Code.\n", shell);
      assert.deepEqual(calls(home), ["mcp remove", "mcp add-json"], shell);
    });
  });
  it("Claude Code: a key that could not be saved is said in exactly one line; no claude command means nothing is asked", () => {
    each((shell, home) => {
      const bin = standIns(home, `${KEY.claude}\n`);
      fs.writeFileSync(path.join(home, "fail-add"), "");
      const command = setupCommand({ agent: "claude", os: "mac", endpoint: ENDPOINT, code: CODE.claude });
      const out = runIn(shell, home, bin, command);
      assert.equal(out.stdout, SAVE_FAILED, shell);
      assert.equal(out.stderr, "", shell);
      // Without the agent's command the code is not spent.
      fs.rmSync(path.join(bin, "claude"));
      fs.rmSync(path.join(home, "curl-args.txt"), { force: true });
      const none = spawnSync(shell, ["-c", command], { cwd: home, env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });
      if (spawnSync(shell, ["-c", "command -v claude"], { env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` } }).status !== 0) {
        assert.equal(none.stdout, "Setup did not start: the claude command was not found in this shell. Nothing was changed and the setup code was not used.\n", shell);
        assert.equal(fs.existsSync(path.join(home, "curl-args.txt")), false, `${shell}: the setup code was not sent`);
      }
    });
  });
  it("Codex: an answer that is not exactly a key is never run and never written", () => {
    each((shell, home) => {
      const existing = 'model = "gpt"\n\n[mcp_servers.mingla]\nurl = "https://old.example"\n';
      const command = setupCommand({ agent: "codex", os: "mac", endpoint: ENDPOINT, code: CODE.codex });
      fs.mkdirSync(path.join(home, ".codex"));
      const file = path.join(home, ".codex", "config.toml");
      for (const [what, answer] of NOT_A_KEY("x")) {
        const bin = standIns(home, answer);
        fs.writeFileSync(file, existing);
        const out = runIn(shell, home, bin, command);
        assert.equal(out.stdout, `Setup did not work: ${shown(answer)}\n`, `${shell}: ${what}`);
        assert.equal(out.stderr, "", `${shell}: ${what}`);
        assert.equal(fs.readFileSync(file, "utf8"), existing, `${shell}: ${what}: the file is as it was`);
        assert.deepEqual(fs.readdirSync(path.join(home, ".codex")), ["config.toml"], `${shell}: ${what}`);
        assert.equal(marked(home), false, `${shell}: ${what}: nothing in the answer was run`);
      }
    });
  });
  it("Codex: every way an earlier mingla entry can be written is replaced, and everything else is kept", () => {
    const block = (key) => ["", "[mcp_servers.mingla]", `url = "${ENDPOINT}"`, `http_headers = { "Authorization" = "Bearer ${key}" }`, ""];
    const CASES = [
      ["a quoted name", ['a = 1', '[mcp_servers."mingla"]', 'url = "https://old.example"', "[x]", "b = 2"], ["a = 1", "[x]", "b = 2"]],
      ["a name in single quotes", ["[mcp_servers.'mingla']", 'url = "https://old.example"', "[x]", "b = 2"], ["[x]", "b = 2"]],
      ["both parts quoted", ['["mcp_servers"."mingla"]', 'url = "https://old.example"', "[x]", "b = 2"], ["[x]", "b = 2"]],
      ["spaces inside the brackets", ["[ mcp_servers . mingla ]", 'url = "https://old.example"', "[x]", "b = 2"], ["[x]", "b = 2"]],
      ["an indented header", ["  [mcp_servers.mingla]", '  url = "https://old.example"', "[x]", "b = 2"], ["[x]", "b = 2"]],
      ["a header with a comment", ["[mcp_servers.mingla] # mine", 'url = "https://old.example"', "[x]", "b = 2"], ["[x]", "b = 2"]],
      ["its own sub-tables", ["[mcp_servers.mingla]", 'url = "https://old.example"', "[mcp_servers.mingla.env]", 'FOO = "1"', '[mcp_servers."mingla".http_headers]', 'A = "old"', "[x]", "b = 2"], ["[x]", "b = 2"]],
      ["dotted keys at the top", ['mcp_servers.mingla.url = "https://old.example"', 'mcp_servers.mingla.bearer_token_env_var = "OLD"', "a = 1", "[x]", "b = 2"], ["a = 1", "[x]", "b = 2"]],
      ["dotted keys under the servers table", ["[mcp_servers]", 'mingla.url = "https://old.example"', 'other.command = "npx"', "[x]", "b = 2"], ["[mcp_servers]", 'other.command = "npx"', "[x]", "b = 2"]],
      ["one inline table", ["[mcp_servers]", 'mingla = { url = "https://old.example", http_headers = { "Authorization" = "Bearer old" } }', 'other = { command = "npx" }'], ["[mcp_servers]", 'other = { command = "npx" }']],
      ["a list on several lines inside it", ["[mcp_servers.mingla]", 'command = "old"', "args = [", '  "a",', '  "[not.a.table]",', "]", "[x]", "b = 2"], ["[x]", "b = 2"]],
      ["neighbours whose names only begin the same", ["[mcp_servers.mingla_staging]", 'url = "https://s.example"', "[mcp_servers.minglax]", 'url = "https://x.example"', 'mcp_like = "mcp_servers.mingla"'], ["[mcp_servers.mingla_staging]", 'url = "https://s.example"', "[mcp_servers.minglax]", 'url = "https://x.example"', 'mcp_like = "mcp_servers.mingla"']],
    ];
    each((shell, home) => {
      const bin = standIns(home, `${KEY.codex}\n`);
      const command = setupCommand({ agent: "codex", os: "mac", endpoint: ENDPOINT, code: CODE.codex });
      fs.mkdirSync(path.join(home, ".codex"));
      const file = path.join(home, ".codex", "config.toml");
      for (const [what, before, kept] of CASES) {
        for (const eol of ["\n", "\r\n"]) {
          fs.writeFileSync(file, before.join(eol) + eol);
          const out = runIn(shell, home, bin, command);
          assert.equal(out.stdout, "Mingla added to Codex.\n", `${shell}: ${what}`);
          assert.equal(out.stderr, "", `${shell}: ${what}`);
          const want = kept.join(eol) + eol + block(KEY.codex).join("\n");
          const got = fs.readFileSync(file, "utf8");
          assert.equal(got, want, `${shell}: ${what} (${eol === "\n" ? "LF" : "CRLF"})`);
          assert.equal(got.split("\n").filter((l) => l === "[mcp_servers.mingla]").length, 1, `${shell}: ${what}: one mingla table`);
          assert.equal(got.includes("old"), false, `${shell}: ${what}: nothing of the earlier entry is left`);
        }
      }
    });
  });
  it("Codex: a mingla entry it cannot remove with certainty stops it before the code is used, and nothing is changed", () => {
    const UNSURE = [
      ["a value of the entry that runs over several lines", ['mcp_servers.mingla.args = [', '  "a",', "]", "[x]", "b = 2"]],
      ["the servers written as one inline table", ['mcp_servers = { mingla = { url = "https://old.example" } }']],
      ["a quoted dotted key", ['"mcp_servers".mingla.url = "https://old.example"']],
      ["a long string as a value of the entry", ["[mcp_servers]", 'mingla.note = """', "text", '"""']],
      ["a quoted name that holds a dot", ['[mcp_servers."mingla.eu"]', 'url = "https://eu.example"']],
      ["text that only looks like an entry, inside a long string", ['notes = """', "[mcp_servers.mingla]", 'url = "this is text"', '"""', "[x]", "b = 2"]],
    ];
    each((shell, home) => {
      const bin = standIns(home, `${KEY.codex}\n`);
      const command = setupCommand({ agent: "codex", os: "mac", endpoint: ENDPOINT, code: CODE.codex });
      fs.mkdirSync(path.join(home, ".codex"));
      const file = path.join(home, ".codex", "config.toml");
      for (const [what, lines] of UNSURE) {
        fs.writeFileSync(file, lines.join("\n") + "\n");
        fs.rmSync(path.join(home, "curl-args.txt"), { force: true });
        const out = runIn(shell, home, bin, command);
        assert.equal(
          out.stdout,
          "Setup did not start: ~/.codex/config.toml already has a mingla entry this command cannot safely replace. Nothing was changed and the setup code was not used. Remove that entry by hand, then paste this message again.\n",
          `${shell}: ${what}`
        );
        assert.equal(out.stderr, "", `${shell}: ${what}`);
        assert.equal(fs.readFileSync(file, "utf8"), lines.join("\n") + "\n", `${shell}: ${what}: the file is as it was`);
        assert.equal(fs.existsSync(path.join(home, "curl-args.txt")), false, `${shell}: ${what}: the setup code was not sent`);
        assert.deepEqual(fs.readdirSync(path.join(home, ".codex")), ["config.toml"], `${shell}: ${what}`);
      }
    });
  });
  it("Codex: a link to the file stays a link, a new file is the owner's only, and no working copy ever holds the key", () => {
    each((shell, home) => {
      const bin = standIns(home, `${KEY.codex}\n`);
      const command = setupCommand({ agent: "codex", os: "mac", endpoint: ENDPOINT, code: CODE.codex });
      fs.mkdirSync(path.join(home, ".codex"));
      fs.mkdirSync(path.join(home, "dotfiles"));
      const real = path.join(home, "dotfiles", "codex.toml");
      fs.writeFileSync(real, 'model = "gpt"\n[mcp_servers.mingla]\nurl = "https://old.example"\n');
      const link = path.join(home, ".codex", "config.toml");
      fs.symlinkSync(real, link);
      assert.equal(runIn(shell, home, bin, command).stdout, "Mingla added to Codex.\n", shell);
      assert.equal(fs.lstatSync(link).isSymbolicLink(), true, `${shell}: still a link`);
      assert.equal(fs.readFileSync(real, "utf8"), `model = "gpt"\n\n[mcp_servers.mingla]\nurl = "${ENDPOINT}"\nhttp_headers = { "Authorization" = "Bearer ${KEY.codex}" }\n`, shell);
      assert.deepEqual(fs.readdirSync(path.join(home, ".codex")), ["config.toml"]);
      assert.deepEqual(fs.readdirSync(path.join(home, "dotfiles")), ["codex.toml"]);
      // A file made by the command is readable by its owner only, whatever the shell's own setting.
      fs.rmSync(path.join(home, ".codex"), { recursive: true });
      const made = spawnSync(shell, ["-c", `umask 022; ${command}`], { cwd: home, env: { HOME: home, PATH: `${bin}:${process.env.PATH}` }, encoding: "utf8" });
      assert.equal(made.stdout, "Mingla added to Codex.\n", shell);
      assert.equal((fs.statSync(path.join(home, ".codex", "config.toml")).mode & 0o777).toString(8), "600", shell);
      // The command names no working copy at all.
      assert.equal(/\.tmp|mktemp|\bmv\b/.test(command), false);
    });
  });
  it("Codex: a key that could not be saved is said in exactly one line; a file it cannot write stops it before the code is used", () => {
    if (process.getuid && process.getuid() === 0) return; // a superuser can write anywhere
    each((shell, home) => {
      const bin = standIns(home, `${KEY.codex}\n`);
      const command = setupCommand({ agent: "codex", os: "mac", endpoint: ENDPOINT, code: CODE.codex });
      // No file yet, and a folder that cannot take one: the key arrives and cannot be saved.
      fs.mkdirSync(path.join(home, ".codex"));
      fs.chmodSync(path.join(home, ".codex"), 0o500);
      const out = runIn(shell, home, bin, command);
      assert.equal(out.stdout, SAVE_FAILED, shell);
      assert.equal(out.stderr, "", shell);
      // A file that is there and cannot be written: nothing is asked.
      fs.chmodSync(path.join(home, ".codex"), 0o700);
      const file = path.join(home, ".codex", "config.toml");
      fs.writeFileSync(file, 'model = "gpt"\n');
      fs.chmodSync(file, 0o400);
      fs.rmSync(path.join(home, "curl-args.txt"), { force: true });
      const stopped = runIn(shell, home, bin, command);
      assert.equal(stopped.stdout, "Setup did not start: this command could not read or write ~/.codex/config.toml. Nothing was changed and the setup code was not used.\n", shell);
      assert.equal(stopped.stderr, "", shell);
      assert.equal(fs.existsSync(path.join(home, "curl-args.txt")), false, `${shell}: the setup code was not sent`);
      assert.equal(fs.readFileSync(file, "utf8"), 'model = "gpt"\n');
    });
  });
  it("the Windows forms follow the same order and the same rules, as written", () => {
    const claude = setupCommand({ agent: "claude", os: "windows", endpoint: ENDPOINT, code: CODE.claude });
    const codex = setupCommand({ agent: "codex", os: "windows", endpoint: ENDPOINT, code: CODE.codex });
    // The whole answer is a key, case and all, or it is not used.
    assert.ok(claude.includes("-cmatch '\\Amgla_c_[A-Za-z0-9_-]{43}\\z'") && codex.includes("-cmatch '\\Amgla_x_[A-Za-z0-9_-]{43}\\z'"));
    assert.equal(/-like "mgla_/.test(claude + codex), false);
    // Asked for first; the earlier entry goes only after the check.
    assert.ok(claude.indexOf("curl.exe -sS") < claude.indexOf("-cmatch") && claude.indexOf("-cmatch") < claude.indexOf("claude mcp remove"));
    assert.ok(codex.indexOf("Get-Content $f") < codex.indexOf("curl.exe -sS") && codex.indexOf("-cmatch") < codex.indexOf("WriteAllLines"));
    for (const c of [claude, codex]) {
      assert.ok(c.includes("-replace '[^\\x20-\\x7E]', ''") && c.includes("$s.Substring(0, 200)") && c.includes('"Setup did not work: $s"'));
      assert.ok(c.includes(SAVE_FAILED.trim()));
      assert.equal(/Setup did not work: \$k/.test(c), false, "the answer itself is never printed as it came");
    }
    assert.ok(claude.includes("$LASTEXITCODE = 1; claude mcp add-json") && claude.includes("if ($LASTEXITCODE -eq 0)"));
    assert.ok(codex.includes("cannot safely replace") && codex.includes("$bad = $true"));
  });
});

describe("#3802 S-3: nothing but a real code and a plain address is ever put in a command", () => {
  const HOSTILE = [
    "",
    null,
    undefined,
    0,
    {},
    [],
    "mgls_c_short",
    `mgls_c_${tail("a")}x`,
    `mgls_c_${"a".repeat(42)}'`,
    `mgls_c_${"a".repeat(42)}"`,
    `mgls_c_${"a".repeat(42)}$`,
    `mgls_c_${"a".repeat(42)}\``,
    `mgls_c_${"a".repeat(42)};`,
    `mgls_c_${"a".repeat(42)}\n`,
    ` mgls_c_${tail("a")}`,
    `mgls_z_${tail("a")}`,
    `MGLS_c_${tail("a")}`,
    KEY.claude,
    KEY.codex,
    `mgla_c_${tail("a")}`,
    "$(touch /tmp/x)",
    "'; rm -rf ~; '",
  ];
  it("a code that is not exactly a code for that agent builds nothing", () => {
    for (const c of COMBOS) {
      for (const code of HOSTILE) {
        assert.equal(setupMessage({ ...c, endpoint: ENDPOINT, code }), null, `${c.agent}/${c.os}: ${String(code).slice(0, 20)}`);
        assert.equal(setupCommand({ ...c, endpoint: ENDPOINT, code }), "");
      }
      // The other agent's code is not this agent's code.
      const other = c.agent === "claude" ? CODE.codex : CODE.claude;
      assert.equal(setupMessage({ ...c, endpoint: ENDPOINT, code: other }), null);
      assert.equal(isSetupCode(other, c.agent), false);
      assert.equal(isSetupCode(CODE[c.agent], c.agent), true);
    }
    assert.equal(isSetupCode(CODE.claude, "gemini"), false);
    assert.equal(setupMessage({ agent: "gemini", os: "mac", endpoint: ENDPOINT, code: CODE.claude }), null);
  });
  it("an address that is not the connector's plain address builds nothing", () => {
    for (const endpoint of [
      "",
      null,
      "https://example.supabase.co",
      "https://example.supabase.co/functions/v1/team-agent/",
      "https://example.supabase.co/functions/v1/team-agent?x=1",
      "https://example.supabase.co/functions/v1/team-agent'; rm -rf ~; '",
      'https://example.supabase.co/functions/v1/team-agent"',
      "https://exa mple.co/functions/v1/team-agent",
      "https://example.co/$(id)/functions/v1/team-agent",
      "javascript:alert(1)//functions/v1/team-agent",
      "ftp://example.co/functions/v1/team-agent",
    ]) {
      for (const c of COMBOS) {
        assert.equal(setupMessage({ ...c, endpoint, code: CODE[c.agent] }), null, String(endpoint));
        assert.equal(advancedLines({ ...c, endpoint }), null, String(endpoint));
      }
    }
  });
  it("whatever is passed as a key, no line for adding it by hand and no setup message can contain one", () => {
    for (const c of COMBOS) {
      for (const smuggled of [KEY.claude, KEY.codex, `mgla_c_${tail("z")}`]) {
        // The builders take no key: an extra argument is ignored.
        const lines = advancedLines({ ...c, endpoint: ENDPOINT, key: smuggled, code: smuggled, freshKey: smuggled });
        assert.equal(KEY_SHAPED.test(JSON.stringify(lines)), false, `${c.agent}/${c.os}`);
        const message = setupMessage({ ...c, endpoint: ENDPOINT, code: CODE[c.agent], key: smuggled });
        assert.equal(KEY_SHAPED.test(message), false);
        assert.equal(setupMessage({ ...c, endpoint: ENDPOINT, code: smuggled }), null);
      }
    }
    assert.equal(advancedLines.length, 1, "it takes one argument");
    assert.equal(/\bkey\b/.test(/export function advancedLines\(\{([^}]*)\}\)/.exec(read("lib/agentConnect.js"))[1]), false, "and that argument has no key in it");
  });
});

describe("#3802 S-4: adding the key by hand", () => {
  it("line 1 asks for the key and line 2 names the variable: neither holds a key", () => {
    for (const c of COMBOS) {
      const lines = advancedLines({ ...c, endpoint: ENDPOINT });
      const def = AGENTS.find((a) => a.id === c.agent);
      assert.equal(lines.steps.length, 2);
      assert.equal(lines.untested, c.os === "windows");
      for (const step of lines.steps) {
        assert.equal(KEY_SHAPED.test(step.text), false);
        assert.equal("hasKey" in step, false, "no line is marked as carrying a key, because none does");
        assert.match(step.where, /To remove/);
      }
      assert.ok(lines.steps[0].text.includes(def.envVar));
      assert.match(lines.steps[0].where, /Nothing you pasted is kept in your shell's history\./);
      assert.ok(lines.steps[1].text.includes(def.envVar));
      assert.equal("simpler" in lines, false, "the one-paste line that held the key is gone");
      assert.ok(lines.notes.some((n) => /Using a desktop app\? .* Use the setup message instead\./.test(n)));
    }
    const mac = advancedLines({ agent: "claude", os: "mac", endpoint: ENDPOINT });
    assert.equal(
      mac.steps[0].text,
      `printf 'Paste your key, then press Enter (it stays hidden): '; stty -echo; IFS= read -r MINGLA_K; stty echo; echo; printf 'export MINGLA_CLAUDE_KEY="%s"\\n' "$MINGLA_K" >> ~/.zshrc; unset MINGLA_K; source ~/.zshrc`
    );
    assert.equal(
      mac.steps[1].text,
      `claude mcp remove mingla --scope user; claude mcp add-json --scope user mingla '{"type":"http","url":"${ENDPOINT}","headers":{"Authorization":"Bearer \${MINGLA_CLAUDE_KEY}"}}'`
    );
    assert.ok(mac.notes.some((n) => n === "Then check it: run claude mcp list. Mingla should say Connected. Do not run claude mcp get mingla where others can see your screen: it prints the key."));
    const win = advancedLines({ agent: "codex", os: "windows", endpoint: ENDPOINT });
    assert.equal(
      win.steps[0].text,
      "$k = Read-Host 'Paste your key, then press Enter' -AsSecureString; [Environment]::SetEnvironmentVariable('MINGLA_CODEX_KEY', [Net.NetworkCredential]::new('', $k).Password, 'User'); Remove-Variable k"
    );
    assert.equal(win.steps[1].text, `[mcp_servers.mingla]\nurl = "${ENDPOINT}"\nbearer_token_env_var = "MINGLA_CODEX_KEY"`);
    const winClaude = advancedLines({ agent: "claude", os: "windows", endpoint: ENDPOINT });
    assert.match(winClaude.steps[1].label, /In a NEW Command Prompt window/);
  });
  it("line 1, run in a real shell with the key on standard input, writes exactly the export line and nothing else", () => {
    for (const shell of SHELLS) {
      for (const agent of AGENTS) {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "issue3802-adv-"));
        try {
          const line = advancedLines({ agent: agent.id, os: "mac", endpoint: ENDPOINT }).steps[0].text;
          const out = spawnSync(shell, ["-c", `${line}; printf '[%s]' "$${agent.envVar}"`], {
            env: { HOME: home, PATH: process.env.PATH },
            input: `${KEY[agent.id]}\n`,
            encoding: "utf8",
          });
          assert.equal(fs.readFileSync(path.join(home, ".zshrc"), "utf8"), `export ${agent.envVar}="${KEY[agent.id]}"\n`, `${shell}/${agent.id}`);
          assert.ok(out.stdout.endsWith(`[${KEY[agent.id]}]`), "a shell that read the file holds the key");
          assert.equal(out.stdout.split(KEY[agent.id]).length - 1, 1, "the line itself never prints the key");
          assert.equal(line.includes(KEY[agent.id]), false);
          assert.deepEqual(fs.readdirSync(home), [".zshrc"]);
        } finally {
          fs.rmSync(home, { recursive: true, force: true });
        }
      }
    }
  });
  it("line 2 for Claude Code hands the agent one JSON value that names the variable", () => {
    const add = advancedLines({ agent: "claude", os: "mac", endpoint: ENDPOINT }).steps[1].text;
    const second = add.split("; ")[1];
    const argv = JSON.parse(
      execFileSync("sh", ["-c", second.replace(/^claude /, `node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- `)], {
        env: { PATH: process.env.PATH, MINGLA_CLAUDE_KEY: KEY.claude },
        encoding: "utf8",
      })
    );
    assert.deepEqual(argv.slice(0, 5), ["mcp", "add-json", "--scope", "user", "mingla"]);
    assert.deepEqual(JSON.parse(argv[5]), { type: "http", url: ENDPOINT, headers: { Authorization: "Bearer ${MINGLA_CLAUDE_KEY}" } });
  });
});

describe("#3802 S-5: every state of the setup card has words and a next step", () => {
  const NOW = Date.parse("2026-10-14T10:02:30Z");
  const soon = new Date(NOW + 9.5 * 60_000).toISOString();
  const key = { key_id: "k1", agent: "claude", revoked_at: null, last_used_at: new Date(NOW - 30_000).toISOString(), last_used_client: "claude-code/2.1.296" };
  const unused = { key_id: "k2", agent: "claude", revoked_at: null, last_used_at: null };
  const stopped = { key_id: "k0", agent: "claude", revoked_at: "2026-10-13T09:00:00Z", revoke_reason: "idle" };
  const view = (over) => setupCardView({ agentId: "claude", now: NOW, ...over });
  const labels = (v) => v.buttons.map((b) => b.label);
  it("no key and no message: Not connected, with Copy setup message", () => {
    const v = view({});
    assert.equal(v.state, "none");
    assert.equal(v.status.text, "Not connected");
    assert.deepEqual(labels(v), ["Copy setup message"]);
    assert.equal(v.buttons[0].variant, "primary");
  });
  it("asking: the button is busy and nothing else can be pressed", () => {
    const v = view({ local: { phase: "asking" } });
    assert.equal(v.state, "asking");
    assert.deepEqual(v.buttons.map((b) => [b.label, !!b.busy]), [["Copy setup message", true]]);
  });
  it("ready and copied: says so, shows the message, when it ends, and that it is waiting", () => {
    const v = view({ local: { phase: "ready", expiresAt: soon } });
    assert.equal(v.state, "ready");
    assert.equal(v.showMessage, true);
    assert.equal(v.lines[0], "Copied. Paste it into Claude Code now.");
    assert.equal(v.lines[1], `Works once. Stops working at ${clockWords(soon)} (in 9 min).`);
    assert.equal(v.lines[2], "Waiting for your agent…");
    assert.deepEqual(labels(v), ["Copy again", "Done"]);
    assert.equal(view({ agentId: "codex", local: { phase: "ready", expiresAt: soon } }).lines[0], "Copied. Paste it into Codex now.");
  });
  it("the browser blocked the copy: the message is selected and a second press is offered", () => {
    const v = view({ local: { phase: "blocked", expiresAt: soon } });
    assert.equal(v.state, "blocked");
    assert.equal(v.showMessage, true);
    assert.equal(v.selectMessage, true);
    assert.match(v.lines[0], /Press Copy message, or Ctrl or Cmd \+ C\.$/);
    assert.deepEqual(labels(v), ["Copy message", "Done"]);
    assert.equal(v.buttons[0].variant, "primary");
  });
  it("the message was used: a key was made, and the card says Connected only once that key has been used", () => {
    const usedAt = new Date(NOW - 20_000).toISOString();
    const made = { ...unused, key_id: "made" };
    const v = view({ activeKey: made, local: { phase: "used", keyId: "made", usedAt } });
    assert.equal(v.state, "used");
    assert.equal(v.showMessage, false);
    assert.deepEqual(v.lines, [
      'Your message was used: a key was made for Claude Code. Your agent should have printed "Mingla added to Claude Code."',
      "Restart Claude Code, then ask: What is on my plate in Mingla?",
    ]);
    assert.deepEqual(labels(v), ["Done"]);
    assert.equal(v.status.text, "Key created · not used yet");
    assert.equal(/connected/i.test(v.lines.join(" ")), false, "nothing claims the agent is connected yet");
    // The key has been used: now it says Connected.
    const live = view({ activeKey: { ...key, key_id: "made" }, local: { phase: "used", keyId: "made", usedAt } });
    assert.equal(live.state, "used_connected");
    assert.deepEqual(live.lines, ["Connected: Claude Code is using its key. Ask it: What is on my plate in Mingla?"]);
    assert.deepEqual(labels(live), ["Done"]);
  });
  it("a key that stays unused for two minutes is said so, with the way forward", () => {
    assert.equal(SETUP_UNUSED_WARN_MS, 2 * 60_000);
    const made = { ...unused, key_id: "made" };
    const at = (ms) => view({ activeKey: made, local: { phase: "used", keyId: "made", usedAt: new Date(NOW - ms).toISOString() } });
    assert.equal(at(SETUP_UNUSED_WARN_MS - 1).state, "used");
    const late = at(SETUP_UNUSED_WARN_MS);
    assert.equal(late.state, "used_unused");
    assert.equal(late.tone, "warning");
    assert.deepEqual(late.lines, ["Your agent has not used the key yet. If it printed an error, copy a new setup message."]);
    assert.deepEqual(labels(late), ["Copy a new setup message", "Done"]);
  });
  it("a used message whose key is no longer the working one says nothing of it", () => {
    const local = { phase: "used", keyId: "made", usedAt: new Date(NOW - 20_000).toISOString() };
    // Another key took its place (made by hand, or by a newer message), or none is left.
    assert.equal(view({ activeKey: { ...unused, key_id: "another" }, local }).state, "unused");
    assert.equal(view({ activeKey: { ...key, key_id: "another" }, local }).state, "connected");
    assert.equal(view({ activeKey: null, local }).state, "none");
  });
  it("a newer message copied elsewhere, or one ended before it was used, says so and offers a new one", () => {
    const superseded = view({ local: { phase: "superseded" } });
    assert.equal(superseded.state, "superseded");
    assert.deepEqual(superseded.lines, ["A newer setup message was copied elsewhere; this one no longer works."]);
    assert.equal(superseded.showMessage, false);
    assert.equal(superseded.focus, "copy");
    assert.deepEqual(labels(superseded), ["Copy a new setup message", "Done"]);
    const ended = view({ local: { phase: "ended" } });
    assert.deepEqual(ended.lines, ["This setup message no longer works: it was ended before it was used. Your agent is unchanged by it."]);
    assert.deepEqual(labels(ended), ["Copy a new setup message", "Done"]);
  });
  it("each press of Copy message that still does not copy changes what the card says", () => {
    const first = view({ local: { phase: "blocked", expiresAt: new Date(NOW + 9 * 60_000).toISOString(), tries: 0 } });
    assert.equal(first.lines[0], "Your browser didn't copy it. Press Copy message, or Ctrl or Cmd + C.");
    const second = view({ local: { phase: "blocked", expiresAt: new Date(NOW + 9 * 60_000).toISOString(), tries: 1 } });
    assert.equal(second.lines[0], "Your browser still didn't copy it (tried 2 times). The message below is selected: press Ctrl or Cmd + C now.");
    const third = view({ local: { phase: "blocked", expiresAt: new Date(NOW + 9 * 60_000).toISOString(), tries: 2 } });
    assert.notEqual(third.lines[0], second.lines[0]);
    assert.equal(second.selectMessage, true);
    assert.deepEqual(labels(second), ["Copy message", "Done"]);
  });
  it("used and working: the status pill, a new message or Disconnect", () => {
    const v = view({ activeKey: key });
    assert.equal(v.state, "connected");
    assert.equal(v.status.text, "Connected: Claude · last used just now · Claude Code 2.1");
    assert.deepEqual(labels(v), ["Copy a new setup message", "Disconnect"]);
    const waiting = view({ activeKey: unused });
    assert.equal(waiting.state, "unused");
    assert.match(waiting.lines[0], /has not used it yet\. Restart Claude Code/);
    assert.deepEqual(labels(waiting), ["Copy a new setup message", "Disconnect"]);
  });
  it("the message ran out unused: says the agent is unchanged, and focus goes to the way forward", () => {
    const v = view({ local: { phase: "expired" } });
    assert.deepEqual(v.lines, ["That message has expired and can no longer be used. Your agent is unchanged."]);
    assert.deepEqual(labels(v), ["Copy a new setup message"]);
    assert.equal(v.focus, "copy");
    assert.equal(v.showMessage, false);
  });
  it("already connected: asked before anything is made, with a way back", () => {
    const v = view({ activeKey: key, local: { phase: "confirm" } });
    assert.deepEqual(v.lines, ["Your agent's current key keeps working until the new message is used. When it is, the old key stops at once."]);
    assert.deepEqual(labels(v), ["Copy setup message", "Keep"]);
  });
  it("after a reload while a message is still live: when it was copied, when it ends, and that it is not kept here", () => {
    const pending = pendingSetup([{ agent: "claude", created_at: "2026-10-14T10:02:00Z", expires_at: "2026-10-14T10:12:00Z" }], "claude", NOW);
    const v = view({ pending });
    assert.equal(v.state, "pending");
    assert.equal(
      v.lines[0],
      `A setup message was copied at ${clockWords("2026-10-14T10:02:00Z")} and has not been used. It stops working at ${clockWords("2026-10-14T10:12:00Z")}. The message itself is not kept here.`
    );
    assert.deepEqual(labels(v), ["Copy a new setup message"]);
    assert.equal(v.showMessage, false);
    // One that has run out, or is for the other agent, is not shown.
    assert.equal(pendingSetup([{ agent: "claude", created_at: "2026-10-14T09:00:00Z", expires_at: "2026-10-14T09:10:00Z" }], "claude", NOW), null);
    assert.equal(pendingSetup([{ agent: "codex", created_at: "2026-10-14T10:02:00Z", expires_at: "2026-10-14T10:12:00Z" }], "claude", NOW), null);
    for (const bad of [null, undefined, "x", [null, {}, { agent: "claude", expires_at: "nope" }]]) assert.equal(pendingSetup(bad, "claude", NOW), null);
  });
  it("asking failed: nothing was made, the server's reason in plain words, and Try again", () => {
    const v = view({ local: { phase: "failed", words: agentErrorWords({ token: "too_many_codes", message: "x" }) } });
    assert.deepEqual(v.lines, [
      "No setup message was made, and nothing changed. You have copied 10 setup messages in the last hour. Paste the last one into your agent, or try again in a few minutes.",
    ]);
    assert.deepEqual(labels(v), ["Try again"]);
    assert.match(view({ local: { phase: "failed", words: agentErrorWords({ token: "something_new" }) } }).lines[0], /^No setup message was made, and nothing changed\. That didn't work\./);
  });
  it("the answer never arrived: never claims a message was or was not made, and offers Try again", () => {
    const v = view({ local: { phase: "lost" } });
    assert.deepEqual(v.lines, ["We couldn't tell whether a setup message was made. Nothing has changed for your agent: a message only matters once it is used. Try again."]);
    assert.deepEqual(labels(v), ["Try again"]);
  });
  it("offline: the buttons that need the server are disabled and say why; Done and Keep still work", () => {
    for (const over of [{}, { activeKey: key }, { local: { phase: "expired" } }, { local: { phase: "failed", words: "x" } }]) {
      const v = view({ ...over, offline: true });
      assert.ok(v.buttons.every((b) => b.disabled), JSON.stringify(over));
      assert.equal(v.offlineWords, "You're offline. This works again once you're back.");
    }
    const ready = view({ local: { phase: "ready", expiresAt: soon }, offline: true });
    assert.equal(ready.buttons.find((b) => b.id === "done").disabled, false);
    assert.equal(view({ activeKey: key, local: { phase: "confirm" }, offline: true }).buttons.find((b) => b.id === "keep").disabled, false);
    assert.equal(view({}).offlineWords, "");
  });
  it("a key that stopped: the reason in plain words, and Copy setup message", () => {
    const v = view({ stoppedKey: stopped });
    assert.equal(v.state, "stopped");
    assert.match(v.lines[0], /^Unused for 90 days, so this key was turned off/);
    assert.deepEqual(labels(v), ["Copy setup message"]);
  });
  it("no state is a dead end: each has a sentence and at least one button, for both agents", () => {
    const locals = [null, { phase: "asking" }, { phase: "confirm" }, { phase: "ready", expiresAt: soon }, { phase: "blocked", expiresAt: soon }, { phase: "used" }, { phase: "expired" }, { phase: "failed", words: "Why." }, { phase: "lost" }];
    for (const agentId of ["claude", "codex"]) {
      for (const local of locals) {
        for (const activeKey of [null, { ...key, agent: agentId }, { ...unused, agent: agentId }]) {
          const v = setupCardView({ agentId, activeKey, local, now: NOW });
          assert.ok(v.buttons.length >= 1, `${agentId} ${local?.phase} has a button`);
          assert.ok(v.status.text.length > 0);
          for (const b of v.buttons) assert.ok(["copy", "again", "done", "keep", "disconnect"].includes(b.id) && b.label.length > 3);
          for (const line of v.lines) assert.ok(/[.…?]$/.test(line), line);
          assert.equal(/undefined|null|NaN/.test(JSON.stringify(v.lines)), false);
        }
      }
    }
  });
  it("time words", () => {
    assert.equal(minutesLeftWords(new Date(NOW + 30_000).toISOString(), NOW), "in under a minute");
    assert.equal(minutesLeftWords(new Date(NOW + 61_000).toISOString(), NOW), "in 1 min");
    assert.equal(minutesLeftWords(new Date(NOW - 1).toISOString(), NOW), "");
    assert.equal(minutesLeftWords("nope", NOW), "");
    assert.match(clockWords(soon), /^\d{2}:\d{2}$/);
    assert.equal(clockWords("nope"), "");
  });
});

describe("#3802 S-6: what became of one setup message, by its own id", () => {
  const NOW = Date.parse("2026-10-14T10:05:00Z");
  const later = "2026-10-14T10:12:00Z";
  const row = (id, state, extra = {}) => ({ id, agent: "claude", created_at: "2026-10-14T10:02:00Z", expires_at: later, state, used_at: null, key_id: null, ...extra });
  const ask = (setup, extra = {}) => setupVerdict({ setup, id: "mine", agentId: "claude", expiresAt: later, now: NOW, ...extra });
  it("used means the server says THIS message made a key, and says which and when", () => {
    assert.deepEqual(ask([row("mine", "used", { key_id: "k9", used_at: "2026-10-14T10:04:00Z" })]), { verdict: "used", keyId: "k9", usedAt: "2026-10-14T10:04:00Z" });
    // Even just after its time: a message that was used was used.
    assert.equal(ask([row("mine", "used", { key_id: "k9", used_at: "2026-10-14T10:11:59Z" })], { now: Date.parse(later) + 5_000 }).verdict, "used");
  });
  it("a key that appears any other way is never taken for the message having been used", () => {
    // A key made by hand in another tab: the list of keys is not even asked.
    assert.deepEqual(ask([row("mine", "waiting")], { keys: [{ key_id: "by-hand", agent: "claude", revoked_at: null }] }), { verdict: "wait" });
    // Another message of this person's was used: not this one.
    assert.deepEqual(ask([row("mine", "waiting"), row("other", "used", { key_id: "k1", created_at: "2026-10-14T10:00:00Z" })]), { verdict: "wait" });
    // The other agent's message was used.
    assert.deepEqual(ask([row("mine", "waiting"), row("x", "used", { agent: "codex", key_id: "k2", created_at: "2026-10-14T10:03:00Z" })]), { verdict: "wait" });
    assert.equal(/beforeKeyId|activeKey\(keys/.test(/export function setupVerdict[\s\S]*?\n}\n/.exec(read("lib/agentConnect.js"))[0]), false, "it never reasons from the keys");
  });
  it("a newer message for the same agent ends this one, and this tab says so", () => {
    const newer = row("newer", "waiting", { created_at: "2026-10-14T10:04:00Z" });
    assert.deepEqual(ask([newer, row("mine", "ended")]), { verdict: "superseded" });
    // Even if this tab's own entry has not caught up yet.
    assert.deepEqual(ask([newer, row("mine", "waiting")]), { verdict: "superseded" });
    // Ended with nothing newer (the agent was disconnected, or the use was refused).
    assert.deepEqual(ask([row("mine", "ended")]), { verdict: "ended" });
    // An older message, or the other agent's newer one, ends nothing.
    assert.deepEqual(ask([row("older", "ended", { created_at: "2026-10-14T10:00:00Z" }), row("mine", "waiting")]), { verdict: "wait" });
    assert.deepEqual(ask([row("x", "waiting", { agent: "codex", created_at: "2026-10-14T10:04:00Z" }), row("mine", "waiting")]), { verdict: "wait" });
  });
  it("past its time unused, it has run out; a time that cannot be read counts as run out; otherwise it waits", () => {
    assert.deepEqual(ask([row("mine", "expired")]), { verdict: "expired" });
    assert.deepEqual(ask([row("mine", "waiting")], { now: Date.parse(later) }), { verdict: "expired" });
    assert.deepEqual(ask([], { expiresAt: "nope" }), { verdict: "expired" });
    assert.deepEqual(ask([row("mine", "waiting")]), { verdict: "wait" });
    // A list that could not be read, or does not hold this message yet: wait for its time.
    for (const none of [null, undefined, [], [null, 7], [row("someone-else", "used", { key_id: "k" })]]) assert.deepEqual(ask(none), { verdict: "wait" });
  });
  it("only a message that is still waiting is listed as waiting after a reload", () => {
    const at = Date.parse("2026-10-14T10:05:00Z");
    assert.equal(pendingSetup([row("a", "used", { key_id: "k" }), row("b", "ended"), row("c", "expired")], "claude", at), null);
    assert.equal(pendingSetup([row("a", "ended"), row("b", "waiting", { created_at: "2026-10-14T10:04:00Z" })], "claude", at).id, "b");
  });
});

describe("#3802 S-7: the repeated check runs only while the page is visible and online, and ends", () => {
  function clock() {
    let now = 0;
    let next = 1;
    const timers = new Map();
    return {
      now: () => now,
      setTimer: (fn, ms) => {
        const id = next++;
        timers.set(id, { at: now + ms, fn });
        return id;
      },
      clearTimer: (id) => timers.delete(id),
      pending: () => timers.size,
      advance(ms) {
        const end = now + ms;
        for (;;) {
          const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
          if (!due) break;
          now = due[1].at;
          timers.delete(due[0]);
          due[1].fn();
        }
        now = end;
      },
    };
  }
  it("a watch that runs to a time on the clock is not set back by being started again", () => {
    const c = clock();
    const until = 30_000;
    let ticks = 0;
    let ended = 0;
    const make = () => createWatch({ onTick: () => ticks++, onEnd: () => ended++, everyMs: 5_000, until, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
    // The page draws again every two seconds for a while (a press, a new line): each time the
    // watch is stopped and made anew. A count that started again each time would never tick.
    let watch = make();
    for (let i = 0; i < 6; i++) {
      c.advance(2_000);
      watch.stop();
      watch = make();
    }
    assert.equal(ticks, 0, "twelve seconds of drawing again");
    c.advance(5_000);
    assert.equal(ticks, 1, "left alone for five seconds, it ticks");
    c.advance(20_000);
    assert.equal(ended, 1, "and it ends at the time it was given, not later");
    assert.equal(c.now() >= until && watch.running === false, true);
    // Started after its time: it ends at once, with no tick.
    const late = createWatch({ onTick: () => ticks++, onEnd: () => ended++, everyMs: 5_000, until, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
    const before = ticks;
    c.advance(1);
    assert.equal(ended, 2);
    assert.equal(ticks, before);
    assert.equal(late.running, false);
  });
  it("ticks every five seconds for at most its time, then ends once and stops", () => {
    const c = clock();
    let ticks = 0;
    let ended = 0;
    const w = createWatch({ onTick: () => ticks++, onEnd: () => ended++, everyMs: 5_000, forMs: 22_000, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
    c.advance(4_999);
    assert.equal(ticks, 0);
    c.advance(1);
    assert.equal(ticks, 1);
    c.advance(15_000);
    assert.equal(ticks, 4);
    assert.equal(ended, 0);
    c.advance(2_000);
    assert.equal(ended, 1, "it ends at its time, not at the next multiple of five seconds");
    assert.equal(ticks, 4);
    c.advance(600_000);
    assert.equal(ticks, 4, "nothing runs after the end");
    assert.equal(ended, 1);
    assert.equal(c.pending(), 0);
    assert.equal(w.running, false);
  });
  it("a key on screen is checked for ten minutes and then hidden; a setup message until its end plus a moment", () => {
    assert.equal(SHOWN_KEY_MAX_MS, 600_000);
    assert.equal(SETUP_GRACE_MS, 15_000);
    assert.equal(KEY_HIDDEN_AFTER_WORDS, "Hidden after 10 minutes. Lost it? Replace the key.");
    const c = clock();
    let ticks = 0;
    let ended = 0;
    createWatch({ onTick: () => ticks++, onEnd: () => ended++, forMs: SHOWN_KEY_MAX_MS, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
    c.advance(SHOWN_KEY_MAX_MS - 1);
    assert.equal(ended, 0);
    assert.equal(ticks, 119);
    c.advance(1);
    assert.equal(ended, 1);
  });
  it("a hidden tab makes no read at all; shown again, one read is made at once and the timer starts again", () => {
    const c = clock();
    let ticks = 0;
    let visible = true;
    const w = createWatch({ onTick: () => ticks++, everyMs: 5_000, forMs: 600_000, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, isVisible: () => visible });
    c.advance(10_000);
    assert.equal(ticks, 2);
    visible = false;
    w.hidden();
    assert.equal(c.pending(), 0, "no timer is left running in a hidden tab");
    c.advance(120_000);
    assert.equal(ticks, 2, "nothing was read while hidden");
    visible = true;
    w.visible();
    assert.equal(ticks, 3, "one read at once");
    c.advance(5_000);
    assert.equal(ticks, 4);
    // When another read is already on its way at that moment, it only starts again.
    w.hidden();
    w.visible(false);
    assert.equal(ticks, 4, "no second read when told one is already made");
    c.advance(5_000);
    assert.equal(ticks, 5);
    // Hidden without being told (the event was missed): the tick itself checks.
    visible = false;
    c.advance(5_000);
    assert.equal(ticks, 5);
    assert.equal(c.pending(), 0);
  });
  it("offline, nothing is read, and the count still ends on time", () => {
    const c = clock();
    let ticks = 0;
    let ended = 0;
    let online = false;
    const w = createWatch({ onTick: () => ticks++, onEnd: () => ended++, everyMs: 5_000, forMs: 30_000, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, isOnline: () => online });
    c.advance(20_000);
    assert.equal(ticks, 0);
    w.visible();
    assert.equal(ticks, 0, "shown again while offline: still nothing");
    online = true;
    c.advance(5_000);
    assert.equal(ticks, 1);
    c.advance(5_000);
    assert.equal(ended, 1);
  });
  it("shown again after its time has passed, it ends instead of reading; stop() ends it silently", () => {
    const c = clock();
    let ticks = 0;
    let ended = 0;
    let visible = false;
    const w = createWatch({ onTick: () => ticks++, onEnd: () => ended++, everyMs: 5_000, forMs: 30_000, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, isVisible: () => visible });
    c.advance(60_000);
    visible = true;
    w.visible();
    assert.deepEqual([ticks, ended], [0, 1]);
    const c2 = clock();
    let ended2 = 0;
    const w2 = createWatch({ onTick: () => {}, onEnd: () => ended2++, forMs: 30_000, now: c2.now, setTimer: c2.setTimer, clearTimer: c2.clearTimer });
    w2.stop();
    c2.advance(60_000);
    assert.equal(ended2, 0);
    assert.equal(c2.pending(), 0);
  });
});

describe("#3802 S-8: where the setup message and its code may go", () => {
  const PAGE = stripComments(read("pages/AgentPage.jsx"));
  const CARD = stripComments(read("components/agent/AgentSetupCard.jsx"));
  const ADVANCED = stripComments(read("components/agent/AgentAdvanced.jsx"));
  const SERVICE = stripComments(read("services/teamAgentService.js"));
  const HOOK = stripComments(read("hooks/useAgentKeys.js"));
  const LIB = stripComments(read("lib/agentConnect.js"));
  it("nothing here writes to storage, an address, a cookie, a title, another tab or a log with it", () => {
    for (const [name, src] of [["page", PAGE], ["card", CARD], ["advanced", ADVANCED], ["service", SERVICE], ["hook", HOOK], ["lib", LIB]]) {
      assert.equal(
        /localStorage|sessionStorage|indexedDB|document\.cookie|document\.title|history\.(push|replace)State|location\.(hash|href|search)\s*=|window\.open|postMessage|sendBeacon|new Image|BroadcastChannel|SharedWorker/.test(src),
        false,
        name
      );
      for (const log of src.match(/console\.[a-z]+\([^;]*\);/g) ?? []) {
        assert.match(log, /^console\.error\("\[agent\] [a-z ]+:", (err\?\.token \|\| err\?\.name \|\| "error"|err\?\.name \|\| "error"|result\.error\.code)\);$/, `${name}: ${log}`);
      }
      assert.equal(/dangerouslySetInnerHTML/.test(src), false, name);
      assert.equal(/(title|aria-label|href)=\{(message\b|messages\[|[^}]*\$\{(message|code)\b)/.test(src), false, name);
    }
  });
  it("the page keeps the code in one piece of state and drops it on Done, when used, ended or run out, and on Disconnect", () => {
    assert.match(PAGE, /const \[codes, setCodes\] = useState\(\{\}\);/);
    assert.equal(/useState\(\(\) =>[^)]*codes|useRef\([^)]*codes|createContext/.test(PAGE), false);
    const drops = PAGE.match(/setCodes\(\(m\) => \(\{ \.\.\.m, \[(a\.id|agentId)\]: null \}\)\);/g) ?? [];
    assert.equal(drops.length, 4, "before a new one is made; when it is used, ended or runs out; on Done; on Disconnect");
    assert.match(PAGE, /const doneSetup = useCallback\(\(agentId\) => \{\s*setCodes\(\(m\) => \(\{ \.\.\.m, \[agentId\]: null \}\)\);\s*setSetups\(\(m\) => \(\{ \.\.\.m, \[agentId\]: null \}\)\);/);
    assert.equal((PAGE.match(/setCodes\(/g) ?? []).length, 5, "set once (when made), dropped in four places");
    // The code is read from the answer in two places only: to build the copy, and to keep it for the card.
    assert.equal((PAGE.match(/answer\??\.code/g) ?? []).length, 2);
    assert.equal(/\.code\b/.test(PAGE.replace(/answer\??\.code/g, "")), false);
    // The message is never state: it is built from the code for the computer chosen now.
    assert.equal(/setMessages|useState\([^)]*message/.test(PAGE), false);
    assert.match(PAGE, /const messageFor = useCallback\(\s*\(agentId\) => \(codes\[agentId\] \? setupMessage\(\{ agent: agentId, os, endpoint: ENDPOINT, code: codes\[agentId\] \}\) : null\),\s*\[codes, os\]\s*\);/);
    assert.match(PAGE, /message=\{messageFor\(a\.id\)\}/);
    assert.equal(/\bcode\b|setup_create|messages/.test(HOOK), false, "the hook never holds a code or a message");
    assert.match(HOOK, /setup: Array\.isArray\(data\?\.mine\?\.setup\) \? data\.mine\.setup : \[\],/);
  });
  it("switching the computer swaps the text on screen and never the code", () => {
    for (const agent of ["claude", "codex"]) {
      const mac = setupMessage({ agent, os: "mac", endpoint: ENDPOINT, code: CODE[agent] });
      const win = setupMessage({ agent, os: "windows", endpoint: ENDPOINT, code: CODE[agent] });
      assert.notEqual(mac, win);
      assert.ok(win.includes("PowerShell") && !mac.includes("PowerShell"));
      for (const m of [mac, win]) assert.equal(m.split(CODE[agent]).length - 1, 1, "the same code, once");
    }
    // Copy again copies what is on screen for the computer chosen now.
    assert.match(PAGE, /const copySetupAgain = useCallback\(\s*async \(agentId, node\) => \{\s*const message = messageFor\(agentId\);/);
  });
  it("the copy belongs to the press, can never wait for ever, and a blocked copy is never silent", () => {
    assert.match(PAGE, /navigator\.clipboard\s*\.write\(\[new ClipboardItem\(\{ "text\/plain": text\.then\(\(t\) => new Blob\(\[t\], \{ type: "text\/plain" \}\)\) \}\)\]\)\s*\.then\(\(\) => true, \(\) => false\);/);
    assert.match(PAGE, /if \(navigator\.clipboard\?\.write && typeof ClipboardItem === "function"\) \{/);
    assert.match(PAGE, /phase: ok \? "ready" : "blocked"/);
    // The browser gets two seconds to say whether it copied; a browser that never answers counts as not copied.
    assert.equal(COPY_WAIT_MS, 2_000);
    assert.match(PAGE, /const ok = await within\(copied, COPY_WAIT_MS, false\);/);
    assert.equal(/await copied\b/.test(PAGE), false, "nothing waits on the browser without a limit");
    assert.match(PAGE, /function within\(promise, ms, otherwise\) \{\s*let timer;\s*return Promise\.race\(\[\s*promise,\s*new Promise\(\(resolve\) => \{\s*timer = setTimeout\(\(\) => resolve\(otherwise\), ms\);/);
    // Copy message again: the browser's way within the same limit, then the older way on what is selected.
    assert.match(PAGE, /if \(navigator\.clipboard\?\.writeText\) ok = await within\(navigator\.clipboard\.writeText\(message\)\.then\(\(\) => true, \(\) => false\), COPY_WAIT_MS, false\);/);
    assert.match(PAGE, /if \(!ok\) ok = copySelected\(node\);/);
    assert.match(PAGE, /return typeof document\.execCommand === "function" && document\.execCommand\("copy"\) === true;/);
    // Whatever happens, the card changes: Copied, or one more counted try.
    assert.match(PAGE, /phase: ok \? "ready" : "blocked", tries: ok \? 0 : \(m\[agentId\]\.tries \|\| 0\) \+ 1/);
    assert.match(CARD, /else if \(id === "again"\) onCopyAgain\(agent\.id, boxRef\.current\);/);
    assert.match(CARD, /if \(!view\.selectMessage \|\| !message\) return;[\s\S]*range\.selectNodeContents\(node\);/);
    assert.match(CARD, /if \(firstLine\.includes\("still didn't copy"\)\) node\?\.focus\(\);/);
    assert.match(CARD, /\}, \[view\.selectMessage, message, firstLine\]\);/, "each failed press selects it again");
    // A second press while the first is on its way sends nothing; offline says so.
    assert.match(PAGE, /if \(setupBusyRef\.current\[agentId\]\) return;/);
    assert.match(PAGE, /addToast\(\{ variant: "warning", title: "You're offline", description: "No setup message was made\. Try again once you're back\." \}\);/);
    // Already connected: the question comes before anything is made.
    const body = PAGE.slice(PAGE.indexOf("const copySetup = useCallback("), PAGE.indexOf("const messageFor"));
    assert.ok(body.indexOf('setSetups((m) => ({ ...m, [agentId]: { phase: "confirm" } }));') < body.indexOf("createSetupCode(agentId, browserTimeZone())"));
    assert.match(body, /err\?\.token === "no_answer" \? \{ phase: "lost" \} : \{ phase: "failed", words: agentErrorWords\(err\) \}/);
    assert.match(body, /timer = setTimeout\(\(\) => reject\(\{ token: "no_answer", message: "" \}\), CREATE_WAIT_MS\);/);
    // The message's own id is kept with it, so what became of it can be asked.
    assert.match(body, /\{ phase: ok \? "ready" : "blocked", id: answer\.id \|\| null, expiresAt: answer\.expires_at, tries: 0 \}/);
  });
  it("the waiting check runs to a time on the clock, so drawing the page again never starts it again", () => {
    // What the watch waits for is a time, worked out without reading the clock.
    const until = /const watched = AGENTS\.map\(\(a\) => \{[\s\S]*?\}\);\s*const watchUntil = Math\.max\(0, \.\.\.watched\);/.exec(PAGE);
    assert.ok(until, "the end of the wait is worked out in one place");
    assert.equal(/Date\.now\(\)/.test(until[0]), false, "the end of the wait does not move with the clock");
    assert.match(until[0], /return \(Date\.parse\(st\.expiresAt\) \|\| 0\) \+ SETUP_GRACE_MS;/);
    assert.match(until[0], /if \(st\?\.phase === "used" && !st\.connectedSaid\) return \(Date\.parse\(st\.usedAt\) \|\| 0\) \+ SETUP_FIRST_USE_WATCH_MS;/);
    assert.match(PAGE, /useWatch\(watchUntil > 0, \(\) => \{\s*setNow\(Date\.now\(\)\);\s*refetch\(\{ quiet: true \}\);\s*\}, \{\s*until: watchUntil,/);
    assert.match(PAGE, /\}, \[active, everyMs, until\]\);/, "the watch starts again only when its end changes");
    assert.equal(/forMs|restart/.test(PAGE), false);
    assert.match(PAGE, /if \(document\.visibilityState === "visible"\) watch\.visible\(false\);\s*else watch\.hidden\(\);/);
    assert.match(HOOK, /const onFocus = \(\) => \{\s*if \(document\.visibilityState === "visible"\) refetch\(\{ quiet: true \}\);/, "the one read when the tab is shown again");
    // What became of the message is asked by its own id, on every read.
    assert.match(PAGE, /const result = setupVerdict\(\{ setup: list, id: st\.id, agentId: a\.id, expiresAt: st\.expiresAt, now: at \}\);\s*if \(result\.verdict === "wait"\) continue;\s*setCodes\(\(m\) => \(\{ \.\.\.m, \[a\.id\]: null \}\)\);/);
    assert.match(PAGE, /useEffect\(\(\) => \{\s*if \(!loading && !error\) settle\(setup, keys, Date\.now\(\)\);\s*\}, \[keys, setup, loading, error, settle\]\);/);
    assert.match(PAGE, /settle\(latest\.current\.setup, latest\.current\.keys, Date\.now\(\) \+ 1\);/);
    // "Connected" is said once, when the key the message made has been used.
    assert.match(PAGE, /title: `A key was made for \$\{a\.product\}`/);
    assert.match(PAGE, /if \(key && key\.key_id === st\.keyId && key\.last_used_at\) \{[\s\S]{0,220}title: `\$\{a\.product\} is connected`/);
    assert.equal(/is set up`/.test(PAGE), false);
    // A key made by hand no longer touches a waiting message.
    const create = PAGE.slice(PAGE.indexOf("const create = useCallback("), PAGE.indexOf("const revoke = useCallback("));
    assert.equal(/setCodes|setSetups/.test(create), false);
    assert.equal(SETUP_FIRST_USE_WATCH_MS, 10 * 60_000);
  });
  it("each key on screen is hidden ten minutes after IT was shown", () => {
    const t0 = 1_000_000;
    const shown = { claude: { keyId: "a", shownAt: t0 }, codex: { keyId: "b", shownAt: t0 + 9 * 60_000 } };
    assert.deepEqual(keysToHide(shown, t0 + SHOWN_KEY_MAX_MS - 1), []);
    assert.deepEqual(keysToHide(shown, t0 + SHOWN_KEY_MAX_MS), ["claude"], "the first key goes at its own ten minutes");
    assert.deepEqual(keysToHide(shown, t0 + 11 * 60_000), ["claude"], "a second key shown later does not keep the first");
    assert.deepEqual(keysToHide(shown, t0 + 19 * 60_000), ["claude", "codex"]);
    assert.deepEqual(keysToHide({ claude: null, codex: { keyId: "b" } }, t0 + 99 * 60_000), [], "nothing shown, or no time for it, hides nothing by itself");
    assert.deepEqual(keysToHide(null, t0), []);
    assert.match(PAGE, /setShownIds\(\(m\) => \(\{ \.\.\.m, \[agentId\]: \{ keyId: made\.key_id, listed: false, shownAt: Date\.now\(\) \} \}\)\);/);
    assert.match(PAGE, /const old = keysToHide\(shownRef\.current, at\);/);
    assert.match(PAGE, /useWatch\(showingKey, \(\) => \{\s*hideOldKeys\(Date\.now\(\)\);\s*refetch\(\{ quiet: true \}\);\s*\}, \{\s*until: lastShownAt \+ SHOWN_KEY_MAX_MS,\s*onEnd: \(\) => hideOldKeys\(Date\.now\(\) \+ 1\),/);
    assert.match(PAGE, /useEffect\(\(\) => \{\s*hideOldKeys\(Date\.now\(\)\);\s*\}, \[keys, hideOldKeys\]\);/, "a tab shown again hides what is past its time");
    assert.equal(/setShownAt|shownAt, setShownAt/.test(PAGE), false, "there is no one clock for every key");
  });
  it("the card moves focus when its state changes and after each press that removes its button; the three steps say where, what and what next", () => {
    assert.match(CARD, /role="status"\s+aria-live="polite"\s+tabIndex=\{-1\}/);
    assert.match(CARD, /if \(view\.focus === "copy"\) copyRef\.current\?\.focus\(\);/);
    assert.match(CARD, /statusRef\.current\?\.focus\(\);/);
    // Done, Keep and Disconnect: once the card has settled, focus is on its way forward.
    assert.match(CARD, /else if \(id === "done"\) \{\s*afterPress\.current = true;\s*onDone\(agent\.id\);/);
    assert.match(CARD, /else if \(id === "keep"\) \{\s*afterPress\.current = true;\s*onKeep\(agent\.id\);/);
    assert.match(CARD, /onClick=\{\(\) => \{\s*afterPress\.current = true;\s*setAsking\(false\);\s*onDisconnect\(agent\.id\);/);
    assert.match(CARD, /if \(afterPress\.current\) \{\s*afterPress\.current = false;\s*\(copyRef\.current \|\| statusRef\.current\)\?\.focus\(\);\s*return;\s*\}/);
    // The Disconnect question closed without an answer: back to the button that opened it.
    assert.match(CARD, /if \(afterPress\.current\) statusRef\.current\?\.focus\(\);\s*else disconnectRef\.current\?\.focus\(\);/);
    assert.match(CARD, /b\.id === "disconnect" \? disconnectRef : undefined/);
    // A change nobody pressed for, minutes later, moves nothing.
    assert.match(CARD, /if \(from === "used" && \(view\.state === "used_connected" \|\| view\.state === "used_unused"\)\) return;/);
    const RAW = read("pages/AgentPage.jsx");
    assert.match(RAW, /<StepHeading n=\{1\}>Copy your setup message<\/StepHeading>/);
    assert.match(RAW, /subtitle="One per agent\. Works once, for 10 minutes\."/);
    assert.match(RAW, /<StepHeading n=\{2\}>Paste it into your agent<\/StepHeading>/);
    assert.match(RAW, /Open Claude Code \(or Codex\) on your own computer, paste the message as your next message, and let it run the\s+one command it contains\./);
    assert.match(RAW, /<StepHeading n=\{3\}>Restart your agent, then just ask<\/StepHeading>/);
    assert.match(RAW, /Close and reopen your agent so it sees Mingla\. Then ask:/);
    assert.deepEqual(NOT_WORKING_CHECKS, [
      "Did your agent run the command? It should have printed 'Mingla added'.",
      "Restart the agent after it says so.",
      "A message works once. If you pasted it twice or waited more than 10 minutes, copy a new one.",
      "It printed 'Setup did not start'? Nothing was changed and the code was not used: fix what it names, then paste the same message again.",
      "It printed 'Mingla made your key but could not save it'? Copy a new setup message and try again.",
      "Agent refused to run it? Paste the command from the message into the Terminal app yourself.",
    ]);
    // Every button on the two new parts is a full-height target on a phone.
    for (const [name, src] of [["card", read("components/agent/AgentSetupCard.jsx")], ["advanced", read("components/agent/AgentAdvanced.jsx")]]) {
      const buttons = src.split("<Button").slice(1).map((rest) => rest.slice(0, rest.indexOf("</Button>")));
      for (const b of buttons) assert.ok(/max-sm:h-11/.test(b), `${name}: ${b.slice(0, 50)}`);
    }
  });
  it("the page lists one ability per tool, in the connector's order, with the two new groups", () => {
    assert.deepEqual(AGENT_ABILITIES.map((a) => a.tool).slice(9), ["add_records", "upsert_record", "update_records", "move_stage", "set_owners", "log_activity", "record_reply"]);
    assert.deepEqual([...new Set(AGENT_ABILITIES.map((a) => a.group))], ["Your day", "Find and check", "Beta leads", "Team", "Add and change", "Log"]);
    assert.equal(AGENT_ABILITIES.find((a) => a.tool === "add_records").detail, "Up to 50 at once. A name, an email, a phone or a handle that is already there is skipped, never doubled.");
    assert.equal(AGENT_ABILITIES.find((a) => a.tool === "move_stage").detail, "Always from the stage it saw; Live sets itself.");
    assert.equal(AGENT_ABILITIES.find((a) => a.tool === "log_activity").detail, "A note, a reply, or the first message to someone never contacted.");
    assert.equal(AGENT_ABILITIES.find((a) => a.tool === "record_reply").detail, "Word for word, and moves the card to Replied.");
  });
});
