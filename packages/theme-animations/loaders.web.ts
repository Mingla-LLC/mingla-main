// issue #1023 — lazy loaders for the generated theme-motion Lottie files (web).
// One entry per slug and phase so a page only ever loads the two files it
// shows. Regenerate the JSON with `npm run generate` in this package; keep
// this list in step with THEME_ANIMATION_SLUGS (a test checks both).
//
// Web: dynamic `import()`, so Metro splits every file into its own chunk and
// none of them lands in the eager boot payload (bundle budget, ORCH-1083).

import type { ThemeMotionLoaders } from "./types";

export const THEME_LOTTIE_LOADERS: ThemeMotionLoaders = {
  confetti: {
    intro: () => import("./lottie/confetti.intro.json").then(unwrap),
    loop: () => import("./lottie/confetti.loop.json").then(unwrap),
  },
  streamers: {
    intro: () => import("./lottie/streamers.intro.json").then(unwrap),
    loop: () => import("./lottie/streamers.loop.json").then(unwrap),
  },
  party_shapes: {
    intro: () => import("./lottie/party_shapes.intro.json").then(unwrap),
    loop: () => import("./lottie/party_shapes.loop.json").then(unwrap),
  },
  fireworks: {
    intro: () => import("./lottie/fireworks.intro.json").then(unwrap),
    loop: () => import("./lottie/fireworks.loop.json").then(unwrap),
  },
  balloons: {
    intro: () => import("./lottie/balloons.intro.json").then(unwrap),
    loop: () => import("./lottie/balloons.loop.json").then(unwrap),
  },
  bubbles: {
    intro: () => import("./lottie/bubbles.intro.json").then(unwrap),
    loop: () => import("./lottie/bubbles.loop.json").then(unwrap),
  },
  champagne: {
    intro: () => import("./lottie/champagne.intro.json").then(unwrap),
    loop: () => import("./lottie/champagne.loop.json").then(unwrap),
  },
  sparkles: {
    intro: () => import("./lottie/sparkles.intro.json").then(unwrap),
    loop: () => import("./lottie/sparkles.loop.json").then(unwrap),
  },
  glitter_shower: {
    intro: () => import("./lottie/glitter_shower.intro.json").then(unwrap),
    loop: () => import("./lottie/glitter_shower.loop.json").then(unwrap),
  },
  disco_glints: {
    intro: () => import("./lottie/disco_glints.intro.json").then(unwrap),
    loop: () => import("./lottie/disco_glints.loop.json").then(unwrap),
  },
  bokeh: {
    intro: () => import("./lottie/bokeh.intro.json").then(unwrap),
    loop: () => import("./lottie/bokeh.loop.json").then(unwrap),
  },
  golden_dust: {
    intro: () => import("./lottie/golden_dust.intro.json").then(unwrap),
    loop: () => import("./lottie/golden_dust.loop.json").then(unwrap),
  },
  shimmer_reveal: {
    intro: () => import("./lottie/shimmer_reveal.intro.json").then(unwrap),
    loop: () => import("./lottie/shimmer_reveal.loop.json").then(unwrap),
  },
  neon_pulse: {
    intro: () => import("./lottie/neon_pulse.intro.json").then(unwrap),
    loop: () => import("./lottie/neon_pulse.loop.json").then(unwrap),
  },
  snowfall: {
    intro: () => import("./lottie/snowfall.intro.json").then(unwrap),
    loop: () => import("./lottie/snowfall.loop.json").then(unwrap),
  },
  falling_petals: {
    intro: () => import("./lottie/falling_petals.intro.json").then(unwrap),
    loop: () => import("./lottie/falling_petals.loop.json").then(unwrap),
  },
  autumn_leaves: {
    intro: () => import("./lottie/autumn_leaves.intro.json").then(unwrap),
    loop: () => import("./lottie/autumn_leaves.loop.json").then(unwrap),
  },
  fireflies: {
    intro: () => import("./lottie/fireflies.intro.json").then(unwrap),
    loop: () => import("./lottie/fireflies.loop.json").then(unwrap),
  },
  rain: {
    intro: () => import("./lottie/rain.intro.json").then(unwrap),
    loop: () => import("./lottie/rain.loop.json").then(unwrap),
  },
  sun_rays: {
    intro: () => import("./lottie/sun_rays.intro.json").then(unwrap),
    loop: () => import("./lottie/sun_rays.loop.json").then(unwrap),
  },
  starry_sky: {
    intro: () => import("./lottie/starry_sky.intro.json").then(unwrap),
    loop: () => import("./lottie/starry_sky.loop.json").then(unwrap),
  },
  aurora: {
    intro: () => import("./lottie/aurora.intro.json").then(unwrap),
    loop: () => import("./lottie/aurora.loop.json").then(unwrap),
  },
  lanterns: {
    intro: () => import("./lottie/lanterns.intro.json").then(unwrap),
    loop: () => import("./lottie/lanterns.loop.json").then(unwrap),
  },
  embers: {
    intro: () => import("./lottie/embers.intro.json").then(unwrap),
    loop: () => import("./lottie/embers.loop.json").then(unwrap),
  },
  music_notes: {
    intro: () => import("./lottie/music_notes.intro.json").then(unwrap),
    loop: () => import("./lottie/music_notes.loop.json").then(unwrap),
  },
  hearts: {
    intro: () => import("./lottie/hearts.intro.json").then(unwrap),
    loop: () => import("./lottie/hearts.loop.json").then(unwrap),
  },
  love_burst: {
    intro: () => import("./lottie/love_burst.intro.json").then(unwrap),
    loop: () => import("./lottie/love_burst.loop.json").then(unwrap),
  },
  rose_petals: {
    intro: () => import("./lottie/rose_petals.intro.json").then(unwrap),
    loop: () => import("./lottie/rose_petals.loop.json").then(unwrap),
  },
  love_balloons: {
    intro: () => import("./lottie/love_balloons.intro.json").then(unwrap),
    loop: () => import("./lottie/love_balloons.loop.json").then(unwrap),
  },
};

function unwrap(mod: unknown): object {
  const m = mod as { default?: object };
  return m.default ?? (mod as object);
}
