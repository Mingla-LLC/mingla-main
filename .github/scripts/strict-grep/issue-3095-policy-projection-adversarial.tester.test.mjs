// Issue #3095 — tester adversarial suite for the narrowed #2851 policy pin.
//
// #3095 changed PR_FAMILY_WITHOUT_CONCURRENCY_SHA256, in the #2851 implementor
// suite, from a whole-document digest into a POLICY PROJECTION: per PR-family
// workflow, its sorted trigger event keys, its job-level concurrency blocks and
// its job uses: values. A narrowed pin fails by missing something, so this
// suite assumes the narrowing is too narrow, or too wide, and attacks it from
// angles the implementor's controls do not take.
//
// It runs the GATE'S OWN code, not a replica. The Ruby canonicalizer, the digest
// and authority functions, the denied-workflow byte check, the revert-row table
// and the inverted loop body are read out of the implementor suite at run time
// and executed against mutated in-memory trees. Weaken any of them and a test
// below goes red:
//
//   1. job-level concurrency, which auditWorkflowSources never reads, must move
//      the pin in every shape a workflow can declare it: on an existing job, as
//      a bare string, as a cancel-in-progress flip on its own, and fed through a
//      YAML alias whose only edit is at the anchor;
//   2. equivalent spellings of the same trigger events (reordered blocks, the
//      quoted key, sequence form) must NOT move it;
//   3. top-level concurrency hidden in a string or behind an alias belongs to
//      the audit, which must catch it while the pin stays put;
//   4. job-level unconditional cancellation on a denied (non-PR) workflow is
//      invisible to the pin and the audit, so the denied byte authorities are
//      its only guard; a #3095-style narrowing of those hashes would lose it;
//   5. every inverted revert row must bite on a duplicated and on a deleted
//      line, and the inverted loop must reject a no-op row and a row whose
//      removal changes policy;
//   6. the accepted #3095 residual, pull-request activity types (T-A8), is safe
//      only because the #2881 draft-gate audit rejects a types edit on every
//      non-exempt pull-request lane, including one that keeps ready_for_review
//      and drops opened and synchronize, which only #2881's exactness check
//      (A2) can see. That premise is pinned here. The nine #2881 always-on
//      lanes are outside it by design; the two ruleset-required ones are pinned
//      separately, the pin-protected ones are not covered by this suite.
//
// Workflow files are never named literally: the CI-batch provider scanner
// treats a workflow filename in tracked source as provider evidence.
//
// Cost: Ruby canonicalization runs in batches (the live tree, then every
// variant at once) plus one #2851 audit and one #2881 audit over in-memory
// trees. No test here pins a literal that a workflow edit can move.

import { strict as assert } from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  auditWorkflowSources,
  LOAD_WORKFLOW,
  readWorkflowSources,
} from "./issue-2851-pr-concurrency-policy.mjs";
import {
  ALWAYS_ON,
  auditWorkflowSources as auditDraftGate,
} from "./issue-2881-pr-draft-gate-policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE_PATH = path.join(HERE, "issue-2851-pr-concurrency-policy.implementor.test.mjs");
const liveWorkflow = (...stemParts) => `${stemParts.join("-")}.${["y", "ml"].join("")}`;

const count = (source, needle) => source.split(needle).length - 1;
const countLines = (source, pattern) => (source.match(new RegExp(pattern.source, "gm")) || []).length;

function replaceOnce(source, needle, replacement, label) {
  assert.equal(count(source, needle), 1, `${label}: expected exactly one mutation anchor`);
  return source.replace(needle, () => replacement);
}

// ---------------------------------------------------------------------------
// The gate, loaded from its own source.
// ---------------------------------------------------------------------------

function exactlyOne(source, pattern, label) {
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  assert.equal(matches.length, 1, `${label}: expected exactly one occurrence in the #2851 implementor suite`);
  return matches[0];
}

