#!/usr/bin/env node

/**
 * #1970 / #424 Wave 0 — Ari tool registry ↔ CAPABILITIES sync.
 *
 * Every `name: "..."` on an AgentTool in agentTools.ts (and agentDomainTools.ts)
 * MUST appear as a `- <name> —` line in the CAPABILITIES block of
 * agentSystemPrompt.ts. Drift (create_experience registered but not advertised)
 * is a recipe violation and a silent "I can't do that yet" failure.
 *
 * `--self-test` proves fail-on-revert: GOOD fixture silent; BAD1 missing
 * capability; BAD2 extra advertised name that is not registered.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const TOOL_FILES = [
  "supabase/functions/_shared/agentTools.ts",
  "supabase/functions/_shared/agentDomainTools.ts",
  "supabase/functions/_shared/agentSiteTools.ts",
];
const PROMPT_FILE = "supabase/functions/_shared/agentSystemPrompt.ts";

const NAME_RE = /^\s*name:\s*"([a-z][a-z0-9_]*)"\s*,/gm;
const WRITE_TOOL_RE = /writeTool\(\s*"([a-z][a-z0-9_]*)"/g;
const SITE_TOOL_RE = /\b(?:tool|publicationTool)\(\s*"([a-z][a-z0-9_]*)"/g;
const CAP_RE = /^-\s+([a-z][a-z0-9_]*)\s+—/gm;

function extractNames(source, regex) {
  const out = new Set();
  regex.lastIndex = 0;
  let m;
  while ((m = regex.exec(source))) out.add(m[1]);
  return out;
}

export function check(toolSources, promptSource, failures) {
  const registered = new Set();
  for (const src of toolSources) {
    for (const n of extractNames(src, NAME_RE)) registered.add(n);
    for (const n of extractNames(src, WRITE_TOOL_RE)) registered.add(n);
    for (const n of extractNames(src, SITE_TOOL_RE)) registered.add(n);
  }
  const advertised = extractNames(promptSource, CAP_RE);
  if (!/export const PROMPT_VERSION\s*=\s*"v\d+"/.test(promptSource)) {
    failures.push({ kind: "no_prompt_version", text: "PROMPT_VERSION missing or not vN" });
  }
  for (const n of registered) {
    if (!advertised.has(n)) {
      failures.push({ kind: "registered_not_advertised", name: n });
    }
  }
  for (const n of advertised) {
    if (!registered.has(n)) {
      failures.push({ kind: "advertised_not_registered", name: n });
    }
  }
}

if (process.argv.includes("--self-test")) {
  const self = [];

  const goodTools = [
    'name: "create_brand",\nname: "create_experience",\n',
  ];
  const goodPrompt =
    'export const PROMPT_VERSION = "v4";\nCAPABILITIES (your tools):\n- create_brand — create a brand\n- create_experience — draft an experience\n';
  let f = [];
  check(goodTools, goodPrompt, f);
  if (f.length) self.push("GOOD fixture wrongly flagged: " + JSON.stringify(f));

  f = [];
  check(
    ['name: "create_experience",\nname: "create_brand",\n'],
    'export const PROMPT_VERSION = "v4";\n- create_brand — create a brand\n',
    f,
  );
  if (!f.some((v) => v.kind === "registered_not_advertised" && v.name === "create_experience")) {
    self.push("BAD1 (create_experience registered but missing from CAPABILITIES) not flagged");
  }

  f = [];
  check(
    ['name: "create_brand",\n'],
    'export const PROMPT_VERSION = "v4";\n- create_brand — x\n- send_email — y\n',
    f,
  );
  if (!f.some((v) => v.kind === "advertised_not_registered" && v.name === "send_email")) {
    self.push("BAD2 (advertised send_email not in registry) not flagged");
  }

  if (self.length) {
    console.error("issue-1970-ari-capabilities-sync self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("issue-1970-ari-capabilities-sync self-test PASS (3/3 cases).");
  process.exit(0);
}

const toolSources = [];
for (const rel of TOOL_FILES) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) continue;
  toolSources.push(fs.readFileSync(abs, "utf8"));
}
const promptSource = fs.readFileSync(path.join(repoRoot, PROMPT_FILE), "utf8");
const violations = [];
check(toolSources, promptSource, violations);

if (violations.length) {
  console.error("issue-1970-ari-capabilities-sync: AGENT_TOOLS and CAPABILITIES drifted.");
  console.error("Every registered tool name must appear as `- <name> —` in agentSystemPrompt.ts.");
  console.error("Bump PROMPT_VERSION in the same PR.");
  for (const v of violations) {
    if (v.kind === "registered_not_advertised") {
      console.error(`  registered but not advertised: ${v.name}`);
    } else if (v.kind === "advertised_not_registered") {
      console.error(`  advertised but not registered: ${v.name}`);
    } else {
      console.error(`  ${v.kind}: ${v.text ?? v.name}`);
    }
  }
  process.exit(1);
}

console.log("issue-1970-ari-capabilities-sync OK: registry and CAPABILITIES match.");
process.exit(0);
