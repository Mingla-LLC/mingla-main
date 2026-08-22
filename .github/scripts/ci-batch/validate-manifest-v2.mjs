#!/usr/bin/env node
// #2435 / #2148 Phase 1. Fail-closed validator for the deterministic CI registry.
// The registry is deliberately static. Discovery is used only to prove that the
// committed inventory is complete; it is never used to decide what CI executes.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, "../../..");
export const DEFAULT_MANIFEST = path.join(DEFAULT_ROOT, ".github/ci-batch/MANIFEST.json");
const LIVE_ORIGIN = /^(?:issue-|orch-|meta-).*\.ya?ml$/;
const ALLOWED_DISPOSITIONS = new Set([
  "batched-active",
  "shadow-active",
  "batched-historical",
  "full-suite-superset",
  "build-assertion-consumer",
  "database-special",
  "operational-excluded",
  "approved-retired",
]);
const LOCKED_ASSERTION_CAPABILITY_SHA256 = "bb9c0e598a08ab91d8714ec2db80100c8b4d966d980a3cc290c3bcad93990a3f";
const LOCKED_SHADOW_CAPABILITY_SHA256 = "6d4340d8d8bd70540e1229011fcd719c8782af46a608f84ee0b777dd405f3673";
const LOCKED_SHADOW_CONTRACT_SHA256 = "b54121cb297f466d1d4d0ed4fae467e5c895804898018b752aa8e191159e673c";
const LOCKED_SETUP_PROFILES_SHA256 = "5d445002c1c4b7a7f97faebf1d26162dbba24ba9c7ee0f448d3c289ee4ca7dec";
const PINNED_CHECKOUT = "actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683";
const PINNED_SETUP_NODE = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
export const SHADOW_PARITY_MARKER = "# #2437 SHADOW-PARITY-TRIGGER — remove before cutover";
const SHADOW_PARITY_TOKEN = "#2437 SHADOW-PARITY-TRIGGER";
const SHADOW_PARITY_WRAPPER_STEMS = Object.freeze([
  "issue-1009-campaign-builder-retry-tests",
  "issue-1322-admin-sentry-tests",
  "issue-1481-explorer-deck-tests",
  "issue-1509-boot-budget-tests",
  "issue-1516-coach-mark-tests",
  "issue-1576-deck-promoted-card",
  "issue-1579-deck-tap-expand",
  "issue-1593-deck-layer-geometry",
  "issue-1605-expanded-card",
  "issue-1609-card-identity",
  "issue-1615-public-share-surfaces",
  "issue-1636-likes-load-tests",
  "issue-1638-tab-switch-quickwins-tests",
  "issue-1638-tab-switch-scheduling-tests",
  "issue-1639-profile-cards-tests",
  "issue-1642-been-here-offline-bound",
  "issue-1661-completed-write-unparks-invalidation",
  "issue-1687-been-here-rating-prompt",
  "issue-1860-rls-coverage-tests",
  "issue-1880-expanded-share-handoff",
  "issue-1960-share-art-isolation",
  "issue-1962-unlisted-share-previews",
  "issue-1968-public-web-canonical-sharing",
  "issue-2004-share-click-canonical-destination",
  "issue-2058-bundle-baseline-handoff-tests",
  "issue-2084-credential-output-safety",
  "issue-2207-manifest-merge-awareness",
  "issue-2300-orch-artifact-reap",
  "issue-2393-tester-assertion-credential",
  "issue-994-ota-env-resolution",
  "orch-1386-tester-adversarial",
]);
export const SHADOW_PARITY_WRAPPER_NAMES = Object.freeze(SHADOW_PARITY_WRAPPER_STEMS.map((stem) => `${stem}.yml`));
const SHADOW_PARITY_WRAPPER_SET = new Set(SHADOW_PARITY_WRAPPER_NAMES);

function fail(errors, message) {
  errors.push(message);
}

function strings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function canonicalizeShadowWrapperSource(workflowName, source) {
  if (!SHADOW_PARITY_WRAPPER_SET.has(workflowName)) return source;
  const lines = source.split("\n");
  const index = lines.indexOf(SHADOW_PARITY_MARKER);
  if (index !== -1) lines.splice(index, 1);
  return lines.join("\n");
}

export function validateShadowParityMarkers(manifest, workflowSources) {
  const errors = [];
  const shadowNames = new Set((manifest.legacyOrigins || [])
    .filter((origin) => origin.disposition === "shadow-active")
    .map((origin) => `${origin.stem}.${origin.extension}`));

  for (const name of shadowNames) {
    if (!SHADOW_PARITY_WRAPPER_SET.has(name)) fail(errors, `${name}: shadow parity marker path is outside the exact #2437 allowlist`);
  }
  for (const name of SHADOW_PARITY_WRAPPER_NAMES) {
    const source = workflowSources[name];
    if (!shadowNames.has(name)) {
      if (source?.includes(SHADOW_PARITY_TOKEN)) fail(errors, `${name}: shadow parity marker is forbidden outside shadow-active lifecycle`);
      continue;
    }
    if (typeof source !== "string") {
      fail(errors, `${name}: shadow-active wrapper and exact parity marker are required`);
      continue;
    }
    const exactLines = source.split("\n").filter((line) => line === SHADOW_PARITY_MARKER).length;
    const tokenCount = source.split(SHADOW_PARITY_TOKEN).length - 1;
    if (exactLines !== 1 || tokenCount !== 1) {
      fail(errors, `${name}: requires exactly one exact #2437 shadow parity marker line`);
    }
  }
  for (const [name, source] of Object.entries(workflowSources)) {
    if (!SHADOW_PARITY_WRAPPER_SET.has(name) && source.includes(SHADOW_PARITY_TOKEN)) {
      fail(errors, `${name}: stray #2437 shadow parity marker on an unapproved workflow`);
    }
  }
  return errors;
}

function trackedFiles(root) {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: root })
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
  } catch {
    throw new Error("registry validation requires a git worktree");
  }
}

const requireFromValidator = createRequire(import.meta.url);