function batchedRuby(program) {
  const cache = new Map();
  let spawns = 0;
  const warm = (sourceList) => {
    const missing = [...new Set(sourceList.filter((source) => !cache.has(source)))];
    if (missing.length === 0) return;
    const payload = Object.fromEntries(missing.map((source, index) => [`s${index}`, source]));
    const output = JSON.parse(execFileSync("ruby", ["-e", program], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    }));
    spawns += 1;
    missing.forEach((source, index) => cache.set(source, output[`s${index}`]));
  };
  // Stands in for execFileSync inside the gate's own canonicalize(). The Ruby
  // program's output for a file depends only on that file's source, so serving
  // a cached per-source result is byte-equivalent to the real call.
  const exec = (command, args, options) => {
    assert.equal(command, "ruby", "the gate must canonicalize through ruby");
    assert.deepEqual(args, ["-e", program], "the gate must run exactly its own RUBY_CANONICAL program");
    const input = JSON.parse(options.input);
    warm(Object.values(input));
    return JSON.stringify(Object.fromEntries(Object.entries(input).map(([name, source]) => [name, cache.get(source)])));
  };
  return { cache, warm, exec, spawnCount: () => spawns };
}

function loadGate() {
  const source = fs.readFileSync(GATE_PATH, "utf8");
  const ruby = exactlyOne(source, /const RUBY_CANONICAL = String\.raw`([^`]*)`;/, "RUBY_CANONICAL")[1];
  const pinned = exactlyOne(source, /"([0-9a-f]{64})";\nconst DENIED_FULL_SHA256 = \[/, "pinned projection literal")[1];
  const familyCount = Number(exactlyOne(source, /^const PR_FAMILY_COUNT = (\d+);$/m, "PR_FAMILY_COUNT")[1]);
  const identity = exactlyOne(source, /^const PR_FAMILY_IDENTITY_SHA256 =\s*"([0-9a-f]{64})";$/m, "PR_FAMILY_IDENTITY_SHA256")[1];
  const deniedText = exactlyOne(source, /^const DENIED = \[([\s\S]*?)\];$/m, "DENIED")[1];
  const deniedHashText = exactlyOne(source, /^const DENIED_FULL_SHA256 = \[([\s\S]*?)^\];$/m, "DENIED_FULL_SHA256")[1];
  const denied = new Function("liveWorkflow", `return [${deniedText}];`)(liveWorkflow);
  const deniedHashes = [...deniedHashText.matchAll(/"([0-9a-f]{64})"/g)].map((match) => match[1]);
  const fn = (name) => exactlyOne(source, new RegExp(`^function ${name}\\([^)]*\\) \\{\\n[\\s\\S]*?^\\}$`, "m"), `function ${name}`)[0];

  const ROW_TABLE_OPEN = "for (const [name, line] of [\n";
  assert.equal(count(source, ROW_TABLE_OPEN), 1, "revert-row table: expected exactly one");
  const tableStart = source.indexOf(ROW_TABLE_OPEN) + ROW_TABLE_OPEN.length;
  const tableEnd = source.indexOf("]) {\n", tableStart);
  const bodyEnd = source.indexOf("\n  }\n", tableEnd);
  assert.ok(tableEnd > tableStart && bodyEnd > tableEnd, "revert-row table and loop body must be locatable");
  const rows = new Function("liveWorkflow", `return [\n${source.slice(tableStart, tableEnd)}\n];`)(liveWorkflow);
  const loopBody = source.slice(tableEnd + "]) {\n".length, bodyEnd);

  const ruby$ = batchedRuby(ruby);
  const api = new Function(
    "assert", "crypto", "execFileSync", "RUBY_CANONICAL", "PR_FAMILY_COUNT", "PR_FAMILY_IDENTITY_SHA256",
    "PR_FAMILY_WITHOUT_CONCURRENCY_SHA256", "DENIED", "DENIED_FULL_SHA256",
    [fn("canonicalize"), fn("sha256"), fn("canonicalDigests"), fn("assertAuthority"), fn("assertDeniedAuthorities"),
      fn("removeExactLine"),
      "return { canonicalDigests, assertAuthority, assertDeniedAuthorities, removeExactLine };"].join("\n"),
  )(assert, crypto, ruby$.exec, ruby, familyCount, identity, pinned, denied, deniedHashes);
  const runLoopBody = new Function(
    "assert", "removeExactLine", "canonicalDigests", "sources", "liveDigests", "authority", "name", "line", loopBody,
  );
  return { ruby, ruby$, pinned, denied, deniedHashes, rows, runLoopBody, ...api };
}

// ---------------------------------------------------------------------------
// Structural probe selection. Never by workflow name, so no single lane's edit
// can break a control; every mutation asserts its anchor exists exactly once.
// ---------------------------------------------------------------------------

const ON_BLOCK = /^on:\n(?:(?:[ \t][^\n]*|#[^\n]*|)\n)*/m;
const onOf = (document) => (Object.hasOwn(document, "on") ? document.on : document.true);

function eventChunks(block) {
  const chunks = [];
  let prefix = "";
  for (const line of block.slice("on:\n".length).split(/(?<=\n)/)) {
    if (/^ {2}[A-Za-z_]+:/.test(line)) chunks.push(line);
    else if (chunks.length) chunks[chunks.length - 1] += line;
    else prefix += line;
  }
  return { prefix, chunks, order: chunks.map((chunk) => chunk.match(/^ {2}([A-Za-z_]+):/)[1]) };
}

function probeShape(name, source, canonical) {
  if (name === LOAD_WORKFLOW || !source.endsWith("\n") || /issue.?3095/i.test(source)) return null;
  if (countLines(source, /^on:\n/) !== 1 || countLines(source, /^jobs:\n/) !== 1) return null;
  if (countLines(source, /^concurrency:\n/) !== 1 || countLines(source, /^env:/) !== 0) return null;
  if (!canonical.events.includes("pull_request") || canonical.events.length < 2) return null;
  const block = source.match(ON_BLOCK)[0];
  if (/(?:^|\s)[&*][A-Za-z_][\w-]*\s*$/m.test(block)) return null;
  const { prefix, chunks, order } = eventChunks(block);
  if ([...order].sort().join(",") !== canonical.events.join(",")) return null;
  const policy = source.match(/^concurrency:\n {2}group: ([^\n]+)\n {2}cancel-in-progress: ([^\n]+)\n/m);
  if (!policy || source.indexOf("\nconcurrency:\n") > source.indexOf("\njobs:\n")) return null;
  const job = source.match(/^jobs:\n {2}([A-Za-z0-9_-]+):\n {4}\S/m);
  const jobValue = job && canonical.withoutConcurrency.jobs?.[job[1]];
  if (!jobValue || typeof jobValue !== "object" || Object.hasOwn(jobValue, "concurrency") || Object.hasOwn(jobValue, "uses")) return null;
  return {
    name, source, block, prefix, chunks, order,
    policyBlock: policy[0], group: policy[1], cancel: policy[2],
    job: job[1], jobHeader: `jobs:\n  ${job[1]}:\n`,
  };
}

const jobConcurrency = (group, cancel) => `    concurrency:\n      group: ${group}\n      cancel-in-progress: ${cancel}\n`;

let context;
function getContext() {
  if (context) return context;
  const gate = loadGate();
  const sources = readWorkflowSources();
  gate.ruby$.warm(Object.values(sources));
  const liveDigests = gate.canonicalDigests(sources);
  const authority = gate.assertAuthority(liveDigests.authority);
  const names = authority.names;

  const probes = names.map((name) => probeShape(name, sources[name], liveDigests.canonical[name])).filter(Boolean);
  assert.ok(probes.length >= 4, `need four structurally eligible PR-family probes, found ${probes.length}`);
  const [p0, p1, p2, p3] = probes;

  const withJob = (probe, text) => replaceOnce(probe.source, probe.jobHeader, `${probe.jobHeader}${text}`, `${probe.name} job header`);
  const withEnv = (probe, entry, source = probe.source) =>
    replaceOnce(source, "\nconcurrency:\n", `\nenv:\n  ${entry}\nconcurrency:\n`, `${probe.name} top-level policy`);

  const variants = {
    // (1) job-level concurrency shapes
    existingJob: withJob(p0, jobConcurrency("issue-3095-shared", true)),
    stringForm: withJob(p0, "    concurrency: issue-3095-shared\n"),
    cancelFalse: withJob(p0, jobConcurrency("issue-3095-shared", false)),
    cancelTrue: withJob(p0, jobConcurrency("issue-3095-shared", true)),
    aliasA: withEnv(p0, "ISSUE_3095_JOB_GROUP: &issue3095job issue-3095-shared-a", withJob(p0, jobConcurrency("*issue3095job", true))),
    aliasB: withEnv(p0, "ISSUE_3095_JOB_GROUP: &issue3095job issue-3095-shared-b", withJob(p0, jobConcurrency("*issue3095job", true))),
    // (2) equivalent event spellings
    reordered: replaceOnce(p0.source, p0.block, `on:\n${p0.prefix}${[...p0.chunks].reverse().map((chunk) => (chunk.endsWith("\n") ? chunk : `${chunk}\n`)).join("")}`, `${p0.name} on block`),
    quotedKey: replaceOnce(p0.source, "\non:\n", '\n"on":\n', `${p0.name} on key`),
    sequenceForm: replaceOnce(p0.source, p0.block, `on: [${p0.order.join(", ")}]\n\n`, `${p0.name} on block`),
    // (3) top-level concurrency the audit owns
    topString: replaceOnce(p1.source, p1.policyBlock, `concurrency: ${p1.group}\n`, `${p1.name} top-level policy`),
    topAliasCanonical: withEnv(p2, `ISSUE_3095_GROUP: &issue3095group ${p2.group}`,
      replaceOnce(p2.source, `\n  group: ${p2.group}\n`, "\n  group: *issue3095group\n", `${p2.name} group`)),
    topAliasShared: withEnv(p3, "ISSUE_3095_GROUP: &issue3095group issue-3095-shared-group",
      replaceOnce(p3.source, `\n  group: ${p3.group}\n`, "\n  group: *issue3095group\n", `${p3.name} group`)),
  };
  assert.equal(variants.aliasA.slice(variants.aliasA.indexOf("\njobs:\n")), variants.aliasB.slice(variants.aliasB.indexOf("\njobs:\n")),
    "alias probe: the job text must be byte-identical, so only the anchor moves");

  // (4) denied workflows gain job-level unconditional cancellation
  const deniedVariants = gate.denied.map((name) => {
    const source = sources[name];
    assert.equal(typeof source, "string", `${name}: denied workflow must exist`);
    const job = source.match(/^jobs:\n {2}([A-Za-z0-9_-]+):\n {4}\S/m);
    assert.ok(job && countLines(source, /^jobs:\n/) === 1, `${name}: denied workflow needs one jobs block with a job`);
    return [name, job[1], replaceOnce(source, `jobs:\n  ${job[1]}:\n`, `jobs:\n  ${job[1]}:\n${jobConcurrency("issue-3095-shared-denied", true)}`, `${name} job header`)];
  });

  // (5) rows: a no-op row and a policy-relevant row
  const noOpLine = "# issue-3095 tester: a comment-only revert row\n";
  const noOpSource = `${p0.source}${noOpLine}`;
  const dispatchLine = "  workflow_dispatch:\n";
  const dispatchName = names.find((name) => count(sources[name], dispatchLine) === 1
    && countLines(sources[name], /^ {2}workflow_dispatch:\n(?! {4})/) === 1
    && liveDigests.canonical[name].events.includes("workflow_dispatch"));
  assert.ok(dispatchName, "need a PR-family workflow with one bare workflow_dispatch event line");

  // (6) activity types on every non-exempt lane, and on the ruleset-required lanes
  const exempt = new Map(ALWAYS_ON.map((entry) => [entry.path, entry]));
  const gated = names.filter((name) => !exempt.has(name));
  assert.ok(gated.length >= 100, `the #2881 draft-gated set must stay populated, found ${gated.length}`);
  const typesTree = { ...sources };
  for (const name of gated) {
    const inline = countLines(sources[name], /^ {4}types: \[[^\]\n]*\]\n/);
    const block = countLines(sources[name], /^ {4}types:\n(?: {6}- [^\n]*\n)+/);
    assert.equal(inline + block, 1, `${name}: expected exactly one pull-request types declaration to mutate`);
    typesTree[name] = inline === 1
      ? sources[name].replace(/^ {4}types: \[[^\]\n]*\]\n/m, () => "    types: [ready_for_review]\n")
      : sources[name].replace(/^ {4}types:\n(?: {6}- [^\n]*\n)+/m, () => "    types: [ready_for_review]\n");
  }
  const required = ALWAYS_ON.filter((entry) => entry.kind === "ruleset-required").map((entry) => entry.path);
  assert.ok(required.length >= 2, "the ruleset-required always-on lanes must stay registered");
  for (const name of required) {
    typesTree[name] = replaceOnce(sources[name], "\n  pull_request:\n", "\n  pull_request:\n    types: [closed]\n", `${name} pull_request`);
  }

  gate.ruby$.warm([
    ...Object.values(variants), noOpSource, sources[dispatchName].replace(dispatchLine, () => ""),
    ...deniedVariants.map(([, , source]) => source), ...Object.values(typesTree),
  ]);
  context = {
    gate, sources, liveDigests, authority, names, probes: { p0, p1, p2, p3 }, variants, deniedVariants,
    noOpLine, noOpSource, dispatchName, dispatchLine, gated, required, typesTree,
  };
  return context;
}

