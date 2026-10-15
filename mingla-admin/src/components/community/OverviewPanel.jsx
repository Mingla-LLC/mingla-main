import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { SectionCard, StatCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import {
  countDraftAnnouncements,
  countOpenSupportTickets,
  fetchSupportIsOnline,
  listAnnouncements,
  listRoadmapCards,
} from "../../services/communityService";

export function OverviewPanel({ onGoTab }) {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    openTickets: 0,
    draftAnnouncements: 0,
    publishedRoadmap: 0,
    online: false,
  });
  const [recent, setRecent] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [openTickets, draftAnnouncements, online, announcements, roadmap] =
        await Promise.all([
          countOpenSupportTickets(),
          countDraftAnnouncements(),
          fetchSupportIsOnline(),
          listAnnouncements(),
          listRoadmapCards(),
        ]);
      setStats({
        openTickets,
        draftAnnouncements,
        publishedRoadmap: roadmap.filter((r) => r.status === "published").length,
        online,
      });
      setRecent(announcements.slice(0, 5));
    } catch (err) {
      addToast({
        variant: "error",
        title: "Could not load overview",
        description: err?.message,
      });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open tickets" value={String(stats.openTickets)} />
        <StatCard label="Draft announcements" value={String(stats.draftAnnouncements)} />
        <StatCard label="Published roadmap" value={String(stats.publishedRoadmap)} />
        <StatCard label="Support presence" value={stats.online ? "Online" : "Away"} />
      </div>
      {onGoTab && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => onGoTab("support")}>
            Open support
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onGoTab("availability")}>
            Open availability
          </Button>
        </div>
      )}

      <SectionCard
        title="Recent announcements"
        action={
          onGoTab ? (
            <Button variant="secondary" size="sm" onClick={() => onGoTab("announcements")}>
              Open
            </Button>
          ) : null
        }
      >
        {recent.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No announcements yet.</p>
        ) : (
          <ul className="space-y-2">
            {recent.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="truncate text-[var(--color-text-primary)]">{row.title}</span>
                <Badge
                  variant={
                    row.status === "published"
                      ? "success"
                      : row.status === "archived"
                        ? "warning"
                        : "default"
                  }
                >
                  {row.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
