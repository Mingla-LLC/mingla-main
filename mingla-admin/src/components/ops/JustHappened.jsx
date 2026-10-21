// Issue #3980 (R10) — "What just happened": the automatic changes on an
// event or a host card in the last three days, at most five lines. Hidden
// when there is nothing. Hide remembers the newest line per viewer, so the
// box comes back only for something newer.
import { useState } from "react";

const KEY = "mingla.justHappened.hidden";
const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";

function readHidden() {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { return {}; }
}
function writeHidden(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* storage unavailable: hiding lasts this visit only */ }
}

export function JustHappened({ target, items }) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && i.words).slice(0, 5);
  const newest = list[0]?.at || "";
  const [hidden, setHidden] = useState(() => readHidden()[target] || "");
  if (!list.length || (hidden && newest && newest <= hidden)) return null;
  const hide = () => {
    const map = readHidden();
    map[target] = newest;
    writeHidden(map);
    setHidden(newest);
  };
  return (
    <section aria-label="What just happened" className="flex min-w-0 flex-col gap-1.5 rounded-xl bg-[var(--color-success-50)] px-3 py-2.5 text-[13px]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-[var(--color-success-700)]">What just happened</h3>
        <button type="button" onClick={hide} className={`min-h-11 rounded-lg px-2 text-[12.5px] font-semibold text-[var(--color-success-700)] hover:underline ${FOCUS}`}>Hide</button>
      </div>
      <ul className="list-disc space-y-0.5 pl-5 text-[var(--color-text-primary)]">
        {list.map((i) => <li key={`${i.at}-${i.words}`} className="break-normal [overflow-wrap:normal] hyphens-none">{i.words}</li>)}
      </ul>
    </section>
  );
}
