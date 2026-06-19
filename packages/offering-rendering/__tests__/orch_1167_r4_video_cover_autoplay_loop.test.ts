// ORCH-1167-R4 [event-page video cover autoplay + loop] — implementor-owned
// regression for the single R4 revision: when the canonical standard-event
// public page's COVER is a VIDEO, it must AUTOPLAY (muted, inline) and LOOP
// continuously on EVERY surface (buyer-web, business iOS/Android, consumer
// iOS/Android), while honoring the existing reduce-motion freeze policy and
// leaving image / GIF covers unchanged.
//
// Two halves, both fails-on-revert:
//
//   (1) RUNTIME-LOGIC over the pure `shouldFreezeCoverForReduceMotion`
//       (coverMediaPresentation.ts), the single decider EventCoverMedia feeds
//       into the presentation resolver. It proves the autoplay INTENT survives
//       reduce-motion for the ambient muted-autoplay-loop cover (the cover
//       keeps playing) AND that a non-ambient cover (sound-on / non-loop /
//       tap-to-play) is STILL frozen — i.e. R4 did NOT override the
//       accessibility freeze. This is the contract the dispatch calls out:
//       "if reduce-motion indicates freeze, do NOT force autoplay."
//
//   (2) SOURCE-STRUCTURAL over the two physical cover mounts that drive every
//       standard-event surface — the shared ParallaxCoverShell (buyer-web +
//       business native, via FoundationEventPreview) and the consumer screen's
//       directly-pinned cover. Both must pass `autoplay={true}` + `loop={true}`
//       to EventCoverMedia. (These mounts import react-native and cannot mount
//       under node-env jest, so they are pinned as source contracts, the same
//       pattern as the ORCH-1167-R2/R3 layout tests.)
//
// FAILS-ON-REVERT (proven by TRUE deletion in the implementation report):
//   • Remove `autoplay={true}` (or revert to bare `autoplay`/`autoplay={false}`)
//     from the shell OR the consumer cover → the "passes autoplay" assertion
//     FAILS for that surface.
//   • Remove `loop={true}` (or revert to `loop={false}`) from either mount →
//     the "passes loop" assertion FAILS.
//   • Make `shouldFreezeCoverForReduceMotion` freeze the ambient cover (drop the
//     `isAmbientMutedLoop` guard) → the "ambient cover still plays" assertion
//     FAILS.
//   • Make it stop freezing non-ambient covers under reduce-motion → the
//     "sound-on / non-loop cover still freezes" assertions FAIL.

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Pure, react-native-free decider — import the module DIRECTLY (not the
// @mingla/event-rendering barrel, which pulls react-native and breaks node-env
// jest).
import { shouldFreezeCoverForReduceMotion } from "../../event-rendering/coverMediaPresentation";

const repoRoot = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

// The shared shell mounts the cover for buyer-web + business iOS/Android (the
// standard-event page reaches it via FoundationEventPreview → ParallaxCoverShell;
// trip/experience reach it too). The consumer standard-event screen pins its own
// cover directly (BaseBottomSheet host, not the shell).
const SHELL = "packages/offering-rendering/ParallaxCoverShell.tsx";
const CONSUMER = "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx";

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// Extract the <EventCoverMedia .../> JSX block (props between the opening tag
// and its self-close) so an assertion targets the COVER mount specifically.
// `anchor` lets us select the RIGHT mount when a file has several (the consumer
// screen pins multiple covers): we start the search at the R4 comment anchor so
// the standard-event cover is selected, not a sibling.
const coverMountProps = (src: string, anchor?: string): string => {
  const from = anchor === undefined ? 0 : src.indexOf(anchor);
  expect(from).toBeGreaterThanOrEqual(0);
  const open = src.indexOf("<EventCoverMedia", from);
  expect(open).toBeGreaterThanOrEqual(0);
  const close = src.indexOf("/>", open);
  expect(close).toBeGreaterThan(open);
  return src.slice(open, close);
};

describe("ORCH-1167-R4 — reduce-motion still governs autoplay (no override)", () => {
  it("the AMBIENT muted-autoplay-loop video cover KEEPS PLAYING under reduce-motion (autoplay survives)", () => {
    // autoplay + muted + loop = the exact R4 cover config the shell/consumer
    // pass. Reduce-motion must NOT freeze it (it is ambient motion, like a GIF),
    // so the autoplay intent reaches the player.
    expect(
      shouldFreezeCoverForReduceMotion({
        reduceMotion: true,
        autoplay: true,
        muted: true,
        loop: true,
      }),
    ).toBe(false);
  });

  it("a SOUND-ON cover is STILL frozen under reduce-motion (freeze NOT overridden)", () => {
    expect(
      shouldFreezeCoverForReduceMotion({
        reduceMotion: true,
        autoplay: true,
        muted: false,
        loop: true,
      }),
    ).toBe(true);
  });

  it("a NON-LOOP cover is STILL frozen under reduce-motion", () => {
    expect(
      shouldFreezeCoverForReduceMotion({
        reduceMotion: true,
        autoplay: true,
        muted: true,
        loop: false,
      }),
    ).toBe(true);
  });

  it("a NON-AUTOPLAY (tap-to-play) cover is STILL frozen under reduce-motion", () => {
    expect(
      shouldFreezeCoverForReduceMotion({
        reduceMotion: true,
        autoplay: false,
        muted: true,
        loop: true,
      }),
    ).toBe(true);
  });

  it("with reduce-motion OFF, the ambient cover is never frozen (plays normally)", () => {
    expect(
      shouldFreezeCoverForReduceMotion({
        reduceMotion: false,
        autoplay: true,
        muted: true,
        loop: true,
      }),
    ).toBe(false);
  });
});

describe("ORCH-1167-R4 — every standard-event cover mount passes autoplay + loop", () => {
  it("the shared ParallaxCoverShell cover passes autoplay={true} + loop={true} (buyer-web + business iOS/Android)", () => {
    const props = coverMountProps(stripComments(read(SHELL)));
    expect(props).toMatch(/autoplay=\{true\}/);
    expect(props).toMatch(/loop=\{true\}/);
    // Muted-inline autoplay path is preserved (the cover follows the page mute
    // state; default-muted ⇒ ambient autoplay). Not hard-muted-true here, so the
    // chrome Mute toggle can unmute.
    expect(props).toMatch(/muted=\{muted\}/);
    // It must NOT regress to a disabled/bare form.
    expect(props).not.toMatch(/autoplay=\{false\}/);
    expect(props).not.toMatch(/loop=\{false\}/);
  });

  it("the consumer standard-event cover passes autoplay={true} + loop={true} (consumer iOS/Android)", () => {
    // The consumer screen pins several covers; select the standard-event one,
    // which sits inside the `styles.nativeCover` pinned wrapper (survives the
    // comment strip, so it's a stable anchor).
    const props = coverMountProps(stripComments(read(CONSUMER)), "styles.nativeCover");
    expect(props).toMatch(/autoplay=\{true\}/);
    expect(props).toMatch(/loop=\{true\}/);
    expect(props).toMatch(/muted=\{muted\}/);
    expect(props).not.toMatch(/autoplay=\{false\}/);
    expect(props).not.toMatch(/loop=\{false\}/);
  });
});
