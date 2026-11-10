#!/usr/bin/env node
// issue #3281 W6 — Ari experience parity.
//
// Every key the Business wizard sends (ExperienceCreatorWizard.buildPayload)
// must be reachable through Ari's experience tools, or be listed in
// ARI_REFUSES with a reason. Every wizard key must also be emitted by the
// latest issue_1973_current_experience_payload, the server read-back Ari's
// update path composes over. Mappings are explicit (WIZARD_TO_ARI): no key is
// matched by name alone, and an entry for a key the wizard no longer sends
// fails as stale. Any parsed key set that comes back empty fails closed.
//
// Paths: top-level keys are bare (`capacity_scope`); array item keys are
// `stops[].start_offset_minutes`; object keys are `cover.coverMediaUrl`.
// Ari targets are `<tool>:<path>`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const MIGRATIONS = "supabase/migrations";
const PAYLOAD_FN = "issue_1973_current_experience_payload";

function latestPayloadMigration() {
  const files = fs.readdirSync(path.join(ROOT, MIGRATIONS))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) =>
      read(`${MIGRATIONS}/${name}`).includes(`FUNCTION public.${PAYLOAD_FN}(`)
    );
  return files.length ? `${MIGRATIONS}/${files[files.length - 1]}` : null;
}

const payloadMigration = latestPayloadMigration();
const sources = {
  wizard: read("mingla-business/src/components/experience/ExperienceCreatorWizard.tsx"),
  wizardTypes: read("mingla-business/src/components/experience/experienceWizardTypes.ts"),
  tools: read("supabase/functions/_shared/agentTools.ts"),
  domain: read("supabase/functions/_shared/agentDomainTools.ts"),
  ari10x: read("supabase/functions/_shared/agentAri10xTools.ts"),
  payloadSql: payloadMigration ? read(payloadMigration) : "",
};

// Round 3 keys (#3281 R3): the wizard, the payload read-back and this guard's
// map must keep carrying them.
const ROUND3_KEYS = [
  "capacity_scope",
  "booking_spacing_minutes",
  "min_notice_minutes",
  "stops[].start_offset_minutes",
];

const GAP_3281 = "not yet exposed to Ari; tracked on #3281";

// Explicit wizard path -> Ari tool path, per Ari surface.
const id = (tool, keys) => Object.fromEntries(keys.map((k) => [k, `${tool}:${k}`]));
const PRICE_OPTION_KEYS = [
  "name", "price_cents", "price_basis", "capacity", "is_hidden",
  "group_max", "block_minutes", "min_blocks", "max_blocks",
].map((k) => `price_options[].${k}`);
const SWITCHES = {
  pass_tax: "set_pricing_switches:tax",
  pass_mingla_fee: "set_pricing_switches:mingla_fee",
  pass_service_fee: "set_pricing_switches:service_fee",
};
export const WIZARD_TO_ARI = {
  create: {
    ...id("create_experience", [
      "title", "experience_intents", "currency", "location_mode", "pricing_mode",
      "whole_price_cents", "is_free", "capacity", "capacity_scope",
      "booking_spacing_minutes", "min_notice_minutes", "stops", "whenMode",
      "when", "multiDates", "recurrence_rules", "timezone", "price_options",
      "cover",
      "stops[].place_id", "stops[].place_name",
      "stops[].address", "stops[].city", "stops[].region",
      "stops[].country_code", "stops[].lat", "stops[].lng",
      "stops[].coordinate_precision", "stops[].image_urls",
      "stops[].start_time", "stops[].price_cents", "stops[].ai_description",
      ...PRICE_OPTION_KEYS,
    ]),
    description: "create_experience:narrative",
    ...SWITCHES,
  },
  update: {
    ...id("update_experience", [
      "title", "description", "experience_intents", "currency", "location_mode", "pricing_mode",
      "whole_price_cents", "is_free", "capacity", "capacity_scope",
      "booking_spacing_minutes", "min_notice_minutes", "whenMode", "when",
      "multiDates", "recurrence_rules", "timezone", "price_options", "cover",
      ...PRICE_OPTION_KEYS,
    ]),
    stops: "manage_experience_stops:stops",
    ...SWITCHES,
  },
};

