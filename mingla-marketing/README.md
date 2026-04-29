# Mingla Marketing — `mingla-marketing/`

Three subdomain-routed marketing sites in **one Next.js 15 codebase**:

| Subdomain | Zone | Audience |
|---|---|---|
| `usemingla.com` | `umbrella` | Anyone — the Mingla story |
| `explore.usemingla.com` | `explore` | Consumers / Explorers |
| `business.usemingla.com` | `business` | Operators / Organisers |

## Run locally

```bash
cd mingla-marketing
npm install
npm run dev
```

Then open all three subdomains in your browser. Chrome resolves `*.localhost` automatically:

- http://localhost:3000 → umbrella zone
- http://explore.localhost:3000 → explore zone (audience switcher: **Explorers** active)
- http://business.localhost:3000 → business zone (audience switcher: **Organisers** active)

**Safari users:** Safari does NOT auto-resolve `*.localhost`. Add this to `/etc/hosts`:

```
127.0.0.1   explore.localhost
127.0.0.1   business.localhost
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start dev server on port 3000 |
| `npm run build` | Production build |
| `npm start` | Run production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | Next.js ESLint |

## How subdomain routing works

`src/middleware.ts` reads the `host` header on every request, maps it to a zone (`umbrella` / `explore` / `business`), then rewrites the URL to `/sites/[zone]/...`. The user sees clean URLs (`/`, `/about`, etc.) at each subdomain — the `/sites/[zone]` segment is internal.

The `src/app/sites/[zone]/` directories hold zone-specific layouts and pages. **Note:** the folder is `sites/`, NOT `_sites/`. Underscore-prefixed folders in App Router are PRIVATE (not routable) — pages inside won't compile as routes. The audience switcher in `Nav.tsx` reads the active zone via `getZoneFromHeaders()` and highlights the matching pill.

## Design tokens

All visual values are ported from `app-mobile/src/constants/designSystem.ts` and live in two co-owned files:

- `src/styles/tokens.css` — CSS custom properties (source of truth for static styling)
- `src/lib/tokens.ts` — JS mirror (for Framer Motion + runtime-evaluated styles)

When a value changes, **both files must be updated**. Constitutional #2: one owner per truth. Components consume tokens via:

- Tailwind utilities exposed by the `@theme` bridge in `globals.css` (e.g. `bg-mingla-accent`, `rounded-mingla-xl`, `p-mingla-md`)
- CSS variables (`var(--mingla-accent)`)
- JS imports (`import { colors } from '@/lib/tokens'`)

Never hardcode color/spacing/radius values in components.

## Fonts

- **Fraunces** (Google Fonts, free) — editorial serif for headlines
- **Inter** (Google Fonts, free) — sans for body

Loaded via `next/font/google` in `app/layout.tsx`. Both expose CSS variables (`--font-fraunces`, `--font-inter`) consumed by the `@theme` bridge.

## What's next — Phase 2

Phase 1 ships only the empty shell. Hero areas across all three zones are explicitly placeholder slots labeled `<HERO PLACEHOLDER — PHASE X>`.

**Phase 2** wires the umbrella site's hero with the cinematic ecosystem story (restaurant builds AI menu → organiser creates event → explorer finds the perfect place → punchline) using the wired MCP tools:

- **Stitch MCP** — UI mockups for in-story scene compositions
- **Nano Banana** (Gemini 3 Pro Image / 2.5 Flash Image) — real-people cinematic stills
- **Veo 3** — 4-6 stitched 8-second video clips with synchronised audio
- **21st.dev Magic** — premium React component generation
- **ui-ux-pro-max** skill — design intelligence layer

Phase 2 prompt will be written by the orchestrator after Phase 1 PASS.
