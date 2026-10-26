/**
 * #4111 — brand-enquiry-guest-digest (cron). Contract: see handler.ts.
 * verify_jwt: false; the service-role bearer is checked in code.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { productionCoreDeps } from "../_shared/brandEnquiryRuntime.ts";
import { createGuestDigestHandler } from "./handler.ts";

serve(createGuestDigestHandler({
  ...productionCoreDeps(),
  serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
}));
