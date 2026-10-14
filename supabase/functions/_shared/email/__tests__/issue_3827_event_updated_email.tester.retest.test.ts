// Issue #3827 — tester RETEST for the live-edit buyer email, after the first
// tester round failed. Each test attacks one rework claim through the REAL
// modules (`eventUpdatedEmail.ts` and `rsvp-notify/eventUpdate.ts`), reading
// every byte that would leave Mingla. Nothing is sent; no network is used.
//
//   RW-*  (M1) the address hidden NOW is never printed, whatever the stored
//         notice still holds: the worker re-reads the event's switch, in every
//         spelling PostgREST can hand back, and the rendered HTML, plain text,
//         subject and short line carry no street
//   RK-*  (F4) the send check before every provider call: only a known answer
//         passes through; an error, a throw or an unknown answer is
//         "unavailable" (the copy is retried, never sent)
//   RG-*  one failing copy never stops the groups after it
//   RL-*  the link filter: hostile links of every shape are removed (IDN,
//         punycode, IPv6 in brackets, data:, vbscript:, a reason that is only a
//         link) and ordinary prose with a space after its full stops survives
//   RT-*  truncation: cut between whole characters, never inside a surrogate
//         pair, an emoji sequence or a combining mark
//
// fails-on-revert: with rsvp-notify/eventUpdate.ts and eventUpdatedEmail.ts at
// 93265d8e7 (the first round's head) the module has no checkNoticeSend,
// withholdIfHiddenNow or isAddressWithheldNow and the loader ignores the
// switch (RW-01, RW-02, RK-01, RK-02 fail), inGroupsOf uses Promise.all
// (RG-01 fails), the bare-host and IP filters are missing (RL-01 fails) and
// `.slice` cuts a surrogate pair (RT-01 fails): 7 of 9 red. RW-03 and RL-02
// pass on both sides: they guard against over-scrubbing ordinary text.
//
// Known, deliberate behaviour (reported, not pinned): a full stop or colon
// with NO space after it reads as a host or a scheme ("Mr.Smith",
// "Venue:Lantern Room" become "[link removed]"), and a full-width dot
// ("evil。com") is not treated as a dot.
//
// Run: deno test --allow-env --allow-net --allow-read --no-check <this file>

import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.env.set("DENO_TESTING", "1");

const email = await import("../eventUpdatedEmail.ts");
const worker = await import("../../../rsvp-notify/eventUpdate.ts") as Record<string, unknown> & {
  createNoticeLoader: (admin: unknown) => (id: string) => Promise<
    { state: string; context?: Record<string, unknown> }
  >;
  buildEventUpdateDispatch: (
    context: unknown,
    payload: Record<string, unknown>,
  ) => { title: string; body: string; sms: string; emailOverride: { rendered: Record<string, string> } };
  inGroupsOf: <T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>) => Promise<void>;
};

const STREETS = /Wythe|Bedford|Lorimer|Havemeyer/i;
const NOTICE_ID = "6f1d2c1e-3827-4a00-9000-000000003827";
const EVENT_ID = "6f1d2c1e-3827-4a00-9000-0000000e3827";

