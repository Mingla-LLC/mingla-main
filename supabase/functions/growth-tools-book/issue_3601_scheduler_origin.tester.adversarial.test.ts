// ISSUE-3601 — tester adversarial regression suite.
//
// The implementor's happy suite pins EXACT rendered strings for a handful of
// hand-picked payloads and source-scans the wiring. This suite deliberately
// attacks a different axis: it asserts INVARIANTS over exhaustive input
// batteries — every C0/C1 control point rather than eight samples, every casing
// and whitespace seam on the lookup key, the whole present/absent matrix for the
// optional lines, the prototype chain behind the label map, idempotence of a
// sanitizer that is applied at TWO layers, uniqueness of the guest and recipient
// lists rather than their length, and the REAL `escapeHtml` on the notification
// row rather than a source-scan that the call exists.
//
// Hermetic: `bookingDetails.ts` has zero imports, and `_shared/email/escape.ts`
// is documented pure with no external deps (asserted below, so a future remote
// import there fails loudly instead of quietly needing --allow-net). No network,
// no environment priming. `--allow-read` is only for reading `index.ts`.
//
// The lane that runs this file is the #2148-retained Supabase + Deno lane. It is
// named by ISSUE, never by filename: a tracked non-workflow file that spells a
// workflow's own filename becomes a discovered provider reference and moves a
// frozen CI provider digest, so no workflow filename or extension appears here.

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  buildAttendees,
  buildEventDescription,
  buildNotifyRecipients,
  INFO_NOTIFY_EMAIL,
  originLabel,
  sanitizeLine,
  SCHEDULER_BASE_LINE,
  SHARED_LINK_ORIGIN_LABEL,
} from "./bookingDetails.ts";

import { escapeHtml } from "../_shared/email/escape.ts";

const HERE = new URL("./", import.meta.url);
const indexSource = await Deno.readTextFile(new URL("index.ts", HERE));
const escapeSource = await Deno.readTextFile(
  new URL("../_shared/email/escape.ts", HERE),
);

const OLD_SENTENCE = "Intro call booked from the Mingla Venue Website Grader.";
const OLD_PRODUCT_LABEL = "Venue Website Grader";
const ORIGIN_PREFIX = "Came from: ";
const BOOKER_PREFIX = "Booked by: ";

const BASE_INPUT = {
  name: "Jane Doe",
  email: "jane@example.com",
  venue: "",
  reportUrl: "",
  source: "",
};

type DescInput = typeof BASE_INPUT;
// deno-lint-ignore no-explicit-any
const desc = (over: Record<string, any> = {}) =>
  buildEventDescription({ ...BASE_INPUT, ...over } as DescInput);

/**
 * The properties that must hold for EVERY description, whatever the input. Every
 * battery below funnels through this, so a new hostile input only has to be added
 * to a list — the invariant set is asserted identically for all of them.
 */
function assertDescriptionInvariants(label: string, description: string): void {
  const lines = description.split("\n");
  assertEquals(
    lines[0],
    SCHEDULER_BASE_LINE,
    `${label}: line 1 must be the fixed scheduler sentence`,
  );
  assert(
    lines[1] !== undefined && lines[1].startsWith(ORIGIN_PREFIX),
    `${label}: line 2 must be the origin line, got ${JSON.stringify(lines[1])}`,
  );
  assert(
    lines[1].length > ORIGIN_PREFIX.length,
    `${label}: the origin line must never be a dangling label`,
  );
  assertEquals(
    lines.filter((l) => l.startsWith(ORIGIN_PREFIX)).length,
    1,
    `${label}: exactly one origin line`,
  );
  // The amended §7.4.1 property: exactly one LINE BEGINNING with the booker
  // label, and it names the real booker. The substring count is legitimately >1
  // when a forgery is neutralised in place, because the sanitizer REPLACES
  // control characters with a space instead of deleting them — deleting would
  // hide the injection from whoever reads the invite.
  assertEquals(
    lines.filter((l) => l.startsWith(BOOKER_PREFIX)).length,
    1,
    `${label}: exactly one line begins with the booker label`,
  );
  assert(
    !description.includes("\n\n"),
    `${label}: never a blank line`,
  );
  for (const l of lines) {
    assert(l.length > 0, `${label}: no empty line`);
    assertNotEquals(l, OLD_SENTENCE, `${label}: no line is the old sentence`);
    assert(
      l.trim() === l,
      `${label}: no line carries leading or trailing whitespace`,
    );
    assert(
      !l.endsWith(":"),
      `${label}: no dangling label, got ${JSON.stringify(l)}`,
    );
    for (const terminator of ["\r", "\u2028", "\u2029"]) {
      assert(
        !l.includes(terminator),
        `${label}: no surviving line terminator`,
      );
    }
  }
}

