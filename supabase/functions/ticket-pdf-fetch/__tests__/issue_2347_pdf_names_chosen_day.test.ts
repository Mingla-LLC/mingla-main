// issue #2347 — THE DOWNLOADED TICKET PDF MUST NAME THE DAY THE GUEST BOUGHT,
// AND A PDF THAT NAMES THE WRONG ONE MUST NOT BE CACHED FOREVER.
//
// ── THE DEFECT, AND WHY IT IS THE STICKY HALF ──────────────────────────────
// `ticket-pdf-fetch` — the wallet's "Download ticket" endpoint — resolved the
// event date with `.eq("is_master", true)`, the EARLIEST occurrence. It
// received none of #2162's chosen-occurrence fix, so every guest who bought
// day 2 of a multi-day event downloaded a PDF dated day 1. It then wrote that
// object's path back to `orders.ticket_pdf_path`, which made the wrong-day PDF
// the PERMANENT artifact: it never regenerates on its own, and every later
// download serves the same wrong day.
//
// ── WHAT THIS SUITE PROVES ─────────────────────────────────────────────────
// It calls the REAL, SHIPPED `resolveChosenOccurrence` — the one #2162 wrote,
// moved to `_shared/` by this issue so both functions import it rather than
// keeping two copies of one contract. `_shared/chosenOccurrence.ts` has no
// `serve()` and no supabase-js import precisely so this is possible; the #2162
// suite could only test a hand-copied MIRROR of the same logic, which is one
// silent drift away from proving nothing.
//
// Every date check asserts BOTH halves — the chosen day IS named AND the master
// is NOT — because a test asserting only "a date is present" is GREEN on the
// defect.

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  collapseDaysToRange,
  resolveChosenOccurrence,
  ticketDaysForOrder,
} from "../../_shared/chosenOccurrence.ts";
import {
  isDayAwareTicketPdfPath,
  shouldRerenderCachedTicketPdf,
  TICKET_PDF_RENDER_VERSION,
  ticketPdfStoragePath,
} from "../../_shared/ticketPdfPath.ts";

const MASTER_START = "2026-08-22T10:00:00.000Z";
const MASTER_END = "2026-08-22T18:00:00.000Z";
const DAY_2_START = "2026-08-23T10:00:00.000Z";
const DAY_2_END = "2026-08-23T18:00:00.000Z";
const DAY_3_START = "2026-08-24T10:00:00.000Z";
const DAY_3_END = "2026-08-24T18:00:00.000Z";
const TZ = "Africa/Lagos";

/**
 * A stand-in for the PostgREST builder, shaped exactly like the two call
 * chains the resolver makes and nothing more. It records the tables it was
 * asked for, so a test cannot be satisfied by a read the real client would
 * never perform.
 */
function fakeSupabase(fixtures: {
  tickets?: unknown[] | null;
  ticketsError?: { message: string } | null;
  eventDate?: Record<string, unknown> | null;
  eventDateError?: { message: string } | null;
}) {
  const asked: string[] = [];
  const client = {
    from(table: string) {
      asked.push(table);
      return {
        select(_columns: string) {
          // deno-lint-ignore no-explicit-any
          const builder: any = {
            eq: () => builder,
            maybeSingle: () =>
              Promise.resolve({
                data: fixtures.eventDate ?? null,
                error: fixtures.eventDateError ?? null,
              }),
            then: (
              // deno-lint-ignore no-explicit-any
              onOk: (v: any) => unknown,
              // deno-lint-ignore no-explicit-any
              onErr?: (e: any) => unknown,
            ) =>
              Promise.resolve({
                data: table === "tickets" ? fixtures.tickets ?? null : null,
                error: table === "tickets"
                  ? fixtures.ticketsError ?? null
                  : null,
              }).then(onOk, onErr),
          };
          return builder;
        },
      };
    },
  };
  return { client, asked };
}

const dayRow = (start: string, end: string) => ({
  ticket_event_dates: [{ event_dates: { start_at: start, end_at: end, timezone: TZ } }],
});

// ══ THE DATE THE PDF NAMES ═════════════════════════════════════════════════

Deno.test("P-1 a day-2 order resolves DAY 2, and NOT the master day", async () => {
  const { client, asked } = fakeSupabase({
    tickets: [dayRow(DAY_2_START, DAY_2_END)],
  });
  const chosen = await resolveChosenOccurrence(client, "ord-1", "evt-1", null);
  assertEquals(chosen?.start_at, DAY_2_START);
  // The half that catches the defect. The shipped code rendered MASTER_START.
  assertNotEquals(
    chosen?.start_at,
    MASTER_START,
    "the PDF named the master day — that is issue #2347",
  );
  assert(asked.includes("tickets"), "the pass's own day ledger must be read");
});

