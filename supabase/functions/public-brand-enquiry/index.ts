/**
 * #4111 — public-brand-enquiry. Request / response contract: see handler.ts.
 * verify_jwt: false (anonymous web + Mingla Sites contact forms).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { NOT_WIRED, productionCoreDeps } from "../_shared/brandEnquiryRuntime.ts";
import { moderateText } from "../_shared/contentModeration.ts";
import { createPublicBrandEnquiryHandler } from "./handler.ts";

serve(createPublicBrandEnquiryHandler({
  ...productionCoreDeps(),
  moderate: (text) => moderateText(text),
  sendSms: NOT_WIRED.sendSms,
}));
