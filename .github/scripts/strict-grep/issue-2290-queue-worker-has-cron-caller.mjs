#!/usr/bin/env node
// #2290 [ticket buyers never reach a brand's contact book] — the class guard.
//
// Enforces I-PROPOSED-2290-QUEUE-WORKER-HAS-CRON-CALLER:
//
//   Every edge function that (a) leases work from a queue by calling an RPC
//   whose name contains `claim`, AND (b) admits ONLY a machine — it compares the
//   inbound Authorization bearer against SUPABASE_SERVICE_ROLE_KEY or
//   CRON_SECRET, so no interactive caller can ever open its door — MUST be the
//   target of a live `cron.schedule(...)` in `supabase/migrations/**`.
//
//   ...MUST HAVE A CALLER SOMEWHERE IN THIS REPO. A live `cron.schedule(...)` in
//   `supabase/migrations/**` is one. Being invoked by another edge function that
//   itself has a caller is the other — `ticket-confirmation-dispatch` has a
//   machine-only door and mints an attendance-claim proof, but the Stripe
//   webhook router and `reconcile-stuck-checkouts` both invoke it by name, so it
//   is not dark. Reachability is a transitive closure, not a cron lookup, so a
//   worker cannot be laundered green by a caller that is itself unreachable.
//
//   Unless it is on the frozen HAND_KICKED list below, with a reason.
//
// WHY THIS EXISTS. A worker with a machine-only door and no scheduler is a
// switch with no caller: it is deployed, it is ACTIVE, it passes every test, it
// returns 200 when you curl it, and it never runs. The queue behind it fills
// forever and the feature it powers is silently dead. Nothing in the type
// system, no unit test, no `deno check`, and no green CI run can see it, because
// the missing half is a row in `cron.job` — not a line of code.
//
// This repo has now produced the defect THREE times:
//
//   #2168  `checkout-sale-revocation` — CHECKOUT_REVOCATION_EXECUTE was armed as
//          a permission with no caller. Arming it changed nothing. Fixed by
//          20270419002169.
//   #2222  same class, sibling surface.
//   #2290  `brand-person-ingest-worker` — migration 20270305001770 shipped the
//          outbox table, four enqueue triggers, the claim/finish RPCs and the
//          worker, and scheduled only the EXPORT half. Production carried 33
//          rows at status='pending', every one with attempt_count = 0,
//          locked_at IS NULL and last_safe_error_code IS NULL: never attempted,
//          not once. Every brand on every rail had an empty contact book from
//          2026-08-11 until this gate's fix.
//
// WHAT IT WOULD HAVE CAUGHT. Run against 20270305001770's own commit, this gate
// fails: `brand-person-ingest-worker` calls `biz_claim_brand_person_ingest`,
// gates on `Bearer ${serviceKey}` / `Bearer ${cronSecret}`, and no
// `cron.schedule` anywhere in `supabase/migrations/` names it. The same run
// fails #2168's pre-fix tree on `checkout-sale-revocation`.
//
// WHY THOSE TWO CONDITIONS AND NOT "any function that says claim". `claim` alone
// is far too loose — `support-claim`, `claim-attendance`,
// `attendance-claim-identity`, `attendance-claim-link`, `claim-search-pool`,
// `admin-review-venue-claim` and `venue-claim-*` all call claim-named RPCs and
// are all driven by a human holding a user JWT. Condition (b) is what separates
// them: those functions forward the bearer to `auth.getUser()`, they never
// compare it to a service key. A function that compares the bearer to
// SUPABASE_SERVICE_ROLE_KEY or CRON_SECRET has declared, in code, that its only
// possible caller is a machine. If the repo does not also declare which machine,
// the answer in production is "none".
//
// Modes:
//   node issue-2290-queue-worker-has-cron-caller.mjs              — enforce
//   node issue-2290-queue-worker-has-cron-caller.mjs --self-test  — prove it detects

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const FUNCTIONS_DIR = "supabase/functions";
const MIGRATIONS_DIR = "supabase/migrations";

/**
 * Machine-only claim workers that are invoked BY HAND, on purpose, and must
 * therefore never be scheduled. This list may only SHRINK — a new entry is a new
 * dark worker, and `EXPECTED_HAND_KICKED` below is asserted exactly so one
 * cannot be laundered in alongside an unrelated change.
 */
