// #4490 spec 08 O3 part A — venue-floor-pdf (kitchen and bar tickets, Till
// receipts, test tickets) and the shared PDF delivery rail.
//
// Run: deno test --allow-env --allow-net --allow-read --no-check \
//   supabase/functions/venue-floor-pdf/index.issue4490.ops.implementor.test.ts
//
// FAILS-ON-REVERT: drop the Bearer check and S1 fails; drop the ledger write
// and S7 fails; count prints on a receipt or twice and S5 fails; print a
// symbol instead of the currency code and P3 fails.
import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDocument,
  PDFRawStream,
} from "https://esm.sh/pdf-lib@1.17.1";
import { createVenueFloorPdfHandler, FLOOR_PDF_BUCKET } from "./index.ts";
import {
  buildKitchenTicketPdf,
  buildTillReceiptPdf,
  FLOOR_PAPER_WIDTH_PT,
  formatMoneyCode,
} from "../_shared/ticketPdf.ts";
import { deliverPdf } from "../_shared/pdfDelivery.ts";

const VENUE = "44900900-0000-4000-9000-0000000000a1";
const BRAND = "44900900-0000-4000-9000-000000000010";
const ORDER = "44900900-0000-4000-e000-000000000001";
const PAYMENT = "44900900-0000-4000-e000-000000000002";
const USER = "44900900-0000-4000-8000-000000000002";

const kitchenSource = (paper = "a4") => ({
  kind: "kitchen_ticket",
  venueId: VENUE,
  brandId: BRAND,
  venueName: "Palm & Pepper",
  timezone: "Africa/Lagos",
  paper,
  printedAtLocal: "21/11/2026 20:42",
  station: "kitchen",
  sentAtLocal: "20:41",
  ticket: {
    orderId: ORDER,
    station: "kitchen",
    ticketNo: "0142",
    destination: "Table 6",
    movedFrom: null,
    guestOrder: false,
    sellerName: "Ada",
    printedCount: 0,
    lines: [
      { name: "Grilled croaker", quantity: 1, modifiers: [], notes: null, voided: false },
      { name: "Smoky jollof rice", quantity: 2, modifiers: ["Chicken", "Mild"], notes: "no pepper on one", voided: false },
      { name: "Plantain", quantity: 1, modifiers: [], notes: null, voided: true },
    ],
  },
});

const receiptSource = (currency = "NGN", paper = "roll_80") => ({
  kind: "receipt",
  venueId: VENUE,
  brandId: BRAND,
  venueName: "Palm & Pepper",
  paper,
  printedAtLocal: "21/11/2026 21:15",
  paidAtLocal: "21/11/2026 21:14",
  receipt: {
    venueName: "Café Ñandú ₦ Lekki",
    venueAddress: "14 Admiralty Way, Lekki",
    checkLabel: "Table 6",
    receiptNo: 12,
    currency,
    lines: [
      { label: "Grilled croaker", quantity: 1, amountMinor: 1850000, modifiers: [] },
      { label: "Smoky jollof rice", quantity: 2, amountMinor: 1300000, modifiers: ["Chicken"] },
    ],
    subtotalMinor: 3150000,
    serviceChargeMinor: 315000,
    taxIncludedMinor: 0,
    totalMinor: 3465000,
    paidBeforeMinor: 0,
    refundedMinor: 0,
    footer: "Thank you for dining with us.",
    payment: {
      method: "cash",
      amountMinor: 3465000,
      tipMinor: 0,
      cashGivenMinor: 3500000,
      changeMinor: 35000,
      paidLate: false,
      reference: "3F9A21C7",
    },
  },
});

type Call = { name: string; params: Record<string, unknown> };

