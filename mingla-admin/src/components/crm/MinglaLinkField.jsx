import { useEffect, useRef, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { CONTROL_CLASS, LABEL_CLASS, Segmented } from "./fields";
import { errorWords } from "../../lib/crmModel";
import { linkSearch } from "../../services/crmService";

const KINDS = [
  { value: "brand", label: "Brand" },
  { value: "place", label: "Place" },
];

/**
 * Hosts only: the link from a pipeline record to a brand or a place that is
 * already in Mingla. Linking a brand can move the card by itself (to Onboarded,
 * or to Live when the brand has a public listing); the block says so before
 * anyone changes a link that a Live card depends on.
 */
export function MinglaLinkField({ record, links, disabled = false, saving = false, onSave }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("brand");
  const [query, setQuery] = useState("");
  // The answer to one search, remembered with the question it answers, so a
  // slow reply to an earlier question is never shown for a later one.
  const [answer, setAnswer] = useState({ key: "", results: [], error: "" });
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef(null);

  const term = query.trim();
  const askKey = open && term.length >= 2 ? `${kind}:${term}:${attempt}` : "";
  useEffect(() => {
    if (!askKey) return undefined;
    let live = true;
    const t = setTimeout(() => {
      linkSearch(kind, term).then(
        (data) => {
          if (live) setAnswer({ key: askKey, results: Array.isArray(data?.results) ? data.results : [], error: "" });
        },
        (err) => {
          if (live) setAnswer({ key: askKey, results: [], error: errorWords(err) });
        }
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [askKey, kind, term]);
  const search = !askKey
    ? { state: "idle", results: [], error: "" }
    : answer.key !== askKey
      ? { state: "loading", results: [], error: "" }
      : { state: answer.error ? "error" : "done", results: answer.results, error: answer.error };

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const pick = async (row) => {
    const ok = await onSave(kind === "brand" ? { brand_id: row.id } : { place_pool_id: row.id });
    if (ok) {
      setOpen(false);
      setQuery("");
    }
  };

  const brand = links?.brand || null;
  const place = links?.place || null;
  const hasBrand = !!record.brand_id;
  const hasPlace = !!record.place_pool_id;
  const isLive = record.stage === "live";

  return (
    <div className="sm:col-span-2">
      <span className={LABEL_CLASS}>On Mingla</span>
      <div className="flex flex-col gap-2 rounded-lg border border-[var(--gray-200)] p-3">
        {!hasBrand && !hasPlace && (
          <p className="text-sm text-[var(--color-text-secondary)]">Not on Mingla yet</p>
        )}
        {hasPlace && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 break-words text-sm text-[var(--color-text-primary)]">
              Place in Mingla: <b>{place?.name || record.place_name || "no longer available"}</b>
              {place?.city ? <span className="text-[var(--color-text-tertiary)]"> · {place.city}</span> : null}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="max-sm:h-10"
              disabled={disabled || saving}
              onClick={() => onSave({ place_pool_id: null })}
            >
              Remove place link
            </Button>
          </div>
        )}
        {hasBrand && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 break-words text-sm text-[var(--color-text-primary)]">
              Brand in Mingla: <b>{brand?.name || record.brand_name || "no longer available"}</b>{" "}
              {brand ? (
                brand.is_live ? (
                  <Badge variant="success">Live</Badge>
                ) : (
                  <Badge variant="default">No public listing yet</Badge>
                )
              ) : null}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="max-sm:h-10"
              disabled={disabled || saving}
              onClick={() => onSave({ brand_id: null })}
            >
              Remove brand link
            </Button>
          </div>
        )}
        {hasBrand && isLive && (
          <p className="text-xs text-[var(--color-text-tertiary)]">
            This host is Live because of this brand. Changing or removing the link moves the card back to
            Onboarded, unless the new brand also has a public listing.
          </p>
        )}
        {!hasBrand && !isLive && (
          <p className="text-xs text-[var(--color-text-tertiary)]">
            Linking a brand moves the card to Onboarded. It moves to Live by itself once the brand has a
            public listing.
          </p>
        )}

        {!open ? (
          <div>
            <Button
              variant="secondary"
              size="sm"
              className="max-sm:h-10"
              disabled={disabled || saving}
              onClick={() => setOpen(true)}
            >
              {hasBrand || hasPlace ? "Link a different brand or place" : "Link a brand or place"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 border-t border-[var(--gray-200)] pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Segmented label="Search for" options={KINDS} value={kind} onChange={setKind} disabled={saving} />
              <Button variant="ghost" size="sm" className="max-sm:h-10" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              maxLength={80}
              disabled={disabled || saving}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={kind === "brand" ? "Search Mingla brands" : "Search Mingla places"}
              placeholder={kind === "brand" ? "Type a brand name" : "Type a place name"}
              className={CONTROL_CLASS}
            />
            <div aria-live="polite">
              {term.length < 2 && (
                <p className="text-xs text-[var(--color-text-tertiary)]">Type 2 or more letters to search.</p>
              )}
              {search.state === "loading" && (
                <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
                  <Spinner size="sm" /> Searching…
                </div>
              )}
              {search.state === "error" && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-error-700)]">
                  <span>{search.error}</span>
                  <Button variant="secondary" size="sm" className="max-sm:h-10" onClick={() => setAttempt((n) => n + 1)}>
                    Try again
                  </Button>
                </div>
              )}
              {search.state === "done" && search.results.length === 0 && (
                <p className="text-xs text-[var(--color-text-tertiary)]">
                  Nothing found. Check the spelling, or leave it unlinked for now.
                </p>
              )}
            </div>
            {search.state === "done" && search.results.length > 0 && (
              <ul className="flex flex-col gap-1">
                {search.results.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      disabled={disabled || saving}
                      onClick={() => pick(row)}
                      className="flex min-h-10 w-full cursor-pointer flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--gray-200)] px-3 py-1.5 text-left text-sm hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="min-w-0 break-words text-[var(--color-text-primary)]">
                        <b>{row.name}</b>
                        {row.city ? <span className="text-[var(--color-text-tertiary)]"> · {row.city}</span> : null}
                      </span>
                      {kind === "brand" &&
                        (row.is_live ? (
                          <Badge variant="success">Live</Badge>
                        ) : (
                          <Badge variant="default">No public listing yet</Badge>
                        ))}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
