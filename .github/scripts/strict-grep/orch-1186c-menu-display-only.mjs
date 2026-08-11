#!/usr/bin/env node
/**
 * ORCH-1186-C — the venue menu never does money itself.
 *
 * Invariant I-PROPOSED-1186-MENU-DISPLAY-ONLY (ACTIVE), AMENDED at #1767 Phase 1
 * (issue #1789) per SPEC #1788 P-60/P-61/P-62.
 *
 * WHAT CHANGED, AND WHY THE GATE WAS RE-SCOPED RATHER THAN DELETED.
 * The original rule was "the venue menu builder + the public Menu tab carry NO
 * checkout / cart / quantity / order / payment surface" — ordering was out of
 * scope for META-ORCH-1186. #1767 makes the venue menu an ordering surface, so
 * half of that rule is deliberately retired. The half that was always the point
 * survives and is now the whole invariant:
 *
 *     the menu surface never does money itself, and the surfaces that must stay
 *     display-only forever still are.
 *
 * This file keeps its path, its MANIFEST.json row, its jobKey, its modes, and
 * its `selfTest: "wired"` flag — so `gates[]` never shrinks, the append-only
 * ratchet stays silent, `expectedStrictGrepMjsFiles` / `selfTestWiredFloor` are
 * unchanged, and no `[GATE-REMOVAL: …]` token is needed anywhere (SPEC P-60).
 * Deleting this gate and adding a replacement would trade a regex edit for a
 * permanently weaker registry. That trade is forbidden.
 *
 * THREE SCAN SETS (SPEC P-61):
 *
 *   SET-A — display-only FOREVER. Full nine-token FORBIDDEN list. An authoring
 *           form never becomes a buying form, and the marketing site never
 *           becomes a checkout:
 *             - the venue menu BUILDER sheets (MenuItemSheet / MenuCategorySheet)
 *             - the ISSUE-1080 venue-preview sales-demo skin under
 *               mingla-marketing/ (no ordering rail, no auth, no money path —
 *               and it must never grow one)
 *
 *   SET-B — MAY sell, may NEVER touch money. Money tokens only, whole file:
 *             - packages/brand-rendering/PublicMenuSections.tsx
 *             - mingla-business/src/components/venue/VenueMenuModule.tsx
 *             - every ordering renderer under packages/brand-rendering/venueOrdering/**
 *           These may carry a cart, a quantity stepper and an "Add to order"
 *           button. They may never import a provider SDK, name a payment sheet,
 *           or compute a fee/take-rate — every money number they render comes
 *           from `venue-order-create`'s priced response (SPEC P-20). The payment
 *           STEP lives in separately-named components that are explicitly OUT of
 *           SET-B; this gate is never pointed at them.
 *
 *   SET-C — anti-vacuity, HARDENED at #1819. Presence was never enough. Every
 *           listed file must EXIST, must still DECLARE its named anchors, must
 *           not wildcard-re-export, and must clear a per-file substance floor.
 *           The tester proved all three evasions on the presence-only version:
 *           hollowing an anchor into a re-export stayed green, renaming
 *           `MenuTab` stayed green, and a fully buyable control passed SET-A
 *           with none of the nine tokens. "A gate that goes green because its
 *           target moved" includes a target that moved by being RENAMED or
 *           DELEGATED, not only one that was deleted.
 *
 * #1819 also gives SET-A a structural needle set (FORBIDDEN_PURCHASE_RAIL) on
 * top of the nine spellings, because a spelling is precisely what an evasion
 * changes. The rule it encodes: a control is only genuinely PURCHASABLE if it
 * can reach the money rail, so the coupling — an order edge function, an
 * ordering renderer, a cart hook, an order/spot table — is the signal, whatever
 * the control is named. SET-B is deliberately NOT held to it: SET-B may sell.
 *
 * Comments are stripped before matching, so explanatory notes never trip it.
 * Mirrors the modular gate pattern (sibling: orch-1130-no-buyer-tax-form.mjs).
 *
 * Supports `--self-test` (no repo scan; proves the SET-A / SET-B split).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

// ---------------------------------------------------------------------------
// SET-A — display-only forever (full nine-token list).
// ---------------------------------------------------------------------------
// The builder sheets: authoring a dish is not buying one.
// NOTE: VenueMenuModule.tsx deliberately MOVED to SET-B — it hosts the one-tap
// availability (86) row toggle and, from #1793, the venue-side order surfaces.
//
// Each entry names the SYMBOLS the file must still DECLARE. Presence of the
// file was never enough: #1819 proved an anchor could be hollowed into a
// re-export shell, or its component renamed, and this gate stayed green while
// the real code moved somewhere it does not scan. `anchors` closes that.
const setAFiles = [
  {
    rel: "mingla-business/src/components/venue/MenuItemSheet.tsx",
    anchors: ["MenuItemSheet"],
    minBodyChars: 3000, // measured 10,977
  },
  {
    rel: "mingla-business/src/components/venue/MenuCategorySheet.tsx",
    anchors: ["MenuCategorySheet"],
    minBodyChars: 3000, // measured 9,081
  },
  // The ISSUE-1080 venue-preview sales-demo skin (mingla-marketing is
  // DO-NOT-TOUCH for the whole #1767 programme — SPEC §10).
  {
    rel: "mingla-marketing/app/venue-preview/page.tsx",
    anchors: ["VenuePreviewPage"],
    // A THIN Next.js route by design (measured 351) — it renders the client
    // component and nothing else. Its floor is low on purpose; the anchor rule
    // is what actually guards it, since a shim declares no VenuePreviewPage.
    minBodyChars: 150,
  },
  {
    rel: "mingla-marketing/app/venue-preview/VenuePreviewClient.tsx",
    anchors: ["VenuePreviewClient"],
    minBodyChars: 600, // measured 1,974
  },
  {
    rel: "mingla-marketing/app/venue-preview/venueSkins.tsx",
    anchors: ["skinMeta", "SKIN_ORDER"],
    minBodyChars: 3000, // measured 11,016
  },
];

// Any NEW sibling renderer dropped into the venue-preview skin is scanned
// automatically (drift resistance), non-recursively. `lookbook/` is a separate
// design-index surface that renders no venue menu and carries a Tailwind
// `bg-stripe-strong` utility class, so it is deliberately out of scope.
const setADirs = ["mingla-marketing/app/venue-preview"];

// ---------------------------------------------------------------------------
// SET-B — may sell, may never touch money (money tokens only, whole file).
// ---------------------------------------------------------------------------
const setBFiles = [
  {
    rel: "packages/brand-rendering/PublicMenuSections.tsx",
    // `MenuTab` is the SPEC's named anchor for the public menu renderer and
    // `formatMenuPrice` is the never-GBP-defaulted formatter the amended
    // invariant still protects. Renaming either used to slip through.
    anchors: ["MenuTab", "formatMenuPrice"],
    minBodyChars: 1500, // measured 4,295
  },
  {
    rel: "mingla-business/src/components/venue/VenueMenuModule.tsx",
    anchors: ["VenueMenuModule"],
    minBodyChars: 3000, // measured 24,665
  },
];

// Recursive; may legitimately not exist yet (the ordering renderers land at
// #1793). Absence is NOT a failure — these are the files that do not exist
// until the phase that writes them, unlike the SET-C anchors above.
const setBDirs = ["packages/brand-rendering/venueOrdering"];

// The original nine display-only tokens (case-insensitive).
const FORBIDDEN_DISPLAY = [
  /\bcart\b/i,
  /\bcheckout\b/i,
  /addtoorder/i,
  /add to order/i,
  /\bquantity\b/i,
  /paymentsheet/i,
  /ticket-checkout/i,
  /\bstripe\b/i,
  /\bpaystack\b/i,
];

// #1819 SET-A structural needles. The nine tokens above are SPELLINGS, and a
// spelling is exactly what an evasion changes. These describe what a buying
// control IS instead:
//
//   A control is only genuinely PURCHASABLE if it reaches the money rail.
//   A button that reaches nothing is a dead button, not a purchase. So any
//   coupling from a display-only surface to the ordering rail is the real
//   signal — whatever the control happens to be called.
const FORBIDDEN_PURCHASE_RAIL = [
  // The order edge functions (venue-order-create / -status / -guest-action /
  // -staff), however the string is assembled.
  /venue-order-/i,
  // The ordering renderers and any cart/basket context they export.
  /venueOrdering/i,
  /\buse(Cart|Basket|Order)\b/i,
  // The order family + the spot inventory: a display-only surface has no
  // business reading either.
  /\bvenue_orders?\b/i,
  /\bvenue_order_(items|sessions)\b/i,
  /\bqr_spots\b/i,
  // Purchase call-to-action copy the nine tokens do not spell.
  /\bbuy\s*(it|now)?\b/i,
  /\bbasket\b/i,
  /add to bag/i,
  /place (an )?order/i,
  /\bpay\s*now\b/i,
  /proceed to pay/i,
];

// The money subset + the two client-money-math needles (SPEC P-61 SET-B).
const FORBIDDEN_MONEY = [
  /paymentsheet/i,
  /ticket-checkout/i,
  /\bstripe\b/i,
  /\bpaystack\b/i,
  /application_fee/i,
  /\bfeeFromBps\b|\*\s*(take_rate|takeRate|bps)\b/i,
];

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * #1819 — SET-C, made real.
 *
 * `source === null` means the file is MISSING. Everything else is the
 * substance check the old presence-only test could not make:
 *
 *   1. every declared anchor must still be DECLARED here (`const X` /
 *      `function X` / `class X`), so RENAMING the component reds the gate;
 *   2. no wildcard re-export, which is the canonical hollowing vector;
 *   3. the body — comments and import/re-export lines removed — must clear a
 *      substance floor, so replacing a 350-line form with a 2-line shim reds
 *      the gate even if the shim happens to mention the anchor's name.
 *
 * The floor is declared PER FILE next to its anchors, at roughly a third of
 * the file's measured body, because a blanket number is brittle in both
 * directions: `venue-preview/page.tsx` is a legitimate 351-char Next.js route,
 * while `VenueMenuModule.tsx` is 24 KB. A shim is tens of characters, so every
 * floor here sits an order of magnitude above one and a wide margin below the
 * real file.
 */