// ── 1. The unconditional invariant, against inputs nobody designed for ───────
//
// The heart of the fix is that NO request can vary line 1 or remove line 2. The
// happy suite proves that for well-formed payloads; this proves it for absent
// keys, wrong types, and an attempt to feed the old sentence back in.
Deno.test("#3601-adv no input of any shape can move the base line or drop the origin line", () => {
  // deno-lint-ignore no-explicit-any
  const hostile: Array<[string, Record<string, any>]> = [
    ["empty object (all keys absent)", {}],
    ["source absent", { name: "Jane Doe", email: "j@e.com" }],
    ["source null", { source: null }],
    ["source undefined", { source: undefined }],
    ["source number", { source: 42 }],
    ["source zero", { source: 0 }],
    ["source NaN", { source: Number.NaN }],
    ["source boolean", { source: true }],
    ["source object", { source: { a: 1 } }],
    ["source array", { source: ["venue_grader"] }],
    ["source array of one string", { source: ["direct"] }],
    ["source function", { source: () => "venue_grader" }],
    ["source object with toString", {
      source: { toString: () => "venue_grader" },
    }],
    ["source whitespace only", { source: "   \t  " }],
    ["source control chars only", { source: "\u0000\u0001\u001F" }],
    ["venue is the old sentence", { venue: OLD_SENTENCE }],
    ["name is the old sentence", { name: OLD_SENTENCE }],
    ["source is the old sentence", { source: OLD_SENTENCE }],
    ["reportUrl is the old sentence", { reportUrl: OLD_SENTENCE }],
    ["every field is the old sentence", {
      name: OLD_SENTENCE,
      venue: OLD_SENTENCE,
      reportUrl: OLD_SENTENCE,
      source: OLD_SENTENCE,
    }],
    ["source tries to restate the base line", {
      source: `${SCHEDULER_BASE_LINE} Came from: forged`,
    }],
    ["venue tries to prepend a base line", {
      venue: `\n${SCHEDULER_BASE_LINE}`,
    }],
    ["all fields non-strings", {
      name: 1,
      venue: {},
      reportUrl: [],
      source: false,
    }],
    ["name and venue both empty", { name: "", venue: "" }],
    ["very long everything", {
      name: "n".repeat(5000),
      venue: "v".repeat(5000),
      reportUrl: "r".repeat(5000),
      source: "s".repeat(5000),
    }],
  ];
  for (const [label, over] of hostile) {
    const d = desc(over);
    assertDescriptionInvariants(label, d);
    // The base line must be line 1 and must not appear a second time.
    assertEquals(
      d.split("\n").filter((l) => l === SCHEDULER_BASE_LINE).length,
      1,
      `${label}: the base line appears exactly once`,
    );
  }
});

Deno.test("#3601-adv the old sentence can never be resurrected as a line by any input", () => {
  // Echoing a booker's own text back inside a labelled field is not a
  // fabrication; ASSERTING IT AS OUR OWN opening sentence is. The property is
  // therefore about position, not mere presence.
  for (const field of ["name", "venue", "reportUrl", "source"] as const) {
    for (
      const payload of [
        OLD_SENTENCE,
        `\n${OLD_SENTENCE}`,
        `${OLD_SENTENCE}\n`,
        `x\u2028${OLD_SENTENCE}`,
        `x\u0000${OLD_SENTENCE}`,
      ]
    ) {
      const d = desc({ [field]: payload });
      const lines = d.split("\n");
      assertEquals(
        lines[0],
        SCHEDULER_BASE_LINE,
        `${field} via ${JSON.stringify(payload)}`,
      );
      assert(
        !lines.some((l) => l === OLD_SENTENCE),
        `${field}: the old sentence must never occupy a line of its own`,
      );
      assert(
        !lines.some((l) => l.startsWith(OLD_SENTENCE)),
        `${field}: no line may begin with the old sentence`,
      );
    }
  }
  // And it must never be the origin label, which is the one place a fallback
  // could have reintroduced it.
  for (const s of ["", "direct", "unknown_tag", "venues", "venue", "grader"]) {
    assertNotEquals(originLabel(s), OLD_PRODUCT_LABEL);
  }
});

// ── 2. The lookup key: every casing and whitespace seam ──────────────────────
//
// `originLabel` lower-cases before the lookup but returns the UNKNOWN value with
// its ORIGINAL casing. That asymmetry is the seam: a known key in any casing must
// still MAP, and an unknown value must survive byte-for-byte after trimming.
Deno.test("#3601-adv a known source maps in every casing and through surrounding whitespace", () => {
  const known: Array<[string, string]> = [
    ["venue_grader", "Venue Website Grader"],
    ["event_predictor", "Event Turnout Predictor"],
    ["trip_quoter", "Quote Any Trip"],
    ["pricing_audit", "Undercharging Audit"],
  ];
  for (const [key, label] of known) {
    const variants = [
      key,
      key.toUpperCase(),
      key[0].toUpperCase() + key.slice(1),
      key.replace(/_(.)/g, (_m, c) => `_${c.toUpperCase()}`),
      key.split("").map((c, i) => i % 2 ? c.toUpperCase() : c).join(""),
      `  ${key}  `,
      `\t${key.toUpperCase()}\n`,
      ` ${key.replace("_", "_")} `,
    ];
    for (const v of variants) {
      assertEquals(
        originLabel(v),
        label,
        `${JSON.stringify(v)} must map to ${label}`,
      );
      // And through the full builder, so the seam is proved on the rendered line
      // and not only on the helper.
      assertEquals(
        desc({ source: v }).split("\n")[1],
        `${ORIGIN_PREFIX}${label}`,
      );
    }
  }
});

