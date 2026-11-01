import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
export const BOOTSTRAP_PATH = path.join(ROOT, ".github/ci-batch/MANIFEST.json");
// #3281: re-sealed after the four affected live providers added the reviewed,
// input-free exact-current-main recovery trigger to their metadata.
// #4037: re-sealed after the #922 business-web actionability provider gained
// the same input-free recovery trigger.
// #4084: re-sealed after the existing deploy-functions provider gained its
// exact supersession regression consumer.
// #2331: re-sealed after the #905 /links and #922 actionability providers
// gained the privacy-bar owners in their path scope (the /links route
// suppression module is retired).
// #4111: re-sealed after the #679 brand-page suite gained the brand page foot
// render proof and the message-sheet rework proof (issue_4111_*.render.test.tsx).
// #4111: re-sealed after the #2272 workflow escaped `+` in its +native-intent.tsx
// path filter (GitHub reads `+` as a pattern operator), updating its pathScope and sourceSha256.
// #3643: re-sealed after 39 per-issue providers dropped the Host jest steps that
// only re-ran files the required full suite already runs (new sourceSha256 and,
// where a whole job went, jobKeys/runtimeVersions/setupActions). Six sourceSha256
// patches for those rows are folded into the bootstrap and deleted.
// #3643 Phase 3D: re-sealed after 20 no-database Deno/Node workflows were folded
// in as primary suites of two new Deno hosts (20 suites, 93 commands, 2 classes
// and profiles, 20 legacy rows flipped to batched-historical, 4 provider records
// to batched-provider). The #2240 sourceSha256 patch is folded in and deleted.
// #3643 Wave 4: re-sealed after the 88 live workflow rows dropped their byte
// fingerprint (sourceSha256) and gained their per-job timeouts; the validator
// now checks those rows by property.
// #3643 Phase 3E: re-sealed after PostgreSQL workflows moved behind the one
// replay / one template-copy-per-suite execution class; Wave 1 also widens
// #2269 routing to the two retained #871 assertions it executes and makes every
// Phase 3E suite watch the shared PostgreSQL setup/contract it depends on.
// The four sourceSha256-only patches are deleted and that patch op is refused.
// [TEST-MOD-APPROVED #3643] Re-sealed once for the terminal 48-suite Phase 3E fold.
// #3643: re-sealed after retaining #1403/#1421's complete pre-fold routing.
// #3643: isolate the foundation migration fixture and retire the stale discovery rewind.
// #3643: keep the retained attendance TypeScript tests on Node 22.
// #2829 W7c: re-sealed after the Sites goldens test became one reviewed
// reference on the retained arm64 web-build provider.
// #3872: re-sealed after the census prerequisite migration and its two
// self-registering SQL proofs entered the preserved replay inventories, with
// the exact repair excluded from the deliberately filtered pre-#1931 replay.
// #4137: re-sealed again after the four Blog migrations and both executable
// PostgreSQL suites entered the same preserved full-history inventories, with
// exact historical exclusions in the deliberately pre-#1931 replay.
// #1318: re-sealed once more after the VAT migration entered those three
// preserved replay authorities on top of the #4137 Blog additions.
// #2829 / #3645: re-sealed after the two reviewed activation migrations and
// their local proofs entered the same three preserved replay inventories.
// #2829 / #3872: re-sealed after the Sites and Creator Program general-
// availability migrations and their local proofs entered those inventories.
// #4037: re-sealed after the Home Pulse lifetime-sales and analytics listing-
// type migrations and their executable proofs entered those replay inventories.
// #4167: re-sealed after the #1532 route timeout widened from five to ten
// minutes following two consecutive checkout/router timeouts.
// #4173: re-sealed after the Brand group roster migration and its local
// PostgreSQL proof entered the three preserved full-history inventories.
// #4174: re-sealed after the Explorer internal-brand isolation migration
// entered the same three preserved full-history inventories, with exact
// exclusions beside #4073 in the deliberately filtered historical replays.
// #4179: re-sealed after the Feature Guide reconciliation migration and its
// PostgreSQL and structural proofs entered the preserved inventories.
// #4179: re-sealed after the release-reason repair entered the same three
// preserved historical replay inventories.
// #4179: re-sealed after the explicit JSON-null repair and its proofs entered
// those inventories without changing any preserved commands.
// #4182 / #4187 / #4188: re-sealed after the Local/Creator media lifecycle,
// Admin program-messaging, and Stay staff-reservation migrations plus their
// registered PostgreSQL proofs entered the preserved replay inventories.
// #3355: re-sealed after Ari's improvement-system migration and registered
// PostgreSQL proof entered those same preserved inventories, including its
// exact exclusion from the deliberately pre-#1931 historical replay.
// #3643: re-sealed after renaming tests-append-only.yml → pre-merge-main-health.yml
// (display name already Pre-merge main health; path + provider registry catch up).
// #3281: re-sealed after PR8 door scan day-label migration entered the three
// preserved full-history inventories (1857/1931/2117).
// #3281: re-sealed after PR9 cancel-date migration entered the same inventories.
// #3281: re-sealed after PR10 byDate quantities migration entered the same inventories.
// #3281: re-sealed after PR7 public schedule-card migrations and structural
// proofs entered the preserved inventories, with exact exclusions from the
// deliberately pre-#1931 historical replay.
// #4202 / #4203: re-sealed after the retained-purchase and hidden-event read
// migration plus its registered PostgreSQL proof entered the three preserved
// full-history inventories.
// #3281 / #3645: re-sealed after the terminal by-date + Paystack finalizer
// re-emit entered those inventories and their filtered historical replays.
// #3281: re-sealed after the production-order repair and its proofs entered
// those inventories and the same filtered historical replays.
// #4202: re-sealed after the Explorer phone-identity release migration entered
// the three preserved full-history inventories. Its executable proof stays in
// the already-registered #4202/#4203 PostgreSQL suite.
// #4202: re-sealed after the Local audit-row auth detach entered the same
// inventories with its self-registered PostgreSQL retention proof.
// #4202: re-sealed after the retry-safe auth.users phone-release migration
// and its self-registered PostgreSQL proof entered those inventories.
// #4202: re-sealed after the GoTrue pending-phone sentinel repair entered the
// same inventories and extended the existing phone-release proof.
// #4202: re-sealed after retained shared identities gained the reviewed
// already-owned event-chat repair in those same inventories and proof suite.
// #2830: re-sealed after the Ari brand-completeness migration and registered
// PostgreSQL proof entered the three preserved inventories, with the migration
// excluded by exact filename from the pre-#1931 replay that omits its #3355
// control-plane prerequisite.
// #4216: re-sealed after the Creator rights migration entered the same three
// full-history replay inventories; its executable proof self-registers locally.
export const BOOTSTRAP_SHA256 = "f675cc0a17b7a266deae38ea8cb8043169f74c5ccf67adca30f7171f8475d972";
export const DESCRIPTOR_SUFFIX = ".ci-batch.json";
export const PATCH_SUFFIX = ".ci-batch.patch.json";
export const PATCH_DIRECTORY = ".github/ci-batch/patches";

