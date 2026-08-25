// #2417 — INDEPENDENT TESTER suite for the Ari contract collision census.
// CI-only; no runtime surface.
//
// DIFFERENT ANGLE. The implementor's proof is a 27-mutant self-test mode that calls
// checkSources() IN-PROCESS on mutated source strings, and every one of those
// mutants pushes the gate TOWARDS failure. That shape can only ever demonstrate
// sensitivity. It is structurally incapable of catching the defect that actually
// killed the first draft of this census (stale PR #2419, head bfd7bdd7): a FALSE
// POSITIVE, where the gate reds code that is perfectly correct. A gate that reds
// correct code blocks the whole repo, and class A runs on every PR.
//
// So this suite attacks three axes the self-test does not touch:
//
//   1. FALSE-POSITIVE IMMUNITY on legitimate-but-unusual VALID input. Every clause
//      below is a shape that broke, or could plausibly break, a hand-rolled
//      scanner: a shebang followed by regex literals (the exact bfd7bdd7 trigger —
//      `#!/usr/bin/env node` puts a `/` at byte 2 and the old tokenizer opened a
//      phantom regex there), regex literals containing `/` and braces, division
//      that lexes like a regex, nested `${}` template literals, unicode
//      identifiers, backticks and quotes inside comments, CRLF, and a missing
//      trailing newline. The gate MUST stay green through all of it.
//
//   2. TYPESCRIPT IS NEVER HANDED TO `node --check`. Class A provisions node 20.
//      Measured on this repo against the three .ts census files:
//        node 20 -> exit 1 always (ERR_UNKNOWN_FILE_EXTENSION: it cannot load .ts)
//        node 22 -> exit 0 always — and NOT because it type-strips. Appending
//                   `function ( { ] }` to one of these files still exits 0, so for
//                   an ESM-detected .ts `node --check` is a check that CANNOT FAIL.
//      So wiring `node --check` onto a .ts path is broken in both directions at
//      once: a permanent red on CI, and an unfalsifiable green on a laptop. That
//      boundary is pinned twice below — behaviourally (verdict must not move when
//      a .ts file is fed non-JavaScript) and structurally (no nodeCheck call site
//      may pass anything but ".mjs"), because the behavioural half alone is blind
//      on node 22 precisely BECAUSE the underlying check cannot fail there.
//
//   3. PROCESS-LEVEL EXIT CONTRACT. The self-test never spawns the gate. These
//      clauses execute the real file as a real process against a real (mirrored)
//      repository root and assert on exit codes and on the TEXT of the diagnosis,
//      because a gate that fails without naming the stale file is a gate nobody
//      can act on. Forward-safety (#1971/#1977 will add capabilities and tools) is
//      asserted here as "fails loudly and names every stale downstream census",
//      never merely "is non-zero" — a crash is also non-zero.
//
// COST. The mirror is built ONCE. Each clause mutates a single file inside it and
// restores that file afterwards, so no clause re-copies the workflow corpus.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const GATE_REL = ".github/scripts/strict-grep/issue-2417-ari-contract-collision-census.mjs";

// The six files the census reads, plus the two ownership inputs.
const INPUTS = Object.freeze({
  ledger: "docs/contracts/ari-capability-ledger.json",
  ledgerTester: ".github/scripts/strict-grep/__tests__/issue-2000-ari-capability-ledger.tester.test.mjs",
  delegatedGate: ".github/scripts/strict-grep/issue-2019-ari-delegated-auth.mjs",
  authorization: "supabase/functions/_shared/agentToolAuthorization.ts",
  providerTest: "supabase/functions/_shared/__tests__/issue_1999_ari_provider_schema_contract.test.ts",
  authorizationTest: "supabase/functions/_shared/__tests__/issue_2019_agent_authorization.test.ts",
  ciBatchManifest: ".github/ci-batch/MANIFEST.json",
});

// ---------------------------------------------------------------------------
// Mirror the repository once. The gate resolves ROOT from its own location, so
// placing it at <mirror>/.github/scripts/strict-grep/ makes <mirror> the root.
// ---------------------------------------------------------------------------
const MIRROR = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2417-tester-"));
process.on("exit", () => fs.rmSync(MIRROR, { recursive: true, force: true }));

for (const relative of [...Object.values(INPUTS), GATE_REL]) {
  const destination = path.join(MIRROR, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(ROOT, relative), destination);
}
const WORKFLOWS = ".github/workflows";
fs.mkdirSync(path.join(MIRROR, WORKFLOWS), { recursive: true });
for (const name of fs.readdirSync(path.join(ROOT, WORKFLOWS)).filter((n) => /\.ya?ml$/.test(n))) {
  fs.copyFileSync(path.join(ROOT, WORKFLOWS, name), path.join(MIRROR, WORKFLOWS, name));
}

