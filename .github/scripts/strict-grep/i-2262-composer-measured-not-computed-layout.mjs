#!/usr/bin/env node

/**
 * #2262 [composer-responsive-layout] — I-PROPOSED-2262-MEASURED-NOT-COMPUTED-LAYOUT
 * + I-PROPOSED-2262-ACTION-ROW-NEVER-LEAVES-THE-VIEWPORT.
 *
 * THE DEFECT THIS EXISTS FOR. The campaign composer did not measure anything.
 * It guessed: `CHROME_CONTENT_PX = 376` stood in for the height of every bar
 * around the message box, the screen subtracted it from the viewport, locked
 * the box to whatever was left, and stacked the action row underneath with no
 * scroll on native. The guess omitted the 56pt TopBar the Marketing tab paints
 * above the route, so the column was ~76pt too tall on EVERY iPhone before a
 * character was typed. A `Math.max(120, ...)` clamp then stopped the box
 * shrinking far enough for the keyboard (by 191pt on an SE3), and a
 * `position: absolute` footer overlapped the box by 129px at 1024x700.
 *
 * WHY A GATE AND NOT JUST TESTS. All 13 pre-existing composer tests are
 * source-greps under `testEnvironment: node`, and 78/78 passed green on the
 * exact commit where both defects were measured live in a real browser. One of
 * them names the "~23px strip" in its own header and passed while the strip was
 * still 23px, because it asserted the SHAPE OF THE PATCH and never the PROPERTY.
 * This gate asserts the shapes that cannot come back; the render/web-render/
 * Playwright suites assert the properties. Neither substitutes for the other.
 *
 * THE BOUNDARY (SPEC AMENDMENT D-4). A `minHeight` FLOOR ON A FLEXED CHILD is
 * permitted and is a different object from a computed height: it participates in
 * no subtraction and reads no viewport. What is forbidden is a height DERIVED
 * from a viewport by subtraction or fraction, and any floor applied to such a
 * derivation. R10 draws that line explicitly for `composerSheetMinHeight`.
 *
 * `--self-test` proves the gate fires on every reverted shape and passes on the
 * shipped one, so a green run is evidence and not vacuity.
 *
 * **Mode:** BLOCKING (exit 1 on violation, exit 0 on PASS).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

/**
 * The composer's file set. Every one must exist on disk — a rename that empties
 * the scan is a FAILURE, never a pass (I-PROPOSED-1841-A).
 */
export const TARGETS = [
  "mingla-business/app/(tabs)/marketing/campaigns/compose.tsx",
  "mingla-business/app/(tabs)/marketing/_layout.tsx",
  "mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx",
  "mingla-business/src/components/marketing/ComposerV2/richEditor.tsx",
  "mingla-business/src/components/marketing/ComposerV2/InsertionBar.tsx",
  "mingla-business/src/components/marketing/ComposerV2/ComposerCanvas.web.tsx",
  "mingla-business/src/components/marketing/SmsComposeCard.tsx",
  "mingla-business/src/components/marketing/ComposerCommitBar.tsx",
];

const ORCH_0892_GATE = ".github/scripts/strict-grep/orch-0892-no-bespoke-keyboard-plumbing.mjs";

/**
 * Comments come off FIRST, always. This file — and every target — documents the
 * deleted arithmetic in prose that contains the literal shapes below. A gate
 * that let a comment satisfy a positive rule, or let a comment TRIP a negative
 * one, would be worse than no gate: the self-test's case (j) pins both
 * directions.
 */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Every identifier this repo uses to name a viewport height. */
const VIEWPORT_HEIGHT_SOURCE =
  "(?:windowHeight|screenHeight|viewportHeight|SCREEN_HEIGHT|VIEWPORT_HEIGHT|" +
  "window\\.innerHeight|visualViewport\\.height|Dimensions\\.get\\([^)]*\\)\\.height)";

