// @ts-ignore Deno runtime import.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
// @ts-ignore Deno runtime import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  paystackInitializeTransaction,
  paystackVerifyTransactionOutcome,
} from "../_shared/paystack.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import { isAuthorizedCronCaller } from "../_shared/cronCallerAuth.ts";
import {
  notifyGigPaymentMismatch,
  requestGigLateRefund,
} from "../_shared/gigPaymentCapture.ts";
import { createGigHireHandler } from "./handler.ts";

// The handler and every action live in handler.ts (tested with injected
// clients); this file only wires the real ones.
const url = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

serve(createGigHireHandler({
  webOrigin: Deno.env.get("BUSINESS_WEB_ORIGIN") ??
    Deno.env.get("MINGLA_PUBLIC_WEB_BASE_URL") ?? null,
  userClient: (authorization: string) =>
    createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    }),
  serviceClient: () =>
    createClient(url, serviceKey, { auth: { persistSession: false } }),
  paystackInitialize: (input) => paystackInitializeTransaction(input),
  paystackVerifyOutcome: (reference: string) =>
    paystackVerifyTransactionOutcome(reference),
  stripe: () => stripeTicketCheckout(),
  isCronCaller: (authorization: string) =>
    isAuthorizedCronCaller(authorization),
  notifyMismatch: (input) => notifyGigPaymentMismatch(input),
  requestLateRefund: (contractId: string) =>
    requestGigLateRefund(contractId, { supabaseUrl: url, serviceKey }),
}));
