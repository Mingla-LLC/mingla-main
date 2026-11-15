// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// MINGLA-INVARIANT: I-4430-L3 | issue #4430 | a changes_requested Local review opens prefilled from local_reviews, with Admin's request and due date shown
// MINGLA-INVARIANT: I-4430-L2 | issue #4430 | Local refresh refetches only the queries on screen; no Local query key carries an empty id
//
// FAILS-ON-REVERT: dropping the prefill (a blank form again), putting `type: 'active'` back to the
// default in refreshLocal (Missing queryFn on every pull), or a second `place-name` key, fails here.
import { assert, assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { changesCardWords as changesCardWordsWith, draftToFormState } from "../localReviewDraft.ts";
import { formatInZone } from "../../../utils/programFormat.ts";
import { localKeys } from "../localKeys.ts";
import { placeNamesQueryEnabled, refreshLocal } from "../localRefresh.ts";

const changesCardWords = (m: { changes_due_at?: string | null }, r: string[] | undefined, now: Date) => changesCardWordsWith(m, r, now, (v, at) => formatInZone(v, null, at));
const app = new URL("../../../../../", import.meta.url);
const read = (p: string): string => Deno.readTextFileSync(new URL(p, app));

const DRAFT = {
  rating: 4, title: "Small plates", body: "x".repeat(320), visited_on: "2026-11-08", spend_band: "mid",
  media_job_ids: ["job-1", "job-2"], social_post_url: "https://instagram.com/p/abc", changes_requested: ["Show the receipt", "Say the place name", "Cut the intro"],
};

Deno.test("#4430 L-3: every saved field maps into the form, confirmations come back unticked", () => {
  const f = draftToFormState(DRAFT);
  assertEquals(f.rating, 4);
  assertEquals(f.title, "Small plates");
  assertEquals(f.body.length, 320);
  assertEquals(f.spend, "mid");
  assertEquals(f.visitedOn, "2026-11-08");
  assertEquals(f.link, "https://instagram.com/p/abc");
  assertEquals(f.clips, [{ jobId: "job-1", status: "checking" }, { jobId: "job-2", status: "checking" }]);
  assertEquals(f.formatConfirmed, false);
  assertEquals(f.collaborationConfirmed, false);
});

Deno.test("#4430 L-3: a timestamp visited_on keeps its calendar day; a missing draft is the blank form", () => {
  assertEquals(draftToFormState({ ...DRAFT, visited_on: "2026-11-08T00:00:00+00:00" }).visitedOn, "2026-11-08");
  const blank = draftToFormState(null);
  assertEquals([blank.rating, blank.title, blank.body, blank.link, blank.clips.length], [0, "", "", "", 0]);
  assertEquals(draftToFormState(undefined).spend, null);
});

Deno.test("#4430 L-3: the card names the due date, the first request and how many more", () => {
  const now = new Date(2026, 10, 14, 12);
  const w = changesCardWords({ changes_due_at: "2026-11-20T10:00:00Z" }, DRAFT.changes_requested, now);
  assertEquals(w.ended, false);
  assert(/^Send your update by \w{3} Nov 20, \d{1,2}:\d{2} (AM|PM)\.$/.test(w.line), w.line);
  assertEquals(w.first, "Show the receipt");
  assertEquals(w.more, "+ 2 more");
  const one = changesCardWords({ changes_due_at: "2026-11-20T10:00:00Z" }, ["Only this"], now);
  assertEquals([one.first, one.more], ["Only this", null]);
  const none = changesCardWords({ changes_due_at: "2026-11-20T10:00:00Z" }, undefined, now);
  assertEquals([none.first, none.more], [null, null]);
});

Deno.test("#4430 L-3: after the due time the card says it ended", () => {
  const w = changesCardWords({ changes_due_at: "2026-11-20T10:00:00Z" }, ["x"], new Date("2026-11-21T00:00:00Z"));
  assertEquals(w.ended, true);
  assertEquals(w.line, "The time to update this review has ended.");
});

Deno.test("#4430 L-3: source guard — no singular place-name key, localKeys everywhere, prefill is seeded once", () => {
  const review = read("app-mobile/app/local/review.tsx");
  const index = read("app-mobile/app/local/index.tsx");
  for (const [name, src] of [["review.tsx", review], ["index.tsx", index]]) {
    assert(!/'local',\s*'place-name'/.test(src), `${name}: no 'local','place-name' literal`);
    assert(!/queryKey:\s*\['local'/.test(src), `${name}: keys come from localKeys`);
    assert(src.includes("localKeys"), `${name}: imports localKeys`);
  }
  assert(review.includes("seeded.current"), "prefill runs once");
  assert(review.includes("draftToFormState"), "review prefills from the saved draft");
  assert(review.includes("'Send update'"), "resubmit button label");
  assert(index.includes("changesCardWords"), "home card shows the request");
});

Deno.test("#4430 L-2: localKeys.placeNames filters, dedupes and sorts; an empty list never enables the query", async () => {
  assert(read("app-mobile/src/services/localProgramService.ts").includes("localKeys"), "the service exports the factory");
  assertEquals(placeNamesQueryEnabled([]), false);
  assertEquals(placeNamesQueryEnabled([null, undefined, ""]), false);
  assertEquals(placeNamesQueryEnabled([null, "a"]), true);
  assertEquals(localKeys.placeNames([null, "b", "a", "a"]), ["local", "place-names", "a,b"]);
  assertEquals(localKeys.review("m1"), ["local", "review", "m1"]);
  assertEquals(localKeys.all, ["local"]);
});

Deno.test("#4430 L-2: refreshing Local with an orphaned restored query does not raise Missing queryFn", async () => {
  const lock = JSON.parse(Deno.readTextFileSync(new URL("app-mobile/package-lock.json", app)));
  const version = lock.packages["node_modules/@tanstack/query-core"].version;
  const { QueryClient } = await import(`npm:@tanstack/query-core@${version}`);
  const qc = new QueryClient();
  qc.setQueryData(["local", "place-names", ""], {}); // restored from storage: fetched once, no queryFn, nobody mounted
  qc.setQueryData(["local", "places", "old term"], []);
  let active = 0;
  const { QueryObserver } = await import(`npm:@tanstack/query-core@${version}`);
  const unsub = new QueryObserver(qc, { queryKey: ["local", "home"], queryFn: () => { active++; return Promise.resolve({ ok: true }); } }).subscribe(() => {});
  await new Promise((r) => setTimeout(r, 20));
  const before = active;
  // The old behaviour, to prove the harness reproduces the bug:
  let oldFailed = false;
  try { await qc.refetchQueries({ queryKey: ["local"] }, { throwOnError: true }); } catch (e) { oldFailed = String(e).includes("Missing queryFn"); }
  assert(oldFailed, "refetching every Local query rejects with Missing queryFn (the L-2 bug)");
  await refreshLocal(qc); // must resolve without throwing
  assert(active > before, "the on-screen query was read again");
  assertEquals(qc.getQueryState(["local", "place-names", ""]).fetchStatus, "idle");
  assertEquals(qc.getQueryState(["local", "places", "old term"]).fetchStatus, "idle");
  assertEquals(qc.getQueryState(["local", "places", "old term"]).isInvalidated, true);
  unsub();
  qc.clear();
});
