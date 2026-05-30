# ORCH-1008 — Phase 4 QA Evidence

**Status:** code-grade — headless browser screenshots blocked by an anchor-side `mingla-admin/node_modules` Tailwind drift (the symlinked `@tailwindcss/vite` expects an export `compile` from `@tailwindcss/node` that the installed version does not provide). `npm install` is dispatch-forbidden; the operator must run the dev server themselves to generate live screenshots after the merge.

What this folder DOES contain:

1. `phase4_light.html` + `phase4_dark.html` — static DOM proof. Each file inlines the relevant CSS-var tokens from `mingla-admin/src/globals.css`, then re-renders the three most distinctive Phase 4 surfaces with the exact class lists used in the React components (segmented mode picker, status-grouped run history headers + group rows, Q2 reasoning card). Verifies that every token resolves cleanly in both themes and that the bucket-tier color ladder is legible.
2. `light_overview_tab.html` + `dark_overview_tab.html` — static DOM proof for the new IntelligenceOverviewTab: 4 aggregate tiles + per-city coverage table with progress bar + Run remainder CTA per row.
3. `theme_token_audit.md` — contrast-ratio table for every color pair the Phase 4 design introduces (computed mathematically using the formulae in WCAG 2.1 §1.4.3).

How to view live screenshots once the operator can run the dev server:
```
cd mingla-admin && npm install && npm run dev
# open http://localhost:5173/#/place-intelligence-trial
# toggle theme via Settings → Theme; capture both states
```