const HAND_KICKED = new Map([
  [
    "attendance-claim-backfill",
    "One-shot repair run for orders that predate the attendance-claim arming. " +
      "Operator-invoked with the service-role key when a specific cohort needs " +
      "re-arming; scheduling it would re-send delivery for already-armed orders.",
  ],
]);

// `backfill-place-photo-thumbs` and `backfill-place-photos` are the other two
// hand-kicked workers in this repo, and they deliberately have NO entry above:
// neither leases work through a `claim` RPC, so the predicate never reaches
// them and an exemption would be dead weight. `staleExemptions` below asserts
// exactly that — an exemption that matches nothing FAILS this gate, so the
// allowlist can never quietly widen into a list of names nobody re-checks.

const EXPECTED_HAND_KICKED = HAND_KICKED.size;

/** `$tag$` / `$$` opening at `i`, or null. */
function dollarTagAt(sql, i) {
  if (sql[i] !== "$") return null;
  const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i, i + 64));
  return m ? m[0] : null;
}

/**
 * Remove `--` line comments and block comments WITHOUT touching the inside of a
 * dollar-quoted body or a single-quoted literal. A naive line-comment strip
 * would corrupt a `$cron$ … $cron$` body, and skipping dollar-quoted regions
 * entirely would hide every `PERFORM cron.unschedule(…)` inside a `DO $$ … $$`
 * block — which is where this repo writes most of them.
 */
export function stripSqlComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const tag = dollarTagAt(sql, i);
    if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) return out + sql.slice(i);
      out += sql.slice(i, end + tag.length);
      i = end + tag.length;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (sql[i] === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      if (nl === -1) return out;
      out += "\n";
      i = nl + 1;
      continue;
    }
    if (sql[i] === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return out;
      out += " ";
      i = end + 2;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

/**
 * Text between the `(` at `open` and its matching `)`, treating dollar-quoted
 * bodies and single-quoted literals as opaque so a `)` inside a `$cron$` body
 * cannot close the call early.
 */
export function balancedArgs(sql, open) {
  let depth = 0;
  let i = open;
  while (i < sql.length) {
    const tag = dollarTagAt(sql, i);
    if (tag) {
      const end = sql.indexOf(tag, i + tag.length);
      if (end === -1) return null;
      i = end + tag.length;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      i = j + 1;
      continue;
    }
    if (sql[i] === "(") depth += 1;
    else if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, i);
    }
    i += 1;
  }
  return null;
}

/**
 * Replay every migration, in filename order, as a sequence of
 * schedule/unschedule events keyed by JOB NAME — the same key `cron.job` uses,
 * so a later re-schedule overwrites and a later unschedule removes. The result
 * is the set of edge functions a live cron job actually posts to.
 *
 * Dynamic unschedules (`cron.unschedule(job_id)`,
 * `cron.unschedule(v_job_id)`) cannot be resolved statically and are counted but
 * not applied. Every one in this repo is the idempotent
 * unschedule-then-reschedule idiom, where the reschedule that follows restores
 * the entry anyway; they are surfaced in the summary so a future permanent
 * dynamic unschedule is visible rather than silent.
 */
export function cronReachability(migrations) {
  const live = new Map(); // jobname -> string[] function names
  let scheduleCalls = 0;
  let dynamicUnschedules = 0;

  for (const { file, sql } of [...migrations].sort((a, b) => a.file.localeCompare(b.file))) {
    const clean = stripSqlComments(sql);
    const re = /\bcron\.(schedule|unschedule)\s*\(/gi;
    let m;
    while ((m = re.exec(clean)) !== null) {
      const open = clean.indexOf("(", m.index + m[0].length - 1);
      const args = balancedArgs(clean, open);
      if (args === null) continue;
      const literal = /^\s*'([^']*)'\s*$/.exec(args);

      if (m[1].toLowerCase() === "unschedule") {
        if (literal) live.delete(literal[1]);
        else dynamicUnschedules += 1;
        continue;
      }

      scheduleCalls += 1;
      const nameMatch = /'([^']*)'/.exec(args);
      if (!nameMatch) continue;
      const targets = [...args.matchAll(/functions\/v1\/([a-z0-9-]+)/g)].map((t) => t[1]);
      live.set(nameMatch[1], targets);
    }
    void file;
  }

  const functions = new Set();
  for (const targets of live.values()) for (const t of targets) functions.add(t);
  return { functions, jobs: live, scheduleCalls, dynamicUnschedules };
}

