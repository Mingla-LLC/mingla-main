#!/usr/bin/env node
/**
 * Least-privilege bundle-baseline PR handoff (issue #2058).
 *
 * The post-main bundle measurement is trusted, but its proposed baseline is not
 * allowed to bypass normal PR review. This helper creates the generated commit,
 * immutable source-SHA ref and PR through REST with a repository-only GitHub App
 * token. It also verifies generated PRs from a read-only pull_request_target job.
 *
 * Shared-write rules:
 *   - exact refs and PR numbers only;
 *   - no force update, merge, review, approval or auto-merge endpoint;
 *   - main is re-read before every write and immediately after creation writes;
 *   - an existing orphan is never adopted: validate, delete, trusted-recreate;
 *   - predecessor cleanup is full-provenance + strict-ancestor only.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const BASELINE_PATH = "mingla-business/scripts/ci/bundle-baseline.json";
export const BRANCH_PREFIX = "bundle-baseline/main-";
export const WORKFLOW_MARKER = ".github/workflows/bundle-baseline-ratchet.yml";
export const SHA_RE = /^[0-9a-f]{40}$/;
export const BRANCH_RE = /^bundle-baseline\/main-([0-9a-f]{40})$/;
export const LEGACY_BRANCH_RE = /^bundle-baseline\/[0-9a-f]{7}$/;

const apiVersion = "2022-11-28";

export class HandoffError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "HandoffError";
    this.code = code;
    this.details = details;
  }
}

function assertSha(value, label) {
  if (!SHA_RE.test(value ?? "")) {
    throw new HandoffError("INVALID_INPUT", `${label} must be a full lowercase 40-character SHA.`);
  }
  return value;
}

function expectedActor(appSlug) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/i.test(appSlug ?? "")) {
    throw new HandoffError("INVALID_CREDENTIAL_CONFIG", "BUNDLE_BASELINE_APP_SLUG is missing or malformed.");
  }
  return `${appSlug}[bot]`;
}

function parseBranch(branch) {
  const match = BRANCH_RE.exec(branch ?? "");
  if (!match) {
    throw new HandoffError(
      "INVALID_MANAGED_BRANCH",
      `Managed branch must match ${BRANCH_PREFIX}<full lowercase SHA>.`,
    );
  }
  return match[1];
}

function encodeRef(ref) {
  return ref.split("/").map(encodeURIComponent).join("/");
}

function decodeContent(response, label) {
  if (response?.encoding !== "base64" || typeof response?.content !== "string") {
    throw new HandoffError("INVALID_CONTENT", `${label} was not returned as base64 file content.`);
  }
  return Buffer.from(response.content.replace(/\n/g, ""), "base64").toString("utf8");
}

function markerFor(sourceSha) {
  return `Measured from ${sourceSha} by ${WORKFLOW_MARKER}.`;
}

function commitMessage(title, sourceSha) {
  return `${title}\n\n${markerFor(sourceSha)}\nBaseline only — no limit was changed.`;
}

export function makeRestAdapter({ token, owner, repo, fetchImpl = fetch }) {
  if (typeof token !== "string" || token.length < 20) {
    throw new HandoffError(
      "INVALID_CREDENTIAL_CONFIG",
      "The repository-scoped bundle-baseline App token is missing or malformed.",
    );
  }
  if (!owner || !repo) {
    throw new HandoffError("INVALID_INPUT", "Repository owner and name are required.");
  }

  const apiRoot = "https://api.github.com";
  const root = `${apiRoot}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const requestUrl = async (method, url, body = undefined) => {
    const response = await fetchImpl(url, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": apiVersion,
        "User-Agent": "mingla-bundle-baseline-handoff",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return null;
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { message: "GitHub returned a non-JSON response." };
    }
    if (!response.ok) {
      const safeMessage = payload?.message ?? `GitHub REST request failed (${response.status}).`;
      throw new HandoffError("REST_FAILURE", `${method} ${url}: ${safeMessage}`, {
        status: response.status,
      });
    }
    return payload;
  };
  const request = async (method, path, body = undefined) =>
    requestUrl(method, `${root}${path}`, body);

  const paged = async (path) => {
    const rows = [];
    for (let page = 1; page <= 20; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const batch = await request("GET", `${path}${separator}per_page=100&page=${page}`);
      rows.push(...batch);
      if (batch.length < 100) return rows;
    }
    throw new HandoffError("PAGINATION_LIMIT", `Refusing to scan more than 2,000 records for ${path}.`);
  };

  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    getMainSha: async () => (await request("GET", "/git/ref/heads/main")).object.sha,
    getRef: async (branch) => {
      try {
        return await request("GET", `/git/ref/heads/${encodeRef(branch)}`);
      } catch (error) {
        if (error instanceof HandoffError && error.details?.status === 404) return null;
        throw error;
      }
    },
    listManagedRefs: async () => paged("/git/matching-refs/heads/bundle-baseline/"),
    createBlob: async (content) => request("POST", "/git/blobs", { content, encoding: "utf-8" }),
    getGitCommit: async (sha) => request("GET", `/git/commits/${assertSha(sha, "commit SHA")}`),
    getCommit: async (sha) => request("GET", `/commits/${assertSha(sha, "commit SHA")}`),
    createTree: async ({ baseTree, blobSha }) =>
      request("POST", "/git/trees", {
        base_tree: baseTree,
        tree: [{ path: BASELINE_PATH, mode: "100644", type: "blob", sha: blobSha }],
      }),
    createCommit: async ({ message, treeSha, parentSha, actor }) => {
      if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?\[bot\]$/i.test(actor ?? "")) {
        throw new HandoffError("INVALID_CREDENTIAL_CONFIG", "Generated commit actor is missing or malformed.");
      }
      const user = await requestUrl("GET", `${apiRoot}/users/${encodeURIComponent(actor)}`);
      if (user?.login !== actor || user?.type !== "Bot" || !Number.isSafeInteger(user?.id) || user.id <= 0) {
        throw new HandoffError(
          "INVALID_CREDENTIAL_CONFIG",
          "Configured App actor did not resolve to the expected GitHub Bot account.",
        );
      }
      const identity = {
        name: actor,
        email: `${user.id}+${actor}@users.noreply.github.com`,
      };
      return request("POST", "/git/commits", {
        message,
        tree: treeSha,
        parents: [parentSha],
        author: identity,
        committer: identity,
      });
    },
    createRef: async (branch, sha) =>
      request("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha }),
    deleteRef: async (branch) => request("DELETE", `/git/refs/heads/${encodeRef(branch)}`),
    /**
     * Pull requests in this repository, optionally narrowed by GitHub to the
     * ones whose head is exactly `headBranch` on this repository's owner.
     *
     * #3096: every `state: "all"` caller below wanted the pulls for one
     * `bundle-baseline/<sha>` branch and got there by enumerating the whole
     * pull-request history and filtering it down. That walk failed closed on
     * PAGINATION_LIMIT the moment the repository crossed 2,000 pull requests,
     * which it did silently. `head=<owner>:<branch>` asks GitHub the question
     * the filter was already asking, so the exposure is removed rather than
     * deferred to a larger cap that the next threshold would cross just as
     * quietly. Callers keep their own `.filter()`: this narrows by head owner
     * and ref, and the caller still pins the exact head repository. `state` is
     * unchanged, so closed predecessors — the ones reconciliation exists to
     * find — are still returned. The 20-page cap is untouched and still guards
     * this reader and every other one.
     */
    listPulls: async (state = "open", { headBranch = null } = {}) =>
      paged(
        `/pulls?state=${encodeURIComponent(state)}` +
        (headBranch === null ? "" : `&head=${encodeURIComponent(`${owner}:${headBranch}`)}`),
      ),
    getPull: async (number) => request("GET", `/pulls/${number}`),
    getPullFiles: async (number) => paged(`/pulls/${number}/files`),
    createPull: async ({ title, body, branch }) =>
      request("POST", "/pulls", { title, body, head: branch, base: "main" }),
    closePull: async (number) => request("PATCH", `/pulls/${number}`, { state: "closed" }),
    getContent: async (path, ref) =>
      request("GET", `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`),
    compare: async (base, head) =>
      request("GET", `/compare/${assertSha(base, "base SHA")}...${assertSha(head, "head SHA")}`),
  };
}

