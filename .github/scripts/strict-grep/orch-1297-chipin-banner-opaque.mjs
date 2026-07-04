#!/usr/bin/env node
/**
 * ORCH-1297 — strict-grep gate: the ORCH-1295 chip-in post-payment RETURN BANNER
 * must keep an OPAQUE fill so the event cover image can never bleed through it.
 *
 * WHY: the "Thanks for chipping in 💛" / "Payment canceled" banner in
 * mingla-business/src/components/event/PublicEventPage.tsx renders inside an
 * ABSOLUTE overlay (styles.returnBannerWrap, pointerEvents="box-none") pinned
 * over the parallax cover image. Its card fill was `palette.card` — a TRANSLUCENT
 * rgba token (alpha 0.10 dark / 0.72 light). Over the cover photo that bled
 * through and wrecked legibility (Seth screenshot, ORCH-1297). The fix set the
 * fill to `palette.page`, the guaranteed-opaque 6-digit hex the palette is built
 * on (identical to the opaque fill RsvpChipInPanel uses on Android).
 *
 * RULE (structural anti-recurrence) — all must hold, else exit non-zero:
 *   A. The inline style object applied alongside `styles.returnBannerCard` sets
 *      `backgroundColor: palette.page` (OPAQUE).
 *   B. That same fill is NOT `backgroundColor: palette.card` (the translucent
 *      token that caused the bleed-through).
 *   C. Neither the `returnBannerCard` nor the `returnBannerWrap` StyleSheet entry
 *      carries an `opacity` (< 1 fades the whole banner) or an `rgba(` alpha fill.
 *
 * Comment-stripped before scanning: the fix comment itself names `palette.card`,
 * `rgba`, and `opacity` to explain the bug — those references must not trip the
 * gate. `palette.card` also legitimately fills OTHER surfaces in the same file
 * (the mobile info banner, the desktop panel), so checks A/B are SCOPED to the
 * returnBannerCard render site and C is scoped to the two banner style blocks.
 *
 * Self-test: `node orch-1297-chipin-banner-opaque.mjs --self-test`
 * proves the gate PASSES on the fixed shape and FAILS on (1) a palette.card
 * regression, (2) an opacity on returnBannerCard, (3) an rgba fill on
 * returnBannerWrap.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");
const TARGET_REL =
  "mingla-business/src/components/event/PublicEventPage.tsx";

/** Remove block comments and whole-line `//` comments (the fix comment is a
 * whole-line block) so explanatory prose can't satisfy or trip an assertion. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/** The inline style object that immediately follows `styles.returnBannerCard`
 * in the render array (its sibling `{ ... }`). Returns the object body, or null. */
function bannerInlineFill(src) {
  const anchor = "styles.returnBannerCard";
  const idx = src.indexOf(anchor);
  if (idx === -1) return null;
  const after = src.slice(idx + anchor.length);
  const open = after.indexOf("{");
  if (open === -1) return null;
  const close = after.indexOf("}", open);
  if (close === -1) return null;
  return after.slice(open + 1, close);
}

/** The body of a flat StyleSheet entry `name: { ... }` (no nested braces). */
function styleBlock(src, name) {
  const re = new RegExp(name + "\\s*:\\s*\\{([^}]*)\\}");
  const m = re.exec(src);
  return m === null ? null : m[1];
}

