// #3872 R3 C0 — six-hour retention and abandoned-upload reaper.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { isAuthorizedCronCaller } from "../_shared/cronCallerAuth.ts";
import { deleteCreatorVideo } from "../_shared/creatorMedia.ts";
import { serviceClient, ticketCorsHeaders } from "../_shared/ticketCheckout.ts";

type ReapRow = {
  id: string;
  bunny_video_id: string | null;
  status: string;
  created_at: string;
  delete_after: string | null;
};

export function selectCreatorMediaReap(
  rows: ReapRow[],
  nowMs: number,
): ReapRow[] {
  const staleUpload = nowMs - 24 * 60 * 60 * 1000;
  return rows.filter((row) => {
    if (row.status === "deleted") return false;
    if (
      row.status === "awaiting_upload" &&
      Date.parse(row.created_at) <= staleUpload
    ) return true;
    return row.delete_after !== null && Date.parse(row.delete_after) <= nowMs;
  });
}

if (import.meta.main) {
  const supabase = serviceClient();
  serve(async (req) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (!await isAuthorizedCronCaller(req.headers.get("authorization"))) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
      });
    }
    const now = Date.now();
    const { data, error } = await supabase.from("creator_media_jobs")
      .select("id,bunny_video_id,status,created_at,delete_after")
      .neq("status", "deleted")
      .order("created_at", { ascending: true }).limit(500);
    if (error) {
      return new Response(JSON.stringify({ error: "read_failed" }), {
        status: 500,
      });
    }
    let deleted = 0;
    const failed: string[] = [];
    for (const row of selectCreatorMediaReap((data ?? []) as ReapRow[], now)) {
      if (row.bunny_video_id) {
        const outcome = await deleteCreatorVideo(row.bunny_video_id);
        if (!outcome.ok) {
          failed.push(row.id);
          continue;
        }
      }
      const { error: updateError } = await supabase.from("creator_media_jobs")
        .update({ status: "deleted", deleted_at: new Date().toISOString() })
        .eq("id", row.id).neq("status", "deleted");
      if (updateError) failed.push(row.id);
      else deleted += 1;
    }
    return new Response(
      JSON.stringify({ ok: failed.length === 0, deleted, failed }),
      {
        status: failed.length === 0 ? 200 : 207,
        headers: { "Content-Type": "application/json" },
      },
    );
  });
}
