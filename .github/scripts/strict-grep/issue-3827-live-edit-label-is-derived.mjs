#!/usr/bin/env node
/**
 * issue #3827 — on a live edit the location label is DERIVED, never assigned.
 * Invariant: I-PROPOSED-3827-LIVE-EDIT-LABEL-MATCHES-STRUCTURED-LOCATION.
 *
 * WHAT SHIPPED, AND WHY A GATE.
 *
 * A published event keeps its location twice: the structured halves in
 * `theme.business_event.location {venueName, address}` (what the editor and the
 * public page read first) and the label `events.location_text`, composed as
 * "venue · address". Publish writes both. The live-edit functions wrote the
 * label only, and wrote ONE half over the whole of it:
 *
 *   location_text=CASE WHEN p_patch ? 'address' THEN NULLIF(p_patch->>'address','')
 *                      WHEN p_patch ? 'venueName' THEN NULLIF(p_patch->>'venueName','') …
 *
 * so a host who changed the address got the old one straight back, and the
 * label lost the venue. Migration 20270828003827 gives the label ONE composer,
 * `public.business_event_location_label(venue, address)`, and every live-edit
 * function derives the label from the stored halves through it.
 *
 * This is a FORWARD RATCHET. It reads only migrations at or after
 * 20270828003827: everything earlier is merged and frozen, and holds the old
 * shape on purpose. PostgreSQL keeps the last definition applied, so the next
 * migration to re-create one of these functions is the one that can put the
 * defect back, and it is the one this gate reads.
 *
 * REQUIRE, for every definition of a LIVE-EDIT FUNCTION in a migration at or
 * after the floor (SQL comments stripped first, so a commented-out fix never
 * reads as present):
 *
 *   L1. The definition calls `business_event_location_label(`.
 *   L2. Every column write `location_text = <expr>` is either the label
 *       variable `v_location_text`, or an expression that calls the composer.
 *       (`ELSE location_text` inside such an expression is "keep what is
 *       stored" and is fine; a bare parameter or payload read is not.)
 *   L3. Every assignment to the label variable, `v_location_text := <expr>`,
 *       either calls the composer or is one of the frozen sources below. A new
 *       source needs a decision, not a quiet addition.
 *   L4. The floor migration exists and defines all three functions, and at
 *       least one definition was read. A gate that discovers nothing FAILS.
 *
 * THE FROZEN SOURCES (L3), and why each is allowed:
 *   - business_patch_event_taxonomy
 *       `NULLIF(btrim(COALESCE(p_location_text, '')), '')` — the incoming
 *         address, normalised. It is the INPUT of the derivation: when it is
 *         non-null the very next branch replaces it with the composer's output.
 *       `v_event.location_text` — "no address sent": keep the stored label.
 *   - biz_update_live_rsvp
 *       `NULLIF(p_payload->>'location_text', '')` — the OLD-CLIENT path. A
 *         payload without the structured `location` key still writes the label
 *         it sends, exactly as before #3827, so installed apps keep working.
 *         This is the one place the invariant's rule is knowingly not enforced
 *         by construction; it closes when no supported client omits `location`.
 *
 * DOES NOT CATCH, stated rather than implied:
 *   - a live-edit function that is not in LIVE_EDIT_FUNCTIONS (a new RPC that
 *     writes `location_text` has to be added here to be read at all);
 *   - a write laundered through a differently named variable, dynamic SQL, or
 *     a helper that itself assigns the column;
 *   - whether the composer is handed the RIGHT two halves. That, and the
 *     equality the invariant states, is proven by the two pg17 suites
 *     (issue_3827_live_edit_location_one_owner.*.pg17.test.sql), not here;
 *   - trip and experience editors, publish, and draft autosave: out of scope.
 *
 * `--self-test` drives the pure core with fixtures, including the exact
 * one-half assignment that shipped. Exit 0 clean / 1 violation.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const MIGRATIONS_DIR = "supabase/migrations";
const FLOOR_PREFIX = "20270828003827";
const FLOOR = `${MIGRATIONS_DIR}/${FLOOR_PREFIX}_issue_3827_live_edit_location_one_owner.sql`;
const COMPOSER = "business_event_location_label";
const LABEL_VARIABLE = "v_location_text";

const LIVE_EDIT_FUNCTIONS = [
  "business_patch_event_taxonomy",
  "business_update_live_event",
  "biz_update_live_rsvp",
];

// L3 — whitespace-normalised. Nothing may be added here without a decision.
const FROZEN_VARIABLE_SOURCES = {
  business_patch_event_taxonomy: [
    "NULLIF(btrim(COALESCE(p_location_text, '')), '')",
    "v_event.location_text",
  ],
  business_update_live_event: [],
  biz_update_live_rsvp: ["NULLIF(p_payload->>'location_text', '')"],
};

// ---- helpers ------------------------------------------------------------

/** Strip SQL line and block comments. A commented-out fix is NOT a fix. */
export const stripSqlComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

