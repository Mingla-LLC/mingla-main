// WCAG 2.x relative-luminance contrast for ORCH-1384 design pairs.
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [l1, l2] = [L(a), L(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
const over = (fg, a, bg) => fg.map((c, i) => a * c + (1 - a) * bg[i]); // src-over composite
const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// Surfaces
const canvas = hex('#0c0e12');
const cardBase = over([255,255,255], 0.04, canvas);           // glass.tint.profileBase over canvas
const cardElev = over([255,255,255], 0.06, canvas);           // glass.tint.profileElevated over canvas
const sheetPanel = over([255,255,255], 0.06, over(hex('#14161a'), 0.92, canvas)); // sheet fallback + tint
const dangerCard = over(hex('#ef4444'), 0.08, sheetPanel);    // rgba(239,68,68,0.08) card on sheet
const accentPillBase = over(hex('#eb7825'), 0.16, cardBase);  // rolePill bg on team row
const accentPillSheet = over(hex('#eb7825'), 0.16, sheetPanel);
const warnBtn = hex('#ef4444');   // Button destructive fill
const primBtn = hex('#eb7825');   // Button primary fill

// Text composites (white at alpha over surface)
const t = (a, s) => over([255,255,255], a, s);

const rows = [
  ['text.primary (.96w) on cardElev',           t(0.96, cardElev), cardElev],
  ['text.primary (.96w) on sheetPanel',         t(0.96, sheetPanel), sheetPanel],
  ['text.secondary (.72w) on cardElev',         t(0.72, cardElev), cardElev],
  ['text.secondary (.72w) on cardBase',         t(0.72, cardBase), cardBase],
  ['text.secondary (.72w) on sheetPanel',       t(0.72, sheetPanel), sheetPanel],
  ['text.tertiary (.52w) on cardElev',          t(0.52, cardElev), cardElev],
  ['text.tertiary (.52w) on cardBase',          t(0.52, cardBase), cardBase],
  ['text.tertiary (.52w) on sheetPanel',        t(0.52, sheetPanel), sheetPanel],
  ['text.tertiary (.52w) on canvas',            t(0.52, canvas), canvas],
  ['text.quaternary (.32w) on cardBase  [FAIL expected]', t(0.32, cardBase), cardBase],
  ['accent.warm #eb7825 on cardBase (dot, UI >=3:1)',  hex('#eb7825'), cardBase],
  ['accent.warm on accent pill bg (badge text)', hex('#eb7825'), accentPillBase],
  ['accent.warm on accent pill bg (sheet)',      hex('#eb7825'), accentPillSheet],
  ['semantic.error #ef4444 on cardBase (dot/expired, UI >=3:1)', hex('#ef4444'), cardBase],
  ['semantic.error on sheetPanel (error text)',  hex('#ef4444'), sheetPanel],
  ['semantic.error on dangerCard (reject title)',hex('#ef4444'), dangerCard],
  ['semantic.warning #f59e0b on cardBase (dot)', hex('#f59e0b'), cardBase],
  ['semantic.success #22c55e on cardBase (dot)', hex('#22c55e'), cardBase],
  ['white on Button destructive #ef4444 [house primitive]', [255,255,255], warnBtn],
  ['white on Button primary #eb7825 [house primitive]',     [255,255,255], primBtn],
  ['text.secondary (.72w) on dangerCard (reject body)', t(0.72, dangerCard), dangerCard],
  ['text.primary (.96w) on dangerCard',          t(0.96, dangerCard), dangerCard],
  ['placeholder quaternary (.32w) on input on sheetPanel [non-essential]', t(0.32, over([255,255,255],0.04,sheetPanel)), over([255,255,255],0.04,sheetPanel)],
];
const fmtc = (c) => '#' + c.map(v => Math.round(v).toString(16).padStart(2,'0')).join('');
for (const [name, fg, bg] of rows) {
  console.log(`${ratio(fg, bg).toFixed(2)}:1  ${name}  [fg≈${fmtc(fg)} on bg≈${fmtc(bg)}]`);
}
const badgeBase = over(hex('#eb7825'), 0.28, cardBase);   // accent.tint over team row card
const badgeSheet = over(hex('#eb7825'), 0.28, sheetPanel); // accent.tint over sheet panel
console.log(`${ratio(t(0.96,badgeBase), badgeBase).toFixed(2)}:1  text.primary on Mingla-Partner badge (team row)  [bg≈${fmtc(badgeBase)}]`);
console.log(`${ratio(t(0.96,badgeSheet), badgeSheet).toFixed(2)}:1  text.primary on Mingla-Partner badge (sheet)  [bg≈${fmtc(badgeSheet)}]`);
console.log(`${ratio(t(0.52,cardBase), cardBase).toFixed(2)}:1  cancelled StatusDot tertiary on cardBase (UI >=3:1)`);
