# @mingla/theme-animations

The theme "Motion" axis for public brand, event, experience and trip pages
(ORCH-0964; rebuilt for issue #1023).

Each of the 29 slugs has two generated Lottie files in `lottie/`:

- `<slug>.intro.json`: the 2.6 s entrance, played once on every visit;
- `<slug>.loop.json`: a seamless ambient loop (6 s; 12 s for `aurora`,
  `disco_glints` and `sun_rays`) that plays after the entrance while the page
  is open.

All artwork is drawn by the generator from shapes. No third-party images,
fonts or downloaded assets are used.

## Regenerate

```bash
cd packages/theme-animations
npm run generate            # all slugs
node scripts/generate-lottie.mjs confetti hearts   # just some
```

The generator is deterministic (seeded per slug and phase), so a re-run with
no source change produces byte-identical files. It prints each file's size and
fails if any file is over 150 KB.

## Brand colour

Brand-following colours are named slots: fills and strokes named `c0`…`c5`
(the reference palette `pal(0…5)`), `d0`/`d2` (`palDark`), and gradients named
`g|<slot>|…` per stop. `buildThemeMotionPalette(color, color2?)` ports the
reference palette and `tintLottie(json, palette)` returns a memoised tinted
copy. Love animations also use fixed love reds (`fx`).

## Loading

`loadThemeLottie(slug, phase)` loads one file. Native uses `require` inside a
function; web uses `import()` so each file is its own chunk and nothing lands
in the eager web bundle.
