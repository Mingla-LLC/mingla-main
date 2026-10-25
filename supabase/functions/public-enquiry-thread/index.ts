/**
 * #4111 — public-enquiry-thread. Request / response contract: see handler.ts.
 * verify_jwt: false (the emailed token is the capability).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { NOT_WIRED, productionCoreDeps } from "../_shared/brandEnquiryRuntime.ts";
import { createPublicEnquiryThreadHandler } from "./handler.ts";

serve(createPublicEnquiryThreadHandler({ ...productionCoreDeps(), ...NOT_WIRED }));
