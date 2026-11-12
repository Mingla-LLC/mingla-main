// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createPaystackRefund } from "../_shared/paystackRefunds.ts";
import { isAuthorizedCronCaller } from "../_shared/cronCallerAuth.ts";
import { stripeTicketRefund } from "../_shared/stripe.ts";
import { notifyGigRefundGaveUp } from "../_shared/gigPaymentCapture.ts";
import { createGigRefundHandler } from "./handler.ts";

// Every step lives in handler.ts (tested with injected clients); this file
// only wires the real ones.
const url = Deno.env.get("SUPABASE_URL") ?? "";

serve(createGigRefundHandler({
  serviceClient: () =>
    createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false },
    }),
  userClient: (authorization: string) =>
    createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    }),
  isCronCaller: (authorization: string) =>
    isAuthorizedCronCaller(authorization),
  stripeRefund: (params, idempotencyKey) =>
    stripeTicketRefund().refunds.create(params, { idempotencyKey }),
  paystackRefund: (input) => createPaystackRefund(input),
  notifyGaveUp: (input) => notifyGigRefundGaveUp(input),
}));