/** R1 — `<viewport height> - … - <2+ digit literal>`, at any depth in the chain. */
const RE_R1_LITERAL = new RegExp(
  VIEWPORT_HEIGHT_SOURCE + "\\s*(?:-\\s*[A-Za-z_$][\\w$.]*\\s*)*-\\s*\\d{2,}",
);
/** R1 — the same, but the final term is a local constant bound to 2+ digits. */
const RE_R1_IDENT = new RegExp(
  VIEWPORT_HEIGHT_SOURCE + "\\s*(?:-\\s*[A-Za-z_$][\\w$.]*\\s*)*-\\s*([A-Z][A-Z0-9_]{2,})",
);
/** R2 — `<viewport height> * 0.N`, with or without a Math.round wrapper. */
const RE_R2 = new RegExp(VIEWPORT_HEIGHT_SOURCE + "\\s*\\*\\s*0?\\.\\d+");
/** R3 — the chrome-constant naming shape. */
const RE_R3 =
  /\b(?:const|let|var)\s+([A-Z][A-Z0-9_]*(?:CHROME|CONTENT|BODY|HEADER|FOOTER|BAR)[A-Z0-9_]*_PX|[A-Z0-9_]*_CHROME_[A-Z0-9_]+)\s*=/;
/** R4 — the bespoke listener, stricter than orch-0892: no marker rescues it here. */
const RE_R4 = /\bKeyboard\s*\.\s*addListener\b/;

/** Where the measured value is allowed to appear, and nowhere else (R6). */
const MEASURED = "measuredBodyPx";

function reportedName(relPath) {
  return relPath.split("/").pop();
}

// ───────────────────────────────────────────────────────────── per-file rules

