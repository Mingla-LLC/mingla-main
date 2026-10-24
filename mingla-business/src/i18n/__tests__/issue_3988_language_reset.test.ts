import i18n, { resolveBusinessMediaLanguage, syncBusinessMediaLanguage } from "../index";

const mockReadProfile = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_field: string, userId: string) => ({
          maybeSingle: () => mockReadProfile(userId),
        }),
      }),
    }),
  },
}));

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

  it("applies the environment fallback when the profile read fails", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    mockReadProfile.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    await i18n.changeLanguage("de");

    await syncBusinessMediaLanguage("user-b");

    expect(i18n.language).toBe("en");
    expect(warning).toHaveBeenCalledWith("[i18n] preferred language read failed", "offline");
    warning.mockRestore();
  });

  it("does not let a slow previous account overwrite the current account language", async () => {
    let resolveUserA!: (value: unknown) => void;
    let resolveUserB!: (value: unknown) => void;
    const userA = new Promise((resolve) => { resolveUserA = resolve; });
    const userB = new Promise((resolve) => { resolveUserB = resolve; });
    mockReadProfile.mockImplementation((userId: string) => userId === "user-a" ? userA : userB);
    let currentUserId = "user-a";

    const syncA = syncBusinessMediaLanguage("user-a", () => currentUserId === "user-a");
    currentUserId = "user-b";
    const syncB = syncBusinessMediaLanguage("user-b", () => currentUserId === "user-b");
    resolveUserB({ data: { preferred_language: "fr" }, error: null });
    await syncB;
    resolveUserA({ data: { preferred_language: "de" }, error: null });
    await syncA;

    expect(i18n.language).toBe("fr");
  });
});
