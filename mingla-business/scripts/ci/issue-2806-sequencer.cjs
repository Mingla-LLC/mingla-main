const path = require("node:path");
const TestSequencer = require("@jest/test-sequencer").default;

const ORDER = [
  "peopleRequestId.issue1774.test.ts",
  "issue_2306_secure_random_safe.test.ts",
];

module.exports = class Issue2806Sequencer extends TestSequencer {
  sort(tests) {
    const ranks = new Map(ORDER.map((basename, index) => [basename, index]));
    const counts = new Map();

    for (const test of tests) {
      const basename = path.basename(test.path);
      if (ranks.has(basename)) {
        counts.set(basename, (counts.get(basename) || 0) + 1);
      }
    }

    for (const basename of ORDER) {
      const count = counts.get(basename) || 0;
      if (count !== 1) {
        throw new Error(`#2806 sequencer expected one ${basename}; received ${count}`);
      }
    }

    return [...tests].sort((left, right) => {
      const leftRank = ranks.get(path.basename(left.path));
      const rightRank = ranks.get(path.basename(right.path));
      if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
      if (leftRank !== undefined) return -1;
      if (rightRank !== undefined) return 1;
      return left.path.localeCompare(right.path);
    });
  }
};
