#!/usr/bin/env node
/*
 * #4453 PR 2 (booking lock) — READ-ONLY scan of every button Studio has
 * stored, so Seth sees how many sites the lock will stop at their next
 * publish before it merges.
 *
 * Reads the Sites CMS database (SITES_CMS_DATABASE_URL) in a read-only
 * session: every action field of every page block (saved pages and their
 * latest draft versions) and every header button with an outside address.
 * Each value is judged by the contracts' own `actionHrefProblem` with the
 * button's intent (booking when the field always books, the block is an
 * offering or booking block, or the button's label reads as booking or
 * paying; informational otherwise, so maps, socials, site files and WhatsApp
 * pass) and no brand scope (Studio does not hold brand slugs). A link to
 * ANOTHER brand's Mingla page, or a WhatsApp/mailto/tel that is not the
 * brand's own, is only caught at publish, where Core names the brand.
 *
 * Prints counts per site and one line per failing button: site id, page
 * slug, block, field, problem and the link's host only (never the full link
 * or any visitor data). Writes nothing anywhere.
 *
 *   SITES_CMS_DATABASE_URL=postgres://… node scripts/sites/scan-outbound-action-links.mjs
 */
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { BLOCK_CATALOG, BOOKING_BLOCK_TYPES } from "../../packages/site-contracts/src/blocks.ts";
import { actionHrefProblem, offersBookingOrPayment } from "../../packages/site-contracts/src/safety.ts";
import { postgresEnvFromUrl } from "./lib/sites-ops.mjs";

const IDENT_RE = /^[a-z][a-z0-9_]*$/;

/**
 * Every stored action field, from the block catalogue:
 * [blockType, list | null, column, labelColumn | null, alwaysBooking].
 */
export function actionColumns(catalog = BLOCK_CATALOG) {
  const out = [];
  const entry = (type, list, column, spec) =>
    [type, list, column, spec.labelField ?? null, Boolean(spec.booking) || BOOKING_BLOCK_TYPES.includes(type)];
  for (const [type, spec] of Object.entries(catalog)) {
    for (const [field, fieldSpec] of Object.entries(spec.fields)) {
      if (fieldSpec.kind === "action_href") out.push(entry(type, null, field, fieldSpec));
      if (fieldSpec.kind === "list") {
        for (const [inner, innerSpec] of Object.entries(fieldSpec.item)) {
          if (innerSpec.kind === "action_href") out.push(entry(type, field, inner, innerSpec));
        }
      }
    }
  }
  for (const parts of out) {
    if (!parts.slice(0, 4).every((part) => part === null || IDENT_RE.test(part))) throw new Error("SCAN_IDENTIFIER_INVALID");
  }
  return out;
}

/** One read-only query returning [{site_id, page, block, field, href, label, booking}] as JSON. */
export function scanSql(columns = actionColumns()) {
  const selects = [];
  for (const [type, list, column, labelColumn, booking] of columns) {
    const field = list ? `${list}[].${column}` : column;
    for (const [pages, prefix, slug, tenant, parentOf] of [
      ["sites_cms.pages", "sites_cms.pages_blocks_", "p.slug", "p.tenant_id", "b._parent_id"],
      ["sites_cms._pages_v", "sites_cms._pages_v_blocks_", "p.version_slug", "p.version_tenant_id", "b._parent_id"],
    ]) {
      const latest = pages.endsWith("_v") ? " AND p.latest IS TRUE" : "";
      const blockTable = `${prefix}${type}`;
      const from = list
        ? `${blockTable}_${list} l JOIN ${blockTable} b ON b.id = l._parent_id`
        : `${blockTable} b`;
      const value = list ? `l.${column}` : `b.${column}`;
      const label = labelColumn ? `${list ? "l" : "b"}.${labelColumn}::text` : "NULL::text";
      selects.push(
        `SELECT t.core_site_id::text AS site_id, ${slug}::text AS page, '${type}' AS block, '${field}' AS field, ${value}::text AS href, ` +
          `${label} AS label, ${booking ? "TRUE" : "FALSE"} AS booking ` +
          `FROM ${from} JOIN ${pages} p ON p.id = ${parentOf} JOIN sites_cms.tenants t ON t.id = ${tenant} ` +
          `WHERE ${value} IS NOT NULL AND ${value} <> ''${latest}`,
      );
    }
  }
  selects.push(
    "SELECT t.core_site_id::text, NULL, 'header', 'header_cta.url', n.header_cta_url::text, n.header_cta_label::text, TRUE FROM sites_cms.navigation n " +
      "JOIN sites_cms.tenants t ON t.id = n.tenant_id WHERE n.header_cta_target_type = 'url' AND n.header_cta_url IS NOT NULL AND n.header_cta_url <> ''",
  );
  return `SELECT COALESCE(json_agg(row_to_json(s)), '[]'::json) FROM (\n${selects.join("\nUNION\n")}\n) s;`;
}

function hostOf(href) {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.hostname : url.protocol;
  } catch {
    return "(not a link)";
  }
}

/** The failing buttons among stored rows, and counts per site. */
export function judgeRows(rows) {
  const failing = [];
  const perSite = new Map();
  for (const row of rows) {
    const intent = row.booking === true || offersBookingOrPayment(row.label) ? "booking" : "informational";
    const problem = actionHrefProblem(row.href, null, intent);
    if (!problem) continue;
    failing.push({ site_id: row.site_id, page: row.page, block: row.block, field: row.field, intent, problem, host: hostOf(row.href) });
    perSite.set(row.site_id, (perSite.get(row.site_id) ?? 0) + 1);
  }
  return { scanned: rows.length, failing, perSite: Object.fromEntries([...perSite].sort()) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pgEnv = postgresEnvFromUrl(process.env.SITES_CMS_DATABASE_URL ?? "");
  const result = spawnSync(
    "psql",
    ["-X", "--no-psqlrc", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--command", scanSql()],
    {
      encoding: "utf8",
      env: {
        ...pgEnv,
        PGAPPNAME: "mingla-sites-outbound-action-scan-v1",
        PGCONNECT_TIMEOUT: "15",
        // Read-only session: any write would fail.
        PGOPTIONS: "-c default_transaction_read_only=on",
      },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    process.stderr.write("OUTBOUND_ACTION_SCAN code=UNAVAILABLE\n");
    process.exit(1);
  }
  const { scanned, failing, perSite } = judgeRows(JSON.parse(String(result.stdout).trim() || "[]"));
  process.stdout.write(`OUTBOUND_ACTION_SCAN scanned=${scanned} failing=${failing.length} sites=${Object.keys(perSite).length}\n`);
  for (const [site, count] of Object.entries(perSite)) process.stdout.write(`site ${site} failing=${count}\n`);
  for (const row of failing) {
    process.stdout.write(`  ${row.site_id} /${row.page ?? "(header)"} ${row.block}.${row.field} ${row.intent} ${row.problem} host=${row.host}\n`);
  }
}
