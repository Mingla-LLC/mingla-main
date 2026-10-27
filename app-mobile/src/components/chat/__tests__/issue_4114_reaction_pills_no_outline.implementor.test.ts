// @ts-nocheck — Deno-runtime source-contract suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 — the reaction pills under chat bubbles read as a glowing
// outline: a 1px hairline ring on every pill, an orange ring on an orange fill
// for yours, overlapping the bubble by 4pt. The pills are now a solid neutral
// fill with no border or shadow; yours shows only through its count colour.
//
// FAILS-ON-REVERT: any border/shadow/elevation back on a reaction pill style,
// the orange fill or ring back on yours, the -4 overlap restored, or the
// 44pt hit area dropped.

const root = new URL("../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function styleBlock(source: string, name: string): string | null {
  const match = new RegExp(`\\n\\s+${name}: \\{([^}]*)\\}`).exec(source);
  return match ? match[1] : null;
}

Deno.test("reaction pills carry no border, ring or shadow", async () => {
  const bubble = strip(await read("MessageBubble.tsx"));
  const pill = styleBlock(bubble, "reactionPill");
  assert(pill, "reactionPill style exists");
  assert(!/border(Width|Color)/.test(pill), "reactionPill has no borderWidth or borderColor");
  assert(!/shadow|elevation/.test(pill), "reactionPill has no shadow or elevation");
  assert(/backgroundColor: chatTokens\.surfaceRaised/.test(pill), "reactionPill is a solid neutral fill");
  assert(/minHeight: 24/.test(pill), "reactionPill keeps its 24pt height");

  const mine = styleBlock(bubble, "reactionPillMine");
  assert(!mine || !/border|accent/.test(mine), "your pill has no accent border or fill");
  assert(!/reactionPillMine/.test(bubble.replace(/const styles[\s\S]*$/, "")), "your pill is not styled differently");

  const mineCount = styleBlock(bubble, "reactionCountMine");
  assert(mineCount && /color: chatTokens\.accent\b/.test(mineCount) && /fontWeight: '700'/.test(mineCount),
    "your reaction shows through its count in the accent colour at 700");
  assert(!/border|shadow|elevation/.test(mineCount), "your count carries no outline");
  assert(/reaction\.mine && styles\.reactionCountMine/.test(bubble), "the count applies the mine style");
});

Deno.test("reaction row sits under the bubble and pills keep a 44pt hit area", async () => {
  const bubble = strip(await read("MessageBubble.tsx"));
  const row = styleBlock(bubble, "reactionRow");
  assert(row && /marginTop: 2,/.test(row) && !/marginTop: -/.test(row), "reaction row no longer overlaps the bubble");
  assert(/hitSlop=\{REACTION_PILL_HIT_SLOP\}/.test(bubble), "pills use the shared hit slop");
  assert(/REACTION_PILL_HIT_SLOP = \{ top: 10, bottom: 10, left: 6, right: 6 \}/.test(bubble),
    "24pt + 20 tall and 32pt + 12 wide = 44pt");
});

Deno.test("long-press emoji row has no outline on its buttons", async () => {
  const menu = strip(await read("MessageContextMenu.tsx"));
  for (const name of ["emojiBtn", "emojiBtnUsed"]) {
    const block = styleBlock(menu, name);
    assert(block, `${name} style exists`);
    assert(!/border(Width|Color)|shadow|elevation/.test(block), `${name} has no border or shadow`);
  }
});
