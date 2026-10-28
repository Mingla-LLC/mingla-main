/**
 * Paystack TEST-provider checkout harness.
 *
 * This function is intentionally public (verify_jwt=false), fixed to Paystack
 * TEST credentials, NGN, Mingla's synthetic buyer, and a bounded amount. It
 * can initialize a hosted test checkout, verify that checkout, and exercise a
 * reusable-card charge through the same provider helper used by scheduled
 * installments. It never exposes a secret key, authorization code, card, or
 * buyer identity.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handlePaystackTestRequest } from "./handler.ts";

serve((req) => handlePaystackTestRequest(req));