function world(options: {
  source?: unknown;
  sourceError?: { code?: string; message: string };
  uploadError?: string;
  user?: string | null;
} = {}) {
  const calls: Call[] = [];
  const uploads: Array<{ bucket: string; path: string; bytes: Uint8Array }> = [];
  const signs: Array<{ bucket: string; path: string; ttl: number }> = [];
  const client = {
    auth: {
      getUser: (jwt: string) =>
        Promise.resolve(
          jwt === "user-jwt" && options.user !== null
            ? { data: { user: { id: options.user ?? USER } }, error: null }
            : { data: { user: null }, error: { message: "invalid" } },
        ),
    },
    rpc: (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      if (name === "issue_4490_floor_pdf_source") {
        return Promise.resolve(
          options.sourceError
            ? { data: null, error: options.sourceError }
            : { data: options.source ?? kitchenSource(), error: null },
        );
      }
      return Promise.resolve({ data: name === "issue_4490_floor_pdf_record" ? "rec-1" : {}, error: null });
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, bytes: Uint8Array) => {
          uploads.push({ bucket, path, bytes });
          return Promise.resolve({ error: options.uploadError ? { message: options.uploadError } : null });
        },
        createSignedUrl: (path: string, ttl: number) => {
          signs.push({ bucket, path, ttl });
          return Promise.resolve({ data: { signedUrl: `https://storage.test/${path}?token=t` }, error: null });
        },
      }),
    },
  };
  const handle = createVenueFloorPdfHandler({
    env: (name) => (name === "SUPABASE_SERVICE_ROLE_KEY" ? "service-key" : "x"),
    client: () => client,
    uuid: () => "44900900-0000-4000-f000-000000000001",
    now: () => Date.parse("2026-11-21T20:42:00Z"),
  });
  return { handle, calls, uploads, signs };
}

function req(body: Record<string, unknown>, bearer: string | null = "user-jwt"): Request {
  return new Request("http://local/venue-floor-pdf", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify(body),
  });
}

const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
// Every page's content stream, decoded (pdf-lib Flate-compresses them).
async function pageText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = "";
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray
      ? contents.asArray().map((ref) => doc.context.lookup(ref))
      : [contents];
    for (const stream of streams) {
      if (stream instanceof PDFRawStream) out += text(decodePDFRawStream(stream).decode());
    }
  }
  return out;
}
const hexOf = (s: string) =>
  Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");

Deno.test("S1 no Bearer, a bad Bearer or the service key is 401 before anything is read", async () => {
  for (const bearer of [null, "bad", "service-key"]) {
    const w = world();
    const res = await w.handle(req({ kind: "kitchen_ticket", venueId: VENUE, orderId: ORDER, station: "kitchen" }, bearer));
    assertEquals(res.status, 401);
    assertEquals((await res.json()).code, "auth_required");
    assertEquals(w.calls.length, 0);
    assertEquals(w.uploads.length, 0);
  }
});

Deno.test("S2 the database's refusals keep their codes: rights, gate, foreign venue, not paid", async () => {
  const cases: Array<[string, number]> = [
    ["not_authorized", 403],
    ["stations_not_enabled", 422],
    ["till_not_enabled", 422],
    ["floor_pdf_not_found", 404],
    ["floor_pdf_not_ready", 409],
  ];
  for (const [code, status] of cases) {
    const w = world({ sourceError: { code: "P0001", message: code } });
    const res = await w.handle(req({ kind: "kitchen_ticket", venueId: VENUE, orderId: ORDER, station: "kitchen" }));
    assertEquals(res.status, status, code);
    assertEquals((await res.json()).code, code);
    assertEquals(w.uploads.length, 0, `${code}: nothing is uploaded`);
  }
  const w = world({ sourceError: { code: "XX000", message: "boom select * from secrets" } });
  const res = await w.handle(req({ kind: "kitchen_ticket", venueId: VENUE, orderId: ORDER, station: "kitchen" }));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { code: "floor_pdf_failed" });
});

