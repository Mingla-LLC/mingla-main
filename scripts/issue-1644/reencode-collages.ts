#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
//
// Issue #1644 — Stage 2: the collage re-encode WORKER.
//
// WHAT IT DOES
// ------------
// Re-encodes the 34,024 stored `place-collages` PNGs (33.35 GiB) to WebP q80 at
// the same 768x768, compositing each one onto OPAQUE BLACK first so the
// transparent-red fill bug is corrected rather than baked into the new format.
// Reclaims ~30 GiB without deleting a single asset — the precondition for the next
// city launch, because the Stage 0 guardrail refuses backfills above 85 GiB and we
// currently sit at 78.21 GiB (92% of the ceiling).
//
// IT NEVER DELETES ANYTHING. Removing the superseded PNGs is a SEPARATE, SEPARATELY
// APPROVED script — `scripts/issue-1644/delete-superseded-pngs.ts` — deliberately
// in a different file so no code path leads from writing to deleting.
//
// ORDERING CONTRACT, per object, non-negotiable:
//   1. write   the .webp
//   2. verify  it exists, is non-zero, is fetchable, is served as image/webp, and
//              DECODES with zero transparent pixels
//   3. commit  place_pool.photo_collage_url (+ the trial-run history), via an RPC
//              that can only rewrite .png -> .webp for the SAME place and the SAME
//              fingerprint
//   4. (separate script, separate approval) delete the .png, from the manifest only
//
// WHY WE DECODE AND ENCODE OURSELVES
// ----------------------------------
// Supabase's image-transformation endpoint is OFF-LIMITS: the spend cap is ARMED
// (COMMS-0133) and Pro includes only 100 origin images per MONTH; routing 34,024
// objects through it would trigger an org-wide Fair-Use restriction that can put
// the database into read-only mode.
//
// COMMANDS
// --------
//   plan    --run-id <uuid> [--limit N] --execute
//           Populate the manifest from storage.objects (needs the migration).
//
//   run     --run-id <uuid> [--limit N] [--concurrency N] [--rate-limit-ms N]
//           DRY RUN BY DEFAULT. Downloads, re-encodes and measures real objects
//           and WRITES NOTHING — not to storage, not to the database, not to the
//           manifest. Needs no migration: it enumerates straight from place_pool.
//           Add --execute to actually write, verify and commit (needs the manifest).
//
//   verify  --run-id <uuid>
//           Re-prove every committed row before anyone is allowed to delete: the
//           .webp is fetchable, correctly typed, non-zero and decodes clean, and
//           place_pool points at it. This is the gate the delete script requires.
//
//   status  [--run-id <uuid>]
//           Manifest roll-up.
//
// ENV
//   SUPABASE_URL                e.g. https://gqnoajqerqhnvulmnyvv.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   service-role key
//
// EXAMPLES
//   # 200-object pilot, measured, writes nothing:
//   deno run --allow-net --allow-env --allow-read --allow-write \
//     scripts/issue-1644/reencode-collages.ts run --run-id $(uuidgen) --limit 200

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  COLLAGE_BUCKET,
  COLLAGE_CACHE_CONTROL_SECONDS,
  countTransparentPixels,
  decodeWebpToRgba,
  pngKeyToWebpKey,
  reencodeCollagePngToWebp,
  WEBP_CONTENT_TYPE,
  WEBP_QUALITY,
} from "./collageReencode.ts";
import { checkStorageHeadroom } from "../../supabase/functions/_shared/storageHeadroomGuard.ts";

// ── Tunables ────────────────────────────────────────────────────────────────
// Deliberately conservative. This job runs against the same Storage and the same
// database that real users are on; finishing a one-time migration six hours
// sooner is worth nothing if it degrades the app while it runs.
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 8;
const DEFAULT_RATE_LIMIT_MS = 250; // minimum gap between two object STARTS
const DEFAULT_CLAIM_BATCH = 25;
const MAX_CLAIM_BATCH = 200; // the claim RPC hard-caps at 500
const FETCH_TIMEOUT_MS = 30_000;

interface Job {
  id: string | null; // null in dry-run (no manifest row)
  place_pool_id: string;
  old_key: string;
  new_key: string;
  old_bytes: number | null;
}