/** A stand-in for the slice of the Supabase client the worker uses. */
function fakeAdmin(opts: {
  withheld: unknown;
  changes: unknown[];
  afterSnapshot?: Record<string, unknown>;
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rows: Record<string, unknown> = {
    event_edit_notices: {
      id: NOTICE_ID,
      event_id: EVENT_ID,
      state: "fanned_out",
      reason: "The first room has a power fault on the night",
      notice_changes: opts.changes,
      after_snapshot: opts.afterSnapshot ?? { venue: "Lantern Room", venue_from_label: false },
    },
    events: {
      id: EVENT_ID,
      title: "Sunset Sessions",
      slug: "sunset-sessions",
      timezone: "Africa/Lagos",
      event_type: "event",
      status: "scheduled",
      deleted_at: null,
      address_withheld: opts.withheld,
      brands: { name: "Casa Lenta Retreats", slug: "casa-lenta", contact_email: "hello@casalenta.example", deleted_at: null },
    },
  };
  const selects: string[] = [];
  return {
    calls,
    selects,
    admin: {
      rpc(name: string, args: Record<string, unknown> = {}) {
        calls.push({ name, args });
        return opts.rpc ? opts.rpc(name, args) : Promise.resolve({ data: "ok", error: null });
      },
      from(table: string) {
        return {
          select(columns: string) {
            selects.push(`${table}:${columns}`);
            return {
              eq(_column: string, _value: string) {
                return { maybeSingle: () => Promise.resolve({ data: rows[table] ?? null, error: null }) };
              },
            };
          },
        };
      },
    },
  };
}

const STREET_CHANGE = [
  { field: "address", old: "61 Wythe Avenue, Brooklyn", new: "250 Bedford Avenue, Brooklyn" },
];

async function renderAll(admin: unknown): Promise<string> {
  const loaded = await worker.createNoticeLoader(admin)(NOTICE_ID);
  assertEquals(loaded.state, "ready", "the notice should load");
  const out = worker.buildEventUpdateDispatch(loaded.context, { recipientName: "Ada" });
  const r = out.emailOverride.rendered;
  return [out.title, out.body, out.sms, r.subject, r.html, r.text].join("\n");
}

// ─── RW-01: hidden now, stored with streets: nothing printed ────────────────
Deno.test("RW-01 an address hidden now is never printed, whatever the stored notice holds", async () => {
  // Every spelling PostgREST can hand back for a `->>` read of a true switch.
  for (const withheld of ["true", " TRUE ", "True", true]) {
    const fake = fakeAdmin({ withheld, changes: STREET_CHANGE });
    const all = await renderAll(fake.admin);
    assertFalse(STREETS.test(all), `withheld=${JSON.stringify(withheld)}: a street was printed`);
    assertStringIncludes(all, "The address has changed.");
    // The worker read the switch from the event, as it is now.
    assert(fake.selects.some((s) => s.startsWith("events:") && s.includes("hideAddressUntilTicket")),
      "the event read does not include the hide switch");
  }
});

// ─── RW-02: a label-only venue hidden now loses the venue values too ────────
Deno.test("RW-02 a venue known only through its label is withheld when the address is hidden now", async () => {
  const fake = fakeAdmin({
    withheld: "true",
    changes: [{ field: "venue", old: "Speakeasy · 9 Lorimer Street", new: "Speakeasy · 14 Havemeyer Street" }],
    afterSnapshot: { venue: "Speakeasy · 14 Havemeyer Street", venue_from_label: true },
  });
  const all = await renderAll(fake.admin);
  assertFalse(STREETS.test(all), "a label holding a street was printed");
  assertStringIncludes(all, "The location has changed.");
});

// ─── RW-03: not hidden: the stored change is printed (no over-scrubbing) ────
Deno.test("RW-03 an address that is not hidden is printed as recorded; null, 'false' and junk mean not hidden", async () => {
  for (const withheld of [null, "false", "", "yes", 1, false]) {
    const all = await renderAll(fakeAdmin({ withheld, changes: STREET_CHANGE }).admin);
    assertStringIncludes(all, "250 Bedford Avenue, Brooklyn", `withheld=${JSON.stringify(withheld)}`);
  }
});

// ─── RK-01: the send check passes only known answers through ────────────────
Deno.test("RK-01 the send check passes known answers through and sends the address it is asked about", async () => {
  const check = worker.checkNoticeSend as (a: unknown, id: string, e: string | null) => Promise<string>;
  for (const answer of ["ok", "held_feature_off", "held_allowlist", "notice_missing"]) {
    const fake = fakeAdmin({ withheld: null, changes: [], rpc: () => Promise.resolve({ data: answer, error: null }) });
    assertEquals(await check(fake.admin, NOTICE_ID, "ada@example.test"), answer);
    assertEquals(fake.calls[0].name, "event_edit_notice_send_check");
    assertEquals(fake.calls[0].args, { p_notice_id: NOTICE_ID, p_email: "ada@example.test" });
  }
});

// ─── RK-02: an unreadable check is "unavailable", never "ok" ─────────────────
Deno.test("RK-02 an error, a throw, a rejected promise or an unknown answer is unavailable (retry, never send)", async () => {
  const check = worker.checkNoticeSend as (a: unknown, id: string, e: string | null) => Promise<string>;
  const rpcs: Array<() => Promise<{ data: unknown; error: unknown }>> = [
    () => Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }),
    () => Promise.resolve({ data: "ok", error: { code: "57014", message: "statement timeout" } }),
    () => Promise.reject(new Error("socket hang up")),
    () => { throw new Error("thrown synchronously"); },
    () => Promise.resolve({ data: null, error: null }),
    () => Promise.resolve({ data: "OK", error: null }),
    () => Promise.resolve({ data: " ok", error: null }),
    () => Promise.resolve({ data: ["ok"], error: null }),
    () => Promise.resolve({ data: { result: "ok" }, error: null }),
    () => Promise.resolve({ data: true, error: null }),
    () => Promise.resolve({ data: "held_something_new", error: null }),
  ];
  for (const [index, rpc] of rpcs.entries()) {
    const fake = fakeAdmin({ withheld: null, changes: [], rpc: rpc as never });
    assertEquals(await check(fake.admin, NOTICE_ID, null), "unavailable", `answer #${index} was not treated as unavailable`);
  }
});

