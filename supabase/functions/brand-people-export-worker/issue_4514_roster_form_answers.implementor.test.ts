// #4514 wave 3: the guest roster CSV carries one column per question of the page's
// brand form (§4.9). Hermetic: the real worker over an in-memory service; the SQL
// feed itself (brand_form_roster_export_answers) is proven in the pg17 suite
// (T-W3-EXPORT).
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleExportWorkerRequest, rosterFormAnswers } from "./index.ts";
import { csvCell } from "../brand-people-export/csv.ts";

const KEY = "service-key";

function service(kind: "offering_guest_roster" | "brand_book", feed: {
  data: unknown;
  error: { message: string } | null;
}) {
  const calls: string[] = [];
  let uploaded = "";
  let failedWith: string | null = null;
  const empty = {
    select() {
      return this;
    },
    in() {
      return this;
    },
    or() {
      return this;
    },
    limit() {
      return Promise.resolve({ data: [], error: null });
    },
  };
  const svc = {
    from() {
      return empty;
    },
    storage: {
      from() {
        return {
          upload(_path: string, bytes: Uint8Array) {
            uploaded = new TextDecoder().decode(bytes);
            return Promise.resolve({ data: {}, error: null });
          },
        };
      },
    },
    rpc(name: string, args: Record<string, unknown>) {
      calls.push(name);
      if (name === "biz_claim_brand_people_export_jobs") {
        return Promise.resolve({
          data: [{ id: "job-1", brand_id: "brand-a", export_kind: kind }],
          error: null,
        });
      }
      if (name === "biz_brand_people_export_rows") {
        return Promise.resolve({
          data: [
            { row_data: { personId: "p-wes", name: "Wes Answer" } },
            { row_data: { personId: "p-val", name: "Val Waiting" } },
          ],
          error: null,
        });
      }
      if (name === "brand_form_roster_export_answers") {
        return Promise.resolve(feed);
      }
      if (name === "biz_retry_or_fail_brand_people_export") {
        failedWith = String(
          args.p_safe_error_code ?? args.p_error_code ?? "failed",
        );
        return Promise.resolve({ data: "failed", error: null });
      }
      return Promise.resolve({ data: true, error: null });
    },
  };
  return {
    svc,
    calls,
    csv: () => uploaded,
    failed: () => failedWith,
  };
}

const FEED = {
  formId: "form-w",
  columns: [
    { key: "1:q1", header: "Would you like to perform?" },
    { key: "1:q2", header: "What will you do?" },
    { key: "2:q2", header: "name" }, // collides with a roster column: made unique
  ],
  rows: { "p-wes": { "1:q1": "Yes", "1:q2": "Juggle", "2:q2": "=cmd" } },
};

async function run(s: ReturnType<typeof service>) {
  return await handleExportWorkerRequest(
    new Request("https://x/worker", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}` },
    }),
    {
      createService: () => s.svc,
      envGet: (n) => n === "SUPABASE_URL" ? "https://db" : KEY,
      randomUUID: () => "worker-1",
    },
  );
}

Deno.test("T-W3-CSV: a guest roster export gains one column per question, with each person's answers", async () => {
  const s = service("offering_guest_roster", { data: FEED, error: null });
  const res = await run(s);
  assertEquals(res.status, 200);
  const [header, ...lines] = s.csv().trim().split("\r\n");
  const wes = lines.find((l) => l.startsWith(`"p-wes"`)) ?? "";
  const val = lines.find((l) => l.startsWith(`"p-val"`)) ?? "";
  assert(
    header.endsWith(
      `"Would you like to perform?","What will you do?","name (2)"`,
    ),
    header,
  );
  assert(wes.includes(`"Yes","Juggle","'=cmd"`), wes); // formula guard still applies
  assert(val.endsWith(`"","",""`), val);
});

Deno.test("T-W3-CSV: a brand book export never asks for form answers", async () => {
  const s = service("brand_book", { data: FEED, error: null });
  await run(s);
  assertFalse(s.calls.includes("brand_form_roster_export_answers"));
  assertFalse(s.csv().includes("Would you like"));
});

Deno.test("T-W3-CSV: a failed answers read fails the export instead of shipping it without answers", async () => {
  const s = service("offering_guest_roster", {
    data: null,
    error: { message: "boom" },
  });
  const res = await run(s);
  assertEquals((await res.json()).failed, 1);
  assertEquals(s.csv(), "");
});

Deno.test("rosterFormAnswers: no form means no columns", async () => {
  const s = service("offering_guest_roster", {
    data: { columns: [], rows: {} },
    error: null,
  });
  const out = await rosterFormAnswers(s.svc, "job-1");
  assertEquals(out.headers, []);
  assertEquals(out.byPerson.size, 0);
});

// Fix wave (finding 6): a guest-written answer starting with a tab or carriage
// return is a formula to some spreadsheets; it is kept as text like = + - @.
Deno.test("csvCell: a leading = + - @, tab or carriage return is kept as text", () => {
  for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
    assertEquals(csvCell(`${lead}SUM(A1)`), `"'${lead}SUM(A1)"`);
  }
  assertEquals(csvCell("Juggle"), '"Juggle"');
  assertEquals(csvCell('say "hi"'), '"say ""hi"""');
  assertEquals(csvCell("a\tb"), '"a\tb"');
});
