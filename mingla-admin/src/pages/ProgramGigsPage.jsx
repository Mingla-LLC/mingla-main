// Issue #3872 — Programs › Gigs. A read-only list of every hired gig and where
// it stands, in plain words, with the shared contract timeline in a drawer.
// Mingla watches; the host and creator run the deal. Each row also says the
// most the host offered to pay on the gig ("Up to $300").

import { useEffect, useMemo, useState } from "react";
import { PROGRAM_QUEUE_REFRESH, useProgramLoad } from "../hooks/useProgramLoad";
import { Check, ExternalLink, RefreshCw, X } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Drawer } from "../components/ui/Drawer";
import { SearchInput } from "../components/ui/SearchInput";
import { Textarea } from "../components/ui/Input";
import { useToast } from "../context/ToastContext";
import { AlertCard } from "../components/ui/Card";
import { GigTimeline } from "./crm/GigTimeline";
import { decidePostCheck, getContractWorkspace, getGigQueue, listGigContracts } from "../services/creatorProgramsService";
import {
  POST_FAIL_HINT,
  POST_REASON_MAX,
  checkPostFailReason,
  postPlatformWord,
  postsDueWords,
  postWaitingOverDay,
  postWaitingWord,
  safePostUrl,
  shortDateTimeOrDash,
  sortPostChecks,
  contractStateTone,
  contractStateWord,
  dayWord,
  deliverablesSummary,
  isMissingFunction,
  mustTagWords,
  money,
  payUpToWord,
  programErrorMessage,
  shortDateTime,
} from "../lib/creatorPrograms";

const POSTS_FILTER = "posts";

const STATE_FILTERS = [
  { id: "all", label: "All", match: () => true },
  { id: "active", label: "In progress", match: (s) => !["released", "completed", "declined", "expired", "cancelled", "resolved_release", "resolved_partial", "resolved_refund", "disputed"].includes(s) },
  { id: "disputed", label: "In dispute", match: (s) => s === "disputed" },
  { id: "done", label: "Done", match: (s) => ["released", "completed", "day30", "resolved_release", "resolved_partial", "resolved_refund"].includes(s) },
  { id: "ended", label: "Declined or expired", match: (s) => ["declined", "expired", "cancelled"].includes(s) },
];

function GigDrawer({ gig, onClose }) {
  const [workspace, setWorkspace] = useState(null);
  const [error, setError] = useState("");

  // Keyed by contract, so each gig opens with an empty drawer.
  useEffect(() => {
    if (!gig) return undefined;
    let cancelled = false;
    getContractWorkspace(gig.contract_id)
      .then((data) => { if (!cancelled) setWorkspace(data); })
      .catch((cause) => { if (!cancelled) setError(programErrorMessage(cause, "Couldn't load this gig's timeline.")); });
    return () => { cancelled = true; };
  }, [gig]);

  if (!gig) return null;
  const terms = workspace?.terms?.find?.((t) => t.version === workspace?.contract?.current_terms_version);
  const posts = Array.isArray(workspace?.posts) ? workspace.posts : [];
  const removed = posts.filter((p) => p.day30_status === "removed").length;
  return (
    <Drawer
      open={!!gig}
      onClose={onClose}
      title={`${gig.gig_title ?? "Gig"} · ${gig.creator_display_name ?? "Creator"} × ${gig.brand_name ?? "Host"}`}
      footer={gig.state === "disputed" ? (
        <Button className="w-full" variant="secondary" onClick={() => { window.location.hash = "#/program-disputes"; }}>Open disputes</Button>
      ) : null}
    >
      <div className="space-y-5">
        <p className="text-sm text-[var(--color-text-secondary)]">Read-only. Mingla watches; the two parties run the deal.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={contractStateTone(gig.state)} dot>{contractStateWord(gig.state)}</Badge>
          {terms ? <span className="text-sm text-[var(--color-text-primary)]">{money(terms.fee_minor, terms.currency)} fee · terms v{terms.version}</span> : null}
        </div>
        {error ? <AlertCard variant="error" title="Timeline unavailable">{error}</AlertCard> : null}
        {workspace ? <GigTimeline events={workspace.events ?? []} currency={terms?.currency ?? gig.currency ?? null} /> : !error ? <p className="text-sm text-[var(--color-text-secondary)]">Loading the timeline…</p> : null}
        <div className="flex items-center justify-between border-t border-[var(--gray-200)] pt-3 text-sm">
          <span className="font-medium text-[var(--color-text-primary)]">Day-30 check</span>
          <span className="text-[var(--color-text-secondary)]">
            {!posts.length ? "No posts yet" : removed ? `${removed} post${removed === 1 ? "" : "s"} taken down` : posts.every((p) => p.day30_status === "live") ? "Posts still live" : "Scheduled"}
          </span>
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">Flags</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">{workspace?.dispute ? "A dispute was opened on this gig." : "None"}</p>
        </div>
      </div>
    </Drawer>
  );
}