// Wizard paths whose whole subtree Ari takes verbatim as an untyped object.
// The guard proves the Ari side is still untyped and open; once Ari types it,
// this entry goes stale and each child key must be mapped.
export const ARI_OPAQUE = {
  create: {
    cover: "cover is passed through verbatim as the wizard's cover object",
  },
  update: {
    cover: "cover is passed through verbatim as the wizard's cover object",
    stops:
      "manage_experience_stops takes untyped stop objects; stop keys are not named in its schema (only in its description); tracked on #3281",
  },
};

// Wizard paths Ari does not carry, with the reason.
export const ARI_REFUSES = {
  create: {
    "stops[].stop_order":
      "create_experience orders stops by their array position; there is no explicit stop_order field",
    "stops[].start_offset_minutes": GAP_3281,
    "price_options[].id":
      "create has no stored options to reference; ids exist only after the draft is created",
  },
  update: {
    "price_options[].id": GAP_3281,
  },
};

// ---------------------------------------------------------------------------
// Minimal literal parser (TS object literals and SQL call arguments).
// ---------------------------------------------------------------------------

/** Index of the bracket that closes the one at `open`. Skips strings/comments. */
function matchClose(text, open) {
  const pairs = { "{": "}", "(": ")", "[": "]" };
  const stack = [];
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") { i = text.indexOf("\n", i); if (i < 0) return -1; continue; }
    if (c === "/" && next === "*") { i = text.indexOf("*/", i) + 1; if (i <= 0) return -1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" && c !== "'" ? 2 : 1;
      i = j;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === "}" || c === ")" || c === "]") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Split the inside of a bracket pair at depth-0 commas. */
function splitTopLevel(inner) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    const next = inner[i + 1];
    if (c === "/" && next === "/") { i = inner.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && next === "*") { i = inner.indexOf("*/", i) + 1; continue; }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < inner.length && inner[j] !== c) j += inner[j] === "\\" && c !== "'" ? 2 : 1;
      i = j;
      continue;
    }
    if ("{([".includes(c)) depth += 1;
    else if ("})]".includes(c)) depth -= 1;
    else if (c === "," && depth === 0) { parts.push(inner.slice(start, i)); start = i + 1; }
  }
  parts.push(inner.slice(start));
  return parts.map((p) => p.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").trim())
    .filter(Boolean);
}

