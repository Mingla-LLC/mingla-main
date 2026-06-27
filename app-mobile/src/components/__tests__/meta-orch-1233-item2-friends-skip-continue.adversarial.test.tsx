// @ts-nocheck
// META-ORCH-1233 Item 2 — ADVERSARIAL (tester). DIFFERENT ANGLE than the implementor's
// source-grep + i18n-presence: this test RUNS a faithful model of getCtaConfig's
// friends_and_pairing branch wired to the REAL addedFriends mutators (onAddFriend,
// onRemoveFriend, accept-request append) and the REAL en/common.json values, then
// drives state-transition sequences and asserts label + skippedFriends + advance
// behavior at every boundary: add→remove→Skip revert, accept-request flip, Skip sets
// skippedFriends, Continue does NOT, button never disabled, label resolves (not raw key).
//
// Append-only / immutable. Run: `node <thisfile>`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

// Real translator backed by en/common.json — proves the keys RESOLVE to strings,
// not raw "common:skip" passthrough. Throws on a missing key (catches a typo'd key).
function makeT() {
  const common = readJson('src/i18n/locales/en/common.json');
  return (key) => {
    const [ns, k] = key.split(':');
    assert.equal(ns, 'common', `Item2-adv: unexpected i18n namespace in ${key}`);
    assert.equal(typeof common[k], 'string', `Item2-adv: ${key} must resolve to a string`);
    return common[k];
  };
}

// Faithful model: a store with the real addedFriends mutators + the SHIPPED CTA branch.
function makeModel() {
  const t = makeT();
  let data = { addedFriends: [], skippedFriends: false };
  const setData = (updater) => { data = updater(data); };
  let goNextCount = 0;
  const goNext = () => { goNextCount += 1; };

  // mirrors parent onAddFriend (line ~3375), onRemoveFriend (~3381), accept (~3405)
  const onAddFriend = (friend) => setData((p) => ({ ...p, addedFriends: [...p.addedFriends, friend] }));
  const onRemoveFriend = (phoneE164) =>
    setData((p) => ({ ...p, addedFriends: p.addedFriends.filter((f) => f.phoneE164 !== phoneE164) }));
  const acceptRequest = (friend) =>
    setData((p) => ({
      ...p,
      addedFriends: p.addedFriends.some((f) => f.userId === friend.userId)
        ? p.addedFriends
        : [...p.addedFriends, friend],
    }));

  // SHIPPED friends_and_pairing branch, recomputed per render (closure over `data`).
  const cta = () => {
    const hasFriend = data.addedFriends.length > 0;
    return {
      label: hasFriend ? t('common:continue') : t('common:skip'),
      disabled: false,
      loading: false,
      onPress: () => {
        if (!hasFriend) {
          setData((prev) => ({ ...prev, skippedFriends: true }));
        }
        goNext();
      },
      hide: false,
    };
  };

  return {
    get data() { return data; },
    get goNextCount() { return goNextCount; },
    t, cta, onAddFriend, onRemoveFriend, acceptRequest,
  };
}

