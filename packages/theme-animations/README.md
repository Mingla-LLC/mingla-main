# @mingla/theme-animations

ORCH-0964 entrance-animation assets for public brand and event theming.

All nine Lottie JSON files in `lottie/` are generated in-house for Mingla from distinct vector celebrations: confetti pieces, firework bursts, balloons with strings, sparkle stars, glitter shards, snowflakes, petals, hearts, and shimmer sweeps. They do not include third-party images, fonts, or externally sourced artwork. Runtime rendering preserves the original colors inside each Lottie file; the selected brand color styles the surrounding page, not the celebration artwork.

Animation selection is data-driven: the saved brand or event `theme_animation` slug is resolved by `@mingla/event-rendering` and then used as the key into `LOTTIE_BY_SLUG`.

Animation slugs:

- `confetti`
- `fireworks`
- `balloons`
- `sparkles`
- `glitter_shower`
- `snowfall`
- `falling_petals`
- `hearts`
- `shimmer_reveal`
