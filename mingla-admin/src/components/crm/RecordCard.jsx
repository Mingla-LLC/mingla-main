import { ArrowRight, Calendar, Eye, Globe, Lock, Mail, Phone } from "lucide-react";
import { Button } from "../ui/Button";
import { DueBadge } from "./DueBadge";
import { Badge } from "../ui/Badge";
import { NextEventLine } from "./NextEventLine";
import { useHostNextRow } from "../../hooks/useHostNextRow";
import { PersonAvatar } from "../people/PeopleField";
import { useToast } from "../../context/ToastContext";
import {
  dueState,
  contactRuleView,
  icpLabel,
  lastTouchWords,
  moveBlocker,
  nextStage,
  quickLinks,
  recordInitials,
  recordOpenLabel,
  regionName,
} from "../../lib/crmModel";
import { cardProblems, cardStatus } from "../../lib/recordCardModel";
import { pastDueWords } from "../../lib/outreachView";

const CHIP = "inline-flex min-h-7 max-w-full items-center gap-1 rounded-full border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-2 text-[11.5px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]";
const META = "inline-flex min-w-0 items-center gap-1 text-[11.5px] text-[var(--color-text-tertiary)]";
const ICONS = { website: Globe, phone: Phone, email: Mail };

/**
 * #4571 W3: one quick link on a tile or a card. A chip never opens the card
 * (stopPropagation): socials and the website open in a new tab, the phone
 * copies the number for PressOne (a failed copy says so), the email opens a
 * new message. A number marked wrong or a bounced email is struck through.
 */
