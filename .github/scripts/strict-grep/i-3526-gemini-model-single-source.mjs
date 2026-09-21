#!/usr/bin/env node
/**
 * Issue #3526 [Gemini repin] — the Gemini model id has exactly ONE owner.
 *
 * WHY THIS GATE EXISTS. On 2026-09-17 Google closed `gemini-2.5-flash` to
 * callers without prior usage history. Ten production files named that model as
 * a bare string literal, so every Gemini-powered surface went down at once and
 * the fix was a 28-file sweep. Two of those pins were invisible to the sweep
 * everybody ran:
 *
 *   1. `competitor-intel-worker` built its request URL with the literal
 *      `.../models/gemini-2.5-flash:generateContent` and IGNORED its own
 *      `GEMINI_MODEL_ID` constant fifteen hundred lines above. Repinning the
 *      constant alone would have left the worker calling the dead model.
 *   2. `_shared/photoAestheticEnums.ts` held the token PRICES under identifiers
 *      spelled with UNDERSCORES — `GEMINI_2_5_FLASH_INPUT_PER_TOKEN` — which
 *      `git grep "gemini-2.5-flash"` cannot match. Left alone, the cost model
 *      would have silently under-reported by 2.5x.
 *
 * The four checks:
 *
 *   G-1  No raw `gemini-<major>.<minor>-flash` literal anywhere under
 *        supabase/functions/ except _shared/geminiModel.ts. Catches (1).
 *   G-2  The model label written by `tg_meta_orch_1009_sub_d_drift_queue_reeval`
 *        in the NEWEST migration that defines it equals GEMINI_MODEL_ID. Postgres
 *        cannot import a TypeScript module, so the Edge constant and the database
 *        label can only be proved equal at CI time. This is the one thing standing
 *        between them drifting apart at the next retirement.
 *   G-3  `thinkingBudget` appears nowhere under supabase/functions/. It is a
 *        Gemini 2.x parameter; on a 3.x model it is at best ignored, which
 *        silently restores the default `medium` thinking and the cost and latency
 *        that `thinking_level: "minimal"` exists to prevent.
 *   G-4  No identifier matching /GEMINI_\d+_\d+_FLASH/. Catches (2).
 *
 * COMMENTS ARE STRIPPED BEFORE EVERY CHECK. Per
 * reference_audit_regex_matches_comments_same_file.md: the doc-URL anchors at
 * signalScorer.ts, run-business-place-authoring-pipeline and growth-tools-run,
 * and the explanatory comments naming the OLD model and the OLD constant names,
 * would otherwise trip the gate — and the next person would weaken the gate to
 * make them pass. The stripper is string-literal aware, so `"https://…"` inside
 * a quoted string is never mistaken for a `//` comment.
 *
 * SCOPE, STATED EXPLICITLY because the first version left it implicit and that
 * is where P0-1 hid. G-1/G-3/G-4 cover `supabase/functions/` only — every
 * extension in SCANNED_EXTENSIONS, not just `.ts`. The model ID genuinely has
 * no consumer outside the backend. Its PRICE does not: `mingla-admin` held five
 * copies of the per-place cost and decided the spend guard client-side. That is
 * fixed by making the SERVER the owner and the admin ask (the admin holds no
 * rate at all now), which is a design property this gate cannot express as a
 * grep — so G-5 pins it directly: no admin file may carry a per-place rate.
 *
 * TEST FILES ARE OUT OF SCOPE for G-1 and G-4: a test legitimately asserts the
 * model string and the old constant names as fixture data. G-3 DOES cover tests,
 * because a test asserting `thinkingBudget: 0` is a test pinning a parameter
 * that no longer exists.
 *
 * `--self-test` proves each check fails on the exact revert it guards against.
 *
 * Exit codes: 0 — clean (or self-test proven) · 1 — violation.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FUNCTIONS_DIR = join(ROOT, "supabase", "functions");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const OWNER = join("supabase", "functions", "_shared", "geminiModel.ts");

const TRIGGER_FN = "tg_meta_orch_1009_sub_d_drift_queue_reeval";

// issue #3526 P2-3 — the model name has THREE spellings in this repo and the
// first version of this gate matched one of them:
//   gemini-2.5-flash   the API model id
//   gemini-2-5-flash   the pricing-page URL form — 16 occurrences across 12
//                      files survived the first sweep, including two live
//                      admin `href`s on the spend-authorisation screen
//   GEMINI_2_5_FLASH   the identifier form (see STALE_PRICING_IDENT)
// Sweep for the CONCEPT, not the string.
const MODEL_LITERAL = /gemini-\d+[-.]\d+-flash/i;
const MODEL_LITERAL_G = /gemini-\d+[-.]\d+-flash/gi;

// issue #3526 P2-3 — the literal can also be ASSEMBLED, which defeats a plain
// substring match: `"gemini-2." + "5-flash"`, `` `gemini-${maj}.${min}-flash` ``,
// or a URL split at the dot. Normalising the source before the test closes all
// three at once: drop string-concatenation joins and collapse `${…}` holes to a
// single char, then re-run the same matcher.
const CONCAT_JOIN = /["'`]\s*\+\s*["'`]/g;
const TEMPLATE_HOLE = /\$\{[^{}]*\}/g;
function normalizeForModelMatch(code) {
  return code.replace(CONCAT_JOIN, "").replace(TEMPLATE_HOLE, "0");
}

// issue #3526 P4-1 — was /GEMINI_\d+_\d+_FLASH/, which fixed the instance and
// not the class: three lines above the renamed Gemini rates sit
// HAIKU_4_5_INPUT_PER_TOKEN and friends, identical sweep-blind spelling,
// different vendor. When Anthropic retires Haiku 4.5 this recurs exactly.
const STALE_PRICING_IDENT = /[A-Z]+_\d+_\d+_[A-Z0-9_]*(INPUT|OUTPUT|CACHE)/;

// issue #3526 P1-3 — was /thinkingBudget/, camelCase ONLY. Every thinking key
// in this repo is snake_case (`thinking_level`, at all eleven senders) because
// the Gemini REST API accepts snake_case — so `thinking_budget` is the NATURAL
// way to reintroduce the parameter this check exists to forbid, and the
// camelCase-only form could not see it. Proven end-to-end on the real tree.
const THINKING_BUDGET = /thinking[_]?[Bb]udget/;

// ── Comment stripping ───────────────────────────────────────────────────────
// String-literal aware so a URL inside "…" or `…` is never read as a comment.
// Comments are replaced with equal-length whitespace so line numbers survive.
export function stripTsComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && d === "*") {
      out += "  "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " "; i++;
      }
      out += "  "; i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c; i++;
      while (i < n) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        // An unterminated single/double quote cannot span a newline.
        if (quote !== "`" && src[i] === "\n") { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

export function stripSqlComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "-" && d === "-") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && d === "*") {
      out += "  "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " "; i++;
      }
      out += "  "; i += 2;
      continue;
    }
    if (c === "'") {
      out += c; i++;
      while (i < n) {
        out += src[i];
        if (src[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

// ── File walking ────────────────────────────────────────────────────────────
// issue #3526 P2-3 — the walker read ONLY `.ts`, so a `.json` contract/fixture
// or a `.mjs` under supabase/functions/ was invisible (11 such files exist).
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".json", ".sql"];

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
      walk(full, acc);
    } else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
      acc.push(full);
    }
  }
  return acc;
}

const isTestPath = (rel) =>
  rel.split(sep).includes("__tests__") ||
  /\.test\.ts$/.test(rel) ||
  /(^|[/\\])tester_[^/\\]*\.ts$/.test(rel);

// ── The owner's declared model id ───────────────────────────────────────────
export function readOwnerModelId(source) {
  const m = /export const GEMINI_MODEL_ID\s*=\s*["'`](gemini-\d+\.\d+-flash)["'`]/
    .exec(stripTsComments(source));
  return m ? m[1] : null;
}

// ── G-2: the newest migration that defines the drift trigger function ───────
// issue #3526 P2-1 — this required `CREATE OR REPLACE FUNCTION public.<fn>`.
// Supabase migrations run with `search_path = public`, so the UNQUALIFIED form
// installs the very same live trigger — and a migration using it was invisible
// here, leaving the gate validating a stale earlier file while reporting PASS.
// The schema qualifier is optional now, and the discovery returns ALL matches
// so the caller can assert exactly one is treated as newest.
const TRIGGER_DEF_RE = new RegExp(
  `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(?:public\\.)?${TRIGGER_FN}`,
  "i",
);

export function triggerMigrations(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => TRIGGER_DEF_RE.test(stripSqlComments(readFileSync(join(dir, f), "utf8"))))
    .sort();
}

export function newestTriggerMigration(dir) {
  const hits = triggerMigrations(dir);
  return hits.length > 0 ? hits[hits.length - 1] : null;
}

/** Model labels the trigger function writes, comments stripped. */
export function triggerModelLabels(sql) {
  const code = stripSqlComments(sql);
  // issue #3526 P2-1 — `public.` optional, same reason as the discovery above.
  const start = code.search(TRIGGER_DEF_RE);
  if (start < 0) return [];
  const body = code.slice(start);
  const end = body.indexOf("$$;");
  const scope = end > 0 ? body.slice(0, end) : body;
  return [...new Set(scope.match(MODEL_LITERAL_G) ?? [])];
}

