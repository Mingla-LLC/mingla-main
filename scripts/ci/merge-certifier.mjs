#!/usr/bin/env node
// MINGLA-INVARIANT: I-MERGE-CERTIFIER-EXACT-CANDIDATE | issue #1865 | Certification is success only when the open PR's synthetic merge commit has exact current-main/head parents and every path-applicable PR lane reports terminal success for that same head/base tuple.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_REPOSITORY = "Mingla-LLC/mingla-main";
export const DEFAULT_BRANCH = "main";
export const HOST_WORKFLOW_PATH = `.github/workflows/${["bundle", "baseline", "provenance", "guard"].join("-")}.${["y", "ml"].join("")}`;
export const TERMINAL_SUCCESS = "success";
export const MAX_CHANGED_FILES = 3000;
export const GITHUB_ACTIONS_APP_ID = 15368;
const SHA = /^[0-9a-f]{40}$/;
const WORKFLOW_PATH = /^\.github\/workflows\/[A-Za-z0-9._/-]+\.ya?ml$/;
const RUN_STATUSES = new Set(["queued", "in_progress", "completed", "requested", "waiting", "pending"]);
const RUN_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "skipped",
  "stale",
  "startup_failure",
  "success",
  "timed_out",
]);
const FILE_STATUSES = new Set(["added", "changed", "copied", "modified", "removed", "renamed", "unchanged"]);

export class CertifierError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "CertifierError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CertifierError(code, message);
}

function assertSha(value, label) {
  if (!SHA.test(String(value ?? ""))) fail("MALFORMED_API", `${label} is not a full commit SHA`);
  return value;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("MALFORMED_API", `${label} is not an object`);
  }
  return value;
}

const RUBY_PARSE = String.raw`
require "yaml"
require "json"
require "psych"

def visit(node, file, anchors, counter, depth = 0)
  raise "YAML nesting exceeds 40 levels" if depth > 40
  counter[0] += 1
  raise "YAML document exceeds 100,000 syntax nodes" if counter[0] > 100_000
  if node.respond_to?(:anchor) && node.anchor && !node.anchor.empty? && !node.is_a?(Psych::Nodes::Alias)
    raise "duplicate YAML anchor #{node.anchor.inspect}" if anchors.key?(node.anchor)
    anchors[node.anchor] = node
  end
  Array(node.respond_to?(:children) ? node.children : []).each do |child|
    visit(child, file, anchors, counter, depth + 1)
  end
end

def dereference(node, anchors, stack = [])
  return node unless node.is_a?(Psych::Nodes::Alias)
  name = node.anchor
  raise "unknown YAML alias #{name.inspect}" unless anchors.key?(name)
  raise "cyclic YAML alias #{name.inspect}" if stack.include?(name)
  dereference(anchors.fetch(name), anchors, stack + [name])
end

def verify_alias_graph(node, anchors, budget, stack = [])
  budget[0] += 1
  raise "YAML alias expansion exceeds 200,000 nodes" if budget[0] > 200_000
  if node.is_a?(Psych::Nodes::Alias)
    name = node.anchor
    raise "unknown YAML alias #{name.inspect}" unless anchors.key?(name)
    raise "cyclic YAML alias #{name.inspect}" if stack.include?(name)
    verify_alias_graph(anchors.fetch(name), anchors, budget, stack + [name])
    return
  end
  Array(node.respond_to?(:children) ? node.children : []).each do |child|
    verify_alias_graph(child, anchors, budget, stack)
  end
end

def scalar(node, anchors)
  node = dereference(node, anchors)
  raise "expected a scalar YAML value" unless node.is_a?(Psych::Nodes::Scalar)
  return nil if node.tag == "tag:yaml.org,2002:null" || (node.plain && ["", "~", "null", "Null", "NULL"].include?(node.value))
  node.value
end

def pairs(node, anchors)
  node = dereference(node, anchors)
  raise "expected a YAML mapping" unless node.is_a?(Psych::Nodes::Mapping)
  node.children.each_slice(2).map do |key, value|
    [scalar(key, anchors), value]
  end
end

def duplicate_keys(node, file, anchors, errors, location = "root")
  # Every anchor's source node is already present in the syntax tree and is
  # checked there. Do not traverse an alias target again here; doing so would
  # turn a harmless shared list into duplicate work and a hostile alias graph
  # into recursive expansion. verify_alias_graph has already proven the graph.
  return if node.is_a?(Psych::Nodes::Alias)
  if node.is_a?(Psych::Nodes::Mapping)
    seen = {}
    node.children.each_slice(2) do |key, value|
      begin
        rendered = scalar(key, anchors)
      rescue => error
        errors << "#{file}: invalid YAML key at #{location}: #{error.message}"
        next
      end
      errors << "#{file}: duplicate YAML key #{rendered.inspect} at #{location}" if seen.key?(rendered)
      seen[rendered] = true
      duplicate_keys(value, file, anchors, errors, "#{location}.#{rendered}")
    end
  elsif node.respond_to?(:children)
    Array(node.children).each { |child| duplicate_keys(child, file, anchors, errors, location) }
  end
end

def string_list(node, anchors)
  node = dereference(node, anchors)
  raise "expected a YAML sequence" unless node.is_a?(Psych::Nodes::Sequence)
  values = node.children.map { |child| scalar(child, anchors) }
  raise "path/branch/type list contains null" if values.any?(&:nil?)
  raise "path/branch/type list exceeds 1,000 values" if values.length > 1_000
  values
end

def event_config(node, anchors)
  node = dereference(node, anchors)
  return nil if node.is_a?(Psych::Nodes::Scalar) && scalar(node, anchors).nil?
  selected = {}
  pairs(node, anchors).each do |key, value|
    next unless ["branches", "branches-ignore", "paths", "paths-ignore", "types"].include?(key)
    selected[key] = string_list(value, anchors)
  end
  selected
end

def event_declaration(node, anchors)
  node = dereference(node, anchors)
  if node.is_a?(Psych::Nodes::Scalar)
    return scalar(node, anchors)
  elsif node.is_a?(Psych::Nodes::Sequence)
    return string_list(node, anchors)
  end
  pairs(node, anchors).to_h do |event, config|
    [event, ["pull_request", "pull_request_target"].include?(event) ? event_config(config, anchors) : nil]
  end
end

payload = JSON.parse(STDIN.read)
documents = {}
errors = []
payload.fetch("sources").each do |file, source|
  begin
    stream = Psych.parse_stream(source, filename: file)
    root = stream.children.fetch(0).root
    raise "empty YAML document" unless root
    anchors = {}
    visit(root, file, anchors, [0])
    verify_alias_graph(root, anchors, [0])
    duplicate_keys(root, file, anchors, errors)
    top = pairs(root, anchors).to_h
    name = top.key?("name") ? scalar(top.fetch("name"), anchors) : nil
    trigger = top.key?("on") ? event_declaration(top.fetch("on"), anchors) : nil
    documents[file] = {"name" => name, "on" => trigger}
  rescue => error
    errors << "#{file}: malformed or unresolvable YAML: #{error.class}: #{error.message.lines.first.to_s.strip}"
  end
end
STDOUT.write(JSON.generate({"documents" => documents, "errors" => errors}))
`;

