/**
 * #3355 P7 — the Host side of Ari's event flow cards.
 *
 *   * "Where is it?" is answered with the Host address search: a pick becomes
 *     a bound flow answer carrying the structured place (never typed text in
 *     the owner's name), and nothing is sent without a venue name and a city.
 *   * The event cover handoff takes the upload in the chat, on the event it
 *     belongs to; without the event id there is no upload control.
 *   * An engine proposal whose rows the server wrote in plain words shows
 *     exactly those rows (no coordinates, no "public").
 */
import * as fs from "fs";
import * as path from "path";

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
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => null,
}));
jest.mock("../../location/AddressInput", () => ({
  AddressInput: "mapbox-address-input",
}));
jest.mock("../../ui/Button", () => ({ Button: "button" }));
jest.mock("../../ui/Input", () => ({ Input: "input" }));
jest.mock("@mingla/phone-input/phoneNumber", () => ({
  formatPhoneNational: (_c: string, v: string) => v,
  phoneDialCodeForCountry: () => null,
}));

import {
  buildFlowPlaceAnswer,
  flowUploadKind,
  isFlowPlaceCard,
} from "../ariFlowCards";
import { placeFromPick } from "../AriFlowPlaceCard";
import type { AriFlowArtefact } from "../../../services/agentChatService";

const RUN = "77777777-7777-4777-8777-777777777777";
const QUESTION = "88888888-8888-4888-8888-888888888888";
const EVENT = "55555555-5555-4555-8555-555555555555";

const placeCard: AriFlowArtefact = {
  schema_version: 1,
  artefact_id: `q:${RUN}:${QUESTION}`,
  run_id: RUN,
  step_key: "event_place",
  question_id: QUESTION,
  kind: "question",
  title: "Where is it?",
  text: "Add the venue name and pick the address from the search.",
  options: [],
  answer_mode: "form",
};

const SHOREDITCH = {
  venue_name: "Shoreditch Town Hall",
  address: "380 Old Street, London EC1V 9LT",
  city: "London",
  country_code: "GB",
  lat: 51.5265,
  lng: -0.0806,
  feature_type: "poi",
};

describe("#3355 P7 event flow cards", () => {
  it("binds a picked place to the current card as a structured answer", () => {
    expect(isFlowPlaceCard(placeCard)).toBe(true);
    const built = buildFlowPlaceAnswer(placeCard, {
      ...SHOREDITCH,
      venue_name: "  Shoreditch Town Hall ",
    });
    expect(built).not.toBeNull();
    expect(built!.label).toBe(
      "Shoreditch Town Hall, 380 Old Street, London EC1V 9LT",
    );
    expect(built!.answer).toEqual({
      run_id: RUN,
      step_key: "event_place",
      question_id: QUESTION,
      choice_id: "answer",
      display_text: "Shoreditch Town Hall, 380 Old Street, London EC1V 9LT",
      values: {
        choices: [],
        country: null,
        response: "",
        place: SHOREDITCH,
      },
    });
  });

  it("sends nothing without a venue name, a city or a real point", () => {
    expect(buildFlowPlaceAnswer(placeCard, { ...SHOREDITCH, venue_name: " " }))
      .toBeNull();
    expect(buildFlowPlaceAnswer(placeCard, { ...SHOREDITCH, city: "" }))
      .toBeNull();
    expect(
      buildFlowPlaceAnswer(placeCard, { ...SHOREDITCH, lat: Number.NaN }),
    ).toBeNull();
    // Only the "Where is it?" card takes a place.
    expect(
      buildFlowPlaceAnswer(
        { ...placeCard, step_key: "event_start" },
        SHOREDITCH,
      ),
    ).toBeNull();
    expect(isFlowPlaceCard({ ...placeCard, answer_mode: undefined })).toBe(
      false,
    );
  });

  it("reads a Mapbox pick into the place, and refuses one with no city", () => {
    const details = {
      placeId: "poi.1",
      formattedAddress: "380 Old Street, London EC1V 9LT",
      city: "London",
      region: "England",
      regionCode: "ENG",
      regionCodeFull: "GB-ENG",
      countryCode: "GB",
      location: { lat: 51.5265, lng: -0.0806 },
      featureType: "poi",
    };
    // #3355 P9: the pick also carries the address search's own id.
    expect(placeFromPick(details as never, "Shoreditch Town Hall")).toEqual({
      ...SHOREDITCH,
      place_id: "poi.1",
    });
    expect(
      placeFromPick({ ...details, city: "" } as never, "Shoreditch Town Hall"),
    ).toBeNull();
  });

  it("puts the event cover upload on the event it belongs to", () => {
    const coverCard: AriFlowArtefact = {
      ...placeCard,
      step_key: "event_cover",
      kind: "handoff",
      answer_mode: undefined,
      options: [
        { id: "check", label: "I've added it, check now" },
        { id: "not_now", label: "Not now" },
      ],
      handoff: {
        item_key: "event_cover",
        item_label: "Event cover",
        route: `/event/${EVENT}/edit`,
        route_label: "the event",
        can_caller_fix: true,
        who_can_fix: "you",
      },
      subject_id: EVENT,
    };
    expect(flowUploadKind(coverCard)).toBe("event_cover");
    expect(flowUploadKind({ ...coverCard, subject_id: undefined })).toBeNull();
  });

  it("shows only the engine's plain-words rows on a flow proposal", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "ToolProposalCard.tsx"),
      "utf8",
    );
    expect(source).toMatch(
      /if \(context\.flow_rows_only === true\) \{\s*const server = readServerPresentation\(args\);\s*if \(server && server\.fields\.length > 0\) return server\.fields;/,
    );
    // The branch runs before the event-specific raw rows ("Visibility").
    expect(source.indexOf("context.flow_rows_only === true")).toBeLessThan(
      source.indexOf('out.push({ label: "Visibility"'),
    );
  });
});
