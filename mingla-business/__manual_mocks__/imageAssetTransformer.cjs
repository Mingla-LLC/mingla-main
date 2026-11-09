/**
 * #4334 — Jest transform for bundled image files (`require("./logo.png")`).
 * Metro turns an image require into an asset reference; plain Jest would try to
 * execute the PNG bytes. This returns a small, file-specific stand-in so a test
 * can still tell WHICH image a component chose (e.g. the White vs DarkGray
 * Google Maps logo). Tests only — the app build is Metro and is unaffected.
 */
const path = require("node:path");

module.exports = {
  process(_source, filename) {
    return {
      code: `module.exports = ${JSON.stringify({ testUri: path.basename(filename) })};`,
    };
  },
};
