import { useRef, useState } from "react";
import { SearchInput } from "../ui/SearchInput";
import { FilterSelect } from "../ui/FilterSelect";
import { MISSING_CITY, MISSING_CITY_LABEL } from "./fields";
import { MissingCityLayer } from "./MissingCityLayer";
import { NO_REGION, ownerLabel, regionSlug } from "../../lib/crmModel";
import { OWNER_NONE } from "../../lib/crmUrl";
import { DUE_OPTIONS } from "../../lib/outreachView";

/**
 * Issue #4255 — the one filter row of Hosts and creators: search, then four
 * dropdowns (Owner, Due, Type, Region). Every filter filters the funnel and
 * the board together, and lives in the address: each control writes through
 * onChange(patch, { replace: true }). The board is the only view (D8), so
 * there is no view switch.
 */
export function PipelineToolbar({
  pipeline,
  state,
  def,
  regions,
  team = [],
  me = "",
  hasNoRegion = false,
  disabled = false,
  canAddRegion = false,
  onRefreshRegions,
  onChange,
}) {
  const [cityMissing, setCityMissing] = useState(false);
  const regionRef = useRef(null);
  const closeCityMissing = () => {
    setCityMissing(false);
    regionRef.current?.querySelector?.("select")?.focus();
  };
  const icpOptions = [{ value: "", label: "Any" }, ...(def?.icps || []).map((i) => ({ value: i.id, label: i.label }))];
  const regionOptions = [
    { value: "", label: "Any" },
    ...(regions || []).map((r) => ({ value: regionSlug(r.name), label: r.is_live ? r.name : `${r.name} (not live yet)` })),
  ];
  if (hasNoRegion || state.region === NO_REGION) regionOptions.push({ value: NO_REGION, label: "No region yet" });
  regionOptions.push({ value: MISSING_CITY, label: MISSING_CITY_LABEL });
  const mates = (Array.isArray(team) ? team : []).filter((p) => p?.email && p.email !== me);
  const ownerOptions = [
    { value: "", label: "Everyone" },
    { value: "mine", label: "Mine" },
    ...mates.map((p) => ({ value: p.email, label: ownerLabel(p.email, team) })),
    { value: OWNER_NONE, label: "Unassigned" },
  ];
  if (state.owner && state.owner !== OWNER_NONE && !ownerOptions.some((o) => o.value === state.owner)) {
    ownerOptions.splice(ownerOptions.length - 1, 0, { value: state.owner, label: state.owner });
  }
  const ownerValue = state.mine ? "mine" : state.owner || "";

  return (
    <div data-pipeline-filters="" className="flex flex-wrap items-center gap-2">
      <SearchInput
        className="w-full sm:w-64"
        inputClassName="min-h-11"
        value={state.q}
        disabled={disabled}
        placeholder="Search by name, email, phone or handle"
        aria-label="Search"
        maxLength={80}
        onChange={(e) => onChange({ q: e.target.value }, { replace: true })}
        onClear={() => onChange({ q: "" }, { replace: true })}
      />
      <FilterSelect
        name="owner"
        label="Owner"
        value={ownerValue}
        disabled={disabled}
        options={ownerOptions}
        onChange={(v) => onChange(v === "mine" ? { mine: true, owner: "" } : { mine: false, owner: v }, { replace: true })}
      />
      <FilterSelect name="due" label="Due" value={state.due} disabled={disabled} options={DUE_OPTIONS[pipeline] || DUE_OPTIONS.hosts} onChange={(v) => onChange({ due: v }, { replace: true })} />
      <FilterSelect name="icp" label="Type" value={state.icp} disabled={disabled} options={icpOptions} onChange={(v) => onChange({ icp: v }, { replace: true })} />
      <span ref={regionRef} className="contents">
        <FilterSelect
          name="region"
          label="Region"
          value={state.region}
          disabled={disabled}
          options={regionOptions}
          onChange={(v) => {
            // "City missing?" is a question, not a filter: the filter stays.
            if (v === MISSING_CITY) setCityMissing(true);
            else onChange({ region: v }, { replace: true });
          }}
        />
      </span>
      {cityMissing && (
        <MissingCityLayer canAddRegion={canAddRegion} onClose={closeCityMissing} onRefresh={onRefreshRegions} />
      )}
    </div>
  );
}