const digestsWith = (ctx, overrides) => ctx.gate.canonicalDigests({ ...ctx.sources, ...overrides });
const documentOf = (digests, name) => digests.canonical[name].withoutConcurrency;

// ---------------------------------------------------------------------------

test("#3095 tester harness runs the gate's own derivation and reproduces its pinned projection", () => {
  const ctx = getContext();
  assert.equal(ctx.authority.withoutConcurrencySha256, ctx.gate.pinned);
  assert.equal(ctx.gate.deniedHashes.length, 7);
  ctx.gate.assertDeniedAuthorities(ctx.sources);
  assert.ok(ctx.gate.rows.length >= 54, `the inverted revert-row table only grows, found ${ctx.gate.rows.length}`);
  // The batch cache must be byte-equivalent to a real, unbatched call.
  const probe = ctx.probes.p0.name;
  const real = JSON.parse(execFileSync("ruby", ["-e", ctx.gate.ruby], {
    input: JSON.stringify({ live: ctx.sources[probe], alias: ctx.variants.aliasA }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }));
  assert.deepEqual(real.live, ctx.gate.ruby$.cache.get(ctx.sources[probe]));
  assert.deepEqual(real.alias, ctx.gate.ruby$.cache.get(ctx.variants.aliasA));
});

test("job-level concurrency the audit never reads moves the policy pin in every declared shape", () => {
  const ctx = getContext();
  const { p0 } = ctx.probes;
  const moved = (label, source, expectedConcurrency) => {
    const digests = digestsWith(ctx, { [p0.name]: source });
    assert.deepEqual(documentOf(digests, p0.name).jobs[p0.job].concurrency, expectedConcurrency, `${label}: mutation must parse as intended`);
    assert.deepEqual(digests.authority.names, ctx.authority.names, `${label}: PR-family membership must not change`);
    assert.equal(digests.authority.identitySha256, ctx.authority.identitySha256, `${label}: identity must not change`);
    assert.notEqual(digests.authority.withoutConcurrencySha256, ctx.authority.withoutConcurrencySha256, `${label} (${p0.name}): must move the policy projection`);
    assert.throws(() => ctx.gate.assertAuthority(digests.authority), /policy projection digest drifted/, label);
    return digests.authority.withoutConcurrencySha256;
  };

  moved("existing job gains unconditional cancellation", ctx.variants.existingJob, { group: "issue-3095-shared", "cancel-in-progress": true });
  moved("existing job gains string-form concurrency", ctx.variants.stringForm, "issue-3095-shared");

  const quiet = moved("existing job gains non-cancelling concurrency", ctx.variants.cancelFalse, { group: "issue-3095-shared", "cancel-in-progress": false });
  const loud = moved("existing job gains cancelling concurrency", ctx.variants.cancelTrue, { group: "issue-3095-shared", "cancel-in-progress": true });
  assert.notEqual(quiet, loud, "flipping only cancel-in-progress on a job-level group must move the policy projection");

  const aliasA = moved("alias-fed job group (anchor a)", ctx.variants.aliasA, { group: "issue-3095-shared-a", "cancel-in-progress": true });
  const aliasB = moved("alias-fed job group (anchor b)", ctx.variants.aliasB, { group: "issue-3095-shared-b", "cancel-in-progress": true });
  assert.notEqual(aliasA, aliasB, "an edit only at the YAML anchor that feeds a job-level group must move the policy projection");
});

test("equivalent spellings of the same trigger events leave the policy pin where it is", () => {
  const ctx = getContext();
  const { p0 } = ctx.probes;
  const liveEvents = ctx.liveDigests.canonical[p0.name].events;
  const liveOn = onOf(documentOf(ctx.liveDigests, p0.name));
  const unmoved = (label, source, applied) => {
    const digests = digestsWith(ctx, { [p0.name]: source });
    applied(documentOf(digests, p0.name));
    assert.deepEqual(digests.canonical[p0.name].events, liveEvents, `${label}: the event keys must be unchanged`);
    assert.notEqual(digests.documentSha256, ctx.liveDigests.documentSha256, `${label}: the respelling must change the parsed document`);
    assert.deepEqual(digests.authority, ctx.authority, `${label} (${p0.name}): must not move the policy projection`);
  };

  unmoved("event blocks reordered", ctx.variants.reordered, (document) => {
    assert.deepEqual(Object.keys(onOf(document)), [...p0.order].reverse());
  });
  unmoved("quoted on key", ctx.variants.quotedKey, (document) => {
    assert.ok(Object.hasOwn(document, "on") && !Object.hasOwn(document, "true"), "the quoted key must parse as the string on");
    assert.deepEqual(document.on, liveOn);
  });
  unmoved("sequence form", ctx.variants.sequenceForm, (document) => {
    assert.deepEqual(onOf(document), p0.order);
  });
});

test("top-level concurrency hidden in a string or behind an alias is caught by the audit while the pin stays put", () => {
  const ctx = getContext();
  const { p0, p1, p2, p3 } = ctx.probes;
  const tree = {
    [p1.name]: ctx.variants.topString,
    [p2.name]: ctx.variants.topAliasCanonical,
    [p3.name]: ctx.variants.topAliasShared,
  };
  for (const [name, source] of Object.entries(tree)) {
    assert.deepEqual(digestsWith(ctx, { [name]: source }).authority, ctx.authority, `${name}: top-level policy must stay outside the pin`);
  }
  assert.equal(documentOf(digestsWith(ctx, { [p3.name]: tree[p3.name] }), p3.name).env.ISSUE_3095_GROUP, "issue-3095-shared-group");

  // One audit over a minimal tree: the three top-level probes, the job-level
  // probe (which the audit must NOT see, so the pin is its only guard), and the
  // reviewed load exception the audit requires.
  const audit = auditWorkflowSources({
    ...tree,
    [p0.name]: ctx.variants.existingJob,
    [LOAD_WORKFLOW]: ctx.sources[LOAD_WORKFLOW],
  });
  const errorsFor = (name) => audit.errors.filter((error) => error.startsWith(`${name}: `));
  assert.equal(audit.counts.prFamily, 5, `minimal audit tree must be all PR-family: ${audit.errors.join(" | ")}`);
  assert.ok(errorsFor(p1.name).includes(`${p1.name}: missing or non-object top-level concurrency policy`),
    `string-form top-level concurrency must fail the audit; got ${audit.errors.join(" | ")}`);
  assert.deepEqual(errorsFor(p2.name), [], "an alias that resolves to the canonical group is the same policy");
  assert.ok(errorsFor(p3.name).some((error) => error.includes("group must exactly match the #2851 canonical expression")),
    `an alias-hidden shared group must fail the audit; got ${audit.errors.join(" | ")}`);
  assert.deepEqual(errorsFor(p0.name), [], "job-level concurrency is invisible to the audit, which is why the pin covers it");
});

test("job-level cancellation on a denied workflow is caught by its byte authority and by nothing in the pin", () => {
  const ctx = getContext();
  const allDenied = Object.fromEntries(ctx.deniedVariants.map(([name, , source]) => [name, source]));
  const digests = digestsWith(ctx, allDenied);
  for (const [name, job, source] of ctx.deniedVariants) {
    assert.deepEqual(documentOf(digests, name).jobs[job].concurrency, { group: "issue-3095-shared-denied", "cancel-in-progress": true },
      `${name}: mutation must parse as a job-level unconditional cancellation`);
    assert.throws(
      () => ctx.gate.assertDeniedAuthorities({ ...ctx.sources, [name]: source }),
      (error) => error instanceof assert.AssertionError && error.message.startsWith(`${name}: denied workflow bytes changed`),
      `${name}: job-level unconditional cancellation must fail the denied byte authority`,
    );
  }
  assert.deepEqual(digests.authority, ctx.authority,
    "denied workflows are outside the PR family, so the pin cannot be what guards them");
});

test("every inverted revert row bites when its registered line is duplicated or deleted", () => {
  const ctx = getContext();
  const bites = (expectedCount) => (error) => error instanceof assert.AssertionError
    && /expected exactly one mutation target/.test(error.message) && error.actual === expectedCount && error.expected === 1;
  for (const [name, line] of ctx.gate.rows) {
    const source = ctx.sources[name];
    assert.equal(typeof source, "string", `${name}: revert row names a missing workflow`);
    assert.doesNotThrow(() => ctx.gate.removeExactLine(source, line, name));
    const duplicated = source.replace(line, () => `${line}${line}`);
    assert.throws(() => ctx.gate.removeExactLine(duplicated, line, name), bites(2), `${name}: a duplicated registration must fail`);
    const deleted = source.replace(line, () => "");
    assert.throws(() => ctx.gate.removeExactLine(deleted, line, name), bites(0), `${name}: a deleted registration must fail`);
  }
});

test("the inverted revert loop rejects a no-op row and a policy-relevant row", () => {
  const ctx = getContext();
  const { p0 } = ctx.probes;
  const run = (sources, name, line) => ctx.gate.runLoopBody(
    assert, ctx.gate.removeExactLine, ctx.gate.canonicalDigests, sources, ctx.liveDigests, ctx.authority, name, line,
  );

  const noOpTree = { ...ctx.sources, [p0.name]: ctx.noOpSource };
  assert.equal(ctx.gate.canonicalDigests(noOpTree).documentSha256, ctx.liveDigests.documentSha256,
    "the comment-only row must be a true no-op, or this control proves nothing");
  assert.throws(() => run(noOpTree, p0.name, ctx.noOpLine),
    (error) => error instanceof assert.AssertionError && /parsed document/.test(error.message),
    "a row whose removal changes nothing must be rejected");

  const withoutDispatch = digestsWith(ctx, { [ctx.dispatchName]: ctx.sources[ctx.dispatchName].replace(ctx.dispatchLine, () => "") });
  assert.ok(!withoutDispatch.canonical[ctx.dispatchName].events.includes("workflow_dispatch"), "the policy row must remove a real event");
  assert.throws(() => run(ctx.sources, ctx.dispatchName, ctx.dispatchLine),
    (error) => error instanceof assert.AssertionError && /policy projection/.test(error.message),
    "a row whose removal changes a trigger event must be rejected by the inverted loop");
});

test("an activity-types filter is caught by the #2881 audit on every non-exempt lane while the #2851 pin ignores it", () => {
  const ctx = getContext();
  assert.deepEqual(digestsWith(ctx, ctx.typesTree).authority, ctx.authority,
    "the #3095 projection deliberately excludes activity types (T-A8)");
  const audit = auditDraftGate(ctx.typesTree);
  for (const name of ctx.gated) {
    assert.ok(audit.errors.some((error) => error.startsWith(`${name}: types must be exactly `)),
      `${name}: a types filter that keeps ready_for_review but drops opened and synchronize must fail #2881 exactness (A2), not just A1`);
  }
  for (const name of ctx.required) {
    assert.ok(audit.errors.some((error) => error.startsWith(`${name}: always-on merge-gate workflow must not restrict pull-request activity types`)),
      `${name}: a ruleset-required lane must not accept a types filter`);
  }
});
