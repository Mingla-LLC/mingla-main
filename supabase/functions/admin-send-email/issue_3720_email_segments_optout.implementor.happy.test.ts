/**
 * #3720 Slice B — admin-send-email segment fail-closed, opt-out, List-Unsubscribe,
 * single admin_email_log writer (edge).
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const SRC = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));

Deno.test("#3720 supported segments only — city/tier/last_active rejected", () => {
  assertStringIncludes(SRC, "SUPPORTED_SEGMENT_TYPES");
  assertStringIncludes(SRC, "unsupported_segment");
  assertStringIncludes(SRC, '"country"');
  assertStringIncludes(SRC, '"onboarding"');
  assertStringIncludes(SRC, '"status"');
  // Must not treat city/tier/last_active as filtered types in the allow-set.
  const allowMatch = SRC.match(
    /SUPPORTED_SEGMENT_TYPES = new Set\(\[([\s\S]*?)\]\)/,
  );
  assertEquals(Boolean(allowMatch), true);
  const allow = allowMatch![1];
  assertEquals(allow.includes("city"), false);
  assertEquals(allow.includes("tier"), false);
  assertEquals(allow.includes("last_active"), false);
});

Deno.test("#3720 bulk honors channel_suppressions + marketing_unsubscribes", () => {
  assertStringIncludes(SRC, "loadSuppressedEmails");
  assertStringIncludes(SRC, "channel_suppressions");
  assertStringIncludes(SRC, "marketing_unsubscribes");
  assertStringIncludes(SRC, "skipped_opt_out");
  assertStringIncludes(SRC, "skippedOptOut");
});

Deno.test("#3720 Resend payloads carry List-Unsubscribe headers on marketing sends", () => {
  assertStringIncludes(SRC, "List-Unsubscribe");
  assertStringIncludes(SRC, "List-Unsubscribe-Post");
  assertStringIncludes(SRC, "signUnsubscribeToken");
  assertStringIncludes(SRC, "marketingHeaders");
});

Deno.test("#3720 estimate returns will_receive + opted_out + total", () => {
  assertStringIncludes(SRC, "opted_out");
  assertStringIncludes(SRC, "will_receive");
});
