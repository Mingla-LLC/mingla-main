// Issue #4130 (Wave 4a) — the Dashboard's founder numbers and "Needs you
// today". Pure: no React, no Supabase.

import { announcementsWithFailedPushes } from "./announcementDelivery.js";
//
// Each source (Work, Money, Platform health, Support, Inbound) is passed in as
// { status: "loading" | "error" | "ready", data, error }. A source that failed
// becomes its own item saying it could not be checked, with Retry: a failed
// read is never shown as "nothing needs you".

/** A 7-day count against the 7 days before, as a direction and words. */
export function weekTrend(last7, prev7) {
  const now = Number(last7);
  const before = Number(prev7);
  if (!Number.isFinite(now) || !Number.isFinite(before)) return { direction: "flat", label: "" };
  if (now === before) return { direction: "flat", label: "Same as the 7 days before" };
  if (before === 0) return { direction: "up", label: `Up from 0 the 7 days before` };
  const pct = Math.round(((now - before) / before) * 100);
  if (now > before) return { direction: "up", label: `${pct}% vs the 7 days before` };
  return { direction: "down", label: `${Math.abs(pct)}% vs the 7 days before` };
}

/** Days with no inbound lead before the Dashboard and Inbound leads warn. */
export const INBOUND_QUIET_DAYS = 14;

const AREA_LABEL = { work: "Work", money: "Money", system: "System", support: "Support", growth: "Growth", community: "Community" };