// ── Checks ──────────────────────────────────────────────────────────────────
export function checkSources(files, modelId) {
  const failures = [];
  for (const { rel, source } of files) {
    const code = stripTsComments(source);
    const isOwner = rel === OWNER;
    const isTest = isTestPath(rel);

    // issue #3526 P2-3 — test the NORMALISED source so a literal assembled by
    // concatenation, interpolation or a split URL cannot walk past a plain
    // substring match. All three were proven to smuggle through.
    const normalized = normalizeForModelMatch(code);
    if (!isOwner && !isTest && MODEL_LITERAL.test(normalized)) {
      const hit = MODEL_LITERAL.exec(normalized)[0];
      failures.push(
        `G-1 ${rel}: raw model literal "${hit}" outside ${OWNER}. ` +
        `Import GEMINI_MODEL_ID / geminiGenerateContentUrl() instead — a second ` +
        `owner is exactly how competitor-intel-worker kept calling the retired model.`,
      );
    }
    // issue #3526 round 2 — the owner was FULLY exempt, so a retired model's
    // spelling could sit inside it untouched: restoring the all-hyphen
    // `ai.google.dev/pricing/gemini-2-5-flash` pricing URL left the gate at
    // PASS. Found by the fails-on-revert run. The owner may name exactly ONE
    // model — the one it declares — and nothing else.
    if (isOwner && modelId) {
      const canonical = modelId.replace(/\./g, "-");
      for (const hit of normalized.match(MODEL_LITERAL_G) ?? []) {
        if (hit.toLowerCase() !== modelId && hit.toLowerCase() !== canonical) {
          failures.push(
            `G-1 ${rel}: the single source names "${hit}" as well as its declared ` +
            `"${modelId}". The owner may name exactly one model; a second ` +
            `spelling here is a stale reference the next repin will miss.`,
          );
        }
      }
    }
    const legacyThinking = THINKING_BUDGET.exec(code);
    if (legacyThinking) {
      failures.push(
        `G-3 ${rel}: "${legacyThinking[0]}" is a Gemini 2.x parameter. On a 3.x ` +
        `model it is ignored, which silently restores default "medium" thinking ` +
        `— the cost and latency F-2 exists to prevent. Use ` +
        `thinkingConfig: { thinking_level: GEMINI_THINKING_LEVEL_MINIMAL }.`,
      );
    }
    if (!isTest && STALE_PRICING_IDENT.test(code)) {
      failures.push(
        `G-4 ${rel}: identifier "${STALE_PRICING_IDENT.exec(code)[0]}" carries a ` +
        `model version, so a "gemini-x.y-flash" sweep cannot see it. Name pricing ` +
        `constants model-agnostically and source the values from ${OWNER}.`,
      );
    }
  }
  if (!modelId) {
    failures.push(
      `G-1 ${OWNER}: no "export const GEMINI_MODEL_ID = \\"gemini-<x>.<y>-flash\\"" found. ` +
      `The single source must declare the model id as a plain literal.`,
    );
  }
  return failures;
}