Deno.test("P-2 a two-day order collapses to a real RANGE: earliest start, latest end", async () => {
  const { client } = fakeSupabase({
    tickets: [dayRow(DAY_3_START, DAY_3_END), dayRow(DAY_2_START, DAY_2_END)],
  });
  const chosen = await resolveChosenOccurrence(client, "ord-2", "evt-1", null);
  assertEquals(chosen?.start_at, DAY_2_START, "earliest chosen start");
  assertEquals(chosen?.end_at, DAY_3_END, "latest chosen end");
  assertEquals(chosen?.timezone, TZ);
});

Deno.test("P-3 with no day-bound pass, the order's own event_date_id is named", async () => {
  const { client, asked } = fakeSupabase({
    tickets: [],
    eventDate: { start_at: DAY_2_START, end_at: DAY_2_END, timezone: TZ },
  });
  const chosen = await resolveChosenOccurrence(
    client,
    "ord-3",
    "evt-1",
    "occ-day-2",
  );
  assertEquals(chosen?.start_at, DAY_2_START);
  assert(asked.includes("event_dates"));
});

Deno.test("P-4 LEGACY: no ticket days and no order day => null, so the caller uses master", async () => {
  // This is the single-date / pre-day-selection case. NULL is legitimate, not
  // an error, and `ticket-pdf-fetch` renders `chosenDate ?? masterDate`, so a
  // single-date order's PDF is byte-identical to the pre-#2347 one.
  const { client } = fakeSupabase({ tickets: [] });
  assertEquals(
    await resolveChosenOccurrence(client, "ord-4", "evt-1", null),
    null,
  );
});

Deno.test("P-5 a ticket-ledger read failure falls back rather than failing the download", async () => {
  const { client } = fakeSupabase({
    tickets: null,
    ticketsError: { message: "boom" },
    eventDate: { start_at: DAY_2_START, end_at: DAY_2_END, timezone: TZ },
  });
  const chosen = await resolveChosenOccurrence(
    client,
    "ord-5",
    "evt-1",
    "occ-day-2",
  );
  assertEquals(chosen?.start_at, DAY_2_START);
});

Deno.test("P-6 ticketDaysForOrder distinguishes 'no days' from 'could not read'", async () => {
  // `ticket-pdf-fetch` uses this to decide whether a cached PDF is suspect. A
  // read failure returning `[]` would silently classify every order as
  // single-date and repair nothing.
  const ok = fakeSupabase({ tickets: [dayRow(DAY_2_START, DAY_2_END)] });
  assertEquals((await ticketDaysForOrder(ok.client, "o", "[t]"))?.length, 1);

  const none = fakeSupabase({ tickets: [] });
  assertEquals((await ticketDaysForOrder(none.client, "o", "[t]"))?.length, 0);

  const failed = fakeSupabase({
    tickets: null,
    ticketsError: { message: "boom" },
  });
  assertEquals(await ticketDaysForOrder(failed.client, "o", "[t]"), null);
});

Deno.test("P-7 collapseDaysToRange is order-insensitive and null on empty", () => {
  assertEquals(collapseDaysToRange([]), null);
  const collapsed = collapseDaysToRange([
    { start_at: DAY_3_START, end_at: DAY_3_END, timezone: TZ },
    { start_at: MASTER_START, end_at: MASTER_END, timezone: TZ },
  ]);
  assertEquals(collapsed?.start_at, MASTER_START);
  assertEquals(collapsed?.end_at, DAY_3_END);
});

// ══ THE CACHED ARTIFACT ════════════════════════════════════════════════════

Deno.test("P-8 CACHE REPAIR: a pre-#2347 path on a DAY-SCOPED order is re-rendered", () => {
  const legacy = "tickets/11111111-1111-1111-1111-111111111111.pdf";
  assertEquals(
    shouldRerenderCachedTicketPdf({ cachedPath: legacy, isDayScoped: true }),
    true,
    "a wrong-day PDF will not regenerate on its own — this is what repairs it",
  );
  assertEquals(isDayAwareTicketPdfPath(legacy), false);
});

Deno.test("P-9 SINGLE-DAY IS UNTOUCHED: a pre-#2347 path on a NOT day-scoped order never re-renders", () => {
  // The guarantee, enforced rather than asserted: an order with zero
  // `ticket_event_dates` rows had exactly one day to render and rendered it.
  // Its object and its `orders.ticket_pdf_path` pointer are never rewritten.
  const legacy = "tickets/22222222-2222-2222-2222-222222222222.pdf";
  assertEquals(
    shouldRerenderCachedTicketPdf({ cachedPath: legacy, isDayScoped: false }),
    false,
  );
});