export function parseWorkflowSources(sources) {
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) {
    fail("MALFORMED_WORKFLOW", "workflow source inventory is not an object");
  }
  const entries = Object.entries(sources);
  const totalBytes = entries.reduce((sum, [file, source]) => {
    if (!WORKFLOW_PATH.test(file) || typeof source !== "string") {
      fail("MALFORMED_WORKFLOW", `invalid workflow source entry ${JSON.stringify(file)}`);
    }
    if (Buffer.byteLength(source) > 1024 * 1024) fail("MALFORMED_WORKFLOW", `${file} exceeds 1 MiB`);
    return sum + Buffer.byteLength(source);
  }, 0);
  if (totalBytes > 16 * 1024 * 1024) fail("MALFORMED_WORKFLOW", "workflow inventory exceeds 16 MiB");

  let parsed;
  try {
    parsed = JSON.parse(execFileSync("ruby", ["-e", RUBY_PARSE], {
      input: JSON.stringify({ sources }),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    }));
  } catch (error) {
    fail("MALFORMED_WORKFLOW", `Ruby/Psych inspection failed: ${error.message}`);
  }
  if (!Array.isArray(parsed?.errors) || !parsed?.documents || typeof parsed.documents !== "object") {
    fail("MALFORMED_WORKFLOW", "workflow parser returned an incomplete result");
  }
  if (parsed.errors.length) fail("MALFORMED_WORKFLOW", parsed.errors.join(" | "));
  return parsed.documents;
}

