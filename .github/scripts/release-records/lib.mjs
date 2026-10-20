// Issue #3980 — release records and the PR links check: the pure rules.
//
// Nothing here reads the environment, the network or a file, so the same
// module is imported by the two runners in this folder and by the Deno tests
// under supabase/functions/_shared/__tests__/. Pull request text is data:
// it is parsed, never executed.

export const REPO = "Mingla-LLC/mingla-main";
export const RECORD_MARKER_PREFIX = "mingla-release-record:pr-";
export const RECORD_DATA_OPEN = "<!-- mingla-release-record-data";
export const PR_LINKS_MARKER = "<!-- mingla-pr-links -->";
export const WEB_PROJECTS = [
  "mingla-admin",
  "mingla-business",
  "mingla-marketing",
  "mingla-site-cms",
  "mingla-sites",
];
export const MAX_ISSUES = 10;
export const MAX_GUIDE_KEYS = 20;
export const REMINDER_DAYS = 7;

const ISSUE_URL = String.raw`https://github\.com/Mingla-LLC/mingla-main/issues/(\d{1,7})(?:[/?#][^\s,)]*)?`;
const REF = String.raw`(?:#(\d{1,7})\b|${ISSUE_URL})`;
const LIST = String.raw`(?:\s*:)?\s*(${REF}(?:\s*(?:,|&|\band\b)?\s*${REF})*)`;
const FIXES = new RegExp(String.raw`\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\b${LIST}`, "gi");
const TOWARD = new RegExp(String.raw`\b(?:towards?|refs?|part of)\b${LIST}`, "gi");
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Text outside HTML comments (the template's examples live inside them). */
export function stripComments(text) {
  return String(text ?? "").replace(/<!--[\s\S]*?(?:-->|$)/g, "");
}

function numbersIn(list) {
  const out = [];
  const re = new RegExp(REF, "g");
  for (const m of list.matchAll(re)) {
    const n = Number(m[1] ?? m[2]);
    if (Number.isInteger(n) && n >= 1 && n <= 9999999) out.push(n);
  }
  return out;
}

function fieldLine(body, name) {
  const re = new RegExp(String.raw`^[ \t]*${name}:[ \t]*(.*)$`, "im");
  const m = re.exec(stripComments(body));
  return m ? m[1].trim() : null;
}

/**
 * The issues a pull request names, in order of first mention:
 * [{number, relation: "fixes" | "toward"}]. A fixes mention wins over a
 * toward mention of the same number. At most ten. Pull request numbers are
 * not known here; the caller drops them.
 */
export function parseIssueRefs(title, body) {
  const text = `${String(title ?? "")}\n${stripComments(body)}`;
  const seen = new Map();
  const hits = [];
  for (const m of text.matchAll(FIXES)) hits.push({ at: m.index, rel: "fixes", nums: numbersIn(m[1]) });
  for (const m of text.matchAll(TOWARD)) hits.push({ at: m.index, rel: "toward", nums: numbersIn(m[1]) });
  const field = fieldLine(body, "Issue");
  if (field !== null) {
    const at = text.indexOf(field);
    hits.push({ at: at < 0 ? text.length : at, rel: "toward", nums: numbersIn(field) });
  }
  hits.sort((a, b) => a.at - b.at);
  for (const h of hits) {
    for (const n of h.nums) {
      const was = seen.get(n);
      if (!was) seen.set(n, h.rel);
      else if (h.rel === "fixes") seen.set(n, "fixes");
    }
  }
  return [...seen.entries()].slice(0, MAX_ISSUES).map(([number, relation]) => ({ number, relation }));
}

/**
 * The "Issue:" line: numbers, "none" with a reason, or missing (absent, the
 * template's empty "#", or "none" without a reason).
 */
export function parseIssueField(body) {
  const v = fieldLine(body, "Issue");
  if (v === null) return { kind: "missing", reason: null };
  const none = /^none\b[\s,:;-]*(.*)$/i.exec(v);
  if (none) {
    const reason = none[1].trim();
    return reason.length >= 3 ? { kind: "none", reason: reason.slice(0, 200) } : { kind: "missing", reason: null };
  }
  return numbersIn(v).length > 0 ? { kind: "numbers", reason: null } : { kind: "missing", reason: null };
}

/** How many Feature Guide entries are wrong, in words that quote none of them. */
export function invalidGuideWords(guide) {
  const n = Number(guide?.badCount ?? 0);
  const what = guide?.tooMany
    ? `more than ${MAX_GUIDE_KEYS} entries`
    : `${n} ${n === 1 ? "entry is not a key" : "entries are not keys"}`;
  return `${what}; a key is lower-case letters, digits and single hyphens, as in the pull request template`;
}

/** The "Feature Guide:" line: keys, none, missing, or invalid with the bad keys. */
export function parseFeatureGuide(body) {
  const v = fieldLine(body, "Feature Guide");
  if (v === null || v === "") return { kind: "missing" };
  if (/^none\.?$/i.test(v)) return { kind: "none" };
  const parts = v.split(/[\s,]+/).map((p) => p.replace(/[.;]+$/, "")).filter(Boolean);
  const bad = parts.filter((p) => !KEY.test(p));
  if (bad.length > 0 || parts.length > MAX_GUIDE_KEYS) {
    return {
      kind: "invalid",
      bad: bad.length > 0 ? bad.slice(0, 5) : [`more than ${MAX_GUIDE_KEYS} keys`],
      badCount: bad.length,
      tooMany: bad.length === 0,
    };
  }
  return { kind: "keys", keys: [...new Set(parts)] };
}

/**
 * The web projects that build each shared package under packages/. A change
 * to a package is a change to every web project that consumes it.
 * mingla-business takes every package through a "file:../packages/<name>"
 * dependency; mingla-admin imports brand-assets and video-upload by relative
 * path; mingla-marketing maps search-measurement through tsconfig paths.
 * packages/scripts holds CI scripts no web project builds. Maintained here
 * (the runner checks out only this folder) and held to the real tree by
 * issue_3980_release_records_rework.implementor.test.ts, which derives the
 * consumers from each project's package.json, tsconfig paths and imports.
 */
export const PACKAGE_CONSUMERS = {
  "brand-assets": ["mingla-admin", "mingla-business"],
  "brand-rendering": ["mingla-business"],
  "card-identity": ["mingla-business"],
  "help-content": ["mingla-business"],
  "location-input": ["mingla-business"],
  "offering-rendering": ["mingla-business"],
  "payments-native": ["mingla-business"],
  "phone-input": ["mingla-business"],
  "scripts": [],
  "search-measurement": ["mingla-business", "mingla-marketing"],
  "sharing": ["mingla-business"],
  "theme-animations": ["mingla-business"],
  "video-upload": ["mingla-admin", "mingla-business"],
};
// A package not in the map yet: mingla-business takes every package, so it
// is the one project a new package certainly reaches until the map names it.
const NEW_PACKAGE_CONSUMERS = ["mingla-business"];

/** The Vercel projects a list of changed paths touches, packages included. */
export function webProjects(paths) {
  const out = new Set();
  for (const p of paths ?? []) {
    const parts = String(p).split("/");
    if (WEB_PROJECTS.includes(parts[0])) out.add(parts[0]);
    else if (parts[0] === "packages" && parts.length > 2 && parts[1]) {
      const consumers = Object.hasOwn(PACKAGE_CONSUMERS, parts[1]) ? PACKAGE_CONSUMERS[parts[1]] : NEW_PACKAGE_CONSUMERS;
      for (const w of consumers) out.add(w);
    }
  }
  return WEB_PROJECTS.filter((w) => out.has(w));
}

/** The edge functions a list of changed paths touches; _shared is "(shared code)". */
export function edgeFunctions(paths) {
  const out = new Set();
  let shared = false;
  for (const p of paths ?? []) {
    const m = /^supabase\/functions\/([^/]+)\/.+/.exec(String(p));
    if (!m) continue;
    if (m[1] === "_shared") shared = true;
    else if (!m[1].startsWith("_") && !m[1].startsWith(".")) out.add(m[1]);
  }
  return [...[...out].sort(), ...(shared ? ["(shared code)"] : [])];
}

/** Migration versions added by a pull request ([{filename, status}]). */
export function migrationsAdded(files) {
  const out = new Set();
  for (const f of files ?? []) {
    if (f?.status !== "added") continue;
    const m = /^supabase\/migrations\/([0-9]{14})_[^/]+\.sql$/.exec(String(f.filename ?? ""));
    if (m) out.add(m[1]);
  }
  return [...out].sort();
}

/** True when a commit subject carries the literal [deploy] marker. */
export function hasDeployMarker(subject) {
  return String(subject ?? "").includes("[deploy]");
}

/** A changed file that is a test. */
export function isTestFile(path) {
  return /(?:^|\/)__tests__\/|\.test\.[a-z]+$|\.spec\.[a-z]+$|\.test\.sql$/.test(String(path ?? ""));
}

/** One line of other people's text, made safe for the visible part of a comment. */
export function visible(text, max = 200) {
  return String(text ?? "").replace(/[\r\n\t]+/g, " ").replace(/[<>`]/g, "").trim().slice(0, max);
}

/**
 * Other people's text shown as plain words in a comment: visible(), then
 * every markdown control character escaped, so it can make no link, image,
 * emphasis or table, and a word joiner after each "@" and inside each
 * "://", so it can mention no one and autolink nothing. #123 references
 * stay as they are.
 */
export function plainText(text, max = 200) {
  return visible(text, max)
    .replace(/[\\*_[\]()!~|{}]/g, (c) => `\\${c}`)
    .replace(/@/g, "@\u2060")
    .replace(/:\/\//g, ":\u2060//")
    .replace(/\bwww\./gi, (w) => `${w.slice(0, 3)}\u2060.`);
}

function utcMinute(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toISOString().slice(0, 16).replace("T", " ");
}

/** Problem codes the bot knows. migrations_pending is added by Mingla. */
export function recordProblems(data) {
  const p = [];
  if (!Array.isArray(data?.issues) || data.issues.length === 0) p.push("no_issue");
  if (data?.feature_guide === null || data?.feature_guide === undefined) {
    p.push(Array.isArray(data?.feature_guide_bad) && data.feature_guide_bad.length > 0 ? "feature_guide_invalid" : "feature_guide_missing");
  }
  const web = data?.deploy?.web ?? {};
  if (Object.values(web).includes("not_deployed")) p.push("web_not_deployed");
  if (Object.values(web).includes("failed")) p.push("web_deploy_failed");
  if (data?.deploy?.edge === "failed") p.push("edge_deploy_failed");
  if (!data?.live_check) p.push("live_check_missing");
  return p;
}

const MISSING_WORDS = {
  no_issue: "an issue link",
  feature_guide_missing: "the Feature Guide line",
  feature_guide_invalid: "a Feature Guide line with real entry keys",
  web_not_deployed: "a web deploy ([deploy] was missing)",
  web_deploy_failed: "a web deploy that succeeded",
  edge_deploy_failed: "an edge function deploy that succeeded",
  live_check_missing: "the live check",
};

/** What a record still needs, in words; empty when it is complete. */
export function recordMissing(data) {
  const out = recordProblems(data).map((c) => MISSING_WORDS[c] ?? c);
  if (data?.migrations_applied_state === "pending") out.push("migrations applied to production");
  const web = data?.deploy?.web ?? {};
  for (const [project, state] of Object.entries(web)) if (state === "pending") out.push(`the ${project} deploy result`);
  if (data?.deploy?.edge === "pending") out.push("the edge function deploy result");
  return out;
}

function deployLine(data) {
  const parts = [];
  const web = data?.deploy?.web ?? {};
  for (const project of WEB_PROJECTS) {
    const state = web[project];
    if (!state) continue;
    parts.push(
      state === "ready" ? `${project} READY`
      : state === "not_deployed" ? `${project} not deployed: the title has no [deploy]`
      : state === "failed" ? `${project} failed`
      : `${project} pending`,
    );
  }
  const edge = data?.deploy?.edge ?? "none";
  const names = (data?.edge_functions ?? []).map((n) => visible(n, 80)).join(", ");
  if (edge === "manual") parts.push("Sites functions deploy only through their governed lane: check by hand");
  else if (edge !== "none") parts.push(`edge functions ${names} ${edge}`);
  return parts.length > 0 ? parts.join("; ") : "N/A (no web or edge function change)";
}

const EDGE_WORKFLOW = "Deploy Supabase Edge Functions";

/** True for "Vercel – mingla-admin" or "Vercel - mingla-admin", exactly. */
export function isVercelName(name, project) {
  const v = String(name ?? "").trim();
  return v === `Vercel \u2013 ${project}` || v === `Vercel - ${project}`;
}

/** The deploy state of each web project and of the edge functions. */
export function deployState({ web, edge, marker, statuses, checks, edgeRuns }) {
  const out = { web: {}, edge: "none" };
  for (const project of web) {
    if (!marker) {
      out.web[project] = "not_deployed";
      continue;
    }
    // Only Vercel's own report for this project counts: a status context or
    // check run named exactly "Vercel – <project>" (en dash, or the hyphen
    // form). A CI job that merely mentions the project never stands in for
    // the deploy. Of several check runs with that name, the newest counts.
    const named = (n) => isVercelName(n, project);
    const runs = checks.filter((c) => named(c?.name))
      .sort((a, b) => Date.parse(b?.started_at ?? 0) - Date.parse(a?.started_at ?? 0) || Number(b?.id ?? 0) - Number(a?.id ?? 0));
    const seen = [
      ...statuses.filter((s) => named(s?.context)).map((s) => s.state),
      ...runs.slice(0, 1).map((c) => (c.status === "completed" ? c.conclusion : "pending")),
    ];
    out.web[project] = seen.includes("success") ? "ready"
      : seen.some((s) => s === "failure" || s === "error" || s === "timed_out" || s === "cancelled") ? "failed"
      : "pending";
  }
  if (edge.some((n) => n.startsWith("brand-site-"))) out.edge = "manual";
  else if (edge.length > 0) {
    // Only the edge deploy workflow itself, by its exact name; of several
    // runs (re-runs), the newest.
    const run = edgeRuns.filter((r) => r?.name === EDGE_WORKFLOW)
      .sort((a, b) => Date.parse(b?.created_at ?? 0) - Date.parse(a?.created_at ?? 0) || Number(b?.id ?? 0) - Number(a?.id ?? 0))[0];
    out.edge = !run || run.status !== "completed" ? "pending"
      : run.conclusion === "success" ? "deployed"
      : ["failure", "cancelled", "timed_out"].includes(run.conclusion) ? "failed"
      : "pending";
  }
  return out;
}

/**
 * The bot's own record comment for a pull request among an issue's comments,
 * or undefined: one per pull request per issue, found by its marker.
 * Test helper only: record.mjs uses recordCommentsFor, which also finds the
 * duplicates two racing runs can leave.
 */
export function recordCommentFor(comments, pr) {
  const marker = `<!-- ${RECORD_MARKER_PREFIX}${pr} -->`;
  return (comments ?? []).find((c) => c?.user?.login === "github-actions[bot]" && String(c?.body ?? "").includes(marker));
}

/**
 * Every record comment the bot wrote for a pull request on one issue, oldest
 * first (by comment id). More than one only when two runs raced.
 */
export function recordCommentsFor(comments, pr) {
  const marker = `<!-- ${RECORD_MARKER_PREFIX}${pr} -->`;
  return (comments ?? [])
    .filter((c) => c?.user?.login === "github-actions[bot]" && String(c?.body ?? "").includes(marker))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * #3980 W2 rework: this run's record merged with the record already on the
 * issue, read again right before writing. Runs in different queues (a "Live
 * check:" comment and a deploy status for the same merge) can each start
 * before the other wrote; the live check one of them saw is never lost: of
 * the two, the newer one made after the merge is kept, and the problems are
 * worked out again.
 */
export function mergeRecordData(fresh, previous) {
  if (!previous || typeof previous !== "object" || previous.pr !== fresh?.pr) return fresh;
  const after = (lc) => lc && typeof lc === "object" && typeof lc.url === "string" && lc.url !== ""
    && !Number.isNaN(Date.parse(lc.at)) && Date.parse(lc.at) >= Date.parse(fresh.merged_at);
  const mine = after(fresh.live_check) ? fresh.live_check : null;
  const theirs = after(previous.live_check) ? previous.live_check : null;
  const live = !mine ? theirs : !theirs ? mine : Date.parse(theirs.at) > Date.parse(mine.at) ? theirs : mine;
  if (live === fresh.live_check) return fresh;
  const out = { ...fresh, live_check: live };
  out.problems = recordProblems(out);
  return out;
}

/** The JSON block, escaped so the HTML comment cannot be closed early. */
export function recordJson(data) {
  return JSON.stringify(data).replace(/--/g, "-\\u002d").replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

/** The release-record comment for a pull request. */
export function renderRecord(data) {
  const issues = Array.isArray(data.issues) && data.issues.length > 0
    ? data.issues.map((i) => `#${i.number} (${i.relation})`).join(", ")
    : "none linked: link one";
  const migrationsAdded = (data.migrations_added ?? []).length > 0 ? data.migrations_added.join(", ") : "none";
  const applied = data.migrations_applied_state === "pending"
    ? "pending: Mingla checks the production ledger every 5 minutes"
    : data.migrations_applied_state === "applied"
    ? `all applied${data.migrations_status ? ` (${visible(data.migrations_status, 140)})` : ""}`
    : "none";
  const live = data.live_check
    ? `"${visible(data.live_check.text)}" by @${visible(data.live_check.by_login, 39)}, ${visible(data.live_check.url, 300)}`
    : 'pending: add a comment starting with "Live check:"';
  const guide = Array.isArray(data.feature_guide)
    ? (data.feature_guide.length > 0 ? data.feature_guide.join(", ") : "none")
    : 'missing: add a "Feature Guide:" line to the PR description';
  const missing = recordMissing(data);
  return [
    `<!-- ${RECORD_MARKER_PREFIX}${data.pr} -->`,
    `**Release record** for PR #${data.pr}. Written by the merge bot and refreshed when anything changes. Do not edit it; add the live check as a new comment starting with "Live check:".`,
    "",
    `- PR: #${data.pr} ${plainText(data.title)}, merged ${utcMinute(data.merged_at)} UTC by @${visible(data.merged_by, 39) || "unknown"}`,
    `- Merge commit: ${data.merge_sha}`,
    `- Issues: ${issues}`,
    `- Migrations added: ${migrationsAdded}`,
    `- Migrations applied: ${applied}`,
    `- Deploy: ${deployLine(data)}`,
    `- Live check: ${live}`,
    `- Feature Guide: ${guide}`,
    "",
    `Status: ${missing.length === 0 ? "Complete" : `Not complete: ${missing.join(", ")}`}`,
    "",
    RECORD_DATA_OPEN,
    recordJson(data),
    "-->",
    "",
  ].join("\n");
}

/** The JSON block of a record comment, or null. */
export function readRecordData(body) {
  const text = String(body ?? "");
  const at = text.indexOf(RECORD_DATA_OPEN);
  if (at < 0) return null;
  const rest = text.slice(at + RECORD_DATA_OPEN.length);
  const end = rest.indexOf("-->");
  if (end < 0) return null;
  try {
    const data = JSON.parse(rest.slice(0, end).trim());
    if (!data || typeof data !== "object" || Array.isArray(data) || data.v !== 1 || data.repo !== REPO) return null;
    if (!Number.isInteger(data.pr) || data.pr <= 0) return null;
    return data;
  } catch {
    return null;
  }
}

function dayMonth(ms) {
  const d = new Date(ms);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}

/**
 * The PR links verdict. phase: exempt (a bot, or opened before the check
 * landed), reminder (its first week, or the landing time is unknown) or
 * blocking. ok is false only when blocking and a line is missing.
 */
export function prLinksVerdict({ title, body, author, createdAt, landedAt, now }) {
  const login = typeof author === "string" ? author : author?.login ?? "";
  const type = typeof author === "object" && author ? author.type : undefined;
  if (login === "dependabot[bot]" || type === "Bot" || /\[bot\]$/.test(login)) {
    return { ok: true, missing: [], phase: "exempt", words: "", comment: false };
  }
  const missing = [];
  const field = parseIssueField(body);
  if (parseIssueRefs(title, body).length === 0 && field.kind !== "none") missing.push("an issue link");
  const guide = parseFeatureGuide(body);
  if (guide.kind === "missing") missing.push('a "Feature Guide:" line');
  // Never repeat the pull request's own words here: the comment is posted by
  // the bot, so echoed text could mention people or carry links and images.
  // Say how many entries are wrong and where the rule is written.
  if (guide.kind === "invalid") missing.push(`a "Feature Guide:" line with real entry keys (${invalidGuideWords(guide)})`);
  const landed = landedAt ? Date.parse(landedAt) : NaN;
  const created = Date.parse(createdAt);
  const at = now ? Date.parse(now) : Date.now();
  const blocksFrom = Number.isNaN(landed) ? null : landed + REMINDER_DAYS * 86400000;
  let phase;
  if (Number.isNaN(landed)) phase = "reminder";
  else if (!Number.isNaN(created) && created < landed) phase = "exempt";
  else if (at < blocksFrom) phase = "reminder";
  else phase = "blocking";
  if (missing.length === 0) {
    return { ok: true, missing, phase, words: "Issue and Feature Guide lines found. Thank you.", comment: true };
  }
  const when = blocksFrom === null
    ? "Mingla could not read when this check landed, so it only reminds for now."
    : phase === "exempt"
    ? "This PR was opened before the check landed, so it never blocks this PR."
    : `From ${dayMonth(blocksFrom)} this check blocks merging.`;
  const words =
    'This PR needs two lines in its description before it merges: an issue link ("toward #123" or "Fixes #123", or "Issue: none, <reason>") and a "Feature Guide:" line (entry keys or "none"). ' +
    `Missing: ${missing.join("; ")}. ${when} After you edit the description, push a commit or re-run this check.`;
  return { ok: phase !== "blocking", missing, phase, words, comment: true };
}
