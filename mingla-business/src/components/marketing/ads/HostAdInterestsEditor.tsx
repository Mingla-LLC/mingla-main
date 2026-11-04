/**
 * #4238 media-buyer — interests matched on each app separately. Each app
 * shows its own name for the interest; "Pick a different <App> interest"
 * searches that one app's own list and swaps its match (Seth's decision a).
 */
import React, { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { Input } from "../../ui/Input";
import { text as textTokens } from "../../../constants/designSystem";
import { platformName } from "./hostAdCopy";
import { HOST_AD_APP_BADGES, hostAdStyles as s } from "./hostAdBuilderStyles";
import {
  type HostAdApp,
  type HostAdInterestPick,
  hostAdInterestAppStatus,
  hostAdInterestKey,
  swapInterestOnApp,
} from "./hostAdTargeting";

export type HostAdInterestResult = { id: string; name: string };

export interface HostAdInterestsEditorProps {
  interests: readonly HostAdInterestPick[];
  apps: readonly HostAdApp[];
  checking: ReadonlySet<string>;
  busy: boolean;
  /** Search one app's own interest list (the first ready app when null). */
  onSearch: (query: string, app: HostAdApp | null) => Promise<HostAdInterestResult[]>;
  onAdd: (name: string) => void;
  onChange: (key: string, interest: HostAdInterestPick) => void;
  onRemove: (key: string) => void;
  onRetry: (key: string, app: HostAdApp) => void;
}

export function HostAdInterestsEditor(
  props: HostAdInterestsEditorProps,
): React.ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<HostAdInterestResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Decision (a): one interest on one app being swapped.
  const [swap, setSwap] = useState<{ key: string; app: HostAdApp } | null>(null);
  const [swapQuery, setSwapQuery] = useState("");
  const [swapResults, setSwapResults] = useState<HostAdInterestResult[]>([]);

  const search = async (): Promise<void> => {
    if (query.trim().length < 2) return;
    setSearching(true);
    setNote(null);
    try {
      const found = await props.onSearch(query.trim(), null);
      setResults(found);
      if (found.length === 0) setNote("Nothing like that yet. Try a more general word.");
    } catch {
      setNote("Search didn't work just now. Try again.");
    } finally {
      setSearching(false);
    }
  };

  const searchSwap = async (): Promise<void> => {
    if (!swap || swapQuery.trim().length < 2) return;
    setSearching(true);
    try {
      setSwapResults(await props.onSearch(swapQuery.trim(), swap.app));
    } catch {
      setSwapResults([]);
      setNote(`Couldn't check ${platformName(swap.app)}. Try again.`);
    } finally {
      setSearching(false);
    }
  };

  return (
    <View style={s.block} testID="host-ad-interests">
      <View style={s.searchRow}>
        <View style={s.searchInput}>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Live music, nightlife…"
            accessibilityLabel="Search target interest"
          />
        </View>
        <Pressable
          style={s.searchButton}
          onPress={() => void search()}
          disabled={searching || props.busy || query.trim().length < 2}
          accessibilityRole="button"
          accessibilityLabel="Search interests"
          testID="host-ad-interest-search"
        >
          {searching ? (
            <ActivityIndicator size="small" color={textTokens.primary} />
          ) : (
            <Text style={s.searchButtonLabel}>Search</Text>
          )}
        </Pressable>
      </View>
      {note ? <Text style={s.helper}>{note}</Text> : null}
      {results.map((result) => (
        <Pressable
          key={`interest-result-${result.id}`}
          style={s.result}
          onPress={() => {
            props.onAdd(result.name);
            setQuery("");
            setResults([]);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Target interest ${result.name}`}
        >
          <Text style={s.title}>{result.name}</Text>
          <Text style={s.linkLabel}>Add</Text>
        </Pressable>
      ))}
      {props.interests.map((interest) => {
        const key = hostAdInterestKey(interest.name);
        return (
          <View key={key} style={s.card} testID="host-ad-interest">
            <View style={s.cardHead}>
              <Text style={s.title}>{interest.name}</Text>
              <Pressable
                style={s.linkButton}
                onPress={() => props.onRemove(key)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${interest.name}`}
              >
                <Text style={s.removeLabel}>Remove</Text>
              </Pressable>
            </View>
            {props.apps.map((app) => {
              const status = props.checking.has(`${key}|${app}`)
                ? { state: "checking" as const, text: `Checking ${platformName(app)}…` }
                : hostAdInterestAppStatus(interest, app);
              const swapping = swap?.key === key && swap.app === app;
              return (
                <View key={app} style={s.appRow} testID={`host-ad-interest-app-${app}`}>
                  <View style={s.appBadge}>
                    <Text style={s.appBadgeLabel}>{HOST_AD_APP_BADGES[app]}</Text>
                  </View>
                  <View style={s.appText}>
                    <Text
                      style={
                        status.state === "ok" || status.state === "free"
                          ? s.ok
                          : status.state === "missing"
                            ? s.error
                            : status.state === "error"
                              ? s.warn
                              : s.faint
                      }
                    >
                      {status.text}
                    </Text>
                    {status.state === "error" ? (
                      <Pressable
                        style={s.linkButton}
                        onPress={() => props.onRetry(key, app)}
                        accessibilityRole="button"
                        accessibilityLabel={`Try ${platformName(app)} again`}
                      >
                        <Text style={s.linkLabel}>Try again</Text>
                      </Pressable>
                    ) : null}
                    {app !== "reddit" &&
                    (status.state === "ok" || status.state === "missing") ? (
                      <Pressable
                        style={s.linkButton}
                        onPress={() => {
                          setSwap(swapping ? null : { key, app });
                          setSwapQuery(interest.name);
                          setSwapResults([]);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Pick a different ${platformName(app)} interest`}
                        testID={`host-ad-interest-swap-${app}`}
                      >
                        <Text style={s.linkLabel}>
                          Pick a different {platformName(app)} interest
                        </Text>
                      </Pressable>
                    ) : null}
                    {swapping ? (
                      <View style={s.block}>
                        <View style={s.searchRow}>
                          <View style={s.searchInput}>
                            <Input
                              value={swapQuery}
                              onChangeText={setSwapQuery}
                              placeholder={`Search ${platformName(app)} interests`}
                              accessibilityLabel={`Search ${platformName(app)} interests`}
                            />
                          </View>
                          <Pressable
                            style={s.searchButton}
                            onPress={() => void searchSwap()}
                            disabled={searching || swapQuery.trim().length < 2}
                            accessibilityRole="button"
                            accessibilityLabel={`Search ${platformName(app)} interests`}
                            testID={`host-ad-interest-swap-search-${app}`}
                          >
                            <Text style={s.searchButtonLabel}>Search</Text>
                          </Pressable>
                        </View>
                        {swapResults.map((result) => (
                          <Pressable
                            key={`swap-${result.id}`}
                            style={s.result}
                            onPress={() => {
                              props.onChange(key, swapInterestOnApp(interest, app, result));
                              setSwap(null);
                              setSwapResults([]);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`Use ${result.name} on ${platformName(app)}`}
                            testID={`host-ad-interest-swap-result-${app}`}
                          >
                            <Text style={s.title}>{result.name}</Text>
                            <Text style={s.linkLabel}>Use</Text>
                          </Pressable>
                        ))}
                      </View>
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