const PRISTINE = Object.fromEntries(
  Object.entries(INPUTS).map(([key, relative]) => [key, fs.readFileSync(path.join(MIRROR, relative), "utf8")]),
);

function runGate() {
  const result = spawnSync(process.execPath, [path.join(MIRROR, GATE_REL)], { encoding: "utf8" });
  return { exit: result.status, text: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** Apply one mutation, run the real gate as a process, always restore. */
function withMutation(key, mutate, assertions) {
  const target = path.join(MIRROR, INPUTS[key]);
  try {
    fs.writeFileSync(target, mutate(PRISTINE[key]));
    assertions(runGate());
  } finally {
    fs.writeFileSync(target, PRISTINE[key]);
  }
}

const green = (label) => ({ exit, text }) => {
  assert.equal(exit, 0, `${label}: gate reported a FALSE POSITIVE on valid input.\n${text}`);
};

// ---------------------------------------------------------------------------
// 0. The mirror is faithful.
// ---------------------------------------------------------------------------
test("#2417 mirror reproduces the real repository verdict (gate passes unmutated)", () => {
  const { exit, text } = runGate();
  assert.equal(exit, 0, `mirror is not faithful — gate failed on unmutated inputs:\n${text}`);
  assert.match(text, /PASS: ledger, authorization, delegated gate/);
});

// ---------------------------------------------------------------------------
// 1. FALSE-POSITIVE IMMUNITY.
// ---------------------------------------------------------------------------
test("#2417 a shebang followed by regex literals does not fabricate a collision (bfd7bdd7 regression)", () => {
  // The precise shape that produced `delegatedGate: delimiter collision near byte
  // 8551` against a file `node --check` accepts. The shebang must remain line 1.
  withMutation("delegatedGate", (source) => {
    assert.match(source, /^#!\/usr\/bin\/env node/, "fixture assumption: delegated gate starts with a shebang");
    return `${source}\nconst _shebangAdjacentRegex = /^\\/usr\\/bin\\/env\\s+node$/;\nexport { _shebangAdjacentRegex };\n`;
  }, green("shebang + regex literal"));
});

test("#2417 regex literals with slashes and braces, and division that lexes like a regex, stay green", () => {
  withMutation("delegatedGate", (source) => `${source}
const _route = /^\\/api\\/v\\d+\\/{2,}[a-z]+\\/?$/gi;
const _ratio = (a, b) => a / b / 2;
const _notARegex = 10 / 2 / 1;
export { _route, _ratio, _notARegex };
`, green("regex + division"));
});

test("#2417 nested template literals, unicode identifiers and backticks in comments stay green", () => {
  withMutation("delegatedGate", (source) => `${source}
// a legitimate comment containing \` backticks \`, "double quotes" and 'apostrophes'
const élève = { ň: 1 };
const _nested = \`outer \${\`inner \${élève.ň} done\`} end\`;
export { élève, _nested };
`, green("template literals + unicode"));
});

test("#2417 CRLF line endings are not read as damage", () => {
  withMutation("ledgerTester", (source) => source.replace(/\r?\n/g, "\r\n"), green("CRLF tester"));
  withMutation("ledger", (source) => source.replace(/\r?\n/g, "\r\n"), green("CRLF ledger"));
});

test("#2417 a missing trailing newline is not read as damage", () => {
  withMutation("delegatedGate", (source) => source.replace(/\n+$/, ""), green("no trailing newline"));
});

test("#2417 a legitimate `=======` divider inside a comment is not merge residue", () => {
  // MERGE_MARKER is anchored at line start AND requires a space or EOL after the
  // seventh character, so ordinary prose dividers must survive.
  withMutation("delegatedGate", (source) => `${source}\n// =========== section divider ===========\n// ====== not a conflict ======\n`,
    green("prose divider"));
});

// ---------------------------------------------------------------------------
// 2. TYPESCRIPT IS NEVER HANDED TO `node --check`.
// ---------------------------------------------------------------------------
test("#2417 no nodeCheck call site may hand a .ts path to the JS parser (version-independent)", () => {
  // The structural half. On node 22 the behavioural clause below cannot see this
  // regression, because `node --check` on an ESM .ts cannot fail there — so the
  // boundary has to be pinned at the call site instead. Excludes the declaration.
  const gate = fs.readFileSync(path.join(ROOT, GATE_REL), "utf8");
  const callSites = [...gate.matchAll(/(?<!function\s)\bnodeCheck\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(callSites.length >= 1, "no nodeCheck call site found — has the gate been restructured?");
  for (const args of callSites) {
    assert.match(args, /"\.mjs"/,
      `nodeCheck call site \`nodeCheck(${args})\` does not pin the ".mjs" extension. ` +
      "Handing a .ts path to `node --check` reds every PR on node 20 (class A) and is " +
      "an unfalsifiable green on node 22.");
    assert.doesNotMatch(args, /extname|\.ts/,
      `nodeCheck call site \`nodeCheck(${args})\` derives its extension instead of pinning ".mjs".`);
  }
});

test("#2417 non-JavaScript inside a .ts census file never moves the verdict (behavioural)", () => {
  // If any future edit parses .ts, node 20 turns this green run red.
  for (const key of ["authorization", "providerTest", "authorizationTest"]) {
    withMutation(key, (source) => `${source}\nfunction ( { ] }\n`, ({ exit, text }) => {
      assert.equal(exit, 0, `${key}: a .ts file was handed to a JS parser — this reds every PR on node 20.\n${text}`);
      assert.doesNotMatch(text, /does not parse/, `${key}: gate emitted a parse verdict for a .ts file`);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. PROCESS-LEVEL EXIT CONTRACT + FORWARD SAFETY.
// ---------------------------------------------------------------------------
test("#2417 forward-safety: adding a capability fails LOUDLY and names every stale census", () => {
  // #1971 / #1977 will add capabilities and tools. The gate must not merely be
  // non-zero (a crash is non-zero too) — it must name each downstream file whose
  // denominator went stale, or nobody can act on the red.
  withMutation("ledger", (source) => {
    const ledger = JSON.parse(source);
    const firstStatus = Object.keys(ledger.status_definitions)[0];
    ledger.capabilities.push({
      id: "ari.tester.synthetic_forward_capability",
      ari_tool: "tester_synthetic_forward_tool",
      status: firstStatus,
    });
    ledger.audit.capability_count += 1;
    ledger.audit.registered_tool_count += 1;
    ledger.audit.status_breakdown[firstStatus] += 1;
    return JSON.stringify(ledger, null, 2);
  }, ({ exit, text }) => {
    assert.equal(exit, 1, `forward-safety: expected a clean failure, got exit ${exit}\n${text}`);
    assert.match(text, /census FAIL:/, "forward-safety: gate crashed instead of failing cleanly");
    assert.doesNotMatch(text, /Cannot read|is not a function|undefined is not/, `gate crashed:\n${text}`);
    // Each downstream census must be named individually.
    for (const expected of [
      /authorization: 80 role declarations for 81 mapped ledger tools/,
      /delegated gate declarationCount: expected 81, got 80/,
      /provider test title: expected 81, got 80/,
      /provider test registry baseline: expected 81, got 80/,
      /authorization test AGENT_TOOLS: expected 81, got 80/,
      /authorization test AGENT_TOOL_AUTHORIZATION: expected 81, got 80/,
      /ledger tester capabilityCount: expected 121, got 120/,
      /pinned tool census differs from the canonical ledger \(missing tester_synthetic_forward_tool\)/,
    ]) {
      assert.match(text, expected, `forward-safety: gate did not name a stale census: ${expected}\n${text}`);
    }
  });
});

test("#2417 a status-count swap is caught by the KEYED breakdown, not by the multiset", () => {
  // The classification MESSAGE is asserted as a multiset, so a swap leaves it
  // matching. The keyed statusBreakdown census is what must catch it. If that
  // keyed check is ever relaxed to a multiset too, real drift goes silent.
  withMutation("ledger", (source) => {
    const ledger = JSON.parse(source);
    const order = Object.keys(ledger.status_definitions);
    const counts = Object.fromEntries(
      order.map((status) => [status, ledger.capabilities.filter((row) => row.status === status).length]),
    );
    const [a, b] = order.filter((status) => counts[status] > 0);
    for (const row of ledger.capabilities) {
      if (row.status === a) row.status = "__tester_swap_sentinel__";
      else if (row.status === b) row.status = a;
    }
    for (const row of ledger.capabilities) if (row.status === "__tester_swap_sentinel__") row.status = b;
    ledger.audit.status_breakdown[a] = counts[b];
    ledger.audit.status_breakdown[b] = counts[a];
    return JSON.stringify(ledger, null, 2);
  }, ({ exit, text }) => {
    assert.equal(exit, 1, `status swap escaped the census entirely:\n${text}`);
    assert.match(text, /ledger tester: statusBreakdown\.\w+ pins \d+, ledger says \d+/,
      `status swap was not caught by the keyed statusBreakdown check:\n${text}`);
  });
});

test("#2417 a corrupt ledger fails closed with a diagnosable message, never a stack trace", () => {
  withMutation("ledger", (source) => source.slice(0, -12), ({ exit, text }) => {
    assert.equal(exit, 1, `corrupt ledger did not fail:\n${text}`);
    assert.match(text, /ledger: invalid JSON/, `corrupt ledger produced an undiagnosable failure:\n${text}`);
  });
});
