#!/usr/bin/env node
/**
 * issue #1254 — HARDENS #1026 (RSVP chip-in draft settings wiped on autosave).
 * Enforces the ACTIVE invariant I-PROPOSED-1026-DRAFT-MAPPER-COMPILE-COMPLETE
 * (docs/INVARIANT_REGISTRY.md).
 *
 * THE BUG CLASS THIS GATE STRUCTURALLY RETIRES. `serverRowToDraft` in
 * mingla-business/src/utils/serverDraftEventMapper.ts maps a server row to a
 * DraftEvent. For years its object literal was closed `} as DraftEvent;` — a
 * type ASSERTION. Because the literal already carried ~47 of DraftEvent's ~50
 * required fields, TypeScript treats `{...} as DraftEvent` as a "sufficient
 * overlap" cast and raises NO error when a handful of required fields are
 * OMITTED. So three separate times a required-field read was silently dropped
 * and shipped GREEN — the ORCH-0841 taxonomy contract, #1022 theme overrides,
 * and #1026 chip-in — each one wiping user data on the autosave echo. #1026
 * fixed the READ and changed the closure to `} satisfies DraftEvent;`.
 *
 * WHY `satisfies` ALONE IS NOT ENOUGH (THE GAP THIS GATE CLOSES). `satisfies`
 * makes a DROPPED FIELD a compile error. It does NOT stop a future edit from
 * reverting `satisfies DraftEvent` back to `as DraftEvent` while keeping every
 * field — that revert reintroduces zero tsc errors today, and silently
 * restores the masking so the NEXT dropped-field bug ships green again. A
 * strict-grep gate that bans the assertion is the only thing that structurally
 * forbids the revert. #1026 shipped WITHOUT this gate and its CLOSE note flagged
 * it as the recommended low-cost hardening follow-up; #1254 is that follow-up.
 *
 * WHY `as DraftEvent` IS THE ONE UNSAFE FORM (and both allowed forms are safe).
 * The pre-#1026 signature ALREADY read `(row: ServerDraftEventRow): DraftEvent`.
 * The return annotation did NOT catch the omission because the `as DraftEvent`
 * assertion on the returned expression re-types it to DraftEvent, satisfying the
 * annotation with a laundered value. Remove the assertion and EITHER safe form
 * restores the check:
 *   (1) `} satisfies DraftEvent;`  — structural check of the literal (TS2741 on omit)
 *   (2) bare `return { ... };` under the `: DraftEvent` return annotation
 *       — contextual typing of the literal (TS2741 on omit)
 * So the contract is: NO `as DraftEvent` / `as unknown as DraftEvent` assertion,
 * AND a compiler anchor (satisfies OR the return annotation) must be present.
 *
 * Over the ISOLATED serverRowToDraft function (signature + body, comments AND
 * string/template literals stripped so a cast cannot hide behind `//` and a
 * `"as DraftEvent"` string cannot false-trip) REQUIRE:
 *   R1 — NO `as DraftEvent` / `as unknown as DraftEvent` assertion
 *        (whitespace/newline-tolerant between every token). This is the teeth.
 *   R2 — a compiler anchor exists: `satisfies DraftEvent` in the body, OR the
 *        `(...): DraftEvent =>` return annotation on the signature. Without one,
 *        a bare literal is unchecked and a dropped field ships green.
 *
 * If serverRowToDraft cannot be located at all, that is a HARD FAILURE (exit 1),
 * never a silent pass — a rename must not make this gate go dark.
 *
 * --self-test injects self-contained fixtures (no repo file): the prescribed
 * satisfies form passes; the bare-return-under-annotation form passes; the
 * `as DraftEvent` and `as unknown as DraftEvent` reverts fire; a comment/string
 * merely MENTIONING `as DraftEvent` does not false-trip; a literal with neither
 * a satisfies nor a return annotation fires.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const TARGET = "mingla-business/src/utils/serverDraftEventMapper.ts";

// R1 — the banned assertion. `as` [optionally `unknown as`] [optional open paren]
// `DraftEvent` at a word boundary. `\s+` matches newlines, so `as\nDraftEvent`
// and `as unknown\n  as DraftEvent` are both caught. The single form `as
// DraftEvent` also catches the TAIL of `as unknown as DraftEvent`, but the
// dedicated `unknown as` alternation keeps the intent explicit.
const BANNED_CAST = /\bas\s+(?:unknown\s+as\s+)?\(?\s*DraftEvent\b/;
// R2a — the `satisfies` compiler anchor on the returned literal.
const SATISFIES_ANCHOR = /\bsatisfies\s+DraftEvent\b/;
// R2b — the `(...): DraftEvent =>` return-type annotation. Anchored on `)` +
// `:` so the `DraftEvent` substring inside the `ServerDraftEventRow` PARAM type
// can never match (that DraftEvent is not at a right word boundary and is not
// after the param-list close paren + colon).
const RETURN_ANNOTATION = /\)\s*:\s*DraftEvent\s*=>/;

/**
 * Blank out `//` and block comments and single/double/template string contents,
 * preserving newlines and byte offsets so brace-matching stays correct. A cast
 * cannot hide behind a comment (it is removed), and a string literal that quotes
 * the banned pattern cannot false-trip (its contents are blanked).
 */
