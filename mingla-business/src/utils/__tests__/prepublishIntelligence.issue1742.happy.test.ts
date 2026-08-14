import fs from "node:fs";
import path from "node:path";
import { buildTurnoutInput } from "../turnoutInput";

const root = path.resolve(__dirname, "../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), "utf8");
const day = (offset: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

describe("#1742 pre-publish intelligence happy path", () => {
  it("maps Experience identity, first stop, date, price and capacity through the single turnout builder", () => {
    const result = buildTurnoutInput({
      kind: "experience",
      title: "Lagos Art Walk",
      intents: ["romantic", "group-fun"],
      stops: [
        {
          clientId: "one",
          placeId: null,
          placeName: "Art Roost",
          address: "2 Alexander Avenue",
          city: "Lagos",
          region: null,
          countryCode: "NG",
          lat: 6.4,
          lng: 3.4,
          imageUrls: [],
          startTime: "18:00",
          priceMajor: "0",
          description: "Meet here",
        },
      ],
      when: {
        whenMode: "single",
        date: day(30),
        doorsOpen: "18:00",
        endsAt: "21:00",
        timezone: "Africa/Lagos",
        recurrenceRule: null,
        multiDates: null,
      },
      pricingMode: "whole",
      resolvedTotalMajor: 25000,
      isFree: false,
      capacity: "50",
      unlimited: false,
      brandDefaultCurrency: "NGN",
    });
    expect(result).toMatchObject({
      ok: true,
      input: {
        title: "Lagos Art Walk",
        category: "Romantic, Group Fun",
        city: "Lagos",
        venue_name: "Art Roost",
        date: day(30),
        start_time: "18:00",
        ticket_price: 25000,
        capacity: 50,
        currency: "NGN",
      },
    });
  });

  it("keeps the publish handlers intact while routing only the new Experience publish tap through the fail-soft gate", () => {
    const experience = read(
      "src/components/experience/ExperienceCreatorWizard.tsx",
    );
    expect(experience).toContain("const handleSubmit = useCallback(");
    expect(experience).toContain("onPress={maybeOpenIntelGate}");
    expect(experience).toContain("autoRunEnabled={false}");
    expect(experience).toContain('label="Save as draft"');
    expect(experience).toContain("onPress={() => void handleSubmit(false)}");
    expect(experience).toContain('label="Save changes"');
    expect(experience).toContain("onPress={() => void handleLiveSave()}");
  });

  it("mounts enriched Review intelligence first and speaks every non-success state without blocking publish", () => {
    for (const file of [
      "src/components/event/CreatorStep7Preview.tsx",
      "src/components/rsvp/RsvpStep7Preview.tsx",
    ]) {
      const source = read(file);
      expect(source).toContain("<TurnoutGateSection />");
      expect(source.indexOf("<TurnoutGateSection />")).toBeLessThan(
        source.indexOf("<ThemeControlRow"),
      );
      expect(source).not.toContain('<TurnoutForecastCard surface="preview" />');
    }
    const gate = read("src/components/intel/TurnoutGateSection.tsx");
    expect(gate).toContain("You can publish while this runs.");
    expect(gate).toContain("publish works; checks need a connection");
    expect(gate).toContain("you can publish anyway");
    const sheet = read("src/components/intel/PrePublishGateSheet.tsx");
    expect(sheet).toContain('label="Publish now"');
    expect(sheet).toContain(
      "~{forecast?.total_low}–{forecast?.total_high} people expected",
    );
    expect(sheet).not.toContain("of {forecast");
  });
});