// ── #4402 (D1): Posts to check ─────────────────────────────────────────────
// Mingla's team opens each posted link and marks it Passed or Failed. A fail
// needs a reason the creator sees. Oldest first; over 24 h shows "Waiting over a day".

function PostCheckDrawer({ post, onClose, onDecided }) {
  const { addToast } = useToast();
  const [mode, setMode] = useState("choose");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    if (!post) return undefined;
    let cancelled = false;
    getContractWorkspace(post.contract_id)
      .then((data) => { if (!cancelled) setHistory(Array.isArray(data?.events) ? data.events : []); })
      .catch((cause) => { if (!cancelled) setHistoryError(programErrorMessage(cause, "Couldn't load this post's history.")); });
    return () => { cancelled = true; };
  }, [post]);

  if (!post) return null;
  const url = safePostUrl(post.url);
  const checked = checkPostFailReason(reason);
  const decide = async (result) => {
    if (saving) return;
    setError("");
    setSaving(result);
    try {
      await decidePostCheck(post.post_id, result, result === "failed" ? checked.reason : null);
      addToast({ variant: "success", title: result === "passed" ? "Post passed." : "Post failed. The creator can see why." });
      onDecided();
    } catch (cause) {
      setError(programErrorMessage(cause, "Couldn't save this decision. Try again."));
      setSaving(null);
    }
  };
  const events = (history ?? []).filter((e) => ["posts_submitted", "post_reviewed", "delivery_approved"].includes(e.kind));
  return (
    <Drawer
      open
      onClose={saving ? () => {} : onClose}
      title={`Check post · ${postPlatformWord(post.platform)}`}
      footer={mode === "fail" ? (
        <div className="flex flex-col gap-2.5 pb-1">
          <Button variant="danger" className="w-full" loading={saving === "failed"} disabled={!checked.ok || !!saving} onClick={() => void decide("failed")}>Mark failed and tell the creator</Button>
          <Button variant="secondary" className="w-full" disabled={!!saving} onClick={() => { setMode("choose"); setError(""); }}>Cancel</Button>
        </div>
      ) : (
        <div className="flex gap-2.5 pb-1">
          <Button className="flex-1" icon={Check} loading={saving === "passed"} disabled={!!saving} onClick={() => void decide("passed")}>Passed</Button>
          <Button className="flex-1" variant="danger" icon={X} disabled={!!saving} onClick={() => { setMode("fail"); setError(""); }}>Failed</Button>
        </div>
      )}
    >
      <div className="space-y-5">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[var(--gray-300)] px-3 text-sm font-semibold text-[var(--color-brand-700)] hover:bg-[var(--gray-50)]">
            Open post on {postPlatformWord(post.platform)}<ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : <AlertCard variant="warning" title="This link can't be opened">The creator's link isn't a web address. Fail it and ask for a working link.</AlertCard>}
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-[var(--color-text-tertiary)]">Gig</dt><dd className="text-[var(--color-text-primary)]">{post.gig_title ?? "Gig"}</dd>
          <dt className="text-[var(--color-text-tertiary)]">Creator</dt><dd className="text-[var(--color-text-primary)]">{post.creator_name ?? "—"}</dd>
          <dt className="text-[var(--color-text-tertiary)]">Host</dt><dd className="text-[var(--color-text-primary)]">{post.brand_name ?? "—"}</dd>
          <dt className="text-[var(--color-text-tertiary)]">Must tag</dt><dd className="text-[var(--color-text-primary)]">{mustTagWords(post.must_tag) || "—"}</dd>
          <dt className="text-[var(--color-text-tertiary)]">Deliverables</dt><dd className="text-[var(--color-text-primary)]">{deliverablesSummary(post.deliverables) || "—"}</dd>
          {/* #4430 Q2: the deadline gig-timers enforces first, the agreed post-by day under it. */}
          <dt className="text-[var(--color-text-tertiary)]">Posts due</dt><dd className="text-[var(--color-text-primary)]">{post.post_by ? postsDueWords(post.post_by, post.timezone) : "—"}</dd>
          <dt className="text-[var(--color-text-tertiary)]">Post by (agreed)</dt><dd className="text-[var(--color-text-secondary)]">{post.post_by ? dayWord(post.post_by) : "—"}</dd>
          <dt className="text-[var(--color-text-tertiary)]">Submitted</dt><dd className="text-[var(--color-text-primary)]">{shortDateTimeOrDash(post.submitted_at)} · {postWaitingWord(post)} ago</dd>
        </dl>
        {mode === "fail" ? (
          <Textarea
            label="Reason the creator will see"
            value={reason}
            maxLength={POST_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            error={reason && !checked.ok ? checked.error : undefined}
            helper={`${reason.trim().length} / ${POST_REASON_MAX}. ${POST_FAIL_HINT}`}
            autoFocus
          />
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)]">When every post on this gig passes, the creator is paid in 48 hours.</p>
        )}
        {error ? <p role="alert" className="text-sm text-[var(--color-error-700)]">{error}</p> : null}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">History</h3>
          {historyError ? <p className="text-sm text-[var(--color-text-secondary)]">{historyError}</p> : history === null ? <p className="text-sm text-[var(--color-text-secondary)]">Loading the history…</p> : events.length ? <GigTimeline events={events} currency={post.currency ?? null} /> : <p className="text-sm text-[var(--color-text-secondary)]">No history yet.</p>}
        </div>
      </div>
    </Drawer>
  );
}

