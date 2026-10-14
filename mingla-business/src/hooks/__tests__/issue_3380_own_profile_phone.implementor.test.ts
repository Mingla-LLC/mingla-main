/**
 * #3380 — the RSVP page learns up front whether the signed-in guest's account
 * has a phone, using the same test the server applies (a non-blank
 * `profiles.phone` on the viewer's own row), and the RSVP adapter passes that
 * answer down to the shared RSVP state.
 */

import * as fs from "fs";
import * as path from "path";

const maybeSingle = jest.fn();
const eq = jest.fn(() => ({ maybeSingle }));
const select = jest.fn(() => ({ eq }));
const from = jest.fn(() => ({ select }));

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));
jest.mock("../../services/supabase", () => ({
  supabase: { from: (...args: unknown[]) => from(...(args as [])) },
}));

import {
  fetchOwnProfilePhoneOnFile,
  ownProfilePhoneKeys,
  profilePhoneIsOnFile,
} from "../useOwnProfilePhoneOnFile";

beforeEach(() => {
  maybeSingle.mockReset();
  eq.mockClear();
  select.mockClear();
  from.mockClear();
});

describe("#3380 own profile phone", () => {
  it("reads only the viewer's own phone column", async () => {
    maybeSingle.mockResolvedValue({ data: { phone: "+15551234567" }, error: null });
    await expect(fetchOwnProfilePhoneOnFile("user-1")).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith("profiles");
    expect(select).toHaveBeenCalledWith("phone");
    expect(eq).toHaveBeenCalledWith("id", "user-1");
  });

  it.each([
    ["a null phone", { phone: null }],
    ["a blank phone", { phone: "   " }],
    ["no profile row", null],
  ])("reports no phone for %s", async (_label, row) => {
    maybeSingle.mockResolvedValue({ data: row, error: null });
    await expect(fetchOwnProfilePhoneOnFile("user-1")).resolves.toBe(false);
  });

  it("throws on a read error so the hook reports unknown, never 'no phone'", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(fetchOwnProfilePhoneOnFile("user-1")).rejects.toEqual({ message: "boom" });
  });

  it("applies the server's test: a non-blank string", () => {
    expect(profilePhoneIsOnFile("+2348031234567")).toBe(true);
    expect(profilePhoneIsOnFile("")).toBe(false);
    expect(profilePhoneIsOnFile(undefined)).toBe(false);
    expect(ownProfilePhoneKeys.byUser("u")).toEqual(["own-profile-phone", "u"]);
  });

  it("is wired into the RSVP adapter, keyed by the signed-in viewer", () => {
    const adapter = fs.readFileSync(
      path.join(__dirname, "..", "..", "components/event/FoundationRsvpPreview.tsx"),
      "utf8",
    );
    expect(adapter).toMatch(
      /useOwnProfilePhoneOnFile\(\s*isLoggedIn \? replyIdentity \?\? null : null,/,
    );
    const stateCall = adapter.slice(adapter.indexOf("useRsvpOfferingState({"));
    expect(stateCall.slice(0, stateCall.indexOf("});"))).toMatch(/\baccountPhoneOnFile,/);
  });
});
