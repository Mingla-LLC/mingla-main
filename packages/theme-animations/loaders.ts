// issue #1023 — lazy loaders for the generated theme-motion Lottie files (native).
// One entry per slug and phase so a page only ever loads the two files it
// shows. Regenerate the JSON with `npm run generate` in this package; keep
// this list in step with THEME_ANIMATION_SLUGS (a test checks both).
//
// Native: `require` inside a function. Metro registers every file but only
// evaluates (parses) the one a mount asks for.

import type { ThemeMotionLoaders } from "./types";

/* eslint-disable @typescript-eslint/no-require-imports */
export const THEME_LOTTIE_LOADERS: ThemeMotionLoaders = {
  confetti: {
    intro: async () => require("./lottie/confetti.intro.json") as object,
    loop: async () => require("./lottie/confetti.loop.json") as object,
  },
  streamers: {
    intro: async () => require("./lottie/streamers.intro.json") as object,
    loop: async () => require("./lottie/streamers.loop.json") as object,
  },
  party_shapes: {
    intro: async () => require("./lottie/party_shapes.intro.json") as object,
    loop: async () => require("./lottie/party_shapes.loop.json") as object,
  },
  fireworks: {
    intro: async () => require("./lottie/fireworks.intro.json") as object,
    loop: async () => require("./lottie/fireworks.loop.json") as object,
  },
  balloons: {
    intro: async () => require("./lottie/balloons.intro.json") as object,
    loop: async () => require("./lottie/balloons.loop.json") as object,
  },
  bubbles: {
    intro: async () => require("./lottie/bubbles.intro.json") as object,
    loop: async () => require("./lottie/bubbles.loop.json") as object,
  },
  champagne: {
    intro: async () => require("./lottie/champagne.intro.json") as object,
    loop: async () => require("./lottie/champagne.loop.json") as object,
  },
  sparkles: {
    intro: async () => require("./lottie/sparkles.intro.json") as object,
    loop: async () => require("./lottie/sparkles.loop.json") as object,
  },
  glitter_shower: {
    intro: async () => require("./lottie/glitter_shower.intro.json") as object,
    loop: async () => require("./lottie/glitter_shower.loop.json") as object,
  },
  disco_glints: {
    intro: async () => require("./lottie/disco_glints.intro.json") as object,
    loop: async () => require("./lottie/disco_glints.loop.json") as object,
  },
  bokeh: {
    intro: async () => require("./lottie/bokeh.intro.json") as object,
    loop: async () => require("./lottie/bokeh.loop.json") as object,
  },
  golden_dust: {
    intro: async () => require("./lottie/golden_dust.intro.json") as object,
    loop: async () => require("./lottie/golden_dust.loop.json") as object,
  },
  shimmer_reveal: {
    intro: async () => require("./lottie/shimmer_reveal.intro.json") as object,
    loop: async () => require("./lottie/shimmer_reveal.loop.json") as object,
  },
  neon_pulse: {
    intro: async () => require("./lottie/neon_pulse.intro.json") as object,
    loop: async () => require("./lottie/neon_pulse.loop.json") as object,
  },
  snowfall: {
    intro: async () => require("./lottie/snowfall.intro.json") as object,
    loop: async () => require("./lottie/snowfall.loop.json") as object,
  },
  falling_petals: {
    intro: async () => require("./lottie/falling_petals.intro.json") as object,
    loop: async () => require("./lottie/falling_petals.loop.json") as object,
  },
  autumn_leaves: {
    intro: async () => require("./lottie/autumn_leaves.intro.json") as object,
    loop: async () => require("./lottie/autumn_leaves.loop.json") as object,
  },
  fireflies: {
    intro: async () => require("./lottie/fireflies.intro.json") as object,
    loop: async () => require("./lottie/fireflies.loop.json") as object,
  },
  rain: {
    intro: async () => require("./lottie/rain.intro.json") as object,
    loop: async () => require("./lottie/rain.loop.json") as object,
  },
  sun_rays: {
    intro: async () => require("./lottie/sun_rays.intro.json") as object,
    loop: async () => require("./lottie/sun_rays.loop.json") as object,
  },
  starry_sky: {
    intro: async () => require("./lottie/starry_sky.intro.json") as object,
    loop: async () => require("./lottie/starry_sky.loop.json") as object,
  },
  aurora: {
    intro: async () => require("./lottie/aurora.intro.json") as object,
    loop: async () => require("./lottie/aurora.loop.json") as object,
  },
  lanterns: {
    intro: async () => require("./lottie/lanterns.intro.json") as object,
    loop: async () => require("./lottie/lanterns.loop.json") as object,
  },
  embers: {
    intro: async () => require("./lottie/embers.intro.json") as object,
    loop: async () => require("./lottie/embers.loop.json") as object,
  },
  music_notes: {
    intro: async () => require("./lottie/music_notes.intro.json") as object,
    loop: async () => require("./lottie/music_notes.loop.json") as object,
  },
  hearts: {
    intro: async () => require("./lottie/hearts.intro.json") as object,
    loop: async () => require("./lottie/hearts.loop.json") as object,
  },
  love_burst: {
    intro: async () => require("./lottie/love_burst.intro.json") as object,
    loop: async () => require("./lottie/love_burst.loop.json") as object,
  },
  rose_petals: {
    intro: async () => require("./lottie/rose_petals.intro.json") as object,
    loop: async () => require("./lottie/rose_petals.loop.json") as object,
  },
  love_balloons: {
    intro: async () => require("./lottie/love_balloons.intro.json") as object,
    loop: async () => require("./lottie/love_balloons.loop.json") as object,
  },
};
