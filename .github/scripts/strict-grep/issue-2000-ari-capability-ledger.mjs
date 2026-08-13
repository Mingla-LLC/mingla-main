#!/usr/bin/env node

/**
 * Issue #2000 — canonical Ari capability-ledger contract.
 *
 * Registration is not verification. This gate keeps the Business operation
 * denominator, Ari registry, prompt advertisement, source references, status
 * semantics, and evidence tiers in one fail-closed contract.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const LEDGER_PATH = "docs/contracts/ari-capability-ledger.json";
const TOOL_PATHS = [
  "supabase/functions/_shared/agentTools.ts",
  "supabase/functions/_shared/agentDomainTools.ts",
];
const PROMPT_PATH = "supabase/functions/_shared/agentSystemPrompt.ts";

const STATUSES = new Set([
  "verified",
  "registered_unverified",
  "broken",
  "guided_handoff",
  "unsupported",
  "in_flight",
]);
const SAFETY = new Set(["read", "write", "money", "destructive"]);
const CONFIRMATION = new Set(["none", "standard", "type_to_confirm", "guided_handoff"]);
const PHASES = new Set(["pre_1986", "pr_1986", "post_1986", "open_work"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);
const SURFACES = new Set(["business_ios", "business_android", "business_web"]);
const EVIDENCE_TIERS = new Set([
  "registration",
  "source_contract",
  "regression",
  "deployed_runtime",
  "production_observation",
]);

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

export function extractRegisteredTools(toolSources) {
  const names = new Set();
  const patterns = [
    /^\s*name:\s*"([a-z][a-z0-9_]*)"\s*,/gm,
    /writeTool\(\s*"([a-z][a-z0-9_]*)"/g,
  ];
  for (const source of toolSources) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(source))) names.add(match[1]);
    }
  }
  return names;
}

export function extractPromptTools(promptSource) {
  const names = new Set();
  const pattern = /^-\s+([a-z][a-z0-9_]*)\s+—/gm;
  let match;
  while ((match = pattern.exec(promptSource))) names.add(match[1]);
  return names;
}

function addSetDiff(failures, left, right, message) {
  for (const value of left) {
    if (!right.has(value)) failures.push(`${message}: ${value}`);
  }
}

function validateRef(root, ref, label, failures) {
  if (!ref || typeof ref.path !== "string" || typeof ref.symbol !== "string") {
    failures.push(`${label}: source reference requires path + symbol`);
    return;
  }
  const absolute = path.join(root, ref.path);
  if (!fs.existsSync(absolute)) {
    failures.push(`${label}: source path does not exist: ${ref.path}`);
    return;
  }
  const source = fs.readFileSync(absolute, "utf8");
  if (!source.includes(ref.symbol)) {
    failures.push(`${label}: symbol "${ref.symbol}" is stale in ${ref.path}`);
  }
}

export function validateLedger({ root, ledger, registered, advertised }) {
  const failures = [];
  if (ledger.schema_version !== 1) failures.push("schema_version must equal 1");
  if (!/^[0-9a-f]{40}$/.test(ledger.audit?.baseline_sha ?? "")) {
    failures.push("audit.baseline_sha must be a full immutable Git SHA");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(ledger.audit?.verified_at ?? "")) {
    failures.push("audit.verified_at must be UTC second precision");
  }
  if (!Array.isArray(ledger.operation_universe?.source_roots) || ledger.operation_universe.source_roots.length === 0) {
    failures.push("operation_universe.source_roots must declare a non-empty denominator");
  } else {
    for (const sourceRoot of ledger.operation_universe.source_roots) {
      if (typeof sourceRoot !== "string" || !fs.existsSync(path.join(root, sourceRoot))) {
        failures.push(`operation universe source root is stale: ${sourceRoot}`);
      }
    }
  }
  if (!Array.isArray(ledger.operation_universe?.exclusions) || ledger.operation_universe.exclusions.length === 0) {
    failures.push("operation_universe.exclusions must be explicit");
  }
  if (!Array.isArray(ledger.capabilities) || ledger.capabilities.length === 0) {
    failures.push("capabilities must be a non-empty array");
    return failures;
  }

  const ids = new Set();
  const mappedTools = new Map();
  for (const capability of ledger.capabilities) {
    const label = capability?.id ?? "<missing-id>";
    if (!/^ari\.[a-z0-9]+(?:\.[a-z0-9_]+)+$/.test(label)) failures.push(`${label}: invalid stable capability id`);
    if (ids.has(label)) failures.push(`${label}: duplicate capability id`);
    ids.add(label);
    for (const field of ["domain", "outcome", "required_role", "verified_at"]) {
      if (typeof capability?.[field] !== "string" || capability[field].length === 0) failures.push(`${label}: missing ${field}`);
    }
    if (!STATUSES.has(capability.status)) failures.push(`${label}: invalid status ${capability.status}`);
    if (!SAFETY.has(capability.safety)) failures.push(`${label}: invalid safety ${capability.safety}`);
    if (!CONFIRMATION.has(capability.confirmation)) failures.push(`${label}: invalid confirmation ${capability.confirmation}`);
    if (!PHASES.has(capability.provenance?.phase)) failures.push(`${label}: invalid provenance phase`);
    if (!CONFIDENCE.has(capability.confidence)) failures.push(`${label}: invalid confidence`);
    if (!Array.isArray(capability.surfaces) || capability.surfaces.length === 0 || capability.surfaces.some((s) => !SURFACES.has(s))) {
      failures.push(`${label}: surfaces must use the declared Business surface set`);
    }
    if (!Array.isArray(capability.owners?.ui) || capability.owners.ui.length === 0) failures.push(`${label}: missing UI owner path`);
    else for (const uiPath of capability.owners.ui) if (!fs.existsSync(path.join(root, uiPath))) failures.push(`${label}: UI owner path is stale: ${uiPath}`);
    if (!Array.isArray(capability.owners?.source) || capability.owners.source.length === 0) failures.push(`${label}: missing canonical source owner`);
    else capability.owners.source.forEach((ref, index) => validateRef(root, ref, `${label}.owners.source[${index}]`, failures));

    const tool = capability.ari_tool;
    if (tool !== null && typeof tool !== "string") failures.push(`${label}: ari_tool must be string or null`);
    if (typeof tool === "string") {
      const rows = mappedTools.get(tool) ?? [];
      rows.push(label);
      mappedTools.set(tool, rows);
      if (!registered.has(tool)) failures.push(`${label}: maps nonexistent registered tool ${tool}`);
      if (!advertised.has(tool)) failures.push(`${label}: mapped tool is absent from prompt ${tool}`);
    }

    if (["verified", "registered_unverified", "broken"].includes(capability.status) && typeof tool !== "string") {
      failures.push(`${label}: ${capability.status} requires a registered tool`);
    }
    if (["unsupported", "in_flight"].includes(capability.status) && tool !== null) {
      failures.push(`${label}: ${capability.status} cannot claim a registered tool`);
    }
    if (capability.status === "guided_handoff") {
      validateRef(root, capability.guided_handoff, `${label}.guided_handoff`, failures);
      if (capability.confirmation !== "guided_handoff") failures.push(`${label}: guided handoff requires guided_handoff confirmation`);
    } else if (capability.guided_handoff != null) {
      failures.push(`${label}: only guided_handoff status may declare a handoff target`);
    }
    if (capability.status === "broken" && (!Array.isArray(capability.owning_issues) || capability.owning_issues.length === 0)) {
      failures.push(`${label}: broken status requires an owning issue`);
    }
    if (capability.status === "in_flight") {
      if (!Array.isArray(capability.owning_issues) || capability.owning_issues.length === 0) failures.push(`${label}: in_flight requires an open owning issue reference`);
      if (capability.provenance?.phase !== "open_work") failures.push(`${label}: in_flight provenance must be open_work`);
    }
    if (!Array.isArray(capability.owning_issues) || capability.owning_issues.some((n) => !Number.isInteger(n) || n < 1)) {
      failures.push(`${label}: owning_issues must be positive issue numbers`);
    }
    if (!Array.isArray(capability.evidence) || capability.evidence.length === 0) failures.push(`${label}: evidence must not be empty`);
    else {
      for (const evidence of capability.evidence) {
        if (!EVIDENCE_TIERS.has(evidence.tier)) failures.push(`${label}: invalid evidence tier ${evidence.tier}`);
        if (!/^[0-9a-f]{40}$/.test(evidence.sha ?? "")) failures.push(`${label}: evidence requires an immutable SHA`);
        if (typeof evidence.reference !== "string" || evidence.reference.length === 0) failures.push(`${label}: evidence requires a reference`);
      }
    }

    if (capability.status === "verified") {
      const regressions = capability.evidence.filter((e) => e.tier === "regression");
      const roles = new Set(regressions.map((e) => e.guard_role));
      const guardRefs = new Set(regressions.map((e) => e.reference));
      if (!roles.has("implementor") || !roles.has("independent_tester") || guardRefs.size < 2) {
        failures.push(`${label}: verified requires distinct implementor + independent tester regression evidence`);
      }
      if (!capability.evidence.some((e) => e.tier === "deployed_runtime")) failures.push(`${label}: verified requires exact-revision deployed runtime evidence`);
      const observed = new Set(capability.evidence.filter((e) => e.tier === "production_observation").flatMap((e) => e.surfaces ?? []));
      for (const surface of capability.surfaces) if (!observed.has(surface)) failures.push(`${label}: verified lacks production observation for ${surface}`);
    }
  }

  for (const [tool, rows] of mappedTools) {
    if (rows.length !== 1) failures.push(`registered tool ${tool} maps ${rows.length} times: ${rows.join(", ")}`);
  }
  addSetDiff(failures, registered, new Set(mappedTools.keys()), "registered tool is absent from ledger");
  addSetDiff(failures, advertised, registered, "prompt advertises nonexistent tool");
  addSetDiff(failures, registered, advertised, "registered tool is absent from prompt");
  if (ledger.audit?.registered_tool_count !== registered.size) failures.push(`audit.registered_tool_count ${ledger.audit?.registered_tool_count} != ${registered.size}`);
  if (ledger.audit?.capability_count !== ledger.capabilities.length) failures.push(`audit.capability_count ${ledger.audit?.capability_count} != ${ledger.capabilities.length}`);
  const actualBreakdown = Object.fromEntries([...STATUSES].map((status) => [status, ledger.capabilities.filter((c) => c.status === status).length]));
  for (const status of STATUSES) {
    if (ledger.audit?.status_breakdown?.[status] !== actualBreakdown[status]) failures.push(`audit.status_breakdown.${status} is stale`);
  }
  return failures;
}

export function audit(root = ROOT, overrides = {}) {
  const ledger = overrides.ledger ?? JSON.parse(read(root, LEDGER_PATH));
  const toolSources = overrides.toolSources ?? TOOL_PATHS.map((relative) => read(root, relative));
  const promptSource = overrides.promptSource ?? read(root, PROMPT_PATH);
  return validateLedger({
    root,
    ledger,
    registered: extractRegisteredTools(toolSources),
    advertised: extractPromptTools(promptSource),
  });
}

function expectMutation(name, mutate, predicate) {
  const ledger = JSON.parse(read(ROOT, LEDGER_PATH));
  const overrides = { ledger };
  mutate(overrides);
  const failures = audit(ROOT, overrides);
  if (!failures.some(predicate)) throw new Error(`${name}: mutation passed or wrong failure: ${failures.join("; ")}`);
}

function selfTest() {
  const clean = audit(ROOT);
  if (clean.length) throw new Error(`clean ledger failed: ${clean.join("; ")}`);
  expectMutation("missing tool mapping", ({ ledger }) => {
    const row = ledger.capabilities.find((c) => c.ari_tool);
    row.ari_tool = null;
  }, (failure) => failure.includes("requires a registered tool") || failure.includes("absent from ledger"));
  expectMutation("duplicate alias", ({ ledger }) => {
    ledger.capabilities.find((c) => c.ari_tool === null).ari_tool = ledger.capabilities.find((c) => c.ari_tool).ari_tool;
  }, (failure) => failure.includes("maps 2 times"));
  expectMutation("status laundering", ({ ledger }) => {
    ledger.capabilities.find((c) => c.status === "broken").status = "verified";
    ledger.audit.status_breakdown.broken--;
    ledger.audit.status_breakdown.verified++;
  }, (failure) => failure.includes("verified requires"));
  expectMutation("stale symbol", ({ ledger }) => {
    ledger.capabilities[0].owners.source[0].symbol = "symbol_that_does_not_exist";
  }, (failure) => failure.includes("symbol") && failure.includes("stale"));
  expectMutation("missing guided route", ({ ledger }) => {
    ledger.capabilities.find((c) => c.status === "guided_handoff").guided_handoff.path = "missing/route.tsx";
  }, (failure) => failure.includes("source path does not exist"));
  expectMutation("duplicate id", ({ ledger }) => {
    ledger.capabilities[1].id = ledger.capabilities[0].id;
  }, (failure) => failure.includes("duplicate capability id"));
  const promptSource = read(ROOT, PROMPT_PATH);
  const firstTool = [...extractPromptTools(promptSource)][0];
  const promptWithoutTool = promptSource.replace(new RegExp(`^- ${firstTool} —.*$`, "m"), "");
  const promptFailures = audit(ROOT, { promptSource: promptWithoutTool });
  if (!promptFailures.some((failure) => failure.includes("absent from prompt"))) throw new Error("prompt drift mutation passed");
  console.log("[issue-2000-ari-capability-ledger] self-test PASS (7 hostile mutations)");
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures = audit(ROOT);
  if (failures.length) {
    failures.forEach((failure) => console.error(`[issue-2000-ari-capability-ledger] FAIL: ${failure}`));
    process.exit(1);
  }
  const ledger = JSON.parse(read(ROOT, LEDGER_PATH));
  console.log(`[issue-2000-ari-capability-ledger] PASS: ${ledger.capabilities.length} capabilities, ${ledger.audit.registered_tool_count} registered tools, complete bijection`);
}