// Loader-owned provenance is deliberately not a JSON field. A descriptor cannot
// make itself trusted by spelling `localDescriptor` in its suite payload: only
// this module can attach the private symbol after the sealed bootstrap, patches,
// descriptors and derived capabilities have all been reconciled.
const TRUSTED_REGISTRY_VIEWS = Symbol("ci-batch-trusted-registry-views");

const SHA256 = /^[0-9a-f]{64}$/;
const ISSUE = /^#[1-9][0-9]*$/;
const DEPENDENT_SEAL_PATHS = Object.freeze({
  suites: [
    "/class", "/setupProfile", "/lifecycle", "/runtime", "/timeoutSeconds", "/steps",
    "/expectedFiles", "/envNames", "/generatedPaths", "/shadowContract", "/triggerContract",
    "/migrationWave", "/hostClass", "/executionClass", "/isolation",
  ],
  legacyOrigins: [
    "/disposition", "/providerWorkflow", "/replacementSuite", "/replacementSuites", "/routing",
    "/workflowMetadata/triggers", "/workflowMetadata/pathScope", "/workflowMetadata/jobKeys",
    "/workflowMetadata/runners", "/workflowMetadata/runtimeVersions", "/workflowMetadata/setupActions",
    "/workflowMetadata/concurrency", "/workflowMetadata/trustBoundary",
  ],
});

