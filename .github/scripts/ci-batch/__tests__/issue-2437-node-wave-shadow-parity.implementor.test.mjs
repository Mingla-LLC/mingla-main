import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  SHADOW_PARITY_MARKER,
  SHADOW_PARITY_WRAPPER_NAMES,
  canonicalizeShadowWrapperSource,
  discoverLiveOrigins,
  discoverWorkflowProviders,
  inspectWorkflow,
  validateRegistry,
  validateShadowParityMarkers,
} from "../validate-manifest-v2.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MANIFEST_PATH = path.join(ROOT, ".github/ci-batch/MANIFEST.json");
const WORKFLOW_PATH = path.join(ROOT, ".github/workflows/ci-batch.yml");
const manifest = () => JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const clone = (value) => structuredClone(value);
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sourceDigest = (value) => crypto.createHash("sha256").update(value).digest("hex");

const workflowSources = () => Object.fromEntries(fs
  .readdirSync(path.join(ROOT, ".github/workflows"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
  .map((entry) => [entry.name, fs.readFileSync(path.join(ROOT, ".github/workflows", entry.name), "utf8")]));

test("#2437 shadow registry is exactly 31 live origins / 32 typed variants without cutover", () => {
  const value = manifest();
  const shadow = value.suites.filter((suite) => suite.lifecycle === "shadow-active");
  const origins = value.legacyOrigins.filter((origin) => origin.disposition === "shadow-active");
  assert.equal(value.legacyOrigins.length, 198);
  assert.equal(value.suites.length, 54);
  assert.equal(value.workflowProviders.length, 89);
  assert.equal(origins.length, 31);
  assert.equal(shadow.length, 32);
  assert.equal(new Set(shadow.map((suite) => suite.id)).size, 32);
  assert.equal(shadow.filter((suite) => path.basename(suite.origin) === "issue-994-ota-env-resolution.yml").length, 2);
  assert.equal(shadow.filter((suite) => path.basename(suite.origin) !== "issue-994-ota-env-resolution.yml").length, 30);
  for (const suite of shadow) assert.equal(fs.existsSync(path.join(ROOT, suite.origin)), true, `${suite.origin} must remain live during shadow`);
  assert.equal(fs.existsSync(path.join(ROOT, ".github/workflows/issue-2393-valid-marketing-test-fixtures.yml")), true);
});

test("all original Phase 2 commands and all shadow commands have independent immutable locks", () => {
  const value = manifest();
  assert.equal(digest(value.commandCapabilities.commands.slice(0, 46)), "92540e31ef9fb7433f6f40a94071b27023786d15c644110e3a43a2929dbe2399");
  assert.equal(digest(value.commandCapabilities.commands.slice(46)), "3cdccc5cb491f7a642ffa2a49f450d6f7ed5b37450d1f18a1fe219d5c629e709");
  assert.equal(value.suites.slice(22).flatMap((suite) => suite.steps).length, 107);
  assert.equal(value.commandCapabilities.commands.length, 153);
});

test("the source wave still contains all 118 active run commands and 31 untouched wrappers", () => {
  const names = manifest().legacyOrigins.filter((origin) => origin.disposition === "shadow-active").map((origin) => `${origin.stem}.${origin.extension}`);
  const ruby = String.raw`require "yaml"; root=ARGV.shift; count=ARGV.sum{|name| d=YAML.safe_load(File.binread(File.join(root,".github/workflows",name)), aliases:true)||{}; (d["jobs"]||{}).values.sum{|job| Array(job["steps"]).count{|step| step.is_a?(Hash) && step["run"]}}}; print count`;
  const count = Number(execFileSync("ruby", ["-e", ruby, ROOT, ...names], { encoding: "utf8" }));
  assert.equal(count, 118);
  assert.equal(names.filter((name) => fs.existsSync(path.join(ROOT, ".github/workflows", name))).length, 31);
});

test("temporary parity markers are exact, allowlisted, and invisible only to canonical wrapper contracts", () => {
  const value = manifest();
  const sources = workflowSources();
  assert.equal(SHADOW_PARITY_WRAPPER_NAMES.length, 31);
  assert.deepEqual(validateShadowParityMarkers(value, sources), []);
  for (const name of SHADOW_PARITY_WRAPPER_NAMES) {
    assert.equal(sources[name].split("\n").filter((line) => line === SHADOW_PARITY_MARKER).length, 1);
    const canonical = canonicalizeShadowWrapperSource(name, sources[name]);
    assert.equal(canonical.includes(SHADOW_PARITY_MARKER), false);
    assert.equal(sourceDigest(canonical), inspectWorkflow(ROOT, name).sourceSha256);
    const registered = value.legacyOrigins.find((origin) => `${origin.stem}.${origin.extension}` === name);
    assert.equal(sourceDigest(canonical), registered.workflowMetadata.sourceSha256);
    const nonMarkerMutation = canonical.replace("name:", "name: mutated-");
    assert.notEqual(sourceDigest(nonMarkerMutation), registered.workflowMetadata.sourceSha256);
  }
});

test("canonical validation rejects shadow omission, premature cutover, setup drift, and trust drift", () => {
  const value = manifest();
  const workflowSource = fs.readFileSync(WORKFLOW_PATH, "utf8");
  const discovery = { root: ROOT, liveOrigins: discoverLiveOrigins(ROOT), workflowProviders: discoverWorkflowProviders(ROOT), matrixSource: workflowSource };
  assert.deepEqual(validateRegistry(value, discovery), []);

  const omitted = clone(value);
  omitted.suites.splice(22, 1);
  assert.ok(validateRegistry(omitted, discovery).some((error) => /54 executable suites|54 entries|32 shadow-active/.test(error)));

  const cutover = clone(value);
  const origin = cutover.legacyOrigins.find((item) => item.disposition === "shadow-active");
  origin.disposition = "batched-historical";
  origin.providerWorkflow = ".github/workflows/ci-batch.yml";
  assert.ok(validateRegistry(cutover, discovery).some((error) => /historical wrapper absent/.test(error)));

  const setup = clone(value);
  setup.setupProfiles["cross-root-node22-ignore-scripts"].installs.reverse();
  assert.ok(validateRegistry(setup, discovery).some((error) => /exact reviewed.*setup contract/.test(error)));

  const workflow = workflowSource.replace("persist-credentials: false", "persist-credentials: true");
  assert.ok(validateRegistry(value, { ...discovery, matrixSource: workflow }).some((error) => /pinned checkout\/setup-node/.test(error)));
});
