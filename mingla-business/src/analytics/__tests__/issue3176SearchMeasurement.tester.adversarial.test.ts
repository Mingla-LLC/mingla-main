import { sanitizeSearchMeasurement } from "@mingla/search-measurement";

describe("#3176 shared search-measurement sanitizer — tester adversarial guard", () => {
  it("does not let inherited PII cross either analytics sink", () => {
    const attackerControlledPayload = Object.assign(
      Object.create({
        email: "person@example.com",
        phone: "+15555550123",
        private_id: "private-user-id",
      }),
      {
        audience: "explorer",
        page_family: "city_hub",
        page_location: "https://usemingla.com/cities/lagos",
        source_kind: "search",
      },
    );

    const sanitized = sanitizeSearchMeasurement(
      "page_view",
      attackerControlledPayload,
    );

    expect(sanitized).toEqual({
      event: "page_view",
      properties: {
        audience: "explorer",
        page_family: "city_hub",
        page_location: "https://usemingla.com/cities/lagos",
        source_kind: "search",
      },
    });
    expect(JSON.stringify(sanitized)).not.toMatch(
      /person@example\.com|15555550123|private-user-id/,
    );
  });

  it("returns a detached allowlisted copy that cannot be poisoned after capture", () => {
    const payload: Record<string, string> = {
      audience: "host",
      page_family: "host_pillar",
      icp: "event_promoter",
      action_state: "succeeded",
    };

    const sanitized = sanitizeSearchMeasurement("listing_published", payload);
    expect(sanitized).not.toBeNull();

    payload.icp = "person@example.com";
    payload.email = "person@example.com";

    expect(sanitized?.properties).toEqual({
      audience: "host",
      page_family: "host_pillar",
      icp: "event_promoter",
      action_state: "succeeded",
    });
    expect(JSON.stringify(sanitized)).not.toContain("person@example.com");
  });
});