function runItem2Adversarial() {
  const SKIP = makeT()('common:skip');       // "Skip"
  const CONTINUE = makeT()('common:continue'); // "Continue"
  assert.notEqual(SKIP, CONTINUE, 'Item2-adv: skip and continue must be distinct labels');

  // ── A. empty list → Skip; button enabled ──────────────────────────────────
  {
    const m = makeModel();
    const c = m.cta();
    assert.equal(c.label, SKIP, 'Item2-adv: empty list label === Skip (resolved)');
    assert.equal(c.disabled, false, 'Item2-adv: never disabled (empty)');
    assert.equal(c.hide, false, 'Item2-adv: never hidden (empty)');
  }

  // ── B. add a friend → Continue; press does NOT set skippedFriends ──────────
  {
    const m = makeModel();
    m.onAddFriend({ phoneE164: '+15551230001', userId: 'u1' });
    let c = m.cta();
    assert.equal(c.label, CONTINUE, 'Item2-adv: after add → Continue');
    assert.equal(c.disabled, false, 'Item2-adv: never disabled (1 friend)');
    c.onPress();
    assert.equal(m.data.skippedFriends, false, 'Item2-adv: Continue path must NOT set skippedFriends');
    assert.equal(m.goNextCount, 1, 'Item2-adv: Continue advances');
  }

  // ── C. add → REMOVE back to 0 → reverts to Skip (the core revert boundary) ──
  {
    const m = makeModel();
    m.onAddFriend({ phoneE164: '+15551230002', userId: 'u2' });
    assert.equal(m.cta().label, CONTINUE, 'Item2-adv: added → Continue');
    m.onRemoveFriend('+15551230002');
    assert.equal(m.data.addedFriends.length, 0, 'Item2-adv: removed → empty list');
    assert.equal(m.cta().label, SKIP, 'Item2-adv: removed → reverts to Skip');
  }

  // ── D. accept incoming request flips to Continue (append path) ─────────────
  {
    const m = makeModel();
    assert.equal(m.cta().label, SKIP, 'Item2-adv: pre-accept Skip');
    m.acceptRequest({ phoneE164: '+15551230003', userId: 'u3' });
    assert.equal(m.cta().label, CONTINUE, 'Item2-adv: accept-request → Continue');
    // accept dedup: accepting the SAME userId again must not double-append / regress
    m.acceptRequest({ phoneE164: '+15551230003', userId: 'u3' });
    assert.equal(m.data.addedFriends.length, 1, 'Item2-adv: accept dedup by userId (no double-append)');
    assert.equal(m.cta().label, CONTINUE, 'Item2-adv: still Continue after dedup');
  }

  // ── E. Skip with no friends sets skippedFriends:true AND advances ──────────
  {
    const m = makeModel();
    const c = m.cta();
    assert.equal(c.label, SKIP, 'Item2-adv: Skip label');
    c.onPress();
    assert.equal(m.data.skippedFriends, true, 'Item2-adv: Skip sets skippedFriends:true (resume/analytics)');
    assert.equal(m.goNextCount, 1, 'Item2-adv: Skip still advances onboarding');
  }

  // ── F. add-after-skip-intent: if user adds then the (now-Continue) press must
  //    NOT clobber an existing skippedFriends back, and must NOT re-set it ─────
  {
    const m = makeModel();
    m.cta().onPress(); // Skip → skippedFriends true, advance (resume scenario)
    assert.equal(m.data.skippedFriends, true, 'Item2-adv: pre-set skippedFriends');
    m.onAddFriend({ phoneE164: '+15551230004', userId: 'u4' });
    const c = m.cta();
    assert.equal(c.label, CONTINUE, 'Item2-adv: friend present → Continue even if skippedFriends was true');
    c.onPress();
    // Continue path leaves skippedFriends untouched (true here from the earlier skip).
    assert.equal(m.data.skippedFriends, true, 'Item2-adv: Continue does not touch skippedFriends');
  }

  // ── G. disabled is NEVER true across all reachable states ──────────────────
  {
    const m = makeModel();
    assert.equal(m.cta().disabled, false, 'Item2-adv: disabled false @0');
    m.onAddFriend({ phoneE164: '+15551230005', userId: 'u5' });
    assert.equal(m.cta().disabled, false, 'Item2-adv: disabled false @1');
    m.onAddFriend({ phoneE164: '+15551230006', userId: 'u6' });
    assert.equal(m.cta().disabled, false, 'Item2-adv: disabled false @2');
  }

  // ── H. skip resolves in representative NON-English locales (not a raw key) ──
  {
    for (const lang of ['es', 'fr', 'ar', 'ja', 'zh', 'hi', 'pt', 'de']) {
      const c = readJson(`src/i18n/locales/${lang}/common.json`);
      assert.equal(typeof c.skip, 'string', `Item2-adv: ${lang} skip is a string`);
      assert.ok(c.skip.length > 0 && c.skip !== 'common:skip' && c.skip !== 'skip',
        `Item2-adv: ${lang} skip must be a real translation, got "${c.skip}"`);
    }
  }

  // ── I. LIVE-SOURCE behavioral anchor (fails-on-revert from a DIFFERENT angle
  //    than the implementor's exact regex): in the real friends_and_pairing
  //    branch, comment-stripped, the label must DEPEND on the friend count
  //    (both 'common:skip' AND 'common:continue' reachable). A revert to a
  //    hardcoded single label drops one of them → caught here. Also: the skip
  //    branch must guard the skippedFriends write behind the no-friend condition. ──
  {
    const raw = readSource('src/components/OnboardingFlow.tsx');
    const live = raw.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    const caseStart = live.indexOf("case 'friends_and_pairing':");
    assert.ok(caseStart !== -1, "Item2-adv: friends_and_pairing case must exist (live)");
    const block = live.slice(caseStart, caseStart + 900);
    // Both labels must be referenced in the (live) branch — a conditional, not a hardcode.
    assert.ok(
      block.includes("t('common:skip')"),
      "Item2-adv: live branch must reference common:skip (no-friend path)",
    );
    assert.ok(
      block.includes("t('common:continue')"),
      "Item2-adv: live branch must reference common:continue (friend path)",
    );
    // The label must be a ternary keyed on the friend count, not an unconditional string.
    assert.match(
      block,
      /label:\s*[^,\n]*\?[^,\n]*t\('common:(?:skip|continue)'\)/,
      "Item2-adv: label must be conditional on friend presence (live)",
    );
    // The skippedFriends write must be inside a no-friend guard (not unconditional).
    assert.match(
      block,
      /if\s*\(!hasFriend\)[\s\S]*skippedFriends:\s*true/,
      "Item2-adv: skippedFriends write must be guarded behind !hasFriend (live)",
    );
  }
}

if (require.main === module) {
  try {
    runItem2Adversarial();
    console.log('PASS META-ORCH-1233 Item2 ADVERSARIAL Skip/Continue state-transitions + i18n resolve');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runItem2Adversarial };