/** Object literal starting at `open` ('{') -> Map(key -> value text). Spreads keep their text under "...". */
function objectEntries(text, open) {
  const close = matchClose(text, open);
  if (close < 0) return new Map();
  const out = new Map();
  let spread = 0;
  for (const part of splitTopLevel(text.slice(open + 1, close))) {
    if (part.startsWith("...")) { out.set(`...${spread++}`, part.slice(3).trim()); continue; }
    const m = part.match(/^(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*(:|$)/);
    if (!m) continue;
    const key = m[1] ?? m[2] ?? m[3];
    out.set(key, m[4] === ":" ? part.slice(m[0].length).trim() : key);
  }
  return out;
}

const literalKeys = (value) => {
  const open = value.indexOf("{");
  return open < 0 ? [] : [...objectEntries(value, open).keys()].filter((k) => !k.startsWith("..."));
};

// ---------------------------------------------------------------------------
// Wizard keys
// ---------------------------------------------------------------------------

function wizardPaths(s, failures) {
  const start = s.wizard.indexOf("const buildPayload = useCallback(");
  if (start < 0) { failures.push("wizard: buildPayload not found"); return new Set(); }
  const callOpen = s.wizard.indexOf("(", start);
  const body = s.wizard.slice(callOpen, matchClose(s.wizard, callOpen) + 1);
  let top = null;
  let optionReturn = null;
  for (const m of body.matchAll(/return\s*\{/g)) {
    const entries = objectEntries(body, m.index + m[0].length - 1);
    if (entries.has("title")) top = entries;
    else if (entries.has("price_cents") && !optionReturn) optionReturn = entries;
  }
  const paths = new Set();
  if (!top) { failures.push("wizard: buildPayload return object not found"); return paths; }
  for (const [key, value] of top) {
    if (key.startsWith("...")) {
      // conditional spread, e.g. ...(x ? { price_options: x } : {})
      for (const k of literalKeys(value)) paths.add(k);
      continue;
    }
    paths.add(key);
  }
  // stops[] — the object literal returned by stops.map(...)
  const stopsValue = top.get("stops") ?? "";
  const stopKeys = literalKeys(stopsValue.slice(stopsValue.indexOf("({") + 1));
  if (stopKeys.length === 0) failures.push("wizard: parsed no stops[] keys (fail closed)");
  for (const k of stopKeys) paths.add(`stops[].${k}`);
  // cover.*
  const coverKeys = literalKeys(top.get("cover") ?? "");
  if (coverKeys.length === 0) failures.push("wizard: parsed no cover keys (fail closed)");
  for (const k of coverKeys) paths.add(`cover.${k}`);
  // price_options[] — the map's return + priceOptionToPayload's literals
  const optionKeys = new Set();
  if (optionReturn) {
    for (const [key, value] of optionReturn) {
      if (key.startsWith("...")) literalKeys(value).forEach((k) => optionKeys.add(k));
      else optionKeys.add(key);
    }
  }
  const fnStart = s.wizardTypes.indexOf("export const priceOptionToPayload");
  if (fnStart >= 0) {
    const arrow = s.wizardTypes.indexOf("=> {", fnStart);
    const fnBody = s.wizardTypes.slice(arrow, matchClose(s.wizardTypes, arrow + 3) + 1);
    for (const m of fnBody.matchAll(/(?:=|return)\s*\{/g)) {
      for (const k of objectEntries(fnBody, m.index + m[0].length - 1).keys()) {
        if (!k.startsWith("...")) optionKeys.add(k);
      }
    }
  }
  if (optionKeys.size === 0) failures.push("wizard: parsed no price_options[] keys (fail closed)");
  for (const k of optionKeys) paths.add(`price_options[].${k}`);
  if (paths.size === 0) failures.push("wizard: parsed no keys (fail closed)");
  return paths;
}

// ---------------------------------------------------------------------------
// Ari tool schemas
// ---------------------------------------------------------------------------

/** Schema properties literal -> Map(path -> {opaque, open}). */
function schemaPaths(text, open, prefix = "", out = new Map()) {
  for (const [key, value] of objectEntries(text, open)) {
    if (key.startsWith("...")) continue;
    const here = `${prefix}${key}`;
    const node = value.startsWith("{") ? objectEntries(value, 0) : new Map();
    let child = node.get("properties");
    let childPrefix = `${here}.`;
    let shape = node;
    const items = node.get("items");
    if (!child && items?.startsWith("{")) {
      shape = objectEntries(items, 0);
      child = shape.get("properties");
      childPrefix = `${here}[].`;
    }
    const isObjectLike = /"object"/.test(shape.get("type") ?? "");
    out.set(here, {
      opaque: isObjectLike && !child,
      open: !/^false$/.test(shape.get("additionalProperties") ?? ""),
    });
    if (child?.startsWith("{")) schemaPaths(child, 0, childPrefix, out);
  }
  return out;
}

function writeToolProps(domain, constName) {
  const at = domain.indexOf(`const ${constName} = writeTool(`);
  if (at < 0) return null;
  const callOpen = domain.indexOf("(", at);
  const close = matchClose(domain, callOpen);
  const args = splitTopLevel(domain.slice(callOpen + 1, close));
  return args[2]?.startsWith("{") ? args[2] : null;
}

function ariSurfaces(s, failures) {
  const tools = new Map();
  const createAt = s.tools.indexOf("const createExperience: AgentToolDefinition = {");
  let createProps = null;
  if (createAt >= 0) {
    const objOpen = s.tools.indexOf("{", createAt);
    const def = objectEntries(s.tools, objOpen);
    const params = def.get("parameters");
    createProps = params?.startsWith("{") ? objectEntries(params, 0).get("properties") : null;
  }
  const sourcesByTool = {
    create_experience: createProps,
    update_experience: writeToolProps(s.domain, "updateExperience"),
    manage_experience_stops: writeToolProps(s.domain, "manageExperienceStops"),
    set_pricing_switches: writeToolProps(s.domain, "setPricingSwitches"),
  };
  for (const [tool, props] of Object.entries(sourcesByTool)) {
    const paths = props?.startsWith("{") ? schemaPaths(props, 0) : new Map();
    if (paths.size === 0) failures.push(`${tool}: parsed no schema properties (fail closed)`);
    tools.set(tool, paths);
  }
  for (const name of ["create_experience", "update_experience", "manage_experience_stops"]) {
    if (!s.ari10x.includes(`"${name}"`)) {
      failures.push(`agentAri10xTools: capability catalogue no longer lists ${name}`);
    }
  }
  return tools;
}

// ---------------------------------------------------------------------------
// Payload read-back keys (latest issue_1973_current_experience_payload)
// ---------------------------------------------------------------------------

function sqlBuildKeys(text, open) {
  const close = matchClose(text, open);
  const args = splitTopLevel(text.slice(open + 1, close));
  const out = new Map();
  for (let i = 0; i + 1 < args.length; i += 2) {
    const m = args[i].match(/^'(\w+)'$/);
    if (m) out.set(m[1], args[i + 1]);
  }
  return out;
}

function payloadPaths(s, failures) {
  const paths = new Set();
  const marker = `CREATE OR REPLACE FUNCTION public.${PAYLOAD_FN}(`;
  const start = s.payloadSql.lastIndexOf(marker);
  if (start < 0) { failures.push(`${PAYLOAD_FN}: definition not found (fail closed)`); return paths; }
  const end = s.payloadSql.indexOf("$$;", start);
  const fn = s.payloadSql.slice(start, end < 0 ? undefined : end);
  const ret = fn.search(/RETURN\s+jsonb_build_object\(/);
  if (ret < 0) { failures.push(`${PAYLOAD_FN}: RETURN jsonb_build_object not found`); return paths; }
  const top = sqlBuildKeys(fn, fn.indexOf("(", ret));
  for (const [key, value] of top) {
    paths.add(key);
    if (value.startsWith("jsonb_build_object(")) {
      for (const k of sqlBuildKeys(value, value.indexOf("(")).keys()) paths.add(`${key}.${k}`);
    }
    const ident = value.match(/^(v_\w+)$/)?.[1];
    if (ident) {
      const into = fn.search(new RegExp(`INTO\\s+${ident}\\b`));
      const agg = into < 0 ? -1 : fn.lastIndexOf("jsonb_build_object(", into);
      if (agg >= 0) {
        for (const k of sqlBuildKeys(fn, fn.indexOf("(", agg)).keys()) paths.add(`${key}[].${k}`);
      }
    }
  }
  if (paths.size === 0) failures.push(`${PAYLOAD_FN}: parsed no keys (fail closed)`);
  return paths;
}

// ---------------------------------------------------------------------------

function check(s, config = { WIZARD_TO_ARI, ARI_REFUSES, ARI_OPAQUE }) {
  const failures = [];
  const wizard = wizardPaths(s, failures);
  const ari = ariSurfaces(s, failures);
  const payload = payloadPaths(s, failures);

  for (const key of ROUND3_KEYS) {
    if (!wizard.has(key)) failures.push(`round 3 key ${key} no longer sent by the wizard`);
  }
  for (const key of wizard) {
    if (!payload.has(key)) failures.push(`${PAYLOAD_FN}: does not emit wizard key ${key}`);
  }

  for (const surface of ["create", "update"]) {
    const map = config.WIZARD_TO_ARI[surface] ?? {};
    const refuses = config.ARI_REFUSES[surface] ?? {};
    const opaque = config.ARI_OPAQUE[surface] ?? {};
    for (const [label, table] of [["WIZARD_TO_ARI", map], ["ARI_REFUSES", refuses], ["ARI_OPAQUE", opaque]]) {
      for (const key of Object.keys(table)) {
        if (!wizard.has(key)) failures.push(`${surface}: stale ${label} entry ${key} (wizard no longer sends it)`);
      }
    }
    for (const [key, reason] of [...Object.entries(refuses), ...Object.entries(opaque)]) {
      if (typeof reason !== "string" || reason.trim().length < 10) {
        failures.push(`${surface}: ${key} needs a real reason`);
      }
    }
    for (const key of Object.keys(refuses)) {
      if (map[key]) failures.push(`${surface}: ${key} is both mapped and refused`);
    }
    for (const [key, target] of Object.entries(map)) {
      const [tool, ariPath] = String(target).split(":");
      const node = ari.get(tool)?.get(ariPath);
      if (!node) failures.push(`${surface}: ${key} -> ${target} is not in Ari's ${tool} schema`);
      else if (opaque[key] && !(node.opaque && node.open)) {
        failures.push(`${surface}: ARI_OPAQUE ${key} -> ${target} is now typed or closed; map its keys instead`);
      }
    }
    for (const key of Object.keys(opaque)) {
      if (!map[key]) failures.push(`${surface}: ARI_OPAQUE ${key} has no WIZARD_TO_ARI target`);
    }
    const opaqueRoots = Object.keys(opaque);
    for (const key of wizard) {
      const covered = opaqueRoots.some((root) => key.startsWith(`${root}.`) || key.startsWith(`${root}[].`));
      if (covered) {
        if (map[key] || refuses[key]) failures.push(`${surface}: ${key} sits under an ARI_OPAQUE root; drop its entry`);
        continue;
      }
      if (!map[key] && !refuses[key]) {
        failures.push(`${surface}: wizard key ${key} is not carried by Ari (map it or add it to ARI_REFUSES with a reason)`);
      }
    }
  }
  return failures;
}

if (process.argv.includes("--self-test")) {
  const clone = (c) => JSON.parse(JSON.stringify(c));
  const base = { WIZARD_TO_ARI, ARI_REFUSES, ARI_OPAQUE };
  const withConfig = (mutate) => { const c = clone(base); mutate(c); return c; };
  const replaceOnce = (text, from, to) => {
    if (!text.includes(from)) throw new Error(`self-test fixture drift: ${from}`);
    return text.replace(from, to);
  };
  // [name, sources, config, expected failure substring]
  const mutations = [
    ["Ari create schema drops a wizard key", {
      ...sources,
      tools: replaceOnce(sources.tools, "      min_notice_minutes: {\n", "      removed_notice: {\n"),
    }, base, "min_notice_minutes -> create_experience:min_notice_minutes is not in"],
    ["Ari update schema drops a wizard key", {
      ...sources,
      domain: replaceOnce(sources.domain, "    capacity_scope: {\n", "    removed_scope: {\n"),
    }, base, "capacity_scope -> update_experience:capacity_scope is not in"],
    ["wizard sends a new key nobody mapped", {
      ...sources,
      wizard: replaceOnce(sources.wizard, "        capacity_scope: capacityScope,\n",
        "        capacity_scope: capacityScope,\n        brand_new_key: true,\n"),
    }, base, "create: wizard key brand_new_key is not carried by Ari"],
    ["wizard sends a new stop key nobody mapped", {
      ...sources,
      wizard: replaceOnce(sources.wizard, "          stop_order: i,\n",
        "          stop_order: i,\n          address_visibility: s.addressVisibility,\n"),
    }, base, "create: wizard key stops[].address_visibility is not carried by Ari"],
    ["new wizard key is also missing from the payload read-back", {
      ...sources,
      wizard: replaceOnce(sources.wizard, "        capacity_scope: capacityScope,\n",
        "        capacity_scope: capacityScope,\n        brand_new_key: true,\n"),
    }, base, "does not emit wizard key brand_new_key"],
    ["refusal with an empty reason", sources,
      withConfig((c) => { c.ARI_REFUSES.update["price_options[].id"] = " "; }),
      "update: price_options[].id needs a real reason"],
    ["stale refusal (wizard no longer sends the key)", sources,
      withConfig((c) => { c.ARI_REFUSES.create["stops[].retired_key"] = GAP_3281; }),
      "stale ARI_REFUSES entry stops[].retired_key"],
    ["stale map entry", sources,
      withConfig((c) => { c.WIZARD_TO_ARI.update.retired_key = "update_experience:title"; }),
      "stale WIZARD_TO_ARI entry retired_key"],
    ["refusal removed for a real gap", sources,
      withConfig((c) => { delete c.ARI_REFUSES.create["stops[].start_offset_minutes"]; }),
      "create: wizard key stops[].start_offset_minutes is not carried by Ari"],
    ["payload read-back drops a key", {
      ...sources,
      payloadSql: replaceOnce(sources.payloadSql, "'min_notice_minutes', COALESCE(v_event.min_notice_minutes, 120),\n", ""),
    }, base, "does not emit wizard key min_notice_minutes"],
    ["payload read-back drops a stop key", {
      ...sources,
      payloadSql: sources.payloadSql.replace(/'start_offset_minutes',s\.start_offset_minutes,\n\s*/g, ""),
    }, base, "does not emit wizard key stops[].start_offset_minutes"],
    ["wizard parser sees an empty set", {
      ...sources,
      wizard: sources.wizard.replace("const buildPayload = useCallback(", "const buildPayloadGone = useCallback("),
    }, base, "wizard: buildPayload not found"],
    ["wizard stops parser sees an empty set", {
      ...sources,
      wizard: (() => {
        // stops built by a helper: no literal stop object left to read
        const at = sources.wizard.indexOf("stops: stops.map((s, i) => ({");
        const open = sources.wizard.indexOf("(", at);
        return sources.wizard.slice(0, open) + "(toStopPayload)" +
          sources.wizard.slice(matchClose(sources.wizard, open) + 1);
      })(),
    }, base, "wizard: parsed no stops[] keys"],
    ["Ari schema parser sees an empty set", {
      ...sources,
      tools: sources.tools.replace("const createExperience: AgentToolDefinition = {", "const createExperienceGone = {"),
    }, base, "create_experience: parsed no schema properties"],
    ["payload parser sees an empty set", { ...sources, payloadSql: "" }, base,
      "definition not found (fail closed)"],
    ["opaque cover gets typed without mapping its keys", {
      ...sources,
      domain: replaceOnce(sources.domain, "    cover: { type: \"object\" },\n    edit_reason",
        "    cover: { type: \"object\", properties: { coverMediaUrl: { type: \"string\" } } },\n    edit_reason"),
    }, base, "ARI_OPAQUE cover -> update_experience:cover is now typed or closed"],
    ["capability catalogue drops update_experience", {
      ...sources,
      ari10x: sources.ari10x.replaceAll('"update_experience"', '"removed_update"'),
    }, base, "capability catalogue no longer lists update_experience"],
  ];
  const escaped = mutations.filter(([name, s, config, expect]) => {
    const found = check(s, config);
    const hit = found.find((f) => f.includes(expect));
    if (process.argv.includes("--verbose")) console.log(`  ${name}: ${hit ?? "ESCAPED"}`);
    return !hit;
  });
  if (check(sources).length !== 0) {
    console.error("issue-3281 ari parity self-test FAIL: the unmutated tree does not pass");
    process.exit(1);
  }
  if (escaped.length) {
    console.error(`issue-3281 ari parity self-test FAIL: escaped -> ${escaped.map(([n]) => n).join("; ")}`);
    process.exit(1);
  }
  console.log(`issue-3281 ari parity self-test PASS (${mutations.length} hostile mutations)`);
  process.exit(0);
}

// --dump prints the parsed key sets, for reviewing what the guard sees.
if (process.argv.includes("--dump")) {
  const notes = [];
  console.log("wizard:", [...wizardPaths(sources, notes)].join(" "));
  for (const [tool, paths] of ariSurfaces(sources, notes)) {
    const keys = [...paths].map(([k, v]) => (v.opaque ? `${k}(opaque${v.open ? "" : ",closed"})` : k));
    console.log(`${tool}:`, keys.join(" "));
  }
  console.log(`${PAYLOAD_FN}:`, [...payloadPaths(sources, notes)].join(" "));
  if (notes.length) console.log(notes.join("\n"));
  process.exit(0);
}

const failures = check(sources);
if (failures.length) {
  console.error("issue-3281 ari parity FAIL:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log(`issue-3281 ari parity PASS (payload read-back: ${payloadMigration})`);
