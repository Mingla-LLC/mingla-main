// @ts-nocheck
// META-ORCH-1233 Item 3 — Discover Events/Trips spotlight pill must be positioned
// in the capsule padding-box coordinate space: targetX adds tabs1016Row's
// paddingHorizontal so the pill aligns to the active tab and stops overhanging the
// neighbor. Computable targetX math + drift sentinel (constant == style padding).
//
// Append-only / immutable. Run: `node <thisfile>`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FAILS_ON_REVERT_COMMIT = '7eb6cd00a69b';

function resolveRepoFile(relPath) {
  const direct = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(direct)) return direct;
  return path.resolve(process.cwd(), 'app-mobile', relPath);
}
function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), 'utf8');
}

function runItem3Test() {
  const src = readSource('src/components/DiscoverScreen.tsx');

  // 1. The named row-padding constant exists at module scope.
  const constMatch = src.match(/const\s+TABS_1016_ROW_PADDING_H\s*=\s*(\d+)\s*;/);
  assert.ok(constMatch, 'Item3: TABS_1016_ROW_PADDING_H must be a module-scope const');
  const constValue = Number(constMatch[1]);
  assert.equal(constValue, 4, 'Item3: TABS_1016_ROW_PADDING_H must equal 4');

  // 2. targetX must add the row padding (coordinate-space fix), spotlightInset kept.
  assert.match(
    src,
    /const\s+targetX\s*=\s*TABS_1016_ROW_PADDING_H\s*\+\s*layout\.x\s*\+\s*cc\.nav\.spotlightInset;/,
    'Item3: targetX must be TABS_1016_ROW_PADDING_H + layout.x + cc.nav.spotlightInset',
  );

  // 3. targetWidth unchanged (full tab width minus 2*inset).
  assert.match(
    src,
    /const\s+targetWidth\s*=\s*layout\.width\s*-\s*cc\.nav\.spotlightInset\s*\*\s*2;/,
    'Item3: targetWidth must remain layout.width - inset*2 (unchanged)',
  );

  // 4. Drift sentinel: the constant MUST equal styles.tabs1016Row.paddingHorizontal.
  const rowStyleMatch = src.match(/tabs1016Row:\s*\{[\s\S]*?paddingHorizontal:\s*(\d+)/);
  assert.ok(rowStyleMatch, 'Item3: styles.tabs1016Row.paddingHorizontal must exist');
  const stylePadding = Number(rowStyleMatch[1]);
  assert.equal(
    constValue,
    stylePadding,
    `Item3 DRIFT: TABS_1016_ROW_PADDING_H (${constValue}) must equal tabs1016Row.paddingHorizontal (${stylePadding})`,
  );

  // 5. Computable targetX math (spec happy-path): tab layout {x:155,width:155},
  //    spotlightInset:0 -> targetX === 159, targetWidth === 155.
  const spotlightInset = 0;
  const layout = { x: 155, width: 155 };
  const computedTargetX = constValue + layout.x + spotlightInset;
  const computedTargetWidth = layout.width - spotlightInset * 2;
  assert.equal(computedTargetX, 159, 'Item3 math: targetX === 4 + 155 + 0 === 159');
  assert.equal(computedTargetWidth, 155, 'Item3 math: targetWidth === 155 (unchanged)');

  // 6. Events-active case: x=0 -> targetX === 4 (4px gutter respected).
  assert.equal(constValue + 0 + 0, 4, 'Item3 math: Events (x=0) -> targetX === 4');
}

if (require.main === module) {
  try {
    runItem3Test();
    console.log(
      `PASS META-ORCH-1233 Item3 spotlight geometry regression; fails-on-revert anchor ${FAILS_ON_REVERT_COMMIT}`,
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runItem3Test };