export function checkSource(rawSrc, relPath, failures) {
  const src = stripComments(rawSrc);
  const name = reportedName(relPath);

  // ---- R1: no viewport height minus a chrome constant.
  if (RE_R1_LITERAL.test(src)) {
    failures.push(
      `${relPath}: a viewport height is being reduced by a hardcoded constant. ` +
        `That is CHROME_CONTENT_PX returning — it was short by the route TopBar ` +
        `(64pt) + 12pt on EVERY device. Claim remaining space with flex:1 + ` +
        `minHeight:0 and let flexbox do the subtraction (#2262 R1).`,
    );
  }
  const identMatch = src.match(RE_R1_IDENT);
  if (identMatch !== null) {
    const ident = identMatch[1];
    const decl = new RegExp(`\\b(?:const|let|var)\\s+${ident}\\s*=\\s*\\d{2,}`);
    if (decl.test(src)) {
      failures.push(
        `${relPath}: a viewport height is being reduced by \`${ident}\`, which is ` +
          `bound to a numeric literal in this same file (#2262 R1).`,
      );
    }
  }

  // ---- R2: no fraction-of-viewport height.
  if (RE_R2.test(src)) {
    failures.push(
      `${relPath}: a viewport height is being multiplied by a fraction. ` +
        `\`Math.round(windowHeight * 0.6)\` is still a guess — it made the BOX ` +
        `bigger and did nothing at all for the editable inside it (#2262 R2).`,
    );
  }

  // ---- R3: no chrome-constant identifier.
  const r3 = src.match(RE_R3);
  if (r3 !== null) {
    failures.push(
      `${relPath}: declares \`${r3[1]}\` — a chrome constant by name. The whole ` +
        `defect class is layout by hand-typed number (#2262 R3).`,
    );
  }

  // ---- R4: no bespoke keyboard listener, marker or no marker.
  if (RE_R4.test(src)) {
    failures.push(
      `${relPath}: \`Keyboard.addListener\` is forbidden in the composer file ` +
        `set outright — deliberately stricter than orch-0892, which allows an ` +
        `inline marker. The keyboard is ridden by SmartKeyboardAvoidingView, and ` +
        `this listener was permanently dead on web anyway (RN-web's Keyboard is ` +
        `a no-op stub), so two of four surfaces had no compensation (#2262 R4).`,
    );
  }

  // ---- R5: the commit bar carries no `position` in its StyleSheet.
  if (name === "ComposerCommitBar.tsx") {
    const sheetStart = src.indexOf("StyleSheet.create(");
    if (sheetStart !== -1 && /\bposition\s*:/.test(src.slice(sheetStart))) {
      failures.push(
        `${relPath}: a \`position:\` key appears inside StyleSheet.create. The ` +
          `action row is a FLOW SIBLING on all five surfaces; \`position:` +
          `"absolute"\` is RC-3 verbatim — it overlapped the message box by 9px ` +
          `at 1440x900, 129px at 1024x700, and floated 285px from the SMS card's ` +
          `last control (#2262 R5).`,
      );
    }
    // ---- R11: the bar's bottom padding is a Math.max over insets.bottom.
    if (/paddingBottom/.test(src)) {
      const ok = /paddingBottom\s*:\s*Math\.max\(\s*insets\.bottom/.test(src);
      if (!ok) {
        failures.push(
          `${relPath}: the commit bar's \`paddingBottom\` must be ` +
            `\`Math.max(insets.bottom, spacing.md)\`. \`insets.bottom\` reads 0 on ` +
            `mobile web (the viewport meta carries no \`viewport-fit=cover\`), so a ` +
            `bare inset puts the bar flush against browser chrome (#2262 R11).`,
        );
      }
    }
  }

  // ---- R6: the measured value never escapes its single consumer.
  if (name === "ComposerV2Editor.tsx") {
    const lines = src.split("\n");
    // The one legal span for a bare read: inside the <RichEditor … /> element.
    let elStart = -1;
    let elEnd = -1;
    for (let i = 0; i < lines.length; i += 1) {
      if (elStart === -1 && /<RichEditor\b/.test(lines[i])) elStart = i;
      if (elStart !== -1 && elEnd === -1 && /\/>/.test(lines[i]) && i >= elStart) {
        elEnd = i;
      }
    }
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.includes(MEASURED) && !line.includes("setMeasuredBodyPx")) continue;
      const isDeclaration =
        /useState<[^>]*>\(\s*null\s*\)/.test(line) || /\[\s*measuredBodyPx\s*,/.test(line);
      const isSetter = /setMeasuredBodyPx\s*\(/.test(line);
      const isNullGuard = /measuredBodyPx\s*===\s*null/.test(line);
      const insideElement = elStart !== -1 && i >= elStart && i <= elEnd;
      if (isDeclaration || isSetter || isNullGuard || insideElement) continue;
      failures.push(
        `${relPath}:${i + 1}: the measured body height escaped its single ` +
          `consumer — it may size pell's WebView and nothing else (#2262 P3). ` +
          `The whole reason a pixel number is tolerable here is that a WRONG ` +
          `measurement can only mis-size the editor: it is structurally incapable ` +
          `of moving the action row, because no ancestor, sibling or bar reads it.`,
      );
    }

    // ---- R7 (positive): the measurement and its testID must be present.
    if (!/onLayout\s*=/.test(src)) {
      failures.push(
        `${relPath}: no \`onLayout=\` — the ONE measurement on this screen is ` +
          `gone. This gate cannot be satisfied by deleting the thing it guards ` +
          `(#2262 R7).`,
      );
    }
    if (!/testID="composer-v2-body-host"/.test(src)) {
      failures.push(
        `${relPath}: \`testID="composer-v2-body-host"\` is missing; the render ` +
          `proofs and the Playwright spec both resolve the body region through ` +
          `it (#2262 R7).`,
      );
    }
  }

  if (name === "compose.tsx" && !/testID="composer-flex-region"/.test(src)) {
    failures.push(
      `${relPath}: \`testID="composer-flex-region"\` is missing. Band B is what ` +
        `absorbs and clips every growing region so the commit bar cannot be ` +
        `displaced; without the testID nothing can assert it (#2262 R7).`,
    );
  }

  // ---- R10: the sheet floor is a bound on a flexed child, never a height.
  if (src.includes("composerSheetMinHeight")) {
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.includes("composerSheetMinHeight")) continue;
      const isMinHeightValue = /minHeight\s*:\s*composerSheetMinHeight\b/.test(line);
      const isImportLine = /^\s*composerSheetMinHeight,?\s*$/.test(line) || /^\s*import\b/.test(line);
      const isOwnDeclaration = /(?:const|let|var)\s+composerSheetMinHeight\s*=/.test(line);
      if (isMinHeightValue || isImportLine || isOwnDeclaration) continue;
      failures.push(
        `${relPath}:${i + 1}: the sheet floor is a bound on a FLEXED CHILD, never ` +
          `a computed height (#2262 10.7 / R10). It may appear only as the value ` +
          `of a \`minHeight:\` key. Putting it in an expression, a \`height:\`, or ` +
          `a Math.max over a viewport-derived value is \`Math.max(120, ...)\` ` +
          `returning under a new name.`,
      );
    }
  }

  // ---- R9: the web viewport pin must be SSR-guarded.
  if (name === "_layout.tsx" && /useWindowDimensions/.test(src)) {
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      // The DESTRUCTURE (`const { height: windowHeight } = useWindowDimensions()`)
      // matches the same shape and is not a pin. Only a style position counts.
      if (/useWindowDimensions/.test(lines[i])) continue;
      if (!/\bheight\s*:\s*windowHeight\b/.test(lines[i])) continue;
      const window3 = lines.slice(Math.max(0, i - 3), i + 4).join("\n");
      if (!/windowHeight\s*>\s*0/.test(window3)) {
        failures.push(
          `${relPath}:${i + 1}: the web viewport pin is not SSR-guarded. ` +
            `react-native-web returns \`{width:0,height:0}\` with no \`window\`, so ` +
            `an unguarded pin ships \`height: 0\` into the static export and blanks ` +
            `every marketing route (#2262 R9).`,
        );
      }
    }
  }
}

