import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeMenuParsePayload } from "./geminiMenuParser.ts";

Deno.test("normalizeMenuParsePayload caps at 20 experiences", () => {
  const raw = {
    experiences: Array.from({ length: 25 }, (_, i) => ({
      title: `Experience ${i}`,
      narrative: `Narrative ${i}`,
    })),
  };
  const out = normalizeMenuParsePayload(raw);
  assertEquals(out.length, 20);
});

Deno.test("normalizeMenuParsePayload skips invalid rows", () => {
  const out = normalizeMenuParsePayload({
    experiences: [
      { title: "Valid", narrative: "Good" },
      { title: "", narrative: "Missing title" },
      { narrative: "Missing title field" },
    ],
  });
  assertEquals(out.length, 1);
  assertEquals(out[0].title, "Valid");
});

Deno.test("normalizeMenuParsePayload returns empty for non-menu shape", () => {
  assertEquals(normalizeMenuParsePayload(null), []);
  assertEquals(normalizeMenuParsePayload({}), []);
});
