// #4490 spec 08 O5 part B — the day-close PDF (Print on "Day closed"):
// venue-floor-pdf kind day_close reads the day from issue_4490_day_close_pdf
// (money rights, the PIN session on a Till device, the device recorded),
// renders it with buildDayClosePdf (currency as a code, the difference in
// words, names never emails) and delivers it on the same private bucket with a
// 60-second signed URL.
//
// FAILS-ON-REVERT: refuse day_close again and C1 fails; read the summary as
// the device instead of the PIN member and C3 fails; print a symbol and C4
// fails.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
} from "https://esm.sh/pdf-lib@1.17.1";
import {
  createVenueFloorPdfHandler,
  dayCloseInput,
  dayLabelFrom,
  dayPersonName,
  FLOOR_PDF_BUCKET,
  FLOOR_PDF_TTL_SECONDS,
} from "./index.ts";
import {
  buildDayClosePdf,
  dayCloseDifferenceWords,
  FLOOR_PAPER_WIDTH_PT,
} from "../_shared/ticketPdf.ts";

const VENUE = "44900613-0000-4000-9000-0000000000a1";
const BRAND = "44900613-0000-4000-9000-000000000010";
const USER = "44900613-0000-4000-8000-000000000003";
const DEVICE = "44900613-0000-4000-8000-000000000007";
const MANAGER = "44900613-0000-4000-8000-000000000009";
const TOKEN = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) =>
  b.toString(16).padStart(2, "0")
).join("");

type Call = { name: string; params: Record<string, unknown> };

const summary = (paper = "a4", state = "closed") => ({
  venueId: VENUE,
  venueName: "Café Palm & Pepper",
  brandId: BRAND,
  businessDate: "2026-11-21",
  timezone: "Africa/Lagos",
  currency: "NGN",
  paper,
  state,
  close: state === "closed"
    ? {
      closedAtLocal: "23:48",
      closedBy: { kind: "person", name: "Chioma", userId: USER },
      cashCountedMinor: 12160000,
      cashExpectedMinor: 12210000,
      differenceMinor: -50000,
    }
    : null,
  totals: {
    currency: "NGN",
    takings: {
      count: 18,
      amountMinor: 12900000,
      tipMinor: 215000,
      serviceChargeMinor: 954545,
      guestFeesMinor: 8250,
    },
    byMethod: [
      { method: "cash", count: 10, amountMinor: 7450000, tipMinor: 110000 },
      { method: "scan_transfer", count: 1, amountMinor: 1100000, tipMinor: 0 },
    ],
    people: [
      {
        kind: "person",
        name: "Ada",
        userId: "u1",
        salesCount: 15,
        salesMinor: 11250000,
        tipsTakenMinor: 155000,
        cashTakenMinor: 7000000,
        voidCount: 1,
        refundMinor: 0,
        refundCount: 0,
        email: "ada@example.test",
      },
      {
        kind: "mingla_support",
        // #4490 after #4579: the server sends the Mingla-marked public name.
        name: "Tola from Mingla",
        userId: "u8",
        salesCount: 1,
        salesMinor: 550000,
        tipsTakenMinor: 10000,
        cashTakenMinor: 560000,
        voidCount: 0,
        refundMinor: 0,
        refundCount: 0,
      },
      {
        kind: "person",
        name: null,
        userId: "u4",
        salesCount: 2,
        salesMinor: 1100000,
        tipsTakenMinor: 50000,
        cashTakenMinor: 0,
        voidCount: 0,
        refundMinor: 0,
        refundCount: 0,
      },
    ],
    tipsByServer: [{ kind: "person", name: "Ada", tipsServedMinor: 155000 }],
    serviceChargeMinor: 954545,
    refunds: { count: 3, amountMinor: 1700000 },
    voids: { count: 1, amountMinor: 500000 },
    depositsUsed: { count: 2, amountMinor: 1050000 },
    depositRefunded: { count: 1, amountMinor: 1450000 },
    orderedOnline: { count: 1, amountMinor: 330000 },
    door: { count: 1, amountMinor: 600000 },
    card: { minglaFeesMinor: 173250, toBankMinor: 3240000 },
    cash: {
      floatMinor: 5500000,
      cashPaymentsMinor: 7450000,
      cashTipsMinor: 110000,
      doorCashMinor: 600000,
      cashRefundsMinor: 1150000,
      paidOutMinor: 300000,
      expectedMinor: 12210000,
    },
  },
  late: {
    count: 1,
    payments: [{
      method: "scan_transfer",
      amountMinor: 550000,
      tipMinor: 0,
      paidAtLocal: "23:55",
      checkLabel: "Table 11",
    }],
  },
});