function regexEscape(character) {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

export function globToRegExp(pattern) {
  if (typeof pattern !== "string" || !pattern || pattern.includes("\0") || pattern.startsWith("/")) {
    fail("MALFORMED_WORKFLOW", `unsupported path pattern ${JSON.stringify(pattern)}`);
  }
  let result = "^";
  for (let index = 0; index < pattern.length;) {
    const character = pattern[index];
    if (character === "\\") {
      if (index + 1 >= pattern.length) fail("MALFORMED_WORKFLOW", `dangling escape in ${pattern}`);
      result += regexEscape(pattern[index + 1]);
      index += 2;
      continue;
    }
    if (character === "*" && pattern[index + 1] === "*") {
      const followedBySlash = pattern[index + 2] === "/";
      result += followedBySlash ? "(?:.*/)?" : ".*";
      index += followedBySlash ? 3 : 2;
      continue;
    }
    if (character === "*") {
      result += "[^/]*";
      index += 1;
      continue;
    }
    if (character === "?") {
      result += "[^/]";
      index += 1;
      continue;
    }
    if (character === "[") {
      const close = pattern.indexOf("]", index + 1);
      if (close < 0) {
        result += "\\[";
        index += 1;
        continue;
      }
      let body = pattern.slice(index + 1, close);
      if (!body) fail("MALFORMED_WORKFLOW", `empty character class in ${pattern}`);
      if (body.startsWith("!")) body = `^${body.slice(1)}`;
      result += `[${body.replace(/\\/g, "\\\\")}]`;
      index = close + 1;
      continue;
    }
    result += regexEscape(character);
    index += 1;
  }
  return new RegExp(`${result}$`);
}

const globCache = new Map();
function matches(pattern, value) {
  if (!globCache.has(pattern)) globCache.set(pattern, globToRegExp(pattern));
  return globCache.get(pattern).test(value);
}

export function matchesOrderedPatterns(patterns, value) {
  if (!Array.isArray(patterns) || !patterns.length || !patterns.every((item) => typeof item === "string")) {
    fail("MALFORMED_WORKFLOW", "path/branch pattern list must be a non-empty string array");
  }
  if (!patterns.some((item) => !item.startsWith("!"))) {
    fail("MALFORMED_WORKFLOW", "an ordered pattern list must contain a positive pattern");
  }
  let included = false;
  for (const raw of patterns) {
    const negative = raw.startsWith("!");
    const pattern = negative ? raw.slice(1) : raw;
    if (!pattern) fail("MALFORMED_WORKFLOW", "empty negative pattern");
    if (matches(pattern, value)) included = !negative;
  }
  return included;
}

function eventMap(document, workflowPath) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    fail("MALFORMED_WORKFLOW", `${workflowPath} document is not a mapping`);
  }
  const onValue = document.on;
  if (typeof onValue === "string") return new Map([[onValue, null]]);
  if (Array.isArray(onValue)) {
    if (!onValue.every((value) => typeof value === "string")) {
      fail("MALFORMED_WORKFLOW", `${workflowPath} event list contains a non-string`);
    }
    return new Map(onValue.map((value) => [value, null]));
  }
  if (!onValue || typeof onValue !== "object" || Array.isArray(onValue)) {
    fail("MALFORMED_WORKFLOW", `${workflowPath} has no supported event declaration`);
  }
  return new Map(Object.entries(onValue));
}

function stringArray(block, key, workflowPath) {
  if (!block || !Object.hasOwn(block, key)) return null;
  const value = block[key];
  if (!Array.isArray(value) || !value.length || !value.every((item) => typeof item === "string")) {
    fail("MALFORMED_WORKFLOW", `${workflowPath} ${key} must be a non-empty string array`);
  }
  return value;
}

function eventApplies(blockValue, changedFiles, baseBranch, workflowPath) {
  const block = blockValue && typeof blockValue === "object" && !Array.isArray(blockValue) ? blockValue : {};
  const branches = stringArray(block, "branches", workflowPath);
  const branchesIgnore = stringArray(block, "branches-ignore", workflowPath);
  const paths = stringArray(block, "paths", workflowPath);
  const pathsIgnore = stringArray(block, "paths-ignore", workflowPath);
  const types = stringArray(block, "types", workflowPath);
  if (branches && branchesIgnore) fail("MALFORMED_WORKFLOW", `${workflowPath} declares branches and branches-ignore`);
  if (paths && pathsIgnore) fail("MALFORMED_WORKFLOW", `${workflowPath} declares paths and paths-ignore`);
  // Certification represents a final candidate generation. A workflow that
  // cannot run on `synchronize` (for example a close-only release recorder) is
  // not a candidate test lane. Workflows with no explicit types use GitHub's
  // default opened/synchronize/reopened activity set and therefore qualify.
  if (types && !types.includes("synchronize")) return false;
  if (branches && !matchesOrderedPatterns(branches, baseBranch)) return false;
  if (branchesIgnore && branchesIgnore.some((pattern) => matches(pattern, baseBranch))) return false;
  if (paths && !changedFiles.some((file) => matchesOrderedPatterns(paths, file))) return false;
  if (pathsIgnore && changedFiles.every((file) => pathsIgnore.some((pattern) => matches(pattern, file)))) return false;
  return true;
}

