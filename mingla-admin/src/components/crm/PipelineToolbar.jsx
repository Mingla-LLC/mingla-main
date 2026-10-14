import { useRef, useState } from "react";
import { SearchInput } from "../ui/SearchInput";
import { MISSING_CITY, MISSING_CITY_LABEL, Segmented, Select } from "./fields";
import { MissingCityLayer } from "./MissingCityLayer";
import { NO_REGION, regionSlug } from "../../lib/crmModel";

const VIEWS = [
  { value: "board", label: "Board" },
  { value: "list", label: "List" },
  { value: "region", label: "By region" },
];
const WHOSE = [
  { value: false, label: "Everyone" },
  { value: true, label: "Mine" },
];

/**
 * Search, ICP, region, Everyone/Mine and the three views. Each control writes
 * to the address through onChange(patch, { replace }): typing and filters
 * replace the address; switching view adds a history entry.
 */
export function PipelineToolbar({
  state,
  def,
  regions,
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
    regionRef.current?.focus();
  };
  const icpOptions = (def?.icps || []).map((i) => ({ value: i.id, label: i.label }));
  const regionOptions = (regions || []).map((r) => ({
    value: regionSlug(r.name),
    label: r.is_live ? r.name : `${r.name} (not live yet)`,
  }));
  if (hasNoRegion || state.region === NO_REGION) regionOptions.push({ value: NO_REGION, label: "No region yet" });
  regionOptions.push({ value: MISSING_CITY, label: MISSING_CITY_LABEL });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        className="w-full sm:w-64"
        value={state.q}
        disabled={disabled}
        placeholder="Search by name, email, phone or handle"
        aria-label="Search"
        maxLength={80}
        onChange={(e) => onChange({ q: e.target.value }, { replace: true })}
        onClear={() => onChange({ q: "" }, { replace: true })}
      />
      <Select
        aria-label="ICP"
        className="!w-full sm:!w-auto"
        value={state.icp}
        disabled={disabled}
        placeholder="All ICPs"
        options={icpOptions}
        onChange={(e) => onChange({ icp: e.target.value }, { replace: true })}
      />
      <Select
        aria-label="Region"
        ref={regionRef}
        className="!w-full sm:!w-auto"
        value={state.region}
        disabled={disabled}
        placeholder="All regions"
        options={regionOptions}
        onChange={(e) => {
          // "City missing?" is a question, not a filter: the filter stays.
          if (e.target.value === MISSING_CITY) setCityMissing(true);
          else onChange({ region: e.target.value }, { replace: true });
        }}
      />
      <Segmented
        label="Whose records"
        options={WHOSE}
        value={state.mine}
        disabled={disabled}
        onChange={(mine) => onChange({ mine }, { replace: true })}
      />
      <Segmented
        label="View"
        options={VIEWS}
        value={state.view}
        disabled={disabled}
        onChange={(view) => onChange({ view }, { replace: false })}
      />
      {cityMissing && (
        <MissingCityLayer canAddRegion={canAddRegion} onClose={closeCityMissing} onRefresh={onRefreshRegions} />
      )}
    </div>
  );
}