interface ObjectOutcome {
  job: Job;
  ok: boolean;
  oldBytes: number;
  newBytes: number;
  transparentBefore: number;
  transparentAfter: number;
  totalPixels: number;
  width: number;
  height: number;
  error?: string;
  skipped?: string;
}

// ── CLI plumbing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string | boolean> } {
  const cmd = argv[0] ?? "";
  const flags: Record<string, string | boolean> = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      flags[a.slice(2)] = argv[++i];
    } else {
      flags[a.slice(2)] = true;
    }
  }
  return { cmd, flags };
}

function num(flags: Record<string, string | boolean>, name: string, dflt: number): number {
  const raw = flags[name];
  if (raw === undefined) return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number, got ${String(raw)}`);
  return n;
}

function fmtBytes(b: number): string {
  if (Math.abs(b) >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(2)} GiB`;
  if (Math.abs(b) >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(2)} MiB`;
  if (Math.abs(b) >= 1024) return `${(b / 1024).toFixed(2)} KiB`;
  return `${b} B`;
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    throw new Error(
      `${name} is required. This tool talks to production Storage and the production ` +
        `database; it will not guess a target.`,
    );
  }
  return v;
}

function client(): { db: SupabaseClient; url: string } {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return { db: createClient(url, key, { auth: { persistSession: false } }), url };
}

function publicUrlFor(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${COLLAGE_BUCKET}/${key}`;
}