Deno.test("#3601-adv direct and blank collapse to the shared-link label through every seam", () => {
  for (
    const v of [
      "",
      " ",
      "   ",
      "\t",
      "\n",
      "\r\n",
      "\u2028",
      "\u0000",
      "\u0000\u0001",
      "direct",
      "DIRECT",
      "Direct",
      "dIrEcT",
      "  direct  ",
      "\tDIRECT\n",
      "\u0000direct\u0000",
    ]
  ) {
    assertEquals(
      originLabel(sanitizeLine(v, 40)),
      SHARED_LINK_ORIGIN_LABEL,
      `${JSON.stringify(v)} must mean a shared scheduler link`,
    );
    assertEquals(
      desc({ source: v }).split("\n")[1],
      `${ORIGIN_PREFIX}${SHARED_LINK_ORIGIN_LABEL}`,
      `${JSON.stringify(v)} rendered`,
    );
  }
  // "direct" must collapse only when it IS the whole value.
  for (const v of ["directly", "direct_mail", "redirect", "direct "]) {
    const sanitized = sanitizeLine(v, 40);
    if (sanitized === "direct") continue;
    assertNotEquals(
      originLabel(sanitized),
      SHARED_LINK_ORIGIN_LABEL,
      `${JSON.stringify(v)} is its own tag, not the bare-link case`,
    );
  }
});

Deno.test("#3601-adv an unknown tag is returned verbatim, and is never a STRING that differs only by case from itself", () => {
  const unknown = [
    "cold_email",
    "Cold_Email",
    "COLD_EMAIL",
    "linkedin_dm",
    "Investor Intro",
    "venue-grader",
    "venue grader",
    "venuegrader",
    "venue_graderr",
    "vvenue_grader",
    "Venue Website Grade",
    "q1",
    "Ünïcødé_Tåg",
    "日本語タグ",
    "tag with spaces",
    "UPPER lower MiXeD",
  ];
  for (const s of unknown) {
    assertEquals(originLabel(s), s, `${JSON.stringify(s)} must print verbatim`);
    assertNotEquals(originLabel(s), OLD_PRODUCT_LABEL);
    assertEquals(desc({ source: s }).split("\n")[1], `${ORIGIN_PREFIX}${s}`);
  }
});

// ── 3. The prototype chain behind the label map ──────────────────────────────
//
// `ORIGIN_LABELS` is a plain object literal, so its lookup walks
// `Object.prototype`. `?? s` only fires on nullish, and an inherited member is
// not nullish. `toLowerCase()` before the lookup happens to shield every
// mixed-case inherited member, which leaves exactly the all-lowercase ones.
Deno.test("#3601-adv originLabel always returns a STRING, and an unmapped tag is never an inherited member of the label map", () => {
  const inherited = [
    ...Object.getOwnPropertyNames(Object.prototype),
    "__proto__",
    "prototype",
  ];
  const probes = new Set<string>();
  for (const k of inherited) {
    probes.add(k);
    probes.add(k.toLowerCase());
    probes.add(k.toUpperCase());
  }
  for (const s of probes) {
    const got = originLabel(s);
    assertEquals(
      typeof got,
      "string",
      `originLabel(${
        JSON.stringify(s)
      }) must return a string, got ${typeof got} (${
        String(got).slice(0, 60)
      }). The label map is a plain object literal, so the lookup walks Object.prototype and \`?? s\` does not fire on an inherited member; gate the lookup with Object.hasOwn.`,
    );
    assertEquals(
      got,
      s,
      `originLabel(${JSON.stringify(s)}) must print the tag verbatim`,
    );
  }
});

Deno.test("#3601-adv the rendered origin line never leaks a runtime internal", () => {
  for (const s of ["constructor", "Constructor", "CONSTRUCTOR", "__proto__"]) {
    const line = desc({ source: s }).split("\n")[1];
    assertEquals(line, `${ORIGIN_PREFIX}${s}`);
    for (const leak of ["[native code]", "[object Object]", "function ("]) {
      assert(
        !line.includes(leak),
        `source=${JSON.stringify(s)} leaked ${leak} onto the invite: ${line}`,
      );
    }
  }
});

