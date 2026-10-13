#!/usr/bin/env node
// Issue #3645 — I-PROPOSED-3645-ONE-OFFERING-CURRENCY-SOURCE.
//
// RULE: no offering function and no constraint carries its own currency list.
// public.supported_brand_currencies owns the list; offering functions ask
// public.is_supported_offering_currency(text).
//
// WHY: the list was written out by hand in four places and the copies drifted.
// Two experience functions held 19 codes without NGN while the events CHECK and
// the event function held 15 with NGN, so a naira experience was refused and
// four codes the experience functions admitted died on a raw constraint error.
//
// This is a FORWARD RATCHET anchored at migration 20270819003645, which adds
// the helper and swaps the events CHECK for a foreign key. The three offering
// functions still carry their old lists in migrations that sort BEFORE the
// anchor; those are printed and not judged. From the anchor onward:
//
//   R1  the LATEST definition of business_publish_event_draft,
//       biz_publish_experience and biz_create_experience, once it lives in a
//       migration at or after the anchor, must not contain an inline currency
//       list, and must not raise event_currency_unsupported without calling
//       is_supported_offering_currency;
//   R2  no migration at or after the anchor may add a CHECK that names a
//       currency column and lists currency codes inline;
//   R3  the helper's latest definition reads supported_brand_currencies and
//       carries no list of its own;
//   R4  EVERY other function created in a migration at or after the anchor,
//       whatever its name or schema, must not contain an inline currency list.
//       The invariant is about offering functions in general, and a new one
//       (a future stay or trip publish function) with a pasted list is exactly
//       the drift this exists to stop. R4 judges every definition in scope, not
//       only the latest, the same forward-only scope R2 uses.
//
// EXEMPTION (R4 only). A body that lists currency codes for a reason other
// than deciding which currencies are allowed (a currency-to-region map, a
// minor-unit table) carries this comment INSIDE the function body:
//
//   -- orch-strict-grep-allow offering-currency-list: <why this is not an allow-list>
//
// The reason is required; a marker without one is a failure. Every exemption
// honoured is printed with its reason. The marker is ignored for the three
// named offering functions, for the helper and for CHECK constraints: those
// may never carry a list.
//
// It fails CLOSED and is AUDIBLE: a missing anchor, a function with no
// definition, or a body it cannot delimit is a failure, and every object it
// inspects is printed with its verdict.
//
// Usage:
//   node .github/scripts/strict-grep/issue-3645-one-offering-currency-source.mjs
//   node .github/scripts/strict-grep/issue-3645-one-offering-currency-source.mjs --self-test
//   ... --migrations-dir <dir>   (fixtures; default supabase/migrations)

import fs from "node:fs";
import path from "node:path";

export const RATCHET_VERSION = "20270819003645";
export const OFFERING_FUNCTIONS = [
  "business_publish_event_draft",
  "biz_publish_experience",
  "biz_create_experience",
];
export const HELPER = "is_supported_offering_currency";
export const SOURCE_TABLE = "supported_brand_currencies";
export const REFUSAL = "event_currency_unsupported";
export const ALLOW_MARKER = "orch-strict-grep-allow offering-currency-list";

// Private-use sentinels that carry an exemption marker's reason through
// comment stripping. They cannot occur in a migration's own text.
const ALLOW_OPEN = "\uE000";
const ALLOW_CLOSE = "\uE001";
const ALLOW_SENTINEL = /\uE000([^\uE001]*)\uE001/g;
const ALLOW_IN_COMMENT = /orch-strict-grep-allow\s+offering-currency-list(?:\s*[:—–-]+\s*([^\n]*))?/;

function markerSentinel(commentText) {
  const match = ALLOW_IN_COMMENT.exec(commentText);
  if (!match) return "";
  return `${ALLOW_OPEN}${(match[1] ?? "").replace(/\*\/\s*$/, "").trim()}${ALLOW_CLOSE}`;
}

/** The reasons of every exemption marker left in `marked` text. */
export function exemptionReasons(marked) {
  return [...marked.matchAll(ALLOW_SENTINEL)].map((match) => match[1]);
}

function withoutSentinels(marked) {
  return marked.replace(ALLOW_SENTINEL, " ");
}

