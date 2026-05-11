// ORCH-0785 — escapeHtml unit tests.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { escapeHtml } from "../escape.ts";

Deno.test("escapeHtml returns empty string for null/undefined", () => {
  assertEquals(escapeHtml(null), "");
  assertEquals(escapeHtml(undefined), "");
});

Deno.test("escapeHtml escapes the five HTML metacharacters", () => {
  assertEquals(
    escapeHtml(`<script>alert("x")&'y'</script>`),
    "&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;y&#39;&lt;/script&gt;",
  );
});

Deno.test("escapeHtml escapes ampersand before other entities (no double-encode)", () => {
  // & must be replaced first; otherwise "&amp;" would become "&amp;amp;".
  assertEquals(escapeHtml("&amp;"), "&amp;amp;");
  assertEquals(escapeHtml("&<>"), "&amp;&lt;&gt;");
});

Deno.test("escapeHtml leaves benign strings unchanged", () => {
  assertEquals(escapeHtml("Hello world"), "Hello world");
  assertEquals(escapeHtml(""), "");
});

Deno.test("escapeHtml stringifies non-string inputs defensively", () => {
  // Caller-supplied values may arrive as numbers from JSON payloads.
  assertEquals(escapeHtml(42 as unknown as string), "42");
});
