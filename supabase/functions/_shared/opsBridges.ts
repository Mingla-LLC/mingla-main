// Issue #3980 — the GitHub bridges of the synced system, run by the 5-minute
// product-avengers-sync reconcile after its #3720 steps.
//
// Wave 1: release records. The merge bot (a GitHub Action) writes one
// release-record comment per linked issue; this reads those comments back
// (only the bot's own, by account and type: anybody can comment on a public
// repository), records the commits that reached main, posts the
// "mingla/production-migrations" commit status Mingla decides from the
// production ledger, and lets the database make or close engineering
// follow-through cards.
//
// Wave 2: Bridge A. Every issue and pull request linked from a Work card, a
// roadmap card, a support ticket (through the Product Inbox) or a recent
// release record is read from GitHub in batches of 50 (one read-only GraphQL
// query each, at most 4 a run) and handed to the database, which then runs
// Bridges D and E and the roadmap suggestions. A rate-limited or empty answer
// stops the step, applies nothing and says so.
//
// No environment is read here and no client library is imported: the caller
// hands in the database client and the GitHub client, so tests run it with
// stand-ins. GitHub calls run one at a time and stop when the rate budget or
// the time budget runs low.

export const RECORD_MARKER = "mingla-release-record:pr-";
export const RECORD_DATA_OPEN = "<!-- mingla-release-record-data";
export const MIGRATIONS_CONTEXT = "mingla/production-migrations";
export const BOT_LOGIN = "github-actions[bot]";
export const REPO = "Mingla-LLC/mingla-main";
export const MIN_BUDGET = 500;
export const MAX_MS = 40_000;
export const FOLLOW_BATCH = 50;
export const FOLLOW_MAX_BATCHES = 4;

type Json = Record<string, unknown>;

export type GitHubComment = {
  id?: number;
  html_url?: string;
  issue_url?: string;
  body?: string;
  updated_at?: string;
  created_at?: string;
  user?: { login?: string; type?: string } | null;
};

export type GitHubCommit = {
  sha?: string;
  commit?: { message?: string; committer?: { date?: string }; author?: { date?: string } };
  author?: { login?: string } | null;
};

/** The GitHub reads and the one status write the bridges need. */
export interface BridgeGitHub {
  budget: number;
  issueCommentsSince(iso: string, maxPages?: number): Promise<Json[]>;
  mainCommitsSince(iso: string, maxPages?: number): Promise<Json[]>;
  pullsForCommit(sha: string): Promise<number | null>;
  createCommitStatus(
    sha: string,
    status: { state: string; description: string; context: string },
  ): Promise<void>;
  /** Wave 2 (Bridge A): read-only status of up to 50 numbers. */
  followBatch?(numbers: number[]): Promise<Json[]>;
}

