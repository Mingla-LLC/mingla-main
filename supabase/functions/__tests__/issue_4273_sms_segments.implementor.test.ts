// #4273 — the segment count the quote, the sealed estimate and the send record
// all read. Runs both real calculators, the server adapter's and the Host app's,
// over one table of hand-derived cases and a sweep, so they cannot drift apart.
//
// MINGLA-INVARIANT: I-4273-SMS-SEGMENTS-MATCH-ENCODER | issue #4273 | computeSegments in smsAdapter.ts and smsCost.ts agree for every body, count GSM-7 extended characters as two septets and split no escape or surrogate pair across segments.
//
// Fails on revert: restore `Math.ceil(len / 153)` in either file and the
// `extended`, `pair-straddles` and `ucs2-emoji` cases fail, naming the side.

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  composeSmsBody,
  computeSegments as serverSegments,
} from "../_shared/adapters/smsAdapter.ts";
import {
  computeSegments as clientSegments,
  estimateSmsCost,
  wireBody,
} from "../../../mingla-business/src/utils/smsCost.ts";

interface SegmentCase {
  id: string;
  parts: [string, number][];
  encoding: "GSM-7" | "UCS-2";
  segments: number;
  segmentsBeforeThisFix: number;
}

const table = JSON.parse(
  Deno.readTextFileSync(
    new URL("./fixtures/issue4273_sms_segment_cases.json", import.meta.url),
  ),
) as { cases: SegmentCase[] };

const build = (parts: [string, number][]): string =>
  parts.map(([text, times]) => text.repeat(times)).join("");

/** The calculator as it stood before this fix, frozen to compare against. */
function before(text: string, gsm7: boolean): number {
  const len = text.length;
  if (gsm7) return len <= 160 ? 1 : Math.ceil(len / 153);
  return len <= 70 ? 1 : Math.ceil(len / 67);
}

Deno.test("#4273 both calculators match every case in the shared table", () => {
  assertEquals(table.cases.length >= 40, true, "the table lost its cases");
  for (const row of table.cases) {
    const body = build(row.parts);
    assertEquals(
      { id: row.id, side: "server", segments: serverSegments(body) },
      { id: row.id, side: "server", segments: row.segments },
    );
    assertEquals(
      { id: row.id, side: "client", segments: clientSegments(body) },
      { id: row.id, side: "client", segments: row.segments },
    );
  }
});

Deno.test("#4273 the table really changes the count somewhere, and only where it should", () => {
  const changed = table.cases.filter((row) =>
    row.segments !== row.segmentsBeforeThisFix
  ).map((row) => row.id);
  assertEquals(changed.length > 15, true);
  for (const id of changed) {
    assertEquals(
      /extended|each-|form-feed|pair-straddles|emoji|surrogate/.test(id),
      true,
      id,
    );
  }
});

Deno.test("#4273 a message without those characters counts exactly as before", () => {
  const basic = "Doors open at 8pm, bring a friend! 0123456789 @£$_\n";
  const bmp = "Вход в 8 вечера, приводите друга 世界 ";
  let compared = 0;
  for (let n = 1; n <= 1600; n++) {
    const gsm = basic.repeat(Math.ceil(n / basic.length)).slice(0, n);
    const ucs2 = `ж${bmp.repeat(Math.ceil(n / bmp.length))}`.slice(0, n);
    assertEquals(serverSegments(gsm), before(gsm, true), `gsm server ${n}`);
    assertEquals(clientSegments(gsm), before(gsm, true), `gsm client ${n}`);
    assertEquals(serverSegments(ucs2), before(ucs2, false), `ucs2 server ${n}`);
    assertEquals(clientSegments(ucs2), before(ucs2, false), `ucs2 client ${n}`);
    compared += 4;
  }
  assertEquals(compared, 6400);
});

Deno.test("#4273 client and server agree on mixed bodies across every boundary", () => {
  const atoms = ["a", "€", "[", "\f", "\n", " ", "ж", "🎉", "é", "|"];
  let seed = 4273;
  const next = (limit: number): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % limit;
  };
  for (let round = 0; round < 3000; round++) {
    // Half the bodies stay in GSM-7 so the septet path is really exercised.
    const pool = round % 2 === 0
      ? atoms.filter((atom) => atom !== "ж" && atom !== "🎉")
      : atoms;
    let body = "";
    const length = next(520);
    for (let i = 0; i < length; i++) body += pool[next(pool.length)];
    assertEquals(
      serverSegments(body),
      clientSegments(body),
      JSON.stringify(body),
    );
  }
});

Deno.test("#4273 the opt-out footer counts the same way, in the same place", () => {
  // The footer is 24 septets, all basic: a 136-septet body is the most that
  // stays one segment, and an extended character spends two of those.
  const fits = "a".repeat(134) + "€";
  const over = "a".repeat(135) + "€";
  for (const [typed, expected] of [[fits, 1], [over, 2]] as const) {
    assertEquals(wireBody(typed), composeSmsBody(typed, true));
    assertEquals(clientSegments(wireBody(typed)), expected);
    assertEquals(serverSegments(composeSmsBody(typed, true)), expected);
    assertEquals(estimateSmsCost(typed, 10).segmentsPerRecipient, expected);
    assertEquals(estimateSmsCost(typed, 10).totalSegments, expected * 10);
  }
  // Unicode in the body carries the footer into UCS-2 with it.
  assertEquals(estimateSmsCost("ж".repeat(46), 1).segmentsPerRecipient, 1);
  assertEquals(estimateSmsCost("ж".repeat(47), 1).segmentsPerRecipient, 2);
});