function lanesFromDocuments(documents, event, changedFiles, baseBranch) {
  const lanes = [];
  for (const workflowPath of Object.keys(documents).sort()) {
    if (workflowPath === HOST_WORKFLOW_PATH) continue;
    const document = documents[workflowPath];
    const events = eventMap(document, workflowPath);
    if (!events.has(event)) continue;
    if (!eventApplies(events.get(event), changedFiles, baseBranch, workflowPath)) continue;
    if (typeof document.name !== "string" || !document.name.trim()) {
      fail("MALFORMED_WORKFLOW", `${workflowPath} has no stable display name`);
    }
    lanes.push({ path: workflowPath, event, name: document.name.trim() });
  }
  return lanes;
}

export function discoverExpectedLanes({ pullSources, targetSources, changedFiles, baseBranch = DEFAULT_BRANCH }) {
  if (!Array.isArray(changedFiles) || !changedFiles.length || !changedFiles.every((file) => typeof file === "string" && file)) {
    fail("MALFORMED_API", "changed-file inventory is empty or malformed");
  }
  if (changedFiles.length > MAX_CHANGED_FILES) {
    fail("DIFF_TOO_LARGE", `GitHub path filters inspect at most ${MAX_CHANGED_FILES} changed files; split this pull request`);
  }
  const pullDocuments = parseWorkflowSources(pullSources);
  const targetDocuments = parseWorkflowSources(targetSources);
  const lanes = [
    ...lanesFromDocuments(pullDocuments, "pull_request", changedFiles, baseBranch),
    ...lanesFromDocuments(targetDocuments, "pull_request_target", changedFiles, baseBranch),
  ].sort((left, right) => `${left.path}:${left.event}`.localeCompare(`${right.path}:${right.event}`));
  const identities = new Set();
  for (const lane of lanes) {
    const identity = `${lane.path}\0${lane.event}`;
    if (identities.has(identity)) fail("MALFORMED_WORKFLOW", `duplicate lane identity ${lane.path} (${lane.event})`);
    identities.add(identity);
  }
  if (!lanes.length) fail("MALFORMED_WORKFLOW", "zero applicable PR lanes discovered");
  return lanes;
}

function runPath(run) {
  return String(run?.path ?? "").split("@")[0];
}

function validateRun(run, repository) {
  assertPlainObject(run, "workflow run");
  if (!Number.isSafeInteger(run.id) || run.id <= 0) fail("MALFORMED_API", "workflow run id is invalid");
  if (!Number.isSafeInteger(run.workflow_id) || run.workflow_id <= 0) fail("MALFORMED_API", `run ${run.id} workflow id is invalid`);
  if (!Number.isSafeInteger(run.check_suite_id) || run.check_suite_id <= 0) fail("MALFORMED_API", `run ${run.id} check suite id is invalid`);
  if (!WORKFLOW_PATH.test(runPath(run))) fail("MALFORMED_API", `run ${run.id} workflow path is invalid`);
  if (!RUN_STATUSES.has(run.status)) fail("MALFORMED_API", `run ${run.id} status is invalid`);
  if (run.conclusion !== null && !RUN_CONCLUSIONS.has(run.conclusion)) {
    fail("MALFORMED_API", `run ${run.id} conclusion is invalid`);
  }
  if (run.status === "completed" && run.conclusion === null) fail("MALFORMED_API", `run ${run.id} completed without a conclusion`);
  if (run.status !== "completed" && run.conclusion !== null) fail("MALFORMED_API", `run ${run.id} is pending with a conclusion`);
  assertSha(run.head_sha, `run ${run.id} head_sha`);
  if (!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) fail("MALFORMED_API", `run ${run.id} attempt is invalid`);
  if (!Array.isArray(run.pull_requests)) fail("MALFORMED_API", `run ${run.id} pull_requests is absent`);
  if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository) {
    fail("MALFORMED_API", `run ${run.id} repository provenance does not match ${repository}`);
  }
  const timestamp = Date.parse(run.run_started_at ?? run.created_at ?? "");
  if (!timestamp) fail("MALFORMED_API", `run ${run.id} timestamp is absent`);
  return run;
}

