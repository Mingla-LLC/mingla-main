/**
 * #3720 Slice C — support-grant-staff accepts email; preserves role/display_name.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const SRC = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));

Deno.test("#3720 grant accepts email or userId", () => {
  assertStringIncludes(SRC, "normalizeEmail");
  assertStringIncludes(SRC, "user_not_found");
  assertStringIncludes(SRC, "userId_or_email_required");
  assertStringIncludes(SRC, '.eq("email", email)');
  // Must not require userId alone anymore.
  assertEquals(SRC.includes('error: "userId_required"'), false);
});

Deno.test("#3720 upsert omits role/display_name unless body sends them", () => {
  assertStringIncludes(SRC, "typeof body?.role === \"string\"");
  assertStringIncludes(SRC, "typeof body?.displayName === \"string\"");
  // Patch starts with only user_id / enabled / updated_at.
  assertStringIncludes(SRC, "user_id: targetUserId");
  assertStringIncludes(SRC, "enabled,");
  assertStringIncludes(SRC, "updated_at:");
  // Revoke path must not force role/default display_name.
  assertEquals(
    /const roleRaw = typeof body\?\.role === "string" \? body\.role : "staff"/.test(
      SRC,
    ),
    false,
  );
  assertEquals(
    /display_name: displayName/.test(SRC) &&
      /const displayName = typeof body\?\.displayName === "string" \? body\.displayName : null/
        .test(SRC),
    false,
  );
});