const auditAnchors = (label, source, anchors, minBodyChars) => {
  const failures = [];
  if (source === null) {
    failures.push(
      `${label}: missing — a scanned surface must EXIST (ORCH-1186-C; SPEC #1788 P-61 SET-C).`,
    );
    return failures;
  }
  const clean = stripComments(source);
  for (const anchor of anchors ?? []) {
    const declared = new RegExp(
      `(?:const|function|class|let|var)\\s+${anchor}\\b`,
    );
    if (!declared.test(clean)) {
      failures.push(
        `${label}: no longer DECLARES \`${anchor}\` — renaming or re-exporting an ` +
          `anchor moves the code somewhere this gate does not scan, which is the ` +
          `exact failure class SET-C exists to prevent (#1819 H-3).`,
      );
    }
  }
  if (/export\s+\*\s+from/.test(clean)) {
    failures.push(
      `${label}: wildcard re-export — a scanned surface may not delegate its ` +
        `contents to an unscanned module (#1819 H-3).`,
    );
  }
  const body = clean
    .replace(/^\s*import[\s\S]*?from\s*["'][^"']+["'];?\s*$/gm, "")
    .replace(/^\s*export\s+[^;]*?from\s*["'][^"']+["'];?\s*$/gm, "")
    .trim();
  if (typeof minBodyChars === "number" && body.length < minBodyChars) {
    failures.push(
      `${label}: hollowed to ${body.length} chars of real body (floor ` +
        `${minBodyChars}) — the surface was replaced by a shim and the ` +
        `code this gate guards now lives elsewhere (#1819 H-3).`,
    );
  }
  return failures;
};

