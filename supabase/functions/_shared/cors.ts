// ORCH-0821 — Shared CORS headers for Ari edge functions.
// Mirrors the existing pattern from _shared/stripeEdgeAuth.ts but lives as
// its own module so Ari's edge functions don't import Stripe-specific code.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, accept-language",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