const TAG = "issue-3645-one-offering-currency-source";

/**
 * Remove SQL comments while keeping single-quoted strings intact, so a list
 * that only appears in a comment is not judged and a `--` inside a string is
 * not mistaken for a comment. Dollar-quoted bodies are scanned as code on
 * purpose: comments inside a function body must be stripped too.
 */
export function stripSqlComments(sql, { keepMarkers = false } = {}) {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j += 1;
      }
      out += sql.slice(i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    if (ch === "-" && next === "-") {
      const from = i;
      while (i < n && sql[i] !== "\n") i += 1;
      if (keepMarkers) out += markerSentinel(sql.slice(from, i));
      continue;
    }
    if (ch === "/" && next === "*") {
      const from = i;
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth += 1; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { depth -= 1; i += 2; continue; }
        i += 1;
      }
      out += " ";
      if (keepMarkers) out += markerSentinel(sql.slice(from, i));
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** The text between an opening bracket at `open` and its matching close. */
function balanced(text, open, openCh, closeCh) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") {
      i += 1;
      while (i < text.length) {
        if (text[i] === "'" && text[i + 1] === "'") { i += 2; continue; }
        if (text[i] === "'") break;
        i += 1;
      }
      continue;
    }
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

const CODE_LITERAL = /'[A-Z]{3}'/g;
const TYPED_CODE_LITERAL =
  /'[A-Z]{3}'\s*::\s*(?:"?bpchar"?|character(?:\s+varying)?|char|varchar|text)\b/gi;
const ARRAY_STRING_LITERAL = /'\{\s*"?[A-Z]{3}"?\s*(?:,\s*"?[A-Z]{3}"?\s*)+\}'/;

function countCodes(text) {
  return (text.match(CODE_LITERAL) ?? []).length;
}

/**
 * Why `sql` holds an inline currency list, or null when it does not. Three
 * shapes: two or more type-cast code literals anywhere; a bracketed or
 * parenthesised list (ARRAY[..], IN (..), ANY (..), ALL (..), VALUES (..))
 * holding two or more code literals; a '{GBP,USD}' array string.
 */
