import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compareSemver } from "./appVersionPolicy.ts";

Deno.test("#2075 numeric semantic versions never compare lexicographically", () => {
  assertEquals(compareSemver("1.1.10", "1.1.9"), 1);
  assertEquals(compareSemver("1.1.4", "1.1.4"), 0);
  assertEquals(compareSemver("1.1.3", "1.1.4"), -1);
  assertEquals(compareSemver("1.1", "1.1.4"), null);
});
