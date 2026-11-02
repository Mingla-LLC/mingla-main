/**
 * #3355 P9 — the Host side of Ari's experience and venue flow cards.
 *
 *   * An experience stop's "Where is …?" card and a venue's "Where is the
 *     venue?" card are answered with the same Host address search as the
 *     event's "Where is it?" card, in "address" mode: no name box (the name
 *     has its own card), the picked place names itself, and the bound answer
 *     carries the structured place — never typed text, never coordinates
 *     typed by anyone.
 *   * The pick carries the address search's own id (`place_id`), which an
 *     experience stop needs before the server will publish it.
 */
jest.mock("react-native", () => ({
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "text",
  View: "view",
}));
jest.mock("../../../constants/designSystem", () => ({
  spacing: { sm: 8 },
  text: { secondary: "grey" },
  typography: { bodySm: { fontSize: 13 } },
}));
jest.mock("@mingla/phone-input/phoneNumber", () => ({
  formatPhoneNational: (_c: string, v: string) => v,
  phoneDialCodeForCountry: () => null,
}));
jest.mock("../../location/MapboxAddressInput", () => ({
  MapboxAddressInput: "mapbox",
}));
jest.mock("../../ui/Button", () => ({ Button: "button" }));
jest.mock("../../ui/Input", () => ({ Input: "input" }));

import {
  buildFlowPlaceAnswer,
  flowPlaceMode,
  isFlowPlaceCard,
} from "../ariFlowCards";
import { placeFromPick } from "../AriFlowPlaceCard";
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
    title: "Where is the venue?",
    text: "Where is the venue? Pick the address from the search suggestions.",
    options: [],
    answer_mode: "form",
  };
}

const PICK = {
  placeId: "dXJuOm1ieHBvaTpsYWdvb24",
  formattedAddress: "3 Ozumba Mbadiwe Ave, Victoria Island, Lagos, Nigeria",
  city: "Lagos",
  region: null,
  regionCode: null,
  regionCodeFull: null,
  countryCode: "NG",
  location: { lat: 6.4338, lng: 3.4206 },
  featureType: "poi",
};

describe("#3355 P9 experience and venue flow cards", () => {
  it("answers a stop's and a venue's place with the address search in address mode", () => {
    for (const step of ["experience_stop_place", "venue_place"]) {
      expect(isFlowPlaceCard(card(step))).toBe(true);
      expect(flowPlaceMode(card(step))).toBe("address");
    }
    for (const step of [
      "experience_stop_name",
      "experience_stop_description",
      "venue_name",
      "venue_hours",
      "stay_venue",
    ]) {
      expect(isFlowPlaceCard(card(step))).toBe(false);
    }
  });

  it("sends the structured pick, with its own id, in the owner's bound answer", () => {
    const place = placeFromPick(PICK as never, "The Lagoon Room");
    expect(place).toEqual({
      venue_name: "The Lagoon Room",
      address: PICK.formattedAddress,
      city: "Lagos",
      country_code: "NG",
      lat: 6.4338,
      lng: 3.4206,
      feature_type: "poi",
      place_id: PICK.placeId,
    });
    const built = buildFlowPlaceAnswer(card("experience_stop_place"), place!);
    expect(built).not.toBeNull();
    // Address mode shows the address the owner picked, not a venue name.
    expect(built!.label).toBe(PICK.formattedAddress);
    expect(built!.answer.values?.place?.place_id).toBe(PICK.placeId);
    expect(built!.answer.choice_id).toBe("answer");
    expect(built!.answer.values?.response).toBe("");
  });

  it("keeps working for a pick without an id (older search results)", () => {
    const place = placeFromPick({ ...PICK, placeId: "" } as never, "Lagos");
    expect(place).not.toBeNull();
    expect(place).not.toHaveProperty("place_id");
  });
});
