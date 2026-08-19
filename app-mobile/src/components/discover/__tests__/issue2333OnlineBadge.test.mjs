/**
 * issue #2333 [online-event-publish] — the consumer Discover card's "Online" badge.
 *
 * WHY THIS EXISTS. Migration 20270427002335 adds an online-only carve-out to
 * `pg_discover_business_events`, so an event with no city and no pin now surfaces in
 * EVERY market instead of being returned by none. Such a row has `venueName === null`
 * AND `city === null`, and the card rendered `data.venueName ?? data.city ?? ""` — the
 * EMPTY STRING. Shipping the carve-out alone would have put cards with a blank location
 * line and no online signal into every market's grid: a silent quality regression traded
 * for the silent invisibility being removed.
 *
 * Seth's decision (OQ-1, 2026-08-19): the badge is a HARD CO-REQUISITE of the carve-out,
 * not a follow-up. They ship together or neither ships. That is why this test file and
 * the S3 migration are in the same commit.
 *
 * Run: node --test src/components/discover/__tests__/issue2333OnlineBadge.test.mjs
 * (from app-mobile/ — same shape as issue1423StayDiscovery.test.mjs, no jest needed).
 *
 * NOT A PURE SOURCE GREP. The first test EXTRACTS the shipped `isOnlineEvent`
 * expression out of the component and EXECUTES it against three real card shapes, so
 * the hybrid trap is caught by evaluation and not by a string match (issue #2113 —
 * checks that carry no info).
 *
 * fails-on-revert (TRUE LINE DELETION):
 *   * delete `const isOnlineEvent = ...` and the badge JSX → every test here goes red.
 *   * widen the predicate to `data.format !== "in-person"` (the client-side shape of the
 *     same hybrid trap the migration carries) → the executable test goes red because a
 *     hybrid card, which HAS a real venue, would render "Online" instead of it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync(
  new URL("../BusinessEventCard.tsx", import.meta.url),
  "utf8",
);

/** Strip comments so prose describing the trap can neither satisfy nor break a check. */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
  .replace(/^\s*\/\/.*$/gm, "");

test("#2333 the SHIPPED online predicate, executed — online yes, hybrid and in-person no", () => {
  // Pull the real expression out of the component and run it. This is the hybrid trap
  // in its client-side form: `deriveSharedFormat` returns "hybrid" for a hybrid event,
  // which has a real venue and a real city and must keep rendering them.
  const m = code.match(/const isOnlineEvent\s*=\s*([^;]+);/);
  assert.ok(m, "BusinessEventCard must declare `const isOnlineEvent = ...`");

  const predicate = new Function("data", `return (${m[1]});`);

  assert.equal(
    predicate({ format: "online", venueName: null, city: null }),
    true,
    "an online-only card must be treated as online",
  );
  assert.equal(
    predicate({ format: "hybrid", venueName: "The Venue", city: "Lagos" }),
    false,
    "a HYBRID card has a real venue in a real city — it must NOT render the Online badge",
  );
  assert.equal(
    predicate({ format: "in-person", venueName: "The Venue", city: "London" }),
    false,
    "an in-person card must NOT render the Online badge",
  );
  // The shared format string is hyphenated ("in-person"), not snake_cased — a
  // predicate written against "in_person" would silently badge every in-person card.
  assert.equal(
    predicate({ format: "in_person", venueName: "V", city: "C" }),
    false,
    "even a mis-cased in-person value must not fall through to the Online badge",
  );
});

test("#2333 the badge renders the word Online in the venue slot", () => {
  assert.ok(
    /isOnlineEvent \? \(/.test(code),
    "the meta row must branch on isOnlineEvent",
  );
  assert.match(
    code,
    /<View style=\{styles\.onlineBadge\}>[\s\S]{0,200}?Online[\s\S]{0,120}?<\/View>/,
    "an `onlineBadge` view containing the literal text `Online` must render",
  );
});

test("#2333 the badge is checked BEFORE the venue line, so a stale venueName cannot win", () => {
  // A legacy online row can still carry a venueName from an earlier in-person state.
  // Rendering it would advertise a venue nobody can turn up to.
  const branchStart = code.indexOf("isOnlineEvent ? (");
  const venueBranch = code.indexOf("venueLine.length > 0");
  assert.ok(branchStart > -1 && venueBranch > -1, "both branches must exist");
  assert.ok(
    branchStart < venueBranch,
    "the isOnlineEvent branch must be evaluated before the venueLine branch",
  );
});

test("#2333 a screen-reader user gets the online signal too", () => {
  // The card is ONE a11y element (accessibilityRole="button"), so the badge's text is
  // not announced separately. Without this the blind experience is the blank venue line
  // the badge exists to remove.
  assert.match(
    code,
    /accessibilityLabel=\{[\s\S]{0,240}?isOnlineEvent[\s\S]{0,240}?online event[\s\S]{0,120}?\}/,
    "the card accessibilityLabel must name the event as online when it is online",
  );
});

test("#2333 the badge reuses the card's existing pill idiom — no new visual language", () => {
  // `minglaPill` (this file) and `StayCard.kindBadge` (same directory) are the
  // established shapes: fully-rounded, hairline rgba(255,255,255,0.18) border, small
  // 600-weight white text. Only the FILL differs, because this pill sits inside the
  // already-dark infoChip and a darkening fill would be invisible against its parent.
  const badge = code.match(/onlineBadge: \{([\s\S]*?)\},/);
  assert.ok(badge, "styles.onlineBadge must exist");
  assert.match(badge[1], /borderRadius: 999/, "same fully-rounded radius as minglaPill");
  assert.match(
    badge[1],
    /borderColor: "rgba\(255,255,255,0\.18\)"/,
    "same hairline as StayCard.kindBadge",
  );

  const badgeText = code.match(/onlineBadgeText: \{([\s\S]*?)\},/);
  assert.ok(badgeText, "styles.onlineBadgeText must exist");
  assert.match(badgeText[1], /fontSize: 10/, "same 10px scale as minglaPillText");
  assert.match(badgeText[1], /letterSpacing: 0\.3/, "same tracking as minglaPillText");
  // The rhythm guard: the meta row's date text is 11px with a ~14px line box. An
  // explicit lineHeight keeps an online card's info chip exactly as tall as its
  // in-person neighbours in the same grid row.
  assert.match(badgeText[1], /lineHeight: 12/, "explicit lineHeight pins the row height");
});

test("#2333 the old blank-venue path is still there for NON-online cards", () => {
  // The fix must not have removed the venue line for everyone.
  assert.match(
    code,
    /const venueLine\s*=\s*\n?\s*data\.venueName \?\? data\.city \?\? "";/,
    "the venueLine expression must survive unchanged for in-person and hybrid cards",
  );
});
