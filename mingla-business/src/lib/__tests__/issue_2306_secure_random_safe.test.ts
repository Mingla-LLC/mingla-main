/**
 * #2306 — the polyfill guard must not throw when the native module is absent,
 * and must not paper over it with weak randomness.
 */
describe("#2306 secureRandomSafe", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("reports success when the polyfill loads", () => {
    jest.doMock("react-native-get-random-values", () => ({}));
    expect(require("../secureRandomSafe").ensureSecureRandom()).toBe(true);
  });

  it("returns false instead of throwing when the native module is missing", () => {
    jest.doMock("react-native-get-random-values", () => {
      throw new Error("NativeModule.RNGetRandomValues is null");
    });
    const mod = require("../secureRandomSafe");
    expect(() => mod.ensureSecureRandom()).not.toThrow();
    expect(mod.ensureSecureRandom()).toBe(false);
  });

  it("offers no Math.random fallback — weak ids would be worse than failing", () => {
    // Assert on CODE, not prose — the module's comment explains why it refuses
    // a Math.random fallback, and a naive text match flags that explanation.
    const raw = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "../secureRandomSafe.ts"), "utf8") as string;
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/Math\.random/);
    expect(code).toMatch(/require\("react-native-get-random-values"\)/);
  });
});
