import { compareSemver } from "../appVersionPolicy";
describe("#2075 explorer app-version policy", () => { it("rejects malformed versions and compares numeric patch versions", () => { expect(compareSemver("1.1.10", "1.1.9")).toBeGreaterThan(0); expect(compareSemver("1.1", "1.1.4")).toBeNull(); }); });
