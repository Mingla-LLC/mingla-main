#!/usr/bin/env node
import fs from "node:fs";

const PATHS = Object.freeze({
  ledger: "docs/contracts/ari-capability-ledger.json",
  ledgerTester: ".github/scripts/strict-grep/__tests__/issue-2000-ari-capability-ledger.tester.test.mjs",
  delegatedGate: ".github/scripts/strict-grep/issue-2019-ari-delegated-auth.mjs",
  authorization: "supabase/functions/_shared/agentToolAuthorization.ts",
  providerTest: "supabase/functions/_shared/__tests__/issue_1999_ari_provider_schema_contract.test.ts",
  authorizationTest: "supabase/functions/_shared/__tests__/issue_2019_agent_authorization.test.ts",
});

const readSources = () => Object.fromEntries(
  Object.entries(PATHS).map(([key, file]) => [key, fs.readFileSync(file, "utf8")]),
);

function stripTriviaAndLiterals(source) {
  let output = "";
  let state = "code";
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (state === "code") {
      if (char === "/" && next === "/") {
        output += "  ";
        state = "line-comment";
        i += 1;
      } else if (char === "/" && next === "*") {
        output += "  ";
        state = "block-comment";
        i += 1;
      } else if (char === "'" || char === '"' || char === "`") {
        output += " ";
        state = char;
      } else if (char === "/") {
        output += " ";
        state = "regex";
      } else {
        output += char;
      }
      continue;
    }

    if (state === "line-comment") {
      output += char === "\n" ? "\n" : " ";
      if (char === "\n") state = "code";
      continue;
    }

    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        output += "  ";
        state = "code";
        i += 1;
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (state === "regex") {
      if (char === "\\") {
        output += " ";
        if (i + 1 < source.length) {
          output += source[i + 1] === "\n" ? "\n" : " ";
          i += 1;
        }
      } else if (char === "[") {
        output += " ";
        state = "regex-class";
      } else if (char === "/") {
        output += " ";
        state = "code";
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (state === "regex-class") {
      if (char === "\\") {
        output += " ";
        if (i + 1 < source.length) {
          output += source[i + 1] === "\n" ? "\n" : " ";
          i += 1;
        }
      } else if (char === "]") {
        output += " ";
        state = "regex";
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (char === "\\") {
      output += " ";
      if (i + 1 < source.length) {
        output += source[i + 1] === "\n" ? "\n" : " ";
        i += 1;
      }
    } else if (char === state) {
      output += " ";
      state = "code";
    } else {
      output += char === "\n" ? "\n" : " ";
    }
  }
  return output;
}

function syntaxCollisionFailures(label, source) {
  const failures = [];
  const stripped = stripTriviaAndLiterals(source);
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  for (let i = 0; i < stripped.length; i += 1) {
    const char = stripped[i];
    if ("([{ ".includes(char) && char !== " ") stack.push({ char, index: i });
    if (pairs[char]) {
      const opener = stack.pop();
      if (!opener || opener.char !== pairs[char]) {
        failures.push(`${label}: delimiter collision near byte ${i}`);
        break;
      }
    }
  }
  if (stack.length) failures.push(`${label}: unclosed delimiter collision`);

  const scopes = [new Set()];
  const tokens = stripped.match(/[A-Za-z_$][\w$]*|[{}]/g) ?? [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "{") {
      scopes.push(new Set());
      continue;
    }
    if (token === "}") {
      if (scopes.length > 1) scopes.pop();
      continue;
    }
    if (!["const", "let", "var", "function", "class"].includes(token)) continue;
    const name = tokens[i + 1];
    if (!name || name === "{" || name === "}") continue;
    const scope = scopes[scopes.length - 1];
    if (scope.has(name)) failures.push(`${label}: duplicate declaration ${name}`);
    scope.add(name);
  }
  return failures;
}

function numbers(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => Number(match[1]));
}

function requireCanonicalNumbers(failures, label, values, expected, occurrences = 1) {
  if (values.length !== occurrences) {
    failures.push(`${label}: expected ${occurrences} census assertion(s), got ${values.length}`);
    return;
  }
  if (values.some((value) => value !== expected)) {
    failures.push(`${label}: expected only ${expected}, got ${values.join(",")}`);
  }
}

function checkSources(sources) {
  const failures = [];
  let ledger;
  try {
    ledger = JSON.parse(sources.ledger);
  } catch (error) {
    return [`ledger: invalid JSON (${error.message})`];
  }

  const capabilities = Array.isArray(ledger.capabilities) ? ledger.capabilities : [];
  const mapped = capabilities.filter((row) => typeof row.ari_tool === "string");
  const canonicalTools = mapped.map((row) => row.ari_tool).sort();
  const toolCount = canonicalTools.length;
  const capabilityCount = capabilities.length;
  if (new Set(canonicalTools).size !== toolCount) failures.push("ledger: duplicate ari_tool mapping");

  for (const label of ["ledgerTester", "delegatedGate", "providerTest", "authorizationTest"]) {
    const source = sources[label];
    if (/^(<<<<<<<|=======|>>>>>>>)/m.test(source)) failures.push(`${label}: merge marker residue`);
    failures.push(...syntaxCollisionFailures(label, source));
  }

  const declarationCount = (sources.authorization.match(/:\s*role\("/g) ?? []).length;
  if (declarationCount !== toolCount) {
    failures.push(`authorization: ${declarationCount} declarations for ${toolCount} ledger tools`);
  }

  requireCanonicalNumbers(
    failures,
    "delegated gate",
    numbers(sources.delegatedGate, /declarationCount\s*!==\s*(\d+)/g),
    toolCount,
  );
  requireCanonicalNumbers(
    failures,
    "provider title",
    numbers(sources.providerTest, /all (\d+) actual Ari tools/g),
    toolCount,
  );
  requireCanonicalNumbers(
    failures,
    "provider assertion",
    numbers(sources.providerTest, /tools\.length,\s*(\d+),\s*"registry baseline/g),
    toolCount,
  );
  if ((sources.providerTest.match(/Deno\.test\(/g) ?? []).length !== 4) {
    failures.push("provider test: expected one four-case suite; possible duplicated test collision");
  }

  const authorizationCensuses = [
    ["AGENT_TOOLS", /AGENT_TOOLS\.length\s*===\s*(\d+)/g],
    ["unique tools", /\)\)\.size\s*===\s*(\d+)/g],
    ["authorization registry", /Object\.keys\(AGENT_TOOL_AUTHORIZATION\)\.length\s*===\s*(\d+)/g],
    ["ledger rows", /rows\.length\s*===\s*(\d+)/g],
  ];
  for (const [label, pattern] of authorizationCensuses) {
    requireCanonicalNumbers(
      failures,
      `authorization test ${label}`,
      numbers(sources.authorizationTest, pattern),
      toolCount,
    );
  }

  requireCanonicalNumbers(
    failures,
    "ledger tester capability denominator",
    numbers(sources.ledgerTester, /capabilityCount:\s*(\d+)/g),
    capabilityCount,
  );
  requireCanonicalNumbers(
    failures,
    "ledger tester tool message",
    numbers(sources.ledgerTester, /(\d+)-tool set changed/g),
    toolCount,
  );

  const namesBlock = sources.ledgerTester.match(/const EXPECTED_TOOL_NAMES = \[([\s\S]*?)\n\];/);
  const pinnedTools = namesBlock
    ? [...namesBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort()
    : [];
  if (JSON.stringify(pinnedTools) !== JSON.stringify(canonicalTools)) {
    failures.push("ledger tester: tool-name census differs from canonical ledger");
  }

  const statusBlock = sources.ledgerTester.match(/statusBreakdown:\s*Object\.freeze\(\{([\s\S]*?)\}\),/);
  const statusSource = statusBlock?.[1] ?? "";
  const statusOrder = [
    "verified",
    "registered_unverified",
    "broken",
    "guided_handoff",
    "unsupported",
    "in_flight",
  ];
  const statusCounts = Object.fromEntries(
    statusOrder.map((status) => [
      status,
      capabilities.filter((row) => row.status === status).length,
    ]),
  );
  for (const status of statusOrder) {
    requireCanonicalNumbers(
      failures,
      `ledger tester status ${status}`,
      numbers(statusSource, new RegExp(`(?:^|\\n)\\s*${status}:\\s*(\\d+)`, "g")),
      statusCounts[status],
    );
  }

  const classification = [
    statusCounts.broken,
    statusCounts.registered_unverified,
    statusCounts.unsupported,
    statusCounts.guided_handoff,
    statusCounts.in_flight,
    statusCounts.verified,
  ].join("/");
  const classificationMessages = [...sources.ledgerTester.matchAll(/(\d+\/\d+\/\d+\/\d+\/\d+\/\d+) classification changed/g)]
    .map((match) => match[1]);
  if (classificationMessages.length !== 1 || classificationMessages[0] !== classification) {
    failures.push(`ledger tester: expected one ${classification} classification message`);
  }

  return failures;
}

const sources = readSources();

if (process.argv.includes("--self-test")) {
  const mutations = [
    {
      ...sources,
      authorizationTest: sources.authorizationTest.replace(
        "  const rows = ledger.capabilities.filter",
        "  const rows = [];\n  const rows = ledger.capabilities.filter",
      ),
    },
    {
      ...sources,
      providerTest: sources.providerTest.replace(
        /tools\.length,\s*\d+,\s*"registry baseline/,
        'tools.length,\n    70,\n    "registry baseline',
      ),
    },
    {
      ...sources,
      delegatedGate: sources.delegatedGate.replace(
        "  if (declarationCount !== 71)",
        "  if (declarationCount !== 68) failures.push(`stale`);\n  if (declarationCount !== 71)",
      ),
    },
    {
      ...sources,
      ledgerTester: sources.ledgerTester.replace("    broken: 34,", "    broken: 34,\n    broken: 36,"),
    },
  ];
  const escaped = mutations.findIndex((mutation) => checkSources(mutation).length === 0);
  if (escaped >= 0) {
    console.error(`[issue-2417-ari-contract-collision-census] self-test FAIL: mutation ${escaped + 1} escaped`);
    process.exit(1);
  }
  console.log("[issue-2417-ari-contract-collision-census] self-test PASS (4 hostile collision mutations)");
  process.exit(0);
}

const failures = checkSources(sources);
if (failures.length) {
  console.error(
    "[issue-2417-ari-contract-collision-census] FAIL:\n" +
      failures.map((failure) => `  - ${failure}`).join("\n"),
  );
  process.exit(1);
}

console.log(
  "[issue-2417-ari-contract-collision-census] PASS: canonical ledger, provider, authorization, and tester censuses agree; declarations are collision-free",
);
