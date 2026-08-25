/**
 * #2587 — a disposable PostgreSQL boundary for the share-capture gate proof.
 *
 * WHY THIS EXISTS. The claim under test is not "the mapper returns the right
 * object". It is "the payload that ends up STORED carries no withheld
 * location". That claim only means something if three things are real:
 *
 *   1. the privacy verdict is produced by the deployed SQL predicate,
 *   2. the row is written by the real mint RPC, with its real CHECK
 *      constraints and its real immutability trigger, and
 *   3. the assertion reads the row back out of the table.
 *
 * So this helper stands up a real PostgreSQL database and loads the relevant
 * SQL objects VERBATIM out of the migration files. `assertVerbatim` pins that
 * extraction: if either migration is edited, the extraction stops matching and
 * the suite goes red rather than quietly testing a stale copy.
 *
 * WHAT IS FIXTURE AND WHAT IS REAL — stated plainly so nobody over-reads it:
 *   REAL (verbatim from migrations): the address-privacy predicate, the
 *     content-share link/version tables with every CHECK, the immutability
 *     trigger, and the mint RPC including its fingerprint arithmetic.
 *   FIXTURE (declared here): the offering tables the mapper reads. They carry
 *     the columns the share path selects and nothing else. They are inputs to
 *     the code under test, never the thing being asserted.
 *
 * Connection: honours PGHOST/PGPORT/PGUSER/PGPASSWORD when they are set (CI
 * runs beside a postgres service). Otherwise it initialises and starts its own
 * cluster in a temp directory and tears the whole thing down afterwards. It
 * never touches a server or container it did not create, and it always works
 * inside its own freshly created database.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const bin = (name) => {
  const explicit = process.env.PG_BINDIR ? path.join(process.env.PG_BINDIR, name) : null;
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const dir of ["/opt/homebrew/opt/postgresql@17/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/16/bin"]) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return name;
};

/** Dollar-quotes a JS value into a SQL literal with a tag proven absent from the payload. */
export const lit = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const tag = `q${crypto.randomBytes(6).toString("hex")}`;
    if (!text.includes(`$${tag}$`)) return `$${tag}$${text}$${tag}$`;
  }
  throw new Error("could not choose a dollar-quote tag");
};

/**
 * Extracts a contiguous block out of a migration file and pins it.
 * The returned text is byte-identical to the committed migration.
 */
export function extractVerbatim(relativePath, startsWith, endsWith) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  const start = source.indexOf(startsWith);
  if (start < 0) throw new Error(`#2587 fixture: '${startsWith}' is no longer in ${relativePath}`);
  const end = source.indexOf(endsWith, start);
  if (end < 0) throw new Error(`#2587 fixture: '${endsWith}' is no longer in ${relativePath}`);
  const block = source.slice(start, end + endsWith.length);
  if (!source.includes(block)) throw new Error("#2587 fixture: extraction is not a substring of the migration");
  return block;
}

class Cluster {
  constructor() { this.owned = false; this.dir = null; this.conn = null; this.database = null; }

  start() {
    if (process.env.PGHOST) {
      this.conn = {
        host: process.env.PGHOST,
        port: process.env.PGPORT || "5432",
        user: process.env.PGUSER || "postgres",
        password: process.env.PGPASSWORD || "",
      };
      return;
    }
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "issue2587-pg-"));
    this.owned = true;
    const data = path.join(this.dir, "data");
    const socket = path.join(this.dir, "sock");
    fs.mkdirSync(socket);
    const env = { ...process.env, LC_ALL: "C", LANG: "C" };
    execFileSync(bin("initdb"), ["-D", data, "-U", "postgres", "-A", "trust"], { stdio: "ignore", env });
    execFileSync(bin("pg_ctl"), ["-D", data, "-o", `-k ${socket} -h ''`, "-l", path.join(this.dir, "pg.log"), "-w", "start"], { stdio: "ignore", env });
    this.conn = { host: socket, port: "5432", user: "postgres", password: "" };
  }

  psql(sql, database) {
    const file = path.join(os.tmpdir(), `issue2587-${crypto.randomBytes(8).toString("hex")}.sql`);
    fs.writeFileSync(file, sql);
    try {
      return execFileSync(bin("psql"), [
        "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1",
        "-h", this.conn.host, "-p", this.conn.port, "-U", this.conn.user,
        "-d", database || this.database || "postgres", "-f", file,
      ], { encoding: "utf8", env: { ...process.env, PGPASSWORD: this.conn.password, LC_ALL: "C", LANG: "C" } });
    } finally { fs.rmSync(file, { force: true }); }
  }

  stop() {
    if (this.database) {
      try { this.psql(`DROP DATABASE IF EXISTS ${this.database} WITH (FORCE);`, "postgres"); } catch { /* teardown is best-effort */ }
      this.database = null;
    }
    if (!this.owned || !this.dir) return;
    try { execFileSync(bin("pg_ctl"), ["-D", path.join(this.dir, "data"), "-m", "immediate", "-w", "stop"], { stdio: "ignore", env: { ...process.env, LC_ALL: "C" } }); } catch { /* already gone */ }
    fs.rmSync(this.dir, { recursive: true, force: true });
    this.dir = null;
  }
}