function failed(id, area, what, source) {
  return {
    id: `${id}-failed`,
    area,
    areaLabel: AREA_LABEL[area],
    tone: "error",
    title: `Couldn't check ${what}`,
    detail: "This is not the same as nothing to do. Try again.",
    retry: source,
  };
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Platform health problems from admin_get_api_health's services. */
export function healthProblems(services) {
  const out = [];
  for (const svc of Array.isArray(services) ? services : []) {
    const layers = Object.values(svc?.layers || {}).map((l) => l?.status);
    const down = svc?.alert_state === "alerting" || layers.includes("down");
    const degraded = !down && layers.includes("degraded");
    if (!down && !degraded) continue;
    out.push({
      id: `health-${svc.service_key}`,
      area: "system",
      areaLabel: AREA_LABEL.system,
      tone: down ? "bad" : "warn",
      title: `${svc.display_name || svc.service_key} is ${down ? "down" : "having problems"}`,
      detail: down ? "Check Platform health for what stopped." : "Some checks failed recently.",
      href: "#/platform-health?tab=providers",
    });
  }
  return out;
}

/** The queue health read: a missing server function is a setup gap, not an outage. */
export function queueHealthItem(source) {
  if (!source || source.status !== "error") return null;
  const msg = String(source.error?.message || source.error || "");
  if (/does not exist|could not find the function|PGRST202|schema cache/i.test(msg)) {
    return {
      id: "queue-not-set-up",
      area: "system",
      areaLabel: AREA_LABEL.system,
      tone: "warn",
      title: "Queue health isn't set up in production yet",
      detail: "Its database function has not been applied, so the queue can't be checked.",
      href: "#/platform-health?tab=queue",
    };
  }
  return failed("queue", "system", "queue health", "queue");
}

/**
 * Everything that needs a person today, most urgent first.
 *   sources.work     { cards }                 (useReviewCount)
 *   sources.money    admin_mingla_money_summary (all time)
 *   sources.health   admin_get_api_health services
 *   sources.queue    admin_get_queue_health (only its failure matters here)
 *   sources.summary  admin_dashboard_summary (support and inbound)
 *   sources.announcements  issue_3720_admin_announcement_deliveries rows
 *                    (admins only: the page leaves it out for anyone else)
 */
export function needsYouToday(sources = {}) {
  const items = [];
  const { work, money, health, queue, summary, announcements } = sources;

  if (money?.status === "error") items.push(failed("money", "money", "money", "money"));
  else if (money?.status === "ready") {
    const ex = money.data?.exceptions || {};
    const late = Number(ex.late_on_mingla?.count || 0);
    if (late > 0) {
      items.push({
        id: "money-late", area: "money", areaLabel: AREA_LABEL.money, tone: "bad",
        title: `${plural(late, "payout is", "payouts are")} late on Mingla`,
        detail: "Hosts are waiting on us.",
        href: "#/business-money-ledger?tab=payouts&status=late_on_us",
      });
    }
    const never = Number(ex.never_in_payout?.count || 0);
    if (never > 0) {
      items.push({
        id: "money-never", area: "money", areaLabel: AREA_LABEL.money, tone: "bad",
        title: `${plural(never, "paid sale was", "paid sales were")} never put into a payout`,
        detail: "Those hosts are owed money with no payout row.",
        href: "#/mingla-money",
      });
    }
  }

  if (health?.status === "error") items.push(failed("health", "system", "platform health", "health"));
  else if (health?.status === "ready") items.push(...healthProblems(health.data?.services ?? health.data));
  const q = queueHealthItem(queue);
  if (q) items.push(q);

  if (work?.status === "error") items.push(failed("work", "work", "Work", "work"));
  else if (work?.status === "ready" && Number(work.data?.cards) > 0) {
    const n = Number(work.data.cards);
    items.push({
      id: "work-waiting", area: "work", areaLabel: AREA_LABEL.work, tone: "warn",
      title: `${plural(n, "Work card is", "Work cards are")} waiting on you`,
      detail: "Messages to send, spend or publish to approve.",
      href: "#/work-board",
    });
  }

  if (summary?.status === "error") {
    items.push(failed("summary", "support", "support and inbound leads", "summary"));
  } else if (summary?.status === "ready") {
    const waiting = Number(summary.data?.support?.waiting_first_reply || 0);
    if (waiting > 0) {
      items.push({
        id: "support-waiting", area: "support", areaLabel: AREA_LABEL.support, tone: "warn",
        title: `${plural(waiting, "support ticket has", "support tickets have")} no reply yet`,
        detail: "The oldest is waiting for a first answer.",
        href: "#/support",
      });
    }
    const days = summary.data?.inbound?.days_since_last;
    if (days == null || Number(days) >= INBOUND_QUIET_DAYS) {
      items.push({
        id: "inbound-quiet", area: "growth", areaLabel: AREA_LABEL.growth, tone: "warn",
        title: days == null ? "No inbound lead has arrived yet" : `No inbound lead for ${days} days`,
        detail: "Check the free tools are still reachable and promoted.",
        href: "#/inbound",
      });
    }
  }

  // #4130 (integration): failed announcement pushes, the same reading as the
  // Support banner (lib/announcementDelivery.js, Wave 6).
  if (announcements?.status === "error") {
    items.push(failed("announcements", "community", "announcement pushes", "announcements"));
  } else if (announcements?.status === "ready") {
    const pushes = announcementsWithFailedPushes(announcements.data);
    const latest = pushes[0];
    if (latest) {
      const others = pushes.length - 1;
      items.push({
        id: "announcement-push-failed", area: "community", areaLabel: AREA_LABEL.community, tone: "bad",
        title: `${latest.failed} of ${latest.tried} announcement pushes failed`,
        detail: `${latest.title ? `"${latest.title}": t` : "T"}hose hosts did not get it on their phone.`
          + (others > 0 ? ` ${plural(others, "older announcement has", "older announcements have")} failed pushes too.` : ""),
        href: "#/community?tab=announcements",
      });
    }
  }

  const rank = { error: 0, bad: 1, warn: 2 };
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (rank[a.item.tone] ?? 9) - (rank[b.item.tone] ?? 9) || a.i - b.i)
    .map(({ item }) => item);
}

/** The 8-week chart rows: week label and the two counts. */
export function weeklyRows(summary) {
  return (Array.isArray(summary?.weekly) ? summary.weekly : []).map((w) => ({
    week: w.week_start,
    signups: Number(w.signups || 0),
    paidTickets: Number(w.paid_tickets || 0),
  }));
}

/** "Good morning" / "Good afternoon" / "Good evening" for the viewer's clock. */
export function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
