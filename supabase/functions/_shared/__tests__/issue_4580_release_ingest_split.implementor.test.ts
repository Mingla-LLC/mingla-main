// MINGLA-INVARIANT: I-4580-RELEASE-INGEST-NEVER-FREEZES | issue #4580 | A release record that fails on its own is recorded by ops_release_record_poisoned and the issue_comments cursor moves past it; nothing is skipped without that record.
//
// Issue #4580: one release record (PR #4553, 99 Feature Guide entries) timed
// out every ingest call, and the bridge threw before moving the
// issue_comments cursor, so nothing merged after it ever reached Mingla.
// These tests run runReleaseBridges against a stand-in database and GitHub:
// records go in chunks of RECORD_CHUNK with the cursor moved after each
// chunk; a record that fails on its own is poisoned out loud and skipped; a
// run stopped by its time budget leaves the cursor at the last chunk it
// finished.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type BridgeAdmin, type BridgeGitHub, RECORD_CHUNK, runReleaseBridges } from "../opsBridges.ts";

type Json = Record<string, unknown>;
const REPO = "Mingla-LLC/mingla-main";
const BASE = Date.parse("2026-11-22T15:05:00Z");

function at(i: number): string {
  return new Date(BASE + i * 60_000).toISOString();
}

function recordBody(pr: number): string {
  const data = {
    v: 1,
    repo: REPO,
    pr,
    title: `Release ${pr}`,
    pr_url: `https://github.com/${REPO}/pull/${pr}`,
    merged_at: "2026-11-22T15:00:00Z",
    merge_sha: "a".repeat(40),
    issues: [],
    migrations_added: [],
    edge_functions: [],
    web_projects: [],
    deploy_marker: false,
    deploy: {},
    problems: [],
  };
  return `<!-- mingla-release-record:pr-${pr} -->\nRelease record\n<!-- mingla-release-record-data\n${
    JSON.stringify(data)
  }\n-->`;
}

/** 25 bot record comments, oldest first; prs[i] sits at minute i + 1. */
function page(prs: number[]): Json[] {
  // Handed over newest first, so the bridge's own sort is exercised too.
  return prs.map((pr, i) => ({
    body: recordBody(pr),
    user: { login: "github-actions[bot]", type: "Bot" },
    html_url: `https://github.com/${REPO}/issues/4580#issuecomment-${1000 + i}`,
    issue_url: `https://api.github.com/repos/${REPO}/issues/4580`,
    updated_at: at(i + 1),
  })).reverse();
}

const PRS = Array.from({ length: 25 }, (_, i) => 8000 + i);

type Call = { name: string; args: Json };

function fakeAdmin(opts: { badPr?: number; poisonFails?: boolean; onIngest?: () => void } = {}) {
  const calls: Call[] = [];
  const ingested: number[] = [];
  const admin: BridgeAdmin = {
    rpc(name: string, args: Record<string, unknown> = {}) {
      calls.push({ name, args });
      if (name === "ops_bridge_cursor") return Promise.resolve({ data: "2026-11-22T15:03:40+00:00", error: null });
      if (name === "ops_release_records_ingest") {
        opts.onIngest?.();
        const rows = args.p_records as Json[];
        const prs = rows.map((r) => Number((r.data as Json).pr));
        if (opts.badPr !== undefined && prs.includes(opts.badPr)) {
          return Promise.resolve({
            data: null,
            error: { code: "57014", message: "canceling statement due to statement timeout" },
          });
        }
        ingested.push(...prs);
        return Promise.resolve({ data: { ingested: rows.length, invalid: 0, completed: [] }, error: null });
      }
      if (name === "ops_release_record_poisoned") {
        return Promise.resolve(
          opts.poisonFails
            ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } }
            : { data: null, error: null },
        );
      }
      if (name === "ops_release_status_due") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: {}, error: null });
    },
  };
  const cursorSets = () =>
    calls.filter((c) => c.name === "ops_bridge_cursor_set" && c.args.p_name === "issue_comments").map((c) =>
      String(c.args.p_at)
    );
  return { admin, calls, ingested, cursorSets };
}

function fakeGitHub(comments: Json[]): BridgeGitHub {
  return {
    budget: 5000,
    issueCommentsSince: () => Promise.resolve(comments),
    mainCommitsSince: () => Promise.resolve([]),
    pullsForCommit: () => Promise.resolve(null),
    createCommitStatus: () => Promise.resolve(),
  };
}