function exactPullAssociation(run, prNumber, headSha, baseSha, repository) {
  return run.pull_requests.some((pull) =>
    pull?.number === prNumber &&
    pull?.head?.sha === headSha &&
    pull?.base?.sha === baseSha &&
    pull?.head?.repo?.url === `https://api.github.com/repos/${repository}` &&
    pull?.base?.repo?.url === `https://api.github.com/repos/${repository}`
  );
}

function newestRun(runs) {
  return [...runs].sort((left, right) => {
    const time = (run) => Date.parse(run.run_started_at ?? run.created_at ?? "") || 0;
    return time(right) - time(left) || right.run_attempt - left.run_attempt || right.id - left.id;
  })[0];
}

export function evaluateCertification({ expectedLanes, runs, repository = DEFAULT_REPOSITORY, prNumber, headSha, baseSha }) {
  if (!Array.isArray(expectedLanes) || !expectedLanes.length) fail("MALFORMED_API", "expected lane set is empty");
  if (!Array.isArray(runs)) fail("MALFORMED_API", "workflow run list is absent");
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) fail("MALFORMED_API", "pull request number is invalid");
  assertSha(headSha, "pull request head");
  assertSha(baseSha, "pull request base");
  const checkedRuns = runs.map((run) => validateRun(run, repository));
  const entries = [];

  for (const lane of expectedLanes) {
    const sameLaneAndHead = checkedRuns.filter((run) =>
      runPath(run) === lane.path && run.event === lane.event && run.head_sha === headSha
    );
    const exact = sameLaneAndHead.filter((run) => exactPullAssociation(run, prNumber, headSha, baseSha, repository));
    if (!exact.length) {
      entries.push({ ...lane, state: sameLaneAndHead.length ? "stale" : "missing", run: null });
      continue;
    }
    const run = newestRun(exact);
    if (run.status !== "completed") {
      entries.push({ ...lane, state: "pending", detail: run.status, run });
      continue;
    }
    if (run.conclusion !== TERMINAL_SUCCESS) {
      entries.push({ ...lane, state: "failed", detail: run.conclusion, run });
      continue;
    }
    entries.push({ ...lane, state: "success", detail: run.conclusion, run });
  }

  const certified = entries.every((entry) => entry.state === "success");
  return {
    certified,
    expected: entries.length,
    succeeded: entries.filter((entry) => entry.state === "success").length,
    entries,
  };
}

export function proveExecutedJobs(verdict, checkRuns, {
  repository = DEFAULT_REPOSITORY,
  headSha,
  actionsAppId = GITHUB_ACTIONS_APP_ID,
} = {}) {
  if (!verdict || !Array.isArray(verdict.entries)) fail("MALFORMED_API", "certification verdict is incomplete");
  if (!Array.isArray(checkRuns)) fail("MALFORMED_API", "check-run inventory is absent");
  assertSha(headSha, "check-run head");
  const entries = verdict.entries.map((entry) => {
    if (entry.state !== "success") return { ...entry };
    const run = entry.run;
    const jobUrlPrefix = `https://github.com/${repository}/actions/runs/${run.id}/job/`;
    const matches = checkRuns.filter((check) =>
      check?.app?.id === actionsAppId &&
      check?.check_suite?.id === run.check_suite_id &&
      String(check?.details_url ?? "").startsWith(jobUrlPrefix) &&
      /^\d+$/.test(String(check?.details_url ?? "").slice(jobUrlPrefix.length))
    );
    const successfulJobs = matches.filter((check) => {
      if (!Number.isSafeInteger(check.id) || check.id <= 0) fail("MALFORMED_API", `run ${run.id} has an invalid check-run id`);
      if (Number(String(check.details_url).slice(jobUrlPrefix.length)) !== check.id) {
        fail("MALFORMED_API", `check run ${check.id} details URL does not identify the same job`);
      }
      if (check.head_sha !== headSha) fail("MALFORMED_API", `check run ${check.id} head does not match the pull request`);
      if (check.status !== "completed" || check.conclusion !== "success") return false;
      if (!Date.parse(check.started_at ?? "") || !Date.parse(check.completed_at ?? "")) {
        fail("MALFORMED_API", `successful check run ${check.id} has incomplete timestamps`);
      }
      return true;
    });
    if (!successfulJobs.length) {
      return { ...entry, state: "failed", detail: matches.length ? "no-successful-job" : "job-evidence-missing", jobProof: [] };
    }
    return { ...entry, jobProof: successfulJobs.map((check) => check.id).sort((a, b) => a - b) };
  });
  return {
    certified: entries.every((entry) => entry.state === "success"),
    expected: entries.length,
    succeeded: entries.filter((entry) => entry.state === "success").length,
    entries,
  };
}

