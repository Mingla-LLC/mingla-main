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
  "full-suite-superset",
  "build-assertion-consumer",
  "database-special",
  "operational-excluded",
  "approved-retired",
]);
const LOCKED_ASSERTION_CAPABILITY_SHA256 = "92540e31ef9fb7433f6f40a94071b27023786d15c644110e3a43a2929dbe2399";

function fail(errors, message) {
  errors.push(message);
}

function strings(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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

root = ARGV.fetch(0)
names = JSON.parse(STDIN.read)
result = {}

names.each do |name|
  source = File.binread(File.join(root, ".github/workflows", name))
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
  const key = `${path.resolve(root)}\0${names.join("\0")}`;
  if (!workflowInspectionCache.has(key)) {
    const output = execFileSync("ruby", ["-e", RUBY_WORKFLOW_INSPECTOR, path.resolve(root)], {
      input: JSON.stringify(names),
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
install = steps.find { |step| step["name"].to_s.start_with?("Install ") } || {}
record_setup = steps.find { |step| step["name"].to_s == "Record one shard setup" } || {}
run_suites = steps.find { |step| step["name"].to_s.start_with?("Run the ") } || {}
strategy = batch["strategy"].is_a?(Hash) ? batch["strategy"] : {}
matrix = strategy["matrix"].is_a?(Hash) ? strategy["matrix"] : {}
output = {
  "runner" => batch["runs-on"]&.to_s,
  "matrix" => Array(matrix["include"]).map do |entry|
    next {} unless entry.is_a?(Hash)
    { "class" => entry["class"]&.to_s, "node" => entry["node"]&.to_s, "install" => entry["install"]&.to_s }
  end,
  "setupNode" => {
    "action" => setup_node["uses"]&.to_s,
    "nodeVersion" => setup_node.dig("with", "node-version")&.to_s,
    "count" => steps.count { |step| step["uses"].to_s.start_with?("actions/setup-node@") }
  },
  "installStep" => {
    "if" => install["if"]&.to_s,
    "cwd" => install["working-directory"]&.to_s,
    "run" => install["run"]&.to_s
  },
  "recordSetupStep" => {
    "run" => record_setup["run"]&.to_s,
    "count" => steps.count { |step| step["name"].to_s == "Record one shard setup" }
  },
  "runSuitesStep" => {
    "run" => run_suites["run"]&.to_s,
    "count" => steps.count { |step| step["name"].to_s.start_with?("Run the ") }
  },
  "runSteps" => steps.map { |step| { "run" => step["run"]&.to_s, "if" => step["if"]&.to_s } }.select { |step| step["run"] }
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
    if ("timeoutMinutes" in suite || !Number.isInteger(suite.timeoutSeconds) || suite.timeoutSeconds < 1 || suite.timeoutSeconds > 900) {
      fail(errors, `${suite.id}: timeoutSeconds must be an integer from 1 through 900 and timeoutMinutes is forbidden`);
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
      if (forbiddenEmbeddedSetup(step)) fail(errors, `${suite.id}: step ${index} embeds forbidden setup/bootstrap work`);
    }
  }
  try {
    const topology = inspectBatchWorkflow(workflowText);
    if (topology.runner !== "ubuntu-latest") fail(errors, "ci-batch process containment requires the locked ubuntu-latest runner");
    if (topology.recordSetupStep?.run !== 'node .github/scripts/ci-batch/run-suite-batch.mjs --record-setup "${{ matrix.class }}" "${{ matrix.install != \'\' && \'1\' || \'0\' }}"') {
      fail(errors, "ci-batch must record exactly one typed setup execution for the selected class");
    }
    const installCommandCount = (topology.runSteps || []).filter((step) => forbiddenEmbeddedSetup({ cmd: "bash", args: ["-lc", step.run] })).length;
    if (topology.setupNode?.count !== 1 || installCommandCount !== 1 || topology.recordSetupStep?.count !== 1 || topology.runSuitesStep?.count !== 1) {
      fail(errors, "ci-batch must contain exactly one runtime setup, one conditional install route, one setup evidence step, and one suite runner step");
    }
    if (topology.runSuitesStep?.run !== 'node .github/scripts/ci-batch/run-suite-batch.mjs --run "${{ matrix.class }}"') {
      fail(errors, "ci-batch must invoke the Phase 2 runner with the selected class");
    }
  } catch (error) {
    fail(errors, `ci-batch.yml is not valid inspectable YAML: ${error.message}`);
  }
  return errors;
}

function sameStrings(actual, expected) {
  return strings(actual) && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
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
  // The 46 preserved assertion commands need only these executable families.
  // Unknown shell executables are not assumed harmless: aliases, copied package
  // managers, bespoke bootstrap wrappers, and future setup tools would otherwise
  // recreate the same bypass under a new name. Adding a family is a reviewed
  // grammar change, not an accidental green.
  return !new Set(["node", "npx", "grep", "echo", "printf", "true", "false", "exit", "test", "["]).has(executable);
}

export function discoverExpectedFilesForSuite(suite, root = DEFAULT_ROOT) {
  const found = new Set();
  for (const step of suite.steps || []) {
    const cwd = step.cwd || suite.cwd || ".";
    const command = step.invocation?.argv?.[1] ?? step.run ?? "";
    for (const config of configPathsFromCommand(command)) {
      for (const selected of filesSelectedByJestConfig(config, cwd, root)) found.add(selected);
    }
    const tokens = command.match(/[A-Za-z0-9_@.()\/[\]+-]+/g) || [];
    for (let token of tokens) {
      token = token.replace(/[),;:]+$/, "");
      if (!token || token.includes("*")) continue;
      for (const relative of [path.normalize(path.join(cwd, token)), path.normalize(token)]) {
        try {
          if (fs.statSync(path.join(root, relative)).isFile()) found.add(relative);
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
      relative === ".github/ci-batch/MANIFEST.json"
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
  if (manifest.schemaVersion !== 2) fail(errors, "schemaVersion must be exactly 2");
  if (manifest.generatedAtCommit !== undefined) fail(errors, "generatedAtCommit is forbidden: it makes registry diffs nondeterministic");
  if (manifest.expectedExecutableSuites !== 22 || manifest.expectedSuites !== 22) {
    fail(errors, "expectedExecutableSuites and compatibility expectedSuites must both equal the amended lock 22");
  }
  if (!Array.isArray(manifest.classes) || manifest.classes.length === 0 || new Set(manifest.classes).size !== manifest.classes.length) {
    fail(errors, "classes must be a non-empty unique array");
  }
  if (!manifest.setupProfiles || typeof manifest.setupProfiles !== "object" || Array.isArray(manifest.setupProfiles)) {
    fail(errors, "setupProfiles must be an object");
  }
  if (!Array.isArray(manifest.suites) || manifest.suites.length !== 22) fail(errors, "suites must contain exactly 22 entries");

  const resolvedMatrixSource = matrixSource ?? fs.readFileSync(path.join(root, ".github/workflows/ci-batch.yml"), "utf8");
  errors.push(...validatePhase2Contract(manifest, resolvedMatrixSource));
  let batchTopology = { matrix: [], setupNode: {}, installStep: {}, recordSetupStep: {}, runSuitesStep: {} };
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
  if (batchTopology.setupNode?.action !== "actions/setup-node@v4" || batchTopology.setupNode?.nodeVersion !== "${{ matrix.node }}") {
    fail(errors, "ci-batch setup-node route must remain actions/setup-node@v4 with node-version from matrix.node");
  }
  if (
    batchTopology.installStep?.if !== "matrix.install != ''" ||
    batchTopology.installStep?.cwd !== "${{ matrix.install }}" ||
    batchTopology.installStep?.run !== "npm ci"
  ) fail(errors, "ci-batch install route must remain the exact conditional matrix.install npm ci contract");

  const profileOwners = new Map();
  const profileEntries = Object.entries(manifest.setupProfiles || {});
  for (const [name, profile] of profileEntries) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      fail(errors, `setup profile ${name} must be an object`);
      continue;
    }
    if (!sameStrings(Object.keys(profile), ["runtime", "install", "classes"])) fail(errors, `setup profile ${name} has a malformed or unknown field`);
    if (profile.runtime?.name !== "node" || profile.runtime?.version !== "20" || !sameStrings(Object.keys(profile.runtime || {}), ["name", "version"])) {
      fail(errors, `setup profile ${name} must use the supported exact node 20 runtime schema`);
    }
    const profileClasses = strings(profile.classes) ? profile.classes : [];
    if (profileClasses.length === 0 || new Set(profileClasses).size !== profileClasses.length) {
      fail(errors, `setup profile ${name} must own a non-empty unique class list`);
    }
    for (const klass of profileClasses) {
      if (!profileOwners.has(klass)) profileOwners.set(klass, []);
      profileOwners.get(klass).push(name);
    }
    if (profile.install !== null) {
      const install = profile.install;
      if (!install || typeof install !== "object" || !sameStrings(Object.keys(install), ["cwd", "invocation"])) {
        fail(errors, `setup profile ${name} install must use the exact typed schema`);
      }
      if (!install?.cwd || !fs.existsSync(path.join(root, install.cwd))) fail(errors, `setup profile ${name} install cwd does not exist: ${install?.cwd}`);
      const invocation = install?.invocation;
      if (
        invocation?.kind !== "argv" || invocation.command !== "npm" ||
        !sameStrings(Object.keys(invocation || {}), ["kind", "command", "argv"]) ||
        JSON.stringify(invocation.argv) !== JSON.stringify(["ci"])
      ) fail(errors, `setup profile ${name} install must be the exact typed npm [ci] invocation`);
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
    if (route.install === "") {
      if (profile.install !== null) fail(errors, `class ${klass}: matrix has no install but setup profile ${ownerName} does`);
    } else if (!profile.install || profile.install.cwd !== route.install || profile.install.invocation?.command !== "npm" || JSON.stringify(profile.install.invocation?.argv) !== JSON.stringify(["ci"])) {
      fail(errors, `class ${klass}: setup profile install does not match unchanged matrix install route ${route.install}`);
    }
  }

  const suiteIds = new Set();
  const suiteOrigins = new Set();
  const selectedProfiles = new Set();
  const suitesById = new Map();
  const capabilityRegistry = manifest.commandCapabilities;
  const capabilityCommands = capabilityRegistry?.commands || [];
  const capabilityRegistryDigest = crypto.createHash("sha256").update(JSON.stringify(capabilityCommands)).digest("hex");
  if (capabilityRegistry?.schemaVersion !== 1 || capabilityRegistry?.expectedCommands !== 46
      || capabilityCommands.length !== 46 || capabilityRegistry?.registrySha256 !== LOCKED_ASSERTION_CAPABILITY_SHA256
      || capabilityRegistryDigest !== capabilityRegistry?.registrySha256) {
    fail(errors, "the 46 assertion command capabilities must equal the locked reviewed registry");
  }
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
    if (suite.lifecycle !== "batched-active") fail(errors, `${suite.id}: lifecycle must be batched-active`);
    if (!manifest.classes?.includes(suite.class)) fail(errors, `${suite.id}: unknown class ${suite.class}`);
    if (!suite.setupProfile || !manifest.setupProfiles?.[suite.setupProfile]) fail(errors, `${suite.id}: unknown setupProfile ${suite.setupProfile}`);
    else selectedProfiles.add(suite.setupProfile);
    if (manifest.setupProfiles?.[suite.setupProfile]?.classes?.includes(suite.class) !== true) {
      fail(errors, `${suite.id}: setupProfile ${suite.setupProfile} does not route class ${suite.class}`);
    }
    if (suiteOrigins.has(suite.origin)) fail(errors, `${suite.id}: duplicate executable origin ${suite.origin}`);
    suiteOrigins.add(suite.origin);
    if (fs.existsSync(path.join(root, suite.origin || ""))) fail(errors, `${suite.id}: origin is live and batched (duplicate provider): ${suite.origin}`);
    if (suite.runtime?.name !== "node" || suite.runtime?.version !== "20") fail(errors, `${suite.id}: runtime must pin node 20`);
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
    if (item.disposition === "batched-active") {
      const suite = suitesById.get(item.replacementSuite);
      if (!suite) fail(errors, `${key}: missing active replacement suite`);
      else {
        suiteClaims.set(suite.id, (suiteClaims.get(suite.id) || 0) + 1);
        if (path.basename(suite.origin || "") !== key) fail(errors, `${key}: replacement suite ${suite.id} owns ${path.basename(suite.origin || "<empty>")}, not this origin`);
        if (suite.ownerIssue !== item.ownerIssue) fail(errors, `${key}: replacement suite ${suite.id} ownerIssue does not match legacy ownerIssue`);
      }
    }
    if (item.disposition !== "batched-active") {
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
  if (!Array.isArray(registeredProviders) || registeredProviders.length !== 90) fail(errors, "workflowProviders must contain exactly the amended 90 providers");
  const providerKeys = new Set();
  const registeredByName = new Map();
  for (const item of registeredProviders) {
    if (!item.workflow || providerKeys.has(item.workflow)) fail(errors, `duplicate or empty workflow provider: ${item.workflow || "<empty>"}`);
    providerKeys.add(item.workflow);
    registeredByName.set(item.workflow, item);
    if (item.transition !== "retained-live-provider") fail(errors, `${item.workflow}: transition must preserve the live provider in Phase 1`);
    if (!strings(item.referenceFiles) || item.referenceFiles.length === 0) fail(errors, `${item.workflow}: referenceFiles must be non-empty`);
    for (const ref of item.referenceFiles || []) if (!fs.existsSync(path.join(root, ref))) fail(errors, `${item.workflow}: stale reference file ${ref}`);
  }
  for (const discovered of discoveredProviders) {
    const registered = registeredByName.get(discovered.workflow);
    if (!registered) fail(errors, `externally referenced workflow provider omitted: ${discovered.workflow}`);
    else if (JSON.stringify(registered.referenceFiles) !== JSON.stringify(discovered.referenceFiles)) {
      fail(errors, `${discovered.workflow}: external reference file inventory drifted`);
    }
  }
  for (const name of providerKeys) {
    if (!discoveredProviders.some((item) => item.workflow === name)) fail(errors, `stale external provider registration: ${name}`);
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
  console.log("#2435 registry v2: PASS — 199 origins, 22 executable suites, 90 external providers");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