export function inlineCurrencyListReason(sql) {
  // TYPED_CODE_LITERAL is case-insensitive for the cast name only; the code
  // itself must still be three capitals, which the second test re-checks.
  const typed = (sql.match(TYPED_CODE_LITERAL) ?? []).filter((m) => /^'[A-Z]{3}'/.test(m));
  if (typed.length >= 2) {
    return `${typed.length} type-cast currency literals (${typed.slice(0, 3).join(", ")}${typed.length > 3 ? ", …" : ""})`;
  }
  if (ARRAY_STRING_LITERAL.test(sql)) {
    return `array string of currency codes (${sql.match(ARRAY_STRING_LITERAL)[0]})`;
  }
  const openers = [
    { re: /\bARRAY\s*\[/gi, open: "[", close: "]", label: "ARRAY[…]" },
    { re: /\bIN\s*\(/gi, open: "(", close: ")", label: "IN (…)" },
    { re: /\b(?:ANY|ALL|SOME)\s*\(/gi, open: "(", close: ")", label: "ANY/ALL (…)" },
    { re: /\bVALUES\s*\(/gi, open: "(", close: ")", label: "VALUES (…)" },
  ];
  for (const opener of openers) {
    for (const match of sql.matchAll(opener.re)) {
      const openAt = match.index + match[0].length - 1;
      let inner = balanced(sql, openAt, opener.open, opener.close);
      if (inner == null) continue;
      if (opener.label === "VALUES (…)") {
        // VALUES ('GBP'), ('USD') is one list spread over several tuples.
        const rest = sql.slice(openAt, openAt + 4000);
        const tuples = rest.match(/^(?:\s*\([^()]*\)\s*,?)+/);
        if (tuples) inner = tuples[0];
      }
      const codes = countCodes(inner);
      if (codes >= 2) return `${opener.label} holding ${codes} currency literals`;
    }
  }
  return null;
}

function versionOf(fileName) {
  const match = /^(\d{14})_/.test(fileName) ? fileName.slice(0, 14) : null;
  return match;
}

const CREATE_FUNCTION =
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?([A-Za-z_]\w*)"?\s*\.\s*)?"?([A-Za-z_]\w*)"?\s*\(/gi;

/** Every CREATE FUNCTION in a comment-stripped migration, with its body. */
export function extractFunctions(stripped) {
  const found = [];
  const starts = [...stripped.matchAll(CREATE_FUNCTION)];
  starts.forEach((match, index) => {
    const schema = (match[1] ?? "public").toLowerCase();
    const name = match[2].toLowerCase();
    const begin = match.index;
    const limit = index + 1 < starts.length ? starts[index + 1].index : stripped.length;
    const header = stripped.slice(begin, limit);
    const tag = /\bAS\s+(\$[A-Za-z_0-9]*\$)/i.exec(header);
    let body = null;
    if (tag) {
      const bodyStart = begin + tag.index + tag[0].length;
      const bodyEnd = stripped.indexOf(tag[1], bodyStart);
      if (bodyEnd !== -1) body = stripped.slice(bodyStart, bodyEnd);
    }
    found.push({ schema, name, body, statement: header, order: begin });
  });
  return found;
}

/** Every CHECK ( … ) expression in a comment-stripped migration. */
export function extractChecks(stripped) {
  const checks = [];
  for (const match of stripped.matchAll(/\bCHECK\s*\(/gi)) {
    const openAt = match.index + match[0].length - 1;
    const inner = balanced(stripped, openAt, "(", ")");
    if (inner != null) checks.push(inner);
  }
  return checks;
}

/**
 * Pure verdict over a list of { name, sql } migrations. Returns
 * { failures: string[], log: string[] } and performs no I/O.
 */
export function evaluate(files) {
  const failures = [];
  const log = [];
  const versioned = [];
  for (const file of files) {
    const version = versionOf(file.name);
    if (version == null) {
      log.push(`  skipped (no 14-digit version): ${file.name}`);
      continue;
    }
    versioned.push({
      ...file,
      version,
      stripped: stripSqlComments(file.sql),
      marked: stripSqlComments(file.sql, { keepMarkers: true }),
    });
  }
  versioned.sort((a, b) => (a.version === b.version ? a.name.localeCompare(b.name) : a.version < b.version ? -1 : 1));

  log.push(`migrations read: ${versioned.length}; ratchet anchor: ${RATCHET_VERSION}`);
  if (versioned.length === 0) {
    failures.push("no versioned migrations were found — the gate would be judging nothing.");
    return { failures, log };
  }

  const anchor = versioned.filter((file) => file.version === RATCHET_VERSION);
  if (anchor.length === 0) {
    failures.push(
      `anchor migration ${RATCHET_VERSION}_*.sql is missing. It was renamed or removed; ` +
        "this gate cannot ratchet without it.",
    );
  } else {
    log.push(`anchor present: ${anchor.map((file) => file.name).join(", ")}`);
  }

  // Collect every definition of the functions this gate cares about.
  const wanted = new Set([...OFFERING_FUNCTIONS, HELPER]);
  const definitions = new Map([...wanted].map((name) => [name, []]));
  for (const file of versioned) {
    for (const fn of extractFunctions(file.stripped)) {
      if (fn.schema !== "public" || !wanted.has(fn.name)) continue;
      definitions.get(fn.name).push({ ...fn, file: file.name, version: file.version });
    }
  }

  // R1 — offering functions.
  log.push("R1 offering functions:");
  for (const name of OFFERING_FUNCTIONS) {
    const defs = definitions.get(name);
    if (defs.length === 0) {
      failures.push(
        `R1: no definition of public.${name} was found in any migration. It was renamed, ` +
          "dropped, or is created in a form this gate cannot read; the gate must be updated with it.",
      );
      log.push(`  ${name}: NO DEFINITION FOUND`);
      continue;
    }
    const latest = defs[defs.length - 1];
    defs.forEach((def) => {
      const isLatest = def === latest;
      const afterAnchor = def.version >= RATCHET_VERSION;
      let verdict;
      if (!isLatest) verdict = "superseded, not judged";
      else if (!afterAnchor) verdict = "LATEST, before the anchor, not judged (still carries its old list until re-emitted)";
      else verdict = "LATEST, at or after the anchor, JUDGED";
      log.push(`  ${name} @ ${def.file}: ${verdict}`);
    });
    if (latest.version < RATCHET_VERSION) continue;
    if (latest.body == null) {
      failures.push(
        `R1: could not delimit the body of public.${name} in ${latest.file} (no dollar-quoted body found). ` +
          "The gate refuses to pass a definition it cannot read.",
      );
      continue;
    }
    const reason = inlineCurrencyListReason(latest.body);
    if (reason) {
      failures.push(
        `R1: public.${name} in ${latest.file} carries an inline currency list: ${reason}. ` +
          `Ask public.${HELPER}(code) instead; public.${SOURCE_TABLE} owns the list.`,
      );
    }
    if (latest.body.includes(REFUSAL) && !latest.body.includes(HELPER)) {
      failures.push(
        `R1: public.${name} in ${latest.file} raises ${REFUSAL} without calling ${HELPER}. ` +
          "The refusal must come from the shared source.",
      );
    }
    if (!reason && !(latest.body.includes(REFUSAL) && !latest.body.includes(HELPER))) {
      log.push(`    -> OK: no inline list${latest.body.includes(HELPER) ? `, calls ${HELPER}` : ""}`);
    }
  }

  // R3 — the helper itself.
  log.push("R3 helper:");
  const helperDefs = definitions.get(HELPER);
  if (helperDefs.length === 0) {
    failures.push(`R3: no definition of public.${HELPER} was found in any migration.`);
    log.push(`  ${HELPER}: NO DEFINITION FOUND`);
  } else {
    const latest = helperDefs[helperDefs.length - 1];
    helperDefs.forEach((def) => {
      log.push(`  ${HELPER} @ ${def.file}: ${def === latest ? "LATEST, JUDGED" : "superseded, not judged"}`);
    });
    if (latest.body == null) {
      failures.push(`R3: could not delimit the body of public.${HELPER} in ${latest.file}.`);
    } else {
      if (!latest.body.includes(SOURCE_TABLE)) {
        failures.push(`R3: public.${HELPER} in ${latest.file} no longer reads public.${SOURCE_TABLE}.`);
      }
      if (countCodes(latest.body) > 0) {
        failures.push(
          `R3: public.${HELPER} in ${latest.file} contains a currency literal. The helper owns no list; the table does.`,
        );
      }
    }
  }

  // R4 — every other function created at or after the anchor.
  log.push("R4 every other function created in migrations at or after the anchor:");
  const exemptions = [];
  let r4Judged = 0;
  for (const file of versioned.filter((entry) => entry.version >= RATCHET_VERSION)) {
    const functions = extractFunctions(file.marked);
    if (functions.length === 0) {
      log.push(`  ${file.name}: no function definitions`);
      continue;
    }
    for (const fn of functions) {
      const label = `${fn.schema}.${fn.name} @ ${file.name}`;
      if (fn.schema === "public" && wanted.has(fn.name)) {
        log.push(`  ${label}: judged by ${fn.name === HELPER ? "R3" : "R1"} instead`);
        continue;
      }
      r4Judged += 1;
      // A body this gate cannot delimit is judged as its whole statement, so
      // an unusual quoting style can never hide a list.
      const scope = fn.body ?? fn.statement;
      const reasons = exemptionReasons(scope);
      const reason = inlineCurrencyListReason(withoutSentinels(scope));
      const shape = fn.body == null ? " (body not dollar-quoted, whole statement judged)" : "";
      if (reasons.some((text) => text === "")) {
        failures.push(
          `R4: ${label} carries "${ALLOW_MARKER}" without a reason. Write why the list is not an allow-list after a colon.`,
        );
        log.push(`  ${label}: EXEMPTION MARKER WITHOUT A REASON${shape}`);
        continue;
      }
      if (!reason) {
        log.push(
          `  ${label}: OK, no inline list${shape}` +
            (reasons.length > 0 ? " (carries an exemption marker it does not need)" : ""),
        );
        continue;
      }
      if (reasons.length > 0) {
        exemptions.push({ label, reason, why: reasons.join(" | ") });
        log.push(`  ${label}: EXEMPTED${shape} — list found (${reason}); reason given: ${reasons.join(" | ")}`);
        continue;
      }
      log.push(`  ${label}: VIOLATION${shape}`);
      failures.push(
        `R4: ${label} carries an inline currency list: ${reason}. ` +
          `Ask public.${HELPER}(code) instead; public.${SOURCE_TABLE} owns the list. ` +
          `If the list is not an allow-list (a currency-to-region map, for example), put ` +
          `"-- ${ALLOW_MARKER}: <reason>" inside the function body.`,
      );
    }
  }
  log.push(`R4 totals: ${r4Judged} function definition(s) judged, ${exemptions.length} exemption(s) honoured`);
  for (const exemption of exemptions) log.push(`  exemption honoured: ${exemption.label} — ${exemption.why}`);

  // R2 — CHECK constraints added at or after the anchor.
  log.push("R2 CHECK constraints in migrations at or after the anchor:");
  const judged = versioned.filter((file) => file.version >= RATCHET_VERSION);
  if (judged.length === 0) log.push("  (none at or after the anchor)");
  for (const file of judged) {
    const checks = extractChecks(file.stripped);
    let bad = 0;
    for (const expression of checks) {
      if (!/currency/i.test(expression)) continue;
      const reason =
        inlineCurrencyListReason(expression) ??
        (countCodes(expression) >= 2 ? `${countCodes(expression)} currency literals` : null);
      if (!reason) continue;
      bad += 1;
      failures.push(
        `R2: ${file.name} adds a CHECK on a currency column with an inline code list: ${reason}. ` +
          `Use a foreign key to public.${SOURCE_TABLE}(code) instead. ` +
          `CHECK (${expression.replace(/\s+/g, " ").trim().slice(0, 140)})`,
      );
    }
    log.push(`  ${file.name}: ${checks.length} CHECK expression(s) inspected, ${bad} violation(s)`);
  }

  return { failures, log, exemptions };
}

export function readMigrations(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => ({ name: entry.name, sql: fs.readFileSync(path.join(dir, entry.name), "utf8") }));
}

// ── self-test fixtures ──────────────────────────────────────────────────────
const LIST_BLOCK = `
  IF v_currency <> ALL (
    ARRAY['GBP'::bpchar, 'USD'::bpchar, 'NGN'::bpchar]
  ) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;`;
const HELPER_BLOCK = `
  IF v_currency IS NOT NULL
     AND NOT public.is_supported_offering_currency(v_currency::text) THEN
    RAISE EXCEPTION 'event_currency_unsupported';
  END IF;`;
const fn = (name, block, { tag = "$function$", qualifier = "public." } = {}) => `
CREATE OR REPLACE FUNCTION ${qualifier}${name}(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS ${tag}
DECLARE v_currency character(3) := COALESCE(p->>'currency', 'USD');
BEGIN${block}
  RETURN p;
END;
${tag};`;
const ANCHOR = {
  name: "20270819003645_issue_3645_shared_offering_currency_source.sql",
  sql: `
CREATE OR REPLACE FUNCTION public.is_supported_offering_currency(p_code text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  SELECT EXISTS (SELECT 1 FROM public.supported_brand_currencies AS c WHERE c.active AND c.code = p_code::character(3));
$function$;
ALTER TABLE public.events ADD CONSTRAINT events_currency_supported_fkey
  FOREIGN KEY (currency) REFERENCES public.supported_brand_currencies (code) NOT VALID;`,
};
const OLD = {
  name: "20270505001973_old_bodies.sql",
  sql: OFFERING_FUNCTIONS.map((name) => fn(name, LIST_BLOCK)).join("\n") +
    "\nALTER TABLE public.events ADD CONSTRAINT old_check CHECK (currency = ANY (ARRAY['GBP','USD']::bpchar[]));",
};
const today = () => [OLD, ANCHOR];
const later = (sql, name = "20270820000001_later.sql") => ({ name, sql });

export const SELF_TEST_CASES = [
  { label: "today's tree: old lists before the anchor are not judged", files: today(), pass: true },
  {
    label: "all three re-emitted after the anchor through the helper",
    files: [...today(), later(OFFERING_FUNCTIONS.map((name) => fn(name, HELPER_BLOCK)).join("\n"))],
    pass: true,
  },
  {
    label: "a later definition re-introduces a type-cast list",
    files: [...today(), later(fn("biz_publish_experience", LIST_BLOCK))],
    pass: false,
  },
  {
    label: "a later definition uses an untyped ARRAY list alongside the helper",
    files: [...today(), later(fn("biz_create_experience", `${HELPER_BLOCK}\n  IF v_currency = ANY (ARRAY['GBP','USD']) THEN NULL; END IF;`))],
    pass: false,
  },
  {
    label: "a later definition uses an IN list",
    files: [...today(), later(fn("business_publish_event_draft", `${HELPER_BLOCK}\n  IF v_currency NOT IN ('GBP', 'USD', 'NGN') THEN NULL; END IF;`))],
    pass: false,
  },
  {
    label: "a later definition uses an array string",
    files: [...today(), later(fn("biz_publish_experience", `${HELPER_BLOCK}\n  IF v_currency <> ALL ('{GBP,USD,NGN}'::bpchar[]) THEN NULL; END IF;`))],
    pass: false,
  },
  {
    label: "a later definition raises the refusal without the helper",
    files: [...today(), later(fn("biz_publish_experience", "\n  IF v_currency IS NULL THEN RAISE EXCEPTION 'event_currency_unsupported'; END IF;"))],
    pass: false,
  },
  {
    label: "an unqualified, double-quoted, $$-bodied later definition is still seen",
    files: [...today(), later(fn('"biz_create_experience"', LIST_BLOCK, { tag: "$$", qualifier: "" }))],
    pass: false,
  },
  {
    label: "a list that exists only in comments is not a list",
    files: [
      ...today(),
      later(fn("biz_publish_experience", `${HELPER_BLOCK}\n  -- was: ARRAY['GBP'::bpchar, 'USD'::bpchar]\n  /* and IN ('GBP','USD') */`)),
    ],
    pass: true,
  },
  {
    label: "a single fallback literal is not a list",
    files: [...today(), later(fn("biz_publish_experience", `${HELPER_BLOCK}\n  v_currency := COALESCE(v_currency, 'USD'::bpchar);`))],
    pass: true,
  },
  {
    label: "a violating later definition that is then superseded by a clean one",
    files: [
      ...today(),
      later(fn("biz_publish_experience", LIST_BLOCK), "20270820000001_bad.sql"),
      later(fn("biz_publish_experience", HELPER_BLOCK), "20270821000001_fixed.sql"),
    ],
    pass: true,
  },
  {
    label: "a later migration adds a CHECK listing currencies",
    files: [...today(), later("ALTER TABLE public.trips ADD CONSTRAINT c CHECK (currency = ANY (ARRAY['GBP'::bpchar, 'USD'::bpchar]));")],
    pass: false,
  },
  {
    label: "a later CREATE TABLE column CHECK with an IN list on a currency column",
    files: [...today(), later("CREATE TABLE public.t (payout_currency text CHECK (payout_currency IN ('GBP','NGN')));")],
    pass: false,
  },
  {
    label: "a later CHECK on a non-currency column with three-letter values",
    files: [...today(), later("ALTER TABLE public.t ADD CONSTRAINT c CHECK (state IN ('NEW','OLD'));")],
    pass: true,
  },
  {
    label: "a later currency CHECK that lists nothing (shape only)",
    files: [...today(), later("ALTER TABLE public.t ADD CONSTRAINT c CHECK (currency IS NULL OR currency::text ~ '^[A-Z]{3}$');")],
    pass: true,
  },
  { label: "the anchor migration is gone", files: [OLD, later(ANCHOR.sql, "20270822000001_moved.sql")], pass: false },
  {
    label: "one offering function has no definition anywhere",
    files: [{ name: OLD.name, sql: fn("biz_publish_experience", LIST_BLOCK) + fn("biz_create_experience", LIST_BLOCK) }, ANCHOR],
    pass: false,
  },
  {
    label: "the helper grows its own list",
    files: [
      ...today(),
      later("CREATE OR REPLACE FUNCTION public.is_supported_offering_currency(p_code text) RETURNS boolean LANGUAGE sql AS $f$ SELECT p_code IN ('GBP','USD') $f$;"),
    ],
    pass: false,
  },
  {
    label: "R4: a NEW offering function (not one of the three) with a pasted list",
    files: [...today(), later(fn("biz_publish_stay", LIST_BLOCK))],
    pass: false,
  },
  {
    label: "R4: a new function in another schema, unqualified body tag, IN list",
    files: [...today(), later(fn("pick_rail", "\n  IF v_currency IN ('GBP','USD') THEN NULL; END IF;", { tag: "$$", qualifier: "private." }))],
    pass: false,
  },
  {
    label: "R4: a new offering function that asks the helper",
    files: [...today(), later(fn("biz_publish_stay", HELPER_BLOCK))],
    pass: true,
  },
  {
    label: "R4: a currency-to-region map exempted by a marker with a reason",
    files: [
      ...today(),
      later(fn("currency_region", "\n  -- orch-strict-grep-allow offering-currency-list: maps a currency to a region, admits nothing\n  IF v_currency IN ('GBP','EUR') THEN NULL; END IF;")),
    ],
    pass: true,
    exemptions: 1,
  },
  {
    label: "R4: an exemption marker with no reason is refused",
    files: [
      ...today(),
      later(fn("currency_region", "\n  -- orch-strict-grep-allow offering-currency-list\n  IF v_currency IN ('GBP','EUR') THEN NULL; END IF;")),
    ],
    pass: false,
  },
  {
    label: "R4: a marker outside the function body exempts nothing",
    files: [
      ...today(),
      later("-- orch-strict-grep-allow offering-currency-list: not inside the body\n" + fn("biz_publish_stay", LIST_BLOCK)),
    ],
    pass: false,
  },
  {
    label: "R1 ignores the marker: a named offering function cannot exempt its list",
    files: [
      ...today(),
      later(fn("biz_publish_experience", `\n  -- orch-strict-grep-allow offering-currency-list: trying it on${LIST_BLOCK}`)),
    ],
    pass: false,
  },
  {
    label: "R4: the same new function BEFORE the anchor is not judged",
    files: [...today(), later(fn("biz_publish_stay", LIST_BLOCK), "20270818009999_before_anchor.sql")],
    pass: true,
  },
  {
    label: "R4: a body that is not dollar-quoted is judged as a whole statement",
    files: [
      ...today(),
      later("CREATE FUNCTION public.pick(c text) RETURNS boolean LANGUAGE sql RETURN c = ANY (ARRAY['GBP','USD']);"),
    ],
    pass: false,
  },
  { label: "no migrations at all", files: [], pass: false },
];

function runSelfTest() {
  let wrong = 0;
  for (const testCase of SELF_TEST_CASES) {
    const { failures, exemptions = [] } = evaluate(testCase.files);
    const passed = failures.length === 0;
    const ok = passed === testCase.pass && (testCase.exemptions ?? 0) === exemptions.length;
    if (!ok) wrong += 1;
    console.log(
      `  ${ok ? "ok  " : "WRONG"} expected ${testCase.pass ? "PASS" : "FAIL"}, got ${passed ? "PASS" : "FAIL"}: ${testCase.label}` +
        (ok || passed ? "" : `\n        ${failures.join("\n        ")}`),
    );
  }
  if (wrong > 0) {
    console.error(`${TAG} self-test FAIL: ${wrong} of ${SELF_TEST_CASES.length} cases judged wrongly`);
    process.exit(1);
  }
  const rejected = SELF_TEST_CASES.filter((testCase) => !testCase.pass).length;
  console.log(
    `${TAG} self-test PASS (${SELF_TEST_CASES.length} cases: ${rejected} rejected, ${SELF_TEST_CASES.length - rejected} accepted)`,
  );
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    runSelfTest();
    return;
  }
  const dirFlag = args.indexOf("--migrations-dir");
  const dir = dirFlag === -1 ? "supabase/migrations" : args[dirFlag + 1];
  if (!dir || !fs.existsSync(dir)) {
    console.error(`${TAG} FAIL: migrations directory not found: ${dir}`);
    process.exit(1);
  }
  const { failures, log } = evaluate(readMigrations(dir));
  console.log(`${TAG}: inspecting ${dir}`);
  for (const line of log) console.log(line);
  if (failures.length > 0) {
    console.error(`${TAG} FAIL (${failures.length}):\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`${TAG} PASS: no offering function or constraint at or after ${RATCHET_VERSION} carries its own currency list`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) main();
