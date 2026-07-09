#!/usr/bin/env node
/**
 * ORCH-1327 [links tab switcher swing].
 * Invariant: I-PROPOSED-1327-LINKS-TAB-PERSISTENT-PILL.
 *
 * Over mingla-marketing/components/marketing/links-experience.tsx
 * (comment-stripped) the Explorer/Business segmented switcher renders its
 * active-tab highlight as ONE persistent, absolutely-positioned `bg-warm` pill
 * that animates its horizontal `x` between the two equal-width slots — NOT the
 * old conditionally-mounted framer shared-layout (`layoutId`) pill whose
 * mount/unmount forced a cross-instance layout projection that swung the pill in
 * a diagonal ARC (INVESTIGATION_ORCH-1326_1327 §2).
 *
 * REQUIRE (comment-stripped):
 *   1. role="tablist" AND role="tab"                          (still a tablist)
 *   2. aria-selected={ AND tabIndex={selected ? 0 : -1}       (roving tabindex)
 *   3. onTabKeyDown referenced AND ArrowRight AND ArrowLeft    (arrow-key nav)
 *   4. initial={false} AND animate={{ x: AND bg-warm          (the sliding pill)
 *   5. `reduced` AND `duration: 0`                            (reduced-motion)
 *   6. text-white AND text-white/60                           (color states)
 *
 * BAN (regression):
 *   - `layoutId`  — the mount/unmount shared-pill projection must never return
 *                   (the CORE swing guard).
 *   - a `motion.span`/`motion.div` nested inside a `selected ?` ternary — i.e. a
 *     conditionally-mounted pill (the shape that caused the swing).
 *
 * --self-test injects fixtures (compliant → pass; each violation → fire).
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const TARGET = "mingla-marketing/components/marketing/links-experience.tsx";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function checkSwitcher(rawSrc, failures) {
  const src = stripComments(rawSrc);

  // 1. still an ARIA tablist.
  if (!/role="tablist"/.test(src) || !/role="tab"/.test(src)) {
    failures.push(`${TARGET}: must keep role="tablist" AND role="tab" (the WAI-ARIA tablist).`);
  }

  // 2. roving tabindex preserved.
  if (!/aria-selected=\{/.test(src)) {
    failures.push(`${TARGET}: must keep aria-selected={…} on each tab.`);
  }
  if (!/tabIndex=\{selected \? 0 : -1\}/.test(src)) {
    failures.push(`${TARGET}: must keep the roving tabIndex={selected ? 0 : -1}.`);
  }

  // 3. arrow-key navigation preserved.
  if (!/onTabKeyDown/.test(src)) {
    failures.push(`${TARGET}: must keep the onTabKeyDown handler (arrow-key nav).`);
  }
  if (!/ArrowRight/.test(src) || !/ArrowLeft/.test(src)) {
    failures.push(`${TARGET}: must handle BOTH ArrowRight and ArrowLeft (roving nav).`);
  }

  // 4. the persistent sliding pill.
  if (!/initial=\{false\}/.test(src)) {
    failures.push(`${TARGET}: the highlight pill must be persistent (initial={false}, not mount-animated).`);
  }
  if (!/animate=\{\{ x:/.test(src)) {
    failures.push(`${TARGET}: the pill must animate its horizontal position (animate={{ x: … }}).`);
  }
  if (!/bg-warm/.test(src)) {
    failures.push(`${TARGET}: the highlight pill must keep the bg-warm fill.`);
  }

  // 5. reduced-motion honored (instant reposition).
  if (!/reduced/.test(src) || !/\{ duration: 0 \}/.test(src)) {
    failures.push(`${TARGET}: reduced motion must snap the pill instantly (a { duration: 0 } transition tied to \`reduced\`).`);
  }

  // 6. color states unchanged.
  if (!/text-white/.test(src) || !/text-white\/60/.test(src)) {
    failures.push(`${TARGET}: the active/inactive color states (text-white / text-white/60) must survive.`);
  }

  // BAN — the shared-layout projection must never come back.
  if (/layoutId/.test(src)) {
    failures.push(`${TARGET}: contains \`layoutId\` — the mount/unmount shared-pill projection (the swing) is banned; use ONE persistent x-animated pill.`);
  }
  // BAN — a motion element conditionally mounted inside a `selected ?` ternary.
  if (/\bselected\s*\?\s*\(?\s*<motion\.(span|div)/.test(src)) {
    failures.push(`${TARGET}: a motion element is conditionally mounted inside a \`selected ?\` ternary — the per-tab mount/unmount pill is banned (it re-introduces the swing).`);
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const run = (s) => { const f = []; checkSwitcher(s, f); return f; };

  const good = `
const onTabKeyDown = (e, index) => {
  switch (e.key) {
    case 'ArrowRight': case 'ArrowDown': break
    case 'ArrowLeft': case 'ArrowUp': break
    case 'Home': break
    case 'End': break
    default: return
  }
}
<div role="tablist" className="relative glass-soft flex gap-1 rounded-full p-1">
  <motion.div
    aria-hidden="true"
    className="pointer-events-none absolute left-1 top-1 h-11 rounded-full bg-warm"
    style={{ width: 'calc(50% - 0.375rem)' }}
    initial={false}
    animate={{ x: \`calc(\${activeIndex} * (100% + 0.25rem))\` }}
    transition={reduced ? { duration: 0 } : { type: 'tween', duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
  />
  {LINKS_TABS.map((tab, i) => {
    const selected = tab.id === activeId
    return (
      <button
        role="tab"
        aria-selected={selected}
        tabIndex={selected ? 0 : -1}
        onKeyDown={(e) => onTabKeyDown(e, i)}
        className={cn('relative', selected ? 'text-white' : 'text-white/60 hover:text-white/85')}
      >
        <span className="relative z-10">{tab.label}</span>
      </button>
    )
  })}
</div>
`;
  if (run(good).length !== 0) selfFailures.push("compliant switcher wrongly flagged: " + JSON.stringify(run(good)));

  // layoutId re-added → fire.
  const withLayout = good.replace(
    "initial={false}",
    'layoutId="links-tab-pill"\n    initial={false}',
  );
  if (run(withLayout).length === 0) selfFailures.push("re-added layoutId not flagged");

  // Conditionally-mounted motion pill inside a `selected ?` ternary → fire.
  const condMount = good.replace(
    "<span className=\"relative z-10\">{tab.label}</span>",
    "{selected ? (<motion.span className=\"absolute inset-0 rounded-full bg-warm\" />) : null}<span className=\"relative z-10\">{tab.label}</span>",
  );
  if (run(condMount).length === 0) selfFailures.push("conditionally-mounted motion pill not flagged");

  // Missing initial={false} (pill no longer persistent) → fire.
  const noInitial = good.replace("initial={false}", "");
  if (run(noInitial).length === 0) selfFailures.push("missing initial={false} not flagged");

  // Missing roving tabIndex → fire.
  const noRoving = good.replace("tabIndex={selected ? 0 : -1}", "tabIndex={0}");
  if (run(noRoving).length === 0) selfFailures.push("missing roving tabIndex not flagged");

  // Missing reduced/duration:0 branch → fire.
  const noReduced = good.replace(/transition=\{reduced \? \{ duration: 0 \} : \{ type: 'tween', duration: 0.18, ease: \[0.4, 0, 0.2, 1\] \}\}/, "transition={{ type: 'tween', duration: 0.18, ease: [0.4, 0, 0.2, 1] }}");
  if (run(noReduced).length === 0) selfFailures.push("missing reduced/duration:0 not flagged");

  // Missing ArrowLeft → fire.
  const noArrowLeft = good.replace(/ArrowLeft/g, "SomethingElse");
  if (run(noArrowLeft).length === 0) selfFailures.push("missing ArrowLeft not flagged");

  // A `layoutId` token inside a COMMENT must be stripped → compliant still passes.
  const commented = good + "\n// legacy note: the old layoutId pill is gone\n/* no more layoutId here */\n";
  if (run(commented).length !== 0) selfFailures.push("commented layoutId wrongly flagged (comment-strip broken)");

  if (selfFailures.length) {
    console.error("ORCH-1327 links-tab-switcher-persistent-pill self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("ORCH-1327 links-tab-switcher-persistent-pill self-test PASS (8/8 cases).");
  process.exit(0);
}

// ---- Live mode
const abs = path.join(root, TARGET);
if (!fs.existsSync(abs)) {
  console.error(`ORCH-1327 FAIL — target not found at ${TARGET} (switcher missing).`);
  process.exit(1);
}
const failures = [];
checkSwitcher(fs.readFileSync(abs, "utf8"), failures);

if (failures.length > 0) {
  console.error(
    "ORCH-1327 (I-PROPOSED-1327-LINKS-TAB-PERSISTENT-PILL) FAIL — the /links tab\n" +
      "switcher must render its highlight as ONE persistent, x-animated bg-warm pill\n" +
      "(no layoutId, no per-tab mount/unmount), preserving reduced-motion + the\n" +
      "roving-tabindex a11y + the color states.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1327 PASS — the /links tab switcher uses ONE persistent x-animated bg-warm\n" +
    "pill (no layoutId / mount-unmount swing), reduced-motion + roving-tabindex a11y\n" +
    "+ color states preserved.",
);