const norm = (s) => s.replace(/\s+/g, " ").trim();

export const prefixOf = (rel) => {
  const m = /(\d{14})_/.exec(path.basename(rel));
  return m ? m[1] : null;
};

/** One function's definition: from its CREATE to the next CREATE FUNCTION. */
export function functionDefinition(sql, fn) {
  const start = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`, "i").exec(sql);
  if (start === null) return null;
  const from = start.index + start[0].length;
  const rest = sql.slice(from);
  const next = /CREATE\s+OR\s+REPLACE\s+FUNCTION\b/i.exec(rest);
  return sql.slice(start.index, from + (next === null ? rest.length : next.index));
}

/**
 * The value expression starting at `i`: up to the first comma, semicolon,
 * unbalanced closing paren or WHERE/RETURNING that is outside every paren,
 * every CASE and every quoted literal.
 */
export function valueExpression(sql, i) {
  let depth = 0;
  let caseDepth = 0;
  // A quoted literal is matched first and skipped whole, so a comma, paren or
  // keyword INSIDE a string (a jsonb path like '{location,address}') never
  // ends the expression.
  const tok = /'(?:[^']|'')*'|\b(CASE|END)\b|[(),;]|\b(WHERE|RETURNING)\b/gi;
  tok.lastIndex = i;
  let m;
  while ((m = tok.exec(sql)) !== null) {
    if (m[0].startsWith("'")) continue;
    const t = m[0].toUpperCase();
    if (t === "(") depth++;
    else if (t === ")") {
      if (depth === 0) return sql.slice(i, m.index);
      depth--;
    } else if (t === "CASE") caseDepth++;
    else if (t === "END") { if (caseDepth > 0) caseDepth--; }
    else if (t === ";") return sql.slice(i, m.index);
    else if (depth === 0 && caseDepth === 0) return sql.slice(i, m.index);
  }
  return sql.slice(i);
}

// ---- pure core ----------------------------------------------------------

export function checkLabelIsDerived(files, failures) {
  const migrations = Object.entries(files)
    .filter(([rel]) => rel.startsWith(MIGRATIONS_DIR + "/") && rel.endsWith(".sql"))
    .filter(([rel]) => prefixOf(rel) !== null && prefixOf(rel).localeCompare(FLOOR_PREFIX) >= 0)
    .sort(([a], [b]) => a.localeCompare(b));

  if (files[FLOOR] === undefined) {
    failures.push(
      `${FLOOR}: MISSING. It is the migration that gives the label one composer; without it ` +
      `the live-edit functions are the pre-#3827 bodies and a changed address comes back as ` +
      `the old one (#3827).`,
    );
    return;
  }

  let definitionsRead = 0;
  for (const [rel, raw] of migrations) {
    const sql = stripSqlComments(raw);
    for (const fn of LIVE_EDIT_FUNCTIONS) {
      const def = functionDefinition(sql, fn);
      if (def === null) {
        if (rel === FLOOR) {
          failures.push(
            `${rel}: no longer defines public.${fn}. #3827 corrects all three live-edit ` +
            `functions together; one left on its old body still writes the label from one ` +
            `half (#3827).`,
          );
        }
        continue;
      }
      definitionsRead++;

      // L1
      if (!def.includes(`${COMPOSER}(`)) {
        failures.push(
          `${rel}: public.${fn} never calls ${COMPOSER}(). The label must be DERIVED from the ` +
          `stored venue and address by the one composer; a definition without it is assigning ` +
          `the label some other way (#3827).`,
        );
      }

      // L2 — column writes. `:=` is a variable assignment and is L3's.
      const write = /(?<![\w.])location_text\s*=(?!=)/gi;
      let w;
      while ((w = write.exec(def)) !== null) {
        const expr = norm(valueExpression(def, w.index + w[0].length));
        if (expr === LABEL_VARIABLE) continue;
        if (expr.includes(`${COMPOSER}(`)) continue;
        failures.push(
          `${rel}: public.${fn} writes \`location_text = ${expr.slice(0, 110)}\` — not the ` +
          `label variable and not a call to ${COMPOSER}(). Assigning the label from one half ` +
          `(or from whatever the client sent) is the #3827 defect: the other half is dropped ` +
          `and the structured location the editor reads never moves. Set the half in ` +
          `theme.business_event.location and derive the label (#3827).`,
        );
      }

      // L3 — the label variable's sources.
      const allowed = new Set((FROZEN_VARIABLE_SOURCES[fn] ?? []).map(norm));
      const assign = new RegExp(`(?<![\\w.])${LABEL_VARIABLE}\\s*:=`, "gi");
      let a;
      while ((a = assign.exec(def)) !== null) {
        const expr = norm(valueExpression(def, a.index + a[0].length));
        if (expr.includes(`${COMPOSER}(`)) continue;
        if (allowed.has(expr)) continue;
        failures.push(
          `${rel}: public.${fn} assigns \`${LABEL_VARIABLE} := ${expr.slice(0, 110)}\`, which ` +
          `neither calls ${COMPOSER}() nor is one of the frozen sources for this function. The ` +
          `variable is what gets written to events.location_text, so this is a label that was ` +
          `not composed from the stored halves (#3827).`,
        );
      }
    }
  }

  // L4 — vacuity.
  if (definitionsRead === 0) {
    failures.push(
      `${MIGRATIONS_DIR}: no live-edit function definition was read at or after ` +
      `${FLOOR_PREFIX}. A gate that discovers nothing must FAIL, never pass by vacuity (#3827).`,
    );
  }
}