/** The object key a `.../place-collages/<key>` URL points at, or null. */
export function collageKeyFromUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const marker = `/storage/v1/object/public/${COLLAGE_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  const key = url.slice(idx + marker.length).split("?")[0];
  return key.length > 0 ? key : null;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Paced worker pool. `rateLimitMs` is a floor on the gap between two object
 * STARTS across the WHOLE pool (not per worker), so raising concurrency cannot
 * accidentally multiply the request rate — which is the usual way a "rate limit"
 * turns out not to be one.
 */
async function runPaced<T, R>(
  items: T[],
  concurrency: number,
  rateLimitMs: number,
  fn: (item: T, index: number) => Promise<R>,
  onResult?: (r: R, index: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let nextAllowedStart = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;

      const now = Date.now();
      const startAt = Math.max(now, nextAllowedStart);
      nextAllowedStart = startAt + rateLimitMs;
      if (startAt > now) await new Promise((r) => setTimeout(r, startAt - now));

      const r = await fn(items[i], i);
      results[i] = r;
      onResult?.(r, i);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => worker()),
  );
  return results;
}

// ── The per-object pipeline ─────────────────────────────────────────────────

/**
 * Download, decode, flatten onto opaque black, and encode. Shared by the dry run
 * and the live run so the measured numbers come from EXACTLY the code path that
 * will write — a dry run through a different code path measures nothing useful.
 */
async function reencodeOne(baseUrl: string, job: Job): Promise<{
  webpBytes: Uint8Array;
  oldBytes: number;
  newBytes: number;
  transparentBefore: number;
  transparentAfter: number;
  totalPixels: number;
  width: number;
  height: number;
}> {
  const res = await fetchWithTimeout(publicUrlFor(baseUrl, job.old_key));
  if (!res.ok) throw new Error(`source_fetch_failed_${res.status}`);
  const png = new Uint8Array(await res.arrayBuffer());
  if (png.length === 0) throw new Error("source_is_zero_bytes");

  const r = await reencodeCollagePngToWebp(png, { quality: WEBP_QUALITY });
  return {
    webpBytes: r.webpBytes,
    oldBytes: png.length,
    newBytes: r.webpByteLength,
    transparentBefore: r.transparentPixelsBefore,
    transparentAfter: r.transparentPixelsAfter,
    totalPixels: r.totalPixels,
    width: r.width,
    height: r.height,
  };
}

/**
 * Prove a written object is real and correct BEFORE any live URL moves.
 *
 * Deliberately re-fetches over HTTP rather than trusting the upload's response:
 * what matters is what the CDN serves to Gemini and to the admin console, not
 * what the storage API said it accepted. And it DECODES the served bytes to
 * assert zero transparent pixels — otherwise the whole point of Stage 2 rests on
 * an unchecked assumption at exactly the moment it becomes irreversible.
 */
async function verifyWritten(
  baseUrl: string,
  key: string,
  expectBytes: number | null,
): Promise<{ ok: true; bytes: number } | { ok: false; reason: string }> {
  let res: Response;
  try {
    res = await fetchWithTimeout(publicUrlFor(baseUrl, key));
  } catch (err) {
    return { ok: false, reason: `fetch_threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };

  const ct = res.headers.get("content-type") ?? "";
  if (!ct.startsWith(WEBP_CONTENT_TYPE)) {
    // Gemini takes its mime straight from this header
    // (run-place-intelligence-trial/index.ts fetchAsBase64), so a wrong
    // content-type is a functional break, not a cosmetic one.
    return { ok: false, reason: `content_type_is_${ct || "(absent)"}` };
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0) return { ok: false, reason: "served_zero_bytes" };
  if (expectBytes !== null && bytes.length !== expectBytes) {
    return { ok: false, reason: `served_${bytes.length}_bytes_expected_${expectBytes}` };
  }

  try {
    const decoded = await decodeWebpToRgba(bytes);
    const transparent = countTransparentPixels(decoded.data);
    if (transparent !== 0) {
      return {
        ok: false,
        reason: `served_object_still_has_${transparent}_transparent_pixels`,
      };
    }
  } catch (err) {
    return { ok: false, reason: `decode_failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  return { ok: true, bytes: bytes.length };
}

// ── Enumeration ─────────────────────────────────────────────────────────────

/**
 * Dry-run enumeration, straight from `place_pool` over PostgREST.
 *
 * This is why the dry run needs NO migration and writes NOTHING: the object set
 * is defined by "the pool points at a .png in place-collages", which is exactly
 * the plan RPC's predicate, and it is readable without touching storage.objects.
 *
 * Ordered by `id`. A UUID ordering is uncorrelated with image content, so the
 * first N rows are an unbiased sample AND a reproducible one — whereas the live
 * run's largest-first ordering is deliberately biased (it banks the reclaim
 * soonest) and would overstate or understate the average saving.
 */
async function enumerateFromPool(db: SupabaseClient, limit: number): Promise<Job[]> {
  const jobs: Job[] = [];
  const page = 1000;
  let offset = 0;

  while (jobs.length < limit) {
    const { data, error } = await db
      .from("place_pool")
      .select("id, photo_collage_url")
      .not("photo_collage_url", "is", null)
      .like("photo_collage_url", "%.png")
      .order("id", { ascending: true })
      .range(offset, offset + page - 1);
    if (error) throw new Error(`place_pool read failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data as Array<{ id: string; photo_collage_url: string }>) {
      const key = collageKeyFromUrl(row.photo_collage_url);
      if (!key) continue;
      let newKey: string;
      try {
        newKey = pngKeyToWebpKey(key);
      } catch {
        // A key that does not match `<place-uuid>/<12-hex>.png` is not something
        // this tool will guess at. Report it rather than converting it.
        console.warn(`[skip] unrecognised collage key shape: ${key}`);
        continue;
      }
      if (key.split("/")[0] !== row.id) {
        console.warn(`[skip] key ${key} does not belong to place ${row.id}`);
        continue;
      }
      jobs.push({ id: null, place_pool_id: row.id, old_key: key, new_key: newKey, old_bytes: null });
      if (jobs.length >= limit) break;
    }

    if (data.length < page) break;
    offset += page;
  }
  return jobs;
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdPlan(flags: Record<string, string | boolean>): Promise<number> {
  const runId = String(flags["run-id"] ?? "");
  if (!runId) throw new Error("--run-id is required (it is how a pilot is kept separate from the full run)");
  const limit = flags["limit"] === undefined ? null : num(flags, "limit", 0);

  if (!flags["execute"]) {
    console.log(
      "plan is a WRITE (it populates the manifest table). Re-run with --execute.\n" +
        "If you only want measurements, use `run` — it is dry by default and needs no manifest.",
    );
    return 2;
  }

  const { db } = client();
  const { data, error } = await db.rpc("issue_1644_collage_reencode_plan", {
    p_run_id: runId,
    p_limit: limit,
  });
  if (error) throw new Error(`plan RPC failed: ${error.message}`);
  console.log(`planned ${data} new job(s) into run ${runId}`);
  await printStats(db, runId);
  return 0;
}