export function stripCommentsAndStrings(src) {
  let out = "";
  let state = "code"; // code | line | block | sq | dq | tpl
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === "code") {
      if (c === "/" && c2 === "/") { out += "  "; state = "line"; i += 2; continue; }
      if (c === "/" && c2 === "*") { out += "  "; state = "block"; i += 2; continue; }
      if (c === "'") { out += " "; state = "sq"; i += 1; continue; }
      if (c === '"') { out += " "; state = "dq"; i += 1; continue; }
      if (c === "`") { out += " "; state = "tpl"; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === "line") {
      if (c === "\n") { out += "\n"; state = "code"; i += 1; continue; }
      out += c === "\t" ? "\t" : " "; i += 1; continue;
    }
    if (state === "block") {
      if (c === "*" && c2 === "/") { out += "  "; state = "code"; i += 2; continue; }
      out += c === "\n" ? "\n" : " "; i += 1; continue;
    }
    // string states: sq / dq / tpl
    if (c === "\\") { out += "  "; i += 2; continue; } // escape — blank the pair
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) {
      out += " "; state = "code"; i += 1; continue;
    }
    out += c === "\n" ? "\n" : " "; i += 1; continue;
  }
  return out;
}

/**
 * Isolate the serverRowToDraft function (signature through its matching close
 * brace) from ALREADY-stripped source. Returns null if not found or unbalanced.
 */
