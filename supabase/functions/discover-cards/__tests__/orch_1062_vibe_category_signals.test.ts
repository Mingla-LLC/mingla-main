import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// ORCH-1062 Part 2 (implementor-owned, happy-path) serving regression test.
//
// `CATEGORY_TO_SIGNAL` is a top-level const in index.ts and index.ts calls
// serve() at module load, so we read it as source text (the established pattern
// in orch_0909_adversarial.test.ts) and structurally parse the entries we care
// about. This asserts each of the 3 new vibe categories resolves to its OWN
// signal with the operator-locked filterMin (lively=120, romantic=60, scenic=60),
// keyed by BOTH display name AND slug (I-CATEGORY-SIGNAL-ALIAS-COMPLETE).
//
// Fails-on-revert: removing the CATEGORY_TO_SIGNAL entries makes the regex
// matches return undefined → assertEquals fails.

const root = new URL("../../../..", import.meta.url).pathname;
const edge = await Deno.readTextFile(
  `${root}/supabase/functions/discover-cards/index.ts`,
);

// Parse one CATEGORY_TO_SIGNAL entry by its key. Tolerant of whitespace.
function entryFor(
  key: string,
): { signal: string; filterMin: number; display: string } | undefined {
  const re = new RegExp(
    `['"]${key}['"]\\s*:\\s*\\{\\s*signalIds:\\s*\\[\\s*['"]([a-z_]+)['"]\\s*\\]\\s*,\\s*filterMin:\\s*(\\d+)\\s*,\\s*displayCategory:\\s*['"]([^'"]+)['"]`,
  );
  const m = edge.match(re);
  if (!m) return undefined;
  return { signal: m[1], filterMin: Number(m[2]), display: m[3] };
}

const EXPECTED: Record<
  string,
  { signal: string; filterMin: number; display: string }
> = {
  romantic: { signal: "romantic", filterMin: 60, display: "Romantic" },
  lively: { signal: "lively", filterMin: 120, display: "Lively" },
  scenic: { signal: "scenic", filterMin: 60, display: "Scenic" },
};

Deno.test("ORCH-1062 T-10: vibe categories resolve to own signal + locked filterMin (slug key)", () => {
  for (const [slug, exp] of Object.entries(EXPECTED)) {
    const e = entryFor(slug);
    assert(e !== undefined, `CATEGORY_TO_SIGNAL missing slug key "${slug}"`);
    assertEquals(e!.signal, exp.signal, `${slug} signal`);
    assertEquals(e!.filterMin, exp.filterMin, `${slug} filterMin`);
    assertEquals(e!.display, exp.display, `${slug} displayCategory`);
  }
});

Deno.test("ORCH-1062 T-10: vibe categories keyed by display name too (alias-complete)", () => {
  for (const [slug, exp] of Object.entries(EXPECTED)) {
    const e = entryFor(exp.display); // 'Romantic' / 'Lively' / 'Scenic'
    assert(
      e !== undefined,
      `CATEGORY_TO_SIGNAL missing display-name key "${exp.display}"`,
    );
    assertEquals(e!.signal, exp.signal, `${exp.display} signal`);
    assertEquals(e!.filterMin, exp.filterMin, `${exp.display} filterMin`);
  }
});

Deno.test("ORCH-1062 filterMin contract is exact (lively=120, romantic=60, scenic=60)", () => {
  assertEquals(entryFor("lively")!.filterMin, 120);
  assertEquals(entryFor("romantic")!.filterMin, 60);
  assertEquals(entryFor("scenic")!.filterMin, 60);
});