function fail(code, detail = "") {
  throw new Error(`ci-batch:effective-registry:${code}${detail ? `:${detail}` : ""}`);
}
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    same(Object.keys(value).sort(), [...keys].sort());
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function repositoryRelative(value, { allowPattern = false, allowRoot = false } = {}) {
  if (allowRoot && value === ".") return true;
  return typeof value === "string" && value.length > 0 && value.trim() === value &&
    !path.isAbsolute(value) && !/^[A-Za-z]:/.test(value) && !value.includes("\\") &&
    !value.includes("\0") && !value.split("/").some((part) => !part || part === "." || part === "..") &&
    (allowPattern || !/[?*\[\]{}]/.test(value));
}

export function trustedRegistryViews(manifest) {
  return manifest?.[TRUSTED_REGISTRY_VIEWS] || null;
}

export function bootstrapRowSha256(row) {
  return sha256(JSON.stringify(row));
}

function walk(root, relative = "") {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return [];
  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const child = path.posix.join(relative.split(path.sep).join(path.posix.sep), entry.name);
    if (entry.isDirectory()) files.push(...walk(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

export function loadBootstrap({ manifestPath = BOOTSTRAP_PATH, expectedSha = BOOTSTRAP_SHA256 } = {}) {
  const raw = fs.readFileSync(manifestPath);
  const actual = sha256(raw);
  if (actual !== expectedSha) fail("bootstrap_seal_mismatch", `${actual}:expected=${expectedSha}`);
  return JSON.parse(raw.toString("utf8"));
}

function targetIdentity(collection, selector) {
  return collection === "suites"
    ? `suites:id=${selector.id}`
    : `legacyOrigins:stem=${selector.stem}:extension=${selector.extension}`;
}

function selectedBootstrapRows(bootstrap, collection, selector) {
  const rows = bootstrap[collection];
  if (!Array.isArray(rows)) fail("bootstrap_collection_missing", collection);
  return rows.map((row, index) => ({ row, index })).filter(({ row }) => collection === "suites"
    ? row.id === selector.id
    : row.stem === selector.stem && row.extension === selector.extension);
}

function semanticDiffPaths(before, after, pointer = "") {
  if (same(before, after)) return [];
  if (Array.isArray(before) || Array.isArray(after) || !before || !after ||
      typeof before !== "object" || typeof after !== "object") return [pointer || "/"];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.flatMap((key) => semanticDiffPaths(before[key], after[key], `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`));
}

function protectedSealPath(collection, pointer) {
  return DEPENDENT_SEAL_PATHS[collection].some((prefix) => pointer === prefix || pointer.startsWith(`${prefix}/`));
}

function validatePatchEnvelope(descriptorPath, declaration) {
  const topLevel = ["schemaVersion", "kind", "ownerIssue", "target", "operations", "dependentSeals", "reason"];
  if (!exactKeys(declaration, topLevel) || declaration.schemaVersion !== 1 ||
      declaration.kind !== "ci-batch-bootstrap-patch" || !ISSUE.test(declaration.ownerIssue) ||
      typeof declaration.reason !== "string" || declaration.reason.trim().length < 12 ||
      !Array.isArray(declaration.dependentSeals)) {
    fail("malformed_patch", descriptorPath);
  }
  if (declaration.dependentSeals.length !== 0) fail("dependent_seal_change", descriptorPath);
  if (!Array.isArray(declaration.operations) || declaration.operations.length === 0) {
    fail("malformed_patch_operations", descriptorPath);
  }
  if (/\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml/.test(JSON.stringify(declaration))) {
    fail("workflow_name_forbidden", descriptorPath);
  }
}

function validatePatchTarget(descriptorPath, target) {
  if (!exactKeys(target, ["collection", "selector", "baseRowSha256"]) ||
      !["suites", "legacyOrigins"].includes(target.collection) || !SHA256.test(target.baseRowSha256)) {
    if (target?.collection && !["suites", "legacyOrigins"].includes(target.collection)) {
      fail("unknown_patch_collection", `${descriptorPath}:${target.collection}`);
    }
    fail("malformed_patch_target", descriptorPath);
  }
  const selectorKeys = target.collection === "suites" ? ["id"] : ["stem", "extension"];
  if (!exactKeys(target.selector, selectorKeys) ||
      (target.collection === "suites" && (typeof target.selector.id !== "string" || !target.selector.id)) ||
      (target.collection === "legacyOrigins" &&
        (typeof target.selector.stem !== "string" || !/^[A-Za-z0-9_.-]+$/.test(target.selector.stem) ||
         !["yml", "yaml"].includes(target.selector.extension)))) {
    fail("malformed_patch_selector", descriptorPath);
  }
}

function validateOperationShape(descriptorPath, operation) {
  if (!exactKeys(operation, ["op", "path", "expected", "value"]) ||
      typeof operation.op !== "string" || typeof operation.path !== "string") {
    fail("malformed_patch_operation", descriptorPath);
  }
  if (["", "/"].includes(operation.path) || ["add", "remove", "move", "copy"].includes(operation.op)) {
    fail("row_mutation_forbidden", `${descriptorPath}:${operation.op}:${operation.path}`);
  }
  if (operation.path.split("/").slice(1).some((part) => /^[0-9]+$/.test(part))) {
    fail("index_target_forbidden", `${descriptorPath}:${operation.path}`);
  }
}

function applyOperation({ descriptorPath, root, collection, selector, original, patched, operation }) {
  validateOperationShape(descriptorPath, operation);
  if (protectedSealPath(collection, operation.path)) {
    fail("dependent_seal_change", `${descriptorPath}:${operation.path}`);
  }
  // [#3643 Wave 4] Live workflow rows no longer carry a byte fingerprint: the
  // validator checks their triggers, paths, jobs, runtimes, actions and trust
  // boundary against the YAML instead. A patch that re-banks a fingerprint
  // therefore has nothing to re-bank, and is refused by name rather than
  // silently accepted.
  if (collection === "legacyOrigins" && operation.path === "/workflowMetadata/sourceSha256") {
    fail("source_digest_patch_retired", `${descriptorPath}: live workflows are checked by property, not by byte fingerprint; edit the workflow and drop this patch`);
  }
  if (collection === "suites" && ["/originPaths", "/externalReferenceFiles"].includes(operation.path) &&
      operation.op !== "append-unique") {
    fail("provenance_mutation_forbidden", `${descriptorPath}:${operation.path}`);
  }
  if (collection === "suites" && ["/originPaths", "/externalReferenceFiles"].includes(operation.path)) {
    if (!Array.isArray(operation.expected) ||
        !operation.expected.every((entry) => typeof entry === "string") ||
        typeof operation.value !== "string" || !operation.value || path.isAbsolute(operation.value) ||
        operation.value.split("/").includes("..")) {
      fail("malformed_provenance_patch", `${descriptorPath}:${operation.path}`);
    }
    const key = operation.path.slice(1);
    const current = original[key];
    if (!same(current, operation.expected)) fail("patch_cas_mismatch", `${descriptorPath}:${operation.path}`);
    if (current.includes(operation.value)) fail("patch_noop", `${descriptorPath}:${operation.path}`);
    if (!fs.existsSync(path.join(root, operation.value))) fail("appended_path_missing", `${descriptorPath}:${operation.value}`);
    patched[key].push(operation.value);
    return;
  }
  fail("unknown_patch_path", `${descriptorPath}:${operation.path}`);
}

function readPatchDeclarations(root, allFiles) {
  const patchFiles = allFiles.filter((file) => file.endsWith(PATCH_SUFFIX));
  for (const descriptorPath of patchFiles) {
    if (path.posix.dirname(descriptorPath) !== PATCH_DIRECTORY) {
      fail("patch_location_forbidden", descriptorPath);
    }
  }
  return patchFiles.sort().map((descriptorPath) => {
    let declaration;
    try {
      declaration = JSON.parse(fs.readFileSync(path.join(root, descriptorPath), "utf8"));
    } catch (error) {
      fail("malformed_patch", `${descriptorPath}:${error.message}`);
    }
    return { descriptorPath, declaration };
  });
}

function applyBootstrapPatches({ root, bootstrap, allFiles }) {
  const effective = structuredClone(bootstrap);
  const targeted = new Set();
  for (const { descriptorPath, declaration } of readPatchDeclarations(root, allFiles)) {
    validatePatchEnvelope(descriptorPath, declaration);
    validatePatchTarget(descriptorPath, declaration.target);
    const { collection, selector, baseRowSha256 } = declaration.target;
    const identity = targetIdentity(collection, selector);
    if (targeted.has(identity)) fail("duplicate_patch_target", identity);
    targeted.add(identity);
    const matches = selectedBootstrapRows(bootstrap, collection, selector);
    if (matches.length !== 1) fail("patch_target_cardinality", `${identity}:matches=${matches.length}`);
    const { row: original, index } = matches[0];
    const actualBaseSha = bootstrapRowSha256(original);
    if (actualBaseSha !== baseRowSha256) {
      fail("stale_base_row", `${descriptorPath}:${actualBaseSha}:expected=${baseRowSha256}`);
    }
    const paths = new Set();
    const patched = structuredClone(original);
    for (const operation of declaration.operations) {
      if (paths.has(operation?.path)) fail("duplicate_patch_path", `${descriptorPath}:${operation?.path}`);
      paths.add(operation?.path);
      applyOperation({ descriptorPath, root, collection, selector, original, patched, operation });
    }
    const actualDiff = semanticDiffPaths(original, patched).sort();
    const declaredDiff = [...paths].sort();
    if (!same(actualDiff, declaredDiff)) {
      fail("patch_semantic_diff_mismatch", `${descriptorPath}:${JSON.stringify(actualDiff)}:declared=${JSON.stringify(declaredDiff)}`);
    }
    effective[collection][index] = patched;
  }
  return effective;
}

function validateLocalSuite({ descriptorPath, declaration, root, bootstrap }) {
  if (!exactKeys(declaration, ["schemaVersion", "kind", "ownerIssue", "suite"]) ||
      declaration.schemaVersion !== 1 || declaration.kind !== "ci-batch-suite" ||
      !ISSUE.test(declaration.ownerIssue)) {
    fail("malformed_descriptor", descriptorPath);
  }
  const suite = declaration.suite;
  const suiteKeys = [
    "id", "class", "originPaths", "steps", "lifecycle", "ownerIssue", "runtime",
    "setupProfile", "cwd", "envNames", "isolation", "expectedFiles",
    "externalReferenceFiles", "requiredContext", "timingSeconds", "generatedPaths",
    "exceptionRationale", "timeoutSeconds",
  ];
  if (!exactKeys(suite, suiteKeys)) fail("malformed_suite", descriptorPath);
  const requiredStrings = [
    "id", "class", "lifecycle", "ownerIssue", "setupProfile", "cwd", "isolation",
    "requiredContext", "exceptionRationale",
  ];
  for (const key of requiredStrings) {
    if (typeof suite[key] !== "string" || suite[key].length === 0) fail("missing_field", `${descriptorPath}:${key}`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(suite.id) || suite.ownerIssue !== declaration.ownerIssue) {
    fail("descriptor_owner_mismatch", descriptorPath);
  }
  if (!Array.isArray(suite.steps) || suite.steps.length === 0 ||
      !Array.isArray(suite.expectedFiles) || suite.expectedFiles.length === 0 ||
      !Array.isArray(suite.originPaths) || suite.originPaths.length === 0 ||
      !Array.isArray(suite.envNames) || !Array.isArray(suite.generatedPaths) ||
      !Array.isArray(suite.externalReferenceFiles)) fail("missing_suite_arrays", descriptorPath);
  for (const key of ["originPaths", "envNames", "expectedFiles", "externalReferenceFiles", "generatedPaths"]) {
    if (!suite[key].every((entry) => typeof entry === "string") || new Set(suite[key]).size !== suite[key].length) {
      fail("malformed_suite_array", `${descriptorPath}:${key}`);
    }
  }
  if (!exactKeys(suite.runtime, ["name", "version"]) || suite.runtime.name !== "node" ||
      typeof suite.runtime.version !== "string" ||
      !Number.isInteger(suite.timeoutSeconds) || suite.timeoutSeconds < 1 || suite.timeoutSeconds > 1500) {
    fail("malformed_runtime_or_timeout", descriptorPath);
  }
  const validTiming = (value) => value === null || (Number.isFinite(value) && value >= 0);
  if (!exactKeys(suite.timingSeconds, ["p50", "p95", "evidence"]) ||
      !validTiming(suite.timingSeconds.p50) || !validTiming(suite.timingSeconds.p95) ||
      (suite.timingSeconds.p50 !== null && suite.timingSeconds.p95 !== null && suite.timingSeconds.p95 < suite.timingSeconds.p50) ||
      typeof suite.timingSeconds.evidence !== "string" || !suite.timingSeconds.evidence.trim()) {
    fail("malformed_timing", descriptorPath);
  }
  if (suite.lifecycle !== "batched-active" || suite.isolation !== "clean-worktree" || suite.envNames.length !== 0) {
    fail("unsupported_local_execution_contract", descriptorPath);
  }
  if (!bootstrap.classes.includes(suite.class) || !Object.hasOwn(bootstrap.setupProfiles, suite.setupProfile) ||
      bootstrap.setupProfiles[suite.setupProfile]?.classes?.includes(suite.class) !== true ||
      !same(bootstrap.setupProfiles[suite.setupProfile]?.runtime, suite.runtime)) {
    fail("unknown_class_or_setup", descriptorPath);
  }
  if (bootstrap.suites.some((entry) => entry.id === suite.id)) fail("bootstrap_shadow", suite.id);
  if (!repositoryRelative(suite.cwd, { allowRoot: true }) || !fs.existsSync(path.join(root, suite.cwd))) {
    fail("invalid_cwd", `${suite.id}:${suite.cwd}`);
  }
  for (const key of ["expectedFiles", "externalReferenceFiles"]) {
    for (const file of suite[key]) {
      if (!repositoryRelative(file) || !fs.existsSync(path.join(root, file))) {
        fail("missing_suite_path", `${suite.id}:${key}:${file}`);
      }
    }
  }
  for (const pattern of suite.originPaths) {
    if (!repositoryRelative(pattern, { allowPattern: true })) fail("invalid_origin_path", `${suite.id}:${pattern}`);
  }
  for (const generated of suite.generatedPaths) {
    if (!repositoryRelative(generated)) fail("invalid_generated_path", `${suite.id}:${generated}`);
  }
  if (!suite.expectedFiles.some((file) => path.posix.dirname(file) === path.posix.dirname(descriptorPath))) {
    fail("descriptor_not_local", descriptorPath);
  }
  const encoded = JSON.stringify(declaration);
  if (/\.github\/workflows\/[^"']+\.ya?ml/.test(encoded)) fail("workflow_name_forbidden", descriptorPath);
  for (const [index, step] of suite.steps.entries()) {
    if (!exactKeys(step, ["name", "cwd", "run", "commandId", "invocation", "exceptionRationale"]) ||
        typeof step.name !== "string" || !step.name.trim() || typeof step.run !== "string" || !step.run.trim() ||
        typeof step.commandId !== "string" || step.commandId !== `assert:${suite.id}:${String(index + 1).padStart(2, "0")}` ||
        !repositoryRelative(step.cwd, { allowRoot: true }) || !fs.existsSync(path.join(root, step.cwd)) ||
        typeof step.exceptionRationale !== "string" || !step.exceptionRationale.includes("legacy workflow") ||
        !exactKeys(step.invocation, ["kind", "command", "argv"]) || step.invocation.kind !== "raw-shell" ||
        step.invocation.command !== "bash" || !Array.isArray(step.invocation.argv) ||
        step.invocation.argv.length !== 2 || step.invocation.argv[0] !== "-c" || step.invocation.argv[1] !== step.run) {
      fail("malformed_step", `${suite.id}:${index}`);
    }
  }
  return {
    ...suite,
    origin: descriptorPath,
    originPaths: [...new Set([...suite.originPaths, descriptorPath])],
    localDescriptor: descriptorPath,
  };
}

export function loadEffectiveManifest({
  root = ROOT,
  manifestPath = BOOTSTRAP_PATH,
  expectedSha = BOOTSTRAP_SHA256,
  discover = manifestPath === BOOTSTRAP_PATH,
} = {}) {
  if (!discover) return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const bootstrap = loadBootstrap({ manifestPath, expectedSha });
  const files = walk(root);
  const patchedBootstrap = applyBootstrapPatches({ root, bootstrap, allFiles: files });
  const locals = files.filter((file) => file.endsWith(DESCRIPTOR_SUFFIX) && !file.endsWith(PATCH_SUFFIX)).map((descriptorPath) => {
    let declaration;
    try {
      declaration = JSON.parse(fs.readFileSync(path.join(root, descriptorPath), "utf8"));
    } catch (error) {
      fail("malformed_descriptor", `${descriptorPath}:${error.message}`);
    }
    return validateLocalSuite({ descriptorPath, declaration, root, bootstrap });
  });
  const ids = new Set(bootstrap.suites.map((suite) => suite.id));
  for (const suite of locals) {
    if (ids.has(suite.id)) fail("duplicate_suite_id", suite.id);
    ids.add(suite.id);
  }
  const effectiveBase = structuredClone(patchedBootstrap);
  const suites = [...effectiveBase.suites, ...locals.sort((a, b) => a.id.localeCompare(b.id))];
  const localCommands = locals.flatMap((suite) => suite.steps.map((step, stepIndex) => {
    const command = {
      id: step.commandId,
      suiteId: suite.id,
      stepIndex,
      cwd: step.cwd,
      executable: step.invocation.command,
      argv: step.invocation.argv,
    };
    return {
      ...command,
      payloadSha256: crypto.createHash("sha256").update(JSON.stringify({
        cwd: command.cwd,
        executable: command.executable,
        argv: command.argv,
      })).digest("hex"),
    };
  }));
  const commands = [...effectiveBase.commandCapabilities.commands, ...localCommands];
  const commandIds = new Set();
  for (const command of commands) {
    if (commandIds.has(command.id)) fail("duplicate_command_id", command.id);
    commandIds.add(command.id);
  }
  const effective = {
    ...effectiveBase,
    expectedExecutableSuites: suites.length,
    expectedSuites: suites.length,
    commandCapabilities: {
      ...bootstrap.commandCapabilities,
      expectedCommands: commands.length,
      registrySha256: crypto.createHash("sha256").update(JSON.stringify(commands)).digest("hex"),
      commands,
    },
    suites,
  };
  Object.defineProperty(effective, TRUSTED_REGISTRY_VIEWS, {
    enumerable: false,
    configurable: false,
    writable: false,
    value: Object.freeze({
      rawBootstrap: deepFreeze(bootstrap),
      patchedBootstrap: deepFreeze(patchedBootstrap),
      localSuiteIds: Object.freeze(locals.map((suite) => suite.id)),
      localDescriptorClaims: Object.freeze(locals.map((suite) => Object.freeze({
        suiteId: suite.id,
        descriptorPath: suite.localDescriptor,
      }))),
      rawBootstrapSha256: expectedSha,
    }),
  });
  return effective;
}