function world(
  options: {
    device?: boolean;
    summaryError?: { code: string; message: string };
  } = {},
) {
  const calls: Call[] = [];
  const uploads: Array<{ bucket: string; path: string; bytes: Uint8Array }> =
    [];
  const signs: Array<{ ttl: number }> = [];
  const client = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { id: options.device ? DEVICE : USER } },
          error: null,
        }),
    },
    rpc: (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      if (name === "issue_4490_pin_gate") {
        return Promise.resolve({ data: options.device === true, error: null });
      }
      if (name === "issue_4490_pin_session_resolve") {
        return Promise.resolve({
          data: { sessionId: "s1", memberId: "m1", memberUserId: USER },
          error: null,
        });
      }
      // [TEST-MOD-APPROVED #4490] 08-O5 fix 3: the day-close PDF on a Till
      // device asks for the export step-up; the approver is the manager.
      if (name === "issue_4490_pin_approve") {
        return Promise.resolve({
          data: { ok: true, approverUserId: MANAGER, approvalId: "a1" },
          error: null,
        });
      }
      if (name === "issue_4490_day_close_pdf") {
        return Promise.resolve(
          options.summaryError
            ? { data: null, error: options.summaryError }
            : { data: summary(), error: null },
        );
      }
      return Promise.resolve({
        data: name === "issue_4490_floor_pdf_record" ? "rec-1" : {},
        error: null,
      });
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, bytes: Uint8Array) => {
          uploads.push({ bucket, path, bytes });
          return Promise.resolve({ error: null });
        },
        createSignedUrl: (path: string, ttl: number) => {
          signs.push({ ttl });
          return Promise.resolve({
            data: { signedUrl: `https://storage.test/${path}?token=t` },
            error: null,
          });
        },
      }),
    },
  };
  const handle = createVenueFloorPdfHandler({
    env: (name) => (name === "SUPABASE_SERVICE_ROLE_KEY" ? "service-key" : "x"),
    client: () => client,
    uuid: () => "44900613-0000-4000-f000-000000000001",
    now: () => Date.parse("2026-11-21T22:50:00Z"),
  });
  return { handle, calls, uploads, signs };
}

function req(body: Record<string, unknown>): Request {
  return new Request("http://local/venue-floor-pdf", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer user-jwt",
    },
    body: JSON.stringify(body),
  });
}

async function pageText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = "";
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
    for (const stream of streams) {
      if (stream instanceof PDFRawStream) {
        out += new TextDecoder("latin1").decode(
          decodePDFRawStream(stream).decode(),
        );
      }
    }
  }
  return out;
}