export function certificationEvidence(verdict) {
  if (!verdict || !Array.isArray(verdict.entries)) fail("MALFORMED_API", "certification verdict is incomplete");
  return JSON.stringify(verdict.entries.map((entry) => ({
    path: entry.path,
    event: entry.event,
    state: entry.state,
    detail: entry.detail ?? null,
    id: entry.run?.id ?? null,
    attempt: entry.run?.run_attempt ?? null,
    status: entry.run?.status ?? null,
    conclusion: entry.run?.conclusion ?? null,
    updatedAt: entry.run?.updated_at ?? null,
    jobProof: entry.jobProof ?? null,
  })));
}

export function validateCandidate({ pull, mainRef, mergeCommit, repository = DEFAULT_REPOSITORY, branch = DEFAULT_BRANCH }) {
  assertPlainObject(pull, "pull request");
  assertPlainObject(mainRef, "main ref");
  assertPlainObject(mergeCommit, "synthetic merge commit");
  if (pull.state !== "open") fail("STALE_CANDIDATE", "pull request is not open");
  if (pull.draft !== false) fail("STALE_CANDIDATE", "pull request is still a draft");
  if (pull.base?.ref !== branch) fail("STALE_CANDIDATE", `pull request does not target ${branch}`);
  if (pull.base?.repo?.full_name !== repository || pull.head?.repo?.full_name !== repository) {
    fail("STALE_CANDIDATE", "pull request repository provenance is not same-repository");
  }
  const baseSha = assertSha(pull.base?.sha, "pull request base");
  const headSha = assertSha(pull.head?.sha, "pull request head");
  const candidateSha = assertSha(pull.merge_commit_sha, "pull request synthetic merge commit");
  const mainSha = assertSha(mainRef.object?.sha, "current main");
  if (mainRef.ref !== `refs/heads/${branch}` || mainRef.object?.type !== "commit") {
    fail("MALFORMED_API", "main ref provenance is incomplete");
  }
  if (baseSha !== mainSha) fail("STALE_CANDIDATE", "pull request base is not exact current main");
  if (mergeCommit.sha !== candidateSha) fail("STALE_CANDIDATE", "synthetic merge commit identity changed");
  if (!Array.isArray(mergeCommit.parents) || mergeCommit.parents.length !== 2) {
    fail("STALE_CANDIDATE", "synthetic merge commit does not have exactly two parents");
  }
  if (mergeCommit.parents[0]?.sha !== mainSha || mergeCommit.parents[1]?.sha !== headSha) {
    fail("STALE_CANDIDATE", "synthetic merge commit parents are not exact current main then PR head");
  }
  return { baseSha, headSha, candidateSha, mainSha };
}

export function readWorkflowSources(root = process.cwd()) {
  const directory = path.join(root, ".github", "workflows");
  const sources = {};
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
    const relative = `.github/workflows/${entry.name}`;
    sources[relative] = fs.readFileSync(path.join(directory, entry.name), "utf8");
  }
  return sources;
}

class GitHubApi {
  constructor({ repository, token }) {
    if (!token) fail("AUTH", "GITHUB_TOKEN is required");
    this.repository = repository;
    this.base = `https://api.github.com/repos/${repository}`;
    this.headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "mingla-merge-certifier",
    };
  }

  async get(suffix) {
    const response = await fetch(`${this.base}${suffix}`, { headers: this.headers, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) fail("GITHUB_API", `GET ${suffix} returned ${response.status}`);
    try {
      return await response.json();
    } catch (error) {
      fail("MALFORMED_API", `GET ${suffix} returned invalid JSON: ${error.message}`);
    }
  }

  async pages(suffix, key = null, maxPages = 31) {
    const separator = suffix.includes("?") ? "&" : "?";
    const items = [];
    let reportedTotal = null;
    for (let page = 1; page <= maxPages; page += 1) {
      const payload = await this.get(`${suffix}${separator}per_page=100&page=${page}`);
      const values = key === null ? payload : payload?.[key];
      if (!Array.isArray(values)) fail("MALFORMED_API", `${suffix} page ${page} has no ${key ?? "array"}`);
      if (key && page === 1) {
        if (!Number.isSafeInteger(payload.total_count) || payload.total_count < 0) {
          fail("MALFORMED_API", `${suffix} total_count is invalid`);
        }
        reportedTotal = payload.total_count;
      }
      items.push(...values);
      if (values.length < 100) {
        if (reportedTotal !== null && items.length !== reportedTotal) {
          fail("MALFORMED_API", `${suffix} returned ${items.length} rows but reported ${reportedTotal}`);
        }
        return items;
      }
    }
    fail("MALFORMED_API", `${suffix} exceeded ${maxPages} pages`);
  }
}