export function QuickLink({ link, big = false }) {
  const { addToast } = useToast();
  const stop = (e) => e.stopPropagation();
  const Icon = ICONS[link.type];
  const text = link.type === "social" ? (big ? `@${link.handle}${link.followers ? ` · ${link.followers}` : ""}` : link.followers)
    : big ? link.value : "";
  const title = link.type === "social" ? `${link.label} @${link.handle}${link.followers ? ` · ${link.followers} followers` : ""}`
    : `${link.value}${link.bad ? ` · ${link.badWords}` : ""}`;
  const body = (
    <>
      {link.type === "social" ? <b className="text-[var(--color-text-primary)]">{link.short}</b> : <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
      {text ? <span className={`truncate ${link.bad ? "line-through" : ""}`}>{text}</span> : null}
      {link.bad && big ? <span className="text-[var(--color-error-700)]">{link.badWords}</span> : null}
    </>
  );
  const cls = `${CHIP} ${link.bad ? "text-[var(--color-error-700)] line-through decoration-1" : ""}`;
  if (link.type === "phone") {
    return (
      <button type="button" data-quick-link="phone" title={title} aria-label={link.bad ? `${link.value}, ${link.badWords}` : `Copy ${link.value}`}
        className={cls}
        onKeyDown={stop}
        onClick={async (e) => {
          e.stopPropagation();
          try {
            if (!navigator?.clipboard?.writeText) throw new Error("no clipboard");
            await navigator.clipboard.writeText(link.value);
            addToast({ variant: "success", title: `Copied ${link.value}` });
          } catch (err) {
            addToast({ variant: "error", title: "Couldn’t copy the number", description: `Copy it by hand: ${link.value}` });
          }
        }}>
        {body}
      </button>
    );
  }
  return (
    <a href={link.href} data-quick-link={link.type} title={title}
      aria-label={link.type === "email" ? `Email ${link.value}` : `Open ${title} in a new tab`}
      {...(link.type === "email" ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      onClick={stop} onKeyDown={stop} className={cls}>
      {body}
    </a>
  );
}

export function QuickLinks({ record, big = false, max = 0, before = null, children = null }) {
  const links = quickLinks(record);
  if (!links.length && !children && !before) return null;
  // #4571 design v5: a card shows four chips, then "+N" (the panel lists them all).
  const shown = max > 0 ? links.slice(0, max) : links;
  const more = links.length - shown.length;
  return (
    <div role="group" aria-label="Quick links" data-quick-links="" className={`flex min-w-0 items-center gap-1 ${max > 0 ? "flex-nowrap overflow-hidden" : "flex-wrap"}`}>
      {before}
      {shown.map((l) => <QuickLink key={`${l.type}:${l.id}`} link={l} big={big} />)}
      {more > 0 && <span data-more-links="" title={`${more} more in the card`} className="inline-flex min-h-7 shrink-0 items-center rounded-full border border-[var(--gray-200)] px-2 text-[11.5px] font-semibold text-[var(--color-text-tertiary)]">+{more}</span>}
      {children}
    </div>
  );
}

/** Owners as faces (names from the team list); at most `max`, then +N. */
export function OwnerFaces({ emails, team, max = 2 }) {
  const people = (emails || []).map((e) => (team || []).find((p) => p.email === e) || { email: e, name: e });
  // #4571 design v5: "No owner" is a quiet dashed chip here; the amber problem count carries the warning.
  if (!people.length) return <span data-no-owner="" className="whitespace-nowrap rounded-full border border-dashed border-[var(--gray-300)] px-1.5 text-[11px] text-[var(--color-text-tertiary)]">No owner</span>;
  return (
    <span className="inline-flex items-center" title={`Owners: ${people.map((p) => p.name || p.email).join(", ")}`} data-owner-faces={people.length}>
      {people.slice(0, max).map((p, i) => <span key={p.email} className={i ? "-ml-1.5" : ""}><PersonAvatar person={p} size="sm" /></span>)}
      {people.length > max && <span data-more-owners="" className="-ml-1.5 inline-grid h-5 min-w-5 place-items-center rounded-full border-2 border-[var(--color-background-primary)] bg-[var(--gray-100)] px-1 text-[10.5px] font-bold text-[var(--color-text-secondary)]">+{people.length - max}</span>}
      <span className="sr-only">Owners: {people.map((p) => p.name || p.email).join(", ")}</span>
    </span>
  );
}

/** "Touched 2h ago" from the server's last touch; the full words go in the tooltip. */
function touchedWords(touch) {
  if (!touch) return "";
  const parts = touch.split(" · ");
  return `Touched ${parts[parts.length - 1]}`;
}

const DOT = { ok: "bg-[var(--color-success-500)]", warn: "bg-[var(--color-warning-500)]", info: "bg-[var(--color-info-500)]", err: "bg-[var(--color-error-500)]", none: "bg-[var(--gray-400)]" };
const STATUS_INK = { info: "text-[var(--color-info-700)]", err: "text-[var(--color-error-700)]" };

function StatusLine({ status, record }) {
  if (!status) return null;
  if (status.kind === "event") return <NextEventLine record={record} />;
  const marker = {
    stale: { "data-stage-tag": record.stage },
    reply: { "data-tile-replied": "" },
    lock: { "data-demo-lock": "" },
    cancelled: { "data-demo-cancelled": "" },
    demo: { "data-next-demo": "" },
    round: { "data-cadence": "" },
  }[status.kind] || {};
  return (
    <p {...marker} title={status.kind === "stale" ? `Stuck in ${status.words} · past its date` : status.words}
      className={`flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold ${STATUS_INK[status.k] || "text-[var(--color-text-primary)]"}`}>
      <i aria-hidden="true" className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${DOT[status.k] || DOT.none}`} />
      {status.kind === "lock" && <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
      {status.kind === "demo" && <Calendar aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0 truncate">{status.kind === "stale" ? <>Stuck in <b>{status.words}</b> · past its date</> : status.words}</span>
    </p>
  );
}

/** The due chip beside the next step: Past due for a Live card (it never goes Stale), else DueBadge. */
export function CardDue({ record, today }) {
  const past = pastDueWords(record, today);
  if (past) {
    return <span data-past-due="" className="inline-flex h-[22px] items-center whitespace-nowrap rounded-md bg-[var(--color-error-50)] px-1.5 text-[11.5px] font-semibold tabular-nums text-[var(--color-error-700)]">{past}</span>;
  }
  return <DueBadge dueOn={record.due_on} today={today} />;
}

/**
 * One card on the board (#4571 W3; redesigned to Seth's approved design v5).
 * The whole card is a button (Enter or Space opens it); quick links and the
 * move button keep their own click. Fixed order:
 *   1 initials, name (two lines at most), type · region, the amber problem count
 *   2 one status line with a dot (cardStatus)
 *   3 contact chips (the contact rule first), owner faces +N, watcher eye
 *   4 the next step with its due chip (Past due · date on a Live card)
 *   5 "Touched 2h ago · 1 open" and the move button (Book a demo / Mark signed when locked)
 * Overdue and due-today cards stand forward; cards with nothing due or wrong
 * sit flat. Nothing is shown for missing data.
 */
/**
 * #4571 final gate: the locked next-stage button's tooltip and screen-reader
 * words say the same thing. Demo booked needs a linked demo; Onboarded and Live
 * need a linked demo or the host's Mingla brand.
 */
export function lockedNextTitle(next) {
  return next.id === "meeting"
    ? `${next.label} needs a linked demo. Open the card to book one.`
    : `${next.label} needs a linked demo or the host's Mingla brand. Open the card to book a demo or link the brand.`;
}
export function lockedNextLabel(next, record) {
  return next.id === "meeting"
    ? `${next.label} is locked for ${record.name}. Open the card to book a demo.`
    : `${next.label} is locked for ${record.name}. Open the card to book a demo or link the brand.`;
}

export function RecordCard({
  record,
  def,
  regions,
  team,
  today,
  stageTag = "",
  pending = false,
  disabled = false,
  canDrag = false,
  onOpen,
  onMove,
  // #4571 W3: dnd-kit's draggable (PipelineBoard), the same as the Work board.
  drag = null,
}) {
  const hostRow = useHostNextRow(record);
  const next = nextStage(def, record);
  const icp = icpLabel(def, record.icp);
  const region = regionName(regions, record.region_id);
  const where = [icp, region].filter(Boolean).join(" · ") || "No type or region yet";
  const draggable = canDrag && !disabled && !pending;
  const rule = contactRuleView(record, team);
  const touch = lastTouchWords(record);
  const watchers = Array.isArray(record.watchers) ? record.watchers : [];
  const openWork = Number.isFinite(Number(record.open_work)) ? Number(record.open_work) : 0;
  // #4571 rework: never offer a move the demo rule refuses; open the card to book one.
  const block = next ? moveBlocker(def, record, next.id) : null;
  const nextLocked = block?.token === "demo_required";
  // #4571 design v5: Negotiating -> Booked turns into Mark signed until the agreement is Signed.
  const signGate = block?.token === "agreement_required";
  const problems = cardProblems(def, record);
  const status = cardStatus(def, record, { stageTag, hostRow });
  const due = dueState(record.due_on, today);
  const urgent = due === "overdue" || due === "today";
  const quiet = !urgent && problems.length === 0 && due === "none";
  const meta = [touch ? touchedWords(touch) : "Not contacted yet", openWork > 0 ? `${openWork} open` : ""].filter(Boolean).join(" · ");
  const watcherNames = watchers.map((e) => (team || []).find((p) => p.email === e)?.name || e).join(", ");

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${recordOpenLabel(record, team)}${problems.length ? `, needs attention: ${problems.join(", ")}` : ""}`}
      aria-busy={pending || undefined}
      aria-roledescription={draggable && drag ? "Draggable card" : undefined}
      ref={drag?.ref}
      {...(draggable && drag ? drag.attributes : {})}
      {...(draggable && drag ? drag.listeners : {})}
      onClick={() => onOpen(record)}
      onKeyDown={(e) => {
        // dnd-kit picks the card up with Space (keyboard drag); Enter opens it.
        if (draggable && drag) drag.listeners?.onKeyDown?.(e);
        if (e.target !== e.currentTarget || e.defaultPrevented) return;
        if (e.key === "Enter" || (e.key === " " && !(draggable && drag))) {
          e.preventDefault();
          onOpen(record);
        }
      }}
      data-record-id={record.id}
      data-weight={urgent ? "urgent" : quiet ? "quiet" : "default"}
      className={[
        // #4571 rework: relative, so the card's sr-only text (absolute) is placed
        // inside the card and clipped by the board's scroller; without it the
        // text escaped to the page and widened a 390px phone to 675px.
        "relative group flex min-w-0 flex-col gap-2 rounded-[10px] border p-3 transition-[opacity,box-shadow,border-color] duration-150",
        urgent
          ? "border-[var(--gray-300)] bg-[var(--color-background-primary)] shadow-[var(--shadow-md)]"
          : quiet
            ? "border-[var(--gray-200)] bg-[var(--gray-50)] shadow-none"
            : "border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]",
        "hover:border-[var(--gray-300)] hover:shadow-[var(--shadow-md)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
        pending || drag?.isDragging ? "opacity-60" : "",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
      ].join(" ")}
    >
      <div className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-2">
        <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] border border-[var(--gray-200)] bg-[var(--gray-100)] text-[11px] font-bold text-[var(--color-text-secondary)]">{recordInitials(record.name)}</span>
        <div className="min-w-0">
          <p className="line-clamp-2 break-words text-[13.5px] font-semibold leading-snug text-[var(--color-text-primary)]">{record.name}</p>
          <p className="truncate text-xs text-[var(--color-text-tertiary)]" title={where}>{where}</p>
        </div>
        {problems.length > 0 ? (
          <span data-problem-count={problems.length} className="group/attn relative inline-grid h-5 min-w-5 cursor-help place-items-center rounded-full bg-[var(--color-warning-50)] px-1.5 text-[11px] font-bold text-[var(--color-warning-700)]">
            {problems.length}
            <span role="tooltip" data-problem-list="" className="pointer-events-none absolute right-0 top-6 z-10 w-56 rounded-lg bg-[var(--gray-900)] px-2.5 py-2 text-left text-xs font-medium text-[var(--gray-50)] opacity-0 shadow-[var(--shadow-md)] transition-opacity duration-100 group-hover/attn:opacity-100">
              <b className="mb-0.5 block">Needs attention</b>{problems.join(" · ")}
            </span>
          </span>
        ) : <span />}
      </div>
      <StatusLine status={status} record={record} />
      <div className="flex min-w-0 items-center justify-between gap-2">
        <QuickLinks record={record} max={4} before={rule ? <span title={rule.reason || undefined} className="shrink-0"><Badge variant={rule.variant}>{rule.label}</Badge></span> : null} />
        {!rule && quickLinks(record).length === 0 && <span className="text-[11.5px] text-[var(--color-text-tertiary)]">No contact yet</span>}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5">
          <OwnerFaces emails={record.owners} team={team} />
          {watchers.length > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--color-text-tertiary)]" data-watchers={watchers.length} title={`Watching: ${watcherNames}`}><Eye aria-hidden="true" className="h-3.5 w-3.5" />{watchers.length}<span className="sr-only"> watching</span></span>}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2 border-t border-[var(--gray-200)] pt-2">
        <span className={`min-w-0 flex-1 truncate text-[12.5px] ${record.next_action ? "text-[var(--color-text-secondary)]" : "italic text-[var(--color-text-tertiary)]"}`} title={record.next_action || undefined} data-next-step="">
          {record.next_action || "No next step set"}
        </span>
        <CardDue record={record} today={today} />
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11.5px] text-[var(--color-text-tertiary)]" data-last-touch="" title={touch ? `Touched ${touch}` : "Not contacted yet"}>
          {meta}
          {openWork > 0 && <span data-open-work="" className="sr-only"> ({openWork} open work)</span>}
        </span>
        {next && nextLocked && (
          <Button variant="secondary" size="sm" className="min-h-11 shrink-0" icon={Calendar} data-gate-action=""
            disabled={disabled || pending} title={lockedNextTitle(next)} aria-label={lockedNextLabel(next, record)}
            onClick={(e) => { e.stopPropagation(); onOpen(record); }}>
            Book a demo
          </Button>
        )}
        {next && signGate && (
          <Button variant="secondary" size="sm" className="min-h-11 shrink-0" icon={Lock} data-sign-gate=""
            disabled={disabled || pending} title={`${next.label} needs the agreement marked as signed. Open the card to mark it.`}
            aria-label={`${next.label} is locked for ${record.name}. Open the card to mark the agreement signed.`}
            onClick={(e) => { e.stopPropagation(); onOpen(record, { field: "agreement" }); }}>
            Mark signed
          </Button>
        )}
        {next && !nextLocked && !signGate && (
          <Button variant="secondary" size="sm" className="min-h-11 max-sm:h-11" iconRight={ArrowRight}
            disabled={disabled || pending} title={`Move to ${next.label}`} aria-label={`Move ${record.name} to ${next.label}`}
            onClick={(e) => { e.stopPropagation(); onMove(record, next.id); }}>
            {next.label}
          </Button>
        )}
      </div>
    </div>
  );
}