const scan = (label, code, failures, patterns, why) => {
  const clean = stripComments(code);
  for (const re of patterns) {
    if (re.test(clean)) {
      failures.push(`${label}: matches /${re.source}/ — ${why}`);
    }
  }
};

const SET_A_WHY =
  "this surface is DISPLAY-ONLY FOREVER: an authoring form never becomes a buying form and the marketing venue-preview skin never becomes a checkout (I-PROPOSED-1186-MENU-DISPLAY-ONLY as amended at #1789; SPEC #1788 P-61 SET-A).";
const SET_A_PURCHASE_WHY =
  "this surface reaches the ORDERING RAIL. SET-A is display-only forever, and a control is only genuinely purchasable if it can reach the money rail — so the coupling is the signal, whatever the control is named (#1819 H-3; SPEC #1788 P-61 SET-A).";
const SET_B_WHY =
  "this surface may sell but may NEVER touch money: no provider SDK, no payment sheet, no client-side fee/take-rate math — every money number comes from venue-order-create's priced response (SPEC #1788 P-20; P-61 SET-B).";

// Collect .tsx/.ts files from a directory (SET-A: shallow, SET-B: recursive).
const collect = (absDir, relDir, recursive) => {
  const out = [];
  if (!existsSync(absDir)) return out;
  for (const entry of readdirSync(absDir)) {
    const abs = join(absDir, entry);
    const rel = `${relDir}/${entry}`;
    if (statSync(abs).isDirectory()) {
      if (recursive) out.push(...collect(abs, rel, true));
      continue;
    }
    if (/\.(tsx?|jsx?|mjs)$/.test(entry)) out.push({ abs, rel });
  }
  return out;
};