export function isolateServerRowToDraft(stripped) {
  // Match the name through the arrow body-open brace, non-greedily skipping the
  // param list and return type. Falls back to a `function serverRowToDraft(...)`
  // declaration form if there is no arrow.
  const arrowSig = /\bserverRowToDraft\b[\s\S]*?=>\s*\{/.exec(stripped);
  const fnSig = /\bfunction\s+serverRowToDraft\b[\s\S]*?\)\s*(?::[\s\S]*?)?\{/.exec(stripped);
  const sig = arrowSig ?? fnSig;
  if (!sig) return null;
  const start = sig.index;
  const openBrace = start + sig[0].length - 1; // index of the body-open `{`
  let depth = 0;
  for (let i = openBrace; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  return null; // unbalanced — treated as "not found" by the caller (hard fail)
}

/** Core check. Returns a list of failure strings (empty === pass). */
export function checkMapperSource(rawSrc) {
  const failures = [];
  const stripped = stripCommentsAndStrings(rawSrc);
  const fn = isolateServerRowToDraft(stripped);

  if (fn == null) {
    failures.push(
      `${TARGET}: could not locate the serverRowToDraft function (renamed, removed, or ` +
        `unbalanced braces). This gate must not go dark — restore the function or update ` +
        `the gate in the SAME PR under issue #1254.`,
    );
    return failures;
  }

  // R1 — the banned assertion (the exact #1026 masking that shipped 3x).
  if (BANNED_CAST.test(fn)) {
    failures.push(
      `${TARGET}: serverRowToDraft closes its returned object with an error-suppressing ` +
        `\`as DraftEvent\` / \`as unknown as DraftEvent\` assertion. That launders a ` +
        `near-complete literal into DraftEvent and suppresses the missing-required-field ` +
        `compile error — the exact masking that let the #1026 draft-wipe bug class ship ` +
        `three times. Close the literal with \`} satisfies DraftEvent;\` (or a bare ` +
        `\`return { ... };\` under the \`: DraftEvent\` return annotation). ` +
        `I-PROPOSED-1026-DRAFT-MAPPER-COMPILE-COMPLETE.`,
    );
  }

  // R2 — a compiler anchor must exist (satisfies OR the return annotation),
  // otherwise a bare literal is unchecked and a dropped field ships green.
  if (!SATISFIES_ANCHOR.test(fn) && !RETURN_ANNOTATION.test(fn)) {
    failures.push(
      `${TARGET}: serverRowToDraft has no compiler anchor on its return — neither a ` +
        `\`satisfies DraftEvent\` on the returned literal nor a \`(...): DraftEvent =>\` ` +
        `return annotation. Without one, the returned object is unchecked and a forgotten ` +
        `required-field read compiles green (the #1026 bug class). Add ` +
        `\`} satisfies DraftEvent;\`. I-PROPOSED-1026-DRAFT-MAPPER-COMPILE-COMPLETE.`,
    );
  }

  return failures;
}

// ---------------------------------------------------------------- self-test
function selfTest() {
  const bad = [];
  const run = (src) => checkMapperSource(src);

  // (d) PRESCRIBED form — `} satisfies DraftEvent;` — must PASS.
  const satisfiesForm = `
export const serverRowToDraft = (row: ServerDraftEventRow): DraftEvent => {
  const theme = asRecord(row.theme);
  return {
    id: row.id,
    name: row.title,
    recurrenceRule: businessDraft.recurrenceRule as RecurrenceRule,
    rsvpContributionEnabled: asBoolean(businessDraft.rsvpContributionEnabled, false),
  } satisfies DraftEvent;
};
`;
  if (run(satisfiesForm).length !== 0) {
    bad.push("(d) prescribed `satisfies DraftEvent` form wrongly flagged: " + JSON.stringify(run(satisfiesForm)));
  }

  // (f) ALLOWED alt form — bare return under the `: DraftEvent` annotation — must PASS.
  const bareReturnForm = `
export const serverRowToDraft = (row: ServerDraftEventRow): DraftEvent => {
  return {
    id: row.id,
    name: row.title,
  };
};
`;
  if (run(bareReturnForm).length !== 0) {
    bad.push("(f) allowed bare-return-under-annotation form wrongly flagged: " + JSON.stringify(run(bareReturnForm)));
  }

  // (a) the banned `as DraftEvent` revert (the literal #1026 pre-fix shape) — must FIRE.
  const asForm = `
export const serverRowToDraft = (row: ServerDraftEventRow): DraftEvent => {
  return {
    id: row.id,
    name: row.title,
  } as DraftEvent;
};
`;
  if (run(asForm).length === 0) bad.push("(a) `as DraftEvent` revert NOT flagged");

  // (b) `as unknown as DraftEvent` (double assertion) — must FIRE.
  const asUnknownForm = `
export const serverRowToDraft = (row: ServerDraftEventRow): DraftEvent => {
  return {
    id: row.id,
  } as unknown as DraftEvent;
};
`;
  if (run(asUnknownForm).length === 0) bad.push("(b) `as unknown as DraftEvent` revert NOT flagged");

  // (b2) newline-tolerance — `as\n DraftEvent` split across lines — must FIRE.
  const asNewlineForm = `
export const serverRowToDraft = (row: ServerDraftEventRow): DraftEvent => {
  return {
    id: row.id,
  } as
    DraftEvent;
};
`;
  if (run(asNewlineForm).length === 0) bad.push("(b2) newline-split `as\\n DraftEvent` NOT flagged (whitespace-tolerance broken)");

  // (c) a COMMENT and a STRING merely MENTIONING `as DraftEvent` — must NOT false-trip.
  const commentMentionForm = `
export const serverRowToDraft = (row: ServerDraftEventRow): DraftEvent => {
  // historical note: this used to close with } as DraftEvent; before #1026
  /* another mention: as unknown as DraftEvent */
  const label = "closed as DraftEvent in the bad old days";
  return {
    id: row.id,
    note: label,
  } satisfies DraftEvent;
};
`;
  if (run(commentMentionForm).length !== 0) {
    bad.push("(c) `as DraftEvent` inside a comment/string wrongly flagged (comment/string strip broken): " + JSON.stringify(run(commentMentionForm)));
  }

  // (e) missing anchor — neither `satisfies` nor a `: DraftEvent` annotation — must FIRE.
  const noAnchorForm = `
export const serverRowToDraft = (row) => {
  return {
    id: row.id,
    name: row.title,
  };
};
`;
  if (run(noAnchorForm).length === 0) bad.push("(e) missing-anchor (no satisfies, no return annotation) NOT flagged");

  // (g) real cast NOT hidden by a trailing line comment on the same line — must FIRE.
  const castWithTrailingComment = `
export const serverRowToDraft = (row: ServerDraftEventRow): DraftEvent => {
  return {
    id: row.id,
  } as DraftEvent; // reverted #1026 — should be caught, not excused by this comment
};
`;
  if (run(castWithTrailingComment).length === 0) bad.push("(g) real `as DraftEvent` cast with a trailing // comment NOT flagged");

  // (h) function renamed away — the gate must HARD-FAIL, never silently pass.
  const renamedAway = `
export const serverRowToSomethingElse = (row: ServerDraftEventRow): DraftEvent => {
  return { id: row.id } satisfies DraftEvent;
};
`;
  if (run(renamedAway).length === 0) bad.push("(h) serverRowToDraft renamed away NOT flagged (gate would go dark)");

  if (bad.length) {
    console.error("issue #1254 mapper-no-error-suppressing-cast self-test FAIL:");
    for (const m of bad) console.error("  - " + m);
    process.exit(1);
  }
  console.log(
    "issue #1254 / I-PROPOSED-1026-DRAFT-MAPPER-COMPILE-COMPLETE self-test PASS (9/9 cases:\n" +
      "  satisfies form + bare-return-under-annotation PASS; `as DraftEvent`, `as unknown as\n" +
      "  DraftEvent`, and newline-split `as\\n DraftEvent` reverts FIRE; comment/string mention\n" +
      "  does NOT false-trip; missing-anchor FIRES; a real cast with a trailing // comment\n" +
      "  FIRES; a renamed-away function HARD-FAILS instead of going dark).",
  );
  process.exit(0);
}

// ---------------------------------------------------------------- live mode
function liveRun() {
  const abs = path.join(REPO_ROOT, TARGET);
  if (!fs.existsSync(abs)) {
    console.error(
      `issue #1254 FAIL — target not found at ${TARGET}. The mapper this gate guards is ` +
        `missing or moved; restore it or update the gate under issue #1254 (do not let the ` +
        `gate go dark).`,
    );
    process.exit(1);
  }
  const failures = checkMapperSource(fs.readFileSync(abs, "utf8"));
  if (failures.length) {
    console.error(
      "issue #1254 / I-PROPOSED-1026-DRAFT-MAPPER-COMPILE-COMPLETE FAIL — serverRowToDraft " +
        "must be checked against DraftEvent by the compiler with NO error-suppressing " +
        "assertion, so a forgotten required-field read is a compile error, not a silent " +
        "runtime draft wipe (the bug class that recurred three times: ORCH-0841 taxonomy, " +
        "#1022 theme overrides, #1026 chip-in).\n\nFailures:\n  " + failures.join("\n  "),
    );
    process.exit(1);
  }
  console.log(
    `issue #1254 PASS — ${TARGET} serverRowToDraft closes its returned object under a ` +
      "compiler anchor (satisfies DraftEvent / a `: DraftEvent` return annotation) and carries " +
      "NO `as DraftEvent` / `as unknown as DraftEvent` assertion. A dropped required-field read " +
      "is now a hard compile error. I-PROPOSED-1026-DRAFT-MAPPER-COMPILE-COMPLETE.",
  );
}

if (process.argv.includes("--self-test")) selfTest();
else liveRun();