Deno.test("S3 the actor passed to the database is the verified user, never the body", async () => {
  const w = world();
  await w.handle(req({ kind: "kitchen_ticket", venueId: VENUE, orderId: ORDER, station: "kitchen", actor: "evil" }));
  const source = w.calls.find((c) => c.name === "issue_4490_floor_pdf_source");
  assertEquals(source?.params, {
    p_kind: "kitchen_ticket",
    p_venue_id: VENUE,
    p_order_id: ORDER,
    p_station: "kitchen",
    p_payment_id: null,
    p_actor: USER,
  });
});

Deno.test("S4 each kind renders a real PDF into the private bucket behind a 60-second signed URL", async () => {
  for (const [body, source] of [
    [{ kind: "kitchen_ticket", venueId: VENUE, orderId: ORDER, station: "kitchen" }, kitchenSource()],
    [{ kind: "test_ticket", venueId: VENUE, station: "bar" }, { ...kitchenSource("roll_58"), kind: "test_ticket", station: "bar", ticket: undefined }],
    [{ kind: "receipt", venueId: VENUE, paymentId: PAYMENT }, receiptSource()],
  ] as Array<[Record<string, unknown>, unknown]>) {
    const w = world({ source });
    const res = await w.handle(req(body));
    assertEquals(res.status, 200, String(body.kind));
    const json = await res.json();
    assertMatch(json.signedUrl, /^https:\/\/storage\.test\//);
    assertEquals(json.expiresAt, "2026-11-21T20:43:00.000Z");
    assertMatch(json.filename, /\.pdf$/);
    assertEquals(w.uploads.length, 1);
    assertEquals(w.uploads[0].bucket, FLOOR_PDF_BUCKET);
    assertEquals(w.uploads[0].path, `${BRAND}/${VENUE}/44900900-0000-4000-f000-000000000001.pdf`);
    assertEquals(text(w.uploads[0].bytes.slice(0, 5)), "%PDF-");
    assertEquals(w.signs[0].ttl, 60);
  }
});

Deno.test("S5 a kitchen ticket PDF counts one print; a receipt and a test ticket count none", async () => {
  const k = world();
  await k.handle(req({ kind: "kitchen_ticket", venueId: VENUE, orderId: ORDER, station: "kitchen" }));
  const marks = k.calls.filter((c) => c.name === "issue_4490_station_mark_printed");
  assertEquals(marks.length, 1);
  assertEquals(marks[0].params, { p_order_id: ORDER, p_station: "kitchen", p_actor: USER });
  const r = world({ source: receiptSource() });
  await r.handle(req({ kind: "receipt", venueId: VENUE, paymentId: PAYMENT }));
  assertEquals(r.calls.filter((c) => c.name === "issue_4490_station_mark_printed").length, 0);
  const t = world({ source: { ...kitchenSource(), kind: "test_ticket", ticket: undefined } });
  await t.handle(req({ kind: "test_ticket", venueId: VENUE, station: "kitchen" }));
  assertEquals(t.calls.filter((c) => c.name === "issue_4490_station_mark_printed").length, 0);
});

Deno.test("S6 an upload failure is a plain 502 and counts no print", async () => {
  const w = world({ uploadError: "bucket full" });
  const res = await w.handle(req({ kind: "kitchen_ticket", venueId: VENUE, orderId: ORDER, station: "kitchen" }));
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { code: "floor_pdf_failed" });
  assertEquals(w.calls.filter((c) => c.name === "issue_4490_station_mark_printed").length, 0);
});

Deno.test("S7 every object is listed for the 24-hour sweep BEFORE it is uploaded", async () => {
  const w = world();
  const order: string[] = [];
  const original = w.uploads.push.bind(w.uploads);
  w.uploads.push = (...items) => {
    order.push("upload");
    return original(...items);
  };
  await w.handle(req({ kind: "kitchen_ticket", venueId: VENUE, orderId: ORDER, station: "kitchen" }));
  const record = w.calls.findIndex((c) => c.name === "issue_4490_floor_pdf_record");
  assert(record >= 0, "ledger written");
  assertEquals(w.calls[record].params, {
    p_brand_id: BRAND,
    p_kind: "kitchen_ticket",
    p_object_path: `${BRAND}/${VENUE}/44900900-0000-4000-f000-000000000001.pdf`,
    p_actor: USER,
  });
  assertEquals(order, ["upload"]);
  assert(w.calls.slice(0, record + 1).every((c) => c.name !== "issue_4490_station_mark_printed"));
});

