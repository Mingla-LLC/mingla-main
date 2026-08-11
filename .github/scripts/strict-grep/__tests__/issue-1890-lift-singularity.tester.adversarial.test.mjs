/**
 * #1890 [keyboard-clearance-overshoot] — TESTER adversarial regression proof.
 *
 * The implementor's happy-path proof (issue_1890_ari_composer_clearance.happy.test.ts)
 * mounts AriChatScreen and reads the resolved `paddingBottom` off the composer
 * wrapper, firing every `onLayout` in that subtree at 52 and 200 and requiring the
 * two readings to be identical. That is the right assertion for the defect that
 * shipped, and it goes red on revert (measured: 461 vs 609, a 148 delta).
 *
 * It reads ONE style key on ONE node, and rule (E) of
 * `i-1047-biz-keyboard-toolbar-keyed-offset.mjs` inspects ONE expression found by a
 * NON-GLOBAL regex. This file attacks the two gaps that leaves — both of which were
 * reproduced against the shipped tree before this test was written, and both of
 * which re-introduce the exact 60pt/60dp dead gap #1890 removed:
 *
 *   S-1  LIFT SINGULARITY. Rule (E)'s `lift` pattern carries no `g` flag, so
 *        `.exec()` validates the FIRST `keyboardHeight > 0 ? …` site in the file and
 *        never sees any later one. MEASURED on the shipped tree: adding a decoy
 *        `keyboardHeight > 0 ? keyboardHeight : 1` ABOVE the real lift — whose token
 *        set is legal — and restoring `+ composerPillH` to the real lift leaves the
 *        gate at exit 0. The rule is disarmed by an expression it approves of.
 *        Nothing in the tree pins the site count, so this does.
 *
 *   S-2  SOLE BOTTOM SPACER. Rule (E) reads only the lift expression, and the
 *        happy-path proof reads only `paddingBottom`. Neither can see a measured
 *        pill height that returns through a DIFFERENT bottom-spacing property on the
 *        same `inputWrap` node. MEASURED on the shipped tree: adding
 *        `marginBottom: keyboardHeight > 0 ? pillH : 0` AFTER the `paddingBottom`
 *        key leaves the gate at exit 0 and leaves `paddingBottom` bit-identical, so
 *        the happy-path assertion stays green while the pill is lifted twice again.
 *        `inputWrap` must therefore declare exactly one bottom spacer.
 *
 * Both rules are stated against the PRODUCT source. Neither restates a rule regex
 * from the gate: the lift pattern and the legal identifier set are EXTRACTED from
 * the gate's own source at run time (`liftPattern()`, `allowedTerms()`), so if the
 * gate is repointed and this file is not, the extraction fails loudly rather than
 * validating a stale copy of a pattern nobody enforces any more.
 *
 * FAILS ON REVERT. S-3 rebuilds the lift's identifier set from the product source
 * and requires it to equal the gate's own `terms`. Restoring
 * `+ spacing.sm + DONE_BAR_OCCUPIED + composerHeight + 12` puts `spacing`, `sm`,
 * `composerHeight` and `12` back into that set and S-3 goes red.
 *
 * EMPTY SCAN IS A FAILURE, NOT A PASS. Every rule below counts what it scanned and
 * asserts the count is non-zero, and each has a seeded bad fixture proving the rule
 * can still see. A rule that resolves nothing reads identically to a rule that
 * holds, which is the failure mode this issue family keeps producing.
 *
 * Append-only: this file is new and edits nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SG = path.resolve(HERE, "..");
const REPO = path.resolve(SG, "../../..");
const BIZ = path.join(REPO, "mingla-business");

const GATE_REL = "i-1047-biz-keyboard-toolbar-keyed-offset.mjs";
const ARI_REL = "src/screens/ari/AriChatScreen.tsx";

/** Read a file, or fail the rule — never skip it. */
function mustRead(abs, what) {
  if (!fs.existsSync(abs)) {
    throw new Error(
      `[#1890] ${what} is MISSING at ${abs}. A rule whose subject has disappeared checks ` +
        "nothing and would read identically to a rule that holds.",
    );
  }
  const src = fs.readFileSync(abs, "utf8");
  if (src.trim().length === 0) {
    throw new Error(`[#1890] ${what} is EMPTY at ${abs}. An empty scan is a failure, not a pass.`);
  }
  return src;
}

const gateSource = () => mustRead(path.join(SG, GATE_REL), "the keyboard gate");
const ariSource = () => mustRead(path.join(BIZ, ARI_REL), "AriChatScreen.tsx");

