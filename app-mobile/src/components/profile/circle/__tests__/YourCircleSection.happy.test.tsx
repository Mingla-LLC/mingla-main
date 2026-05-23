// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../../../../..');
const simulateRowMajor = process.env.ORCH0933_SIMULATE_ROW_MAJOR === '1';

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function chunkColumnMajor(people) {
  return people.reduce((columns, person, index) => {
    const columnIndex = simulateRowMajor ? index % 3 : Math.floor(index / 3);
    const rowIndex = simulateRowMajor ? Math.floor(index / 3) : index % 3;
    if (!columns[columnIndex]) columns[columnIndex] = [];
    columns[columnIndex][rowIndex] = person;
    return columns;
  }, []);
}

function runYourCircleSectionHappyTest() {
  const people = [
    { userId: 'u1', displayName: 'Alice', tier: 'close', hasBusinessApp: false },
    { userId: 'u2', displayName: 'Bob', tier: 'close', hasBusinessApp: false },
    { userId: 'u3', displayName: 'Carol', tier: 'close', hasBusinessApp: false },
    { userId: 'u4', displayName: 'Dan', tier: 'friend', hasBusinessApp: false },
    { userId: 'u5', displayName: 'Eve', tier: 'friend', hasBusinessApp: true },
    { userId: 'u6', displayName: 'Frank', tier: 'extended', hasBusinessApp: false },
    { userId: 'u7', displayName: 'Grace', tier: 'extended', hasBusinessApp: false },
  ];

  const columns = chunkColumnMajor(people).map((column) =>
    column.filter(Boolean).map((person) => person.displayName),
  );

  assert.deepEqual(columns[0], ['Alice', 'Bob', 'Carol']);
  assert.deepEqual(columns[1], ['Dan', 'Eve', 'Frank']);
  assert.deepEqual(columns[2], ['Grace']);
  assert.equal(people.filter((person) => person.hasBusinessApp).map((person) => person.displayName).join(','), 'Eve');
  assert.equal(people.filter((person) => person.tier === 'close').length, 3);
  assert.equal(people.filter((person) => person.tier === 'friend').length, 2);
  assert.equal(people.filter((person) => person.tier === 'extended').length, 2);

  const gridSource = read('app-mobile/src/components/profile/circle/CircleGrid.tsx');
  assert.match(gridSource, /Math\.floor\(index \/ ROWS_PER_COLUMN\)/);
  assert.match(gridSource, /index % ROWS_PER_COLUMN/);
  assert.match(gridSource, /FlatList/);

  const avatarSource = read('app-mobile/src/components/profile/circle/CircleAvatarTile.tsx');
  assert.match(avatarSource, /close:\s*colors\.primary\[500\]/);
  assert.match(avatarSource, /friend:\s*colors\.success\[500\]/);
  assert.match(avatarSource, /extended:\s*colors\.gray\[500\]/);
  assert.match(avatarSource, /person\.hasBusinessApp \? <BusinessBadge hasBusinessApp=\{person\.hasBusinessApp\} \/> : null/);

  const serviceSource = read('app-mobile/src/services/circleService.ts');
  assert.match(serviceSource, /supabase\.rpc\('get_user_circle'/);
  assert.doesNotMatch(serviceSource, /\.from\(['"](friends|pairings|orders)['"]\)/);
}

if (require.main === module) {
  try {
    runYourCircleSectionHappyTest();
    console.log('PASS ORCH-0933 YourCircleSection happy-path regression');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runYourCircleSectionHappyTest };
