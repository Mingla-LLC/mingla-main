import { ArrowRight, Briefcase, Calendar, Eye, Globe, Lock, Mail, Phone } from "lucide-react";
import { Button } from "../ui/Button";
import { DueBadge } from "./DueBadge";
import { Badge } from "../ui/Badge";
import { NextEventLine } from "./NextEventLine";
import { PersonAvatar } from "../people/PeopleField";
import { useToast } from "../../context/ToastContext";
import {
  cadenceWords,
  contactRuleView,
  icpLabel,
  lastTouchWords,
  nextStage,
  quickLinks,
  recordInitials,
  recordOpenLabel,
  regionName,
} from "../../lib/crmModel";
import { localWhen } from "../../lib/opsModel";

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

export function QuickLinks({ record, big = false, children = null }) {
  const links = quickLinks(record);
  if (!links.length && !children) return null;
  return (
    <div role="group" aria-label="Quick links" data-quick-links="" className="flex min-w-0 flex-wrap items-center gap-1">
      {links.map((l) => <QuickLink key={`${l.type}:${l.id}`} link={l} big={big} />)}
      {children}
    </div>
  );
}

/** Owners as faces (names from the team list); at most `max`, then +N. */
export function OwnerFaces({ emails, team, max = 2 }) {
  const people = (emails || []).map((e) => (team || []).find((p) => p.email === e) || { email: e, name: e });
  if (!people.length) return <span className="rounded-full bg-[var(--color-error-50)] px-1.5 text-[11px] font-semibold text-[var(--color-error-700)]">No owner</span>;
  return (
    <span className="inline-flex items-center" title={people.map((p) => p.name || p.email).join(", ")}>
      {people.slice(0, max).map((p, i) => <span key={p.email} className={i ? "-ml-1.5" : ""}><PersonAvatar person={p} size="sm" /></span>)}
      {people.length > max && <span className="ml-1 text-[11px] text-[var(--color-text-tertiary)]">+{people.length - max}</span>}
      <span className="sr-only">Owners: {people.map((p) => p.name || p.email).join(", ")}</span>
    </span>
  );
}

/**
 * One card on the board (#4571 W3, design tab 3). The whole card is a button
 * (Enter or Space opens it); quick links and the arrow keep their own click.
 * Nothing is shown for missing data: no chip without a stored route, no count
 * the server did not send, no time without a touch. The next demo and the
 * Demo booked lock read the W4 fields (`next_demo`, `demo_gate`) only when the
 * server sends them; the cadence round reads W6's `cadence`.
 */
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
  onDragStart,
  onDragEnd,
}) {
  const next = nextStage(def, record);
  const icp = icpLabel(def, record.icp);
  const region = regionName(regions, record.region_id);
  const where = [region, icp].filter(Boolean).join(" · ") || "No ICP or region yet";
  const draggable = canDrag && !disabled && !pending;
  const rule = contactRuleView(record, team);
  const touch = lastTouchWords(record);
  const watching = Array.isArray(record.watchers) ? record.watchers.length : 0;
  const openWork = Number.isFinite(Number(record.open_work)) ? Number(record.open_work) : null;
  const demoAt = record.next_demo?.call_at ? localWhen(record.next_demo.call_at) : "";
  const locked = !!record.demo_gate?.locked;
  const round = cadenceWords(record);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={recordOpenLabel(record, team)}
      aria-busy={pending || undefined}
      draggable={draggable}
      onDragStart={draggable ? (e) => onDragStart?.(e, record) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
      onClick={() => onOpen(record)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(record);
        }
      }}
      data-record-id={record.id}
      className={[
        "group flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-sm)] border border-[var(--gray-200)]",
        "bg-[var(--color-background-primary)] p-3 shadow-[var(--shadow-sm)] transition-opacity duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]",
        pending ? "opacity-60" : "",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--color-brand-50)] text-[12px] font-bold text-[var(--color-brand-700)]">{recordInitials(record.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-[var(--color-text-primary)]">{record.name}</p>
          <p className="break-words text-xs text-[var(--color-text-secondary)]">{where}</p>
        </div>
      </div>
      {/* #4255 (D2): a stale card sits only in Stale and says its stage. */}
      {stageTag && (
        <p data-stage-tag={record.stage}>
          <Badge variant="outline">{stageTag}</Badge>
        </p>
      )}
      {rule && (
        <p title={rule.reason || undefined}>
          <Badge variant={rule.variant}>{rule.label}</Badge>
        </p>
      )}
      <QuickLinks record={record} />
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <OwnerFaces emails={record.owners} team={team} />
        {watching > 0 && <span className={META} title="Watching"><Eye aria-hidden="true" className="h-3.5 w-3.5" />{watching}<span className="sr-only"> watching</span></span>}
        <span className={META} data-last-touch="">{touch ? `Touched ${touch}` : "Not contacted yet"}</span>
      </div>
      {(openWork !== null || demoAt || locked || round) && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {openWork !== null && <span className={META} data-open-work=""><Briefcase aria-hidden="true" className="h-3.5 w-3.5" />{openWork} open</span>}
          {demoAt && <span className={META} data-next-demo=""><Calendar aria-hidden="true" className="h-3.5 w-3.5" />Demo {demoAt}</span>}
          {locked && <span className={`${META} text-[var(--color-error-700)]`} data-demo-lock=""><Lock aria-hidden="true" className="h-3.5 w-3.5" />Demo booked locked</span>}
          {round && <span className={META} data-cadence="">{round}</span>}
        </div>
      )}
      {record.next_action && <p className="truncate text-xs text-[var(--color-text-tertiary)]" title={record.next_action}>{record.next_action}</p>}
      <NextEventLine record={record} />
      {(record.due_on || next) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <DueBadge dueOn={record.due_on} today={today} />
          </span>
          {next && (
            <Button
              variant="secondary"
              size="sm"
              className="min-h-11 max-sm:h-11"
              iconRight={ArrowRight}
              disabled={disabled || pending}
              title={`Move to ${next.label}`}
              aria-label={`Move ${record.name} to ${next.label}`}
              onClick={(e) => {
                e.stopPropagation();
                onMove(record, next.id);
              }}
            >
              {next.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
