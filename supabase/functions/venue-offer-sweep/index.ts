// #4490 venue-offer-sweep — the venue offer clock, every 15 minutes from
// pg_cron (issue_4490_offer_sweep): lapsed holds (belt and braces; the Stays
// sweep already expires them), balance reminders before the due date, and
// overdue notices on the due date and 3 days after (no auto-cancel). Every
// message is one booking event keyed by booking and day, so a repeat run sends
// nothing twice. Messages go out through the notification outbox.
// #4490 spec 08 O1: the same run cancels Till rounds that were inserted held
// but never joined a check within 10 minutes (issue_4490_till_sweep_held_rounds;
// bounded, idempotent, never a paid, sent or attached round). Each step runs
// even when the other fails; the run answers 500 if either failed.
// #4490 spec 08 O3: the same run deletes floor PDFs (kitchen tickets,
// receipts) older than 24 hours from the private venue-floor-pdfs bucket
// (issue_4490_floor_pdf_due -> storage remove -> issue_4490_floor_pdf_forget).
// Before migration 20281203584490 the ledger does not exist: that step then
// has nothing to delete (deploy-order tolerance), any other failure counts.
//
// Only the platform's own scheduler calls this: the bearer must be the
// project's service key.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type SweepClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<
    { data: unknown; error: { code?: string; message?: string } | null }
  >;
  storage?: {
    from: (bucket: string) => {
      remove: (paths: string[]) => Promise<{ error: { message?: string } | null }>;
    };
  };
};

export const FLOOR_PDF_SWEEP_BUCKET = "venue-floor-pdfs";

// [TRANSITIONAL] #4490 O3 deploy order: the ledger RPC is missing until
// migration 20281203584490 is applied; exit: that migration applied in
// production, then delete this check.
function missingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || error.code === "42883";
}

async function sweepFloorPdfs(client: SweepClient): Promise<{ deleted: number; failed: boolean }> {
  const due = await client.rpc("issue_4490_floor_pdf_due", { p_limit: 200 });
  if (due.error) {
    if (missingFunction(due.error)) return { deleted: 0, failed: false };
    console.error("venue_floor_pdf_sweep_failed", { code: due.error.code, message: due.error.message });
    return { deleted: 0, failed: true };
  }
  const paths = Array.isArray(due.data) ? due.data.filter((p): p is string => typeof p === "string") : [];
  if (paths.length === 0) return { deleted: 0, failed: false };
  if (!client.storage) {
    console.error("venue_floor_pdf_sweep_failed", { code: "no_storage" });
    return { deleted: 0, failed: true };
  }
  const removed = await client.storage.from(FLOOR_PDF_SWEEP_BUCKET).remove(paths);
  if (removed.error) {
    console.error("venue_floor_pdf_sweep_failed", { code: "storage_remove", message: removed.error.message });
    return { deleted: 0, failed: true };
  }
  const forgot = await client.rpc("issue_4490_floor_pdf_forget", { p_paths: paths });
  if (forgot.error) {
    console.error("venue_floor_pdf_sweep_failed", { code: forgot.error.code, message: forgot.error.message });
    return { deleted: paths.length, failed: true };
  }
  return { deleted: Number(forgot.data ?? 0), failed: false };
}

export type VenueOfferSweepDeps = {
  env?: (name: string) => string | undefined;
  client?: () => SweepClient;
};

/**
 * The only environment names this function reads, each read literally so the
 * function secret contract can attribute them (#2241). Tests inject `deps.env`.
 */
function runtimeEnv(name: string): string | undefined {
  switch (name) {
    case "SUPABASE_SERVICE_ROLE_KEY":
      return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    case "SUPABASE_URL":
      return Deno.env.get("SUPABASE_URL");
    default:
      return undefined;
  }
}

export function createVenueOfferSweepHandler(deps: VenueOfferSweepDeps = {}) {
  const env = deps.env ?? runtimeEnv;
  return async function handle(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return Response.json({ error: "method_not_allowed" }, { status: 405 });
    }
    const url = env("SUPABASE_URL") ?? "";
    const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (
      !url || !serviceKey ||
      req.headers.get("authorization") !== `Bearer ${serviceKey}`
    ) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const client = deps.client ? deps.client() : createClient(url, serviceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }) as unknown as SweepClient;
    const { data, error } = await client.rpc("issue_4490_offer_sweep", {
      p_limit: 200,
    });
    if (error) {
      console.error("venue_offer_sweep_failed", {
        code: error.code,
        message: error.message,
      });
    }
    const till = await client.rpc("issue_4490_till_sweep_held_rounds", {
      p_limit: 200,
    });
    if (till.error) {
      console.error("venue_till_held_sweep_failed", {
        code: till.error.code,
        message: till.error.message,
      });
    }
    const pdfs = await sweepFloorPdfs(client);
    if (error || till.error || pdfs.failed) {
      return Response.json({ error: "sweep_failed" }, { status: 500 });
    }
    return Response.json({
      ok: true,
      result: data,
      tillHeldRounds: till.data,
      floorPdfsDeleted: pdfs.deleted,
    });
  };
}

if (import.meta.main) {
  Deno.serve(createVenueOfferSweepHandler());
}