Deno.test("P-10 an already day-aware PDF is never re-rendered, and an absent one is left to the ordinary backfill", () => {
  const fresh = ticketPdfStoragePath("33333333-3333-3333-3333-333333333333");
  assert(fresh.includes(TICKET_PDF_RENDER_VERSION));
  assertEquals(isDayAwareTicketPdfPath(fresh), true);
  assertEquals(
    shouldRerenderCachedTicketPdf({ cachedPath: fresh, isDayScoped: true }),
    false,
    "re-rendering a day-aware PDF on every download would be a render loop",
  );
  for (const empty of [null, ""]) {
    assertEquals(
      shouldRerenderCachedTicketPdf({ cachedPath: empty, isDayScoped: true }),
      false,
      "nothing cached is the ordinary lazy-backfill case, unchanged",
    );
  }
});

Deno.test("P-11 the versioned path is distinguishable from the legacy one for the SAME order", () => {
  const id = "44444444-4444-4444-4444-444444444444";
  assertNotEquals(ticketPdfStoragePath(id), `tickets/${id}.pdf`);
  assert(ticketPdfStoragePath(id).startsWith(`tickets/${id}.`));
  assert(ticketPdfStoragePath(id).endsWith(".pdf"));
});

// ══ SOURCE PINS — wiring only; the behaviour is proved above ═══════════════

const FETCH_SRC = Deno.readTextFileSync(
  new URL("../index.ts", import.meta.url),
);
const DISPATCH_SRC = Deno.readTextFileSync(
  new URL("../../ticket-confirmation-dispatch/index.ts", import.meta.url),
);
const RESOLVER_SRC = Deno.readTextFileSync(
  new URL("../../_shared/chosenOccurrence.ts", import.meta.url),
);

Deno.test("P-12 SOURCE PIN — ticket-pdf-fetch resolves the chosen day and the CHOSEN one wins", () => {
  assert(
    /resolveChosenOccurrence\(/.test(FETCH_SRC),
    "the download endpoint must resolve the guest's chosen occurrence",
  );
  assert(
    /chosenDate \?\? masterDate/.test(FETCH_SRC),
    "`masterDate ?? chosenDate` would compile, render a date, and re-ship the " +
      "defect verbatim",
  );
  assert(
    /ticketPdfStoragePath\(/.test(FETCH_SRC),
    "the render must write the versioned path or the cache can never be repaired",
  );
  assert(
    /shouldRerenderCachedTicketPdf\(/.test(FETCH_SRC),
    "a cached wrong-day PDF must be invalidated, not served forever",
  );
  assert(
    !/tickets\/\$\{orderId\}\.pdf/.test(FETCH_SRC),
    "the unversioned literal path must be gone from the renderer",
  );
});

Deno.test("P-13 SOURCE PIN — there is exactly ONE chosen-day resolver, and both functions import it", () => {
  // The issue is explicit: reuse the existing resolver, do not write a third.
  assert(
    /from "\.\.\/_shared\/chosenOccurrence\.ts"/.test(FETCH_SRC),
    "ticket-pdf-fetch must import the shared resolver",
  );
  assert(
    /from "\.\.\/_shared\/chosenOccurrence\.ts"/.test(DISPATCH_SRC),
    "ticket-confirmation-dispatch must import the same shared resolver",
  );
  for (const [name, src] of [["pdf-fetch", FETCH_SRC], ["dispatch", DISPATCH_SRC]] as const) {
    assert(
      !/function resolveChosenOccurrence\s*\(/.test(src),
      `${name} must not declare its own copy of the resolver`,
    );
  }
  // And the ONE implementation really reads the day ledger. #2162's C-6 pins
  // `ticket_event_dates` against the dispatch handler, where the string now
  // survives only in a comment — so the load-bearing pin lives here.
  assert(
    /\.select\("ticket_event_dates \( event_dates \( start_at, end_at, timezone \) \)"\)/
      .test(RESOLVER_SRC),
    "the resolver must consult the days the order's passes actually admit",
  );
  assert(
    !/http\/server\.ts"/.test(RESOLVER_SRC) &&
      !/^\s*serve\(/m.test(RESOLVER_SRC),
    "the shared resolver must stay importable — an HTTP server started at " +
      "module scope would make it unusable by a sibling function and " +
      "untestable here",
  );
});

Deno.test("P-14 SOURCE PIN — both PDF writers agree on where the object lives", () => {
  assert(
    /ticketPdfStoragePath\(order\.id\)/.test(DISPATCH_SRC),
    "the dispatch writer must use the shared path authority, or a fresh " +
      "day-correct PDF would look stale to ticket-pdf-fetch and re-render on " +
      "every single download",
  );
});