// ---- file walk ----------------------------------------------------------
function walk(dirAbs, out) {
  if (!fs.existsSync(dirAbs)) return;
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
}

// ---- self-test ----------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (files) => { const f = []; checkLabelIsDerived(files, f); return f; };

  const TAXONOMY_GOOD = [
    "CREATE OR REPLACE FUNCTION public.business_patch_event_taxonomy(p_event_id uuid, p_location_text text)",
    "AS $function$ BEGIN",
    "  -- the label is written from the address: location_text = p_location_text (the old defect, in a comment)",
    "  v_location_text := NULLIF(btrim(COALESCE(p_location_text, '')), '');",
    "  IF v_location_text IS NULL THEN",
    "    v_location_text := v_event.location_text;",
    "  ELSE",
    "    v_theme := public.business_event_theme_with_location(v_event.theme, v_event.location_text, false, NULL, true, v_location_text);",
    "    v_location_text := public.business_event_location_label(",
    "      v_theme #>> '{business_event,location,venueName}',",
    "      v_theme #>> '{business_event,location,address}');",
    "  END IF;",
    "  UPDATE public.events SET",
    "    city = v_city,",
    "    location_text = v_location_text,",
    "    theme = v_theme",
    "  WHERE id = p_event_id;",
    "END; $function$;",
  ].join("\n");

  const LIVE_GOOD = [
    "CREATE OR REPLACE FUNCTION public.business_update_live_event(p_event_id uuid, p_patch jsonb, p_reason text, p_client_revision integer)",
    "AS $fn$ BEGIN",
    "  UPDATE public.events SET",
    "    title=CASE WHEN p_patch ? 'name' THEN NULLIF(btrim(p_patch->>'name'),'') ELSE title END,",
    "    location_text=CASE WHEN v_set_venue OR v_set_address",
    "      THEN public.business_event_location_label(",
    "        v_location_theme#>>'{business_event,location,venueName}',",
    "        v_location_theme#>>'{business_event,location,address}')",
    "      ELSE location_text END,",
    "    online_url=CASE WHEN p_patch ? 'onlineUrl' THEN NULLIF(p_patch->>'onlineUrl','') ELSE online_url END",
    "  WHERE id=p_event_id RETURNING * INTO v_event;",
    "END;$fn$;",
  ].join("\n");

  const RSVP_GOOD = [
    "CREATE OR REPLACE FUNCTION public.biz_update_live_rsvp(p_event_id uuid, p_payload jsonb, p_reason text)",
    "AS $$ BEGIN",
    "  v_location_text := NULLIF(p_payload->>'location_text', '');",
    "  IF jsonb_typeof(p_payload->'location') = 'object' THEN",
    "    v_location_text := public.business_event_location_label(v_location_venue, v_location_address);",
    "  END IF;",
    "  IF v_location_text IS DISTINCT FROM v_existing.location_text THEN v_material_change := true; END IF;",
    "  UPDATE public.events",
    "  SET",
    "    title = v_title,",
    "    location_text = v_location_text,",
    "    online_url = v_online_url",
    "  WHERE id = p_event_id;",
    "END; $$;",
  ].join("\n");

  const FLOOR_GOOD = [TAXONOMY_GOOD, LIVE_GOOD, RSVP_GOOD].join("\n\n");
  const good = { [FLOOR]: FLOOR_GOOD };

  const baseline = run(good);
  if (baseline.length !== 0) {
    selfFailures.push("compliant fixture wrongly flagged: " + JSON.stringify(baseline));
  }

  const expect = (label, files, matcher) => {
    const f = run(files);
    if (f.length === 0) {
      selfFailures.push(`${label} was NOT flagged — this gate is decorative`);
      return;
    }
    if (matcher && !f.some((x) => matcher.test(x))) {
      selfFailures.push(`${label} was flagged, but not by its own rule: ` + JSON.stringify(f));
    }
  };
  const swap = (from, to) => {
    if (!FLOOR_GOOD.includes(from)) throw new Error("self-test fixture drift: " + from.slice(0, 60));
    return { [FLOOR]: FLOOR_GOOD.replace(from, to) };
  };
  const later = (sql) => ({ ...good, "supabase/migrations/20270901000000_later.sql": sql });

  // 1 — the exact one-half assignment that shipped, in the floor migration.
  const SHIPPED_DEFECT =
    "    location_text=CASE WHEN p_patch ? 'address' THEN NULLIF(p_patch->>'address','') " +
    "WHEN p_patch ? 'venueName' THEN NULLIF(p_patch->>'venueName','') ELSE location_text END,";
  expect("the shipped one-half assignment", swap([
    "    location_text=CASE WHEN v_set_venue OR v_set_address",
    "      THEN public.business_event_location_label(",
    "        v_location_theme#>>'{business_event,location,venueName}',",
    "        v_location_theme#>>'{business_event,location,address}')",
    "      ELSE location_text END,",
  ].join("\n"), SHIPPED_DEFECT), /writes `location_text = CASE WHEN p_patch \? 'address'/);

  // 2 — the same defect arriving in a LATER migration that re-creates the function.
  expect("a later migration re-creating the function with the old assignment", later([
    "CREATE OR REPLACE FUNCTION public.business_update_live_event(a uuid, p_patch jsonb, c text, d integer)",
    "AS $fn$ BEGIN",
    "  PERFORM public.business_event_location_label('a','b');",
    "  UPDATE public.events SET",
    SHIPPED_DEFECT,
    "    updated_at=now() WHERE id=a;",
    "END;$fn$;",
  ].join("\n")), /20270901000000_later\.sql: public\.business_update_live_event writes/);

  // 3 — the taxonomy defect: the address written straight to the label.
  expect("the taxonomy address written straight to the label", swap(
    "    location_text = v_location_text,\n    theme = v_theme",
    "    location_text = NULLIF(btrim(COALESCE(p_location_text, '')), ''),\n    theme = v_theme"),
    /public\.business_patch_event_taxonomy writes `location_text = NULLIF\(btrim/);

  // 4 — the label variable fed from somewhere new.
  expect("the label variable assigned from a raw payload key", swap(
    "    v_location_text := public.business_event_location_label(v_location_venue, v_location_address);",
    "    v_location_text := p_payload #>> '{location,address}';"),
    /assigns `v_location_text := p_payload #>> '\{location,address\}'`/);

  // 5 — a frozen source used in a function it was not frozen for.
  expect("the old-client RSVP source borrowed by the event function", later([
    "CREATE OR REPLACE FUNCTION public.business_update_live_event(a uuid, p_payload jsonb, c text, d integer)",
    "AS $fn$ BEGIN",
    "  PERFORM public.business_event_location_label('a','b');",
    "  v_location_text := NULLIF(p_payload->>'location_text', '');",
    "  UPDATE public.events SET location_text = v_location_text WHERE id=a;",
    "END;$fn$;",
  ].join("\n")), /public\.business_update_live_event assigns `v_location_text := NULLIF\(p_payload->>'location_text', ''\)`/);

  // 6 — the composer gone from a definition entirely.
  expect("a definition that never calls the composer", later([
    "CREATE OR REPLACE FUNCTION public.biz_update_live_rsvp(a uuid, p_payload jsonb, c text)",
    "AS $$ BEGIN",
    "  v_location_text := NULLIF(p_payload->>'location_text', '');",
    "  UPDATE public.events SET location_text = v_location_text WHERE id = a;",
    "END; $$;",
  ].join("\n")), /public\.biz_update_live_rsvp never calls business_event_location_label\(\)/);

  // 7 — the composer present only in a comment.
  expect("the composer only mentioned in a comment", later([
    "CREATE OR REPLACE FUNCTION public.biz_update_live_rsvp(a uuid, p_payload jsonb, c text)",
    "AS $$ BEGIN",
    "  -- v_location_text := public.business_event_location_label(v, a);",
    "  v_location_text := NULLIF(p_payload->>'location_text', '');",
    "  UPDATE public.events SET location_text = v_location_text WHERE id = a;",
    "END; $$;",
  ].join("\n")), /never calls business_event_location_label\(\)/);

  // 8 — the floor migration losing one of the three functions.
  expect("the floor migration no longer defining biz_update_live_rsvp",
    { [FLOOR]: [TAXONOMY_GOOD, LIVE_GOOD].join("\n\n") },
    /no longer defines public\.biz_update_live_rsvp/);

  // 9 — the floor migration deleted.
  expect("the floor migration deleted",
    { "supabase/migrations/20270901000000_later.sql": LIVE_GOOD }, /MISSING/);

  // 10 — FORWARD ratchet: the old shape in a migration BEFORE the floor is
  // frozen history and must not be flagged.
  const history = run({
    ...good,
    "supabase/migrations/20270429002353_issue_2353_format_truth_and_edit_grant.sql": [
      "CREATE OR REPLACE FUNCTION public.business_update_live_event(a uuid, p_patch jsonb, c text, d integer)",
      "AS $fn$ BEGIN UPDATE public.events SET",
      SHIPPED_DEFECT,
      "    updated_at=now() WHERE id=a; END;$fn$;",
    ].join("\n"),
  });
  if (history.length !== 0) {
    selfFailures.push("a frozen pre-floor migration was wrongly flagged: " + JSON.stringify(history));
  }

  // 11 — a comparison is not a write, and another column ending in the same
  // name is not this column.
  const notAWrite = run(later([
    "CREATE OR REPLACE FUNCTION public.biz_update_live_rsvp(a uuid, p_payload jsonb, c text)",
    "AS $$ BEGIN",
    "  v_location_text := public.business_event_location_label(v, w);",
    "  IF v_existing.location_text = 'x' OR old_location_text == 'y' THEN NULL; END IF;",
    "  UPDATE public.events SET location_text = v_location_text, prior_location_text = p_payload->>'x' WHERE id = a;",
    "END; $$;",
  ].join("\n")));
  if (notAWrite.length !== 0) {
    selfFailures.push("a comparison or a different column was wrongly flagged: " + JSON.stringify(notAWrite));
  }

  // 12 — vacuity: an empty file map must not pass.
  if (run({}).length === 0) {
    selfFailures.push("an EMPTY file map passed — matched-nothing-therefore-green");
  }

  if (selfFailures.length) {
    console.error("#3827 live-edit-label-is-derived self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "#3827 live-edit-label-is-derived self-test PASS (13 cases: the compliant fixture; the\n" +
      "  one-half assignment that shipped, in the floor migration and in a later one; the\n" +
      "  taxonomy address written straight to the label; the label variable fed from a raw\n" +
      "  payload key; a frozen source borrowed by another function; the composer gone, and\n" +
      "  present only in a comment; the floor migration losing a function, and deleted; a\n" +
      "  frozen pre-floor migration left alone; a comparison and a look-alike column left\n" +
      "  alone; and the empty-map vacuity check).",
  );
  process.exit(0);
}

// ---- live mode ----------------------------------------------------------
const files = {};
const migAbs = [];
walk(path.join(root, MIGRATIONS_DIR), migAbs);
for (const abs of migAbs) {
  if (!abs.endsWith(".sql")) continue;
  files[path.relative(root, abs)] = fs.readFileSync(abs, "utf8");
}

const failures = [];
checkLabelIsDerived(files, failures);

if (failures.length > 0) {
  console.error(
    "#3827 (I-PROPOSED-3827-LIVE-EDIT-LABEL-MATCHES-STRUCTURED-LOCATION) FAIL — on a live edit\n" +
      "events.location_text must be derived from the stored venue and address by\n" +
      "business_event_location_label(), never assigned from one half or from the client.\n\n" +
      "Failures:\n  " + failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "#3827 PASS — every live-edit function defined at or after 20270828003827 calls\n" +
    "business_event_location_label(), writes events.location_text only from the label variable\n" +
    "or the composer, and feeds that variable only from the composer or a frozen source.",
);