async function printStats(db: SupabaseClient, runId: string | null): Promise<void> {
  const { data, error } = await db.rpc("issue_1644_collage_reencode_stats", { p_run_id: runId });
  if (error) throw new Error(`stats RPC failed: ${error.message}`);
  const s = data as Record<string, unknown>;
  console.log(
    `  jobs=${s.jobs}  old=${fmtBytes(Number(s.old_bytes))}  new=${fmtBytes(Number(s.new_bytes))}  ` +
      `realised reclaim=${fmtBytes(Number(s.reclaimable_bytes))}`,
  );
  console.log(`  by status: ${JSON.stringify(s.by_status)}`);
}

async function cmdStatus(flags: Record<string, string | boolean>): Promise<number> {
  const { db } = client();
  const runId = flags["run-id"] ? String(flags["run-id"]) : null;
  await printStats(db, runId);
  return 0;
}

/**
 * Dry-run enumeration from an explicit key list (`<place-uuid>/<12-hex>.png`,
 * one per line, `#` comments allowed).
 *
 * Why this exists: `place-collages` is a PUBLIC bucket, so a measurement pass
 * needs no credentials at all when the keys are supplied. That makes the pilot
 * reproducible by anyone, keeps a service-role key out of a job whose only
 * purpose is to read public objects, and lets an operator pilot a hand-picked set
 * (e.g. the largest objects, or the ones a previous run failed on).
 */
function jobsFromKeyList(text: string, limit: number): Job[] {
  const jobs: Job[] = [];
  for (const raw of text.split("\n")) {
    const key = raw.trim();
    if (!key || key.startsWith("#")) continue;
    const newKey = pngKeyToWebpKey(key); // throws on anything unrecognised — deliberate
    jobs.push({ id: null, place_pool_id: key.split("/")[0], old_key: key, new_key: newKey, old_bytes: null });
    if (jobs.length >= limit) break;
  }
  return jobs;
}

