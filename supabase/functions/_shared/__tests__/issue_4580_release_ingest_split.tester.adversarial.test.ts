// Issue #4580 tester adversarial: the release-record chunking in
// runReleaseBridges against a stand-in database and GitHub, from angles the
// implementor suite does not take: a chunk that fails once but whose records
// all succeed alone (nothing may be poisoned), comments handed over out of
// order with equal timestamps (the cursor may never move backwards), the
// poisoned record in the LAST chunk, the new edge code against the OLD SQL
// (no ops_release_record_poisoned: PGRST202 must fail closed), a budget that
// is already spent (no cursor write at all), and what a systemic ingest
// failure does today (every record poisoned; documented on #4580).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type BridgeAdmin, type BridgeGitHub, runReleaseBridges } from "../opsBridges.ts";

type Json = Record<string, unknown>;
const REPO = "Mingla-LLC/mingla-main";
const BASE = Date.parse("2026-11-23T10:00:00Z");
const at = (i: number): string => new Date(BASE + i * 60_000).toISOString();

function recordBody(pr: number): string {
  const data = {
    v: 1,
    repo: REPO,
    pr,
    title: `Release ${pr}`,
    pr_url: `https://github.com/${REPO}/pull/${pr}`,
    merged_at: "2026-11-23T09:00:00Z",
    merge_sha: "b".repeat(40),
    deploy: {},
    problems: [],
  };
  return `<!-- mingla-release-record:pr-${pr} -->\n<!-- mingla-release-record-data\n${JSON.stringify(data)}\n-->`;
}

function comment(pr: number | null, minute: number, id: number): Json {
  return {
    body: pr === null ? "a human comment" : recordBody(pr),
    user: pr === null ? { login: "sethogieva", type: "User" } : { login: "github-actions[bot]", type: "Bot" },
    html_url: `https://github.com/${REPO}/issues/4580#issuecomment-${id}`,
    issue_url: `https://api.github.com/repos/${REPO}/issues/4580`,
    updated_at: at(minute),
  };
}

function gh(comments: Json[], budget = 5000): BridgeGitHub {
  return {
    budget,
    issueCommentsSince: () => Promise.resolve(comments),
    mainCommitsSince: () => Promise.resolve([]),
    pullsForCommit: () => Promise.resolve(null),
    createCommitStatus: () => Promise.resolve(),
  };
}

type Behaviour = (prs: number[], call: number) => { code: string } | null;

function db(ingestFails: Behaviour, poison: "ok" | "missing" = "ok") {
  const calls: { name: string; args: Json }[] = [];
  const ingested: number[] = [];
  let n = 0;
  const admin: BridgeAdmin = {
    rpc(name: string, args: Record<string, unknown> = {}) {
      calls.push({ name, args });
      if (name === "ops_bridge_cursor") return Promise.resolve({ data: "2026-11-23T09:55:00+00:00", error: null });
      if (name === "ops_release_records_ingest") {
        const prs = (args.p_records as Json[]).map((r) => Number((r.data as Json).pr));
        const err = ingestFails(prs, n++);
        if (err) return Promise.resolve({ data: null, error: { code: err.code, message: "x" } });
        ingested.push(...prs);
        return Promise.resolve({ data: { ingested: prs.length, invalid: 0, completed: [] }, error: null });
      }
      if (name === "ops_release_record_poisoned") {
        return Promise.resolve(
          poison === "missing"
            ? { data: null, error: { code: "PGRST202", message: "Could not find the function public.ops_release_record_poisoned" } }
            : { data: null, error: null },
        );
      }
      if (name === "ops_release_status_due") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: {}, error: null });
    },
  };
  const cursorSets = () =>
    calls.filter((c) => c.name === "ops_bridge_cursor_set" && c.args.p_name === "issue_comments").map((c) => String(c.args.p_at));
  const poisoned = () => calls.filter((c) => c.name === "ops_release_record_poisoned").map((c) => c.args.p_pr);
  return { admin, calls, ingested, cursorSets, poisoned };
}

const range = (n: number, from = 7000) => Array.from({ length: n }, (_, i) => from + i);

Deno.test("#4580 tester: a chunk that fails once but whose records all succeed alone poisons nothing", async () => {
  const d = db((prs, call) => (call === 0 && prs.length > 1 ? { code: "57014" } : null));
  const comments = range(15).map((pr, i) => comment(pr, i + 1, 100 + i));
  const res = await runReleaseBridges(d.admin, gh(comments));
  assertEquals(d.poisoned(), []);
  assertEquals(res.release_records.poisoned, []);
  assertEquals([...d.ingested].sort(), range(15));
  assertEquals(res.failed, 0);
  assertEquals(d.cursorSets(), [at(10), at(15)]);
});