// TEST-MOD-APPROVED #4490 (08-O5 part B): the day close now prints (dayClose.issue4490.o5b test); a
// day_close without a business date is a bad payload like the others.
Deno.test("S8 bad payloads are 400 with no read", async () => {
  for (const body of [
    { kind: "day_close", venueId: VENUE },
    { kind: "day_close", venueId: VENUE, date: "21/11/2026" },
    { kind: "menu", venueId: VENUE },
    { kind: "kitchen_ticket", venueId: "nope", orderId: ORDER, station: "kitchen" },
    { kind: "kitchen_ticket", venueId: VENUE, orderId: ORDER, station: "grill" },
    { kind: "kitchen_ticket", venueId: VENUE, station: "kitchen" },
    { kind: "receipt", venueId: VENUE },
    { kind: "test_ticket", venueId: VENUE, station: "pass" },
  ]) {
    const w = world();
    const r = await w.handle(req(body));
    assertEquals(r.status, 400, JSON.stringify(body));
    assertEquals(w.calls.length, 0);
  }
});

Deno.test("P1 paper: A4, an 80 mm roll and a 58 mm roll (height fitted to the content)", async () => {
  for (const paper of ["a4", "roll_80", "roll_58"] as const) {
    const pdf = await buildKitchenTicketPdf({
      paper,
      venueName: "Palm & Pepper",
      station: "kitchen",
      ticketNo: "0142",
      destination: "Table 6",
      sentAtLocal: "20:41",
      sellerName: "Ada",
      guestOrder: false,
      lines: [{ quantity: 2, name: "Smoky jollof rice", modifiers: ["Chicken"], notes: "no pepper", voided: false }],
      printedAtLocal: "21/11/2026 20:42",
      printNumber: 1,
    });
    const doc = await PDFDocument.load(Uint8Array.from(atob(pdf.contentBase64), (c) => c.charCodeAt(0)));
    const page = doc.getPage(0);
    assertEquals(Math.round(page.getWidth() * 100) / 100, FLOOR_PAPER_WIDTH_PT[paper]);
    if (paper === "a4") {
      assertEquals(Math.round(page.getHeight()), 842);
    } else {
      assert(page.getHeight() < 400, `${paper} height fitted (${page.getHeight()})`);
    }
  }
  assertEquals(FLOOR_PAPER_WIDTH_PT.roll_80, 226.77);
  assertEquals(FLOOR_PAPER_WIDTH_PT.roll_58, 164.41);
});

Deno.test("P2 a long receipt on A4 flows onto a second page instead of being cut", async () => {
  const source = receiptSource("NGN", "a4").receipt;
  const lines = Array.from({ length: 90 }, (_, i) => ({ label: `Item ${i + 1}`, quantity: 1, amountMinor: 100000, modifiers: [] }));
  const pdf = await buildTillReceiptPdf({
    paper: "a4", venueName: "Palm", venueAddress: null, checkLabel: "T1", paidAtLocal: "21/11/2026 21:14",
    receiptNo: 1, currency: "NGN", lines, subtotalMinor: 9000000, serviceChargeMinor: 0, taxIncludedMinor: 0,
    totalMinor: 9000000, paidBeforeMinor: 0, paymentAmountMinor: 9000000, tipMinor: 0, methodLabel: "Cash",
    cashGivenMinor: null, changeMinor: null, refundedMinor: 0, paidLate: false, reference: "ABCD1234",
    footer: source.footer as string,
  });
  assert(pdf.pageCount >= 2, `pages ${pdf.pageCount}`);
});

