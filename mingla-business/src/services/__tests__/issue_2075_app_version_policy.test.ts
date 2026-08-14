import { compareSemver } from "../appVersionPolicy";
describe("#2075 business app-version policy", () => { it("uses numeric SemVer comparisons", () => { expect(compareSemver("2.0.0", "1.99.99")).toBeGreaterThan(0); expect(compareSemver("v1.1.4", "1.1.4")).toBeNull(); }); });
