// #4636 build 2: the Admin side of the site CMS contract (src/services/siteCmsService.js).
// Happy: each call names its RPC with the argument names the migration defines; library paths
// match the storage policies; a publish refresh names the page.
// Adversarial: database refusals become plain messages (42501, PT409 path_taken / page_draft_conflict,
// video_too_long); an oversized, non-MP4 or over-60-second video is refused before any network call;
// a storage policy refusal (the 90 % allowance) reads as paused uploads.
// FAILS-ON-REVERT: mapping the RAISE word after the SQLSTATE fails "refusals"; dropping the MP4 check
// in mediaPickProblem fails "before any network call".
// Run: node --test src/services/__tests__/siteCms.issue4636.test.js (from mingla-admin).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { libraryPaths, mediaPickProblem, siteCms, siteCmsError, SiteCmsError } from "../siteCmsService.js";

function fakeClient(result = { data: { ok: true }, error: null }) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => { calls.push([name, args]); return result; },
    storage: { from: (bucket) => ({ upload: async (path, _blob, opts) => { calls.push(["upload", bucket, path, opts]); return result; } }) },
    functions: { invoke: async (fn, opts) => { calls.push(["invoke", fn, opts.body]); return result; } },
  };
}

const MIGRATION = new URL("../../../../supabase/migrations/20281208004636_issue_4636_site_cms.sql", import.meta.url);

test("each call names its RPC with the migration's argument names", async () => {
  const c = fakeClient();
  const cms = siteCms(c);
  await cms.createPage("/summer-socials", "Summer socials", "landing", []);
  await cms.updatePageMeta("p-0123456789ab", { hide_from_search: true });
  await cms.deletePage("p-0123456789ab");
  await cms.registerMedia("46360000-0000-4000-c000-0000000000a1", "image", 2400, 1600, 12, "A rooftop");
  await cms.mediaUsage();
  await cms.revalidate("host");
  const sql = fs.readFileSync(MIGRATION, "utf8");
  for (const [name, args] of c.calls.filter((x) => x[0] !== "invoke")) {
    const sig = sql.match(new RegExp(`FUNCTION public\\.${name}\\(([^)]*)\\)`));
    assert.ok(sig, `${name} is defined by the migration`);
    for (const arg of Object.keys(args ?? {})) assert.match(sig[1], new RegExp(`\\b${arg}\\b`), `${name}(${arg})`);
  }
  assert.equal(c.calls[3][1].p_duration_seconds, null, "a picture has no duration");
  assert.deepEqual(c.calls.at(-1), ["invoke", "admin-blog", { action: "revalidate_page", pageKey: "host" }]);
});

test("library paths match the storage policies", () => {
  const id = "46360000-0000-4000-c000-0000000000a2";
  assert.deepEqual(libraryPaths(id, "video"), {
    file: { bucket: "site-video", path: `library/${id}.mp4`, contentType: "video/mp4" },
    still: { bucket: "site-media", path: `library/${id}_poster.jpg`, contentType: "image/jpeg" },
  });
  assert.equal(libraryPaths(id, "image").still.path, `library/${id}_thumb.jpg`);
  const sql = fs.readFileSync(MIGRATION, "utf8");
  assert.match(sql, /name ~ '\^library\/\[0-9a-f\]\{8\}-.*\(_thumb\|_poster\)\?\\\.jpg\$'/);
  assert.throws(() => libraryPaths("../x", "image"), SiteCmsError);
});

test("refusals: the database's words become plain messages", () => {
  assert.equal(siteCmsError({ code: "PT409", message: "path_taken", details: '{"code":"path_taken"}' }).message, "That address is already used.");
  assert.equal(siteCmsError({ code: "PT409", message: "page_draft_conflict" }).message, "Someone else changed this page. Reload to see their version.");
  assert.equal(siteCmsError({ code: "42501", message: "not_authorized" }).message, "You can view this page. Ask a website editor to change it.");
  assert.equal(siteCmsError({ code: "22023", message: "video_too_long" }).code, "video_too_long");
  assert.deepEqual(siteCmsError({ code: "PT409", message: "page_conflict", details: '{"code":"page_conflict","published_by":"Abi"}' }).detail, { code: "page_conflict", published_by: "Abi" });
  assert.equal(siteCmsError(null).code, "server");
});

test("before any network call: wrong type, too large or too long is refused", async () => {
  assert.equal(mediaPickProblem({ kind: "video", type: "video/quicktime", bytes: 1, seconds: 5 }), "Videos must be MP4.");
  assert.equal(mediaPickProblem({ kind: "video", type: "video/mp4", bytes: 52428801, seconds: 5 }), "Videos can be at most 50 MB.");
  assert.equal(mediaPickProblem({ kind: "video", type: "video/mp4", bytes: 10, seconds: 61 }), "Videos can be at most 60 seconds.");
  assert.equal(mediaPickProblem({ kind: "video", type: "video/mp4", bytes: 10, seconds: 60 }), null);
  assert.equal(mediaPickProblem({ kind: "image", bytes: 6 * 1024 * 1024 }), "Pictures can be at most 5 MB after resizing.");
  const denied = siteCms(fakeClient({ data: null, error: { message: "new row violates row-level security policy" } }));
  await assert.rejects(denied.upload(libraryPaths("46360000-0000-4000-c000-0000000000a1", "image").file, new Uint8Array(1)), (e) => e.code === "storage_full_or_denied");
  const failing = siteCms(fakeClient({ data: null, error: { code: "42501", message: "not_authorized" } }));
  await assert.rejects(failing.createPage("/x", "X", "blank"), (e) => e instanceof SiteCmsError && e.code === "not_authorized");
});