// ───────────────────────────────────────────────── R8: the exemption check

export function checkOrch0892Safelist(gateSrc, failures) {
  const src = stripComments(gateSrc);
  const start = src.indexOf("SAFELIST = new Set([");
  if (start === -1) {
    failures.push(
      `${ORCH_0892_GATE}: no \`SAFELIST = new Set([\` found — this rule would be ` +
        `checking nothing (#2262 R8).`,
    );
    return;
  }
  const end = src.indexOf("]);", start);
  const body = src.slice(start, end === -1 ? undefined : end);
  for (const needle of ["ComposerV2/", "ComposerFooter", "ComposerCommitBar"]) {
    if (body.includes(needle)) {
      failures.push(
        `${ORCH_0892_GATE}: the SAFELIST contains "${needle}". The composer's ` +
          `whole-file carve-out is what let this defect ship — its stated ` +
          `justification WAS the defect ("fixed-height body shrink for pell rich ` +
          `editor"), and while it stood the gate certified the screen clean on ` +
          `every run. Deleting it is the machine-checkable proof the class is ` +
          `gone; re-adding it is not available (#2262 R8).`,
      );
    }
  }
}

// ────────────────────────────────────────────────────────────── self-test

if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (src, rel = "mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx") => {
    const out = [];
    checkSource(src, rel, out);
    return out;
  };
  // A minimal shipped-shape stub that satisfies every POSITIVE rule, so the
  // negative cases below are the only thing under test.
  const OK_EDITOR =
    'const [measuredBodyPx, setMeasuredBodyPx] = useState(null);\n' +
    'setMeasuredBodyPx(next);\n' +
    'onLayout={handleBodyLayout}\n' +
    'testID="composer-v2-body-host"\n' +
    "{measuredBodyPx === null ? null : (\n" +
    "  <RichEditor initialHeight={first} style={{ height: measuredBodyPx }} />\n" +
    ")}\n";

  // (a) The SHIPPED shape → MUST pass.
  if (run(OK_EDITOR).length !== 0) selfFailures.push("(a) shipped editor shape wrongly flagged");

  // (b) R1 — the chrome-constant subtraction, literal form.
  if (run(OK_EDITOR + "const h = windowHeight - insets.top - 376;").length === 0) {
    selfFailures.push("(b) windowHeight - insets.top - 376 not flagged (R1)");
  }
  // (b2) R1 — the same via a named constant declared in-file.
  if (
    run(OK_EDITOR + "const CHROME = 376;\nconst h = windowHeight - insets.top - CHROME;")
      .length === 0
  ) {
    selfFailures.push("(b2) windowHeight - ... - CHROME (bound to 376) not flagged (R1)");
  }

  // (c) R2 — the fraction of viewport.
  if (run(OK_EDITOR + "const h = Math.round(windowHeight * 0.6);").length === 0) {
    selfFailures.push("(c) Math.round(windowHeight * 0.6) not flagged (R2)");
  }

  // (d) R3 — the chrome-constant identifier.
  if (run(OK_EDITOR + "const CHROME_CONTENT_PX = 376;").length === 0) {
    selfFailures.push("(d) const CHROME_CONTENT_PX not flagged (R3)");
  }
  if (run(OK_EDITOR + "const PHONE_WEB_BODY_MIN_PX = 360;").length === 0) {
    selfFailures.push("(d2) const PHONE_WEB_BODY_MIN_PX not flagged (R3)");
  }

  // (e) R4 — the listener, WITH an adjacent orch-0892 marker, must still fire.
  const withMarker =
    OK_EDITOR +
    "// orch-strict-grep-allow orch-0892 — body shrink\n" +
    'Keyboard.addListener("keyboardWillShow", onShow);';
  if (run(withMarker).length === 0) {
    selfFailures.push("(e) Keyboard.addListener not flagged even with an orch-0892 marker (R4)");
  }

  // (f) R5 — position inside the commit bar's StyleSheet.
  const barRel = "mingla-business/src/components/marketing/ComposerCommitBar.tsx";
  const OK_BAR =
    "const styles = StyleSheet.create({\n" +
    "  host: { flexShrink: 0, paddingBottom: Math.max(insets.bottom, spacing.md) },\n" +
    "});\n";
  if (run(OK_BAR, barRel).length !== 0) selfFailures.push("(f0) shipped commit bar wrongly flagged");
  const REVERTED_BAR =
    "const styles = StyleSheet.create({\n" +
    "  desktopHost: { position: \"absolute\", left: 0, right: 0, bottom: 8 },\n" +
    "  host: { paddingBottom: Math.max(insets.bottom, spacing.md) },\n" +
    "});\n";
  if (run(REVERTED_BAR, barRel).length === 0) {
    selfFailures.push("(f) restored desktopHost position:absolute not flagged (R5)");
  }

  // (f2) R11 — a bare insets.bottom returns.
  const BARE_INSET =
    "const styles = StyleSheet.create({\n" +
    "  host: { flexShrink: 0, paddingBottom: insets.bottom + spacing.lg },\n" +
    "});\n";
  if (run(BARE_INSET, barRel).length === 0) {
    selfFailures.push("(f2) bare insets.bottom paddingBottom not flagged (R11)");
  }

  // (g) R6 — the measured value escapes into a sibling/footer style.
  if (run(OK_EDITOR + "const footerTop = measuredBodyPx + 44;").length === 0) {
    selfFailures.push("(g) measuredBodyPx used outside its single consumer not flagged (R6)");
  }

  // (g2) R7 — deleting the measurement must not satisfy the gate.
  if (run('testID="composer-v2-body-host"\n').length === 0) {
    selfFailures.push("(g2) missing onLayout not flagged (R7)");
  }

  // (h) R8 — a SAFELIST that re-adds the composer.
  const safelistFail = [];
  checkOrch0892Safelist(
    'export const SAFELIST = new Set([\n  "mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx",\n]);',
    safelistFail,
  );
  if (safelistFail.length === 0) selfFailures.push("(h) re-added ComposerV2/ SAFELIST entry not flagged (R8)");
  const safelistOk = [];
  checkOrch0892Safelist(
    'export const SAFELIST = new Set([\n  "mingla-business/src/components/ui/Sheet.tsx",\n]);',
    safelistOk,
  );
  if (safelistOk.length !== 0) selfFailures.push("(h2) clean SAFELIST wrongly flagged (R8)");

  // (i) R9 — the SSR guard removed from the web pin.
  const layoutRel = "mingla-business/app/(tabs)/marketing/_layout.tsx";
  const OK_PIN =
    "const { height: windowHeight } = useWindowDimensions();\n" +
    'Platform.OS === "web" && windowHeight > 0 ? { height: windowHeight } : null\n';
  if (run(OK_PIN, layoutRel).length !== 0) selfFailures.push("(i0) guarded pin wrongly flagged");
  const UNGUARDED_PIN =
    "const { height: windowHeight } = useWindowDimensions();\n" +
    "\n\n\n\n" +
    'Platform.OS === "web" ? { height: windowHeight } : null\n';
  if (run(UNGUARDED_PIN, layoutRel).length === 0) {
    selfFailures.push("(i) unguarded web height pin not flagged (R9)");
  }

  // (i2) R10 — the sheet floor used as anything but a minHeight value.
  if (run(OK_EDITOR + "const h = Math.max(composerSheetMinHeight, rawBodyHeight);").length === 0) {
    selfFailures.push("(i2) composerSheetMinHeight in an expression not flagged (R10)");
  }
  if (run(OK_EDITOR + "sheet: { minHeight: composerSheetMinHeight },").length !== 0) {
    selfFailures.push("(i3) composerSheetMinHeight as a minHeight value wrongly flagged (R10)");
  }

  // (j) VACUITY GUARD, both directions. Prose describing the deleted arithmetic
  //     must NOT trip a negative rule, and prose must NOT satisfy a positive one.
  const prose =
    OK_EDITOR +
    "// #2262: no chrome constant here. CHROME_CONTENT_PX = 376 was short by the\n" +
    "// route TopBar; the old form was windowHeight - insets.top - 376, with a\n" +
    "// Math.round(windowHeight * 0.6) phone-web branch and a Keyboard.addListener.\n" +
    "/* const PHONE_WEB_BODY_MIN_PX = 360; */\n";
  if (run(prose).length !== 0) {
    selfFailures.push("(j) documentation prose tripped a negative rule — comments must be stripped");
  }
  const proseOnlyPositives =
    "// This file has an onLayout= and a testID=\"composer-v2-body-host\" somewhere.\n";
  if (run(proseOnlyPositives).length === 0) {
    selfFailures.push("(j2) comment prose satisfied the positive rules — gate is vacuous");
  }

  if (selfFailures.length) {
    console.error("#2262 I-2262-COMPOSER-MEASURED-NOT-COMPUTED-LAYOUT self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "#2262 I-2262-COMPOSER-MEASURED-NOT-COMPUTED-LAYOUT self-test PASS (18/18 cases, " +
      "R1-R11 + both vacuity directions).",
  );
  process.exit(0);
}