function PostChecksQueue({ queue }) {
  const [selected, setSelected] = useState(null);
  const rows = useMemo(() => sortPostChecks(queue.data?.post_checks), [queue.data]);
  const missing = isMissingFunction(queue.error);
  const error = queue.error && !missing ? programErrorMessage(queue.error, "Couldn't load posts to check. Try again.") : "";
  if (missing) {
    return <AlertCard variant="info" title="Posts to check isn't available yet">This list needs a server update that hasn't shipped.</AlertCard>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-text-secondary)]">Oldest first. Open the link, then decide.</p>
      {error ? <AlertCard variant="error" title="Couldn't load posts to check" action={<Button size="sm" variant="secondary" onClick={queue.reload}>Try again</Button>}>{error}</AlertCard> : null}
      <div className="admin-control-scroll overflow-x-auto rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)]">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-[var(--gray-50)] text-left text-xs uppercase tracking-wider text-[var(--color-text-tertiary)]">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">Post</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Gig and creator</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Must include</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Posts due</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Waiting</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const url = safePostUrl(row.url);
              return (
                <tr key={row.post_id} className="border-t border-[var(--gray-200)] align-top hover:bg-[var(--gray-50)]">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[var(--color-text-primary)]">{postPlatformWord(row.platform)}</p>
                    {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--color-brand-700)] underline">Open post</a> : <span className="text-xs text-[var(--color-text-tertiary)]">No link</span>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-[var(--color-text-primary)]">{row.gig_title ?? "Gig"}</p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">{[row.creator_name, row.brand_name].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-secondary)]">{[mustTagWords(row.must_tag), deliverablesSummary(row.deliverables)].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-4 py-3">
                    <p className="text-[var(--color-text-primary)]">{row.post_by ? postsDueWords(row.post_by, row.timezone) : "—"}</p>
                    {row.post_by ? <p className="text-xs text-[var(--color-text-tertiary)]">Post by (agreed) {dayWord(row.post_by)}</p> : null}
                  </td>
                  <td className="px-4 py-3">
                    {postWaitingOverDay(row) ? <Badge variant="warning" dot>Waiting over a day</Badge> : null}
                    <p className="tabular-nums text-[var(--color-text-secondary)]">{postWaitingWord(row)}</p>
                  </td>
                  <td className="px-4 py-3"><Button size="sm" variant="secondary" onClick={() => setSelected(row)}>Review</Button></td>
                </tr>
              );
            })}
            {!rows.length && !queue.loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center"><p className="text-sm font-semibold text-[var(--color-text-primary)]">No posts to check</p><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Links creators submit will appear here, oldest first.</p></td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <PostCheckDrawer key={selected?.post_id ?? "none"} post={selected} onClose={() => setSelected(null)} onDecided={() => { setSelected(null); queue.reload(); }} />
    </div>
  );
}

