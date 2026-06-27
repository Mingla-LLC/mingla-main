// @ts-nocheck
// META-ORCH-1233 Item 2 — inner-circle footer: Skip (0 friends) vs Continue (>=1
// friend). Skip path preserves skippedFriends resume/analytics intent; both paths
// call goNext; never disabled. Structural guard + i18n-presence assertions.
//
// Append-only / immutable. Run: `node <thisfile>`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FAILS_ON_REVERT_COMMIT = 'd1bc659ff524';

function resolveRepoFile(relPath) {
  const direct = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(direct)) return direct;
  return path.resolve(process.cwd(), 'app-mobile', relPath);
}
function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), 'utf8');
}
function readJson(relPath) {
  return JSON.parse(readSource(relPath));
}

function runItem2Test() {
  const src = readSource('src/components/OnboardingFlow.tsx');

  // Isolate the friends_and_pairing case block.
  const caseStart = src.indexOf("case 'friends_and_pairing':");
  assert.ok(caseStart !== -1, "Item2: case 'friends_and_pairing' must exist");
  const block = src.slice(caseStart, caseStart + 900);

  // 1. Label is conditional on a friend being in the list (length > 0).
  assert.match(
    block,
    /const\s+hasFriend\s*=\s*data\.addedFriends\.length\s*>\s*0/,
    'Item2: hasFriend must be data.addedFriends.length > 0',
  );
  assert.match(
    block,
    /label:\s*hasFriend\s*\?\s*t\('common:continue'\)\s*:\s*t\('common:skip'\)/,
    "Item2: label must be hasFriend ? common:continue : common:skip",
  );

  // 2. Never disabled, never hidden.
  assert.match(block, /disabled:\s*false/, 'Item2: must be disabled:false');
  assert.match(block, /hide:\s*false/, 'Item2: must be hide:false');

  // 3. Skip path sets skippedFriends:true; both paths call goNext().
  assert.match(
    block,
    /if\s*\(!hasFriend\)\s*\{[\s\S]*setData\(\(prev\)\s*=>\s*\(\{\s*\.\.\.prev,\s*skippedFriends:\s*true\s*\}\)\)/,
    'Item2: no-friend path must set skippedFriends:true',
  );
  assert.match(block, /goNext\(\)/, 'Item2: onPress must call goNext()');

  // 4. The Continue path must NOT set skippedFriends — assert setData is inside the
  //    !hasFriend guard only (one setData call in the block).
  const setDataCount = (block.match(/setData\(/g) || []).length;
  assert.equal(setDataCount, 1, 'Item2: exactly one setData (the skip-intent write) in the block');

  // 5. i18n: common:skip and common:continue must exist in EVERY locale (English values).
  const localesRoot = resolveRepoFile('src/i18n/locales');
  const langs = fs.readdirSync(localesRoot).filter((d) =>
    fs.existsSync(path.join(localesRoot, d, 'common.json')),
  );
  assert.ok(langs.length >= 29, `Item2: expected >=29 locales, found ${langs.length}`);
  for (const lang of langs) {
    const common = readJson(`src/i18n/locales/${lang}/common.json`);
    assert.equal(typeof common.skip, 'string', `Item2: ${lang} common.json must have a string "skip" key`);
    assert.ok(common.skip.length > 0, `Item2: ${lang} "skip" must be non-empty`);
    assert.equal(typeof common.continue, 'string', `Item2: ${lang} common.json must have a string "continue" key`);
  }
  const en = readJson('src/i18n/locales/en/common.json');
  assert.equal(en.skip, 'Skip', 'Item2: en common:skip === "Skip"');
  assert.equal(en.continue, 'Continue', 'Item2: en common:continue === "Continue"');
}

if (require.main === module) {
  try {
    runItem2Test();
    console.log(
      `PASS META-ORCH-1233 Item2 friends Skip/Continue regression; fails-on-revert anchor ${FAILS_ON_REVERT_COMMIT}`,
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runItem2Test };
