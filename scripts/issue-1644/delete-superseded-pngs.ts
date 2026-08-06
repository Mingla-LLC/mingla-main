#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
//
// Issue #1644 — Stage 2, FINAL STEP: delete the superseded collage PNGs.
//
// THIS IS THE ONLY IRREVERSIBLE PART OF THE WHOLE STAGE, AND IT LIVES IN ITS OWN
// FILE ON PURPOSE.
//
// The re-encode worker (`reencode-collages.ts`) never deletes anything. There is
// no code path from writing a replacement to removing an original — you have to
// deliberately run this program. That separation is the point: fusing the write
// and the delete into one pass would mean a single bad run could destroy 33 GiB of
// originals, and "we verified it first" would be a claim rather than a gate.
//
// WHAT IT REFUSES TO DO
// ---------------------
//   * It NEVER deletes by bucket prefix. It deletes exactly the `old_key` values
//     recorded in the manifest, one explicit list, nothing else.
//   * It only considers rows with status='committed' — i.e. a replacement was
//     written AND verified AND the live URL was moved onto it.
//   * Before deleting ANY object it RE-PROVES, over HTTP, right now, that the
//     .webp replacement is fetchable, correctly typed, non-zero and decodes with
//     zero transparent pixels, AND that `place_pool.photo_collage_url` actually
//     points at it. A stale verification from an earlier run is not evidence.
//   * If ANY object in a batch fails that re-proof, the whole run aborts having
//     deleted nothing further.
//   * It is DRY RUN by default and additionally requires an explicit
//     --i-have-verified acknowledgement alongside --execute.
//
// WHAT IT COSTS IF IT STILL GOES WRONG
// ------------------------------------
// `composeCollage()` is idempotent and rebuilds from `place_pool.stored_photo_urls`,
// and 33,974 of 34,024 places (99.85%) have already produced their AI scores from
// these collages. So the worst realistic case is a re-compose, not lost product
// data. That is a mitigation, NOT a licence to be careless — a re-compose of the
// whole corpus would itself write ~33 GiB and trip the Stage 0 guardrail.
//
// ENV
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// USAGE
//   # see what it would remove (default, writes nothing):
//   deno run --allow-net --allow-env --allow-read --allow-write \
//     scripts/issue-1644/delete-superseded-pngs.ts --run-id <uuid>
//
//   # actually remove them:
//   deno run --allow-net --allow-env --allow-read --allow-write \
//     scripts/issue-1644/delete-superseded-pngs.ts --run-id <uuid> --execute --i-have-verified

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  COLLAGE_BUCKET,
  countTransparentPixels,
  decodeWebpToRgba,
  WEBP_CONTENT_TYPE,
} from "./collageReencode.ts";

const DEFAULT_BATCH = 50;
const MAX_BATCH = 100; // Supabase storage `remove()` takes a list; keep batches small and auditable
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_RATE_LIMIT_MS = 250;

interface CommittedRow {
  id: string;
  place_pool_id: string;
  old_key: string;
  new_key: string;
  old_bytes: number;
  new_bytes: number | null;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) flags[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[a.slice(2)] = argv[++i];
    else flags[a.slice(2)] = true;
  }
  return flags;
}

function fmtBytes(b: number): string {
  if (Math.abs(b) >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GiB`;
  if (Math.abs(b) >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(2)} MiB`;
  return `${(b / 1024).toFixed(2)} KiB`;
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is required — this program deletes production objects and will not guess a target.`);
  return v;
}

function publicUrlFor(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${COLLAGE_BUCKET}/${key}`;
}

function collageKeyFromUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const marker = `/storage/v1/object/public/${COLLAGE_BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  const key = url.slice(i + marker.length).split("?")[0];
  return key.length > 0 ? key : null;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Re-prove, RIGHT NOW, that this object's replacement is real and in use.
 *
 * Everything this program is allowed to destroy rests on this function. It
 * deliberately re-does the full check rather than trusting `status='committed'`,
 * because the manifest records what WAS true at commit time and the only thing
 * that matters here is what is true at delete time.
 */
async function replacementIsLive(
  db: SupabaseClient,
  baseUrl: string,
  row: CommittedRow,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let res: Response;
  try {
    res = await fetchWithTimeout(publicUrlFor(baseUrl, row.new_key));
  } catch (err) {
    return { ok: false, reason: `replacement fetch threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { ok: false, reason: `replacement returns HTTP ${res.status}` };

  const ct = res.headers.get("content-type") ?? "";
  if (!ct.startsWith(WEBP_CONTENT_TYPE)) {
    return { ok: false, reason: `replacement content-type is "${ct || "(absent)"}", not ${WEBP_CONTENT_TYPE}` };
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0) return { ok: false, reason: "replacement serves zero bytes" };
  if (row.new_bytes !== null && bytes.length !== row.new_bytes) {
    return { ok: false, reason: `replacement serves ${bytes.length} B, manifest recorded ${row.new_bytes} B` };
  }

  try {
    const decoded = await decodeWebpToRgba(bytes);
    const transparent = countTransparentPixels(decoded.data);
    if (transparent !== 0) {
      return { ok: false, reason: `replacement still has ${transparent} transparent pixels` };
    }
  } catch (err) {
    return { ok: false, reason: `replacement does not decode: ${err instanceof Error ? err.message : String(err)}` };
  }

  const { data: pool, error } = await db
    .from("place_pool")
    .select("photo_collage_url")
    .eq("id", row.place_pool_id)
    .maybeSingle();
  if (error) return { ok: false, reason: `place_pool read failed: ${error.message}` };
  const liveKey = collageKeyFromUrl((pool as { photo_collage_url: string | null } | null)?.photo_collage_url);
  if (liveKey !== row.new_key) {
    return { ok: false, reason: `place_pool points at ${liveKey ?? "(nothing)"}, not the replacement` };
  }

  return { ok: true };
}

