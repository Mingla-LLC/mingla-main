// #4490 spec 08 O3 part A — venue-offer-sweep deletes floor PDFs after 24 hours.
// Run: deno test --allow-env --no-check supabase/functions/venue-offer-sweep/floorPdfs.issue4490.ops.implementor.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createVenueOfferSweepHandler, FLOOR_PDF_SWEEP_BUCKET } from "./index.ts";

const env = (name: string) => ({ SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "service-key" }[name]);
const req = () => new Request("http://x", { method: "POST", headers: { authorization: "Bearer service-key" } });
const PATHS = ["b/v/1.pdf", "b/v/2.pdf"];

function world(o: { due?: unknown; dueError?: { code?: string; message?: string }; removeError?: string } = {}) {
  const rpcs: Array<[string, Record<string, unknown>]> = [];
  const removed: Array<[string, string[]]> = [];
  const client = {
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcs.push([name, params]);
      if (name === "issue_4490_floor_pdf_due") {
        return Promise.resolve(o.dueError ? { data: null, error: o.dueError } : { data: o.due ?? PATHS, error: null });
      }
      if (name === "issue_4490_floor_pdf_forget") return Promise.resolve({ data: (params.p_paths as string[]).length, error: null });
      return Promise.resolve({ data: {}, error: null });
    },
    storage: {
      from: (bucket: string) => ({
        remove: (paths: string[]) => {
          removed.push([bucket, paths]);
          return Promise.resolve({ error: o.removeError ? { message: o.removeError } : null });
        },
      }),
    },
  };
  return { rpcs, removed, handle: createVenueOfferSweepHandler({ env, client: () => client }) };
}

Deno.test("FP1 objects older than 24 hours are removed from the private bucket, then marked deleted", async () => {
  const w = world();
  const res = await w.handle(req());
  assertEquals(res.status, 200);
  assertEquals((await res.json()).floorPdfsDeleted, 2);
  assertEquals(w.removed, [[FLOOR_PDF_SWEEP_BUCKET, PATHS]]);
  assertEquals(FLOOR_PDF_SWEEP_BUCKET, "venue-floor-pdfs");
  assertEquals(w.rpcs.filter(([n]) => n === "issue_4490_floor_pdf_forget"), [["issue_4490_floor_pdf_forget", { p_paths: PATHS }]]);
});

Deno.test("FP2 nothing due removes nothing", async () => {
  const w = world({ due: [] });
  assertEquals((await w.handle(req())).status, 200);
  assertEquals(w.removed.length, 0);
});

Deno.test("FP3 a storage failure keeps the rows (retried next run) and answers 500", async () => {
  const w = world({ removeError: "down" });
  assertEquals((await w.handle(req())).status, 500);
  assertEquals(w.rpcs.some(([n]) => n === "issue_4490_floor_pdf_forget"), false);
});

Deno.test("FP4 deploy order: before the migration the ledger RPC is missing and the run is still green", async () => {
  for (const code of ["PGRST202", "42883"]) {
    const w = world({ dueError: { code, message: "function does not exist" } });
    const res = await w.handle(req());
    assertEquals(res.status, 200, code);
    assertEquals((await res.json()).floorPdfsDeleted, 0);
  }
  const other = world({ dueError: { code: "57014", message: "timeout" } });
  assertEquals((await other.handle(req())).status, 500);
});
