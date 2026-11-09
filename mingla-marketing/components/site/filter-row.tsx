'use client'
import { useMemo, useState, type ReactNode } from 'react'

// #4339 phase 2b — the design's filter row and a grid it filters.
//
// FilterChips: ONE row of <button aria-pressed> chips. It never wraps and never
// squashes: on a narrow screen it scrolls sideways (swipe), each chip keeps
// its full label and a 44px tap height (pages.css .tabs).
//
// FilterGrid: server-rendered items, each tagged with the chips it belongs to.
// The server HTML (and every render before a chip is pressed) shows ALL items,
// so search engines and no-JavaScript visitors get the full list; a chip only
// hides what is already there. A live region says how many are showing.

export const FILTER_ALL = 'All'

interface FilterChipsProps {
  /** Accessible name of the group ("Filter guides"). */
  label: string
  options: readonly string[]
  value: string
  onChange: (next: string) => void
  className?: string
}

export function FilterChips({ label, options, value, onChange, className }: FilterChipsProps) {
  return (
    <div role="group" aria-label={label} className={className ? `tabs ${className}` : 'tabs'} data-filter-row="">
      {options.map((option) => (
        <button key={option} type="button" aria-pressed={option === value} onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </div>
  )
}

export interface FilterItem {
  key: string
  /** The chips this item shows under (besides "All"). */
  tags: readonly string[]
  node: ReactNode
}

interface FilterGridProps {
  label: string
  /** Chip labels after "All", in order. */
  options: readonly string[]
  items: readonly FilterItem[]
  gridClassName: string
  /** What the live region calls one item ("guide", "post"). */
  noun: string
  /** Shown when a chip matches nothing. */
  empty: ReactNode
  /** Rendered between the chips and the grid (a wide feature tile). */
  between?: ReactNode
}

export function FilterGrid({ label, options, items, gridClassName, noun, empty, between }: FilterGridProps) {
  const [value, setValue] = useState(FILTER_ALL)
  const visible = useMemo(
    () => (value === FILTER_ALL ? items : items.filter((item) => item.tags.includes(value))),
    [items, value],
  )
  const announcement =
    value === FILTER_ALL ? '' : `Showing ${visible.length} ${visible.length === 1 ? noun : `${noun}s`} for ${value}`

  return (
    <>
      <div className="tabs-wrap">
        <FilterChips label={label} options={[FILTER_ALL, ...options]} value={value} onChange={setValue} />
      </div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      {between}
      {visible.length ? (
        <ul className={gridClassName} data-filter-grid="" data-filter={value}>
          {visible.map((item) => (
            <li key={item.key} data-tags={item.tags.join('|')}>
              {item.node}
            </li>
          ))}
        </ul>
      ) : (
        <p className="filter-note">{empty}</p>
      )}
    </>
  )
}