function globToRegExp(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === "*") {
      if (glob[index + 1] === "*") {
        index += 1;
        if (glob[index + 1] === "/") {
          index += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else if (character === "[") {
      const end = glob.indexOf("]", index + 1);
      if (end === -1) source += "\\[";
      else {
        const contents = glob.slice(index + 1, end);
        source += `[${contents.startsWith("!") ? `^${contents.slice(1)}` : contents}]`;
        index = end;
      }
    } else if (character === "{") {
      const end = glob.indexOf("}", index + 1);
      if (end === -1) source += "\\{";
      else {
        source += `(?:${glob.slice(index + 1, end).split(",").map((part) => globToRegExp(part).source.slice(1, -1)).join("|")})`;
        index = end;
      }
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

function configPathsFromCommand(command) {
  const configs = [];
  const expression = /(?:^|\s)--config(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;
  for (const match of command.matchAll(expression)) configs.push(match[1] || match[2] || match[3]);
  return configs;
}

function filesSelectedByJestConfig(configRelative, cwd, root) {
  const configAbsolute = path.resolve(root, cwd, configRelative);
  const repositoryRelative = path.relative(root, configAbsolute);
  if (repositoryRelative.startsWith("..") || path.isAbsolute(repositoryRelative) || !fs.statSync(configAbsolute).isFile()) {
    throw new Error(`Jest config is outside the repository or missing: ${configRelative}`);
  }

  delete requireFromValidator.cache?.[configAbsolute];
  const loaded = requireFromValidator(configAbsolute);
  const config = loaded?.default ?? loaded;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`Jest config must synchronously export an object: ${repositoryRelative}`);
  }

  const configDirectory = path.dirname(configAbsolute);
  const rootDir = config.rootDir
    ? path.resolve(configDirectory, String(config.rootDir).replaceAll("<rootDir>", configDirectory))
    : configDirectory;
  const rootRelative = path.relative(root, rootDir);
  if (rootRelative.startsWith("..") || path.isAbsolute(rootRelative)) {
    throw new Error(`Jest rootDir is outside the repository: ${repositoryRelative}`);
  }

  const testMatch = Array.isArray(config.testMatch) ? config.testMatch : [];
  const testRegex = Array.isArray(config.testRegex)
    ? config.testRegex
    : typeof config.testRegex === "string" ? [config.testRegex] : [];
  if (testMatch.length === 0 && testRegex.length === 0) {
    throw new Error(`Jest config has no deterministic testMatch or testRegex: ${repositoryRelative}`);
  }
  const matchers = testMatch.map((pattern) => {
    const expanded = String(pattern).replaceAll("<rootDir>", rootDir).replaceAll(path.sep, "/");
    return globToRegExp(expanded);
  });
  const regexes = testRegex.map((pattern) => new RegExp(pattern));
  const ignores = (Array.isArray(config.testPathIgnorePatterns) ? config.testPathIgnorePatterns : [])
    .map((pattern) => new RegExp(String(pattern).replaceAll("<rootDir>", rootDir)));
  const configuredRoots = (Array.isArray(config.roots) && config.roots.length ? config.roots : [rootDir])
    .map((configuredRoot) => path.resolve(rootDir, String(configuredRoot).replaceAll("<rootDir>", rootDir)));

  return trackedFiles(root).filter((relative) => {
    const absolute = path.resolve(root, relative);
    const normalized = absolute.replaceAll(path.sep, "/");
    if (!configuredRoots.some((configuredRoot) => absolute === configuredRoot || absolute.startsWith(`${configuredRoot}${path.sep}`))) return false;
    if (ignores.some((ignore) => ignore.test(normalized))) return false;
    return matchers.some((matcher) => matcher.test(normalized)) || regexes.some((regex) => regex.test(normalized));
  });
}

export function discoverLiveOrigins(root = DEFAULT_ROOT) {
  return fs
    .readdirSync(path.join(root, ".github/workflows"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && LIVE_ORIGIN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

const RUBY_WORKFLOW_INSPECTOR = String.raw`
require "yaml"
require "json"
require "digest"

payload = JSON.parse(STDIN.read)
names = payload.fetch("names")
sources = payload.fetch("sources")
result = {}

names.each do |name|
  source = sources.fetch(name)
  document = YAML.safe_load(source, aliases: true) || {}
  on_value = document["on"] || document[true] || {}
  events = case on_value
           when Hash then on_value.keys.map(&:to_s)
           when Array then on_value.map(&:to_s)
           when String then [on_value]
           else []
           end
  path_scope = []
  if on_value.is_a?(Hash)
    on_value.each_value do |config|
      next unless config.is_a?(Hash)
      path_scope.concat(Array(config["paths"]).map(&:to_s))
      path_scope.concat(Array(config["paths-ignore"]).map(&:to_s))
    end
  end

  jobs = document["jobs"].is_a?(Hash) ? document["jobs"] : {}
  steps = jobs.values.flat_map { |job| job.is_a?(Hash) ? Array(job["steps"]) : [] }
  steps.select! { |step| step.is_a?(Hash) }
  actions = steps.map { |step| step["uses"]&.to_s }.compact.uniq.sort
  runners = jobs.values.map { |job| job.is_a?(Hash) ? job["runs-on"] : nil }.compact
                .flat_map { |runner| Array(runner).map(&:to_s) }.uniq.sort
  runtimes = steps.map do |step|
    action = step["uses"]&.to_s
    with = step["with"].is_a?(Hash) ? step["with"] : {}
    case action
    when %r{^actions/setup-node@}
      "node:#{with.fetch("node-version", "unspecified")}"
    when %r{^actions/setup-python@}
      "python:#{with.fetch("python-version", "unspecified")}"
    when %r{^denoland/setup-deno@}
      "deno:#{with.fetch("deno-version", "unspecified")}"
    end
  end.compact.uniq.sort
  permissions = document["permissions"]
  permission_rows = case permissions
                    when Hash then permissions.map { |key, value| "#{key}: #{value}" }.sort
                    when nil then []
                    else [permissions.to_s]
                    end
  environments = jobs.values.map do |job|
    next unless job.is_a?(Hash)
    value = job["environment"]
    value.is_a?(Hash) ? value["name"]&.to_s : value&.to_s
  end.compact.uniq.sort

  result[name] = {
    "sourceSha256" => Digest::SHA256.hexdigest(source),
    "triggers" => events.uniq.sort,
    "pathScope" => path_scope.uniq.sort,
    "jobKeys" => jobs.keys.map(&:to_s).uniq.sort,
    "runners" => runners,
    "runtimeVersions" => runtimes,
    "setupActions" => actions,
    "trustBoundary" => {
      "permissions" => permission_rows,
      "environments" => environments,
      "usesRepositorySecrets" => source.include?("secrets."),
      "usesOidc" => source.match?(/id-token:\s*write/),
      "pullRequestTarget" => events.include?("pull_request_target")
    }
  }
end

STDOUT.write(JSON.generate(result))
`;

const workflowInspectionCache = new Map();

export function inspectWorkflows(root = DEFAULT_ROOT, workflowNames = discoverLiveOrigins(root)) {
  const names = [...new Set(workflowNames)].sort();
  const sources = Object.fromEntries(names.map((name) => {
    const source = fs.readFileSync(path.join(root, ".github/workflows", name), "utf8");
    return [name, canonicalizeShadowWrapperSource(name, source)];
  }));
  const sourceDigest = crypto.createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  const key = `${path.resolve(root)}\0${names.join("\0")}\0${sourceDigest}`;
  if (!workflowInspectionCache.has(key)) {
    const output = execFileSync("ruby", ["-e", RUBY_WORKFLOW_INSPECTOR], {
      input: JSON.stringify({ names, sources }),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    workflowInspectionCache.set(key, JSON.parse(output));
  }
  return workflowInspectionCache.get(key);
}

export function inspectWorkflow(root, workflowName) {
  return inspectWorkflows(root, discoverLiveOrigins(root))[workflowName];
}

const RUBY_BATCH_INSPECTOR = String.raw`
require "yaml"
require "json"
document = YAML.safe_load(STDIN.read, aliases: true) || {}
jobs = document["jobs"].is_a?(Hash) ? document["jobs"] : {}
batch = jobs["batch"].is_a?(Hash) ? jobs["batch"] : {}
steps = Array(batch["steps"]).select { |step| step.is_a?(Hash) }
setup_node = steps.find { |step| step["uses"].to_s.start_with?("actions/setup-node@") } || {}
checkout = steps.find { |step| step["uses"].to_s.start_with?("actions/checkout@") } || {}
record_setup = steps.find { |step| step["name"].to_s == "Execute and record one typed shard setup" } || {}
run_suites = steps.find { |step| step["name"].to_s.start_with?("Run the ") } || {}
strategy = batch["strategy"].is_a?(Hash) ? batch["strategy"] : {}
matrix = strategy["matrix"].is_a?(Hash) ? strategy["matrix"] : {}
dispatch = jobs["dispatch"].is_a?(Hash) ? jobs["dispatch"] : {}
dispatch_steps = Array(dispatch["steps"]).select { |step| step.is_a?(Hash) }
dispatch_setup_node = dispatch_steps.find { |step| step["uses"].to_s.start_with?("actions/setup-node@") } || {}
dispatch_checkout = dispatch_steps.find { |step| step["uses"].to_s.start_with?("actions/checkout@") } || {}
dispatch_record_setup = dispatch_steps.find { |step| step["name"].to_s == "Execute and record one typed shard setup" } || {}
dispatch_run_suites = dispatch_steps.find { |step| step["name"].to_s.start_with?("Run the ") } || {}
dispatch_upload = dispatch_steps.find { |step| step["uses"].to_s.start_with?("actions/upload-artifact@") } || {}
output = {
  "jobKeys" => jobs.keys.map(&:to_s).sort,
  "runner" => batch["runs-on"]&.to_s,
  "matrix" => Array(matrix["include"]).map do |entry|
    next {} unless entry.is_a?(Hash)
    { "class" => entry["class"]&.to_s, "node" => entry["node"]&.to_s,
      "cache" => entry["cache"]&.to_s, "cacheLock" => entry["cache-lock"]&.to_s }
  end,
  "setupNode" => {
    "action" => setup_node["uses"]&.to_s,
    "nodeVersion" => setup_node.dig("with", "node-version")&.to_s,
    "count" => steps.count { |step| step["uses"].to_s.start_with?("actions/setup-node@") }
  },
  "checkout" => {
    "action" => checkout["uses"]&.to_s,
    "fetchDepth" => checkout.dig("with", "fetch-depth"),
    "persistCredentials" => checkout.dig("with", "persist-credentials")
  },
  "recordSetupStep" => {
    "run" => record_setup["run"]&.to_s,
    "count" => steps.count { |step| step["name"].to_s == "Execute and record one typed shard setup" }
  },
  "runSuitesStep" => {
    "run" => run_suites["run"]&.to_s,
    "count" => steps.count { |step| step["name"].to_s.start_with?("Run the ") }
  },
  "runSteps" => steps.map { |step| { "run" => step["run"]&.to_s, "if" => step["if"]&.to_s } }.select { |step| step["run"] },
  "jobIf" => batch["if"]&.to_s,
  "dispatch" => {
    "runner" => dispatch["runs-on"]&.to_s,
    "timeoutMinutes" => dispatch["timeout-minutes"],
    "jobIf" => dispatch["if"]&.to_s,
    "hasStrategy" => dispatch.key?("strategy"),
    "setupNode" => {
      "action" => dispatch_setup_node["uses"]&.to_s,
      "nodeVersion" => dispatch_setup_node.dig("with", "node-version")&.to_s,
      "count" => dispatch_steps.count { |step| step["uses"].to_s.start_with?("actions/setup-node@") }
    },
    "checkout" => {
      "action" => dispatch_checkout["uses"]&.to_s,
      "fetchDepth" => dispatch_checkout.dig("with", "fetch-depth"),
      "persistCredentials" => dispatch_checkout.dig("with", "persist-credentials")
    },
    "recordSetupStep" => {
      "run" => dispatch_record_setup["run"]&.to_s,
      "count" => dispatch_steps.count { |step| step["name"].to_s == "Execute and record one typed shard setup" }
    },
    "runSuitesStep" => {
      "run" => dispatch_run_suites["run"]&.to_s,
      "count" => dispatch_steps.count { |step| step["name"].to_s.start_with?("Run the ") }
    },
    "runSteps" => dispatch_steps.map { |step| { "run" => step["run"]&.to_s, "if" => step["if"]&.to_s } }.select { |step| step["run"] },
    "upload" => {
      "action" => dispatch_upload["uses"]&.to_s,
      "if" => dispatch_upload["if"]&.to_s,
      "name" => dispatch_upload.dig("with", "name")&.to_s,
      "path" => dispatch_upload.dig("with", "path")&.to_s,
      "ifNoFilesFound" => dispatch_upload.dig("with", "if-no-files-found")&.to_s,
      "count" => dispatch_steps.count { |step| step["uses"].to_s.start_with?("actions/upload-artifact@") }
    }
  },
  "workflowDispatch" => document.dig("on", "workflow_dispatch") || document.dig(true, "workflow_dispatch")
}
STDOUT.write(JSON.generate(output))
`;

export function inspectBatchWorkflow(source) {
  return JSON.parse(execFileSync("ruby", ["-e", RUBY_BATCH_INSPECTOR], {
    input: source,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }));
}

export function validatePhase2Contract(manifestOrOptions, matrixSource) {
  const optionShape = manifestOrOptions?.manifest && typeof manifestOrOptions.manifest === "object";
  const manifest = optionShape ? manifestOrOptions.manifest : manifestOrOptions;
  const contractRoot = optionShape ? manifestOrOptions.root || DEFAULT_ROOT : DEFAULT_ROOT;
  const workflowText = (optionShape ? manifestOrOptions.workflowText : matrixSource)
    ?? fs.readFileSync(path.join(contractRoot, ".github/workflows/ci-batch.yml"), "utf8");
  const errors = [];
  const requiredRunnerContract = {
    workspaceIsolation: "detached-git-worktree",
    processGroup: "detached",
    timeoutGraceSeconds: 2,
    resultsFile: "suite-results.json",
    setupEvidencePrefix: "ci-batch-setup-",
    processOwnership: "linux-subreaper-before-fork",
    dependencyIsolation: "independent-tree-no-escaping-links-with-shard-snapshot",
    childEnvironment: "minimal-allowlist-no-job-secrets",
  };
  if (JSON.stringify(manifest.runnerContract) !== JSON.stringify(requiredRunnerContract)) {
    fail(errors, "runnerContract must equal the exact Phase 2 isolation, process-group, timeout, result, and setup-evidence contract");
  }
  for (const suite of manifest.suites || []) {
    if ("timeoutMinutes" in suite || !Number.isInteger(suite.timeoutSeconds) || suite.timeoutSeconds < 1 || suite.timeoutSeconds > 1500) {
      fail(errors, `${suite.id}: timeoutSeconds must be an integer from 1 through 1500 and timeoutMinutes is forbidden`);
    }
    if (suite.isolation !== "clean-worktree") fail(errors, `${suite.id}: isolation must be exactly clean-worktree`);
    if (JSON.stringify(suite.envNames) !== "[]" || (suite.steps || []).some((step) => step.env && Object.keys(step.env).length)) {
      fail(errors, `${suite.id}: assertion children may not receive repository or job environment capabilities`);
    }
    for (const generated of suite.generatedPaths || []) {
      if (!generated || path.isAbsolute(generated) || path.normalize(generated).startsWith("..")) {
        fail(errors, `${suite.id}: generated path must remain repository-relative: ${generated}`);
      }
    }
    for (const [index, step] of (suite.steps || []).entries()) {
      if (suite.lifecycle !== "shadow-active" && forbiddenEmbeddedSetup(step)) fail(errors, `${suite.id}: step ${index} embeds forbidden setup/bootstrap work`);
    }
  }
  try {
    const topology = inspectBatchWorkflow(workflowText);
    if (topology.runner !== "ubuntu-latest") fail(errors, "ci-batch process containment requires the locked ubuntu-latest runner");
    if (topology.recordSetupStep?.run !== 'node .github/scripts/ci-batch/run-suite-batch.mjs --setup "${{ matrix.class }}"') {
      fail(errors, "ci-batch must record exactly one typed setup execution for the selected class");
    }
    const installCommandCount = (topology.runSteps || []).filter((step) => forbiddenEmbeddedSetup({ cmd: "bash", args: ["-lc", step.run] })).length;
    if (topology.setupNode?.count !== 1 || installCommandCount !== 0 || topology.recordSetupStep?.count !== 1 || topology.runSuitesStep?.count !== 1) {
      fail(errors, "ci-batch must contain one runtime setup, no free-form install route, one typed setup executor, and one suite runner step");
    }
    if (topology.runSuitesStep?.run !== 'node .github/scripts/ci-batch/run-suite-batch.mjs --run "${{ matrix.class }}"') {
      fail(errors, "ci-batch must invoke the Phase 2 runner with the selected class");
    }
    if (topology.checkout?.action !== PINNED_CHECKOUT || topology.checkout?.fetchDepth !== 0 || topology.checkout?.persistCredentials !== false
        || topology.setupNode?.action !== PINNED_SETUP_NODE || topology.setupNode?.nodeVersion !== "${{ matrix.node }}") {
      fail(errors, "ci-batch must preserve the exact pinned checkout/setup-node, fetch-depth 0, persist-credentials false trust contract");
    }
    const dispatch = topology.dispatch || {};
    const unsupportedPreMatrixContext = [topology.jobIf, dispatch.jobIf].some((condition) => /\b(?:matrix|strategy|steps|runner|job)\b/.test(condition || ""));
    if (unsupportedPreMatrixContext || topology.jobIf !== "github.event_name != 'workflow_dispatch'") {
      fail(errors, "ci-batch job-level if must use only supported pre-matrix event contexts");
    }
    const dispatchInstallCommandCount = (dispatch.runSteps || []).filter((step) => forbiddenEmbeddedSetup({ cmd: "bash", args: ["-lc", step.run] })).length;
    const expectedDispatchUpload = {
      action: "actions/upload-artifact@v4",
      if: "always()",
      name: "suite-results-node20-19-noinstall",
      path: "suite-results.json",
      ifNoFilesFound: "error",
      count: 1,
    };
    if (JSON.stringify(topology.jobKeys) !== JSON.stringify(["batch", "dispatch"])
        || dispatch.runner !== "ubuntu-latest" || dispatch.timeoutMinutes !== 25 || dispatch.hasStrategy
        || dispatch.jobIf !== "github.event_name == 'workflow_dispatch' && inputs.suite == 'issue-2300-orch-artifact-reap'"
        || dispatch.setupNode?.action !== PINNED_SETUP_NODE || dispatch.setupNode?.nodeVersion !== "20.19.4" || dispatch.setupNode?.count !== 1
        || dispatch.checkout?.action !== PINNED_CHECKOUT || dispatch.checkout?.fetchDepth !== 0 || dispatch.checkout?.persistCredentials !== false
        || dispatch.recordSetupStep?.run !== 'node .github/scripts/ci-batch/run-suite-batch.mjs --setup "node20-19-noinstall"' || dispatch.recordSetupStep?.count !== 1
        || dispatch.runSuitesStep?.run !== 'node .github/scripts/ci-batch/run-suite-batch.mjs --run "node20-19-noinstall"' || dispatch.runSuitesStep?.count !== 1
        || dispatchInstallCommandCount !== 0 || JSON.stringify(dispatch.upload) !== JSON.stringify(expectedDispatchUpload)
        || JSON.stringify(topology.workflowDispatch) !== JSON.stringify({ inputs: { suite: { description: "Bounded operational suite", required: true, type: "choice", options: ["issue-2300-orch-artifact-reap"] } } })) {
      fail(errors, "ci-batch workflow_dispatch must use the exact isolated #2300-only route and pinned trust contract");
    }
  } catch (error) {
    fail(errors, `ci-batch.yml is not valid inspectable YAML: ${error.message}`);
  }
  return errors;
}

function sameStrings(actual, expected) {
  return strings(actual) && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

function profileInstallList(profile) {
  if (profile?.install) return [profile.install];
  return Array.isArray(profile?.installs) ? profile.installs : [];
}

// #2436 Phase 2: setup belongs to the class profile and executes once per shard.
// Suite commands are assertions only. Keep this deliberately broad and fail closed:
// a newly embedded package/bootstrap/migration operation is a cost and isolation
// regression even when it is hidden in a compound shell command.
export function forbiddenEmbeddedSetup(command) {
  const source = typeof command === "string"
    ? command
    : Array.isArray(command?.args)
      ? command.args[command.args.length - 1] || ""
      : command?.run || command?.invocation?.argv?.at(-1) || "";
  return shellCommands(String(source)).some(({ executable, argv }) => setupExecutable(executable, argv));
}

function shellTokens(source) {
  const normalized = source.replace(/\\\r?\n/g, " ");
  const tokens = [];
  let word = "";
  let quote = null;
  let escaped = false;
  const push = () => { if (word) { tokens.push({ type: "word", value: word }); word = ""; } };
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (escaped) { word += character; escaped = false; continue; }
    if (quote === "'") { if (character === "'") quote = null; else word += character; continue; }
    if (quote === '"') {
      if (character === '"') quote = null;
      else if (character === "\\") escaped = true;
      else word += character;
      continue;
    }
    if (character === "\\") { escaped = true; continue; }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (character === "#" && !word) {
      while (index < normalized.length && normalized[index] !== "\n") index += 1;
      push(); tokens.push({ type: "op", value: ";" }); continue;
    }
    if (/\s/.test(character)) { push(); if (character === "\n") tokens.push({ type: "op", value: ";" }); continue; }
    if (";&|(){}".includes(character)) {
      push();
      const pair = normalized.slice(index, index + 2);
      if (["&&", "||", ";;"].includes(pair)) { tokens.push({ type: "op", value: pair }); index += 1; }
      else tokens.push({ type: "op", value: character });
      continue;
    }
    word += character;
  }
  push();
  return tokens;
}

function shellCommands(source) {
  const tokens = shellTokens(source);
  const commands = [];
  let words = [];
  const flush = () => {
    if (!words.length) return;
    let index = 0;
    while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(words[index])) index += 1;
    while (["command", "builtin", "exec", "sudo", "env", "nice", "nohup", "time"].includes(words[index])) {
      const wrapper = words[index++];
      const optionTakesValue = wrapper === "sudo"
        ? new Set(["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--chdir", "-R", "--chroot", "-T", "--command-timeout"])
        : wrapper === "env" ? new Set(["-u", "--unset", "-C", "--chdir"])
          : wrapper === "nice" ? new Set(["-n", "--adjustment"]) : new Set();
      while (index < words.length && words[index].startsWith("-")) {
        const option = words[index++];
        if (optionTakesValue.has(option) && index < words.length) index += 1;
      }
      if (wrapper === "env") while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(words[index])) index += 1;
    }
    if (words[index] === "corepack") index += 1;
    const executable = words[index];
    const argv = words.slice(index + 1);
    if (executable) commands.push({ executable: path.basename(executable).toLowerCase(), argv });
    words = [];
  };
  const reserved = new Set(["if", "then", "elif", "else", "fi", "while", "until", "do", "done", "case", "esac", "for", "select", "in", "time", "!"]);
  for (const token of tokens) {
    if (token.type === "op") { flush(); continue; }
    if (!words.length && reserved.has(token.value)) continue;
    words.push(token.value);
  }
  flush();
  return commands;
}

function setupExecutable(executable, argv) {
  const args = argv.map((value) => value.toLowerCase());
  const firstAction = args.find((value) => !value.startsWith("-") && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(value));
  if (["npm", "pnpm", "yarn"].includes(executable) && ["ci", "install", "i", "add"].includes(firstAction)) return true;
  if (["apt", "apt-get", "brew"].includes(executable) && ["update", "install"].includes(firstAction)) return true;
  if (["docker", "podman"].includes(executable) && args.some((value) => ["up", "run", "start"].includes(value))) return true;
  if (executable === "supabase" && (args.join(" ").includes("db reset") || args.join(" ").includes("migration up"))) return true;
  if (["setup-node", "setup-deno", "setup-python"].includes(executable) || /setup-(?:node|deno|python)@/.test(executable)) return true;
  if (["bash", "sh", "zsh"].includes(executable)) {
    const commandIndex = args.findIndex((value) => value === "-c" || value === "-lc");
    if (commandIndex >= 0 && argv[commandIndex + 1]) return forbiddenEmbeddedSetup(argv[commandIndex + 1]);
    return true; // stdin-sourced shell text is not statically inspectable.
  }
  // Dynamic evaluation/source can synthesize an uninspectable setup command.
  if (["eval", "source", ".", "alias"].includes(executable) || executable.includes("$") || executable.includes("`")) return true;
  if (executable === "xargs" && argv.some((value) => ["npm", "pnpm", "yarn", "apt", "apt-get", "brew", "docker", "podman", "supabase"].includes(value.toLowerCase()))) return true;
  if (executable === "find" && args.some((value, index) => ["-exec", "-execdir"].includes(value) && setupExecutable(path.basename(args[index + 1] || ""), args.slice(index + 2)))) return true;
  if (/(?:^|[-_])migrat(?:e|ion)(?:$|[-_])/.test(executable) && args.some((value) => ["up", "apply", "run"].includes(value))) return true;
  // The 46 original commands plus #2399's 5 migrated assertions need only
  // these executable families.
  // Unknown shell executables are not assumed harmless: aliases, copied package
  // managers, bespoke bootstrap wrappers, and future setup tools would otherwise
  // recreate the same bypass under a new name. Adding a family is a reviewed
  // grammar change, not an accidental green.
  return !new Set(["node", "npx", "grep", "echo", "printf", "true", "false", "exit", "test", "["]).has(executable);
}

export function discoverExpectedFilesForSuite(suite, root = DEFAULT_ROOT) {
  const found = new Set();
  const repositoryFiles = new Set(trackedFiles(root));
  for (const step of suite.steps || []) {
    const cwd = step.cwd || suite.cwd || ".";
    const command = step.invocation?.argv?.[1] ?? step.run ?? "";
    for (const config of configPathsFromCommand(command)) {
      for (const selected of filesSelectedByJestConfig(config, cwd, root)) found.add(selected);
    }
    const tokens = command.match(suite.lifecycle === "shadow-active"
      ? /[A-Za-z0-9_@.()\/\[\]+*\-]+/g
      : /[A-Za-z0-9_@.()\/[\]+-]+/g) || [];
    for (let token of tokens) {
      token = token.replace(/[),;:]+$/, "");
      if (!token) continue;
      if (token.includes("*")) {
        // Phase 1 intentionally ignored wildcard tokens. Preserve that reviewed
        // baseline byte-for-byte; Phase 3 shadow variants opt into deterministic
        // wildcard expansion so newly migrated files cannot disappear.
        if (suite.lifecycle !== "shadow-active") continue;
        const relativePattern = path.normalize(path.join(cwd, token)).replaceAll(path.sep, "/");
        const matcher = globToRegExp(relativePattern);
        for (const tracked of trackedFiles(root)) {
          if (matcher.test(tracked.replaceAll(path.sep, "/"))) found.add(tracked);
        }
        continue;
      }
      for (const relative of [path.normalize(path.join(cwd, token)), path.normalize(token)]) {
        // node_modules is setup output, never source ownership. Installed-lane
        // assertions may inspect patched dependency bytes, but their presence
        // must not make the static expectedFiles inventory environment-dependent.
        if (relative.split(path.sep).includes("node_modules")) continue;
        try {
          if (repositoryFiles.has(relative) && fs.statSync(path.join(root, relative)).isFile()) found.add(relative);
        } catch {
          // A command token is often a flag, package, shell variable, or output.
        }
      }
      // Jest also accepts a path/name pattern instead of an explicit filename.
      // Resolve that pattern against the real suite cwd so the registry cannot
      // silently omit a file that the preserved command actually selects.
      if (/^(?:issue|orch|meta)[_-]\d+/i.test(token) && !token.includes("/")) {
        const base = path.join(root, cwd);
        const pending = [base];
        while (pending.length) {
          const directory = pending.pop();
          for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) pending.push(absolute);
            else if (entry.isFile() && entry.name.toLowerCase().includes(token.toLowerCase())) {
              found.add(path.relative(root, absolute));
            }
          }
        }
      }
    }
  }
  return [...found].sort();
}

export function discoverWorkflowProviders(root = DEFAULT_ROOT) {
  const workflowNames = new Set(
    fs
      .readdirSync(path.join(root, ".github/workflows"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
      .map((entry) => entry.name),
  );
  const references = new Map();
  for (const relative of trackedFiles(root)) {
    if (
      relative.startsWith(".github/workflows/") ||
      relative.startsWith("docs/") ||
      relative.endsWith(".md") ||
      relative === ".github/ci-batch/MANIFEST.json" ||
      // This governance proof reconstructs the provider set by name; it is not
      // an external consumer of those workflows and must not self-register them.
      relative === ".github/scripts/strict-grep/issue-2148-ci-node-wave-shadow.tester.test.mjs"
    ) continue;
    const absolute = path.join(root, relative);
    let source;
    try {
      source = fs.readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    const mentioned = new Set(source.match(/[A-Za-z0-9_.-]+\.ya?ml/g) || []);
    for (const name of mentioned) {
      if (!workflowNames.has(name)) continue;
      if (!references.has(name)) references.set(name, []);
      references.get(name).push(relative);
    }
  }
  return [...references]
    .map(([workflow, referenceFiles]) => ({ workflow, referenceFiles: [...new Set(referenceFiles)].sort() }))
    .sort((a, b) => a.workflow.localeCompare(b.workflow));
}

export function validateRegistry(
  manifest,
  { root = DEFAULT_ROOT, liveOrigins = null, workflowProviders = null, matrixSource = null } = {},
) {
  const errors = [];
  const workflowSources = Object.fromEntries(fs
    .readdirSync(path.join(root, ".github/workflows"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => [entry.name, fs.readFileSync(path.join(root, ".github/workflows", entry.name), "utf8")]));
  errors.push(...validateShadowParityMarkers(manifest, workflowSources));
  if (manifest.schemaVersion !== 2) fail(errors, "schemaVersion must be exactly 2");
  if (manifest.generatedAtCommit !== undefined) fail(errors, "generatedAtCommit is forbidden: it makes registry diffs nondeterministic");
  if (manifest.expectedExecutableSuites !== 55 || manifest.expectedSuites !== 55 || manifest.shadowExpectedVariants !== 32) {
    fail(errors, "shadow lock requires exactly 55 executable suites, including 32 shadow variants");
  }
  if (!Array.isArray(manifest.classes) || manifest.classes.length === 0 || new Set(manifest.classes).size !== manifest.classes.length) {
    fail(errors, "classes must be a non-empty unique array");
  }
  if (!manifest.setupProfiles || typeof manifest.setupProfiles !== "object" || Array.isArray(manifest.setupProfiles)) {
    fail(errors, "setupProfiles must be an object");
  } else if (crypto.createHash("sha256").update(JSON.stringify(manifest.setupProfiles)).digest("hex") !== LOCKED_SETUP_PROFILES_SHA256) {
    fail(errors, "setupProfiles differ from the exact reviewed Phase 2 + #2437 shadow setup contract");
  }
  if (!Array.isArray(manifest.suites) || manifest.suites.length !== 55) fail(errors, "suites must contain exactly 55 entries");

  const resolvedMatrixSource = matrixSource ?? fs.readFileSync(path.join(root, ".github/workflows/ci-batch.yml"), "utf8");
  errors.push(...validatePhase2Contract(manifest, resolvedMatrixSource));
  let batchTopology = { matrix: [], setupNode: {}, checkout: {}, recordSetupStep: {}, runSuitesStep: {} };
  try {
    batchTopology = inspectBatchWorkflow(resolvedMatrixSource);
  } catch (error) {
    fail(errors, `ci-batch.yml is not valid inspectable YAML: ${error.message}`);
  }
  const matrixRoutes = new Map();
  for (const route of batchTopology.matrix || []) {
    if (!route.class || matrixRoutes.has(route.class)) fail(errors, `duplicate or empty ci-batch matrix class: ${route.class || "<empty>"}`);
    else matrixRoutes.set(route.class, route);
  }
  if (batchTopology.setupNode?.action !== PINNED_SETUP_NODE || batchTopology.setupNode?.nodeVersion !== "${{ matrix.node }}") {
    fail(errors, "ci-batch setup-node route must use the reviewed pinned action with node-version from matrix.node");
  }

  const profileOwners = new Map();
  const profileEntries = Object.entries(manifest.setupProfiles || {});
  for (const [name, profile] of profileEntries) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      fail(errors, `setup profile ${name} must be an object`);
      continue;
    }
    const expectedKeys = "installs" in profile ? ["runtime", "installs", "classes"] : ["runtime", "install", "classes"];
    if (!sameStrings(Object.keys(profile), expectedKeys)) fail(errors, `setup profile ${name} has a malformed or unknown field`);
    if (profile.runtime?.name !== "node" || !["20", "22", "20.19.4"].includes(profile.runtime?.version) || !sameStrings(Object.keys(profile.runtime || {}), ["name", "version"])) {
      fail(errors, `setup profile ${name} must use an approved exact Node runtime schema`);
    }
    const profileClasses = strings(profile.classes) ? profile.classes : [];
    if (profileClasses.length === 0 || new Set(profileClasses).size !== profileClasses.length) {
      fail(errors, `setup profile ${name} must own a non-empty unique class list`);
    }
    for (const klass of profileClasses) {
      if (!profileOwners.has(klass)) profileOwners.set(klass, []);
      profileOwners.get(klass).push(name);
    }
    const installs = profileInstallList(profile);
    if (profile.install !== null || "installs" in profile) {
      if ("installs" in profile && (!Array.isArray(profile.installs) || profile.installs.length === 0)) fail(errors, `setup profile ${name} installs must be a non-empty ordered array`);
      for (const install of installs) {
      if (!install || typeof install !== "object" || !sameStrings(Object.keys(install), ["cwd", "invocation"])) {
        fail(errors, `setup profile ${name} install must use the exact typed schema`);
      }
      if (!install?.cwd || !fs.existsSync(path.join(root, install.cwd))) fail(errors, `setup profile ${name} install cwd does not exist: ${install?.cwd}`);
      const invocation = install?.invocation;
      const approvedArgv = [["ci"], ["ci", "--ignore-scripts"], ["install", "--no-save", "yaml"]];
      if (invocation?.kind !== "argv" || invocation.command !== "npm" || !sameStrings(Object.keys(invocation || {}), ["kind", "command", "argv"])
          || !approvedArgv.some((argv) => JSON.stringify(argv) === JSON.stringify(invocation.argv))) {
        fail(errors, `setup profile ${name} install is not one of the exact approved typed npm invocations`);
      }
      }
    }
  }
  for (const klass of manifest.classes || []) {
    const owners = profileOwners.get(klass) || [];
    if (owners.length !== 1) fail(errors, `class ${klass} must have exactly one setup profile owner, got ${owners.length}`);
  }
  for (const klass of profileOwners.keys()) {
    if (!manifest.classes?.includes(klass)) fail(errors, `setup profile owns stale or unknown class ${klass}`);
  }
  for (const [klass, route] of matrixRoutes) {
    const ownerName = profileOwners.get(klass)?.[0];
    const profile = manifest.setupProfiles?.[ownerName];
    if (!profile) continue;
    if (route.node !== profile.runtime?.version) fail(errors, `class ${klass}: matrix runtime ${route.node} disagrees with setup profile runtime ${profile.runtime?.version}`);
    const expectsCache = profileInstallList(profile).some((install) => install.invocation.argv[0] === "ci") && profileInstallList(profile).length === 1;
    if ((expectsCache ? "npm" : "") !== route.cache) fail(errors, `class ${klass}: matrix cache route disagrees with exact setup profile`);
  }

  const suiteIds = new Set();
  const suiteOrigins = new Map();
  const selectedProfiles = new Set();
  const suitesById = new Map();
  const capabilityRegistry = manifest.commandCapabilities;
  const capabilityCommands = capabilityRegistry?.commands || [];
  const capabilityRegistryDigest = crypto.createHash("sha256").update(JSON.stringify(capabilityCommands)).digest("hex");
  const preservedPhase2Digest = crypto.createHash("sha256").update(JSON.stringify(capabilityCommands.slice(0, 51))).digest("hex");
  if (capabilityRegistry?.schemaVersion !== 1 || capabilityRegistry?.expectedCommands !== 158
      || capabilityCommands.length !== 158 || capabilityRegistry?.registrySha256 !== LOCKED_SHADOW_CAPABILITY_SHA256
      || capabilityRegistryDigest !== capabilityRegistry?.registrySha256) {
    fail(errors, "the 158 assertion command capabilities must equal the locked Phase 2 + #2437 shadow registry");
  }
  if (preservedPhase2Digest !== LOCKED_ASSERTION_CAPABILITY_SHA256) fail(errors, "the current-main 51 Phase 2 assertion capabilities changed");
  const capabilitiesById = new Map();
  for (const capability of capabilityCommands) {
    if (!capability.id || capabilitiesById.has(capability.id)) fail(errors, `duplicate or empty command capability: ${capability.id || "<empty>"}`);
    else capabilitiesById.set(capability.id, capability);
  }
  const claimedCapabilities = new Set();
  for (const suite of manifest.suites || []) {
    if (!suite.id || suiteIds.has(suite.id)) fail(errors, `duplicate or empty suite id: ${suite.id || "<empty>"}`);
    suiteIds.add(suite.id);
    suitesById.set(suite.id, suite);
    if (!["batched-active", "shadow-active"].includes(suite.lifecycle)) fail(errors, `${suite.id}: lifecycle must be batched-active or shadow-active`);
    if (!manifest.classes?.includes(suite.class)) fail(errors, `${suite.id}: unknown class ${suite.class}`);
    if (!suite.setupProfile || !manifest.setupProfiles?.[suite.setupProfile]) fail(errors, `${suite.id}: unknown setupProfile ${suite.setupProfile}`);
    else selectedProfiles.add(suite.setupProfile);
    if (manifest.setupProfiles?.[suite.setupProfile]?.classes?.includes(suite.class) !== true) {
      fail(errors, `${suite.id}: setupProfile ${suite.setupProfile} does not route class ${suite.class}`);
    }
    if (!suiteOrigins.has(suite.origin)) suiteOrigins.set(suite.origin, []);
    suiteOrigins.get(suite.origin).push(suite);
    const originIsLive = fs.existsSync(path.join(root, suite.origin || ""));
    if (suite.lifecycle === "batched-active" && originIsLive) fail(errors, `${suite.id}: origin is live and batched (duplicate provider): ${suite.origin}`);
    if (suite.lifecycle === "shadow-active" && !originIsLive) fail(errors, `${suite.id}: shadow origin must remain live: ${suite.origin}`);
    if (suite.runtime?.name !== "node" || !["20", "22", "20.19.4"].includes(suite.runtime?.version)) fail(errors, `${suite.id}: runtime must use an approved exact Node version`);
    const profileRuntime = manifest.setupProfiles?.[suite.setupProfile]?.runtime;
    const matrixRuntime = matrixRoutes.get(suite.class)?.node;
    if (suite.runtime?.name !== profileRuntime?.name || suite.runtime?.version !== profileRuntime?.version || suite.runtime?.version !== matrixRuntime) {
      fail(errors, `${suite.id}: suite, setup profile, and matrix runtime must agree exactly`);
    }
    if (!suite.ownerIssue || !/^#\d+$/.test(suite.ownerIssue)) fail(errors, `${suite.id}: ownerIssue must be an issue token`);
    if (!suite.cwd || !fs.existsSync(path.join(root, suite.cwd))) fail(errors, `${suite.id}: cwd does not exist: ${suite.cwd}`);
    if (!suite.requiredContext?.trim()) fail(errors, `${suite.id}: requiredContext classification is missing`);
    if (!suite.exceptionRationale?.includes("Raw shell")) fail(errors, `${suite.id}: suite raw-shell exception is missing`);
    if (!suite.timingSeconds || !("p50" in suite.timingSeconds) || !("p95" in suite.timingSeconds)) fail(errors, `${suite.id}: p50/p95 timing classification is missing`);
    for (const key of ["envNames", "expectedFiles", "originPaths", "externalReferenceFiles", "generatedPaths"]) {
      if (!strings(suite[key])) fail(errors, `${suite.id}: ${key} must be a string array`);
    }
    if (suite.expectedFiles?.length === 0) fail(errors, `${suite.id}: expectedFiles cannot be empty`);
    for (const expected of suite.expectedFiles || []) {
      if (!fs.existsSync(path.join(root, expected))) fail(errors, `${suite.id}: expected file is missing: ${expected}`);
    }
    if (!Array.isArray(suite.steps) || suite.steps.length === 0) fail(errors, `${suite.id}: missing execution steps`);
    for (const [index, step] of (suite.steps || []).entries()) {
      if (!step.run?.trim()) fail(errors, `${suite.id}: step ${index} has an empty compatibility command`);
      const invocation = step.invocation;
      if (invocation?.kind !== "raw-shell" || invocation.command !== "bash" || !strings(invocation.argv) || invocation.argv.length !== 2 || invocation.argv[0] !== "-c" || invocation.argv[1] !== step.run) {
        fail(errors, `${suite.id}: step ${index} typed invocation must be bash [-c, exact legacy command]`);
      }
      if (!step.exceptionRationale?.includes("legacy workflow")) fail(errors, `${suite.id}: step ${index} raw-shell exception is not explicit`);
      const expectedCommandId = `assert:${suite.id}:${String(index + 1).padStart(2, "0")}`;
      const capability = capabilitiesById.get(step.commandId);
      if (step.commandId !== expectedCommandId || !capability) {
        fail(errors, `${suite.id}: step ${index} has no stable assertion command capability`);
      } else {
        claimedCapabilities.add(capability.id);
        const payload = { cwd: step.cwd || ".", executable: invocation.command, argv: invocation.argv };
        const payloadSha256 = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
        if (capability.suiteId !== suite.id || capability.stepIndex !== index || capability.cwd !== payload.cwd
            || capability.executable !== payload.executable || JSON.stringify(capability.argv) !== JSON.stringify(payload.argv)
            || capability.payloadSha256 !== payloadSha256) {
          fail(errors, `${suite.id}: step ${index} differs from its immutable executable/argv capability`);
        }
      }
    }
    const derivedExpectedFiles = discoverExpectedFilesForSuite(suite, root);
    if (JSON.stringify(suite.expectedFiles) !== JSON.stringify(derivedExpectedFiles)) {
      fail(errors, `${suite.id}: expectedFiles must exactly equal files selected by the preserved typed command`);
    }
  }
  const shadowSuites = (manifest.suites || []).filter((suite) => suite.lifecycle === "shadow-active");
  if (shadowSuites.length !== 32) fail(errors, `shadow stage must contain exactly 32 shadow-active variants, got ${shadowSuites.length}`);
  for (const [origin, owners] of suiteOrigins) {
    const expected = path.basename(origin) === "issue-994-ota-env-resolution.yml" ? 2 : 1;
    if (owners.length !== expected) fail(errors, `${origin}: expected exactly ${expected} executable variant(s), got ${owners.length}`);
    const shadowOwners = owners.filter((suite) => suite.lifecycle === "shadow-active");
    if (shadowOwners.length) {
      const variants = shadowOwners.map((suite) => suite.originVariant).sort();
      const expectedVariants = expected === 2 ? ["app-mobile", "mingla-business"] : ["default"];
      if (JSON.stringify(variants) !== JSON.stringify(expectedVariants)) fail(errors, `${origin}: originVariant mapping drifted`);
    }
    for (const suite of owners.filter((item) => item.lifecycle === "shadow-active")) {
      const metadata = inspectWorkflow(root, path.basename(origin));
      if (!suite.shadowContract || suite.shadowContract.workflowSha256 !== metadata?.sourceSha256
          || suite.shadowContract.variant !== suite.originVariant) fail(errors, `${suite.id}: shadow contract no longer matches its live workflow`);
    }
  }
  const calculatedShadowDigest = crypto.createHash("sha256").update(JSON.stringify(shadowSuites.map((suite) => ({
    id: suite.id, origin: suite.origin, originVariant: suite.originVariant, shadowContract: suite.shadowContract,
  })))).digest("hex");
  if (manifest.shadowContractSha256 !== LOCKED_SHADOW_CONTRACT_SHA256 || calculatedShadowDigest !== LOCKED_SHADOW_CONTRACT_SHA256) {
    fail(errors, "the exact 32-variant shadow command/setup/options/trigger contract drifted");
  }
  for (const capability of capabilityCommands) {
    if (!claimedCapabilities.has(capability.id)) fail(errors, `stale unclaimed command capability: ${capability.id}`);
  }

  for (const [name] of profileEntries) if (!selectedProfiles.has(name)) fail(errors, `stale setup profile is not selected by any suite: ${name}`);

  const matrixClasses = new Set(matrixRoutes.keys());
  for (const klass of manifest.classes || []) {
    if (!matrixClasses.has(klass)) fail(errors, `class ${klass} has no ci-batch matrix route`);
  }
  for (const klass of matrixClasses) {
    if (!manifest.classes?.includes(klass)) fail(errors, `ci-batch matrix class ${klass} is absent from registry`);
  }

  const legacy = manifest.legacyOrigins || [];
  if (!Array.isArray(legacy) || legacy.length !== 199) fail(errors, "legacyOrigins must contain exactly the amended 199 origins");
  const legacyKeys = new Set();
  const suiteClaims = new Map();
  for (const item of legacy) {
    const key = `${item.stem}.${item.extension}`;
    if (!item.stem || !["yml", "yaml"].includes(item.extension)) fail(errors, `invalid legacy origin identity: ${key}`);
    if (legacyKeys.has(key)) fail(errors, `duplicate legacy origin: ${key}`);
    legacyKeys.add(key);
    if (!ALLOWED_DISPOSITIONS.has(item.disposition)) fail(errors, `${key}: unknown disposition ${item.disposition}`);
    if (!item.ownerIssue || !/^#\d+$/.test(item.ownerIssue)) fail(errors, `${key}: missing ownerIssue`);
    if (!item.rationale?.trim()) fail(errors, `${key}: missing disposition rationale`);
    const replacements = item.disposition === "batched-active" ? [item.replacementSuite] : item.replacementSuites;
    if (["batched-active", "shadow-active", "batched-historical"].includes(item.disposition)) {
      const expectedClaims = key === "issue-994-ota-env-resolution.yml" ? 2 : 1;
      if (!strings(replacements) || replacements.length !== expectedClaims || new Set(replacements).size !== replacements.length) {
        fail(errors, `${key}: expected exactly ${expectedClaims} unique replacement suite claim(s)`);
      }
      for (const replacement of replacements || []) {
        const suite = suitesById.get(replacement);
        if (!suite) fail(errors, `${key}: missing active replacement suite ${replacement}`);
        else {
          suiteClaims.set(suite.id, (suiteClaims.get(suite.id) || 0) + 1);
          if (path.basename(suite.origin || "") !== key) fail(errors, `${key}: replacement suite ${suite.id} owns ${path.basename(suite.origin || "<empty>")}, not this origin`);
          if (suite.ownerIssue !== item.ownerIssue) fail(errors, `${key}: replacement suite ${suite.id} ownerIssue does not match legacy ownerIssue`);
        }
      }
    }
    if (item.disposition === "shadow-active") {
      if (item.providerWorkflow !== `.github/workflows/${key}` || !fs.existsSync(path.join(root, item.providerWorkflow || ""))) {
        fail(errors, `${key}: shadow stage must keep the exact historical workflow live`);
      }
      const expectedMetadata = inspectWorkflow(root, key);
      if (JSON.stringify(item.workflowMetadata) !== JSON.stringify(expectedMetadata)) fail(errors, `${key}: shadow runtime/setup/trust/trigger inventory drifted`);
    } else if (item.disposition === "batched-historical") {
      if (item.providerWorkflow !== ".github/workflows/ci-batch.yml" || fs.existsSync(path.join(root, `.github/workflows/${key}`))) {
        fail(errors, `${key}: cutover requires the historical wrapper absent and the batch provider exact`);
      }
    } else if (item.disposition !== "batched-active") {
      if (item.providerWorkflow !== `.github/workflows/${key}`) fail(errors, `${key}: live origin must name its sole provider workflow`);
      if (!fs.existsSync(path.join(root, item.providerWorkflow || ""))) fail(errors, `${key}: live provider workflow is missing`);
      const expectedMetadata = inspectWorkflow(root, key);
      if (JSON.stringify(item.workflowMetadata) !== JSON.stringify(expectedMetadata)) fail(errors, `${key}: runtime/setup/trust/trigger inventory drifted`);
    }
  }
  for (const suite of manifest.suites || []) {
    const claims = suiteClaims.get(suite.id) || 0;
    if (claims !== 1) fail(errors, `${suite.id}: executable suite must be claimed by exactly one batched legacy origin, got ${claims}`);
  }
  const expectedOriginKeys = new Set(liveOrigins ?? discoverLiveOrigins(root));
  for (const suite of manifest.suites || []) expectedOriginKeys.add(path.basename(suite.origin));
  for (const key of expectedOriginKeys) if (!legacyKeys.has(key)) fail(errors, `origin omitted from registry: ${key}`);
  for (const key of legacyKeys) if (!expectedOriginKeys.has(key)) fail(errors, `stale or invented origin in registry: ${key}`);

  const discoveredProviders = workflowProviders ?? discoverWorkflowProviders(root);
  const registeredProviders = manifest.workflowProviders || [];
  if (!Array.isArray(registeredProviders) || registeredProviders.length !== 89) fail(errors, "workflowProviders must contain exactly the amended 89 providers");
  const providerKeys = new Set();
  const registeredByName = new Map();
  for (const item of registeredProviders) {
    if (!item.workflow || providerKeys.has(item.workflow)) fail(errors, `duplicate or empty workflow provider: ${item.workflow || "<empty>"}`);
    providerKeys.add(item.workflow);
    registeredByName.set(item.workflow, item);
    if (!["retained-live-provider", "batched-provider"].includes(item.transition)) fail(errors, `${item.workflow}: unknown provider transition`);
    if (!strings(item.referenceFiles) || item.referenceFiles.length === 0) fail(errors, `${item.workflow}: referenceFiles must be non-empty`);
    for (const ref of item.referenceFiles || []) if (!fs.existsSync(path.join(root, ref))) fail(errors, `${item.workflow}: stale reference file ${ref}`);
    if (item.transition === "retained-live-provider") {
      if (item.providerWorkflow !== `.github/workflows/${item.workflow}` || !fs.existsSync(path.join(root, item.providerWorkflow))) {
        fail(errors, `${item.workflow}: retained provider must remain the exact live historical wrapper`);
      }
    } else {
      if (item.providerWorkflow !== ".github/workflows/ci-batch.yml" || fs.existsSync(path.join(root, `.github/workflows/${item.workflow}`))) {
        fail(errors, `${item.workflow}: batched provider requires exact batch provider and absent historical wrapper`);
      }
    }
  }
  for (const discovered of discoveredProviders) {
    const registered = registeredByName.get(discovered.workflow);
    if (!registered) fail(errors, `externally referenced workflow provider omitted: ${discovered.workflow}`);
    else if (JSON.stringify(registered.referenceFiles) !== JSON.stringify(discovered.referenceFiles)) {
      fail(errors, `${discovered.workflow}: external reference file inventory drifted`);
    }
  }
  for (const name of providerKeys) {
    const registration = registeredByName.get(name);
    if (registration.transition === "retained-live-provider" && !discoveredProviders.some((item) => item.workflow === name)) {
      fail(errors, `stale external provider registration: ${name}`);
    }
  }

  return errors;
}

export function loadAndValidate(manifestPath = DEFAULT_MANIFEST, options = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return { manifest, errors: validateRegistry(manifest, options) };
}

function main() {
  const manifestPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_MANIFEST;
  const { errors } = loadAndValidate(manifestPath);
  if (errors.length) {
    for (const error of errors) console.error(`::error::${error}`);
    console.error(`#2435 registry v2: FAIL (${errors.length} error(s))`);
    process.exit(1);
  }
  console.log("#2437 shadow registry: PASS — 199 origins, 55 executable suites (32 shadow), 89 external providers");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