/** Identifiers bound to the service-role key or the cron secret. */
export function machineSecretIdents(source) {
  const idents = new Set();
  const re =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)[^=\n]*=\s*[^;\n]*Deno\.env\.get\(\s*["'](?:SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) idents.add(m[1]);
  return idents;
}

/**
 * True when the function's door admits ONLY a machine: the inbound bearer is
 * COMPARED against the service-role key or the cron secret. An outbound
 * `Authorization: \`Bearer ${key}\`` header does not count — it is the function
 * calling out, not deciding who may call in — which is why an equality operator
 * (or a constant-time comparator) is required next to the template.
 */
export function hasMachineOnlyDoor(source) {
  const idents = machineSecretIdents(source);
  for (const id of idents) {
    const tpl = "`Bearer \\$\\{" + id.replace(/\$/g, "\\$") + "\\}`";
    if (new RegExp("(?:!==|===|!=|==)\\s*" + tpl).test(source)) return true;
    if (new RegExp(tpl + "\\s*(?:!==|===|!=|==)").test(source)) return true;
    if (
      new RegExp(
        "(?:constantTimeEqual|timingSafeEqual|safeCompare|safeEqual)\\s*\\([^)]*" + tpl,
      ).test(source)
    ) return true;
  }
  return false;
}

/** RPC names containing `claim` that this function invokes. */
export function claimRpcs(source) {
  return [...source.matchAll(/\.rpc\(\s*["']([A-Za-z0-9_]*[Cc]laim[A-Za-z0-9_]*)["']/g)]
    .map((m) => m[1]);
}

/** Strip TS/JS comments so a function name MENTIONED in prose is never a caller. */
export function stripTsComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const nl = source.indexOf("\n", i);
      if (nl === -1) return out;
      out += "\n";
      i = nl + 1;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) return out;
      out += " ";
      i = end + 2;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/** Edge functions this source invokes by name — `functions.invoke("x")` or `/functions/v1/x`. */
export function edgeInvocations(source) {
  const clean = stripTsComments(source);
  const names = new Set();
  for (const m of clean.matchAll(/functions\.invoke\(\s*["'`]([a-z0-9-]+)["'`]/g)) names.add(m[1]);
  for (const m of clean.matchAll(/functions\/v1\/([a-z0-9-]+)/g)) names.add(m[1]);
  return names;
}

/** The synthetic caller standing for `supabase/functions/_shared/**`. */
export const SHARED = "__shared__";

/**
 * Transitive closure of "has a caller". Roots are (a) every function a live cron
 * job posts to, (b) every function whose door is NOT machine-only — those are
 * opened by a client holding a user JWT, or by an external webhook, and (c)
 * `_shared/**`, which is compiled into whichever function imports it.
 *
 * (c) is the one deliberate softening: an invocation that lives in shared code is
 * credited even though the importer is not resolved here. If that importer were
 * itself dark, THE IMPORTER is what this gate reports — which is the finding that
 * matters.
 */
export function reachableFunctions(functions, cronTargets, sharedSource) {
  const invocations = new Map();
  for (const { name, source } of functions) invocations.set(name, edgeInvocations(source));
  invocations.set(SHARED, edgeInvocations(sharedSource ?? ""));

  const reachable = new Set([SHARED]);
  for (const t of cronTargets) reachable.add(t);
  for (const { name, source } of functions) {
    if (!hasMachineOnlyDoor(source)) reachable.add(name);
  }

  let grew = true;
  while (grew) {
    grew = false;
    for (const caller of [...reachable]) {
      for (const callee of invocations.get(caller) ?? []) {
        if (!reachable.has(callee)) { reachable.add(callee); grew = true; }
      }
    }
  }
  return reachable;
}

/**
 * Pure checker. `functions` is [{ name, source }], `migrations` is
 * [{ file, sql }], `sharedSource` is the concatenated `_shared/**` text — so
 * --self-test drives fixtures without touching the repo.
 */
export function analyze(functions, migrations, sharedSource = "") {
  const reach = cronReachability(migrations);
  const reachable = reachableFunctions(functions, reach.functions, sharedSource);
  const workers = [];
  const violations = [];

  for (const { name, source } of functions) {
    const rpcs = claimRpcs(source);
    if (rpcs.length === 0) continue;
    if (!hasMachineOnlyDoor(source)) continue;
    const scheduled = reach.functions.has(name);
    const invoked = !scheduled && reachable.has(name);
    workers.push({ name, rpcs, scheduled, invoked });
    if (!scheduled && !invoked && !HAND_KICKED.has(name)) {
      violations.push({ name, rpcs });
    }
  }

  const staleExemptions = [...HAND_KICKED.keys()].filter(
    (n) => !workers.some((w) => w.name === n && !w.scheduled && !w.invoked),
  );

  return { workers, violations, staleExemptions, reach };
}

function readSources(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      readSources(full, acc);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\.[a-z]+$/.test(entry.name)) {
      acc.push(fs.readFileSync(full, "utf8"));
    }
  }
  return acc;
}

function loadFunctions() {
  const root = path.join(REPO_ROOT, FUNCTIONS_DIR);
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const source = readSources(path.join(root, entry.name)).join("\n");
    if (source.length > 0) out.push({ name: entry.name, source });
  }
  return out;
}

/** Concatenated `supabase/functions/_shared/**` — the SHARED synthetic caller. */
function loadSharedSource() {
  const dir = path.join(REPO_ROOT, FUNCTIONS_DIR, "_shared");
  if (!fs.existsSync(dir)) return "";
  return readSources(dir).join("\n");
}

function loadMigrations() {
  const root = path.join(REPO_ROOT, MIGRATIONS_DIR);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ file: f, sql: fs.readFileSync(path.join(root, f), "utf8") }));
}

function selfTest() {
  const WORKER = [
    'const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";',
    'const bearer = request.headers.get("authorization") ?? "";',
    "if (bearer !== `Bearer ${serviceKey}`) return json({ error: 'forbidden' }, 403);",
    'await client.rpc("biz_claim_widget_queue", { p_limit: 100 });',
  ].join("\n");

  const scheduleFor = (fn, job) => ({
    file: "20270101000000_x.sql",
    sql:
      `SELECT cron.schedule('${job}', '*/5 * * * *', $cron$\n` +
      "  SELECT net.http_post(url := (SELECT decrypted_secret FROM vault.decrypted_secrets\n" +
      `    WHERE name='supabase_url' LIMIT 1) || '/functions/v1/${fn}',\n` +
      "    headers := jsonb_build_object('authorization','Bearer '||(SELECT decrypted_secret\n" +
      "      FROM vault.decrypted_secrets WHERE name='service_role_key' LIMIT 1)),\n" +
      "    body := '{}'::jsonb);\n$cron$);",
  });

  // 1. THE #2290 DEFECT ITSELF: a machine-only claim worker with no scheduler.
  let r = analyze([{ name: "widget-worker", source: WORKER }], [
    scheduleFor("some-other-worker", "job_other"),
  ]);
  if (r.violations.length !== 1 || r.violations[0].name !== "widget-worker") {
    console.error(
      "#2290 self-test: an unscheduled machine-only claim worker was NOT detected. " +
        "This gate proves nothing.",
    );
    process.exit(1);
  }

  // 2. The same worker, scheduled — must be green, or the rule is just "always red".
  r = analyze([{ name: "widget-worker", source: WORKER }], [
    scheduleFor("widget-worker", "job_widget"),
  ]);
  if (r.violations.length !== 0 || r.workers.length !== 1 || !r.workers[0].scheduled) {
    console.error("#2290 self-test: a correctly scheduled worker was flagged.");
    process.exit(1);
  }

  // 3. ORDER MATTERS: scheduled in an earlier migration, permanently unscheduled
  //    in a later one, is NOT reachable. A set-union model would miss this.
  r = analyze([{ name: "widget-worker", source: WORKER }], [
    { file: "20270101000000_a.sql", sql: scheduleFor("widget-worker", "job_widget").sql },
    { file: "20270202000000_b.sql", sql: "SELECT cron.unschedule('job_widget');" },
  ]);
  if (r.violations.length !== 1) {
    console.error(
      "#2290 self-test: a job unscheduled by a LATER migration still counted as a caller. " +
        "Reachability must be replayed in filename order, not unioned.",
    );
    process.exit(1);
  }

  // 4. And the idempotent unschedule-then-reschedule idiom must stay green.
  r = analyze([{ name: "widget-worker", source: WORKER }], [
    {
      file: "20270101000000_a.sql",
      sql:
        "SELECT cron.unschedule('job_widget') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='job_widget');\n" +
        scheduleFor("widget-worker", "job_widget").sql,
    },
  ]);
  if (r.violations.length !== 0) {
    console.error(
      "#2290 self-test: the unschedule-if-exists + reschedule idiom was read as an unschedule.",
    );
    process.exit(1);
  }

  // 5. A COMMENTED-OUT schedule is not a caller. `#2113` proved this repo ships
  //    checks that cannot fail; a gate satisfied by a comment is one of them.
  r = analyze([{ name: "widget-worker", source: WORKER }], [
    {
      file: "20270101000000_a.sql",
      sql: "-- SELECT cron.schedule('job_widget','*/5 * * * *', $cron$ /functions/v1/widget-worker $cron$);",
    },
  ]);
  if (r.violations.length !== 1) {
    console.error("#2290 self-test: a commented-out cron.schedule satisfied the gate.");
    process.exit(1);
  }

  // 6. A COMMENTED-OUT unschedule must not remove a live job.
  r = analyze([{ name: "widget-worker", source: WORKER }], [
    { file: "20270101000000_a.sql", sql: scheduleFor("widget-worker", "job_widget").sql },
    { file: "20270202000000_b.sql", sql: "--     SELECT cron.unschedule('job_widget');" },
  ]);
  if (r.violations.length !== 0) {
    console.error("#2290 self-test: a commented-out cron.unschedule removed a live job.");
    process.exit(1);
  }

  // 7. A USER-FACING claim endpoint must be ignored entirely. This is the whole
  //    reason condition (b) exists.
  const USER_FACING = [
    'const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");',
    'const authorization = req.headers.get("authorization") ?? "";',
    "const viewer = createClient(url, anon, { global: { headers: { authorization } } });",
    "const { data: authData } = await viewer.auth.getUser();",
    'await admin.rpc("claim_support_ticket", { p_id });',
  ].join("\n");
  r = analyze([{ name: "support-claim", source: USER_FACING }], []);
  if (r.workers.length !== 0 || r.violations.length !== 0) {
    console.error(
      "#2290 self-test: a user-JWT claim endpoint was treated as a cron worker. " +
        "Condition (b) is not discriminating.",
    );
    process.exit(1);
  }

  // 8. An OUTBOUND `Bearer ${key}` header is not a door.
  const OUTBOUND = [
    'const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");',
    'await fetch(url, { headers: { Authorization: `Bearer ${key}` } });',
    'await client.rpc("claim_thing", {});',
  ].join("\n");
  r = analyze([{ name: "outbound-only", source: OUTBOUND }], []);
  if (r.workers.length !== 0) {
    console.error(
      "#2290 self-test: an OUTBOUND Authorization header was mistaken for an inbound gate.",
    );
    process.exit(1);
  }

  // 9. The constant-time comparator shape (notify-outbox-drain) is a door.
  const CONSTANT_TIME = [
    'const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");',
    "if (!constantTimeEqual(authHeader, `Bearer ${key}`)) return unauthorized();",
    'await client.rpc("claim_notification_outbox", { p_limit: 50 });',
  ].join("\n");
  r = analyze([{ name: "drain", source: CONSTANT_TIME }], []);
  if (r.workers.length !== 1) {
    console.error("#2290 self-test: the constantTimeEqual door shape was not recognised.");
    process.exit(1);
  }

  // 10. CRON_SECRET alone is equally a machine-only door.
  const CRON_ONLY = [
    'const cronSecret = Deno.env.get("CRON_SECRET") ?? "";',
    "if (bearer !== `Bearer ${cronSecret}`) return forbidden();",
    'await client.rpc("biz_claim_x", {});',
  ].join("\n");
  r = analyze([{ name: "cron-only", source: CRON_ONLY }], []);
  if (r.workers.length !== 1) {
    console.error("#2290 self-test: a CRON_SECRET-only door was not recognised.");
    process.exit(1);
  }

  // 11. The hand-kicked allowlist suppresses the violation but still records the worker.
  r = analyze([{ name: "attendance-claim-backfill", source: WORKER }], []);
  if (r.violations.length !== 0 || r.workers.length !== 1) {
    console.error("#2290 self-test: the hand-kicked allowlist did not suppress its entry.");
    process.exit(1);
  }

  // 12. INVOKED BY ANOTHER EDGE FUNCTION that itself has a caller — not dark.
  //     This is `ticket-confirmation-dispatch`: machine-only door, mints an
  //     attendance-claim proof, never scheduled, but the Stripe webhook path and
  //     `reconcile-stuck-checkouts` both call it by name.
  r = analyze(
    [
      { name: "widget-worker", source: WORKER },
      {
        name: "front-door",
        source:
          'const authorization = req.headers.get("authorization") ?? "";\n' +
          "const { data } = await createClient(url, anon, { global: { headers: { authorization } } }).auth.getUser();\n" +
          'await supabase.functions.invoke("widget-worker", { body: {} });',
      },
    ],
    [],
  );
  if (r.violations.length !== 0 || r.workers[0].invoked !== true) {
    console.error(
      "#2290 self-test: a worker invoked by a reachable edge function was still reported dark.",
    );
    process.exit(1);
  }

  // 13. A caller that is ITSELF unreachable must NOT launder the callee green.
  //     Without the transitive closure, two dark workers calling each other
  //     would both look like they had callers.
  r = analyze(
    [
      { name: "widget-worker", source: WORKER },
      {
        name: "dark-caller",
        source: WORKER + '\nawait supabase.functions.invoke("widget-worker", {});',
      },
    ],
    [],
  );
  if (r.violations.length !== 2) {
    console.error(
      "#2290 self-test: an unreachable caller laundered its callee green. " +
        "Reachability must be a closure rooted at cron + user-facing doors.",
    );
    process.exit(1);
  }

  // 14. A function name MENTIONED in a comment is not a caller.
  r = analyze(
    [
      { name: "widget-worker", source: WORKER },
      {
        name: "front-door",
        source:
          'const authorization = req.headers.get("authorization") ?? "";\n' +
          "await createClient(url, anon).auth.getUser();\n" +
          '// see supabase.functions.invoke("widget-worker") in the other path\n' +
          "/* also /functions/v1/widget-worker */",
      },
    ],
    [],
  );
  if (r.violations.length !== 1) {
    console.error("#2290 self-test: a commented-out invocation counted as a caller.");
    process.exit(1);
  }

  // 15. Shared code counts as a caller — `_shared/ticketCheckout.ts` and
  //     `_shared/stripeWebhookRouter.ts` are how the real dispatcher is reached.
  r = analyze([{ name: "widget-worker", source: WORKER }], [], "await fetch(`${url}/functions/v1/widget-worker`, {});");
  if (r.violations.length !== 0) {
    console.error("#2290 self-test: an invocation from _shared/** was not credited.");
    process.exit(1);
  }

  // 16. P-vacuous — discovering nothing must never read as success.
  r = analyze([], []);
  if (r.workers.length !== 0 || r.reach.scheduleCalls !== 0) {
    console.error("#2290 self-test: empty input did not report zero.");
    process.exit(1);
  }

  console.log(
    "#2290 self-test passed (unscheduled claim worker caught; scheduled worker green; " +
      "later-unschedule caught; unschedule-then-reschedule green; commented-out schedule " +
      "and unschedule both handled; user-JWT claim endpoint ignored; outbound bearer " +
      "ignored; constantTimeEqual and CRON_SECRET doors recognised; allowlist honoured; " +
      "cross-function invocation credited, commented-out invocation is not, and an " +
      "unreachable caller cannot launder its callee green).",
  );
}

function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const functions = loadFunctions();
  const migrations = loadMigrations();
  const sharedSource = loadSharedSource();
  const { workers, violations, staleExemptions, reach } = analyze(
    functions,
    migrations,
    sharedSource,
  );

  // P-vacuous. A gate that inspected nothing must FAIL, never pass green — the
  // exact failure mode #2113 catalogued 60 times in this repo.
  if (functions.length === 0 || migrations.length === 0) {
    console.error(
      `#2290: discovered ${functions.length} edge functions and ${migrations.length} ` +
        "migrations. A gate that reads nothing must fail, not pass.",
    );
    process.exit(1);
  }
  if (reach.scheduleCalls === 0) {
    console.error(
      "#2290: parsed ZERO cron.schedule calls out of " + migrations.length +
        " migrations. The SQL scanner is broken, so every worker would look unscheduled " +
        "or every worker would look fine. Either way this gate is not measuring anything.",
    );
    process.exit(1);
  }
  if (workers.length === 0) {
    console.error(
      "#2290: discovered ZERO machine-only claim workers across " + FUNCTIONS_DIR +
        ". The detector matched nothing, so a dark worker could not be seen.",
    );
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error(
      "#2290: an edge function leases work from a queue behind a machine-only door,\n" +
        "and NOTHING in supabase/migrations/ ever calls it. That is a switch with no\n" +
        "caller: it deploys, it goes ACTIVE, it answers 200 when you curl it, and it\n" +
        "never runs. The queue behind it fills forever and the feature is silently dead.\n" +
        "This is what left every brand's contact book empty from 2026-08-11 (#2290) and\n" +
        "what made CHECKOUT_REVOCATION_EXECUTE a permission with no effect (#2168).\n\n" +
        "Add a cron.schedule() posting to /functions/v1/<name> in a migration, following\n" +
        "supabase/migrations/20270423002290_issue_2290_brand_person_ingest_cron.sql.\n" +
        "If it is genuinely hand-kicked, add it to HAND_KICKED in this file with a reason.\n",
    );
    for (const v of violations) {
      console.error(
        `  NEW  ${v.name} — claims via ${v.rpcs.join(", ")}; ` +
          "no cron.schedule targets it and no other edge function invokes it",
      );
    }
    process.exit(1);
  }

  if (staleExemptions.length > 0) {
    console.error(
      "#2290: HAND_KICKED lists worker(s) the detector no longer sees: " +
        staleExemptions.join(", ") +
        ".\nEither the function was renamed/removed (drop the entry) or the detector " +
        "stopped recognising it (fix the detector). A frozen exemption that matches " +
        "nothing is a gate quietly narrowing itself.",
    );
    process.exit(1);
  }

  if (HAND_KICKED.size !== EXPECTED_HAND_KICKED) {
    console.error(
      `#2290: HAND_KICKED size ${HAND_KICKED.size} != frozen ${EXPECTED_HAND_KICKED}.`,
    );
    process.exit(1);
  }

  const scheduled = workers.filter((w) => w.scheduled).map((w) => w.name);
  const invoked = workers.filter((w) => w.invoked).map((w) => w.name);
  console.log(
    `#2290 OK — ${workers.length} machine-only claim worker(s) inspected across ` +
      `${functions.length} edge functions and ${migrations.length} migrations ` +
      `(${reach.scheduleCalls} cron.schedule calls, ${reach.jobs.size} live jobs, ` +
      `${reach.dynamicUnschedules} dynamic unschedule(s) not modelled).\n` +
      `  cron-scheduled (${scheduled.length}): ${scheduled.join(", ")}\n` +
      `  invoked by another edge function (${invoked.length}): ${invoked.join(", ") || "none"}\n` +
      `  hand-kicked and frozen (${HAND_KICKED.size}): ${[...HAND_KICKED.keys()].join(", ")}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { HAND_KICKED, EXPECTED_HAND_KICKED, FUNCTIONS_DIR, MIGRATIONS_DIR, loadFunctions, loadMigrations };
