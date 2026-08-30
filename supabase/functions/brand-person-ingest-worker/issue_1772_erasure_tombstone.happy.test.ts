import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { brandPersonIngestResolutionFailure } from "./index.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#1772 erased contact suppression is terminal while other resolver failures retry", () => {
  assertEquals(
    brandPersonIngestResolutionFailure(
      "rpc: people_erased_contact_suppressed",
    ),
    "erased_contact_suppressed",
  );
  assertEquals(
    brandPersonIngestResolutionFailure("connection reset"),
    "resolver_failed",
  );
  assertEquals(
    brandPersonIngestResolutionFailure(undefined),
    "resolver_failed",
  );

  assertStringIncludes(source, 'error.message === "erased_contact_suppressed"');
  assertStringIncludes(source, "p_succeeded: true");
  assertStringIncludes(source, "erasedSuppressed");
});
