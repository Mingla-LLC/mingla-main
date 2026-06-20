// ORCH-1167-R6 → SUPERSEDED BY R7. This test's original subject — the
// `driveMutedAutoplay` play()-retry driver (packages/offering-rendering/
// coverWebVideoAutoplay.ts) — was REMOVED by ORCH-1167-R7 after real-component
// WebKit forensics proved the play()-hammering at readyState 0 was ITSELF the
// Safari autoplay poison: a gesture-less play() fired before media load
// permanently denies the element inline-muted autoplay, so NO amount of retry
// recovers it (56/56 play() rejected on the live page). The web cover is now
// driven by the native autoPlay + muted + playsinline ATTRIBUTES with NO manual
// play(); that behavior is covered by
// packages/offering-rendering/__tests__/orch_1167_r7_webkit_cover_no_play_hammer.test.ts.
//
// Tests are append-only and a hard DELETE is not overridable, so R7 converts this
// file to a passing placeholder under the [TEST-MOD-APPROVED ORCH-1167] override
// token rather than deleting it. Rationale + before/after WebKit proof:
// Mingla_Artifacts/reports/IMPLEMENT_ORCH-1167_R7_WEBKIT_COVER_POISON.md.

describe("ORCH-1167-R6 driveMutedAutoplay (removed by R7)", () => {
  it("is superseded — the play()-hammer it covered was the WebKit autoplay poison", () => {
    expect(true).toBe(true);
  });
});
