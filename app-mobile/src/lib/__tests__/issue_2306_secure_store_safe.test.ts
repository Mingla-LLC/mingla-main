/**
 * #2306 — the guard must degrade, never throw, when the native module is absent.
 * Absence is the normal state on every binary built before expo-secure-store
 * was added; throwing there is what breaks an OTA at module eval.
 */
describe("#2306 secureStoreSafe", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("passes calls straight through when the native module is present", async () => {
    const setItemAsync = jest.fn().mockResolvedValue(undefined);
    const getItemAsync = jest.fn().mockResolvedValue("stored");
    const deleteItemAsync = jest.fn().mockResolvedValue(undefined);
    jest.doMock("expo-secure-store", () => ({ setItemAsync, getItemAsync, deleteItemAsync }));
    const mod = require("../secureStoreSafe");
    expect(mod.isSecureStoreAvailable()).toBe(true);
    await mod.secureSetItem("k", "v");
    expect(setItemAsync).toHaveBeenCalledWith("k", "v");
    expect(await mod.secureGetItem("k")).toBe("stored");
    await mod.secureDeleteItem("k");
    expect(deleteItemAsync).toHaveBeenCalledWith("k");
  });

  it("degrades to empty storage when the native module throws at require", async () => {
    jest.doMock("expo-secure-store", () => { throw new Error("NativeModule.ExpoSecureStore is null"); });
    const mod = require("../secureStoreSafe");
    expect(mod.isSecureStoreAvailable()).toBe(false);
    await expect(mod.secureSetItem("k", "v")).resolves.toBeUndefined();
    await expect(mod.secureGetItem("k")).resolves.toBeNull();
    await expect(mod.secureDeleteItem("k")).resolves.toBeUndefined();
  });

  it("treats a module missing its API as unavailable rather than crashing", async () => {
    jest.doMock("expo-secure-store", () => ({}));
    const mod = require("../secureStoreSafe");
    expect(mod.isSecureStoreAvailable()).toBe(false);
    await expect(mod.secureGetItem("k")).resolves.toBeNull();
  });

  it("never silently relocates secrets to unencrypted storage", () => {
    // Assert on CODE, not prose — the module's own comment explains why it does
    // not fall back to AsyncStorage, and a naive text match flags that comment.
    const raw = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "../secureStoreSafe.ts"), "utf8") as string;
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/async-storage/);
    expect(code).not.toMatch(/\bAsyncStorage\b/);
    // and it must still be the real secure store when one exists
    expect(code).toMatch(/require\("expo-secure-store"\)/);
  });
});
