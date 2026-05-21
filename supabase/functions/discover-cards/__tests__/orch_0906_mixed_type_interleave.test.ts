import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideTypeAndPill } from "../../_shared/mixedTypeInterleave.ts";

Deno.test("ORCH-0906 helper returns null for invalid or empty target side", () => {
  assertEquals(decideTypeAndPill({ position: 0, categories: ["brunch"], intents: ["romantic"] }), null);
  assertEquals(decideTypeAndPill({ position: 1, categories: [], intents: ["romantic"] }), null);
  assertEquals(decideTypeAndPill({ position: 2, categories: ["brunch"], intents: [] }), null);
});

Deno.test("ORCH-0906 helper matches D4 20-card worked example rotation", () => {
  const categories = ["brunch", "fine_dining", "icebreakers", "movies", "nature", "play"];
  const intents = ["group-fun", "romantic"];
  const actual = Array.from({ length: 20 }, (_, i) => {
    const d = decideTypeAndPill({ position: i + 1, categories, intents });
    return `${d?.type}:${d?.pill}`;
  });
  assertEquals(actual, [
    "single:brunch",
    "curated:group-fun",
    "single:fine_dining",
    "curated:romantic",
    "single:icebreakers",
    "curated:group-fun",
    "single:movies",
    "curated:romantic",
    "single:nature",
    "curated:group-fun",
    "single:play",
    "curated:romantic",
    "single:brunch",
    "curated:group-fun",
    "single:fine_dining",
    "curated:romantic",
    "single:icebreakers",
    "curated:group-fun",
    "single:movies",
    "curated:romantic",
  ]);
});
