// Issue #4270 (Wave 7) — one brand's Calendar, in the side panel beside its
// Brand group: the brand's dated posts for the next 4 weeks, how many are
// Ideas, Being made and Published, each opening beside (content:<id>). The
// whole Calendar is one explicit link away ("Open the Calendar").
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Drawer } from "../ui/Drawer";
import { Button } from "../ui/Button";
import { SideLink } from "../ui/PanelStack";
import * as ops from "../../services/opsService";
import { addDays, opsErrorWords, todayIso } from "../../lib/opsModel";
import { planDay } from "../../lib/brandPlan";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";

/** { ideas, making, published } from a plan's posts. */
export function calendarCounts(items) {
  const posts = (Array.isArray(items) ? items : []).filter((i) => i?.kind === "post");
  return {
    ideas: posts.filter((p) => p.state === "planned").length,
    making: posts.filter((p) => ["being_made", "in_review", "scheduled"].includes(p.state)).length,
    published: posts.filter((p) => p.state === "posted").length,
  };
}

export function BrandCalendarSide({ side, brandName = "", onClose }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const today = todayIso();
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const data = await ops.fetchBrandPlan(side.id, today, addDays(today, 27), today);
      if (mine === seq.current) setState({ loading: false, data, error: null });
    } catch (error) {
      if (mine === seq.current) setState({ loading: false, data: null, error });
    }
  }, [side.id]);
  useEffect(() => { void load(); }, [load]);

  const name = state.data?.brand?.name || brandName || "this brand";
  const posts = (state.data?.items || []).filter((i) => i?.kind === "post");
  const counts = calendarCounts(posts);
  return (
    <Drawer open onClose={onClose} title={`Calendar · ${name}`}>
      <div data-brand-calendar="" className="flex min-w-0 flex-col gap-3">
        <p className="text-[12.5px] text-[var(--color-text-tertiary)]">This brand only · next 4 weeks</p>
        {state.loading && !state.data ? (
          <p role="status" className="text-[13px] text-[var(--color-text-secondary)]">Loading the Calendar…</p>
        ) : state.error ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-error-700)]">
            <span className={`min-w-0 ${WORDS}`}>Couldn’t load this brand’s Calendar. {opsErrorWords(state.error)}</span>
            <Button variant="secondary" size="sm" className="min-h-11" onClick={() => void load()}>Try again</Button>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-3 gap-2">
              {[["Ideas", counts.ideas], ["Being made", counts.making], ["Published", counts.published]].map(([label, n]) => (
                <div key={label} className="rounded-lg border border-[var(--gray-200)] px-3 py-2">
                  <dt className="text-[11px] text-[var(--color-text-tertiary)]">{label}</dt>
                  <dd className="text-[16px] font-bold text-[var(--color-text-primary)]">{n}</dd>
                </div>
              ))}
            </dl>
            {posts.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-tertiary)]">No posts for this brand in the next 4 weeks.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {posts.map((post) => (
                  <li key={post.id}>
                    <SideLink side={{ kind: "content", id: post.id }} href={`#/content-calendar?card=${post.id}`}
                      className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-[var(--gray-200)] px-3 py-2 hover:bg-[var(--gray-50)] ${FOCUS}`}>
                      <span className="flex min-w-0 flex-col">
                        <span className={`text-[13px] font-semibold text-[var(--color-text-primary)] ${WORDS}`}>{post.title}</span>
                        <span className="text-[11.5px] text-[var(--color-text-tertiary)]">{planDay(post.on)}</span>
                      </span>
                      {post.state_words && <span className="shrink-0 rounded-full bg-[var(--gray-100)] px-2 py-px text-[11px] font-semibold text-[var(--color-text-secondary)]">{post.state_words}</span>}
                    </SideLink>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <a href="#/content-calendar" data-full-page="" className={`inline-flex min-h-11 items-center gap-1.5 self-start rounded-lg px-1 text-[12.5px] font-semibold text-[var(--color-text-secondary)] hover:underline ${FOCUS}`}>
          Open the Calendar <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
        </a>
      </div>
    </Drawer>
  );
}
