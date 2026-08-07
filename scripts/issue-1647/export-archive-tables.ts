#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
//
// Issue #1647 — export the expired archive tables before they are dropped.
//
// WHAT IT DOES
// ------------
// Paginates every row of the three sanctioned archive tables out to NDJSON on
// disk, hashes each file, and records the result in
// `public.issue_1647_archive_export_manifest` via the service_role-only RPC.
// `public.issue_1647_drop_expired_archives()` REFUSES to drop a table with no
// manifest row whose recorded row count matches the live table, so running this
// is not a courtesy — it is the precondition.
//
// IT NEVER DROPS ANYTHING. The drop lives in a database RPC, deliberately not in
// this file, so no code path leads from exporting to deleting.
//
// TABLES (94,797,824 B = 90.4 MiB on production 2026-08-06):
//   _archive_orch_0700_doomed_columns  69,599 rows  35,291,136 B
//     retention_drop_date = 2026-06-02 on every row; elapsed 65 days ago.
//   _archive_card_pool                  8,861 rows  58,523,648 B
//   _archive_card_pool_stops            1,944 rows     983,040 B
//     ORCH-0640's 7-day post-cutover soak elapsed 102 days ago.
//
// STORAGE CAVEAT (from #1644's storage sweep, worth reading before the drop):
// `_archive_card_pool.image_url` / `.images` reference stored photos. If those
// rows are the only remaining reference to some object, dropping the table turns
// those objects into orphans — so any storage orphan sweep should run AFTER this
// drop, not before, or it will miss them. This export preserves the references
// either way, which is most of why it exists.
//
// ENV
//   SUPABASE_URL                e.g. https://gqnoajqerqhnvulmnyvv.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   service-role key
//
// USAGE
//   deno run --allow-net --allow-env --allow-read --allow-write \
//     scripts/issue-1647/export-archive-tables.ts --out ~/Desktop/issue-1647-archive-export
//
//   Add --dry-run to count and page WITHOUT writing files or touching the
//   manifest. Add --table <name> to do one table.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SANCTIONED = [
  "_archive_card_pool_stops",
  "_archive_card_pool",
  "_archive_orch_0700_doomed_columns",
] as const;

const PAGE = 500;

function arg(name: string): string | null {
  const i = Deno.args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < Deno.args.length ? Deno.args[i + 1] : null;
}
const DRY_RUN = Deno.args.includes("--dry-run");

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    console.error(`Missing ${name}`);
    Deno.exit(2);
  }
  return v;
}

async function sha256File(path: string): Promise<{ sha256: string; bytes: number }> {
  const data = await Deno.readFile(path);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const sha256 = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return { sha256, bytes: data.byteLength };
}

async function main() {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const outDir = arg("out") ?? "./issue-1647-archive-export";
  const only = arg("table");

  if (only && !(SANCTIONED as readonly string[]).includes(only)) {
    console.error(`--table must be one of: ${SANCTIONED.join(", ")}`);
    Deno.exit(2);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  if (!DRY_RUN) await Deno.mkdir(outDir, { recursive: true });

  let failures = 0;

  for (const table of SANCTIONED) {
    if (only && table !== only) continue;

    const { count, error: countErr } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    if (countErr) {
      // LOUD. A table we cannot count is a table we cannot honestly claim to
      // have exported, and the drop RPC will (correctly) refuse it later.
      console.error(`[${table}] could not count: ${countErr.message}`);
      failures += 1;
      continue;
    }
    const total = count ?? 0;
    const path = `${outDir}/${table}.ndjson`;
    console.log(`[${table}] ${total} rows -> ${DRY_RUN ? "(dry run)" : path}`);

    if (DRY_RUN) continue;

    const file = await Deno.open(path, { create: true, write: true, truncate: true });
    const encoder = new TextEncoder();
    let written = 0;
    try {
      // A header line so an empty table still produces a non-empty, self-
      // describing file — the RPC rejects a zero-byte "export".
      await file.write(encoder.encode(
        JSON.stringify({
          _issue: 1647,
          _table: table,
          _expected_rows: total,
          _exported_at: new Date().toISOString(),
          _source: url,
        }) + "\n",
      ));

      for (let from = 0; from < Math.max(total, 1); from += PAGE) {
        const { data, error } = await supabase
          .from(table)
          .select("*")
          .range(from, from + PAGE - 1);
        if (error) throw new Error(`page ${from}: ${error.message}`);
        for (const row of data ?? []) {
          await file.write(encoder.encode(JSON.stringify(row) + "\n"));
          written += 1;
        }
        if ((data ?? []).length === 0) break;
      }
    } catch (e) {
      console.error(`[${table}] export FAILED: ${e instanceof Error ? e.message : String(e)}`);
      failures += 1;
      file.close();
      continue;
    }
    file.close();

    if (written !== total) {
      // Never record a partial export. The whole point of the manifest is that
      // it cannot lie about what is on disk.
      console.error(`[${table}] wrote ${written} rows but expected ${total} — NOT recording`);
      failures += 1;
      continue;
    }

    const { sha256, bytes } = await sha256File(path);
    const { data: rec, error: recErr } = await supabase.rpc("issue_1647_record_archive_export", {
      p_table: table,
      p_row_count: written,
      p_byte_count: bytes,
      p_sha256: sha256,
      p_destination: await Deno.realPath(path),
    });
    if (recErr) {
      console.error(`[${table}] manifest write FAILED: ${recErr.message}`);
      failures += 1;
      continue;
    }
    console.log(`[${table}] recorded ${JSON.stringify(rec)}  sha256=${sha256}  bytes=${bytes}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} table(s) did not export cleanly. The drop RPC will refuse them.`);
    Deno.exit(1);
  }
  console.log(
    DRY_RUN
      ? "\nDry run complete — nothing written, nothing recorded."
      : "\nExport complete. Next: SELECT public.issue_1647_drop_expired_archives(true);  -- dry run",
  );
}

if (import.meta.main) await main();