/** Scan a source string. Returns an array of violation messages. */
function scan(src) {
  const failures = [];
  const s = stripComments(src);

  // A + B — the returnBannerCard render fill.
  const fill = bannerInlineFill(s);
  if (fill === null) {
    failures.push(
      "could not locate the inline style object applied alongside " +
        "styles.returnBannerCard — the banner fill site moved or was removed.",
    );
  } else {
    if (!/backgroundColor\s*:\s*palette\.page\b/.test(fill)) {
      failures.push(
        "A: the returnBannerCard fill is NOT `backgroundColor: palette.page`. " +
          "The chip-in return banner sits over the cover image and MUST use the " +
          "opaque `palette.page` hex so the cover cannot bleed through (ORCH-1297).",
      );
    }
    if (/backgroundColor\s*:\s*palette\.card\b/.test(fill)) {
      failures.push(
        "B: the returnBannerCard fill regressed to `backgroundColor: palette.card` " +
          "— a TRANSLUCENT rgba token (alpha 0.10/0.72). The cover image bleeds " +
          "through it. Use `palette.page` (opaque) instead (ORCH-1297).",
      );
    }
  }

  // C — no alpha on the two banner style blocks.
  for (const name of ["returnBannerCard", "returnBannerWrap"]) {
    const block = styleBlock(s, name);
    if (block === null) {
      failures.push(
        `could not locate the ${name} StyleSheet entry — it moved or was removed.`,
      );
      continue;
    }
    if (/\bopacity\b/.test(block)) {
      failures.push(
        `C: ${name} carries an \`opacity\` — any value < 1 fades the whole banner ` +
          "and re-exposes the cover through it. Keep the banner fully opaque (ORCH-1297).",
      );
    }
    if (/rgba\s*\(/i.test(block)) {
      failures.push(
        `C: ${name} carries an \`rgba(...)\` alpha fill — a translucent surface ` +
          "lets the cover bleed through. Use an opaque palette hex (ORCH-1297).",
      );
    }
  }

  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const WRAP_OK = `returnBannerWrap: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 20 },`;
  const CARD_OK = `returnBannerCard: { flexDirection: "row", borderWidth: 1, borderRadius: 16, paddingVertical: 14 },`;
  const RENDER = (fill) => `
    <View style={[styles.returnBannerWrap, { paddingTop: insets.top + 12 }]} pointerEvents="box-none">
      <View
        style={[
          styles.returnBannerCard,
          // ORCH-1297 — palette.card was TRANSLUCENT (rgba, opacity) and bled the cover; palette.page is opaque.
          ${fill},
        ]}
        testID="orch-1295-chipin-return-banner"
      />
    </View>`;
  const FIXTURE = (renderFill, wrap, card) =>
    `import { StyleSheet } from "react-native";\n${RENDER(renderFill)}\nconst styles = StyleSheet.create({\n  ${wrap}\n  ${card}\n});\n`;

  // GOOD — opaque fill, no alpha on either style block: PASS.
  const good = FIXTURE(
    "{ backgroundColor: palette.page, borderColor: palette.panelBorder }",
    WRAP_OK,
    CARD_OK,
  );
  let f = scan(good);
  if (f.length !== 0) {
    console.error(
      "ORCH-1297 self-test FAIL: the fixed shape (opaque palette.page, no alpha) " +
        "reported failures:\n" + f.join("\n"),
    );
    process.exit(1);
  }

  // BAD 1 — fill regressed to the translucent palette.card: FAIL (A + B).
  const badCard = FIXTURE(
    "{ backgroundColor: palette.card, borderColor: palette.panelBorder }",
    WRAP_OK,
    CARD_OK,
  );
  f = scan(badCard);
  if (!f.some((m) => m.startsWith("B:")) || !f.some((m) => m.startsWith("A:"))) {
    console.error(
      "ORCH-1297 self-test FAIL: a palette.card regression did NOT trip checks A+B:\n" +
        f.join("\n"),
    );
    process.exit(1);
  }

  // BAD 2 — opacity added to the returnBannerCard style block: FAIL (C).
  const badOpacity = FIXTURE(
    "{ backgroundColor: palette.page, borderColor: palette.panelBorder }",
    WRAP_OK,
    `returnBannerCard: { flexDirection: "row", borderWidth: 1, opacity: 0.85 },`,
  );
  f = scan(badOpacity);
  if (!f.some((m) => m.startsWith("C:") && m.includes("opacity"))) {
    console.error(
      "ORCH-1297 self-test FAIL: an opacity on returnBannerCard did NOT trip check C:\n" +
        f.join("\n"),
    );
    process.exit(1);
  }

  // BAD 3 — rgba alpha fill on the returnBannerWrap style block: FAIL (C).
  const badRgba = FIXTURE(
    "{ backgroundColor: palette.page, borderColor: palette.panelBorder }",
    `returnBannerWrap: { position: "absolute", top: 0, backgroundColor: "rgba(0,0,0,0.4)" },`,
    CARD_OK,
  );
  f = scan(badRgba);
  if (!f.some((m) => m.startsWith("C:") && m.includes("rgba"))) {
    console.error(
      "ORCH-1297 self-test FAIL: an rgba fill on returnBannerWrap did NOT trip check C:\n" +
        f.join("\n"),
    );
    process.exit(1);
  }

  console.log(
    "ORCH-1297 gate self-test PASS (4/4: opaque shape passes; palette.card, " +
      "opacity, and rgba each fail).",
  );
  process.exit(0);
}

// ---- Live mode
let src;
try {
  src = readFileSync(join(REPO_ROOT, TARGET_REL), "utf8");
} catch (err) {
  console.error(
    `ORCH-1297 gate FAIL — cannot read ${TARGET_REL}: ${err.message}`,
  );
  process.exit(1);
}

const failures = scan(src);
if (failures.length > 0) {
  console.error(
    `ORCH-1297 gate FAIL — the chip-in return banner is no longer guaranteed ` +
      `opaque in ${TARGET_REL}:\n\n  - ` +
      failures.join("\n  - ") +
      "\n\nThe ORCH-1295 return banner overlays the event cover image; a " +
      "translucent fill (palette.card / rgba / opacity < 1) lets the cover bleed " +
      "through and hurts legibility. Keep backgroundColor: palette.page. See ORCH-1297.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1297 gate PASS — chip-in return banner uses opaque palette.page fill; " +
    "no opacity/rgba on returnBannerCard or returnBannerWrap.",
);