if (process.argv.includes("--self-test")) {
  const cases = [];

  // 1. A cart string FAILS SET-A (the builder sheets / the marketing skin).
  const a1 = [];
  scan("self-test", "const x = <AddToCart quantity={1} />;", a1, FORBIDDEN_DISPLAY, SET_A_WHY);
  cases.push(["SET-A catches a cart control", a1.length > 0]);

  // 2. The SAME cart string PASSES SET-B — this is the whole point of the split.
  const b1 = [];
  scan("self-test", "const x = <AddToCart quantity={1} />;", b1, FORBIDDEN_MONEY, SET_B_WHY);
  cases.push(["SET-B allows a legitimate cart control", b1.length === 0]);

  // 3. A provider SDK call FAILS SET-B.
  const b2 = [];
  scan(
    "self-test",
    'const r = await stripe.confirmPayment(clientSecret);',
    b2,
    FORBIDDEN_MONEY,
    SET_B_WHY,
  );
  cases.push(["SET-B catches a payment-provider call", b2.length > 0]);

  // 4. Client-side fee math FAILS SET-B (the two new needles).
  const b3 = [];
  scan("self-test", "const fee = subtotal * takeRate;", b3, FORBIDDEN_MONEY, SET_B_WHY);
  cases.push(["SET-B catches client-side take-rate math", b3.length > 0]);
  const b4 = [];
  scan("self-test", 'body.application_fee_amount = 120;', b4, FORBIDDEN_MONEY, SET_B_WHY);
  cases.push(["SET-B catches an application_fee reference", b4.length > 0]);

  // 5. A clean display-only renderer trips NEITHER set.
  const clean = [];
  scan(
    "self-test-clean",
    "const MenuTab = () => <View><Text>Margherita</Text></View>;",
    clean,
    FORBIDDEN_DISPLAY,
    SET_A_WHY,
  );
  cases.push(["no false positive on clean menu code", clean.length === 0]);

  // 6. Comments never trip either set (the prose contracts name these tokens).
  const commented = [];
  scan(
    "self-test-comment",
    "// HARD: no cart/checkout/Stripe control here.\nconst MenuTab = () => null;",
    commented,
    FORBIDDEN_DISPLAY,
    SET_A_WHY,
  );
  cases.push(["comments are stripped before matching", commented.length === 0]);

  // ---- SET-C, exercised for real (#1819) --------------------------------
  // The previous case here was MIS-NAMED: it asserted that a path it invented
  // did not exist, which is a fact about the filesystem, not about this gate.
  // It would have passed with the gate's entire missing-file branch deleted.
  // These call `auditAnchors` — the very function the run loops call.
  const HEALTHY = `
    import React from "react";
    const MenuItemSheet = () => {
      ${"// substance\n".repeat(40)}
      return <View><Text>Name</Text><Text>Price</Text></View>;
    };
    export { MenuItemSheet };
  `;

  cases.push([
    "SET-C flags a MISSING scanned file",
    auditAnchors("fixture.tsx", null, ["MenuItemSheet"], 100).length > 0,
  ]);
  cases.push([
    "SET-C passes a healthy anchor",
    auditAnchors("fixture.tsx", HEALTHY, ["MenuItemSheet"], 100).length === 0,
  ]);
  cases.push([
    "SET-C flags a RENAMED anchor",
    auditAnchors("fixture.tsx", HEALTHY.replace(/MenuItemSheet/g, "MenuItemSheetRenamed"), [
      "MenuItemSheet",
    ], 100).some((f) => /no longer DECLARES/.test(f)),
  ]);
  cases.push([
    "SET-C flags an anchor HOLLOWED into a named re-export",
    auditAnchors(
      "fixture.tsx",
      `export { MenuItemSheet } from "./MenuItemSheetReal";`,
      ["MenuItemSheet"],
      100,
    ).length > 0,
  ]);
  cases.push([
    "SET-C flags a WILDCARD re-export",
    auditAnchors("fixture.tsx", `${HEALTHY}\nexport * from "./elsewhere";`, [
      "MenuItemSheet",
    ], 100).some((f) => /wildcard re-export/.test(f)),
  ]);
  cases.push([
    "SET-C flags a shim that mentions the anchor but carries no body",
    auditAnchors(
      "fixture.tsx",
      `import Real from "./real";\nconst MenuItemSheet = Real;\nexport { MenuItemSheet };`,
      ["MenuItemSheet"],
      400,
    ).some((f) => /hollowed to/.test(f)),
  ]);

  // ---- The buyable-control evasion (#1819) -------------------------------
  // A control that is genuinely purchasable while spelling NONE of the nine
  // display tokens. The rail coupling is what gives it away.
  const BUYABLE = `
    const submit = async () => {
      await supabase.functions.invoke("venue-order-create", {
        body: { lines: [{ menuItemId: item.id, howMany: 1 }] },
      });
    };
    return <Pressable onPress={submit}><Text>Buy now</Text></Pressable>;
  `;
  const tokenOnly = [];
  scan("self-test", BUYABLE, tokenOnly, FORBIDDEN_DISPLAY, SET_A_WHY);
  cases.push([
    "the nine tokens alone MISS a renamed buyable control (why SET-A needed more)",
    tokenOnly.length === 0,
  ]);
  const railed = [];
  scan("self-test", BUYABLE, railed, FORBIDDEN_PURCHASE_RAIL, SET_A_PURCHASE_WHY);
  cases.push([
    "SET-A catches a buyable control by its RAIL COUPLING",
    railed.length > 0,
  ]);
  const legitimateForm = [];
  scan(
    "self-test",
    `const save = () => upsertItem.mutate({ id, name, priceCents });
     return <Pressable onPress={save}><Text>Save item</Text></Pressable>;`,
    legitimateForm,
    FORBIDDEN_PURCHASE_RAIL,
    SET_A_PURCHASE_WHY,
  );
  cases.push([
    "an ordinary authoring form still passes SET-A",
    legitimateForm.length === 0,
  ]);

  const failed = cases.filter(([, ok]) => !ok);
  if (failed.length > 0) {
    console.error("ORCH-1186-C menu-money gate self-test FAILED:");
    for (const [name] of failed) console.error(`- ${name}`);
    process.exit(1);
  }
  console.log(
    `ORCH-1186-C menu-money gate self-test passed (${cases.length}/${cases.length}).`,
  );
  process.exit(0);
}