/**
 * G-5 (issue #3526 P0-1) — the admin app must hold NO per-place rate.
 *
 * The model ID genuinely has no consumer outside `supabase/functions/`. Its
 * PRICE did: `mingla-admin` kept five copies of 0.0040 and computed
 * `confirm_high_cost` from its own arithmetic. When the edge constant moved to
 * 0.0089 the two disagreed and Baltimore (1,205 remaining) became unstartable —
 * admin showed $4.82 and sent confirm=false, the server computed $10.72 and
 * returned 400. The fix is not a sixth copy: the server owns the cost model and
 * publishes it on `intelligence_coverage` / `city_coverage`, and the admin
 * renders what it is told. This gate keeps it that way.
 */
const ADMIN_COST_DIR = join("mingla-admin", "src");
const ADMIN_RATE_LITERAL = /\b0\.00[0-9]+\b/;
const ADMIN_COST_IDENT = /PER_PLACE_COST_USD|COST_GUARD_USD|COST_DRIFT_TOLERANCE/;

export function checkAdminCostOwnership(files) {
  const failures = [];
  for (const { rel, source } of files) {
    if (!rel.startsWith(ADMIN_COST_DIR)) continue;
    if (isTestPath(rel)) continue;
    const code = stripTsComments(source);
    if (!ADMIN_COST_IDENT.test(code)) continue;
    // An identifier is fine when it names a SERVER-SUPPLIED value; a numeric
    // rate literal beside it is the client owning the truth again.
    if (ADMIN_RATE_LITERAL.test(code)) {
      failures.push(
        `G-5 ${rel}: a per-place cost/guard identifier sits next to a rate ` +
        `literal (${ADMIN_RATE_LITERAL.exec(code)[0]}). The admin must not own ` +
        `the cost model — read per_place_cost_usd / cost_guard_usd off the ` +
        `server's cost_model and render what you are told. A client that ` +
        `guesses is a client that owns the truth, and that is what made ` +
        `Baltimore unstartable.`,
      );
    }
  }
  return failures;
}

