/**
 * #4238 media-buyer — "Where should it run?": search in any chosen country,
 * add cities, regions or a pin, give each place its own distance, and see
 * each app's own match with one-tap choices (accept a wider area, try again).
 */
import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Input } from "../../ui/Input";
import { text as textTokens } from "../../../constants/designSystem";
import { hostAdPlaceName, platformName } from "./hostAdCopy";
import { countryName } from "./hostAdCountries";
import { HOST_AD_APP_BADGES, hostAdStyles as s } from "./hostAdBuilderStyles";
import {
  acceptWiderOffer,
  HOST_AD_DEFAULT_RADIUS_KM,
  HOST_AD_PLACE_KIND_LABELS,
  type HostAdApp,
  type HostAdAvailabilityRow,
  type HostAdPlace,
  type HostAdPlaceKind,
  hostAdExcludedAppStatus,
  hostAdPlaceAppStatus,
  hostAdPlaceKey,
  placeKind,
  undoWiderOffer,
} from "./hostAdTargeting";

export type HostAdPlaceSearchResult = {
  id: string;
  name: string;
  meta?: Record<string, unknown>;
};

export interface HostAdPlacesEditorProps {
  places: readonly HostAdPlace[];
  apps: readonly HostAdApp[];
  countries: readonly string[];
  availability: readonly HostAdAvailabilityRow[];
  /** Apps whose lookup for a place key is running. */
  checking: ReadonlySet<string>;
  busy: boolean;
  /** Search the first ready app's list in one country. */
  onSearch: (
    query: string,
    country: string,
    kind: HostAdPlaceKind,
  ) => Promise<HostAdPlaceSearchResult[]>;
  /** Add a picked place; the screen looks it up on every app. */
  onAdd: (place: HostAdPlace) => void;
  onChange: (key: string, place: HostAdPlace) => void;
  onRemove: (key: string) => void;
  onRetry: (key: string, app: HostAdApp) => void;
  /** Left-out places use the same editor in a smaller mode. */
  mode?: "include" | "exclude";
  testIDPrefix?: string;
}

const KINDS: HostAdPlaceKind[] = ["city", "region", "pin"];

function clampRadius(value: number): number {
  return Math.min(100, Math.max(1, Math.round(value)));
}

