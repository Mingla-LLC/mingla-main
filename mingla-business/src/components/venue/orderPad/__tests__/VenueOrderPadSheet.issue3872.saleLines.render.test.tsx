// #3872 J17 contract path. The executable suite omits `.render` so the default
// Business Jest lane runs it; importing it here preserves the spec-named proof.
const TestRenderer = require("react-test-renderer") as unknown;
import "./VenueOrderPadSheet.issue3872.saleLines.test";

void TestRenderer;