/**
 * The gate's OWN lift pattern, lifted out of its source rather than restated here.
 * Returns { source, flags } for the regex literal on the `lift:` property.
 */
function liftPattern(src = gateSource()) {
  const m = /\blift:\s*\/((?:\\.|\[(?:\\.|[^\]])*\]|[^/\\])+)\/([a-z]*)/.exec(src);
  if (m === null) {
    throw new Error(
      "[#1890] could not extract the gate's `lift:` pattern from its source. This test derives " +
        "its scan from the gate rather than copying it, so an unextractable pattern means the " +
        "gate moved and this rule is checking nothing.",
    );
  }
  return { source: m[1], flags: m[2] };
}

/** The gate's OWN legal identifier set for the lift, read from its source. */
function allowedTerms(src = gateSource()) {
  const m = /\bterms:\s*\[([^\]]*)\]/.exec(src);
  if (m === null) {
    throw new Error("[#1890] could not extract the gate's `terms:` allow-list from its source.");
  }
  const terms = [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
  if (terms.length === 0) {
    throw new Error("[#1890] the gate's `terms:` allow-list extracted EMPTY — an empty allow-list checks nothing.");
  }
  return terms;
}

/** Comments never satisfy and never violate a source rule. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * Every keyboard-open lift SITE in a source, counted with the gate's own pattern
 * re-flagged global. The capture group is dropped so the count is of sites, not
 * of captured bodies.
 */
function liftSites(source) {
  const { source: pat } = liftPattern();
  const head = pat.replace(/\(([^)]*)\)\s*$/, "");
  return [...stripComments(source).matchAll(new RegExp(head, "g"))].length;
}

/** Bottom-spacing keys a style object may not use to smuggle a measured height. */
const BOTTOM_SPACERS = ["paddingBottom", "marginBottom", "paddingVertical", "marginVertical", "transform"];

/**
 * The dynamic style override object applied alongside `styles.inputWrap` — the
 * object literal inside `style={[styles.inputWrap, { … }]}`. Returned as text so
 * its keys can be counted.
 */
function inputWrapOverride(source) {
  const code = stripComments(source);
  const at = code.indexOf("styles.inputWrap");
  if (at === -1) {
    throw new Error(
      "[#1890] could not find the `styles.inputWrap` style application in AriChatScreen.tsx. " +
        "This rule is about the node whose paddingBottom positions the composer pill's bottom " +
        "edge; if that node cannot be located the rule checks nothing.",
    );
  }
  const open = code.indexOf("{", at);
  if (open === -1) throw new Error("[#1890] `styles.inputWrap` has no override object after it.");
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  throw new Error("[#1890] the `styles.inputWrap` override object is unterminated.");
}

// ── S-1 ─────────────────────────────────────────────────────────────────────
test("S-1 AriChatScreen declares exactly ONE keyboard-open lift site — rule (E) is non-global and validates only the first", () => {
  const { flags } = liftPattern();
  assert.ok(
    !flags.includes("g"),
    "the gate's lift pattern has become global; if `.exec` now walks every site this rule's premise " +
      "is gone and it should be re-derived rather than left asserting a fixed number.",
  );

  const src = ariSource();
  const sites = liftSites(src);
  assert.ok(sites > 0, "EMPTY SCAN: no keyboard-open lift site found in AriChatScreen.tsx — the rule saw nothing.");
  assert.equal(
    sites,
    1,
    `AriChatScreen.tsx declares ${sites} keyboard-open lift sites. Rule (E) of the keyboard gate ` +
      "matches with a NON-GLOBAL regex, so it validates the FIRST site and never sees the rest. " +
      "MEASURED on the shipped tree: a decoy site whose tokens are all legal, placed above the real " +
      "lift, leaves the gate at exit 0 with the pill-height double count fully restored. One site, " +
      "or repoint rule (E) in the same PR.",
  );

  // SEEDED BAD FIXTURE — the rule must still be able to see a second site.
  const decoyed = src.replace(
    "export const AriChatScreen",
    "const _decoy = (keyboardHeight) => keyboardHeight > 0 ? keyboardHeight : 1;\nexport const AriChatScreen",
  );
  assert.notEqual(decoyed, src, "fixture did not seed a decoy lift site");
  assert.equal(liftSites(decoyed), 2, "the seeded decoy was NOT detected — this rule is blind and would pass vacuously");
});