Deno.test("P3 money is written with the currency code for every currency (the font cannot draw ₦ or £)", async () => {
  assertEquals(formatMoneyCode(1850000, "NGN"), "NGN 18,500.00");
  assertEquals(formatMoneyCode(1250, "gbp"), "GBP 12.50");
  assertEquals(formatMoneyCode(120000, "JPY"), "JPY 120,000");
  assertEquals(formatMoneyCode(1234, "KWD"), "KWD 1.234");
  assertEquals(formatMoneyCode(-500, "USD"), "-USD 5.00");
  for (const currency of ["NGN", "GBP"]) {
    const s = receiptSource(currency, "roll_80");
    const w = world({ source: s });
    const res = await w.handle(req({ kind: "receipt", venueId: VENUE, paymentId: PAYMENT }));
    assertEquals(res.status, 200);
    const raw = await pageText(w.uploads[0].bytes);
    assert(raw.includes(hexOf(`${currency} 34,650.00`)), `${currency} total drawn as a code`);
    assert(!raw.includes(hexOf("₦")) && !raw.includes("₦"), "no naira symbol");
  }
});

Deno.test("P4 text the font cannot draw is sanitised, never fatal (accents and symbols print as spaces)", async () => {
  const w = world({ source: receiptSource() });
  const res = await w.handle(req({ kind: "receipt", venueId: VENUE, paymentId: PAYMENT }));
  assertEquals(res.status, 200);
  const raw = await pageText(w.uploads[0].bytes);
  assert(raw.includes(hexOf("Caf")), "the readable part of the name prints");
  const k = await buildKitchenTicketPdf({
    paper: "roll_58", venueName: "Zoë’s 🍲 Kitchen", station: "bar", ticketNo: "A1B2",
    destination: "Pickup 41 · Tolu", sentAtLocal: "20:41", sellerName: "Chloé", guestOrder: true,
    lines: [{ quantity: 1, name: "Crème brûlée ☕", modifiers: ["Extra – hot"], notes: "“no ice”", voided: false }],
    printedAtLocal: "21/11/2026 20:42", printNumber: 2,
  });
  const ticketRaw = await pageText(Uint8Array.from(atob(k.contentBase64), (c) => c.charCodeAt(0)));
  assert(ticketRaw.includes(hexOf("Pickup 41 - Tolu")), "the middle dot is written as a dash");
});

Deno.test("D1 the shared delivery rail: upload, then a signed URL with the caller's TTL; each failure names its stage", async () => {
  const seen: string[] = [];
  const storage = (uploadError: string | null, signError: string | null) => ({
    from: (bucket: string) => ({
      upload: (path: string, _b: Uint8Array, o: { contentType: string; upsert: boolean }) => {
        seen.push(`upload ${bucket} ${path} ${o.contentType} ${o.upsert}`);
        return Promise.resolve({ error: uploadError ? { message: uploadError } : null });
      },
      createSignedUrl: (path: string, ttl: number) => {
        seen.push(`sign ${bucket} ${path} ${ttl}`);
        return Promise.resolve(signError
          ? { data: null, error: { message: signError } }
          : { data: { signedUrl: "https://s/x" }, error: null });
      },
    }),
  });
  const ok = await deliverPdf(storage(null, null), { bucket: "b", objectPath: "p.pdf", contentBase64: btoa("%PDF-1.7"), ttlSeconds: 60 }, () => 0);
  assertEquals(ok, { ok: true, signedUrl: "https://s/x", expiresAt: "1970-01-01T00:01:00.000Z" });
  assertEquals(seen, ["upload b p.pdf application/pdf true", "sign b p.pdf 60"]);
  assertEquals((await deliverPdf(storage("no", null), { bucket: "b", objectPath: "p", contentBase64: "", ttlSeconds: 60 })), { ok: false, stage: "upload", message: "no" });
  assertEquals((await deliverPdf(storage(null, "x"), { bucket: "b", objectPath: "p", contentBase64: "", ttlSeconds: 60 })), { ok: false, stage: "sign", message: "x" });
});
