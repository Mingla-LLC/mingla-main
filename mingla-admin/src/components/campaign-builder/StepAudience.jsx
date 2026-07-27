/**
 * ISSUE-864 WP4 → ISSUE-989 [Campaign Builder real targeting]. The Audience step
 * now ships REAL city + radius + interest targeting behind the (now-live)
 * admin-ad-targeting-search proxy, replacing the country-only default:
 *   - City typeahead (debounced → the proxy) that DISAMBIGUATES by country so
 *     'London' resolves to London/GB, not London/Canada. Each picked city
 *     carries the resolved Meta key + Google name + (when TikTok is in the set)
 *     a TikTok city location_id.
 *   - A radius control (Meta city radius, 1-50 mi).
 *   - An interest multi-select typeahead (Meta + TikTok real taxonomies, each
 *     chip platform-tagged; Reddit takes free-text interest NAMES).
 *   - Age + gender with per-channel honesty (which platforms actually honor them).
 * Country stays the fallback whenever no city is chosen.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { AlertCard } from "../ui/Card";
import { Input } from "../ui/Input";
import { SearchInput } from "../ui/SearchInput";
import { MultiSelect } from "../ui/MultiSelect";
import { TARGETING_SEARCH_PROXY_ENABLED } from "../../lib/adBuilder/flags";
import { searchTargeting } from "../../services/adEngineService";
import {
  CITY_SEARCH_PLATFORMS,
  INTEREST_SEARCH_PLATFORMS,
  DEFAULT_RADIUS_MI,
  RADIUS_BOUNDS,
  clampRadius,
} from "../../lib/adBuilder/targeting";
import {
  COUNTRY_OPTIONS,
  GENDER_OPTIONS,
  REDDIT_AGE_PASSTHROUGH_NOTE,
  validateAudience,
} from "../../lib/adBuilder/audienceRules";

const PLATFORM_LABEL = {
  meta: "Meta",
  tiktok: "TikTok",
  google: "Google",
  snapchat: "Snapchat",
  reddit: "Reddit",
};

/** Small debounced-search hook — one in-flight request, latest wins. */
function useDebouncedResults(runner, deps, delay = 300) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState(null);
  const seq = useRef(0);
  useEffect(() => {
    const q = deps.q;
    if (!q || q.trim().length < 2) {
      setResults([]);
      setLoading(false);
      setWarning(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const { items, warning: w } = await runner();
      if (mine !== seq.current) return; // a newer keystroke superseded this one
      setResults(items);
      setWarning(w ?? null);
      setLoading(false);
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.q, deps.country, deps.key]);
  return { results, loading, warning, reset: () => setResults([]) };
}

export function StepAudience({ audience, onAudienceChange, channelRows }) {
  const errors = validateAudience(audience);
  const set = (patch) => onAudienceChange({ ...audience, ...patch });

  const pickedPlatforms = channelRows.filter((r) => r.eligible).map((r) => r.platform);
  const cityPlatforms = CITY_SEARCH_PLATFORMS.filter((p) => pickedPlatforms.includes(p));
  const interestPlatforms = INTEREST_SEARCH_PLATFORMS.filter((p) => pickedPlatforms.includes(p));
  const redditEligible = pickedPlatforms.includes("reddit");

  const cities = audience.cities ?? [];
  const interests = audience.interests ?? [];
  const radius = audience.radius ?? DEFAULT_RADIUS_MI;
  const distanceUnit = audience.distanceUnit ?? "mile";

  // ── City typeahead ──────────────────────────────────────────────────────────
  const [cityQuery, setCityQuery] = useState("");
  const [cityCountry, setCityCountry] = useState(audience.countries?.[0] ?? "US");
  const [resolvingCity, setResolvingCity] = useState(false);
  const cityRunner = useCallback(async () => {
    const { data } = await searchTargeting({ platform: "meta", kind: "city", q: cityQuery, country: cityCountry });
    return { items: data?.results ?? [], warning: data?.warning };
  }, [cityQuery, cityCountry]);
  const citySearch = useDebouncedResults(cityRunner, { q: cityQuery, country: cityCountry, key: "city" });

  const addCity = async (result) => {
    const cc = result.meta?.country_code ?? cityCountry;
    const cityName = result.meta?.city ?? result.name;
    const chip = {
      id: `${result.id}`,
      label: result.name,
      country: cc,
      meta: result.meta?.key ? { key: String(result.meta.key) } : null,
      google: cityName && cc ? { name: cityName, country_code: cc } : null,
      tiktok: null,
    };
    // Resolve a TikTok city location_id only when TikTok is in the picked set.
    if (pickedPlatforms.includes("tiktok")) {
      setResolvingCity(true);
      try {
        const { data } = await searchTargeting({ platform: "tiktok", kind: "city", q: cityName, country: cc });
        const first = (data?.results ?? [])[0];
        if (first?.id) chip.tiktok = { location_ids: [String(first.id)] };
      } catch {
        chip.tiktok = null;
      } finally {
        setResolvingCity(false);
      }
    }
    if (!cities.some((c) => c.id === chip.id)) set({ cities: [...cities, chip] });
    setCityQuery("");
    citySearch.reset();
  };
  const removeCity = (id) => set({ cities: cities.filter((c) => c.id !== id) });

  // ── Interest typeahead (Meta + TikTok real taxonomies) ──────────────────────
  const [interestQuery, setInterestQuery] = useState("");
  // ISSUE-992: Google (affinity/in-market) + Snapchat (SCLS) join Meta + TikTok
  // in the interest typeahead (Google gated by INTEREST_SEARCH_PLATFORMS, the
  // G-4 seam). Reddit stays free-text (handled separately below).
  const searchablePlatforms = interestPlatforms.filter(
    (p) => p === "meta" || p === "tiktok" || p === "google" || p === "snapchat",
  );
  const interestRunner = useCallback(async () => {
    const calls = await Promise.all(
      searchablePlatforms.map(async (platform) => {
        const { data } = await searchTargeting({ platform, kind: "interest", q: interestQuery });
        return (data?.results ?? []).map((r) => ({ platform, id: String(r.id), name: r.name }));
      }),
    );
    return { items: calls.flat(), warning: null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interestQuery, searchablePlatforms.join(",")]);
  const interestSearch = useDebouncedResults(interestRunner, {
    q: interestQuery,
    country: "",
    key: searchablePlatforms.join(","),
  });

  const addInterest = (chip) => {
    if (!interests.some((i) => i.platform === chip.platform && i.id === chip.id)) {
      set({ interests: [...interests, chip] });
    }
    setInterestQuery("");
    interestSearch.reset();
  };
  const removeInterest = (platform, id) =>
    set({ interests: interests.filter((i) => !(i.platform === platform && i.id === id)) });

  // Reddit free-text interest names.
  const [redditInterest, setRedditInterest] = useState("");
  const addRedditInterest = () => {
    const name = redditInterest.trim();
    if (name) addInterest({ platform: "reddit", id: name, name });
    setRedditInterest("");
  };

  if (!TARGETING_SEARCH_PROXY_ENABLED) {
    return (
      <div className="p-3 rounded-lg border border-dashed border-[var(--gray-300)] text-xs text-[var(--color-text-tertiary)]">
        City + radius targeting arrives with the targeting-search proxy. Until then, campaigns
        target whole countries.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Who should see this?</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Country + age is the recommended broad shape. Add cities to laser-target a venue's
          neighborhood, and interests to reach the right crowd.
        </p>
      </div>

      <MultiSelect
        label="Countries"
        options={COUNTRY_OPTIONS}
        values={audience.countries}
        onChange={(countries) => {
          set({ countries });
          if (!countries.includes(cityCountry) && countries[0]) setCityCountry(countries[0]);
        }}
        helper="Prefilled with the live markets — edit freely. Country is the fallback when no city is picked."
      />

      {/* ── City + radius targeting (A4.f — the highest-leverage venue field) ── */}
      {cityPlatforms.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="block text-sm font-medium">Cities (optional)</span>
            <label className="text-xs text-[var(--color-text-tertiary)] flex items-center gap-1.5">
              Search in
              <select
                value={cityCountry}
                onChange={(e) => setCityCountry(e.target.value)}
                className="h-7 rounded-md border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-xs"
              >
                {(audience.countries ?? []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="relative">
            <SearchInput
              value={cityQuery}
              onChange={(e) => setCityQuery(e.target.value)}
              onClear={() => { setCityQuery(""); citySearch.reset(); }}
              placeholder={`Type a city (disambiguated to ${cityCountry})…`}
            />
            {(citySearch.loading || citySearch.results.length > 0) && cityQuery.trim().length >= 2 && (
              <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-lg">
                {citySearch.loading && (
                  <li className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--color-text-tertiary)]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
                  </li>
                )}
                {!citySearch.loading && citySearch.results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => addCity(r)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--gray-50)] cursor-pointer"
                    >
                      {r.name}
                    </button>
                  </li>
                ))}
                {!citySearch.loading && citySearch.results.length === 0 && (
                  <li className="px-3 py-2 text-xs text-[var(--color-text-tertiary)]">
                    {citySearch.warning ?? "No matches."}
                  </li>
                )}
              </ul>
            )}
          </div>

          {cities.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {cities.map((c) => {
                const on = [c.meta && "Meta", c.google && "Google", c.tiktok && "TikTok"].filter(Boolean);
                return (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1.5 h-8 pl-3 pr-1.5 text-xs font-medium rounded-full border border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                  >
                    {c.label}
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">{on.join(" · ")}</span>
                    <button
                      type="button"
                      onClick={() => removeCity(c.id)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-[var(--color-brand-100)] cursor-pointer"
                      aria-label={`Remove ${c.label}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
              {resolvingCity && <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-tertiary)]" />}
            </div>
          )}

          {cities.length > 0 && (pickedPlatforms.includes("meta") || pickedPlatforms.includes("snapchat")) && (
            <div className="flex items-center gap-3 max-w-sm pt-1">
              <label className="text-xs font-medium whitespace-nowrap">Radius (Meta &amp; Snap)</label>
              <input
                type="range"
                min={RADIUS_BOUNDS[distanceUnit].min}
                max={RADIUS_BOUNDS[distanceUnit].max}
                value={radius}
                onChange={(e) => set({ radius: clampRadius(e.target.value, distanceUnit) })}
                className="flex-1"
                aria-label="Radius around each city"
              />
              <span className="text-xs tabular-nums w-14 text-right">{radius} {distanceUnit === "mile" ? "mi" : "km"}</span>
            </div>
          )}
          {cities.some((c) => !c.tiktok) && pickedPlatforms.includes("tiktok") && (
            <p className="text-[11px] text-[var(--color-text-tertiary)]">
              A city without a TikTok tag isn't available on TikTok — those campaigns fall back to
              country targeting for that city.
            </p>
          )}
        </div>
      )}

      {/* ── Interest targeting (Meta + TikTok + Google + Snapchat — ISSUE-992) ── */}
      {searchablePlatforms.length > 0 && (
        <div className="space-y-2">
          <span className="block text-sm font-medium">Interests (optional)</span>
          <div className="relative">
            <SearchInput
              value={interestQuery}
              onChange={(e) => setInterestQuery(e.target.value)}
              onClear={() => { setInterestQuery(""); interestSearch.reset(); }}
              placeholder="Type an interest (e.g. nightlife, food)…"
            />
            {(interestSearch.loading || interestSearch.results.length > 0) && interestQuery.trim().length >= 2 && (
              <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-lg">
                {interestSearch.loading && (
                  <li className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--color-text-tertiary)]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
                  </li>
                )}
                {!interestSearch.loading && interestSearch.results.map((r) => (
                  <li key={`${r.platform}:${r.id}`}>
                    <button
                      type="button"
                      onClick={() => addInterest(r)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-[var(--gray-50)] cursor-pointer"
                    >
                      <span>{r.name}</span>
                      <span className="text-[10px] text-[var(--color-text-tertiary)]">{PLATFORM_LABEL[r.platform]}</span>
                    </button>
                  </li>
                ))}
                {!interestSearch.loading && interestSearch.results.length === 0 && (
                  <li className="px-3 py-2 text-xs text-[var(--color-text-tertiary)]">No matches.</li>
                )}
              </ul>
            )}
          </div>
          {interests.filter((i) => i.platform !== "reddit").length > 0 && (
            <div className="flex flex-wrap gap-2">
              {interests.filter((i) => i.platform !== "reddit").map((i) => (
                <span
                  key={`${i.platform}:${i.id}`}
                  className="inline-flex items-center gap-1.5 h-8 pl-3 pr-1.5 text-xs font-medium rounded-full border border-[var(--gray-300)] bg-[var(--gray-50)]"
                >
                  {i.name}
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">{PLATFORM_LABEL[i.platform]}</span>
                  <button
                    type="button"
                    onClick={() => removeInterest(i.platform, i.id)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-[var(--gray-200)] cursor-pointer"
                    aria-label={`Remove ${i.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {redditEligible && (
        <div className="space-y-2">
          <span className="block text-sm font-medium">Reddit interests (optional)</span>
          <div className="flex gap-2 max-w-sm">
            <Input
              value={redditInterest}
              onChange={(e) => setRedditInterest(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRedditInterest(); } }}
              placeholder="e.g. nightlife"
            />
            <button
              type="button"
              onClick={addRedditInterest}
              className="h-10 px-3 text-xs font-medium rounded-lg border border-[var(--gray-300)] hover:bg-[var(--gray-50)] cursor-pointer whitespace-nowrap"
            >
              Add
            </button>
          </div>
          {interests.filter((i) => i.platform === "reddit").length > 0 && (
            <div className="flex flex-wrap gap-2">
              {interests.filter((i) => i.platform === "reddit").map((i) => (
                <span
                  key={`reddit:${i.id}`}
                  className="inline-flex items-center gap-1.5 h-8 pl-3 pr-1.5 text-xs font-medium rounded-full border border-[var(--gray-300)] bg-[var(--gray-50)]"
                >
                  {i.name}
                  <button
                    type="button"
                    onClick={() => removeInterest("reddit", i.id)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-[var(--gray-200)] cursor-pointer"
                    aria-label={`Remove ${i.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Age + gender ── */}
      <div className="grid grid-cols-2 gap-3 max-w-xs">
        <Input
          label="Age min"
          type="number"
          min={13}
          max={65}
          value={audience.ageMin}
          onChange={(e) => set({ ageMin: e.target.value === "" ? "" : Number(e.target.value) })}
        />
        <Input
          label="Age max"
          type="number"
          min={13}
          max={65}
          value={audience.ageMax}
          onChange={(e) => set({ ageMax: e.target.value === "" ? "" : Number(e.target.value) })}
          helper="65 means 65 and over."
        />
      </div>

      <div role="radiogroup" aria-label="Gender" className="space-y-1.5">
        <span className="block text-sm font-medium">Gender</span>
        <div className="inline-flex rounded-lg border border-[var(--gray-300)] p-0.5">
          {GENDER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={audience.gender === option.value}
              onClick={() => set({ gender: option.value })}
              className={[
                "h-8 px-3 text-xs font-medium rounded-md transition-colors",
                audience.gender === option.value
                  ? "bg-[var(--color-brand-500)] text-white"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]",
              ].join(" ")}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[var(--color-text-tertiary)]">
          Age applies to Meta, TikTok, Snapchat and Google (Reddit can't target age). Gender
          applies to Meta, TikTok, Snapchat, Google and Reddit. City radius applies to Meta and
          Snapchat; Google targets the whole city (radius coming later).
        </p>
      </div>

      {redditEligible && (
        <AlertCard variant="info" title="Reddit note">
          {REDDIT_AGE_PASSTHROUGH_NOTE}
        </AlertCard>
      )}

      {errors.map((message) => (
        <p key={message} className="text-xs text-[#ef4444]">{message}</p>
      ))}
    </div>
  );
}
