import { resolveBusinessMediaLanguage } from "../index";

describe("#3988 account-scoped Host media language", () => {
  it("resets a null account preference to the environment locale", () => {
    expect(resolveBusinessMediaLanguage(null, "es-MX")).toBe("es");
  });

  it("falls back to English when neither preference nor environment is supported", () => {
    expect(resolveBusinessMediaLanguage(null, "unsupported-locale")).toBe("en");
  });

  it("keeps a supported profile preference ahead of the environment", () => {
    expect(resolveBusinessMediaLanguage("de-DE", "es-MX")).toBe("de");
  });
});