export function checkMigration(modelId, migrationName, sql, allMigrations = []) {
  const failures = [];
  // issue #3526 P2-1 — several migrations legitimately define this trigger over
  // time (the applied 20260808 original plus each repin), so "exactly one" would
  // be wrong. What matters is that the NEWEST is found at all: the attack was an
  // unqualified `CREATE OR REPLACE FUNCTION tg_…` in a later file, invisible to
  // a `public.`-only discovery, which left the gate validating a stale earlier
  // file while reporting PASS. TRIGGER_DEF_RE now finds both forms, so the
  // newest really is the newest. Ambiguity that WOULD be silent is two
  // definitions sharing one timestamp prefix — `.sort()` would pick arbitrarily.
  const prefixes = allMigrations.map((f) => f.split("_")[0]);
  const duplicatePrefix = prefixes.find((v, i) => prefixes.indexOf(v) !== i);
  if (duplicatePrefix) {
    failures.push(
      `G-2: two migrations defining ${TRIGGER_FN} share the timestamp prefix ` +
      `${duplicatePrefix}, so which one counts as newest is arbitrary. ` +
      `Give the later one a strictly greater prefix.`,
    );
  }
  if (!migrationName) {
    return [
      `G-2: no migration under supabase/migrations/ defines ${TRIGGER_FN}. ` +
      `The database label can no longer be proved equal to GEMINI_MODEL_ID.`,
    ];
  }
  const labels = triggerModelLabels(sql);
  if (labels.length === 0) {
    failures.push(
      `G-2 ${migrationName}: ${TRIGGER_FN} writes no model label at all. ` +
      `Rows it queues would carry no model provenance.`,
    );
  }
  for (const label of labels) {
    if (label !== modelId) {
      failures.push(
        `G-2 ${migrationName}: the drift trigger stamps "${label}" but ` +
        `GEMINI_MODEL_ID is "${modelId}". Postgres cannot import the constant, so ` +
        `this equality is the only thing keeping the DB label and the Edge model ` +
        `from drifting apart at the next retirement. Add a new CREATE OR REPLACE ` +
        `migration — never edit an applied one.`,
      );
    }
  }
  return failures;
}

