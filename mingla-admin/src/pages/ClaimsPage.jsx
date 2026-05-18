/**
 * Ve1 — Venue claims queue (physical brands pending_review).
 */

import { useCallback, useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { supabase } from "../lib/supabase";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import { formatDateTime } from "../lib/formatters";

const CAT_LABELS = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & arts",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function slaLabel(createdAt) {
  const start = new Date(createdAt).getTime();
  const due = start + 4 * 60 * 60 * 1000;
  const ms = due - Date.now();
  if (ms <= 0) return { text: "Past 4h window", tone: "warning" };
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const text = h > 0 ? `${h}h ${mm}m remaining` : `${mm}m remaining`;
  return { text, tone: "info" };
}

export function ClaimsPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [hours, setHours] = useState([]);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("brands")
        .select(
          "id,name,slug,venue_category,city,country_code,address,created_at,contact_email,contact_phone,description,google_place_id,lat,lng,cover_media_url",
        )
        .eq("kind", "physical")
        .eq("claim_status", "pending_review")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRows(data ?? []);
    } catch (e) {
      addToast({
        variant: "error",
        title: "Couldn't load claims",
        description: e?.message ?? String(e),
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (row) => {
    setDetail(row);
    setHours([]);
    setHoursLoading(true);
    try {
      const { data, error } = await supabase
        .from("brand_hours")
        .select("weekday,open_time,close_time,is_closed")
        .eq("brand_id", row.id)
        .order("weekday", { ascending: true });
      if (error) throw error;
      setHours(data ?? []);
    } catch (e) {
      addToast({
        variant: "warning",
        title: "Hours unavailable",
        description: e?.message ?? String(e),
      });
    } finally {
      setHoursLoading(false);
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setHours([]);
  };

  const approve = async () => {
    if (!detail) return;
    setActing(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      const { error } = await supabase
        .from("brands")
        .update({
          claim_status: "verified",
          verified_at: new Date().toISOString(),
          verified_by: uid,
        })
        .eq("id", detail.id);
      if (error) throw error;
      addToast({ variant: "info", title: "Venue approved" });
      closeDetail();
      await load();
    } catch (e) {
      addToast({
        variant: "error",
        title: "Approve failed",
        description: e?.message ?? String(e),
      });
    } finally {
      setActing(false);
    }
  };

  const reject = async () => {
    if (!detail) return;
    setActing(true);
    try {
      const { error } = await supabase
        .from("brands")
        .update({ claim_status: "rejected" })
        .eq("id", detail.id);
      if (error) throw error;
      addToast({ variant: "info", title: "Venue rejected" });
      closeDetail();
      await load();
    } catch (e) {
      addToast({
        variant: "error",
        title: "Reject failed",
        description: e?.message ?? String(e),
      });
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <ClipboardList className="h-8 w-8 text-[var(--color-brand-500)]" />
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            Venue claims
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Physical brands awaiting verification (Ve1)
          </p>
        </div>
        <Button variant="secondary" className="ml-auto" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <SectionCard title={`Queue (${rows.length})`} subtitle="Submitted venue brands">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)] py-8 text-center">
            No pending venue claims.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[var(--color-text-tertiary)]">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2 pr-4">City</th>
                  <th className="py-2 pr-4">Submitted</th>
                  <th className="py-2 pr-4">SLA</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const sla = slaLabel(r.created_at);
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-white/5 hover:bg-white/[0.04] cursor-pointer"
                      onClick={() => openDetail(r)}
                    >
                      <td className="py-3 pr-4 font-medium text-[var(--color-text-primary)]">
                        {r.name}
                      </td>
                      <td className="py-3 pr-4 text-[var(--color-text-secondary)]">
                        {CAT_LABELS[r.venue_category] ?? r.venue_category ?? "—"}
                      </td>
                      <td className="py-3 pr-4 text-[var(--color-text-secondary)]">
                        {[r.city, r.country_code].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td className="py-3 pr-4 text-[var(--color-text-secondary)] whitespace-nowrap">
                        {formatDateTime(r.created_at)}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={sla.tone}>{sla.text}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Modal open={!!detail} onClose={closeDetail} title={detail?.name ?? "Venue"}>
        <ModalBody>
          {!detail ? null : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="text-[var(--color-text-tertiary)]">Slug</div>
                <div>{detail.slug}</div>
                <div className="text-[var(--color-text-tertiary)]">Category</div>
                <div>{CAT_LABELS[detail.venue_category] ?? detail.venue_category}</div>
                <div className="text-[var(--color-text-tertiary)]">Google Place</div>
                <div className="break-all">{detail.google_place_id ?? "—"}</div>
                <div className="text-[var(--color-text-tertiary)]">Location</div>
                <div>
                  {detail.lat != null && detail.lng != null
                    ? `${detail.lat}, ${detail.lng}`
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-[var(--color-text-tertiary)] mb-1">Address</div>
                <div>{detail.address || "—"}</div>
              </div>
              <div>
                <div className="text-[var(--color-text-tertiary)] mb-1">Contact</div>
                <div>
                  {[detail.contact_email, detail.contact_phone].filter(Boolean).join(" · ") ||
                    "—"}
                </div>
              </div>
              <div>
                <div className="text-[var(--color-text-tertiary)] mb-1">Description</div>
                <div className="whitespace-pre-wrap">{detail.description || "—"}</div>
              </div>
              {detail.cover_media_url ? (
                <div>
                  <div className="text-[var(--color-text-tertiary)] mb-1">Cover</div>
                  <a
                    href={detail.cover_media_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--color-brand-400)] underline"
                  >
                    Open image
                  </a>
                </div>
              ) : null}
              <div>
                <div className="text-[var(--color-text-tertiary)] mb-2">Hours</div>
                {hoursLoading ? (
                  <Spinner />
                ) : (
                  <ul className="space-y-1">
                    {hours.map((h) => (
                      <li key={h.weekday} className="flex justify-between gap-4">
                        <span>{WEEKDAYS[h.weekday] ?? h.weekday}</span>
                        <span className="text-[var(--color-text-secondary)]">
                          {h.is_closed
                            ? "Closed"
                            : `${h.open_time ?? "—"} – ${h.close_time ?? "—"}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={closeDetail} disabled={acting}>
            Close
          </Button>
          <Button variant="danger" onClick={() => void reject()} disabled={acting}>
            Reject
          </Button>
          <Button variant="primary" onClick={() => void approve()} disabled={acting}>
            Approve
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

export default ClaimsPage;