async function main(): Promise<number> {
  const flags = parseArgs(Deno.args);
  const runId = String(flags["run-id"] ?? "");
  if (!runId) {
    console.error("--run-id is required.");
    return 1;
  }

  const execute = flags["execute"] === true || flags["execute"] === "true";
  const acknowledged = flags["i-have-verified"] === true || flags["i-have-verified"] === "true";
  const batchSize = Math.max(1, Math.min(Number(flags["batch"] ?? DEFAULT_BATCH) || DEFAULT_BATCH, MAX_BATCH));
  const rateLimitMs = Math.max(0, Number(flags["rate-limit-ms"] ?? DEFAULT_RATE_LIMIT_MS) || 0);
  const limit = flags["limit"] === undefined ? Number.MAX_SAFE_INTEGER : Number(flags["limit"]);

  if (execute && !acknowledged) {
    console.error(
      "REFUSING. --execute must be accompanied by --i-have-verified.\n\n" +
        "Run this first and read its output:\n" +
        `  deno run --allow-net --allow-env --allow-read --allow-write \\\n` +
        `    scripts/issue-1644/reencode-collages.ts verify --run-id ${runId}\n\n` +
        "Deleting these PNGs is the only irreversible step in issue #1644. The two flags are " +
        "separate so that neither a typo nor a copy-pasted command can be the reason 33 GiB of " +
        "originals disappeared.",
    );
    return 2;
  }

  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(url, key, { auth: { persistSession: false } });

  console.log(
    `# issue-1644 delete superseded PNGs — ${execute ? "LIVE (IRREVERSIBLE)" : "DRY RUN (deletes nothing)"}\n` +
      `#   run-id=${runId} batch=${batchSize} rate-limit=${rateLimitMs}ms`,
  );

  let deleted = 0;
  let freed = 0;
  let inspected = 0;
  const refusals: string[] = [];

  while (inspected < limit) {
    const take = Math.min(batchSize, limit - inspected);
    const { data, error } = await db
      .from("place_collage_reencode_jobs")
      .select("id, place_pool_id, old_key, new_key, old_bytes, new_bytes")
      .eq("run_id", runId)
      .eq("status", "committed")
      .order("old_bytes", { ascending: false })
      .limit(take);
    if (error) throw new Error(`manifest read failed: ${error.message}`);

    const rows = (data ?? []) as CommittedRow[];
    if (rows.length === 0) break;

    // ── Re-prove EVERY row in this batch BEFORE removing a single object ─────
    const cleared: CommittedRow[] = [];
    for (const row of rows) {
      inspected++;
      const check = await replacementIsLive(db, url, row);
      if (!check.ok) {
        refusals.push(`${row.old_key}: ${check.reason}`);
        continue;
      }
      cleared.push(row);
      if (rateLimitMs > 0) await new Promise((r) => setTimeout(r, rateLimitMs));
    }

    if (refusals.length > 0) {
      console.error(`\nABORTING — ${refusals.length} object(s) failed the pre-delete re-proof:`);
      for (const r of refusals.slice(0, 50)) console.error(`  ${r}`);
      console.error(
        `\nNothing further was deleted. Each of these .png files is still the only working copy of ` +
          `that collage. Fix the underlying cause (re-run \`reencode-collages.ts run --execute\` for ` +
          `the affected run) and try again.`,
      );
      return 1;
    }

    if (!execute) {
      for (const row of cleared) {
        freed += row.old_bytes;
        deleted++;
      }
      console.log(`  would delete ${cleared.length} object(s) — running total ${deleted}, ${fmtBytes(freed)}`);
      if (rows.length < take) break;
      // A dry run does not advance any status, so re-querying returns the same
      // rows forever. Stop after one representative pass.
      break;
    }

    // EXPLICIT KEY LIST. Never a prefix.
    const keys = cleared.map((r) => r.old_key);
    const { error: delErr } = await db.storage.from(COLLAGE_BUCKET).remove(keys);
    if (delErr) throw new Error(`storage remove failed: ${delErr.message}`);

    const now = new Date().toISOString();
    const { error: markErr } = await db
      .from("place_collage_reencode_jobs")
      .update({ status: "deleted", deleted_at: now })
      .in("id", cleared.map((r) => r.id));
    if (markErr) {
      // The objects are gone; failing to record that is an audit gap, not a data
      // loss. Say so loudly rather than swallowing it — a re-run would otherwise
      // try to delete them again and report confusing "already gone" noise.
      console.error(
        `WARNING: deleted ${keys.length} object(s) but could not mark them in the manifest: ${markErr.message}`,
      );
    }

    deleted += cleared.length;
    freed += cleared.reduce((s, r) => s + r.old_bytes, 0);
    console.log(`  deleted ${cleared.length} — running total ${deleted}, ${fmtBytes(freed)} freed`);
  }

  console.log("\n" + "=".repeat(70));
  console.log(execute ? "DELETED" : "WOULD DELETE");
  console.log("=".repeat(70));
  console.log(`objects   ${deleted}`);
  console.log(`bytes     ${freed.toLocaleString()} (${fmtBytes(freed)})`);
  if (!execute) {
    console.log(
      `\nNothing was deleted. Re-run with --execute --i-have-verified once ` +
        `\`reencode-collages.ts verify --run-id ${runId}\` reports zero failures.`,
    );
  }
  return 0;
}

if (import.meta.main) {
  try {
    Deno.exit(await main());
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    Deno.exit(1);
  }
}
