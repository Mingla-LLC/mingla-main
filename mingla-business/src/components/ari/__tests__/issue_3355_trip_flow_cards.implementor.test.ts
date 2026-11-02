/**
 * #3355 P8 — the Host side of Ari's trip flow cards.
 *
 *   * "Where does the trip leave from?" and "Where is the trip going?" are
 *     answered with the same Host address search as the event's "Where is
 *     it?" card, in "city" mode: no venue name field, the picked place names
 *     itself, and the bound answer carries the structured place (label,
 *     city, coordinates) — never typed text in the owner's name.
 *   * Every other trip card is not a place card.
 */
import * as fs from "fs";
import * as path from "path";

jest.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "text",
  View: "view",
}));
jest.mock("@mingla/phone-input/phoneNumber", () => ({
  formatPhoneNational: (_c: string, v: string) => v,
  phoneDialCodeForCountry: () => null,
}));

import {
  buildFlowPlaceAnswer,
  flowPlaceMode,
  isFlowPlaceCard,
} from "../ariFlowCards";
import type { AriFlowArtefact } from "../../../services/agentChatService";

const RUN = "77777777-7777-4777-8777-777777777777";
const QUESTION = "88888888-8888-4888-8888-888888888888";

function card(stepKey: string): AriFlowArtefact {
  return {
    schema_version: 1,
    artefact_id: `q:${RUN}:${QUESTION}`,
    run_id: RUN,
    step_key: stepKey,
    question_id: QUESTION,
    kind: "question",
    title: "Where it's going",
    text: "Where is the trip going? Pick it from the search suggestions.",
    options: [],
    answer_mode: "form",
  };
}

const LAGOS = {
  venue_name: "Lagos",
  address: "Lagos, Nigeria",
  city: "Lagos",
  country_code: "NG",
  lat: 6.5244,
  lng: 3.3792,
  feature_type: "place",
};

describe("#3355 P8 trip flow cards", () => {
  it("answers departure and destination with the address search in city mode", () => {
    for (const step of ["trip_departure", "trip_destination"]) {
      expect(isFlowPlaceCard(card(step))).toBe(true);
      expect(flowPlaceMode(card(step))).toBe("city");
    }
    expect(flowPlaceMode(card("event_place"))).toBe("venue");
    const built = buildFlowPlaceAnswer(card("trip_destination"), LAGOS);
    expect(built).not.toBeNull();
    expect(built!.label).toBe("Lagos, Nigeria");
    expect(built!.answer).toEqual({
      run_id: RUN,
      step_key: "trip_destination",
      question_id: QUESTION,
      choice_id: "answer",
      display_text: "Lagos, Nigeria",
      values: { choices: [], country: null, response: "", place: LAGOS },
    });
  });

  it("takes no place on any other trip card, nor without a city or a point", () => {
    for (const step of ["trip_dates", "trip_package_details", "trip_title"]) {
      expect(isFlowPlaceCard(card(step))).toBe(false);
    }
    expect(
      isFlowPlaceCard({ ...card("trip_departure"), answer_mode: undefined }),
    ).toBe(false);
    expect(buildFlowPlaceAnswer(card("trip_departure"), { ...LAGOS, city: "" }))
      .toBeNull();
    expect(
      buildFlowPlaceAnswer(card("trip_departure"), { ...LAGOS, lng: Number.NaN }),
    ).toBeNull();
  });

  it("hides the venue name in city mode and passes the mode through the chat", () => {
    const placeCard = fs.readFileSync(
      path.join(__dirname, "..", "AriFlowPlaceCard.tsx"),
      "utf8",
    );
    // #3355 P9: "city" and "address" both hide the name box (noName).
    expect(placeCard).toMatch(/const noName = mode !== "venue"/);
    expect(placeCard).toMatch(/\{noName \? null : \(\s*<Input/);
    expect(placeCard).toMatch(/if \(noName\) \{[\s\S]*setVenueName\(/);
    const list = fs.readFileSync(
      path.join(__dirname, "..", "MessageList.tsx"),
      "utf8",
    );
    expect(list).toMatch(/mode: flowPlaceMode\(flow\) \?\? "venue"/);
    const screen = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "screens", "ari", "AriChatScreen.tsx"),
      "utf8",
    );
    expect(screen).toMatch(/<AriFlowPlaceCard[\s\S]*?mode=\{mode\}/);
  });
});
