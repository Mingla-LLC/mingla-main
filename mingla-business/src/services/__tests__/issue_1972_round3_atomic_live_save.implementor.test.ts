import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import { patchPublishedEventAtomically } from "../businessEvents";
import { supabase } from "../supabase";

jest.mock("../supabase", () => ({
  supabase: { rpc: jest.fn() },
}));

const rpc = supabase.rpc as unknown as jest.Mock<
  (...args: unknown[]) => Promise<{ data: unknown; error: null }>
>;

describe("#1972 round-three atomic live-event save", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("one RPC carries the complete mixed patch and exact next revision", async () => {
    rpc.mockResolvedValueOnce({
      data: { event: { id: "event-1" }, client_revision: 8 },
      error: null,
    });

    await expect(
      patchPublishedEventAtomically(
        "event-1",
        {
          core: { name: "One durable save" },
          taxonomy: {
            city: "Atlanta",
            partyTypes: ["birthday-party"],
            vibeTags: ["social"],
            musicGenres: ["afrobeats"],
            locationGeo: null,
            locationText: "Atlanta, GA",
          },
          when: {
            whenMode: "single",
            timezone: "America/New_York",
            when: {
              date: "2028-11-11",
              doorsOpen: "18:00",
              endsAt: "20:00",
            },
            multiDates: null,
            recurrenceRule: null,
          },
          theme: { color: "#112233", font: "fraunces", animation: "none" },
          pricing: {
            passTax: true,
            passMinglaFee: false,
            passServiceFee: true,
          },
          cover: { selectionRef: "selection-123" },
        },
        "Save every section together",
        8,
      ),
    ).resolves.toMatchObject({ client_revision: 8 });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "business_update_live_event_atomic",
      expect.objectContaining({
        p_event_id: "event-1",
        p_client_revision: 8,
        p_reason: "Save every section together",
        p_patch: expect.objectContaining({
          core: { name: "One durable save" },
          cover: { selectionRef: "selection-123" },
          pricing: {
            passTax: true,
            passMinglaFee: false,
            passServiceFee: true,
          },
        }),
      }),
    );
  });
});
