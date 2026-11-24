/**
 * #3969 Step 2 — Host reads the viewer's own private profile fields through
 * the own-profile read, and the Brand group roster shows an email line only
 * when there is one.
 *
 * FAILS-ON-REVERT: a direct `profiles` read for the phone or the language,
 * or an unconditional roster email line, fails here.
 */
import * as fs from "fs";
import * as path from "path";

const calls: Array<{ fn: string; column: string; id: string }> = [];
const maybeSingle = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: {
    from: () => {
      throw new Error("Host must not read profiles directly for its own private fields");
    },
    rpc: (fn: string) => ({
      select: (column: string) => ({
        eq: (_field: string, id: string) => {
          calls.push({ fn, column, id });
          return { maybeSingle: () => maybeSingle() };
        },
      }),
    }),
  },
}));

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));

import { fetchOwnProfilePhoneOnFile } from "../useOwnProfilePhoneOnFile";
import { syncBusinessMediaLanguage } from "../../i18n";

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

beforeEach(() => {
  calls.length = 0;
  maybeSingle.mockReset();
});

describe("#3969 Host own-profile reads", () => {
  it("reads the phone through get_my_profile", async () => {
    maybeSingle.mockResolvedValue({ data: { phone: "+15551234567" }, error: null });
    await expect(fetchOwnProfilePhoneOnFile("user-1")).resolves.toBe(true);
    expect(calls).toEqual([{ fn: "get_my_profile", column: "phone", id: "user-1" }]);
  });

  it("surfaces a failed own-profile read instead of reporting no phone", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await expect(fetchOwnProfilePhoneOnFile("user-1")).rejects.toEqual({ message: "permission denied" });
  });

  it("reads the preferred language through get_my_profile", async () => {
    maybeSingle.mockResolvedValue({ data: { preferred_language: "de" }, error: null });
    await syncBusinessMediaLanguage("user-2");
    expect(calls).toEqual([{ fn: "get_my_profile", column: "preferred_language", id: "user-2" }]);
  });
});

describe("#3969 Brand group roster email", () => {
  it("renders the email line only when the roster row has one", () => {
    const panel = stripComments(
      fs.readFileSync(path.join(__dirname, "../../components/messages/BrandGroupPeoplePanel.tsx"), "utf8"),
    );
    expect(panel).toMatch(
      /typeof member\.email === "string" && member\.email\.trim\(\)\.length > 0 \? \(\s*<Text style=\{styles\.memberEmail\}[^>]*>\{member\.email\}<\/Text>\s*\) : null/,
    );
    const roster = fs.readFileSync(path.join(__dirname, "../../services/brandGroupRosterService.ts"), "utf8");
    expect(roster).toMatch(/email: string \| null;/);
  });
});
