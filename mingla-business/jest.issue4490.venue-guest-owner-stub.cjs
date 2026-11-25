/** #4490 — jest stand-in for the Guest venue owner barrel (see jest.issue4490.venue-owner-lazy-stub.cjs). */
const path = require("path");
const { lazyOwner } = require("./jest.issue4490.venue-owner-lazy-stub.cjs");
module.exports = lazyOwner(path.join(__dirname, "src/components/venue/guest/venueGuestScreens.ts"));