function managedBranchName(ref) {
  return ref?.ref?.replace(/^refs\/heads\//, "") ?? "";
}

function pullHeadBranch(pull) {
  return pull?.head?.ref ?? "";
}

function pullHeadRepo(pull) {
  return pull?.head?.repo?.full_name ?? "";
}

function pullActor(pull) {
  return pull?.user?.login ?? "";
}

export async function validateManagedArtifact(api, {
  branch,
  expectedAppSlug,
  pull = undefined,
  expectedSourceSha = undefined,
}) {
  const sourceSha = parseBranch(branch);
  if (expectedSourceSha && sourceSha !== expectedSourceSha) {
    throw new HandoffError("PROVENANCE_MISMATCH", `Branch source does not equal expected source ${expectedSourceSha}.`);
  }
  const actor = expectedActor(expectedAppSlug);

  if (pull) {
    if (pullHeadRepo(pull) !== api.fullName) {
      throw new HandoffError("PROVENANCE_MISMATCH", "Generated PR head must belong to this repository.");
    }
    if (pullHeadBranch(pull) !== branch) {
      throw new HandoffError("PROVENANCE_MISMATCH", "Generated PR head ref does not match its source branch.");
    }
    if (pullActor(pull) !== actor) {
      throw new HandoffError("PROVENANCE_MISMATCH", `Generated PR author must be ${actor}.`);
    }
  }

  const ref = await api.getRef(branch);
  if (!ref) throw new HandoffError("PROVENANCE_MISMATCH", `Managed ref ${branch} does not exist.`);
  const headSha = assertSha(ref?.object?.sha, "managed ref head");
  if (pull && pull?.head?.sha !== headSha) {
    throw new HandoffError("PROVENANCE_MISMATCH", "PR head SHA does not equal the live generated ref.");
  }

  const commit = await api.getCommit(headSha);
  const parents = commit?.parents ?? [];
  if (parents.length !== 1 || parents[0]?.sha !== sourceSha) {
    throw new HandoffError("PROVENANCE_MISMATCH", "Generated commit must have exactly the source SHA as its sole parent.");
  }
  if (commit?.author?.login !== actor || commit?.committer?.login !== actor) {
    throw new HandoffError("PROVENANCE_MISMATCH", `Generated commit must be authored and committed by ${actor}.`);
  }
  if (!commit?.commit?.message?.includes(markerFor(sourceSha))) {
    throw new HandoffError("PROVENANCE_MISMATCH", "Generated commit marker does not identify the full source SHA.");
  }

  const comparison = await api.compare(sourceSha, headSha);
  const files = comparison?.files ?? [];
  if (comparison?.ahead_by !== 1 || comparison?.behind_by !== 0 || files.length !== 1 || files[0]?.filename !== BASELINE_PATH) {
    throw new HandoffError("PROVENANCE_MISMATCH", "Generated commit must be exactly one baseline-only commit.");
  }

  const baselineText = decodeContent(await api.getContent(BASELINE_PATH, headSha), BASELINE_PATH);
  let baseline;
  try {
    baseline = JSON.parse(baselineText);
  } catch {
    throw new HandoffError("PROVENANCE_MISMATCH", "Generated baseline is not valid JSON.");
  }
  if (baseline?.measuredOn?.commit !== sourceSha) {
    throw new HandoffError("PROVENANCE_MISMATCH", "Baseline measuredOn.commit does not equal the full source SHA.");
  }

  return { sourceSha, headSha, actor, baseline };
}

async function assertLiveSource(api, sourceSha, stage) {
  const liveMain = assertSha(await api.getMainSha(), "live main SHA");
  if (liveMain !== sourceSha) {
    return { current: false, liveMain, stage };
  }
  return { current: true, liveMain, stage };
}

async function proveStrictAncestor(api, ancestor, descendant) {
  if (ancestor === descendant) return false;
  const comparison = await api.compare(ancestor, descendant);
  return comparison?.status === "ahead" && comparison?.merge_base_commit?.sha === ancestor && comparison?.ahead_by > 0;
}

async function compensateOwnArtifact(api, {
  sourceSha,
  liveMain,
  branch,
  expectedAppSlug,
  pull,
  log,
}) {
  if (!(await proveStrictAncestor(api, sourceSha, liveMain))) {
    throw new HandoffError(
      "STALE_COMPENSATION_BLOCKED",
      `Source ${sourceSha} is not a proven strict ancestor of live main ${liveMain}; exact artifact left for review.`,
    );
  }
  log.ancestryProofs.push(`${sourceSha}->${liveMain}`);
  await validateManagedArtifact(api, { branch, expectedAppSlug, pull, expectedSourceSha: sourceSha });
  if (pull) {
    const beforeClose = await api.getMainSha();
    if (!(await proveStrictAncestor(api, sourceSha, beforeClose))) {
      throw new HandoffError("STALE_COMPENSATION_BLOCKED", "Main ancestry changed before exact PR compensation.");
    }
    log.ancestryProofs.push(`${sourceSha}->${beforeClose}`);
    await api.closePull(pull.number);
    log.closed.push(pull.number);
  }
  const beforeDelete = await api.getMainSha();
  if (!(await proveStrictAncestor(api, sourceSha, beforeDelete))) {
    throw new HandoffError("STALE_COMPENSATION_BLOCKED", "Main ancestry changed before exact ref compensation.");
  }
  log.ancestryProofs.push(`${sourceSha}->${beforeDelete}`);
  await validateManagedArtifact(api, { branch, expectedAppSlug, expectedSourceSha: sourceSha });
  await api.deleteRef(branch);
  log.deleted.push(branch);
}

async function reconcilePredecessors(api, {
  sourceSha,
  expectedAppSlug,
  currentPullNumber,
  log,
}) {
  const batchRead = await assertLiveSource(api, sourceSha, "before reconciliation batch");
  log.mainReads.push(batchRead);
  if (!batchRead.current) return { stale: true, liveMain: batchRead.liveMain };

  const openPulls = await api.listPulls("open");
  const candidates = openPulls.filter((pull) =>
    pull.number !== currentPullNumber &&
    pullHeadRepo(pull) === api.fullName &&
    pullHeadBranch(pull).startsWith("bundle-baseline/"));

  for (const candidate of candidates) {
    const candidateBranch = pullHeadBranch(candidate);
    if (!BRANCH_RE.test(candidateBranch)) {
      throw new HandoffError(
        "COLLISION",
        `Same-prefix PR #${candidate.number} has malformed reserved provenance; left untouched.`,
      );
    }
    const candidateArtifact = await validateManagedArtifact(api, {
      branch: candidateBranch,
      expectedAppSlug,
      pull: candidate,
    });
    if (candidateArtifact.sourceSha === sourceSha) {
      throw new HandoffError("COLLISION", `Duplicate current-source managed PR #${candidate.number} exists.`);
    }
    if (!(await proveStrictAncestor(api, candidateArtifact.sourceSha, sourceSha))) {
      throw new HandoffError(
        "COLLISION",
        `Managed PR #${candidate.number} is descendant, divergent or unproven; left untouched.`,
      );
    }
    log.ancestryProofs.push(`${candidateArtifact.sourceSha}->${sourceSha}`);

    const beforeClose = await assertLiveSource(api, sourceSha, `before close #${candidate.number}`);
    log.mainReads.push(beforeClose);
    if (!beforeClose.current) return { stale: true, liveMain: beforeClose.liveMain };
    await api.closePull(candidate.number);
    log.closed.push(candidate.number);

    const beforeDelete = await assertLiveSource(api, sourceSha, `before delete ${candidateBranch}`);
    log.mainReads.push(beforeDelete);
    if (!beforeDelete.current) return { stale: true, liveMain: beforeDelete.liveMain };
    await validateManagedArtifact(api, {
      branch: candidateBranch,
      expectedAppSlug,
      expectedSourceSha: candidateArtifact.sourceSha,
    });
    await api.deleteRef(candidateBranch);
    log.deleted.push(candidateBranch);
  }

  // A run can be cancelled after ref creation but before PR creation. The next
  // all-main run therefore reconciles fully proven strict-ancestor refs too.
  // Seven-character legacy refs remain quarantined for the separately reviewed,
  // enumerated rollout cleanup and are never automatically treated as current.
  const managedRefs = await api.listManagedRefs();
  // One snapshot, taken before the loop exactly as the whole-history read was,
  // but assembled from one targeted query per reserved ref (#3096).
  const pullsByBranch = new Map();
  for (const ref of managedRefs) {
    const managedBranch = managedBranchName(ref);
    if (managedBranch === "" || pullsByBranch.has(managedBranch)) continue;
    pullsByBranch.set(managedBranch, await api.listPulls("all", { headBranch: managedBranch }));
  }
  for (const ref of managedRefs) {
    const branch = managedBranchName(ref);
    if (branch === `${BRANCH_PREFIX}${sourceSha}` || log.deleted.includes(branch)) continue;
    if (LEGACY_BRANCH_RE.test(branch)) {
      log.untouched.push({ branch, reason: "quarantined-legacy-ref" });
      continue;
    }
    if (!BRANCH_RE.test(branch)) {
      throw new HandoffError("COLLISION", `Malformed reserved ref ${branch} was left untouched.`);
    }
    const matchingPulls = (pullsByBranch.get(branch) ?? []).filter((pull) =>
      pullHeadRepo(pull) === api.fullName && pullHeadBranch(pull) === branch);
    if (matchingPulls.length > 1 || matchingPulls.some((pull) => pull.state === "open")) {
      throw new HandoffError("COLLISION", `Unexpected PR state for reserved predecessor ref ${branch}.`);
    }
    const artifact = await validateManagedArtifact(api, {
      branch,
      expectedAppSlug,
      pull: matchingPulls[0],
    });
    if (!(await proveStrictAncestor(api, artifact.sourceSha, sourceSha))) {
      throw new HandoffError(
        "COLLISION",
        `Reserved ref ${branch} is descendant, divergent or unproven; left untouched.`,
      );
    }
    log.ancestryProofs.push(`${artifact.sourceSha}->${sourceSha}`);
    const beforeDelete = await assertLiveSource(api, sourceSha, `before orphan delete ${branch}`);
    log.mainReads.push(beforeDelete);
    if (!beforeDelete.current) return { stale: true, liveMain: beforeDelete.liveMain };
    const latestMatchingPulls = (await api.listPulls("all", { headBranch: branch })).filter((pull) =>
      pullHeadRepo(pull) === api.fullName && pullHeadBranch(pull) === branch);
    if (
      latestMatchingPulls.length !== matchingPulls.length ||
      latestMatchingPulls.some((pull, index) =>
        pull.number !== matchingPulls[index]?.number || pull.state === "open")
    ) {
      throw new HandoffError(
        "COLLISION",
        `PR state changed before exact orphan cleanup for ${branch}; ref was left untouched.`,
      );
    }
    await validateManagedArtifact(api, {
      branch,
      expectedAppSlug,
      pull: matchingPulls[0],
      expectedSourceSha: artifact.sourceSha,
    });
    await api.deleteRef(branch);
    log.deleted.push(branch);
  }
  return { stale: false };
}

function buildPullBody({ sourceSha, direction, summary, commonRaw, commonBrotli, eagerBrotli }) {
  return `Automated by \`${WORKFLOW_MARKER}\` (issues #1509 and #2058).\n\n` +
    `Re-measured \`main\` at \`${sourceSha}\` and updated \`${BASELINE_PATH}\` to the true numbers.\n\n` +
    `| | value |\n|---|---|\n` +
    `| direction | **${direction}** |\n| movement | ${summary} |\n` +
    `| \`__common\` raw | ${commonRaw} B |\n` +
    `| \`__common\` brotli | ${commonBrotli} B |\n` +
    `| eager payload brotli | ${eagerBrotli} B |\n\n` +
    `**What this changes:** only the measured baseline used by the per-PR delta gate.\n\n` +
    `**What this does not change:** \`HARD_CEILING\` or \`PR_DELTA_ALLOWANCE\`. ` +
    `No automation approves or merges this PR; all normal checks and human review remain required.`;
}

export async function runHandoff(api, options) {
  const sourceSha = assertSha(options.sourceSha, "SOURCE_SHA");
  const expectedAppSlug = options.expectedAppSlug;
  expectedActor(expectedAppSlug);
  if (options.tokenAppSlug !== undefined && options.tokenAppSlug !== expectedAppSlug) {
    throw new HandoffError(
      "INVALID_CREDENTIAL_CONFIG",
      "The minted token App identity does not match BUNDLE_BASELINE_APP_SLUG.",
    );
  }
  const branch = `${BRANCH_PREFIX}${sourceSha}`;
  const changed = options.changed === true;
  let trustedBaseline = null;
  if (changed) {
    try {
      trustedBaseline = JSON.parse(options.baselineContent);
    } catch {
      throw new HandoffError("INVALID_INPUT", "The measured baseline file is not valid JSON.");
    }
    if (trustedBaseline?.measuredOn?.commit !== sourceSha) {
      throw new HandoffError("INVALID_INPUT", "The measured baseline must stamp the exact SOURCE_SHA.");
    }
  }
  const log = {
    state: "START",
    sourceSha,
    branch,
    prUrl: null,
    closed: [],
    deleted: [],
    untouched: [],
    mainReads: [],
    ancestryProofs: [],
    recreatedOrphan: false,
  };

  const firstRead = await assertLiveSource(api, sourceSha, "before first shared write");
  log.mainReads.push(firstRead);
  if (!firstRead.current) return { ...log, state: "SUPERSEDED" };

  const exactPulls = (await api.listPulls("all", { headBranch: branch })).filter((pull) =>
    pullHeadRepo(pull) === api.fullName && pullHeadBranch(pull) === branch);
  const exactOpen = exactPulls.filter((pull) => pull.state === "open");
  const exactClosed = exactPulls.filter((pull) => pull.state === "closed");
  if (exactOpen.length > 1) throw new HandoffError("COLLISION", "More than one exact current-source PR exists.");
  if (exactOpen.length === 0 && exactClosed.length > 0) {
    throw new HandoffError(
      "COLLISION",
      "A closed PR already claims the exact current-source ref; it is not an orphan-recovery candidate.",
    );
  }

  let ref = await api.getRef(branch);
  if (exactOpen.length === 1) {
    if (!changed) {
      throw new HandoffError("COLLISION", "A current-source generated PR exists but the trusted measurement reports no change.");
    }
    const pull = exactOpen[0];
    const artifact = await validateManagedArtifact(api, {
      branch,
      expectedAppSlug,
      pull,
      expectedSourceSha: sourceSha,
    });
    const existingMeasurement = JSON.stringify({
      commit: artifact.baseline?.measuredOn?.commit,
      common: artifact.baseline?.common,
      eager: artifact.baseline?.eager,
    });
    const trustedMeasurement = JSON.stringify({
      commit: trustedBaseline?.measuredOn?.commit,
      common: trustedBaseline?.common,
      eager: trustedBaseline?.eager,
    });
    if (existingMeasurement !== trustedMeasurement) {
      throw new HandoffError(
        "COLLISION",
        "The existing current-source PR does not contain this run's trusted measurement.",
      );
    }
    const fresh = await assertLiveSource(api, sourceSha, "before current PR reuse");
    log.mainReads.push(fresh);
    if (!fresh.current) return { ...log, state: "SUPERSEDED" };
    log.prUrl = pull.html_url;
    log.state = "REUSE";
    const reconciled = await reconcilePredecessors(api, {
      sourceSha,
      expectedAppSlug,
      currentPullNumber: pull.number,
      log,
    });
    return { ...log, state: reconciled.stale ? "STALE_AFTER_WRITE" : "REUSE" };
  }

  if (ref) {
    // A pre-existing branch is never adopted. Complete provenance permits only
    // exact deletion followed by a commit rebuilt by this trusted run.
    await validateManagedArtifact(api, {
      branch,
      expectedAppSlug,
      expectedSourceSha: sourceSha,
    });
    const latestExactPulls = (await api.listPulls("all", { headBranch: branch })).filter((pull) =>
      pullHeadRepo(pull) === api.fullName && pullHeadBranch(pull) === branch);
    if (latestExactPulls.length !== 0) {
      throw new HandoffError(
        "COLLISION",
        "A PR appeared while orphan cleanup was being prepared; the ref was left untouched.",
      );
    }
    const beforeDelete = await assertLiveSource(api, sourceSha, "before orphan delete");
    log.mainReads.push(beforeDelete);
    if (!beforeDelete.current) return { ...log, state: "SUPERSEDED" };
    await api.deleteRef(branch);
    log.deleted.push(branch);
    const afterDelete = await assertLiveSource(api, sourceSha, "after orphan delete");
    log.mainReads.push(afterDelete);
    if (!afterDelete.current) return { ...log, state: "STALE_AFTER_WRITE" };
    log.recreatedOrphan = true;
    ref = null;
  }

  if (!changed) {
    const reconciled = await reconcilePredecessors(api, {
      sourceSha,
      expectedAppSlug,
      currentPullNumber: null,
      log,
    });
    return { ...log, state: reconciled.stale ? "STALE_AFTER_WRITE" : "NO_CHANGE" };
  }

  const beforeCommitWrite = await assertLiveSource(api, sourceSha, "before git-object writes");
  log.mainReads.push(beforeCommitWrite);
  if (!beforeCommitWrite.current) return { ...log, state: "SUPERSEDED" };

  const baseCommit = await api.getGitCommit(sourceSha);
  const blob = await api.createBlob(options.baselineContent);
  const tree = await api.createTree({ baseTree: baseCommit.tree.sha, blobSha: blob.sha });
  const title = options.title;
  const generated = await api.createCommit({
    message: commitMessage(title, sourceSha),
    treeSha: tree.sha,
    parentSha: sourceSha,
    actor: expectedActor(expectedAppSlug),
  });
  const generatedSha = assertSha(generated?.sha, "generated commit SHA");

  const beforeRef = await assertLiveSource(api, sourceSha, "immediately before ref create");
  log.mainReads.push(beforeRef);
  if (!beforeRef.current) return { ...log, state: "SUPERSEDED" };
  let createdRef;
  try {
    createdRef = await api.createRef(branch, generatedSha);
  } catch (error) {
    if (error instanceof HandoffError && error.details?.status === 422) {
      throw new HandoffError("COLLISION", "Reserved ref creation lost a race; winner was not adopted.");
    }
    throw error;
  }
  const liveRef = await api.getRef(branch);
  if (createdRef?.object?.sha !== generatedSha || liveRef?.object?.sha !== generatedSha) {
    throw new HandoffError("COLLISION", "Created ref does not equal the trusted generated commit.");
  }

  const afterRef = await assertLiveSource(api, sourceSha, "immediately after ref create");
  log.mainReads.push(afterRef);
  if (!afterRef.current) {
    await compensateOwnArtifact(api, {
      sourceSha,
      liveMain: afterRef.liveMain,
      branch,
      expectedAppSlug,
      log,
    });
    return { ...log, state: "STALE_AFTER_WRITE" };
  }

  const beforePull = await assertLiveSource(api, sourceSha, "immediately before PR create");
  log.mainReads.push(beforePull);
  if (!beforePull.current) {
    await compensateOwnArtifact(api, {
      sourceSha,
      liveMain: beforePull.liveMain,
      branch,
      expectedAppSlug,
      log,
    });
    return { ...log, state: "STALE_AFTER_WRITE" };
  }

  const pull = await api.createPull({
    title,
    branch,
    body: buildPullBody({ sourceSha, ...options }),
  });
  log.prUrl = pull.html_url;

  const afterPull = await assertLiveSource(api, sourceSha, "immediately after PR create");
  log.mainReads.push(afterPull);
  if (!afterPull.current) {
    await compensateOwnArtifact(api, {
      sourceSha,
      liveMain: afterPull.liveMain,
      branch,
      expectedAppSlug,
      pull,
      log,
    });
    return { ...log, state: "STALE_AFTER_WRITE" };
  }

  await validateManagedArtifact(api, { branch, expectedAppSlug, pull, expectedSourceSha: sourceSha });
  log.state = log.recreatedOrphan ? "RECREATE_ORPHAN" : "CREATE";
  const reconciled = await reconcilePredecessors(api, {
    sourceSha,
    expectedAppSlug,
    currentPullNumber: pull.number,
    log,
  });
  if (reconciled.stale) log.state = "STALE_AFTER_WRITE";
  return log;
}

/**
 * The baseline file's blob SHA at one commit, or null when the file does not
 * exist there. A 404 is a real state — the baseline has not always existed —
 * and is not the same as an unreadable tree, which still throws.
 */
async function baselineBlobSha(api, ref) {
  let content;
  try {
    content = await api.getContent(BASELINE_PATH, ref);
  } catch (error) {
    if (error instanceof HandoffError && error.details?.status === 404) return null;
    throw error;
  }
  const sha = content?.sha;
  if (typeof sha !== "string" || !SHA_RE.test(sha)) {
    throw new HandoffError(
      "PROVENANCE_UNRESOLVED",
      `GitHub did not return a blob SHA for ${BASELINE_PATH} at ${ref}.`,
    );
  }
  return sha;
}

/**
 * Whether a pull request changes the baseline file, decided in two O(1) reads
 * instead of enumerating a diff.
 *
 * #2202: the enumerating form refused to scan past 2,000 records, so ANY large
 * pull request — a broad refactor, a dependency sweep, a bulk deletion — failed
 * this guard without ever being told whether it touched the baseline at all.
 * Comparing the file's blob at base and head answers exactly the same question
 * and cannot be outgrown.
 */
async function changesBaseline(api, pull) {
  const baseSha = pull?.base?.sha;
  const headSha = pull?.head?.sha;
  if (!SHA_RE.test(baseSha ?? "") || !SHA_RE.test(headSha ?? "")) {
    throw new HandoffError(
      "PROVENANCE_UNRESOLVED",
      "Pull request base and head commits could not be resolved.",
    );
  }
  const [base, head] = await Promise.all([
    baselineBlobSha(api, baseSha),
    baselineBlobSha(api, headSha),
  ]);
  return base !== head;
}

export async function verifyPullRequest(api, { pullNumber, expectedAppSlug }) {
  expectedActor(expectedAppSlug);
  const pull = await api.getPull(pullNumber);

  // A generated baseline PR changes EXACTLY one file, and GitHub already
  // reported the count on the pull itself — no second request, no pagination.
  const changedFiles = pull?.changed_files;
  if (!Number.isSafeInteger(changedFiles) || changedFiles < 0) {
    throw new HandoffError(
      "PROVENANCE_UNRESOLVED",
      "GitHub did not report changed_files for this pull request.",
    );
  }

  // Any other count cannot be a generated PR, so the only question left is
  // whether it touched the baseline — and that is answered without a scan.
  if (changedFiles !== 1) {
    if (!(await changesBaseline(api, pull))) {
      return { state: "ORDINARY_PR", pullNumber };
    }
    throw new HandoffError("PROVENANCE_MISMATCH", "A baseline PR may change only the baseline file.");
  }

  // Exactly one file: listing it is bounded by definition.
  const files = await api.getPullFiles(pullNumber);
  if (!files.some((file) => file.filename === BASELINE_PATH)) {
    return { state: "ORDINARY_PR", pullNumber };
  }
  if (files.length !== 1) {
    throw new HandoffError("PROVENANCE_MISMATCH", "A baseline PR may change only the baseline file.");
  }
  if (pull?.base?.ref !== "main" || pull?.base?.repo?.full_name !== api.fullName) {
    throw new HandoffError("PROVENANCE_MISMATCH", "A baseline PR must target this repository's main branch.");
  }
  const branch = pullHeadBranch(pull);
  const sourceSha = parseBranch(branch);
  const liveMain = await api.getMainSha();
  if (liveMain !== sourceSha || pull?.base?.sha !== sourceSha) {
    throw new HandoffError("STALE_PROVENANCE", "Generated baseline source is not the current intended main base.");
  }
  const artifact = await validateManagedArtifact(api, {
    branch,
    expectedAppSlug,
    pull,
    expectedSourceSha: sourceSha,
  });
  return { state: "VALID_GENERATED_PR", pullNumber, sourceSha, headSha: artifact.headSha };
}

/**
 * Validate the owner-controlled rollout snapshots before configuration moves
 * to its next stage. This function performs no GitHub write and intentionally
 * consumes recorded REST evidence rather than needing Administration permission
 * in the repository App token.
 */
export function verifyRolloutEvidence(evidence, { expectedAppSlug }) {
  const actor = expectedActor(expectedAppSlug);
  const prefix = evidence?.prefixRuleset;
  const general = evidence?.generalSecurityRuleset;
  const exactPattern = "refs/heads/bundle-baseline/*";
  if (prefix?.enforcement !== "active") {
    throw new HandoffError("ROLLOUT_EVIDENCE_INVALID", "Generated-prefix ruleset must be active.");
  }
  if ((prefix?.bypass_actors ?? []).length !== 0) {
    throw new HandoffError("ROLLOUT_EVIDENCE_INVALID", "Generated-prefix ruleset must have zero bypass actors.");
  }
  const include = prefix?.conditions?.ref_name?.include ?? [];
  if (include.length !== 1 || include[0] !== exactPattern) {
    throw new HandoffError("ROLLOUT_EVIDENCE_INVALID", "Generated-prefix ruleset must target only the exact reserved prefix.");
  }
  const prefixRules = prefix?.rules ?? [];
  if (!prefixRules.some((rule) => rule?.type === "non_fast_forward")) {
    throw new HandoffError("ROLLOUT_EVIDENCE_INVALID", "Generated-prefix ruleset must enforce non_fast_forward.");
  }
  if (prefixRules.some((rule) => rule?.type === "deletion")) {
    throw new HandoffError("ROLLOUT_EVIDENCE_INVALID", "Generated-prefix ruleset must leave exact validated deletion available.");
  }

  const generalExcludes = general?.conditions?.ref_name?.exclude ?? [];
  if (evidence?.stage === "before-general-exclusion" && generalExcludes.includes(exactPattern)) {
    throw new HandoffError("ROLLOUT_EVIDENCE_INVALID", "General-security exclusion appeared before prefix protection proof.");
  }
  if (evidence?.stage === "after-general-exclusion" && !generalExcludes.includes(exactPattern)) {
    throw new HandoffError("ROLLOUT_EVIDENCE_INVALID", "Post-exclusion snapshot does not contain the exact reserved prefix.");
  }
  if (!["before-general-exclusion", "after-general-exclusion", "before-required-context"].includes(evidence?.stage)) {
    throw new HandoffError("ROLLOUT_EVIDENCE_INVALID", "Unknown staged rollout evidence phase.");
  }

  if (evidence.stage === "before-required-context") {
    if (evidence.requiredContextActive === true) {
      throw new HandoffError("ROLLOUT_EVIDENCE_INVALID", "Required context was activated before delivery proof.");
    }
    const checkDelivery = (delivery, kind) => {
      if (delivery?.event !== "pull_request_target" || delivery?.producer !== "workflow-run") {
        throw new HandoffError("ROLLOUT_EVIDENCE_INVALID", `${kind} proof must come from a pull_request_target workflow run.`);
      }
      if (!Number.isSafeInteger(delivery?.workflowRunId) || delivery.workflowRunId <= 0) {
        throw new HandoffError("ROLLOUT_EVIDENCE_INVALID", `${kind} proof must include a real workflow run ID.`);
      }
      if (delivery?.checkName !== "Bundle baseline provenance guard" || delivery?.conclusion !== "success") {
        throw new HandoffError("ROLLOUT_EVIDENCE_INVALID", `${kind} provenance context did not visibly pass.`);
      }
      assertSha(delivery?.trustedWorkflowSha, `${kind} trusted workflow SHA`);
      assertSha(delivery?.headSha, `${kind} PR head SHA`);
    };
    checkDelivery(evidence?.ordinaryDelivery, "ordinary PR");
    checkDelivery(evidence?.generatedDelivery, "generated PR");
    const generated = evidence.generatedDelivery;
    const sourceSha = parseBranch(generated?.headRef);
    if (generated?.author !== actor || generated?.sourceSha !== sourceSha || generated?.baseSha !== sourceSha || generated?.liveMainSha !== sourceSha) {
      throw new HandoffError(
        "ROLLOUT_EVIDENCE_INVALID",
        "Generated delivery proof does not bind the App actor, final ref grammar and current main source.",
      );
    }
    if (BRANCH_RE.test(evidence?.ordinaryDelivery?.headRef ?? "")) {
      throw new HandoffError("ROLLOUT_EVIDENCE_INVALID", "Ordinary delivery proof must be a distinct ordinary PR.");
    }
  }
  return { state: "ROLLOUT_EVIDENCE_VALID", stage: evidence.stage };
}

function writeSummary(result) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const lines = [
    "## Bundle baseline handoff",
    "",
    `- state: \`${result.state}\``,
    `- source: \`${result.sourceSha ?? "n/a"}\``,
    `- branch: \`${result.branch ?? "n/a"}\``,
    `- PR: ${result.prUrl ?? "none"}`,
    `- reconciled PRs: ${result.closed?.length ? result.closed.map((n) => `#${n}`).join(", ") : "none"}`,
    `- deleted refs: ${result.deleted?.length ? result.deleted.map((ref) => `\`${ref}\``).join(", ") : "none"}`,
    `- untouched artifacts: ${result.untouched?.length ? result.untouched.map((item) => `\`${item.branch ?? `PR #${item.pull}`}\` (${item.reason})`).join(", ") : "none"}`,
    `- ancestry proofs: ${result.ancestryProofs?.length ? result.ancestryProofs.map((proof) => `\`${proof}\``).join(", ") : "none"}`,
    `- live-main reads: ${result.mainReads?.length ? result.mainReads.map((read) => `\`${read.stage}:${read.liveMain}\``).join(", ") : "none"}`,
    "",
  ];
  writeFileSync(path, `${lines.join("\n")}\n`, { flag: "a" });
}

async function main() {
  const mode = process.argv[2];
  if (mode === "--verify-rollout-evidence") {
    const evidencePath = process.env.BUNDLE_BASELINE_ROLLOUT_EVIDENCE_PATH;
    if (!evidencePath) {
      throw new HandoffError("INVALID_INPUT", "BUNDLE_BASELINE_ROLLOUT_EVIDENCE_PATH is required.");
    }
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    const result = verifyRolloutEvidence(evidence, {
      expectedAppSlug: process.env.BUNDLE_BASELINE_APP_SLUG,
    });
    writeSummary(result);
    console.log(`Bundle baseline rollout evidence: ${result.state} (${result.stage})`);
    return;
  }
  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
  const token = mode === "--verify-pr" ? process.env.GITHUB_TOKEN : process.env.BUNDLE_BASELINE_APP_TOKEN;
  const api = makeRestAdapter({ token, owner, repo });

  if (mode === "--verify-pr") {
    const pullNumber = Number(process.env.PULL_REQUEST_NUMBER);
    if (!Number.isSafeInteger(pullNumber) || pullNumber <= 0) {
      throw new HandoffError("INVALID_INPUT", "PULL_REQUEST_NUMBER must be a positive integer.");
    }
    const result = await verifyPullRequest(api, {
      pullNumber,
      expectedAppSlug: process.env.BUNDLE_BASELINE_APP_SLUG,
    });
    writeSummary(result);
    console.log(`Bundle baseline provenance: ${result.state}`);
    return;
  }

  if (mode !== "--handoff") {
    throw new HandoffError(
      "INVALID_INPUT",
      "Usage: bundle-baseline-pr-handoff.mjs --handoff|--verify-pr|--verify-rollout-evidence",
    );
  }
  const sourceSha = process.env.SOURCE_SHA;
  const changed = process.env.BASELINE_CHANGED === "true";
  const baselineContent = readFileSync(BASELINE_PATH, "utf8");
  const direction = process.env.DIRECTION || "unchanged";
  const summary = process.env.MOVEMENT_SUMMARY || "no material movement";
  const title = direction === "reduction"
    ? `Bank the business-web boot payload reduction (${summary})`
    : direction === "growth"
      ? `Record business-web boot payload growth (${summary})`
      : `Re-baseline the business-web boot payload (${summary})`;
  const result = await runHandoff(api, {
    sourceSha,
    changed,
    baselineContent,
    expectedAppSlug: process.env.BUNDLE_BASELINE_APP_SLUG,
    tokenAppSlug: process.env.BUNDLE_BASELINE_TOKEN_APP_SLUG,
    title,
    direction,
    summary,
    commonRaw: process.env.COMMON_RAW || "n/a",
    commonBrotli: process.env.COMMON_BROTLI || "n/a",
    eagerBrotli: process.env.EAGER_BROTLI || "n/a",
  });
  writeSummary(result);
  console.log(`Bundle baseline handoff: ${result.state}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const code = error instanceof HandoffError ? error.code : "UNEXPECTED_FAILURE";
    writeSummary({ state: `FAILED_${code}` });
    console.error(`Bundle baseline handoff failed safely [${code}]: ${error.message}`);
    process.exitCode = 1;
  });
}
