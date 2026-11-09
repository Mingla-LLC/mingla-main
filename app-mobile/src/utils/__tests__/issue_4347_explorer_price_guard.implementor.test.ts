// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4347 — GUARD: an Explorer price is never formatted without the
// currency its amount is in, and no Explorer price surface writes a literal
// "$" next to an amount.
//
// It fails when:
//   - `formatCurrency` regains a default for its source (or target) currency,
//     or any caller in app-mobile/src passes it fewer than three arguments;
//   - a second `formatCurrency` / `formatPriceRange` / tier-bracket money
//     helper (tierRangeLabel, formatTierLabel, curatedTotalPriceRange) comes
//     back anywhere in app-mobile/src;
//   - an Explorer price surface writes `$${…}` or `"$" + …`, or binds the plan
//     formatter to a bare amount (`formatMoney: (amount) =>`) again;
//   - the plan producer stops handing the experience's OWN currency to the
//     formatter, or the call sites stop binding formatDisplayPrice.
//
// Comments are blanked before matching, so prose cannot satisfy or trip it.
// FAILS-ON-REVERT: restoring `sourceCurrency: string = 'USD'`, the
// `formatCurrency(amount, currencyCode || 'USD')` call sites, or the collab
// card's `${currencySymbol}${Math.round(… * currencyRate)}` fails here.
//
// Run: deno test --allow-read --no-check app-mobile/src/utils/__tests__/issue_4347_explorer_price_guard.implementor.test.ts

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const SRC = new URL("../../", import.meta.url);

function stripComments(src: string): string {
  // Block comments, then line comments not inside a URL (`https://`).
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

async function read(rel: string): Promise<string> {
  return stripComments(await Deno.readTextFile(new URL(rel, SRC)));
}

async function walk(dir: URL, out: string[] = []): Promise<string[]> {
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name === "__tests__" || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const child = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
    if (entry.isDirectory) await walk(child, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.|\.d\.ts$/.test(entry.name)) {
      out.push(child.pathname);
    }
  }
  return out;
}

/** Every Explorer surface that prints a price (#4347 sweep). */
const PRICE_SURFACES = [
  "components/CuratedExperienceSwipeCard.tsx",
  "components/ExpandedCardModal.tsx",
  "components/expandedCard/expandedCardFacts.ts",
  "components/expandedCard/CardInfoSection.tsx",
  "components/expandedCard/EventDetailLayout.tsx",
  "components/expandedCard/TimelineSection.tsx",
  "components/board/SwipeableSessionCards.tsx",
  "components/activity/SavedGridCard.tsx",
  "components/activity/SavedTab.tsx",
  "components/activity/CalendarTab.tsx",
  "utils/cardConverters.ts",
  "services/deviceCalendarService.ts",
  "constants/priceTiers.ts",
  "screens/Experience/ConsumerExperienceDetailScreen.tsx",
  // "Experiences at this venue" rows on an expanded host venue card.
  "utils/venueExperienceMapping.ts",
  "components/expandedCard/VenueExperiencesSection.tsx",
];

/** Split a call's argument list at top-level commas. */
function topLevelArgs(src: string, open: number): string[] {
  let depth = 0;
  let current = "";
  const args: string[] = [];
  for (let i = open + 1; i < src.length; i += 1) {
    const ch = src[i];
    if ("([{".includes(ch)) depth += 1;
    if (")]}".includes(ch)) {
      if (depth === 0) {
        if (current.trim().length > 0) args.push(current.trim());
        return args;
      }
      depth -= 1;
    }
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  return args;
}

Deno.test("#4347 formatCurrency cannot be called without the amount's own currency", async () => {
  const formatters = await read("components/utils/formatters.ts");
  const sig = formatters.match(/export function formatCurrency\(([\s\S]*?)\)\s*:/);
  assert(sig !== null, "formatCurrency is gone from formatters.ts — update this guard with its replacement");
  assert(!/=/.test(sig![1]), `formatCurrency regained a default parameter: (${sig![1].trim()})`);
  assert(/sourceCurrency:\s*string/.test(sig![1]), "formatCurrency lost its required sourceCurrency");

  const offenders: string[] = [];
  for (const file of await walk(SRC)) {
    const src = stripComments(await Deno.readTextFile(file));
    const rel = file.slice(SRC.pathname.length);
    if (rel !== "components/utils/formatters.ts" && /export function formatCurrency\b|export const formatCurrency\b/.test(src)) {
      offenders.push(`${rel}: defines a second formatCurrency`);
    }
    for (const banned of ["formatPriceRange(", "tierRangeLabel(", "formatTierLabel(", "curatedTotalPriceRange(", "formatPriceRangeWithCommas(", "formatAmountWithSymbol("]) {
      if (src.includes(banned)) offenders.push(`${rel}: ${banned} is back`);
    }
    const re = /\bformatCurrency\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      if (/function\s+$/.test(src.slice(Math.max(0, m.index - 10), m.index))) continue;
      const args = topLevelArgs(src, m.index + "formatCurrency".length);
      if (args.length < 3) {
        offenders.push(`${rel}: formatCurrency(${args.join(", ")}) has no source currency`);
      }
    }
  }
  assert(offenders.length === 0, `Explorer money formatted without its currency:\n  ${offenders.join("\n  ")}`);
});

