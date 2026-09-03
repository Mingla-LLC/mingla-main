# Self-hosted webfonts

These are served from the site's own origin, not from Google Fonts.

**Why self-hosted.** The runtime's CSP is `default-src 'self'` with no font
host, so a `fonts.googleapis.com` stylesheet would fail silently and fall back —
which is exactly what was happening. Relaxing the CSP was the alternative and is
worse: it would put a third-party request on every customer's website, on a
product whose analytics are consent-gated. A font that phones home is not a
neutral default.

**Licence.** Oswald, Plus Jakarta Sans and Playfair Display are all SIL Open
Font License 1.1, which permits self-hosting and redistribution provided the
licence travels with the files. `OFL.txt` is that licence.

**Subsets.** `latin` and `latin-ext` only. Shipping every subset would roughly
triple the payload for glyphs these sites never render. If a brand needs another
script, add that subset rather than switching to a CDN.

**Weights.** Deliberately few — two per display face, three for the body face.
Every extra weight is another request on a Lagos data plan for a difference most
readers will not notice.