async function cmdRun(flags: Record<string, string | boolean>): Promise<number> {
  const execute = flags["execute"] === true || flags["execute"] === "true";
  const runId = String(flags["run-id"] ?? "");
  if (!runId) throw new Error("--run-id is required");

  const limit = num(flags, "limit", 200);
  const concurrency = Math.max(1, Math.min(num(flags, "concurrency", DEFAULT_CONCURRENCY), MAX_CONCURRENCY));
  const rateLimitMs = Math.max(0, num(flags, "rate-limit-ms", DEFAULT_RATE_LIMIT_MS));
  const claimBatch = Math.max(1, Math.min(num(flags, "batch", DEFAULT_CLAIM_BATCH), MAX_CLAIM_BATCH));
  const manifestPath = flags["manifest"] ? String(flags["manifest"]) : null;
  const keysFile = flags["keys-file"] ? String(flags["keys-file"]) : null;

  if (keysFile && execute) {
    throw new Error(
      "--keys-file is a DRY-RUN input only. A live run must claim from the manifest so the " +
        "work is auditable, resumable and reversible.",
    );
  }

  // A credential-free dry run against the public bucket. `--keys-file` supplies
  // the object set, so nothing needs to read the database.
  const offline = Boolean(keysFile) && !execute;
  const storageBase = offline
    ? String(flags["storage-url"] ?? "https://gqnoajqerqhnvulmnyvv.supabase.co")
    : "";

  const { db, url } = offline
    ? { db: null as unknown as SupabaseClient, url: storageBase }
    : client();

  console.log(
    `# issue-1644 collage re-encode — ${execute ? "LIVE" : "DRY RUN (writes nothing)"}\n` +
      `#   run-id=${runId} limit=${limit} concurrency=${concurrency} rate-limit=${rateLimitMs}ms ` +
      `quality=q${WEBP_QUALITY} cache-control=${COLLAGE_CACHE_CONTROL_SECONDS}s`,
  );

  if (execute) {
    // PRE-FLIGHT 1 — the bucket must admit image/webp.
    //
    // Production shipped `place-collages` with
    // allowed_mime_types = {image/png, image/jpeg} while `place-photos` next door
    // already allowed image/webp. Supabase Storage validates the upload's
    // content-type against that list, so without this every single upload returns
    // `invalid_mime_type` — and it would have done so on object 1 of 34,024, after
    // the operator had committed to the run. Migration 20270221001644 adds the
    // allowance; this check makes a missing migration an immediate, explained
    // refusal rather than a wall of opaque 400s.
    const { data: mime, error: mimeErr } = await db.rpc("issue_1644_collage_bucket_accepts_webp");
    if (mimeErr) {
      console.error(
        `[#1644] could not check the place-collages MIME policy (${mimeErr.message}). ` +
          `Apply migration 20270221001644_issue_1644_collage_reencode_jobs.sql first.`,
      );
      return 1;
    }
    const m = mime as { accepts_webp?: boolean; allowed_mime_types?: unknown; reason?: string };
    if (!m?.accepts_webp) {
      console.error(
        `[#1644] REFUSING: the place-collages bucket does not accept image/webp uploads ` +
          `(allowed_mime_types=${JSON.stringify(m?.allowed_mime_types ?? m?.reason ?? null)}). ` +
          `Every upload would fail with invalid_mime_type. Apply migration ` +
          `20270221001644_issue_1644_collage_reencode_jobs.sql, or add image/webp in the Supabase ` +
          `dashboard (Storage -> place-collages -> Settings), then retry.`,
      );
      return 1;
    }

    // PRE-FLIGHT 2 — the same fail-closed guard the backfills use. This job is NET NEGATIVE on
    // storage, but it writes the .webp objects BEFORE anything is deleted, so it
    // temporarily adds ~10% of the corpus (~3 GiB). Refusing near the ceiling is
    // the correct behaviour: crossing it would make the intelligence pipeline and
    // both photo backfills start refusing too.
    const headroom = await checkStorageHeadroom(
      db as unknown as { rpc: (fn: string, p?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
      "issue-1644 collage re-encode",
    );
    if (!headroom.ok) {
      console.error(headroom.message);
      return 1;
    }
    console.log(
      `# storage headroom OK: ${fmtBytes(headroom.totalBytes)} of ${fmtBytes(headroom.thresholdBytes)}`,
    );
  }

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  let oldTotal = 0;
  let newTotal = 0;
  let transparentObjects = 0;
  let transparentPixelsCorrected = 0;
  const dims = new Map<string, number>();
  const manifestRows: string[] = [
    "old_key,new_key,old_bytes,new_bytes,saving_pct,transparent_before,transparent_after,width,height,status,error",
  ];

  const record = (o: ObjectOutcome) => {
    manifestRows.push(
      [
        o.job.old_key,
        o.job.new_key,
        o.oldBytes,
        o.newBytes,
        o.oldBytes > 0 ? (((o.oldBytes - o.newBytes) / o.oldBytes) * 100).toFixed(2) : "",
        o.transparentBefore,
        o.transparentAfter,
        o.width,
        o.height,
        o.skipped ? "skipped" : o.ok ? (execute ? "committed" : "dry-ok") : "failed",
        (o.error ?? o.skipped ?? "").replaceAll(",", ";"),
      ].join(","),
    );
    if (o.skipped) {
      skipped++;
      return;
    }
    if (!o.ok) {
      failed++;
      return;
    }
    processed++;
    oldTotal += o.oldBytes;
    newTotal += o.newBytes;
    if (o.transparentBefore > 0) {
      transparentObjects++;
      transparentPixelsCorrected += o.transparentBefore;
    }
    dims.set(`${o.width}x${o.height}`, (dims.get(`${o.width}x${o.height}`) ?? 0) + 1);
  };

  const processOne = async (job: Job): Promise<ObjectOutcome> => {
    const base: ObjectOutcome = {
      job,
      ok: false,
      oldBytes: job.old_bytes ?? 0,
      newBytes: 0,
      transparentBefore: 0,
      transparentAfter: 0,
      totalPixels: 0,
      width: 0,
      height: 0,
    };
    try {
      const r = await reencodeOne(url, job);
      Object.assign(base, {
        oldBytes: r.oldBytes,
        newBytes: r.newBytes,
        transparentBefore: r.transparentBefore,
        transparentAfter: r.transparentAfter,
        totalPixels: r.totalPixels,
        width: r.width,
        height: r.height,
      });

      if (!execute) {
        // DRY RUN ends here. Nothing has been written anywhere.
        base.ok = true;
        return base;
      }

      const { error: upErr } = await db.storage.from(COLLAGE_BUCKET).upload(job.new_key, r.webpBytes, {
        contentType: WEBP_CONTENT_TYPE,
        cacheControl: String(COLLAGE_CACHE_CONTROL_SECONDS),
        upsert: true,
      });
      if (upErr) throw new Error(`upload_failed: ${upErr.message}`);

      const v = await verifyWritten(url, job.new_key, r.newBytes);
      if (!v.ok) throw new Error(`verify_failed: ${v.reason}`);

      await db
        .from("place_collage_reencode_jobs")
        .update({
          status: "verified",
          new_bytes: r.newBytes,
          width: r.width,
          height: r.height,
          transparent_pixels_before: r.transparentBefore,
          encoded_at: new Date().toISOString(),
          verified_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", job.id!);

      const { data: commit, error: cErr } = await db.rpc("issue_1644_collage_reencode_commit", {
        p_job_id: job.id,
      });
      if (cErr) throw new Error(`commit_failed: ${cErr.message}`);
      const c = commit as Record<string, unknown>;
      if (c.status === "skipped") {
        base.skipped = String(c.reason ?? "skipped");
        return base;
      }
      base.ok = true;
      return base;
    } catch (err) {
      base.error = err instanceof Error ? err.message : String(err);
      if (execute && job.id) {
        await db
          .from("place_collage_reencode_jobs")
          .update({ status: "failed", error: base.error })
          .eq("id", job.id);
      }
      return base;
    }
  };

  const startedAt = Date.now();

  if (!execute) {
    const jobs = keysFile
      ? jobsFromKeyList(await Deno.readTextFile(keysFile), limit)
      : await enumerateFromPool(db, limit);
    console.log(
      keysFile
        ? `# ${jobs.length} collage(s) from ${keysFile} (credential-free read of the public bucket)`
        : `# enumerated ${jobs.length} collage(s) from place_pool (ordered by id — unbiased sample)`,
    );
    await runPaced(jobs, concurrency, rateLimitMs, processOne, (o, i) => {
      record(o);
      if ((i + 1) % 25 === 0 || i + 1 === jobs.length) {
        console.log(
          `  [${i + 1}/${jobs.length}] ok=${processed} failed=${failed} ` +
            `${fmtBytes(oldTotal)} -> ${fmtBytes(newTotal)}`,
        );
      }
    });
  } else {
    let remaining = limit;
    while (remaining > 0) {
      const take = Math.min(claimBatch, remaining);
      const { data, error } = await db.rpc("issue_1644_collage_reencode_claim", {
        p_run_id: runId,
        p_limit: take,
      });
      if (error) throw new Error(`claim RPC failed: ${error.message}`);
      const claimed = (data ?? []) as Job[];
      if (claimed.length === 0) {
        console.log("# no pending jobs left to claim");
        break;
      }
      await runPaced(claimed, concurrency, rateLimitMs, processOne, (o) => record(o));
      remaining -= claimed.length;
      console.log(
        `  progress: ok=${processed} skipped=${skipped} failed=${failed} ` +
          `${fmtBytes(oldTotal)} -> ${fmtBytes(newTotal)}`,
      );
    }
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  const savingPct = oldTotal > 0 ? ((oldTotal - newTotal) / oldTotal) * 100 : 0;

  console.log("\n" + "=".repeat(78));
  console.log(`RESULT — ${execute ? "LIVE" : "DRY RUN (nothing written)"}  run-id=${runId}`);
  console.log("=".repeat(78));
  console.log(`objects processed        ${processed}`);
  console.log(`objects skipped          ${skipped}`);
  console.log(`objects failed           ${failed}`);
  console.log(`bytes before             ${oldTotal.toLocaleString()}  (${fmtBytes(oldTotal)})`);
  console.log(`bytes after              ${newTotal.toLocaleString()}  (${fmtBytes(newTotal)})`);
  console.log(`bytes freed              ${(oldTotal - newTotal).toLocaleString()}  (${fmtBytes(oldTotal - newTotal)})`);
  console.log(`SAVING                   ${savingPct.toFixed(2)}%`);
  console.log(`mean object              ${fmtBytes(processed ? oldTotal / processed : 0)} -> ${fmtBytes(processed ? newTotal / processed : 0)}`);
  console.log(`dimensions seen          ${JSON.stringify(Object.fromEntries(dims))}`);
  console.log(
    `TRANSPARENCY CORRECTED   ${transparentObjects}/${processed} objects carried the fill bug; ` +
      `${transparentPixelsCorrected.toLocaleString()} transparent pixels flattened onto opaque black`,
  );
  console.log(`residual transparency    0 (every object is asserted to encode with zero alpha-0 pixels)`);
  console.log(`elapsed                  ${elapsed.toFixed(1)}s  (${(processed / Math.max(elapsed, 0.001)).toFixed(2)} obj/s)`);

  if (processed > 0) {
    const projected = 33.35 * (1 - savingPct / 100);
    console.log(
      `\nprojected over the full 34,024-object bucket at this rate: ` +
        `33.35 GiB -> ${projected.toFixed(2)} GiB (frees ~${(33.35 - projected).toFixed(2)} GiB)`,
    );
  }

  if (manifestPath) {
    await Deno.writeTextFile(manifestPath, manifestRows.join("\n") + "\n");
    console.log(`\nmanifest written to ${manifestPath}`);
  }

  return failed > 0 ? 1 : 0;
}

async function cmdVerify(flags: Record<string, string | boolean>): Promise<number> {
  const runId = String(flags["run-id"] ?? "");
  if (!runId) throw new Error("--run-id is required");
  const concurrency = Math.max(1, Math.min(num(flags, "concurrency", DEFAULT_CONCURRENCY), MAX_CONCURRENCY));
  const rateLimitMs = Math.max(0, num(flags, "rate-limit-ms", DEFAULT_RATE_LIMIT_MS));

  const { db, url } = client();

  const { data, error } = await db
    .from("place_collage_reencode_jobs")
    .select("id, place_pool_id, old_key, new_key, old_bytes, new_bytes")
    .eq("run_id", runId)
    .eq("status", "committed")
    .order("old_bytes", { ascending: false });
  if (error) throw new Error(`manifest read failed: ${error.message}`);

  const rows = (data ?? []) as Array<Job & { new_bytes: number | null }>;
  console.log(`# verifying ${rows.length} committed object(s) for run ${runId}`);

  let good = 0;
  const bad: string[] = [];

  await runPaced(rows, concurrency, rateLimitMs, async (row) => {
    const v = await verifyWritten(url, row.new_key, row.new_bytes);
    if (!v.ok) {
      bad.push(`${row.new_key}: ${v.reason}`);
      return;
    }
    // The replacement is real — now prove the live row actually points at it.
    const { data: pool } = await db
      .from("place_pool")
      .select("photo_collage_url")
      .eq("id", row.place_pool_id)
      .maybeSingle();
    const key = collageKeyFromUrl((pool as { photo_collage_url: string | null } | null)?.photo_collage_url);
    if (key !== row.new_key) {
      bad.push(`${row.new_key}: place_pool points at ${key ?? "(nothing)"}`);
      return;
    }
    good++;
  });

  console.log(`\nverified OK   ${good}/${rows.length}`);
  if (bad.length > 0) {
    console.error(`FAILED        ${bad.length}`);
    for (const b of bad.slice(0, 50)) console.error(`  ${b}`);
    console.error(
      "\nDO NOT RUN THE DELETE STEP. Every failure above is an object whose .png is still the " +
        "only working copy.",
    );
    return 1;
  }
  console.log(
    "\nAll committed replacements are live, correctly typed, non-zero and decode with zero " +
      "transparent pixels. The delete step's precondition is satisfied.",
  );
  return 0;
}

// ── main ────────────────────────────────────────────────────────────────────

const USAGE = `issue-1644 collage re-encode worker

  plan    --run-id <uuid> [--limit N] --execute
  run     --run-id <uuid> [--limit N] [--concurrency N] [--rate-limit-ms N]
          [--batch N] [--manifest out.csv] [--execute]
  verify  --run-id <uuid> [--concurrency N] [--rate-limit-ms N]
  status  [--run-id <uuid>]

\`run\` is a DRY RUN unless --execute is passed. Deleting the superseded PNGs is a
different script entirely: scripts/issue-1644/delete-superseded-pngs.ts
`;

if (import.meta.main) {
  const { cmd, flags } = parseArgs(Deno.args);
  let code = 0;
  try {
    switch (cmd) {
      case "plan":
        code = await cmdPlan(flags);
        break;
      case "run":
        code = await cmdRun(flags);
        break;
      case "verify":
        code = await cmdVerify(flags);
        break;
      case "status":
        code = await cmdStatus(flags);
        break;
      default:
        console.log(USAGE);
        code = cmd ? 1 : 0;
    }
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    code = 1;
  }
  Deno.exit(code);
}