/** The database calls the bridges make (a Supabase client fits). */
export interface BridgeAdmin {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * The JSON block of a release-record comment, or null. Kept equal to
 * readRecordData in .github/scripts/release-records/lib.mjs (a test reads
 * the same comments with both).
 */
export function readRecordData(body: string): Json | null {
  const text = String(body ?? "");
  const at = text.indexOf(RECORD_DATA_OPEN);
  if (at < 0) return null;
  const rest = text.slice(at + RECORD_DATA_OPEN.length);
  const end = rest.indexOf("-->");
  if (end < 0) return null;
  try {
    const data = JSON.parse(rest.slice(0, end).trim());
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    if (data.v !== 1 || data.repo !== REPO) return null;
    if (!Number.isInteger(data.pr) || data.pr <= 0) return null;
    return data as Json;
  } catch {
    return null;
  }
}

/** Only the merge bot's own record comments count. */
export function isBotRecordComment(c: GitHubComment): boolean {
  return c?.user?.login === BOT_LOGIN && c?.user?.type === "Bot" &&
    String(c?.body ?? "").includes(RECORD_MARKER);
}

/** The issue (or pull request) number a comment sits on, from its issue_url. */
export function commentIssueNumber(c: GitHubComment): number | null {
  const m = /\/issues\/(\d{1,7})$/.exec(String(c?.issue_url ?? ""));
  return m ? Number(m[1]) : null;
}

/** The ingest rows for a page of comments: bot records only. */
export function recordRows(comments: GitHubComment[]): Json[] {
  const rows: Json[] = [];
  for (const c of comments) {
    if (!isBotRecordComment(c)) continue;
    const data = readRecordData(String(c.body));
    if (!data) continue;
    rows.push({
      data,
      comment_url: c.html_url ?? null,
      issue_number: commentIssueNumber(c),
      commented_at: c.updated_at ?? c.created_at ?? null,
    });
  }
  return rows;
}

const later = (a: string | null, b: string | null | undefined): string | null => {
  if (!b) return a;
  if (!a) return b;
  return Date.parse(b) > Date.parse(a) ? b : a;
};

export type BridgeResult = {
  release_records: Json;
  main_commits: Json;
  statuses_posted: number;
  engineering_cards: Json | null;
  github_follow: { followed: number; applied: number; changed: number[]; batches: number; refused: string | null };
  deferred: string[];
  github_budget: number;
  failed: number;
};

export async function runReleaseBridges(
  admin: BridgeAdmin,
  github: BridgeGitHub,
  opts: { now?: () => number; maxMs?: number; minBudget?: number; log?: (line: Json) => void } = {},
): Promise<BridgeResult> {
  const now = opts.now ?? (() => Date.now());
  const started = now();
  const maxMs = opts.maxMs ?? MAX_MS;
  const minBudget = opts.minBudget ?? MIN_BUDGET;
  const log = opts.log ?? (() => {});
  const result: BridgeResult = {
    release_records: { ingested: 0, invalid: 0, completed: [] },
    main_commits: { inserted: 0 },
    statuses_posted: 0,
    engineering_cards: null,
    github_follow: { followed: 0, applied: 0, changed: [], batches: 0, refused: null },
    deferred: [],
    github_budget: github.budget,
    failed: 0,
  };
  // May another GitHub call start? Not when the budget or the time is short.
  const mayCall = (step: string): boolean => {
    if (github.budget < minBudget) {
      if (!result.deferred.includes(step)) result.deferred.push(step);
      log({ fn: "ops-bridges", event: "github_budget_low", step, budget: github.budget });
      return false;
    }
    if (now() - started > maxMs) {
      if (!result.deferred.includes(step)) result.deferred.push(step);
      log({ fn: "ops-bridges", event: "time_budget_spent", step });
      return false;
    }
    return true;
  };

  // 1. Release records read back from the bot's comments.
  try {
    if (mayCall("release_records")) {
      const cursor = await admin.rpc("ops_bridge_cursor", { p_name: "issue_comments" });
      if (cursor.error || typeof cursor.data !== "string") throw new Error("CURSOR_READ_FAILED");
      const since = new Date(Date.parse(cursor.data) - 10 * 60_000).toISOString();
      const comments = (await github.issueCommentsSince(since, 3)) as GitHubComment[];
      const rows = recordRows(comments);
      let newest: string | null = null;
      for (const c of comments) newest = later(newest, c.updated_at);
      for (let i = 0; i < rows.length; i += 100) {
        const r = await admin.rpc("ops_release_records_ingest", { p_records: rows.slice(i, i + 100) });
        if (r.error) throw new Error("RECORD_INGEST_FAILED");
        const d = (r.data ?? {}) as Json;
        const acc = result.release_records as { ingested: number; invalid: number; completed: number[] };
        acc.ingested += Number(d.ingested ?? 0);
        acc.invalid += Number(d.invalid ?? 0);
        acc.completed.push(...((d.completed as number[] | undefined) ?? []));
      }
      if (newest) {
        const set = await admin.rpc("ops_bridge_cursor_set", { p_name: "issue_comments", p_at: newest });
        if (set.error) throw new Error("CURSOR_WRITE_FAILED");
      }
    }
  } catch (error) {
    result.failed += 1;
    log({ fn: "ops-bridges", event: "release_records_failed", code: String((error as Error)?.message ?? "") });
  }

  // 2. Commits that reached main, each with the pull request it came from.
  try {
    if (mayCall("main_commits")) {
      const cursor = await admin.rpc("ops_bridge_cursor", { p_name: "main_commits" });
      if (cursor.error || typeof cursor.data !== "string") throw new Error("CURSOR_READ_FAILED");
      const commits = (await github.mainCommitsSince(new Date(Date.parse(cursor.data)).toISOString(), 2)) as GitHubCommit[];
      const rows: Json[] = [];
      let newest: string | null = null;
      for (const c of commits) {
        if (!c?.sha || !/^[0-9a-f]{40}$/.test(c.sha)) continue;
        if (!mayCall("main_commits")) break;
        const at = c.commit?.committer?.date ?? c.commit?.author?.date ?? null;
        if (!at) continue;
        const pr = await github.pullsForCommit(c.sha);
        rows.push({
          sha: c.sha,
          committed_at: at,
          subject: String(c.commit?.message ?? "").split("\n")[0].slice(0, 300),
          author_login: c.author?.login ?? null,
          pr,
        });
        newest = later(newest, at);
      }
      for (let i = 0; i < rows.length; i += 100) {
        const r = await admin.rpc("ops_main_commits_ingest", { p_commits: rows.slice(i, i + 100) });
        if (r.error) throw new Error("COMMIT_INGEST_FAILED");
        (result.main_commits as { inserted: number }).inserted += Number(((r.data ?? {}) as Json).inserted ?? 0);
      }
      if (newest) {
        const set = await admin.rpc("ops_bridge_cursor_set", { p_name: "main_commits", p_at: newest });
        if (set.error) throw new Error("CURSOR_WRITE_FAILED");
      }
    }
  } catch (error) {
    result.failed += 1;
    log({ fn: "ops-bridges", event: "main_commits_failed", code: String((error as Error)?.message ?? "") });
  }

  // 3. The migrations status each merge commit should carry.
  try {
    const due = await admin.rpc("ops_release_status_due");
    if (due.error) throw new Error("STATUS_DUE_FAILED");
    for (const row of (Array.isArray(due.data) ? due.data : []) as Json[]) {
      if (!mayCall("statuses")) break;
      try {
        await github.createCommitStatus(String(row.sha), {
          state: String(row.state),
          description: String(row.description ?? "").slice(0, 140),
          context: MIGRATIONS_CONTEXT,
        });
      } catch (error) {
        const code = String((error as Error)?.message ?? "");
        if (/GITHUB_REST_(403|404)$/.test(code)) {
          await admin.rpc("ops_release_status_refused");
          log({ fn: "ops-bridges", event: "status_post_refused" });
          break;
        }
        throw error;
      }
      const posted = await admin.rpc("ops_release_status_posted", { p_pr: row.pr, p_state: row.state });
      if (posted.error) throw new Error("STATUS_STAMP_FAILED");
      result.statuses_posted += 1;
    }
  } catch (error) {
    result.failed += 1;
    log({ fn: "ops-bridges", event: "statuses_failed", code: String((error as Error)?.message ?? "") });
  }

  // 4. Engineering follow-through cards (the database decides).
  try {
    const cards = await admin.rpc("ops_engineering_cards_sync");
    if (cards.error) throw new Error("ENGINEERING_CARDS_FAILED");
    result.engineering_cards = (cards.data ?? null) as Json | null;
  } catch (error) {
    result.failed += 1;
    log({ fn: "ops-bridges", event: "engineering_cards_failed", code: String((error as Error)?.message ?? "") });
  }

  // 5. Bridge A (Wave 2): follow linked issues and pull requests.
  try {
    if (typeof github.followBatch === "function" && mayCall("follow")) {
      const list = await admin.rpc("ops_github_follow_list", { p_limit: FOLLOW_BATCH * FOLLOW_MAX_BATCHES });
      if (list.error || !Array.isArray(list.data)) throw new Error("FOLLOW_LIST_FAILED");
      const numbers: number[] = [];
      for (const row of list.data as Json[]) {
        const n = Number(row?.number);
        if (Number.isInteger(n) && n > 0 && !numbers.includes(n)) numbers.push(n);
      }
      const follow = result.github_follow;
      follow.followed = numbers.length;
      for (let i = 0; i < numbers.length && follow.batches < FOLLOW_MAX_BATCHES; i += FOLLOW_BATCH) {
        if (!mayCall("follow")) break;
        const batch = numbers.slice(i, i + FOLLOW_BATCH);
        let items: Json[];
        try {
          items = await github.followBatch(batch);
        } catch (error) {
          // Fails closed: nothing from this answer is applied, and the run says why.
          follow.refused = String((error as Error)?.message ?? "GITHUB_FOLLOW_FAILED");
          if (!result.deferred.includes("follow")) result.deferred.push("follow");
          log({ fn: "ops-bridges", event: "follow_refused", code: follow.refused, budget: github.budget });
          break;
        }
        follow.batches += 1;
        if (!Array.isArray(items) || items.length === 0) {
          follow.refused = "GITHUB_FOLLOW_EMPTY";
          if (!result.deferred.includes("follow")) result.deferred.push("follow");
          log({ fn: "ops-bridges", event: "follow_refused", code: follow.refused, budget: github.budget });
          break;
        }
        const applied = await admin.rpc("ops_github_items_apply", { p_items: items });
        if (applied.error) throw new Error("FOLLOW_APPLY_FAILED");
        const d = (applied.data ?? {}) as Json;
        follow.applied += Number(d.applied ?? 0);
        follow.changed.push(...((d.changed as number[] | undefined) ?? []));
      }
    }
  } catch (error) {
    result.failed += 1;
    log({ fn: "ops-bridges", event: "follow_failed", code: String((error as Error)?.message ?? "") });
  }

  result.github_budget = github.budget;
  return result;
}
