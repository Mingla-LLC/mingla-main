// Issue #1704 — adversarial suite. A DIFFERENT ANGLE from the happy-path file.
//
// `issue_1704_seed_country_from_city.test.ts` proves `seedCountryFields` returns
// the right values. That says nothing about whether anything CALLS it. The whole
// defect was a wiring fact: a correct value sitting in a variable, passed as a
// fallback to a parser that overrode it. A pure-function suite passes happily
// while the parser is back in place.
//
// So this file attacks the wiring, and it does so on STRIPPED SOURCE. Every
// `parseCountry` in `index.ts` today is inside the comment that records its
// deletion, and a naive substring search would therefore pass on a tree where
// the function had been restored — and, worse, would also pass on a tree where
// ONLY the comment existed. Comments and string literals are removed before any
// assertion runs (COMMS-0133: string presence is not proof).

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";

const SRC_URL = new URL("../index.ts", import.meta.url);
const RAW = await Deno.readTextFile(SRC_URL);

/**
 * Remove line comments, block comments and string/template literals, so what is
 * left is code that actually runs. Written as a small state machine rather than
 * a regex because a regex over this file mis-handles the `//` inside every
 * `https://` URL literal.
 */
function strip(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      out += '""';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const CODE = strip(RAW);

/**
 * Every `<name>(...)` in `src`, with its argument list captured by counting
 * parentheses rather than by regex — the arguments here nest (`parseCity(...)`
 * sits inside the call under test), and a regex stops at the first `)`.
 */
function callArgsOf(
  src: string,
  name: string,
): Array<{ args: string; isDeclaration: boolean }> {
  const found: Array<{ args: string; isDeclaration: boolean }> = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf(name, from);
    if (at < 0) break;
    from = at + name.length;
    let i = from;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== "(") continue;
    let depth = 0;
    const start = i;
    for (; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) break;
    }
    found.push({
      args: src.slice(start + 1, i),
      isDeclaration: /function\s+$/.test(src.slice(Math.max(0, at - 12), at)),
    });
  }
  return found;
}

/** Split an argument list on commas that are not inside nested parens/brackets. */
function splitTopLevelArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of args) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur.trim());
  return out;
}

Deno.test("#1704 adversarial — splitTopLevelArgs does not split inside a nested call", () => {
  // Guard the guard. If this split naively on every comma, argument 5 would be
  // whatever followed the last comma inside `parseCity(p, cityName)` and the
  // positional assertions below would be meaningless.
  assertEquals(splitTopLevelArgs("a, f(b, c), d"), ["a", "f(b, c)", "d"]);
  assertEquals(splitTopLevelArgs("p, x.y, cityCountry, parseCity(p, n), cityCountryCode").length, 5);
});

Deno.test("#1704 adversarial — the comment-stripper actually strips (guard the guard)", () => {
  // A vacuity check. If `strip` silently returned its input, every assertion
  // below would be testing raw text and the suite would be worthless.
  assertEquals(strip('const a = 1; // parseCountry\n'), "const a = 1; \n");
  assertEquals(strip("/* parseCountry */ const b = 2;"), " const b = 2;");
  assertEquals(strip('const c = "parseCountry";'), 'const c = "";');
  // And the real file must have lost something — it is full of comments.
  if (CODE.length >= RAW.length) {
    throw new Error("strip() removed nothing from index.ts; the guard is inert");
  }
  // The deletion comment is present in the raw file and absent from the code.
  assertStringIncludes(RAW, "parseCountry");
});

Deno.test("#1704 adversarial — no parseCountry survives in executable code", () => {
  assertEquals(
    CODE.includes("parseCountry"),
    false,
    "parseCountry is back in executable code — a place's country is being derived from prose again",
  );
});

Deno.test("#1704 adversarial — no country field is derived from an address anywhere", () => {
  // Broader than the name: catches a rename. Any expression that reads
  // formattedAddress within four lines of a `country` assignment is the defect
  // wearing a different hat.
  const lines = CODE.split("\n");
  const offenders: string[] = [];
  lines.forEach((line, idx) => {
    if (!/\bcountry(_code)?\s*[:=]/.test(line)) return;
    const window = lines.slice(Math.max(0, idx - 4), idx + 5).join("\n");
    if (/formattedAddress|\.address\b|\.split\(\s*""\s*\)/.test(window)) {
      offenders.push(`line ${idx + 1}: ${line.trim()}`);
    }
  });
  assertEquals(offenders, [], "a country is being derived from an address:\n" + offenders.join("\n"));
});

Deno.test("#1704 adversarial — the extracted resolver is imported AND called", () => {
  assertStringIncludes(CODE, "seedCountryFields");
  // Imported is not enough; it must be invoked.
  const calls = CODE.match(/seedCountryFields\s*\(/g) ?? [];
  if (calls.length < 2) {
    throw new Error(
      `seedCountryFields is called ${calls.length} time(s); both batch handlers must use it`,
    );
  }
});

Deno.test("#1704 adversarial — both transform call sites pass the city's country and code", () => {
  // Paren-BALANCED extraction. A lazy `\([^;]*?\)` stops at the first `)`, which
  // here is `parseCity(...)`'s — the argument list is nested, so a regex cannot
  // see the last argument at all and the assertion would silently test a prefix.
  const calls = callArgsOf(CODE, "transformGooglePlaceForSeed")
    .filter((c) => !c.isDeclaration);
  assertEquals(calls.length, 2, `expected 2 call sites, found ${calls.length}`);
  for (const call of calls) {
    // EXACT positional identity, not `includes`. A containment check is
    // satisfied by the defect itself: `parseCountry(p.formattedAddress,
    // cityCountry)` contains "cityCountry", so an `assertStringIncludes` here
    // passes on a fully reverted tree. Verified — it did, until this changed.
    const args = splitTopLevelArgs(call.args);
    assertEquals(args.length, 5, `expected 5 arguments, got ${args.length}: ${call.args}`);
    assertEquals(args[2], "cityCountry", "argument 3 must BE the city's country, not a call on it");
    assertEquals(args[4], "cityCountryCode", "argument 5 must BE the city's ISO code");
  }
});

Deno.test("#1704 adversarial — the row written to place_pool carries country_code", () => {
  // Without this the migration's column is populated only by the trigger, and a
  // writer that supplies an explicit wrong value would never be caught.
  assertStringIncludes(CODE, "country_code: countryCode");
});
