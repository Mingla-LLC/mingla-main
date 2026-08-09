const path = require("node:path");
const TestSequencer = require("@jest/test-sequencer").default;

const TARGETS = {
  "venue-first": [
    "venueGalleryWebPicker.orch1300.test.ts",
    "urlCreateObjectURLPreserved.issue1487.implementor.test.ts",
    "browserFilePicker.test.ts",
  ],
  "browser-first": [
    "browserFilePicker.test.ts",
    "venueGalleryWebPicker.orch1300.test.ts",
    "urlCreateObjectURLPreserved.issue1487.implementor.test.ts",
  ],
};

module.exports = class Issue1487Sequencer extends TestSequencer {
  sort(tests) {
    const orderName = process.env.ISSUE_1487_ORDER;
    const orderedBasenames = TARGETS[orderName];
    if (!orderedBasenames) {
      throw new Error(
        "ISSUE_1487_ORDER must be exactly venue-first or browser-first",
      );
    }

    const ranks = new Map(orderedBasenames.map((basename, index) => [basename, index]));
    const selectedTargetCounts = new Map();
    for (const test of tests) {
      const basename = path.basename(test.path);
      if (ranks.has(basename)) {
        selectedTargetCounts.set(basename, (selectedTargetCounts.get(basename) || 0) + 1);
      }
    }
    const duplicate = [...selectedTargetCounts.entries()].find(([, count]) => count > 1);
    if (duplicate) {
      throw new Error(`#1487 sequencer received duplicate target: ${duplicate[0]}`);
    }

    return [...tests].sort((left, right) => {
      const leftBasename = path.basename(left.path);
      const rightBasename = path.basename(right.path);
      const leftRank = ranks.get(leftBasename);
      const rightRank = ranks.get(rightBasename);
      const leftIsTarget = leftRank !== undefined;
      const rightIsTarget = rightRank !== undefined;

      if (leftIsTarget && rightIsTarget) return leftRank - rightRank;
      if (leftIsTarget) return -1;
      if (rightIsTarget) return 1;
      return left.path.localeCompare(right.path);
    });
  }
};