Deno.test("#4580 tester: out-of-order comments with equal timestamps never move the cursor backwards", async () => {
  const minutes = [5, 1, 5, 3, 9, 9, 2, 7, 1, 4, 8, 6, 3, 9, 2, 5, 7, 1, 8, 4, 6, 2];
  const comments = minutes.map((m, i) => comment(7100 + i, m, 300 + ((i * 7) % 22)));
  const d = db(() => null);
  await runReleaseBridges(d.admin, gh(comments));
  const sets = d.cursorSets().map((s) => Date.parse(s));
  for (let i = 1; i < sets.length; i++) assert(sets[i] >= sets[i - 1], `cursor moved backwards: ${d.cursorSets()}`);
  assertEquals(d.cursorSets().at(-1), at(9));
  // Each chunk is the oldest remaining records: chunk 1 holds every minute-1..4 record.
  const first = d.calls.find((c) => c.name === "ops_release_records_ingest")!;
  const firstAts = (first.args.p_records as Json[]).map((r) => Date.parse(String(r.commented_at)));
  assert(Math.max(...firstAts) <= Date.parse(at(4)));
});

Deno.test("#4580 tester: a poisoned record in the LAST chunk is recorded and the cursor still reaches the newest comment", async () => {
  const comments = [...range(23).map((pr, i) => comment(pr, i + 1, 500 + i)), comment(null, 40, 999)];
  const d = db((prs) => (prs.includes(7022) ? { code: "57014" } : null));
  const res = await runReleaseBridges(d.admin, gh(comments));
  assertEquals(d.poisoned(), [7022]);
  assertEquals(res.release_records.poisoned, [7022]);
  assertEquals(d.cursorSets().at(-1), at(40), "a newer non-record comment still moves the cursor on");
  assertEquals(d.ingested.length, 22);
});

Deno.test("#4580 tester: new edge code on the OLD SQL (no poison function) fails closed like today", async () => {
  const comments = range(25).map((pr, i) => comment(pr, i + 1, 700 + i));
  const d = db((prs) => (prs.includes(7013) ? { code: "57014" } : null), "missing");
  const lines: Json[] = [];
  const res = await runReleaseBridges(d.admin, gh(comments), { log: (l) => lines.push(l) });
  assertEquals(d.cursorSets(), [at(10)], "the cursor stops at the end of the last fully handled chunk");
  assertEquals(res.release_records.poisoned, []);
  assert(res.failed >= 1);
  assert(lines.some((l) => l.event === "release_records_failed" && l.code === "RECORD_POISON_FAILED"));
  // Records after the bad one are never ingested in this run.
  assert(!d.ingested.some((p) => p >= 7020));
});

Deno.test("#4580 tester: a run whose budget is already spent writes no cursor at all", async () => {
  const comments = range(5).map((pr, i) => comment(pr, i + 1, 900 + i));
  const d = db(() => null);
  let clock = 0;
  const g = gh(comments);
  // The first mayCall passes (cursor read), the per-chunk check fails.
  const res = await runReleaseBridges(d.admin, { ...g, issueCommentsSince: () => (clock = 10_000, Promise.resolve(comments)) }, {
    now: () => clock,
    maxMs: 5_000,
  });
  assertEquals(d.cursorSets(), []);
  assertEquals(d.ingested, []);
  assert(res.deferred.includes("release_records"));
});

Deno.test("#4580 tester (documents a finding): a systemic ingest failure poisons every record and moves the cursor past them", async () => {
  // Every ingest call fails (e.g. a broken grant or a bad ingest deploy) while
  // the poison RPC still works. D3 as specified treats each record as failing
  // "on its own", so all are skipped. Pinned here so a later fix is a visible,
  // deliberate change; see the test verdict on #4580.
  const comments = range(12).map((pr, i) => comment(pr, i + 1, 1100 + i));
  const d = db(() => ({ code: "PGRST000" }));
  const res = await runReleaseBridges(d.admin, gh(comments));
  assertEquals(d.poisoned().length, 12);
  assertEquals(d.cursorSets().at(-1), at(12));
  // 2 chunk calls + 12 single-record retries; the single retries do not check the time budget.
  assertEquals(d.calls.filter((c) => c.name === "ops_release_records_ingest").length, 14);
  assertEquals(res.failed, 12);
});
