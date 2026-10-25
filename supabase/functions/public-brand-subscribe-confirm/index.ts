/**
 * #4111 — public-brand-subscribe-confirm. Contract: see handler.ts.
 * verify_jwt: false (the emailed / texted token is the capability).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { productionCoreDeps } from "../_shared/brandEnquiryRuntime.ts";
import { createSubscribeConfirmHandler } from "./handler.ts";

serve(createSubscribeConfirmHandler(productionCoreDeps()));