export function changedPaths(files, expectedCount) {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1 || expectedCount > MAX_CHANGED_FILES) {
    fail("DIFF_TOO_LARGE", `changed_files=${String(expectedCount)} is outside 1..${MAX_CHANGED_FILES}`);
  }
  if (files.length !== expectedCount) fail("MALFORMED_API", `file inventory returned ${files.length}/${expectedCount}`);
  const paths = new Set();
  for (const file of files) {
    assertPlainObject(file, "changed file");
    if (typeof file.filename !== "string" || !file.filename) fail("MALFORMED_API", "changed filename is absent");
    if (!FILE_STATUSES.has(file.status)) fail("MALFORMED_API", `${file.filename} changed-file status is invalid`);
    if (paths.has(file.filename)) fail("MALFORMED_API", `${file.filename} appears more than once in the changed-file inventory`);
    paths.add(file.filename);
    if (file.status === "renamed") {
      if (typeof file.previous_filename !== "string" || !file.previous_filename) {
        fail("MALFORMED_API", `${file.filename} rename has no previous_filename`);
      }
    }
  }
  return [...paths].sort();
}

function encodedPath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

async function candidateWorkflowSources(api, baseSources, files, headSha) {
  const sources = { ...baseSources };
  const workflowChanges = files.filter((file) =>
    WORKFLOW_PATH.test(file?.filename ?? "") || WORKFLOW_PATH.test(file?.previous_filename ?? "")
  );
  await Promise.all(workflowChanges.map(async (file) => {
    if (file.status === "renamed" && WORKFLOW_PATH.test(file.previous_filename ?? "")) delete sources[file.previous_filename];
    if (file.status === "removed") {
      delete sources[file.filename];
      return;
    }
    if (!WORKFLOW_PATH.test(file.filename)) return;
    const payload = await api.get(`/contents/${encodedPath(file.filename)}?ref=${headSha}`);
    if (payload?.type !== "file" || payload?.path !== file.filename || payload?.encoding !== "base64") {
      fail("MALFORMED_API", `${file.filename} candidate content provenance is incomplete`);
    }
    if (!Number.isSafeInteger(payload.size) || payload.size <= 0 || payload.size > 1024 * 1024) {
      fail("MALFORMED_API", `${file.filename} candidate content size is invalid`);
    }
    const encoded = String(payload.content ?? "").replace(/\s/g, "");
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      fail("MALFORMED_API", `${file.filename} candidate content is not base64`);
    }
    const source = Buffer.from(encoded, "base64").toString("utf8");
    if (Buffer.byteLength(source) !== payload.size) fail("MALFORMED_API", `${file.filename} candidate content is truncated`);
    sources[file.filename] = source;
  }));
  return sources;
}

export function renderVerdict(verdict, { prNumber, headSha, baseSha, candidateSha }) {
  const lines = [
    `Merge Certifier: ${verdict.certified ? "CERTIFIED" : "REFUSED"}`,
    `PR #${prNumber} candidate ${candidateSha.slice(0, 12)} = base ${baseSha.slice(0, 12)} + head ${headSha.slice(0, 12)}`,
    `Applicable lanes: ${verdict.succeeded}/${verdict.expected} terminal-success`,
  ];
  const failures = verdict.entries.filter((entry) => entry.state !== "success");
  for (const entry of failures.slice(0, 30)) {
    lines.push(`- ${entry.state}${entry.detail ? `/${entry.detail}` : ""}: ${entry.path} (${entry.event})`);
  }
  if (failures.length > 30) lines.push(`- …and ${failures.length - 30} more non-success lane(s)`);
  if (!verdict.certified) {
    lines.push("After every applicable lane succeeds, rerun only this Merge Certifier job. Do not rerun assertion failures automatically.");
  }
  return lines.join("\n");
}