Deno.test("#4347 no Explorer price surface writes a literal $ next to an amount", async () => {
  const offenders: string[] = [];
  for (const rel of PRICE_SURFACES) {
    const src = await read(rel);
    src.split("\n").forEach((line, i) => {
      if (/\$\$\{/.test(line) || /["']\$["']\s*\+/.test(line) || /["'`]\$\d/.test(line)) {
        offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
      if (/formatMoney:\s*\(\s*amount\s*\)\s*=>/.test(line)) {
        offenders.push(`${rel}:${i + 1}: the plan formatter is bound to a bare amount again`);
      }
      if (/currencySymbol\}\$\{Math\.round/.test(line) || /getCurrencyRate\(/.test(line)) {
        offenders.push(`${rel}:${i + 1}: viewer symbol times a rate on an amount of unknown currency`);
      }
    });
  }
  assert(offenders.length === 0, `literal-dollar Explorer prices:\n  ${offenders.join("\n  ")}`);
});

Deno.test("#4347 venue experience rows convert from the experience's own currency", async () => {
  const mapping = await read("utils/venueExperienceMapping.ts");
  const fn = mapping.slice(mapping.indexOf("export function formatExperiencePrice("), mapping.indexOf("function venueStopLabel("));
  assert(fn.includes("formatFromPrice("), "formatExperiencePrice must go through the shared formatFromPrice rule");
  assert(fn.includes("currency: row.currency,"), "the row's OWN currency must be the source");
  assert(!/new Intl\.NumberFormat/.test(fn), "the row formats money itself again (unconverted)");
  assert(!/["']From |["']Free["']/.test(fn), "hard-coded English From / Free is back");
  const section = await read("components/expandedCard/VenueExperiencesSection.tsx");
  assert(/formatExperiencePrice\(row, currency, formatDisplayPrice, \{/.test(section),
    "the venue rows must bind formatDisplayPrice and the viewer's currency");
  assert(section.includes('t("cards:price.from"') && section.includes('t("cards:swipeable.free"'),
    "the venue rows must use the translated From / Free");
});

Deno.test("#4347 the plan price is formatted with the experience's own currency", async () => {
  const facts = await read("components/expandedCard/expandedCardFacts.ts");
  assert(/sourceCurrency:\s*typeof card\.currency === 'string' \? card\.currency : ''/.test(facts),
    "curatedPriceLabel must hand the experience's own currency to the formatter (no USD default)");
  assert(facts.includes("curatedSpendLevel("), "AI plans must show a spend level (Decision 2)");
  for (const rel of ["components/CuratedExperienceSwipeCard.tsx", "components/ExpandedCardModal.tsx"]) {
    const src = await read(rel);
    assert(/formatMoney:\s*\(price\)\s*=>\s*\n?\s*formatDisplayPrice\(\{\s*\.\.\.price,\s*viewerCurrency:/.test(src),
      `${rel}: the plan formatter must be formatDisplayPrice bound to the viewer only`);
    assert(src.includes("spendLevelLabel:"), `${rel}: the spend level label is not wired`);
  }
});