Deno.test("C1 the day close prints: the summary as the person, the private bucket, a 60-second link", async () => {
  const w = world();
  const res = await w.handle(
    req({ kind: "day_close", venueId: VENUE, date: "2026-11-21" }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(String(body.signedUrl).startsWith("https://storage.test/"));
  assertEquals(body.filename, "day-close-sat-21-nov-2026.pdf");
  const s = w.calls.find((c) => c.name === "issue_4490_day_close_pdf")!;
  assertEquals(s.params, {
    p_venue_id: VENUE,
    p_date: "2026-11-21",
    p_actor: USER,
    p_device_user: null,
  });
  assert(!w.calls.some((c) => c.name === "issue_4490_floor_pdf_source"));
  assertEquals(
    w.calls.find((c) => c.name === "issue_4490_floor_pdf_record")!.params
      .p_kind,
    "day_close",
  );
  assertEquals(w.uploads[0].bucket, FLOOR_PDF_BUCKET);
  assertEquals(
    new TextDecoder().decode(w.uploads[0].bytes.slice(0, 4)),
    "%PDF",
  );
  assertEquals(w.signs[0].ttl, FLOOR_PDF_TTL_SECONDS);
  assertEquals(FLOOR_PDF_TTL_SECONDS, 60);
});

Deno.test("C2 the database's refusals keep their codes; nothing is rendered", async () => {
  for (
    const [error, status] of [
      [{ code: "42501", message: "not_authorized" }, 403],
      [{ code: "P0001", message: "till_not_enabled" }, 422],
      [{ code: "22023", message: "day_out_of_range" }, 400],
      [{ code: "28000", message: "pin_session_invalid" }, 401],
    ] as const
  ) {
    const w = world({ summaryError: error });
    const res = await w.handle(
      req({ kind: "day_close", venueId: VENUE, date: "2026-11-21" }),
    );
    assertEquals(res.status, status, error.message);
    assertEquals((await res.json()).code, error.message);
    assertEquals(w.uploads.length, 0);
  }
});

// [TEST-MOD-APPROVED #4490] 08-O5 fix 3: in a session the PDF also needs the
// export step-up (the same fresh PIN as the CSV); it then reads as the approver.
Deno.test("C3 on a Till device: no PIN session, no PDF; in a session it needs a fresh PIN, then reads as the approver with the device", async () => {
  let w = world({ device: true });
  let res = await w.handle(
    req({ kind: "day_close", venueId: VENUE, date: "2026-11-21" }),
  );
  assertEquals(res.status, 401);
  assertEquals((await res.json()).code, "pin_session_required");
  assert(!w.calls.some((c) => c.name === "issue_4490_day_close_pdf"));
  w = world({ device: true });
  res = await w.handle(
    req({
      kind: "day_close",
      venueId: VENUE,
      date: "2026-11-21",
      staffSession: TOKEN,
    }),
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).code, "pin_step_up_required");
  assert(!w.calls.some((c) => c.name === "issue_4490_day_close_pdf"));
  w = world({ device: true });
  res = await w.handle(
    req({
      kind: "day_close",
      venueId: VENUE,
      date: "2026-11-21",
      staffSession: TOKEN,
      stepUp: { pin: "4826" },
    }),
  );
  assertEquals(res.status, 200);
  const approve = w.calls.find((c) => c.name === "issue_4490_pin_approve")!;
  assertEquals(approve.params.p_purpose, "export");
  assertEquals(approve.params.p_target, `${VENUE}:2026-11-21`);
  const s = w.calls.find((c) => c.name === "issue_4490_day_close_pdf")!;
  assertEquals(s.params.p_actor, MANAGER);
  assertEquals(s.params.p_device_user, DEVICE);
});

Deno.test("C4 the PDF writes money with the currency code, the difference in words, names (never emails)", async () => {
  const pdf = await buildDayClosePdf({
    ...dayCloseInput(summary()),
    printedAtLocal: "21/11/2026 23:50",
  });
  const bytes = Uint8Array.from(
    atob(pdf.contentBase64),
    (c) => c.charCodeAt(0),
  );
  const raw = await pageText(bytes);
  // Every drawn string (pdf-lib writes them as <HEX>), decoded and joined.
  const text = [...raw.matchAll(/<([0-9A-F]+)>/g)]
    .map((m) =>
      new TextDecoder("latin1").decode(
        Uint8Array.from(m[1].match(/../g)!.map((h) => parseInt(h, 16))),
      )
    )
    .join("\n");
  for (
    const want of [
      "NGN 129,000.00",
      "NGN 500.00 short",
      "Closed 23:48 by Chioma",
      "Tola from Mingla",
      "Team member",
      "Scan to pay - bank transfer",
      "Late payments since close",
      "Deposits used",
      "Deposit refunded",
      "Card money to your bank",
      "NGN 32,400.00",
      "Expected in the drawer",
      "NGN 122,100.00",
    ]
  ) {
    assert(text.includes(want), `missing ${want}`);
  }
  assert(!text.includes("ada@example.test"));
  assert(!text.includes("\u20a6"));
  // "Café" loses its accent (WinAnsi sanitiser), never breaks the PDF.
  assert(/Caf\s+Palm & Pepper/.test(text));
});

Deno.test("C5 paper: A4 pages, or a roll fitted to the content", async () => {
  for (const paper of ["a4", "roll_80", "roll_58"] as const) {
    const pdf = await buildDayClosePdf(dayCloseInput(summary(paper)));
    const doc = await PDFDocument.load(
      Uint8Array.from(atob(pdf.contentBase64), (c) => c.charCodeAt(0)),
    );
    const { width, height } = doc.getPage(0).getSize();
    assertEquals(Math.round(width * 100) / 100, FLOOR_PAPER_WIDTH_PT[paper]);
    if (paper === "a4") assertEquals(Math.round(height), 842);
    else assert(height > 200 && height < 2000, `${paper} height ${height}`);
  }
});

Deno.test("C6 helpers: day label, people, difference words; a day not closed yet has no count", () => {
  assertEquals(dayLabelFrom("2026-11-21"), "Sat 21 Nov 2026");
  assertEquals(dayPersonName({ kind: "device" }), "Till device");
  assertEquals(dayPersonName({ kind: "system" }), "Cleared by the Till");
  assertEquals(dayPersonName({ kind: "person", name: null }), "Team member");
  assertEquals(dayCloseDifferenceWords(-50000, "NGN"), "NGN 500.00 short");
  assertEquals(dayCloseDifferenceWords(120000, "NGN"), "NGN 1,200.00 over");
  assertEquals(dayCloseDifferenceWords(0, "GBP"), "Balanced");
  const open = dayCloseInput(summary("a4", "open"));
  assertEquals(open.countedMinor, null);
  assertEquals(open.statusLine, "Not closed yet");
});