const failures = [];

// ---- SET-A ---------------------------------------------------------------
const seenA = new Set();
for (const { rel, anchors, minBodyChars } of setAFiles) {
  const abs = join(root, rel);
  const source = existsSync(abs) ? readFileSync(abs, "utf8") : null;
  // SET-C: exists, still declares its anchors, is not a hollow shim.
  failures.push(...auditAnchors(rel, source, anchors, minBodyChars));
  if (source === null) continue;
  seenA.add(rel);
  scan(rel, source, failures, FORBIDDEN_DISPLAY, SET_A_WHY);
  scan(rel, source, failures, FORBIDDEN_PURCHASE_RAIL, SET_A_PURCHASE_WHY);
}
for (const relDir of setADirs) {
  for (const { abs, rel } of collect(join(root, relDir), relDir, false)) {
    if (seenA.has(rel)) continue;
    // Discovered siblings carry no declared anchor (they are found, not
    // pinned), but they are held to the same content rules.
    const source = readFileSync(abs, "utf8");
    scan(rel, source, failures, FORBIDDEN_DISPLAY, SET_A_WHY);
    scan(rel, source, failures, FORBIDDEN_PURCHASE_RAIL, SET_A_PURCHASE_WHY);
  }
}

// ---- SET-B ---------------------------------------------------------------
const seenB = new Set();
for (const { rel, anchors, minBodyChars } of setBFiles) {
  const abs = join(root, rel);
  const source = existsSync(abs) ? readFileSync(abs, "utf8") : null;
  failures.push(...auditAnchors(rel, source, anchors, minBodyChars));
  if (source === null) continue;
  seenB.add(rel);
  scan(rel, source, failures, FORBIDDEN_MONEY, SET_B_WHY);
}
for (const relDir of setBDirs) {
  for (const { abs, rel } of collect(join(root, relDir), relDir, true)) {
    if (seenB.has(rel)) continue;
    scan(rel, readFileSync(abs, "utf8"), failures, FORBIDDEN_MONEY, SET_B_WHY);
  }
}

if (failures.length > 0) {
  console.error("ORCH-1186-C menu-money gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1186-C menu-money gate passed.");