// ── Self-test ───────────────────────────────────────────────────────────────
function runSelfTest() {
  const broken = [];
  const OK_OWNER = 'export const GEMINI_MODEL_ID = "gemini-3.6-flash";';
  const modelId = readOwnerModelId(OK_OWNER);
  if (modelId !== "gemini-3.6-flash") broken.push("owner model id not parsed from a clean source");

  const cases = [
    {
      name: "G-1 clean: a call site importing the constant passes",
      files: [{ rel: join("supabase", "functions", "x", "index.ts"), source: 'const u = `${GEMINI_API_BASE}/${GEMINI_MODEL_ID}:generateContent`;' }],
      expect: 0,
    },
    {
      name: "G-1 comments: a doc URL naming the model does NOT trip the gate",
      files: [{ rel: join("supabase", "functions", "x", "index.ts"), source: "// https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash\nconst a = 1;" }],
      expect: 0,
    },
    {
      name: "G-1 REVERT: the competitor-intel-worker URL literal trips the gate",
      files: [{ rel: join("supabase", "functions", "competitor-intel-worker", "index.ts"), source: 'fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");' }],
      expect: 1,
    },
    {
      name: "G-1 REVERT: a bare const literal at a call site trips the gate",
      files: [{ rel: join("supabase", "functions", "growth-tools-run", "index.ts"), source: 'const GEMINI_MODEL_ID = "gemini-3.6-flash";' }],
      expect: 1,
    },
    {
      name: "G-1 scope: the owner file itself may declare the literal",
      files: [{ rel: OWNER, source: OK_OWNER }],
      expect: 0,
    },
    {
      name: "G-1 REVERT: the owner carrying a SECOND, retired model spelling",
      files: [{ rel: OWNER, source: OK_OWNER + '\nconst u = "https://ai.google.dev/pricing/gemini-2-5-flash";' }],
      expect: 1,
    },
    {
      name: "G-1 scope: the owner may repeat its OWN id in the hyphen form",
      files: [{ rel: OWNER, source: OK_OWNER + '\nconst u = "https://x/pricing/gemini-3-6-flash";' }],
      expect: 0,
    },
    {
      name: "G-1 scope: a test asserting the model string as fixture data passes",
      files: [{ rel: join("supabase", "functions", "x", "__tests__", "a.test.ts"), source: 'assertEquals(row.model, "gemini-3.6-flash");' }],
      expect: 0,
    },
    {
      name: "G-1 scope: a *.test.ts outside __tests__/ is also fixture scope",
      files: [{ rel: join("supabase", "functions", "_shared", "placeIntelRetryCoverage.test.ts"), source: 'const m = "gemini-3.6-flash";' }],
      expect: 0,
    },
    {
      name: "G-3 REVERT: thinkingConfig: { thinkingBudget: 0 } trips the gate",
      files: [{ rel: join("supabase", "functions", "competitor-intel-worker", "index.ts"), source: "const g = { thinkingConfig: { thinkingBudget: 0 } };" }],
      expect: 1,
    },
    {
      name: "G-3 comments: prose naming thinkingBudget does NOT trip the gate",
      files: [{ rel: join("supabase", "functions", "x", "index.ts"), source: "// Gemini 3 removed `thinkingBudget`; use thinking_level.\nconst a = 1;" }],
      expect: 0,
    },
    {
      name: "G-3 scope: a TEST pinning thinkingBudget DOES trip the gate",
      files: [{ rel: join("supabase", "functions", "x", "__tests__", "a.test.ts"), source: 'assertEquals(req.generationConfig.thinkingConfig.thinkingBudget, 0);' }],
      expect: 1,
    },
    {
      name: "G-4 REVERT: renaming a rate back to GEMINI_2_5_FLASH_* trips the gate",
      files: [{ rel: join("supabase", "functions", "_shared", "photoAestheticEnums.ts"), source: "  GEMINI_2_5_FLASH_INPUT_PER_TOKEN: 0.30 / 1_000_000," }],
      expect: 1,
    },
    {
      name: "G-4 clean: model-agnostic rate names pass",
      files: [{ rel: join("supabase", "functions", "_shared", "photoAestheticEnums.ts"), source: "  GEMINI_INPUT_PER_TOKEN: GEMINI_INPUT_USD_PER_TOKEN," }],
      expect: 0,
    },
    // ── issue #3526 second round — every way the first version was falsified ──
    {
      name: "G-3 REVERT (snake_case): thinking_budget — the spelling this repo USES",
      files: [{ rel: join("supabase", "functions", "competitor-intel-worker", "index.ts"), source: "const g = { thinkingConfig: { thinking_budget: 0 } };" }],
      expect: 1,
    },
    {
      name: "G-3 REVERT: quoted snake_case in a serialized payload",
      files: [{ rel: join("supabase", "functions", "x", "index.ts"), source: 'const p = \'{"thinking_budget":0}\';' }],
      expect: 1,
    },
    {
      name: "G-1 SMUGGLE: the literal assembled by string concatenation",
      files: [{ rel: join("supabase", "functions", "x", "index.ts"), source: 'const m = "gemini-2." + "5-flash";' }],
      expect: 1,
    },
    {
      name: "G-1 SMUGGLE: the literal assembled by template interpolation",
      files: [{ rel: join("supabase", "functions", "x", "index.ts"), source: "const m = `gemini-${maj}.${min}-flash`;" }],
      expect: 1,
    },
    {
      name: "G-1 SMUGGLE: a URL split at the dot",
      files: [{ rel: join("supabase", "functions", "x", "index.ts"), source: 'const u = base + "/models/gemini-2." + "5-flash:generateContent";' }],
      expect: 1,
    },
    {
      name: "G-1 SMUGGLE: the ALL-HYPHEN pricing-page spelling",
      files: [{ rel: join("supabase", "functions", "x", "index.ts"), source: 'const u = "https://ai.google.dev/pricing/gemini-2-5-flash";' }],
      expect: 1,
    },
    {
      name: "G-4 SMUGGLE (class, not instance): another vendor's versioned rate",
      files: [{ rel: join("supabase", "functions", "_shared", "photoAestheticEnums.ts"), source: "  HAIKU_4_5_INPUT_PER_TOKEN: 1.0 / 1_000_000," }],
      expect: 1,
    },
    {
      name: "G-5 REVERT: the admin re-acquires a per-place rate",
      admin: [{ rel: join("mingla-admin", "src", "hooks", "useBulkRunDispatcher.js"), source: "const estCost = remaining * 0.004;\nconst PER_PLACE_COST_USD = 1;" }],
      expect: 1,
    },
    {
      name: "G-5 clean: the admin consuming the server's cost model passes",
      admin: [{ rel: join("mingla-admin", "src", "hooks", "useBulkRunDispatcher.js"), source: "const c = needsHighCostConfirmation(n, costModel);" }],
      expect: 0,
    },
    {
      name: "G-5 scope: a rate literal with NO cost identifier is not this gate's business",
      admin: [{ rel: join("mingla-admin", "src", "lib", "unrelated.js"), source: "const opacity = 0.004;" }],
      expect: 0,
    },
  ];

  for (const c of cases) {
    const got = c.admin
      ? checkAdminCostOwnership(c.admin).length
      : checkSources(c.files, "gemini-3.6-flash").length;
    const pass = c.expect === 0 ? got === 0 : got > 0;
    if (!pass) broken.push(`${c.name} — expected ${c.expect === 0 ? "no" : "a"} failure, got ${got}`);
  }

  // G-2 cases.
  const fnHead = `CREATE OR REPLACE FUNCTION public.${TRIGGER_FN}()\nRETURNS trigger AS $$\nBEGIN\n`;
  const g2 = [
    {
      name: "G-2 clean: the trigger label equals GEMINI_MODEL_ID",
      sql: `${fnHead}  INSERT INTO t VALUES ('v4', 'gemini-3.6-flash');\nEND;\n$$;`,
      expect: 0,
    },
    {
      name: "G-2 REVERT: changing GEMINI_MODEL_ID without a new migration trips the gate",
      sql: `${fnHead}  INSERT INTO t VALUES ('v4', 'gemini-2.5-flash');\nEND;\n$$;`,
      expect: 1,
    },
    {
      name: "G-2 comments: a header comment naming the OLD model does NOT trip the gate",
      sql: `-- was 'gemini-2.5-flash' before issue #3526\n${fnHead}  INSERT INTO t VALUES ('v4', 'gemini-3.6-flash');\nEND;\n$$;`,
      expect: 0,
    },
    {
      name: "G-2 REVERT: a trigger that stamps no model label at all trips the gate",
      sql: `${fnHead}  INSERT INTO t VALUES ('v4');\nEND;\n$$;`,
      expect: 1,
    },
    {
      // issue #3526 P2-1 — the UNQUALIFIED form. Supabase migrations run with
      // search_path = public, so this installs the very same live trigger, and
      // a `public.`-only discovery left the gate validating a stale earlier
      // file while reporting PASS.
      name: "G-2 REVERT: an UNQUALIFIED CREATE OR REPLACE with a stale label is discovered",
      sql: `CREATE OR REPLACE FUNCTION ${TRIGGER_FN}()\nRETURNS trigger AS $$\nBEGIN\n  INSERT INTO t VALUES ('v4', 'gemini-2.5-flash');\nEND;\n$$;`,
      expect: 1,
    },
    {
      name: "G-2 clean: the unqualified form with the RIGHT label passes",
      sql: `CREATE OR REPLACE FUNCTION ${TRIGGER_FN}()\nRETURNS trigger AS $$\nBEGIN\n  INSERT INTO t VALUES ('v4', 'gemini-3.6-flash');\nEND;\n$$;`,
      expect: 0,
    },
  ];
  for (const c of g2) {
    const got = checkMigration("gemini-3.6-flash", "fixture.sql", c.sql).length;
    const pass = c.expect === 0 ? got === 0 : got > 0;
    if (!pass) broken.push(`${c.name} — expected ${c.expect === 0 ? "no" : "a"} failure, got ${got}`);
  }

  if (broken.length > 0) {
    console.error("\n#3526 gemini-model-single-source gate SELF-TEST FAILED:\n");
    for (const b of broken) console.error(`  ✗ ${b}`);
    process.exit(1);
  }
  console.log(
    `#3526 gemini-model-single-source gate SELF-TEST PASS (${cases.length + g2.length} cases).`,
  );
  process.exit(0);
}