export function HostAdPlacesEditor(
  props: HostAdPlacesEditorProps,
): React.ReactElement {
  const mode = props.mode ?? "include";
  const prefix = props.testIDPrefix ?? "host-ad-places";
  const [searchCountry, setSearchCountry] = useState<string | null>(null);
  const [kind, setKind] = useState<HostAdPlaceKind>("city");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HostAdPlaceSearchResult[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  // #4238 P0 (F-3): any chosen country can be searched, not only the first.
  const country = searchCountry && props.countries.includes(searchCountry)
    ? searchCountry
    : props.countries[0] ?? null;
  const kinds = mode === "exclude" ? KINDS.filter((k) => k !== "pin") : KINDS;

  const runSearch = async (): Promise<void> => {
    if (!country || query.trim().length < 2) return;
    if (kind === "pin") {
      // A pin is an address; the point is found when the ad is checked.
      props.onAdd({
        name: query.trim(),
        countryCode: country,
        kind: "pin",
        radiusKm: 2,
        refs: {},
      });
      setQuery("");
      setResults([]);
      return;
    }
    setSearching(true);
    setNote(null);
    try {
      const found = await props.onSearch(query.trim(), country, kind);
      setResults(found);
      if (found.length === 0) {
        setNote(
          `No ${kind === "region" ? "region" : "city"} by that name in ${countryName(country)}. Try another spelling.`,
        );
      }
    } catch {
      setNote("Search didn't work just now. Try again.");
    } finally {
      setSearching(false);
    }
  };

  const pick = (result: HostAdPlaceSearchResult): void => {
    if (!country) return;
    const name = String(result.meta?.city ?? result.name).trim();
    if (!name) return;
    props.onAdd({
      name,
      countryCode: String(result.meta?.country_code ?? country).toUpperCase(),
      ...(kind === "region" ? { kind: "region" as const } : {}),
      ...(kind !== "region" && mode === "include"
        ? { radiusKm: HOST_AD_DEFAULT_RADIUS_KM }
        : {}),
      refs: {},
    });
    setQuery("");
    setResults([]);
  };

  return (
    <View style={s.block} testID={prefix}>
      {props.countries.length > 1 ? (
        <View style={s.chipRow} accessibilityLabel="Search in country">
          {props.countries.map((code) => (
            <Pressable
              key={code}
              style={[s.chip, country === code && s.chipSelected]}
              onPress={() => {
                setSearchCountry(code);
                setResults([]);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: country === code }}
              accessibilityLabel={`Search in ${countryName(code)}`}
              testID={`${prefix}-country-${code}`}
            >
              <Text style={s.chipLabel}>{countryName(code)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={s.chipRow}>
        {kinds.map((value) => (
          <Pressable
            key={value}
            style={[s.chip, kind === value && s.chipSelected]}
            onPress={() => {
              setKind(value);
              setResults([]);
              setNote(null);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: kind === value }}
            accessibilityLabel={HOST_AD_PLACE_KIND_LABELS[value]}
            testID={`${prefix}-kind-${value}`}
          >
            <Text style={s.chipLabel}>{HOST_AD_PLACE_KIND_LABELS[value]}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.searchRow}>
        <View style={s.searchInput}>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder={
              !country
                ? "Choose a country first"
                : kind === "pin"
                  ? `Address or venue in ${countryName(country)}`
                  : kind === "region"
                    ? `Search regions in ${countryName(country)}`
                    : `Search cities in ${countryName(country)}`
            }
            accessibilityLabel={
              mode === "exclude" ? "Search a place to leave out" : "Search a place"
            }
          />
        </View>
        <Pressable
          style={s.searchButton}
          onPress={() => void runSearch()}
          disabled={!country || searching || props.busy || query.trim().length < 2}
          accessibilityRole="button"
          accessibilityLabel={kind === "pin" ? "Add pin" : "Search places"}
          testID={`${prefix}-search`}
        >
          {searching ? (
            <ActivityIndicator size="small" color={textTokens.primary} />
          ) : (
            <Text style={s.searchButtonLabel}>{kind === "pin" ? "Add" : "Search"}</Text>
          )}
        </Pressable>
      </View>
      {note ? <Text style={s.helper}>{note}</Text> : null}
      {results.map((result) => (
        <Pressable
          key={`${result.id}:${result.name}`}
          style={s.result}
          onPress={() => pick(result)}
          accessibilityRole="button"
          accessibilityLabel={`${mode === "exclude" ? "Leave out" : "Add"} ${hostAdPlaceName(result.name)}`}
          testID={`${prefix}-result`}
        >
          <Text style={s.title}>{hostAdPlaceName(result.name)}</Text>
          <Text style={s.linkLabel}>{mode === "exclude" ? "Leave out" : "Add"}</Text>
        </Pressable>
      ))}
      {props.places.map((place) => {
        const key = hostAdPlaceKey(place);
        const radius = place.radiusKm ?? HOST_AD_DEFAULT_RADIUS_KM;
        const showRadius = mode === "include" && placeKind(place) !== "region";
        return (
          <View key={key} style={s.card} testID={`${prefix}-place`}>
            <View style={s.cardHead}>
              <View style={s.appText}>
                <Text style={s.title}>
                  {place.name}, {countryName(place.countryCode)}
                </Text>
                <Text style={s.faint}>{HOST_AD_PLACE_KIND_LABELS[placeKind(place)]}</Text>
              </View>
              <Pressable
                style={s.linkButton}
                onPress={() => props.onRemove(key)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${place.name}`}
              >
                <Text style={s.removeLabel}>Remove</Text>
              </Pressable>
            </View>
            {showRadius ? (
              <View style={s.stepper}>
                <Pressable
                  style={s.stepperButton}
                  onPress={() =>
                    props.onChange(key, { ...place, radiusKm: clampRadius(radius - 1) })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Shorter distance around ${place.name}`}
                  testID={`${prefix}-radius-down`}
                >
                  <Text style={s.stepperLabel}>−</Text>
                </Pressable>
                <Text
                  style={s.stepperValue}
                  accessibilityLabel={`Distance around ${place.name}: ${radius} kilometers`}
                  testID={`${prefix}-radius-value`}
                >
                  {radius} km
                </Text>
                <Pressable
                  style={s.stepperButton}
                  onPress={() =>
                    props.onChange(key, { ...place, radiusKm: clampRadius(radius + 1) })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Longer distance around ${place.name}`}
                  testID={`${prefix}-radius-up`}
                >
                  <Text style={s.stepperLabel}>+</Text>
                </Pressable>
              </View>
            ) : null}
            {props.apps.map((app) => {
              const status: ReturnType<typeof hostAdPlaceAppStatus> =
                mode === "exclude"
                  ? hostAdExcludedAppStatus(
                      place,
                      app,
                      props.checking.has(`${key}|${app}`),
                    )
                  : hostAdPlaceAppStatus(place, app, {
                      radiusKm: radius,
                      availability: props.availability,
                      checking: props.checking.has(`${key}|${app}`),
                    });
              const textStyle =
                status.state === "ok" || status.state === "accepted"
                  ? s.ok
                  : status.state === "error" ||
                      status.state === "radius" ||
                      status.state === "offer"
                    ? s.warn
                    : status.state === "missing"
                      ? s.error
                      : s.faint;
              return (
                <View key={app} style={s.appRow} testID={`${prefix}-app-${app}`}>
                  <View style={s.appBadge}>
                    <Text style={s.appBadgeLabel}>{HOST_AD_APP_BADGES[app]}</Text>
                  </View>
                  <View style={s.appText}>
                    <Text style={textStyle} accessibilityLabel={`${platformName(app)}: ${status.text}`}>
                      {status.text}
                    </Text>
                    {status.state === "offer" && status.offer ? (
                      <Pressable
                        style={s.acceptChip}
                        onPress={() => props.onChange(key, acceptWiderOffer(place, app))}
                        accessibilityRole="button"
                        accessibilityLabel={`Use ${status.offer.name} on ${platformName(app)}, wider area`}
                        testID={`${prefix}-accept-${app}`}
                      >
                        <Text style={s.acceptChipLabel}>
                          Use {status.offer.name} on {platformName(app)} (wider area)
                        </Text>
                      </Pressable>
                    ) : null}
                    {status.state === "accepted" ? (
                      <Pressable
                        style={s.linkButton}
                        onPress={() => props.onChange(key, undoWiderOffer(place, app))}
                        accessibilityRole="button"
                        accessibilityLabel={`Undo wider area on ${platformName(app)}`}
                      >
                        <Text style={s.linkLabel}>Undo</Text>
                      </Pressable>
                    ) : null}
                    {status.state === "error" ? (
                      <Pressable
                        style={s.linkButton}
                        onPress={() => props.onRetry(key, app)}
                        accessibilityRole="button"
                        accessibilityLabel={`Try ${platformName(app)} again`}
                        testID={`${prefix}-retry-${app}`}
                      >
                        <Text style={s.linkLabel}>Try again</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}