export async function certify({ repository = DEFAULT_REPOSITORY, branch = DEFAULT_BRANCH, prNumber, token, root = process.cwd() }) {
  const api = new GitHubApi({ repository, token });
  const [pull, mainBefore] = await Promise.all([
    api.get(`/pulls/${prNumber}`),
    api.get(`/git/ref/heads/${encodeURIComponent(branch)}`),
  ]);
  if (!Number.isSafeInteger(pull?.changed_files) || pull.changed_files < 1 || pull.changed_files > MAX_CHANGED_FILES) {
    fail("DIFF_TOO_LARGE", `changed_files=${String(pull?.changed_files)} is outside 1..${MAX_CHANGED_FILES}`);
  }
  const candidateSha = assertSha(pull?.merge_commit_sha, "pull request synthetic merge commit");
  const headSha = assertSha(pull?.head?.sha, "pull request head");
  const [mergeCommit, files, runs] = await Promise.all([
    api.get(`/git/commits/${candidateSha}`),
    api.pages(`/pulls/${prNumber}/files`),
    api.pages(`/actions/runs?head_sha=${headSha}`, "workflow_runs"),
  ]);
  const identity = validateCandidate({ pull, mainRef: mainBefore, mergeCommit, repository, branch });
  const baseSources = readWorkflowSources(root);
  const pullSources = await candidateWorkflowSources(api, baseSources, files, identity.headSha);
  const changedFiles = changedPaths(files, pull.changed_files);
  const expectedLanes = discoverExpectedLanes({ pullSources, targetSources: baseSources, changedFiles, baseBranch: branch });
  const verdict = evaluateCertification({
    expectedLanes,
    runs,
    repository,
    prNumber,
    headSha: identity.headSha,
    baseSha: identity.baseSha,
  });
  const checksBefore = verdict.certified
    ? await api.pages(`/commits/${identity.headSha}/check-runs?filter=all`, "check_runs")
    : null;
  const [pullAfter, mainAfter, runsAfter, checksAfter] = await Promise.all([
    api.get(`/pulls/${prNumber}`),
    api.get(`/git/ref/heads/${encodeURIComponent(branch)}`),
    api.pages(`/actions/runs?head_sha=${headSha}`, "workflow_runs"),
    checksBefore ? api.pages(`/commits/${identity.headSha}/check-runs?filter=all`, "check_runs") : Promise.resolve(null),
  ]);
  if (pullAfter.head?.sha !== identity.headSha || pullAfter.base?.sha !== identity.baseSha ||
      pullAfter.merge_commit_sha !== identity.candidateSha || pullAfter.state !== "open" || pullAfter.draft !== false) {
    fail("STALE_CANDIDATE", "pull request changed while certification was being evaluated");
  }
  if (mainAfter.object?.sha !== identity.mainSha) fail("STALE_CANDIDATE", `${branch} changed during certification`);
  const finalVerdict = evaluateCertification({
    expectedLanes,
    runs: runsAfter,
    repository,
    prNumber,
    headSha: identity.headSha,
    baseSha: identity.baseSha,
  });
  if (certificationEvidence(verdict) !== certificationEvidence(finalVerdict)) {
    fail("STALE_EVIDENCE", "applicable workflow evidence changed during certification; rerun this job after it settles");
  }
  if (!finalVerdict.certified) return { ...identity, prNumber, verdict: finalVerdict };
  const executedBefore = proveExecutedJobs(verdict, checksBefore, { repository, headSha: identity.headSha });
  const executedAfter = proveExecutedJobs(finalVerdict, checksAfter, { repository, headSha: identity.headSha });
  if (certificationEvidence(executedBefore) !== certificationEvidence(executedAfter)) {
    fail("STALE_EVIDENCE", "job execution evidence changed during certification; rerun this job after it settles");
  }
  return { ...identity, prNumber, verdict: executedAfter };
}

function flagValue(argv, name, fallback = "") {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] !== "certify") {
    console.error("usage: merge-certifier.mjs certify --pr <number> [--repository <owner/repo>] [--branch <branch>]");
    process.exitCode = 2;
    return;
  }
  const prNumber = Number(flagValue(argv, "--pr", process.env.PULL_REQUEST_NUMBER));
  const repository = flagValue(argv, "--repository", process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY);
  const branch = flagValue(argv, "--branch", DEFAULT_BRANCH);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  try {
    const result = await certify({ repository, branch, prNumber, token });
    const report = renderVerdict(result.verdict, result);
    console.log(report);
    if (!result.verdict.certified) {
      console.error(`::error::${report.replace(/\n/g, "%0A")}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`::error::Merge Certifier failed closed: ${error.message}`);
    process.exitCode = 2;
  }
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("merge-certifier.mjs");
if (invokedDirectly) await main();