// ─── RG-01: one failing copy never stops the groups after it ─────────────────
Deno.test("RG-01 a copy that throws or rejects never stops later groups", async () => {
  const seen: number[] = [];
  const quiet = console.error;
  console.error = () => {};
  try {
    await worker.inGroupsOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 5, async (n: number) => {
      if (n === 2) throw new Error("provider exploded");
      if (n === 7) return await Promise.reject(new Error("rejected"));
      seen.push(n);
    });
  } finally {
    console.error = quiet;
  }
  assertEquals(seen.sort((a, b) => a - b), [1, 3, 4, 5, 6, 8, 9, 10, 11]);
});

// ─── RL-01: hostile links of every shape are removed ─────────────────────────
Deno.test("RL-01 IDN, punycode, IPv4, bracketed IPv6, data:, vbscript: and a reason that is only a link are removed", () => {
  const hostile: Array<[string, RegExp]> = [
    ["See пример.рф for the new room", /пример\.рф/],
    ["Pay at bücher-tickets.de now", /bücher/],
    ["Go to xn--e1afmkfd.xn--p1ai please", /xn--/],
    ["Go to evil.xn--p1ai please", /xn--/],
    ["Join http://[2001:db8::1]/pay now", /2001|db8/],
    ["Refunds at 203.0.113.9:8080/pay", /203\.0\.113/],
    ["See data:text/html;base64,PHA+ now", /data:/i],
    ["Run vbscript:msgbox(1) please", /vbscript/i],
    ["Pay at intent://pay#Intent;end now", /intent:/i],
    ["Chat on whatsapp:+2348030000000", /whatsapp:/i],
    ["Pay at evil.co.uk/pay?x=1 today", /evil/],
    ["Tickets at tix.example:8443 now", /tix\.example/],
  ];
  for (const [reason, leak] of hostile) {
    const cleaned = email.sanitiseEditReason(reason) ?? "";
    assertFalse(leak.test(cleaned), `${JSON.stringify(reason)} kept a link: ${JSON.stringify(cleaned)}`);
    assertStringIncludes(cleaned, email.LINK_REMOVED);
  }
  for (const only of ["https://evil.example/pay", "evil.com", "www.evil.example", "javascript:alert(1)"]) {
    assertEquals(email.sanitiseEditReason(only), email.LINK_REMOVED, `${only} alone`);
  }
});

// ─── RL-02: ordinary prose survives ──────────────────────────────────────────
Deno.test("RL-02 prose with a space after its full stops and colons survives untouched", () => {
  const prose = [
    "We moved to Lagos. We open at 8.",
    "Bring ID, e.g. a passport, i.e. anything with a photo.",
    "The new venue is 3.5km from the old one.",
    "Doors at 7:30pm now; the ratio is still 2:1.",
    "Note: the room changed.",
    "U.S.A. guests welcome. Ph.D night still on.",
    "The 10.30 start moved to 11.15 a.m.",
    "Call 0803.555.1234 for the gate.",
    "Version 2.0 of the night, same tickets.",
  ];
  for (const reason of prose) {
    assertEquals(email.sanitiseEditReason(reason), reason, `ordinary prose was changed: ${reason}`);
  }
});

// ─── RT-01: truncation between whole characters ─────────────────────────────
Deno.test("RT-01 a long reason is cut between whole characters, never inside a pair or a sequence", () => {
  // The cleaner removes zero-width joiners before cutting, so a sequence here
  // is one a joiner does not hold together: a thumb with a skin tone.
  const toned = String.fromCodePoint(0x1f44d, 0x1f3fd);
  const flag = String.fromCodePoint(0x1f1f3, 0x1f1ec); // Nigeria
  const accented = String.fromCodePoint(0x65, 0x301); // e + combining acute
  for (const unit of ["\u{1F600}", toned, flag, accented, "\u{1D11E}"]) {
    for (let pad = 0; pad < 8; pad++) {
      const reason = "x".repeat(190 + pad) + unit.repeat(10);
      const cleaned = email.sanitiseEditReason(reason) ?? "";
      assert(cleaned.length <= 200, `longer than 200 units (${cleaned.length})`);
      assertFalse(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cleaned),
        `a lone surrogate after cutting ${JSON.stringify(unit)} at pad ${pad}`);
      const tail = cleaned.replace(/^x+/, "");
      assertEquals(tail, unit.repeat(Math.floor(tail.length / unit.length)),
        `a sequence was cut in half (${JSON.stringify(unit)}, pad ${pad})`);
    }
  }
  // The rendered email carries the same whole characters.
  const rendered = email.renderEventUpdatedEmail({
    kind: "event",
    eventName: "Sunset Sessions",
    brandName: "Casa Lenta Retreats",
    recipientName: "Ada",
    timezone: "Africa/Lagos",
    changes: [{ field: "venue", old: "Room One", new: "Room Two" }],
    reason: "y".repeat(199) + "\u{1F600}",
    eventUrl: "https://host.usemingla.com/e/casa-lenta/sunset-sessions",
    venueName: "Room Two",
    supportEmail: "support@usemingla.com",
  });
  assertFalse(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(rendered.text), "the text carries a lone high surrogate");
});