function GigsList() {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [selected, setSelected] = useState(null);

  const queue = useProgramLoad(getGigQueue, PROGRAM_QUEUE_REFRESH);
  const postCount = queue.data?.post_checks?.length;
  const list = useProgramLoad(listGigContracts);
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const loading = list.loading;
  const missing = isMissingFunction(list.error);
  const error = list.error && !missing ? programErrorMessage(list.error, "Couldn't load gigs. Try again.") : "";
  const refresh = () => { list.reload(); queue.reload(); };

  const shown = useMemo(() => {
    const filter = STATE_FILTERS.find((f) => f.id === stateFilter) ?? STATE_FILTERS[0];
    const q = search.trim().toLowerCase();
    return rows.filter((row) => filter.match(row.state) && (!q || [row.gig_title, row.creator_display_name, row.brand_name, row.city].some((v) => String(v ?? "").toLowerCase().includes(q))));
  }, [rows, search, stateFilter]);

  if (missing) {
    return (
      <AlertCard variant="info" title="The gigs list isn't available yet">
        This list needs a server update that hasn't shipped. Disputes still open from the Disputes page.
      </AlertCard>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput className="w-full sm:w-72" value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch("")} placeholder="Search gig, creator, host or city" />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by state">
          {STATE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={stateFilter === f.id}
              onClick={() => setStateFilter(f.id)}
              className={`min-h-9 cursor-pointer rounded-full border px-3 text-xs font-medium ${stateFilter === f.id ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-300)] text-[var(--color-text-secondary)]"}`}
            >
              {f.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={stateFilter === POSTS_FILTER}
            onClick={() => setStateFilter(POSTS_FILTER)}
            className={`min-h-9 cursor-pointer rounded-full border px-3 text-xs font-medium ${stateFilter === POSTS_FILTER ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-300)] text-[var(--color-text-secondary)]"}`}
          >
            Posts to check · {postCount ?? "·"}
          </button>
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={refresh} loading={loading || queue.loading}>Refresh</Button>
      </div>
      {stateFilter === POSTS_FILTER ? <PostChecksQueue queue={queue} /> : <>
      {error ? <AlertCard variant="error" title="Couldn't load gigs">{error}</AlertCard> : null}
      <div className="admin-control-scroll overflow-x-auto rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)]">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-[var(--gray-50)] text-left text-xs uppercase tracking-wider text-[var(--color-text-tertiary)]">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">Gig</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Creator</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Where it stands</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Gig pays</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Fee</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Next date</th>
              <th scope="col" className="px-4 py-2.5 font-semibold">Updated</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.contract_id} className="border-t border-[var(--gray-200)] hover:bg-[var(--gray-50)]">
                <td className="px-4 py-3">
                  <button type="button" onClick={() => setSelected(row)} className="cursor-pointer text-left font-medium text-[var(--color-text-primary)] hover:underline">
                    {row.gig_title ?? "Untitled gig"}
                  </button>
                  <p className="text-xs text-[var(--color-text-tertiary)]">{[row.brand_name, row.city].filter(Boolean).join(" · ")}</p>
                </td>
                <td className="px-4 py-3 text-[var(--color-text-primary)]">{row.creator_display_name ?? "—"}</td>
                <td className="px-4 py-3"><Badge variant={contractStateTone(row.state)} dot>{contractStateWord(row.state)}</Badge></td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">{payUpToWord(row.pay_up_to_minor, row.pay_currency ?? row.currency)}</td>
                <td className="px-4 py-3 text-[var(--color-text-primary)]">{row.fee_minor != null ? money(row.fee_minor, row.currency) : "—"}</td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">{row.due_at ? dayWord(row.due_at) : "—"}</td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">{shortDateTime(row.updated_at) || "—"}</td>
              </tr>
            ))}
            {!shown.length && !loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">{rows.length ? "No gigs match." : "No gigs yet."}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <GigDrawer key={selected?.contract_id ?? "none"} gig={selected} onClose={() => setSelected(null)} />
      </>}
    </div>
  );
}

export function ProgramGigsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Gigs"
        description="Every hired gig and where it stands, plus the posted links Mingla's team checks. The host and creator run the deal."
      />
      <GigsList />
    </div>
  );
}
