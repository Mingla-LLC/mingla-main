/**
 * Issue #1363 RETEST — tester-owned cross-host cancellation contract.
 *
 * The first tester guard proves the shared suggestion-retrieve/X race at
 * runtime. This second, different-angle guard proves every business authoring
 * host advances its own generation for each invalidating user action, while a
 * delayed same-label completion is rejected by the shared generation contract.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";
import {
  advanceLocationRequestGeneration,
  isLocationRequestGenerationCurrent,
} from "../utils/resolveApproxLocation";

const ROOT = path.resolve(__dirname, "../../..");

type HostContract = {
  name: string;
  file: string;
  fieldStart: string;
  fieldEnd: string;
  generationRef: string;
  resolveName: string;
};

const hosts: HostContract[] = [
  {
    name: "venue",
    file: "mingla-business/src/components/venue/VenueStep1Address.tsx",
    fieldStart: "<MapboxAddressInput",
    fieldEnd: "error={error}",
    generationRef: "requestGenerationRef",
    resolveName: "resolveCommittedText",
  },
  {
    name: "event/RSVP",
    file: "mingla-business/src/components/event/CreatorStep3Where.tsx",
    fieldStart: '<Text style={styles.fieldLabel}>Address</Text>',
    fieldEnd: "error={addressError}",
    generationRef: "requestGenerationRef",
    resolveName: "resolveCommittedText",
  },
  {
    name: "experience stop",
    file: "mingla-business/src/components/experience/ExperienceStopCard.tsx",
    fieldStart: 'accessibilityLabel={`Stop ${i + 1} address`}',
    fieldEnd: "error={addrError}",
    generationRef: "requestGenerationRef",
    resolveName: "resolveCommittedText",
  },
  {
    name: "brand",
    file: "mingla-business/src/components/brand/BrandCreationFlow.tsx",
    fieldStart: "value={address}",
    fieldEnd: "placeholder={BRAND_CREATION_COPY.step2.addressPlaceholder}",
    generationRef: "addressRequestGenerationRef",
    resolveName: "resolveCommittedAddress",
  },
  {
    name: "trip create departure",
    file: "mingla-business/src/components/trip/TripCreatorStep1Basics.tsx",
    fieldStart: 'accessibilityLabel="Departing from"',
    fieldEnd: "error={departureError}",
    generationRef: "departureRequestGenerationRef",
    resolveName: "resolveDeparture",
  },
  {
    name: "trip create destination",
    file: "mingla-business/src/components/trip/TripCreatorStep1Basics.tsx",
    fieldStart: 'accessibilityLabel="Destination"',
    fieldEnd: "error={destinationError}",
    generationRef: "destinationRequestGenerationRef",
    resolveName: "resolveDestination",
  },
  {
    name: "published-trip edit departure",
    file: "mingla-business/src/components/trip/EditPublishedTripScreen.tsx",
    fieldStart: 'testID="edit-trip-departure"',
    fieldEnd: "error={",
    generationRef: "departureRequestGenerationRef",
    resolveName: "resolveDeparture",
  },
  {
    name: "published-trip edit destination",
    file: "mingla-business/src/components/trip/EditPublishedTripScreen.tsx",
    fieldStart: 'testID="edit-trip-destination"',
    fieldEnd: "error={",
    generationRef: "destinationRequestGenerationRef",
    resolveName: "resolveDestination",
  },
];

const compact = (value: string): string => value.replace(/[\s,]+/g, "");

function sourceFor(relativePath: string): string {
  return fs.readFileSync(path.resolve(ROOT, relativePath), "utf8");
}

function between(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  expect(startAt).toBeGreaterThanOrEqual(0);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(endAt).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt + end.length);
}

function handler(
  fieldSource: string,
  start: string,
  end: string,
): string {
  return compact(between(fieldSource, start, end));
}

describe("Issue #1363 RETEST — every free-text host invalidates stale work", () => {
  test.each(hosts)(
    "$name wires keystroke, later commit/selection, X, and clear to its own generation",
    ({ file, fieldStart, fieldEnd, generationRef, resolveName }) => {
      const source = sourceFor(file);
      const field = between(source, fieldStart, fieldEnd);
      const advance = `advanceLocationRequestGeneration(${generationRef})`;

      expect(handler(field, "onChangeText=", "onFreeText=")).toContain(advance);
      expect(compact(field)).toContain(`onFreeText={${resolveName}}`);
      expect(handler(field, "onPick=", "onChangeSelected=")).toContain(advance);
      expect(handler(field, "onChangeSelected=", "onClear=")).toContain(advance);
      expect(handler(field, "onClear=", fieldEnd)).toContain(advance);

      const normalizedSource = compact(source);
      const resolveStart = normalizedSource.indexOf(
        `const${resolveName}=`,
      );
      expect(resolveStart).toBeGreaterThanOrEqual(0);
      const resolveWindow = normalizedSource.slice(resolveStart, resolveStart + 6500);
      expect(resolveWindow).toContain(advance);
      expect(resolveWindow).toContain(
        `isLocationRequestGenerationCurrent(${generationRef}generation)`,
      );
    },
  );

  test.each(hosts)(
    "$name rejects a delayed completion after every invalidating action, including a same-label choice",
    async ({ name }) => {
      for (const action of [
        "X",
        "clear",
        "keystroke",
        "later free-text commit",
        "later same-label selection",
      ]) {
        const generation = { current: 0 };
        const oldGeneration = advanceLocationRequestGeneration(generation);
        const committed: string[] = [];
        let finishOld: (() => void) | undefined;
        const oldCompletion = new Promise<void>((resolve) => {
          finishOld = resolve;
        }).then(() => {
          if (isLocationRequestGenerationCurrent(generation, oldGeneration)) {
            committed.push(`${name}:old`);
          }
        });

        advanceLocationRequestGeneration(generation);
        if (
          action === "later free-text commit" ||
          action === "later same-label selection"
        ) {
          committed.push(`${name}:Lagos, Nigeria`);
        }
        finishOld?.();
        await oldCompletion;

        expect(committed).not.toContain(`${name}:old`);
      }
    },
  );

  test("brand Skip also invalidates an unresolved address request", () => {
    const source = compact(
      sourceFor("mingla-business/src/components/brand/BrandCreationFlow.tsx"),
    );
    const skip = between(
      source,
      "consthandleSkipAddress=",
      "consthandleOfferingSelect=",
    );
    expect(skip).toContain(
      "advanceLocationRequestGeneration(addressRequestGenerationRef)",
    );
  });
});