// ───────────────────────────────────────────────────────────── plain mode

const failures = [];

for (const target of TARGETS) {
  const full = path.join(repoRoot, target);
  if (!fs.existsSync(full)) {
    failures.push(
      `MISSING: ${target}. A rename that empties this scan is a FAILURE, never a ` +
        `pass — re-point the gate in the same commit (#2262 vacuity guard).`,
    );
    continue;
  }
  checkSource(fs.readFileSync(full, "utf8"), target, failures);
}

const gateFull = path.join(repoRoot, ORCH_0892_GATE);
if (!fs.existsSync(gateFull)) {
  failures.push(`MISSING: ${ORCH_0892_GATE} — R8 would be checking nothing.`);
} else {
  checkOrch0892Safelist(fs.readFileSync(gateFull, "utf8"), failures);
}

// Vacuity guard: the editor must still contain the element this gate is about.
const editorPath = path.join(
  repoRoot,
  "mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx",
);
if (fs.existsSync(editorPath)) {
  const shipped = stripComments(fs.readFileSync(editorPath, "utf8"));
  if (!/<RichEditor\b/.test(shipped)) {
    failures.push(
      `ComposerV2Editor.tsx no longer contains a <RichEditor element — this gate ` +
        `would be scanning nothing. Re-point it at the renamed component.`,
    );
  }
}

if (failures.length > 0) {
  console.error("FAIL: #2262 i-2262-composer-measured-not-computed-layout");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `OK: #2262 i-2262-composer-measured-not-computed-layout — ${TARGETS.length} composer ` +
    `files carry no viewport arithmetic, no chrome constant, no bespoke keyboard ` +
    `listener; the measured body height reaches pell and nothing else; the commit ` +
    `bar is position-free with a Math.max bottom inset; the web pin is SSR-guarded; ` +
    `and orch-0892's SAFELIST no longer carves out the composer.`,
);
