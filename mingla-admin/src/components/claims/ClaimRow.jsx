import { Badge } from "../ui/Badge";
import { formatDateTime } from "../../lib/formatters";
import { formatPhoneHref, resolveClaimDisplayPhone } from "../../lib/claimsPhone";

const CAT_LABELS = {
  restaurant: "Restaurant",
  play: "Play",
  creative_and_arts: "Creative & arts",
};

export function slaLabel(createdAt) {
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

/**
 * @param {object} props
 * @param {object} props.row
 * @param {boolean} [props.hasDuplicateSiblings]
 * @param {boolean} [props.isDuplicateOfApproved]
 * @param {() => void} props.onSelect
 */
export function ClaimRow({
  row,
  hasDuplicateSiblings,
  isDuplicateOfApproved,
  onSelect,
}) {
  const sla = slaLabel(row.created_at);
  const phoneInfo = resolveClaimDisplayPhone(row);
  const tel = formatPhoneHref(phoneInfo.phone);
  const addressLine = [row.address, row.city, row.country_code]
    .filter(Boolean)
    .join(", ");

  return (
    <tr
      className="border-b border-white/5 hover:bg-white/[0.04] cursor-pointer"
      onClick={onSelect}
    >
      <td className="py-3 pr-4 font-medium text-[var(--color-text-primary)]">
        <NameCell row={row} />
      </td>
      <td className="py-3 pr-4 text-[var(--color-text-secondary)] max-w-[200px]">
        <span className="line-clamp-2">{addressLine || "—"}</span>
      </td>
      <td className="py-3 pr-4 text-[var(--color-text-secondary)] whitespace-nowrap">
        {phoneInfo.phone ? (
          tel ? (
            <a
              href={tel}
              className="text-[var(--color-brand-400)] underline"
              onClick={(e) => e.stopPropagation()}
            >
              {phoneInfo.phone}
            </a>
          ) : (
            phoneInfo.phone
          )
        ) : (
          "—"
        )}
      </td>
      <td className="py-3 pr-4">
        <div className="flex flex-wrap gap-1">
          {row.place_pool_id ? (
            <Badge variant="brand">Pool match</Badge>
          ) : null}
          {row.marked_called_at ? (
            <Badge variant="success">Called</Badge>
          ) : null}
          {row.claim_follow_up_at ? (
            <Badge variant="warning">Follow-up</Badge>
          ) : null}
          {hasDuplicateSiblings ? (
            <Badge variant="warning">Duplicate queue</Badge>
          ) : null}
          {isDuplicateOfApproved ? (
            <Badge variant="error">Dup. of approved</Badge>
          ) : null}
        </div>
      </td>
      <td className="py-3 pr-4 text-[var(--color-text-secondary)] whitespace-nowrap">
        {formatDateTime(row.created_at)}
      </td>
      <td className="py-3 pr-4">
        <Badge variant={sla.tone}>{sla.text}</Badge>
      </td>
    </tr>
  );
}

function NameCell({ row }) {
  return (
    <>
      {row.name}
      <div className="text-xs font-normal text-[var(--color-text-tertiary)] mt-0.5">
        {CAT_LABELS[row.venue_category] ?? row.venue_category ?? "—"}
      </div>
    </>
  );
}

export default ClaimRow;