// ── S-2 ─────────────────────────────────────────────────────────────────────
test("S-2 inputWrap declares exactly ONE bottom spacer — a sibling spacing prop is invisible to both existing proofs", () => {
  const src = ariSource();
  const override = inputWrapOverride(src);
  assert.ok(override.length > 0, "EMPTY SCAN: the inputWrap override object resolved empty.");

  const present = BOTTOM_SPACERS.filter((k) => new RegExp(`\\b${k}\\s*:`).test(override));
  assert.deepEqual(
    present,
    ["paddingBottom"],
    `inputWrap's dynamic style declares ${JSON.stringify(present)}. It may declare exactly one bottom ` +
      "spacer — `paddingBottom` — because that single value IS the composer pill's bottom edge. " +
      "MEASURED on the shipped tree: adding `marginBottom: keyboardHeight > 0 ? pillH : 0` after the " +
      "paddingBottom key leaves the keyboard gate at exit 0 AND leaves paddingBottom bit-identical, so " +
      "the happy-path proof's 52-vs-200 assertion stays green while the pill is lifted twice again.",
  );

  // SEEDED BAD FIXTURE — the rule must still be able to see a smuggled spacer.
  //
  // Spliced into the override span by INDEX, not by an indentation string: the
  // `emptyOverlay` block earlier in this file carries a more deeply indented
  // `paddingBottom:` whose tail matches any such anchor, so a string-anchored
  // fixture silently seeds the wrong node and the rule correctly reports "not
  // detected". That near-miss is the reason this splice is positional.
  const stripped = stripComments(src);
  const smuggled = stripped.replace(override, `{\n  marginBottom: keyboardHeight > 0 ? pillH : 0,${override.slice(1)}`);
  assert.notEqual(smuggled, stripped, "fixture did not seed a sibling bottom spacer");
  const seeded = BOTTOM_SPACERS.filter((k) => new RegExp(`\\b${k}\\s*:`).test(inputWrapOverride(smuggled)));
  assert.ok(
    seeded.includes("marginBottom"),
    "the seeded sibling spacer was NOT detected — this rule is blind and would pass vacuously",
  );
});

// ── S-3 ─────────────────────────────────────────────────────────────────────
test("S-3 the lift's identifier set equals the gate's own allow-list — FAILS ON REVERT", () => {
  const terms = allowedTerms();
  const { source: pat } = liftPattern();
  const m = new RegExp(pat).exec(stripComments(ariSource()));
  assert.ok(
    m !== null,
    "EMPTY SCAN: the gate's own lift pattern matched nothing in AriChatScreen.tsx. A rule that cannot " +
      "find its subject checks nothing.",
  );

  const tokens = [...new Set(m[1].match(/[A-Za-z_$][\w$]*|\d+(?:\.\d+)?/g) ?? [])];
  assert.ok(tokens.length > 0, "EMPTY SCAN: the lift expression tokenised to nothing.");

  const extra = tokens.filter((t) => !terms.includes(t)).sort();
  assert.deepEqual(
    extra,
    [],
    `the keyboard-open lift carries ${JSON.stringify(extra)} beyond ${JSON.stringify(terms)}. ` +
      "`inputWrap`'s paddingBottom already positions the pill's bottom edge, so any pill-height term, " +
      "spacing term or hand-typed number lifts it a second time — measured at 72.00pt of gap on an " +
      "iPhone SE3 and 71.82dp on a physical Samsung against a 12pt contract, both restored to 12.00 / " +
      "11.73 by removing exactly these terms.",
  );

  // The allow-list itself must not be the thing that drifted.
  assert.ok(
    terms.includes("keyboardHeight") && terms.length >= 3,
    `the gate's lift allow-list is ${JSON.stringify(terms)} — widening it is how this rule stops biting.`,
  );
});

// ── S-4 ─────────────────────────────────────────────────────────────────────
test("S-4 every rule above fails loudly on an unreadable or empty subject — never skips", () => {
  assert.throws(() => mustRead(path.join(BIZ, "src/screens/ari/__NO_SUCH_FILE__.tsx"), "a missing subject"), /MISSING/);

  const tmp = path.join(SG, "__tests__", ".issue1890-empty-scan-probe.tmp");
  fs.writeFileSync(tmp, "   \n");
  try {
    assert.throws(() => mustRead(tmp, "an empty subject"), /EMPTY scan|EMPTY/i);
  } finally {
    fs.unlinkSync(tmp);
  }

  assert.throws(
    () => inputWrapOverride("const x = 1;"),
    /could not find the `styles.inputWrap`/,
    "a source with no inputWrap must FAIL S-2 rather than resolve an empty override and pass",
  );

  assert.equal(liftSites("const x = 1;"), 0, "a source with no lift site must count 0 so S-1's non-zero guard fires");
});