// ── Entry ───────────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const ownerPath = join(ROOT, OWNER);
  if (!existsSync(ownerPath)) {
    console.error(`#3526 gemini-model-single-source gate FAILED: ${OWNER} missing — the single source is gone.`);
    process.exit(1);
  }
  const modelId = readOwnerModelId(readFileSync(ownerPath, "utf8"));
  const files = walk(FUNCTIONS_DIR).map((full) => ({
    rel: relative(ROOT, full),
    source: readFileSync(full, "utf8"),
  }));
  const failures = checkSources(files, modelId);

  // G-5 — the admin app, which is where the PRICE had its second owner.
  const adminFiles = walk(join(ROOT, ADMIN_COST_DIR)).map((full) => ({
    rel: relative(ROOT, full),
    source: readFileSync(full, "utf8"),
  }));
  failures.push(...checkAdminCostOwnership(adminFiles));

  const triggerFiles = triggerMigrations(MIGRATIONS_DIR);
  const migrationName = newestTriggerMigration(MIGRATIONS_DIR);
  failures.push(
    ...checkMigration(
      modelId,
      migrationName,
      migrationName ? readFileSync(join(MIGRATIONS_DIR, migrationName), "utf8") : "",
      triggerFiles,
    ),
  );

  if (failures.length > 0) {
    console.error("\n#3526 gemini-model-single-source gate FAILED:\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(
    `#3526 gemini-model-single-source gate PASS ` +
    `(model "${modelId}", ${files.length} files, DB label from ${migrationName}).`,
  );
}