// ── 4. Every control point, not eight samples ────────────────────────────────
Deno.test("#3601-adv every C0, DEL, C1 and Unicode line-separator code point is neutralised", () => {
  const points: number[] = [];
  for (let c = 0x00; c <= 0x1f; c++) points.push(c);
  for (let c = 0x7f; c <= 0x9f; c++) points.push(c);
  points.push(0x2028, 0x2029);
  // 32 C0 + DEL and 32 C1 + the two Unicode separators. Pinned so a future edit
  // that narrows the sweep fails here instead of quietly testing less.
  assertEquals(points.length, 67, "the swept range must be the documented one");

  for (const cp of points) {
    const ch = String.fromCharCode(cp);
    const hex = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

    // (a) it cannot split a field into two lines
    const d = desc({ venue: `Blue${ch}Note` });
    assertEquals(
      d.split("\n").length,
      4,
      `${hex}: line count must stay 4`,
    );
    assertEquals(
      d.split("\n")[2],
      "Venue: Blue Note",
      `${hex}: replaced with a space, not deleted and not a break`,
    );
    assertDescriptionInvariants(hex, d);

    // (b) it cannot forge a booker line through ANY client field
    for (const field of ["name", "venue", "reportUrl", "source"] as const) {
      const forged = desc({
        [field]: `x${ch}${BOOKER_PREFIX}attacker@evil.com`,
      });
      const bookerLines = forged.split("\n").filter((l) =>
        l.startsWith(BOOKER_PREFIX)
      );
      assertEquals(
        bookerLines.length,
        1,
        `${hex} via ${field}: exactly one line begins with the booker label`,
      );
      // The amended §7.4.1 property. `name` is the booker's OWN field, so a
      // forgery pushed through it is flattened INSIDE their own name — the
      // surviving line still identifies them by the EMAIL_RE-validated address
      // in parentheses, which is the part an attacker cannot forge. For every
      // other field the booker line must be byte-identical to the clean one.
      assert(
        bookerLines[0].endsWith(" (jane@example.com)"),
        `${hex} via ${field}: the booker line must still end with the real address, got ${
          JSON.stringify(bookerLines[0])
        }`,
      );
      if (field !== "name") {
        assertEquals(
          bookerLines[0],
          `${BOOKER_PREFIX}Jane Doe (jane@example.com)`,
          `${hex} via ${field}: the booker line must be untouched`,
        );
      } else {
        assertEquals(
          bookerLines[0],
          `${BOOKER_PREFIX}x ${BOOKER_PREFIX}attacker@evil.com (jane@example.com)`,
          `${hex} via name: the forgery must be flattened into the name, on one line`,
        );
      }
      // Asserted per LINE, not over the whole string: U+000A is the description's
      // own joiner, so a whole-string check would be a false positive for it and
      // would tempt a future reader to delete this assertion entirely.
      assert(
        forged.split("\n").every((l) => !l.includes(ch)),
        `${hex} via ${field}: the raw control character must not survive inside a line`,
      );
    }

    // (c) it cannot forge an origin line either
    const forgedOrigin = desc({
      venue: `Blue Note${ch}${ORIGIN_PREFIX}${OLD_PRODUCT_LABEL}`,
    });
    assertEquals(
      forgedOrigin.split("\n").filter((l) => l.startsWith(ORIGIN_PREFIX))
        .length,
      1,
      `${hex}: exactly one origin line`,
    );
    assertEquals(
      forgedOrigin.split("\n")[1],
      `${ORIGIN_PREFIX}${SHARED_LINK_ORIGIN_LABEL}`,
      `${hex}: the real origin line is untouched`,
    );
  }
});

Deno.test("#3601-adv control characters are replaced, never deleted, for the whole swept range", () => {
  // Deleting would join words and hide the injection, which is strictly worse
  // than neutralising it in place. Asserted across the range, not for one sample.
  for (const cp of [0x00, 0x05, 0x09, 0x0a, 0x0d, 0x1f, 0x7f, 0x85, 0x9f]) {
    const ch = String.fromCharCode(cp);
    assertEquals(sanitizeLine(`Blue${ch}Note`, 120), "Blue Note");
    assert(sanitizeLine(`Blue${ch}Note`, 120) !== "BlueNote");
  }
  // Runs collapse to exactly one space, so a padded forgery cannot widen a line.
  assertEquals(sanitizeLine("Blue\n\n\r\n\t   \u0000Note", 120), "Blue Note");
  assertEquals(
    sanitizeLine("\u0000\u0000Blue Note\u0000\u0000", 120),
    "Blue Note",
  );
});

