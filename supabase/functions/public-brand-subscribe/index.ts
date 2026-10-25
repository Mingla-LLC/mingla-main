/**
 * #4111 — public-brand-subscribe. Request / response contract: see handler.ts.
 * verify_jwt: false (signed-out brand page + Mingla Sites newsletter boxes).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { NOT_WIRED, productionCoreDeps } from "../_shared/brandEnquiryRuntime.ts";
import { smsAdapter } from "../_shared/adapters/smsAdapter.ts";
import { createPublicBrandSubscribeHandler } from "./handler.ts";

serve(createPublicBrandSubscribeHandler({
  ...productionCoreDeps(),
  moderate: NOT_WIRED.moderate,
  async sendSms(input) {
    const result = await smsAdapter.send({
      to: input.to,
      brandName: input.brandName,
      message: input.message,
      messageType: "transactional",
    });
    return { ok: result.ok, error: result.error ?? null };
  },
}));