Deno.test("#4580 happy path: 25 records go in 3 chunks with 3 cursor moves and nothing poisoned", async () => {
  assertEquals(RECORD_CHUNK, 10);
  const db = fakeAdmin();
  const res = await runReleaseBridges(db.admin, fakeGitHub(page(PRS)));
  const ingestCalls = db.calls.filter((c) => c.name === "ops_release_records_ingest");
  assertEquals(ingestCalls.map((c) => (c.args.p_records as unknown[]).length), [10, 10, 5]);
  assertEquals(db.ingested, PRS, "oldest first, each record once");
  assertEquals(db.cursorSets(), [at(10), at(20), at(25)]);
  assertEquals(res.release_records.poisoned, []);
  assertEquals(res.release_records.ingested, 25);
  assertEquals(res.failed, 0);
});

Deno.test("#4580 SC-6: a record that fails on its own is poisoned out loud; every other record and the cursor move on", async () => {
  const bad = 9001;
  const prs = [...PRS];
  prs[6] = bad; // position 7
  const lines: Json[] = [];
  const db = fakeAdmin({ badPr: bad });
  const res = await runReleaseBridges(db.admin, fakeGitHub(page(prs)), { log: (l) => lines.push(l) });
  assertEquals([...db.ingested].sort(), prs.filter((p) => p !== bad).sort(), "every other PR is ingested");
  const poison = db.calls.filter((c) => c.name === "ops_release_record_poisoned");
  assertEquals(poison.length, 1);
  assertEquals(poison[0].args.p_pr, bad);
  assertEquals(poison[0].args.p_code, "INGEST_TIMEOUT");
  assertEquals(poison[0].args.p_comment_url, `https://github.com/${REPO}/issues/4580#issuecomment-1006`);
  assertEquals(res.release_records.poisoned, [bad]);
  assertEquals(db.cursorSets().at(-1), at(25), "the cursor ends at the newest comment");
  assert(res.failed >= 1);
  assert(lines.some((l) => l.event === "release_record_poisoned" && l.pr === bad && l.code === "INGEST_TIMEOUT"));
});

Deno.test("#4580 SC-6: if the poison record cannot be written, the cursor never passes the record", async () => {
  // PR 9001 in the first chunk: no chunk was fully handled, so no cursor move.
  let prs = [...PRS];
  prs[6] = 9001;
  let db = fakeAdmin({ badPr: 9001, poisonFails: true });
  let res = await runReleaseBridges(db.admin, fakeGitHub(page(prs)));
  assertEquals(db.cursorSets(), []);
  assertEquals(res.release_records.poisoned, []);
  assert(res.failed >= 1);
  // PR 9001 in the second chunk: the cursor stays at the end of the first.
  prs = [...PRS];
  prs[14] = 9001;
  db = fakeAdmin({ badPr: 9001, poisonFails: true });
  res = await runReleaseBridges(db.admin, fakeGitHub(page(prs)));
  assertEquals(db.cursorSets(), [at(10)]);
  assertEquals(res.release_records.poisoned, []);
  assert(res.failed >= 1);
});

Deno.test("#4580 SC-6: any other ingest error is poisoned as INGEST_FAILED", async () => {
  const db = fakeAdmin();
  const base = db.admin;
  const admin: BridgeAdmin = {
    rpc(name, args) {
      if (name === "ops_release_records_ingest" && (args?.p_records as Json[]).some((r) => (r.data as Json).pr === 8003)) {
        return Promise.resolve({ data: null, error: { code: "PGRST000", message: "500" } });
      }
      return base.rpc(name, args);
    },
  };
  const res = await runReleaseBridges(admin, fakeGitHub(page(PRS)));
  const poison = db.calls.filter((c) => c.name === "ops_release_record_poisoned");
  assertEquals(poison.map((c) => [c.args.p_pr, c.args.p_code]), [[8003, "INGEST_FAILED"]]);
  assertEquals(res.release_records.poisoned, [8003]);
  assertEquals(db.cursorSets().at(-1), at(25));
});

Deno.test("#4580 SC-7: a run whose time budget runs out after chunk 2 of 3 leaves the cursor at chunk 2", async () => {
  let clock = 0;
  const db = fakeAdmin({ onIngest: () => (clock += 1000) });
  const res = await runReleaseBridges(db.admin, fakeGitHub(page(PRS)), { now: () => clock, maxMs: 1500 });
  assertEquals(db.calls.filter((c) => c.name === "ops_release_records_ingest").length, 2);
  assertEquals(db.cursorSets(), [at(10), at(20)]);
  assert(!db.cursorSets().includes(at(25)), "not the newest comment");
  assert(res.deferred.includes("release_records"));
  assertEquals(res.release_records.ingested, 20);
});