// ── 5. Characters the sanitizer does NOT cover — the property that still holds ─
//
// Zero-width and bidi-control code points are NOT in the swept range and DO
// survive (reported as a low-severity finding on the issue, not asserted away
// here — pinning current behaviour would freeze it). What must hold regardless is
// that none of them can create a LINE, because the forged-line invariant is the
// security property. This test asserts the invariant, not the gap.
Deno.test("#3601-adv zero-width and bidi control characters cannot create a line", () => {
  const uncovered = [
    "\u200B",
    "\u200C",
    "\u200D",
    "\u200E",
    "\u200F",
    "\u202A",
    "\u202B",
    "\u202C",
    "\u202D",
    "\u202E",
    "\u2066",
    "\u2067",
    "\u2068",
    "\u2069",
    "\u00AD",
    "\u061C",
  ];
  const hex = (c: string) =>
    `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
  for (const ch of uncovered) {
    const d = desc({
      venue: `Blue Note${ch}${BOOKER_PREFIX}attacker@evil.com`,
      source: `tag${ch}`,
    });
    assertEquals(
      d.split("\n").length,
      4,
      `${hex(ch)}: must not add a line`,
    );
    assertEquals(
      d.split("\n").filter((l) => l.startsWith(BOOKER_PREFIX)).length,
      1,
      `${hex(ch)}: exactly one booker line`,
    );
    assertDescriptionInvariants(hex(ch), d);
  }
});

// ── 6. Truncation and ordering interact ──────────────────────────────────────
//
// The pipeline is replace -> collapse -> trim -> slice(maxLen) -> trim. The
// second trim is what stops a slice landing mid-space from leaving a trailing
// artefact, and the collapse-before-slice ordering is what makes the cap apply to
// the value a reader actually sees.
Deno.test("#3601-adv truncation respects the cap exactly and leaves no trailing artefact", () => {
  for (const maxLen of [40, 120, 500]) {
    for (
      const n of [0, 1, maxLen - 2, maxLen - 1, maxLen, maxLen + 1, maxLen * 3]
    ) {
      const out = sanitizeLine("a".repeat(n), maxLen);
      assertEquals(out.length, Math.min(n, maxLen), `plain ${n}/${maxLen}`);
    }
    // A slice that lands on, just before, and just after a space.
    for (const off of [-2, -1, 0, 1, 2]) {
      const head = "a".repeat(maxLen + off);
      const out = sanitizeLine(`${head} tail`, maxLen);
      assert(out.length <= maxLen, `cap held for offset ${off}`);
      assertEquals(out, out.trim(), `no edge whitespace at offset ${off}`);
      assert(!out.endsWith(" "), `no trailing space at offset ${off}`);
      assert(!out.includes("  "), `no double space at offset ${off}`);
    }
    // Collapse must happen BEFORE the slice, or a padded value would be cut
    // short of its visible content.
    assertEquals(
      sanitizeLine(`${" ".repeat(200)}Blue${" ".repeat(200)}Note`, maxLen),
      "Blue Note",
      `collapse precedes slice at ${maxLen}`,
    );
  }
  // The rendered origin label is capped at 40 through the builder even though
  // `originLabel` itself does not truncate.
  const long = desc({ source: "z".repeat(200) }).split("\n")[1];
  assertEquals(long, `${ORIGIN_PREFIX}${"z".repeat(40)}`);
  assertEquals(long.length, ORIGIN_PREFIX.length + 40);
  // And a 40-char source whose 40th position sits inside a collapsed run.
  assertEquals(
    desc({ source: `${"z".repeat(39)}   yyy` }).split("\n")[1],
    `${ORIGIN_PREFIX}${"z".repeat(39)}`,
  );
});

Deno.test("#3601-adv the sanitizer is idempotent, so applying it at two layers is a no-op", () => {
  // index.ts sanitizes at parse time AND buildEventDescription sanitizes again.
  // If the pass were not idempotent, the rendered value would depend on how many
  // layers ran, which is exactly the kind of drift a refactor introduces.
  const battery = [
    "",
    " ",
    "Blue Note",
    "  Blue   Note  ",
    "Blue\nNote",
    "\u0000\u0001Blue\u0085Note\u2028",
    "A\u200BB",
    "\u202EReversed",
    "z".repeat(39) + "\u{1F600}",
    "z".repeat(500),
    "é".repeat(200),
    "日本語".repeat(50),
    "a".repeat(39) + " b",
    "tab\there",
  ];
  for (const maxLen of [40, 120, 500]) {
    for (const raw of battery) {
      const once = sanitizeLine(raw, maxLen);
      const twice = sanitizeLine(once, maxLen);
      const thrice = sanitizeLine(twice, maxLen);
      assertEquals(
        twice,
        once,
        `not idempotent at ${maxLen} for ${JSON.stringify(raw)}`,
      );
      assertEquals(thrice, once, `not stable at ${maxLen}`);
    }
  }
  // Same property on the composed builder: re-feeding its own rendered fields
  // must not change the output.
  const first = desc({
    name: "  Jane\u0000Doe  ",
    venue: "Blue\nNote",
    reportUrl: "https://usemingla.com/r/a\u2028b",
    source: "  Cold_Email  ",
  });
  const second = buildEventDescription({
    name: sanitizeLine("  Jane\u0000Doe  ", 120),
    email: BASE_INPUT.email,
    venue: sanitizeLine("Blue\nNote", 120),
    reportUrl: sanitizeLine("https://usemingla.com/r/a\u2028b", 500),
    source: sanitizeLine("  Cold_Email  ", 40),
  });
  assertEquals(second, first, "pre-sanitized input must render identically");
});

// ── 7. The present/absent matrix for the two optional lines ──────────────────
Deno.test("#3601-adv every combination of optional fields renders a clean, gap-free description", () => {
  const venues = ["", "   ", "\u0000", "Blue Note"];
  const reports = ["", "  ", "\n", "https://usemingla.com/tools/venues/r/abc"];
  const sources = ["", "direct", "venue_grader", "cold_email"];
  let seenThree = 0;
  let seenFive = 0;
  for (const venue of venues) {
    for (const reportUrl of reports) {
      for (const source of sources) {
        const label = `venue=${JSON.stringify(venue)} report=${
          JSON.stringify(reportUrl)
        } source=${JSON.stringify(source)}`;
        const d = desc({ venue, reportUrl, source });
        assertDescriptionInvariants(label, d);
        const lines = d.split("\n");
        const hasVenue = sanitizeLine(venue, 120) !== "";
        const hasReport = sanitizeLine(reportUrl, 500) !== "";
        assertEquals(
          lines.length,
          3 + (hasVenue ? 1 : 0) + (hasReport ? 1 : 0),
          `${label}: line count`,
        );
        assertEquals(
          lines.filter((l) => l.startsWith("Venue: ")).length,
          hasVenue ? 1 : 0,
          `${label}: venue line presence`,
        );
        assertEquals(
          lines.filter((l) => l.startsWith("Their report: ")).length,
          hasReport ? 1 : 0,
          `${label}: report line presence`,
        );
        // Order is fixed: base, origin, venue?, booker, report?
        const bookerIdx = lines.findIndex((l) => l.startsWith(BOOKER_PREFIX));
        assertEquals(bookerIdx, hasVenue ? 3 : 2, `${label}: booker position`);
        if (hasReport) {
          assertEquals(bookerIdx, lines.length - 2, `${label}: report is last`);
        } else {
          assertEquals(bookerIdx, lines.length - 1, `${label}: booker is last`);
        }
        if (lines.length === 3) seenThree++;
        if (lines.length === 5) seenFive++;
      }
    }
  }
  // The matrix must actually have exercised both extremes, or the loop above
  // could pass vacuously after a refactor.
  assert(seenThree > 0, "the matrix must include a bare-link shape");
  assert(seenFive > 0, "the matrix must include a full funnel shape");
});

// ── 8. Guest list: uniqueness as an invariant, not a length check ────────────
Deno.test("#3601-adv the guest list can never hold the same address twice, and info@ is always on it", () => {
  const bookers = [
    "jane@example.com",
    "JANE@EXAMPLE.COM",
    INFO_NOTIFY_EMAIL,
    INFO_NOTIFY_EMAIL.toUpperCase(),
    "Info@UseMingla.Com",
    ` ${INFO_NOTIFY_EMAIL} `,
    `\t${INFO_NOTIFY_EMAIL}\n`,
    "info@usemingla.com.",
    "info+tag@usemingla.com",
    "notinfo@usemingla.com",
    "info@usemingla.com.evil.test",
    "seth@usemingla.com",
  ];
  for (const booker of bookers) {
    const attendees = buildAttendees(booker, "Whoever");
    const keys = attendees.map((a) => a.email.trim().toLowerCase());
    assertEquals(
      new Set(keys).size,
      keys.length,
      `${JSON.stringify(booker)}: duplicate guest ${JSON.stringify(keys)}`,
    );
    assert(
      keys.includes(INFO_NOTIFY_EMAIL),
      `${JSON.stringify(booker)}: info@ must be a guest`,
    );
    assertEquals(
      keys.filter((k) => k === INFO_NOTIFY_EMAIL).length,
      1,
      `${JSON.stringify(booker)}: info@ exactly once`,
    );
    assertEquals(
      attendees[0].email,
      booker,
      `${JSON.stringify(booker)}: the booker stays first and unrewritten`,
    );
    assert(
      attendees.length === 1 || attendees.length === 2,
      `${JSON.stringify(booker)}: only the booker and info@`,
    );
  }
  // Non-strings must not throw on a public unauthenticated function.
  // deno-lint-ignore no-explicit-any
  for (const bad of [undefined, null, 42, {}, []] as any[]) {
    const attendees = buildAttendees(bad, "Whoever");
    assertEquals(attendees.length, 2, `${String(bad)}: info@ still added`);
    assertEquals(attendees[1].email, INFO_NOTIFY_EMAIL);
  }
});

// ── 9. Notify recipients: ordering, emptiness, and case-insensitive de-dup ───
Deno.test("#3601-adv the notify list is never empty, never duplicates info@, and keeps NOTIFY_TO first", () => {
  const cases: Array<[string, number, string | null]> = [
    ["seth@usemingla.com", 2, "seth@usemingla.com"],
    ["  seth@usemingla.com  ", 2, "seth@usemingla.com"],
    ["\tSETH@USEMINGLA.COM\n", 2, "SETH@USEMINGLA.COM"],
    ["", 1, null],
    ["   ", 1, null],
    ["\t\n", 1, null],
    [INFO_NOTIFY_EMAIL, 1, INFO_NOTIFY_EMAIL],
    [INFO_NOTIFY_EMAIL.toUpperCase(), 1, INFO_NOTIFY_EMAIL.toUpperCase()],
    ["Info@UseMingla.Com", 1, "Info@UseMingla.Com"],
    ["  iNFO@usemingla.COM  ", 1, "iNFO@usemingla.COM"],
  ];
  for (const [notifyTo, expectedLength, expectedFirst] of cases) {
    const out = buildNotifyRecipients(notifyTo);
    const label = JSON.stringify(notifyTo);
    assert(out.length >= 1, `${label}: an empty recipient list would 422`);
    assertEquals(out.length, expectedLength, `${label}: length`);
    assertEquals(
      out[0],
      expectedFirst ?? INFO_NOTIFY_EMAIL,
      `${label}: first entry`,
    );
    // info@ is reachable exactly once, case-insensitively.
    assertEquals(
      out.filter((e) => e.trim().toLowerCase() === INFO_NOTIFY_EMAIL).length,
      1,
      `${label}: info@ exactly once`,
    );
    const keys = out.map((e) => e.trim().toLowerCase());
    assertEquals(new Set(keys).size, keys.length, `${label}: no duplicates`);
    for (const e of out) {
      assertEquals(e, e.trim(), `${label}: entries are trimmed`);
      assert(e.length > 0, `${label}: no empty entry`);
    }
    // Re-feeding the first entry must be stable.
    assertEquals(
      buildNotifyRecipients(out[0]),
      out,
      `${label}: idempotent under re-feeding`,
    );
  }
  // deno-lint-ignore no-explicit-any
  for (const bad of [undefined, null, 42, {}, []] as any[]) {
    assertEquals(buildNotifyRecipients(bad), [INFO_NOTIFY_EMAIL]);
  }
});

// ── 10. The notification email: real escaping, both bodies ──────────────────
//
// The happy suite source-scans that `escapeHtml(originLabel(input.source))`
// appears. That proves the call is written, not that it escapes. An unescaped tag
// in the HTML row would be an injection into an email Seth and info@ read, so the
// escaping is exercised here through the REAL helper.
Deno.test("#3601-adv the notification origin row escapes every HTML metacharacter", () => {
  assert(
    !/^\s*import\s/m.test(escapeSource),
    "escape.ts must stay import-free, or this suite stops being hermetic",
  );
  const row = (source: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">Came from</td><td style="color:#111827;font-weight:600;">${
      escapeHtml(originLabel(sanitizeLine(source, 40)))
    }</td></tr>`;

  const hostile = [
    `<script>alert(1)</script>`,
    `"><img src=x onerror=alert(1)>`,
    `</td></tr><tr><td>Came from</td><td>forged`,
    `a"b'c&d`,
    `&lt;already escaped&gt;`,
    `&amp;`,
    `' onmouseover='x`,
    `<b>bold</b>`,
    `--><!--`,
  ];
  for (const source of hostile) {
    const html = row(source);
    const value = html.slice(
      html.lastIndexOf('font-weight:600;">') + 'font-weight:600;">'.length,
      html.lastIndexOf("</td></tr>"),
    );
    const label = JSON.stringify(source);
    for (const meta of ["<", ">", '"', "'"]) {
      assert(
        !value.includes(meta),
        `${label}: raw ${meta} survived into the HTML row: ${value}`,
      );
    }
    // Every ampersand must be the start of an entity we produced.
    for (const m of value.matchAll(/&(?!amp;|lt;|gt;|quot;|#39;)/g)) {
      throw new Error(
        `${label}: bare ampersand at index ${m.index} in ${value}`,
      );
    }
    // The row keeps exactly one cell pair — no injected row.
    assertEquals(
      (html.match(/<tr>/g) ?? []).length,
      1,
      `${label}: no injected table row`,
    );
    assertEquals((html.match(/<td/g) ?? []).length, 2, `${label}: two cells`);

    // The plain-text body carries the SAME value, unescaped and single-line.
    const textLine = `${ORIGIN_PREFIX}${originLabel(sanitizeLine(source, 40))}`;
    assertEquals(
      textLine.split("\n").length,
      1,
      `${label}: text stays one line`,
    );
    assert(textLine.startsWith(ORIGIN_PREFIX));
    assertEquals(
      escapeHtml(textLine.slice(ORIGIN_PREFIX.length)),
      value,
      `${label}: HTML row and text line must carry the same value`,
    );
  }
  // A control character cannot break the plain-text body onto a new line either.
  for (const ch of ["\n", "\r\n", "\u2028", "\u0085", "\u0000"]) {
    const line = `${ORIGIN_PREFIX}${
      originLabel(sanitizeLine(`cold${ch}email`, 40))
    }`;
    assertEquals(line, `${ORIGIN_PREFIX}cold email`);
    assertEquals(line.split(/\r\n|\r|\n|\u2028|\u2029/).length, 1);
  }
});

// ── 11. The two layers' contract in index.ts ─────────────────────────────────
//
// `buildEventDescription` renders `Booked by:  (email)` — a dangling label with a
// doubled space — when `name` sanitizes to empty. That shape is unreachable over
// HTTP only because `index.ts` measures `name.length` AFTER sanitizing. That
// ordering is load-bearing and is pinned here.
Deno.test("#3601-adv the name length check is measured on the SANITIZED name", () => {
  const stripped = indexSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const assignIdx = stripped.indexOf(
    "const name = sanitizeLine(body.name, 120)",
  );
  assert(
    assignIdx !== -1,
    "name must be assigned from sanitizeLine(body.name, 120)",
  );
  const guardIdx = stripped.indexOf("name.length < 2");
  assert(guardIdx !== -1, "the minimum-length guard must still exist");
  assert(
    assignIdx < guardIdx,
    "the guard must run on the sanitized name, or a control-character-only name renders a dangling label",
  );
  assert(
    !/name\s*=\s*(?:typeof\s+)?body\.name\s*(?:===|\.)/.test(stripped),
    "name must not be read from body.name anywhere but the sanitizer call",
  );
  // The shape the guard is protecting against, demonstrated at the builder layer.
  for (const emptyish of ["", " ", "\u0000", "\u0000\u0001", "\t\n"]) {
    assertEquals(sanitizeLine(emptyish, 120), "");
    assert(
      sanitizeLine(emptyish, 120).length < 2,
      `${JSON.stringify(emptyish)} must be rejected by the guard`,
    );
  }
  // And a two-character name after sanitizing is accepted and renders cleanly.
  assertEquals(sanitizeLine("  J\u0000D  ", 120), "J D");
  assertEquals(
    desc({ name: "  J\u0000D  " }).split("\n")[2],
    `${BOOKER_PREFIX}J D (jane@example.com)`,
  );
});

// ── 12. The email carve-out is load-bearing, not decorative ─────────────────
//
// `email` is the one field `buildEventDescription` does NOT sanitize, on the
// documented grounds that `EMAIL_RE` in index.ts already rejects every character
// that can terminate a line. Nothing tested that regex, so the carve-out rested
// on an unverified claim. The REAL regex is extracted from index.ts here, so a
// future edit to it cannot silently invalidate the decision.
Deno.test("#3601-adv EMAIL_RE rejects every line terminator, which is what lets email skip the sanitizer", () => {
  const m = indexSource.match(/const EMAIL_RE = \/(.+?)\/;/);
  assert(m !== null, "EMAIL_RE literal must be extractable from index.ts");
  const emailRe = new RegExp(m[1]);
  assert(emailRe.test("jane@example.com"), "a normal address must pass");

  const terminators: Array<[string, string]> = [
    ["LF", "\n"],
    ["CR", "\r"],
    ["CRLF", "\r\n"],
    ["LINE SEPARATOR U+2028", "\u2028"],
    ["PARAGRAPH SEPARATOR U+2029", "\u2029"],
  ];
  for (const [nm, ch] of terminators) {
    for (
      const candidate of [
        `ja${ch}ne@example.com`,
        `jane@exa${ch}mple.com`,
        `jane@example.com${ch}`,
        `${ch}jane@example.com`,
        `jane@example.com${ch}Booked by: attacker@evil.com`,
      ]
    ) {
      assertEquals(
        emailRe.test(candidate),
        false,
        `${nm} must be rejected by EMAIL_RE: ${JSON.stringify(candidate)}`,
      );
    }
    // Load-bearing: if one DID get through, the description would gain a line,
    // because `email` is the one field the builder does not sanitize. This
    // proves the regex is the only thing standing between the two \u2014 so the
    // carve-out is a real dependency on EMAIL_RE, not a decorative comment.
    const splitOnTerminators = (s: string) =>
      s.split(/\r\n|\r|\n|\u2028|\u2029/).length;
    const clean = splitOnTerminators(desc({}));
    const wouldForge = desc({
      // deno-lint-ignore no-explicit-any
      email: `jane@example.com${ch}${BOOKER_PREFIX}attacker@evil.com` as any,
    });
    assertEquals(clean, 3, "the control description must be three lines");
    assert(
      splitOnTerminators(wouldForge) > clean,
      `${nm}: the carve-out must be load-bearing, not decorative`,
    );
    assert(
      wouldForge.split(/\r\n|\r|\n|\u2028|\u2029/).filter((l) =>
        l.startsWith(BOOKER_PREFIX)
      ).length === 2,
      `${nm}: an unfiltered email would forge a second booker line`,
    );
  }
});

// ── 13. Purity: no shared mutable state across interleaved calls ─────────────
Deno.test("#3601-adv the builders hold no shared state across interleaved concurrent calls", async () => {
  const jobs: Array<Promise<void>> = [];
  for (let i = 0; i < 200; i++) {
    jobs.push((async () => {
      await Promise.resolve();
      const source = i % 4 === 0 ? "venue_grader" : `tag_${i}`;
      const expectedLabel = i % 4 === 0 ? "Venue Website Grader" : `tag_${i}`;
      assertEquals(
        desc({ venue: `V${i}`, source }).split("\n")[1],
        `${ORIGIN_PREFIX}${expectedLabel}`,
      );
      await Promise.resolve();
      const notifyTo = i % 3 === 0 ? INFO_NOTIFY_EMAIL : `o${i}@usemingla.com`;
      assertEquals(
        buildNotifyRecipients(notifyTo).length,
        i % 3 === 0 ? 1 : 2,
      );
      assertEquals(
        buildAttendees(i % 5 === 0 ? INFO_NOTIFY_EMAIL : `b${i}@x.com`, "N")
          .length,
        i % 5 === 0 ? 1 : 2,
      );
    })());
  }
  await Promise.all(jobs);
  // The constants themselves must not have been mutated by any of that.
  assertEquals(SCHEDULER_BASE_LINE, "Booked from the Mingla Scheduler.");
  assertEquals(SHARED_LINK_ORIGIN_LABEL, "a shared scheduler link");
  assertEquals(INFO_NOTIFY_EMAIL, "info@usemingla.com");
});
