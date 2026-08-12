export function TargetSelector({ appKey, os, onChange }) {
  return <section aria-labelledby="target-selector-heading" className="space-y-4">
    <h4 id="target-selector-heading" className="text-base font-semibold">Selected target</h4>
    <div role="tablist" aria-label="App" className="grid grid-cols-1 gap-2 @[480px]:grid-cols-2">
      {[['explorer','Explorer'],['business','Business']].map(([value,label]) => <button key={value} id={`app-tab-${value}`} role="tab" aria-selected={appKey === value} onClick={() => onChange(value, os)} className={`min-h-11 rounded-lg border px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2 ${appKey === value ? "border-[var(--color-brand-700)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)]"}`}>{label}</button>)}
    </div>
    <fieldset><legend className="mb-2 text-sm font-semibold">Platform</legend><div className="grid grid-cols-1 gap-2 @[480px]:grid-cols-2">
      {[['ios','iOS'],['android','Android']].map(([value,label]) => <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-4 text-sm font-semibold focus-within:ring-2 focus-within:ring-[var(--color-brand-700)] ${os === value ? "border-[var(--color-brand-700)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)]"}`}><input type="radio" name="readiness-os" value={value} checked={os === value} onChange={() => onChange(appKey, value)} />{label}</label>)}
    </div></fieldset>
  </section>;
}