/**
 * The offering tables the share path reads. Fixture DDL, deliberately narrow:
 * exactly the columns `loadAuthoritativeContentShare` selects. `theme` is here
 * because it is the predicate's argument, and for no other reason.
 */
const FIXTURE_OFFERING_DDL = `
CREATE TABLE public.brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, slug text NOT NULL UNIQUE, deleted_at timestamptz NULL
);
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id),
  title text NOT NULL, description text NULL, slug text NOT NULL,
  location_text text NULL, destination_text text NULL,
  theme jsonb NULL,
  status text NOT NULL, visibility text NOT NULL,
  published_at timestamptz NULL, deleted_at timestamptz NULL,
  timezone text NULL, event_type text NOT NULL,
  cover_media_url text NULL, cover_media_type text NULL, cover_media_poster_url text NULL,
  cover_media_alt text NULL, cover_media_gallery jsonb NULL,
  is_multi_date boolean NOT NULL DEFAULT false,
  rsvp_capacity integer NULL, rsvp_waitlist_enabled boolean NULL, rsvp_approval_mode text NULL,
  bookings_closed boolean NULL, booking_deadline timestamptz NULL
);
CREATE TABLE public.event_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id),
  start_at timestamptz NOT NULL, end_at timestamptz NULL,
  timezone text NULL, is_master boolean NOT NULL DEFAULT true
);
CREATE TABLE public.ticket_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id),
  price_cents integer NULL, currency text NULL, is_free boolean NULL,
  is_hidden boolean NULL, is_disabled boolean NULL, available_online boolean NULL,
  is_unlimited boolean NULL, sale_start_at timestamptz NULL, sale_end_at timestamptz NULL,
  display_order integer NULL, deleted_at timestamptz NULL
);
CREATE TABLE public.event_rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id),
  plus_count integer NULL, rsvp_status text NULL, approval_status text NULL
);

-- Fixture stubs for the two privileged inventory RPCs. Inventory is orthogonal
-- to the location gate; these exist so the real code path's reads still land in
-- the database rather than being intercepted in JavaScript.
CREATE FUNCTION public.pg_privileged_ticket_types_remaining(p_event_id uuid)
RETURNS TABLE(ticket_type_id uuid, remaining integer)
LANGUAGE sql STABLE AS $fixture$ SELECT NULL::uuid, NULL::integer WHERE false $fixture$;
CREATE FUNCTION public.pg_privileged_event_tier_allin(p_event_id uuid)
RETURNS TABLE(ticket_type_id uuid, all_in_cents integer, currency text)
LANGUAGE sql STABLE AS $fixture$ SELECT NULL::uuid, NULL::integer, NULL::text WHERE false $fixture$;
`;

/** The verbatim blocks this fixture depends on, and where they come from. */
export const VERBATIM_SOURCES = {
  predicate: {
    file: "supabase/migrations/20270523002489_issue_2489_address_privacy_server_gate.sql",
    startsWith: "CREATE OR REPLACE FUNCTION public.issue_2489_address_withheld(p_theme jsonb)",
    endsWith: "$function$;",
  },
  shareStorage: {
    file: "supabase/migrations/20270226001615_issue_1615_content_share_links.sql",
    startsWith: "CREATE OR REPLACE FUNCTION public.content_share_random_code()",
    endsWith: "GRANT EXECUTE ON FUNCTION public.upsert_content_share_version(text,uuid,text,jsonb,jsonb,jsonb,jsonb,jsonb)\n  TO service_role;",
  },
};

export async function startFixtureDatabase() {
  const cluster = new Cluster();
  cluster.start();
  const database = `issue_2587_${crypto.randomBytes(6).toString("hex")}`;
  cluster.psql(`CREATE DATABASE ${database};`, "postgres");
  cluster.database = database;

  const predicate = extractVerbatim(VERBATIM_SOURCES.predicate.file, VERBATIM_SOURCES.predicate.startsWith, VERBATIM_SOURCES.predicate.endsWith);
  const shareStorage = extractVerbatim(VERBATIM_SOURCES.shareStorage.file, VERBATIM_SOURCES.shareStorage.startsWith, VERBATIM_SOURCES.shareStorage.endsWith);

  cluster.psql(`
DO $roles$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $roles$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE TABLE IF NOT EXISTS public.profiles (id uuid PRIMARY KEY, referral_code text NULL);
${FIXTURE_OFFERING_DDL}
${predicate}
${shareStorage}
`);

  return {
    verbatim: { predicate, shareStorage },
    /** Runs a SELECT and returns its rows as plain objects. */
    rows(sql) {
      const out = cluster.psql(`SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)::text FROM (${sql}) t;`).trim();
      return JSON.parse(out || "[]");
    },
    /** Runs a scalar SELECT and returns its single JSON value. */
    scalar(sql) {
      const out = cluster.psql(`SELECT coalesce(to_json(x), 'null'::json)::text FROM (SELECT (${sql}) AS x) s;`).trim();
      return JSON.parse(out || "null");
    },
    exec(sql) { cluster.psql(sql); },
    stop() { cluster.stop(); },
  };
}
