// Issue #4270 (Wave 2) — "Brand and team" on a host card: the brand, once
// (photo, name, Open Brand group), the host's Mingla owners, and the brand's
// own team by name and role (never their email). Linking or unlinking the
// brand stays under Details ("Brand in Mingla").
import { BRAND_ROLE_WORDS, opsErrorWords } from "../../lib/opsModel";
import { Button } from "../ui/Button";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)] focus-visible:ring-offset-2";
const WORDS = "break-normal [overflow-wrap:normal] hyphens-none";

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : String(name || "?").slice(0, 2)).toUpperCase();
}

/** The Brand group of a brand, on the Community page. */
function brandGroupHref(brandId) {
  return brandId ? `#/community?tab=brand-groups&brand=${encodeURIComponent(brandId)}` : "";
}

export function HostTeamSection({ record, read }) {
  const id = record?.id;
  const data = read?.data;
  const brand = data?.brand || null;
  const owners = Array.isArray(data?.team?.owners) ? data.team.owners : [];
  const members = Array.isArray(data?.team?.brand_members) ? data.team.brand_members : [];
  return (
    <section aria-labelledby={`host-team-${id}`} data-host-section="team" className="flex min-w-0 flex-col gap-2 border-t border-[var(--gray-200)] pt-3">
      <h3 id={`host-team-${id}`} className="text-[14px] font-semibold text-[var(--color-text-primary)]">Brand and team</h3>
      {read?.loading ? (
        <div role="status" className="h-11 animate-pulse rounded-lg bg-[var(--gray-100)]"><span className="sr-only">Loading the brand and team…</span></div>
      ) : read?.error && !data ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] text-[var(--color-error-700)]">
          <span className={`min-w-0 ${WORDS}`}>Couldn’t load the brand and team. {opsErrorWords(read.error)}</span>
          <Button variant="secondary" size="sm" className="min-h-11" onClick={read.retry}>Try again</Button>
        </div>
      ) : (
        <>
          {brand ? (
            <div data-host-brand="" className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-[var(--gray-200)] px-3 py-2">
              {brand.photo_url
                ? <img src={brand.photo_url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                : <span aria-hidden="true" className="inline-grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--color-brand-100)] text-[12px] font-bold text-[var(--color-brand-700)]">{initials(brand.name)}</span>}
              <span className="min-w-0 flex-1">
                <a href={`#/brands?brandId=${encodeURIComponent(brand.id)}`} className={`block text-[13.5px] font-semibold text-[var(--color-text-primary)] hover:underline ${WORDS} ${FOCUS}`}>{brand.name}</a>
                {brand.slug && <span className="block text-[12px] text-[var(--color-text-tertiary)]">/{brand.slug}</span>}
              </span>
              <a href={brandGroupHref(brand.id)} className={`inline-flex min-h-11 items-center rounded-lg px-2 text-[12.5px] font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)] ${FOCUS}`}>Open Brand group</a>
            </div>
          ) : (
            <p className={`rounded-xl bg-[var(--gray-100)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] ${WORDS}`}>No brand linked yet.</p>
          )}
          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-[var(--color-text-tertiary)]">Mingla owners</dt>
            <dd className={`min-w-0 text-[var(--color-text-primary)] ${WORDS}`}>
              {owners.length ? owners.map((o) => o.name).join(", ") : <span className="font-semibold text-[var(--color-error-700)]">No owner</span>}
            </dd>
            {brand && (
              <>
                <dt className="text-[var(--color-text-tertiary)]">Brand team</dt>
                <dd className="min-w-0">
                  {members.length ? (
                    <ul className="flex min-w-0 flex-col gap-1">
                      {members.map((m, i) => (
                        <li key={`${m.name}-${m.role}-${i}`} className={`text-[var(--color-text-primary)] ${WORDS}`}>
                          {m.name} <span className="text-[var(--color-text-tertiary)]">· {BRAND_ROLE_WORDS[m.role] || "Team"}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <span className="text-[var(--color-text-tertiary)]">Nobody has joined the brand’s team yet.</span>}
                </dd>
              </>
            )}
          </dl>
        </>
      )}
    </section>
  );
}
