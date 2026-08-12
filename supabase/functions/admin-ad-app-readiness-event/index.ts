// @ts-ignore Deno URL import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno URL import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleReadinessEvent } from "./handler.ts";
const URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
serve((request) =>
  handleReadinessEvent(request, {
    authorize: async (authorization) => {
      const client = createClient(URL, ANON, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false },
      });
      const { data: { user }, error } = await client.auth.getUser();
      if (error || !user) return { status: "unauthorized" as const };
      const { data: admin, error: adminError } = await client.rpc(
        "is_admin_user",
      );
      return !adminError && admin === true
        ? { status: "authorized" as const, actor: user.id }
        : { status: "forbidden" as const };
    },
    insert: async (row) => {
      // Service credentials are instantiated only after the user + admin gates.
      const db = createClient(URL, SERVICE, {
        auth: { persistSession: false },
      });
      const { error } = await db.from("ad_app_readiness_events").insert(row);
      if (error) throw new Error("event_insert_failed");
    },
  })
);
