import { reportNonFatal } from "../reportNonFatal";

const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

jest.mock("../sentry", () => ({
  captureException: jest.fn(() => "event-id"),
}));

import { captureException } from "../sentry";

describe("reportNonFatal", () => {
  beforeEach(() => {
    warnSpy.mockClear();
    (captureException as jest.Mock).mockClear();
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  test("logs warning and captures Error instances", () => {
    const err = new Error("creator upsert failed");
    reportNonFatal("auth.ensureCreatorAccount", err, { userId: "u1" });
    expect(warnSpy).toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(err, {
      tags: { scope: "auth.ensureCreatorAccount" },
      extra: { userId: "u1" },
    });
  });

  test("fails-on-revert: non-Error values skip captureException", () => {
    reportNonFatal("auth.probe", "transport");
    expect(warnSpy).toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });
});
