/**
 * #3872 — Referrals workspace (approved K-hub / M-referrals / K-board /
 * K-links / K-invite). Everything scrolls together: no pinned header covers
 * the content on a phone. 2×2 stats, a segmented control (Offers, Promoters,
 * Links, Results), offers as rows with Live / Paused / Ended pills, invite as
 * a sheet, tracking links with clicks and sales inline and a QR action.
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  fetchReferralListingOptions,
  fetchReferralMembers,
  fetchReferralOffers,
  fetchReferralReport,
  fetchTrackingLinks,
  inviteReferralMembers,
  removeReferralMember,
  writeReferralOffer,
  writeTrackingLink,
  type ReferralMember,
  type ReferralOffer,
  type ReferralOfferDraft,
  type ReferralTrackingLink,
} from "../../services/referralService";
import {
  programErrorMessage,
  programMoney,
  programMoneyShort,
  shortDate,
} from "../../utils/creatorProgramFormat";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Sheet } from "../ui/Sheet";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import {
  Card,
  Chip,
  FieldError,
  Initials,
  ListGroup,
  ListRow,
  Muted,
  ProgramLoading,
  ProgramColumns,
  ProgramScreen,
  SectionLabel,
  Segmented,
  SheetBody,
  StatStrip,
  StatusTag,
  SummaryLine,
  programStyles,
} from "../programs/ProgramKit";
import { useMarketingActionRegistration } from "../people/MarketingBrandSwitcherContext";
import { ReferralOfferSheet } from "./ReferralOfferSheet";
import {
  memberStatusWords,
  offerPill,
  offerRowSummary,
  offerSummary,
  rankLeaderboard,
  slugIsValid,
} from "./referralWords";

const ROOT = "brand-referrals";
const QRCode = React.lazy(() => import("react-native-qrcode-svg"));
export type ReferralTab = "offers" | "promoters" | "links" | "results";
const TABS: readonly (readonly [ReferralTab, string])[] = [
  ["offers", "Offers"],
  ["promoters", "Promoters"],
  ["links", "Links"],
  ["results", "Results"],
];

export interface ReferralHomeViewProps {
  brandId: string;
  rank: number;
  currency: string;
  initialTab?: ReferralTab;
  fallback: string;
  /** Round 2: rendered inside Blast › Referrals (no title bar of its own). */
  embedded?: boolean;
}

type InviteRow = { name: string; email: string };

export const ReferralHomeView: React.FC<ReferralHomeViewProps> = ({
  brandId,
  rank,
  currency,
  initialTab = "offers",
  fallback,
  embedded = false,
}) => {
  const client = useQueryClient();
  const [tab, setTab] = React.useState<ReferralTab>(initialTab);
  React.useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  const [editing, setEditing] = React.useState<
    ReferralOffer | null | undefined
  >(undefined);
  const [acting, setActing] = React.useState<ReferralOffer | null>(null);
  const [inviting, setInviting] = React.useState(false);
  const [inviteOffer, setInviteOffer] = React.useState("");
  const [inviteRows, setInviteRows] = React.useState<InviteRow[]>([
    { name: "", email: "" },
  ]);
  const [creatingLink, setCreatingLink] = React.useState(false);
  const [linkLabel, setLinkLabel] = React.useState("");
  const [linkSlug, setLinkSlug] = React.useState("");
  const [qrSlug, setQrSlug] = React.useState<string | null>(null);
  const [member, setMember] = React.useState<ReferralMember | null>(null);
  const [removing, setRemoving] = React.useState<ReferralMember | null>(null);
  const [showBoard, setShowBoard] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const reportFrom = React.useMemo(() => {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() - 30);
    return value.toISOString();
  }, []);

  const offers = useQuery({
    queryKey: [ROOT, "offers", brandId],
    queryFn: () => fetchReferralOffers(brandId),
  });
  const members = useQuery({
    queryKey: [ROOT, "members", brandId],
    queryFn: () => fetchReferralMembers(brandId),
  });
  const links = useQuery({
    queryKey: [ROOT, "links", brandId],
    queryFn: () => fetchTrackingLinks(brandId),
  });
  const listings = useQuery({
    queryKey: [ROOT, "listings", brandId],
    queryFn: () => fetchReferralListingOptions(brandId),
  });
  const report = useQuery({
    queryKey: [ROOT, "report", brandId, reportFrom],
    queryFn: () =>
      fetchReferralReport(brandId, reportFrom, new Date().toISOString()),
  });
  const refresh = async (): Promise<void> => {
    await client.invalidateQueries({ queryKey: [ROOT] });
  };

  const fail = (fallbackText: string) => (failure: unknown) =>
    setError(programErrorMessage(failure, fallbackText));
  const offerWrite = useMutation({
    mutationFn: (draft: ReferralOfferDraft) =>
      writeReferralOffer(draft.id ? "update" : "create", draft),
    onSuccess: refresh,
  });
  const offerAction = useMutation({
    mutationFn: ({
      row,
      action,
    }: {
      row: ReferralOffer;
      action: "pause" | "resume" | "end" | "delete_draft";
    }) =>
      writeReferralOffer(action, { id: row.id, brandId, version: row.version }),
    onSuccess: async () => {
      setActing(null);
      await refresh();
    },
    onError: fail("We couldn't update this offer. Try again."),
  });
  const invite = useMutation({
    mutationFn: async () => {
      const people = inviteRows
        .map((row) => ({
          name: row.name.trim(),
          email: row.email.trim().toLowerCase(),
        }))
        .filter((row) => row.email.length > 0);
      if (!inviteOffer) throw new Error("choose_offer");
      if (people.length === 0) throw new Error("no_emails");
      return inviteReferralMembers(
        inviteOffer,
        people.map((row) => ({
          email: row.email,
          displayName: row.name || undefined,
        })),
      );
    },
    onSuccess: async (data) => {
      setInviting(false);
      setInviteRows([{ name: "", email: "" }]);
      await refresh();
      const failed = data.delivery.filter((row) => !row.sent).length;
      setNotice(
        failed
          ? `Invites saved. ${failed} email${failed === 1 ? "" : "s"} couldn't be sent yet; you can resend from Promoters.`
          : "Invites sent. Promoters accept from their email.",
      );
    },
    onError: fail(
      "We couldn't send these invites. Check the email addresses and try again.",
    ),
  });
  const linkWrite = useMutation({
    mutationFn: () =>
      writeTrackingLink("create", {
        brandId,
        label: linkLabel.trim(),
        slug: linkSlug.trim().toLowerCase(),
      }),
    onSuccess: async () => {
      setCreatingLink(false);
      setLinkLabel("");
      setLinkSlug("");
      await refresh();
    },
    onError: fail("We couldn't create this link. Try a different link name."),
  });

  const activeInvitable = (offers.data ?? []).filter(
    (row) =>
      row.status === "active" &&
      (row.audience === "invited" || row.audience === "both"),
  );
  React.useEffect(() => {
    if (!inviteOffer && activeInvitable[0])
      setInviteOffer(activeInvitable[0].id);
  }, [activeInvitable, inviteOffer]);

  const memberRows = (members.data ?? []).filter(
    (row) => row.status !== "removed",
  );
  const leaderboard = rankLeaderboard(members.data ?? []);
  const reportValue = report.data ?? {};
  const soldMinor = Number(reportValue.revenueMinor ?? 0);
  const linkRows = (links.data ?? []).filter((row) => row.archivedAt === null);

  const tabAction = React.useMemo(
    () => ({
      id: `referrals-${tab}`,
      label:
        tab === "offers"
          ? "Create offer"
          : tab === "promoters"
            ? "Invite promoters"
            : "New tracking link",
      compactLabel:
        tab === "offers" ? "Create" : tab === "promoters" ? "Invite" : "New link",
      icon: tab === "promoters" ? ("users" as const) : tab === "offers" ? ("gift" as const) : ("link" as const),
      onPress: () => {
        setError(null);
        if (tab === "offers") setEditing(null);
        else if (tab === "promoters") setInviting(true);
        else setCreatingLink(true);
      },
    }),
    [tab],
  );
  useMarketingActionRegistration(embedded ? tabAction : null);

  const resend = (row: ReferralMember) => {
    if (!row.email) return;
    void inviteReferralMembers(row.offerId, [
      {
        email: row.email,
        displayName: row.displayName,
        code: row.code ?? undefined,
      },
    ])
      .then(refresh)
      .then(() => {
        setMember(null);
        setNotice(`Invite resent to ${row.displayName}.`);
      })
      .catch(fail("We couldn't resend this invite. Try again."));
  };

  return (
    <ProgramScreen
      title="Referrals"
      fallback={fallback}
      embedded={embedded}
      right={
        embedded ? undefined : <Pressable
          onPress={() => {
            setError(null);
            setEditing(null);
          }}
          accessibilityRole="button"
          accessibilityLabel="Create offer"
          hitSlop={8}
          style={styles.plus}
        >
          <Icon name="plus" size={22} color={textTokens.primary} />
        </Pressable>
      }
      refreshing={false}
      onRefresh={() => void refresh()}
      overlay={
        <>
          <ReferralOfferSheet
            visible={editing !== undefined}
            brandId={brandId}
            rank={rank}
            currency={currency}
            offer={editing}
            listings={listings.data ?? []}
            onClose={() => setEditing(undefined)}
            onSave={(draft) =>
              offerWrite.mutateAsync(draft).then(() => undefined)
            }
          />
          <Sheet
            visible={acting !== null}
            onClose={() => setActing(null)}
            snapPoint="half"
          >
            {acting ? (
              <SheetBody title={acting.name}>
                <Muted>{offerSummary(acting, currency)}</Muted>
                <SummaryLine
                  label="People earning"
                  value={String(acting.memberCount)}
                />
                <SummaryLine label="Sales" value={String(acting.salesCount)} />
                <SummaryLine
                  label="Rewards"
                  value={programMoney(
                    acting.shareMinor,
                    acting.currency || currency,
                  )}
                />
                <Button
                  fullWidth
                  variant="secondary"
                  label="Edit offer"
                  onPress={() => {
                    const row = acting;
                    setActing(null);
                    setEditing(row);
                  }}
                />
                {acting.status === "active" ? (
                  <Button
                    fullWidth
                    variant="secondary"
                    label="Pause"
                    loading={offerAction.isPending}
                    onPress={() =>
                      offerAction.mutate({ row: acting, action: "pause" })
                    }
                  />
                ) : null}
                {acting.status === "paused" ? (
                  <Button
                    fullWidth
                    variant="secondary"
                    label="Resume"
                    loading={offerAction.isPending}
                    onPress={() =>
                      offerAction.mutate({ row: acting, action: "resume" })
                    }
                  />
                ) : null}
                {acting.status === "draft" ? (
                  <Button
                    fullWidth
                    variant="destructiveOutline"
                    label="Delete draft"
                    onPress={() =>
                      offerAction.mutate({
                        row: acting,
                        action: "delete_draft",
                      })
                    }
                  />
                ) : acting.status !== "ended" ? (
                  <Button
                    fullWidth
                    variant="destructiveOutline"
                    label="End offer"
                    onPress={() =>
                      offerAction.mutate({ row: acting, action: "end" })
                    }
                  />
                ) : null}
                <FieldError message={error} />
              </SheetBody>
            ) : null}
          </Sheet>
          <Sheet
            visible={inviting}
            onClose={() => setInviting(false)}
            snapPoint="full"
          >
            <SheetBody
              title="Invite promoters"
              footer={
                activeInvitable.length > 0 ? (
                  <Button
                    fullWidth
                    label="Send invites"
                    loading={invite.isPending}
                    disabled={
                      invite.isPending ||
                      !inviteRows.some((row) => row.email.trim().includes("@"))
                    }
                    onPress={() => {
                      setError(null);
                      invite.mutate();
                    }}
                  />
                ) : undefined
              }
            >
              {activeInvitable.length === 0 ? (
                <>
                  <Muted>
                    Start an offer for invited promoters first. It sets what
                    they earn.
                  </Muted>
                  <Button
                    fullWidth
                    label="Create offer"
                    onPress={() => {
                      setInviting(false);
                      setEditing(null);
                    }}
                  />
                </>
              ) : (
                <>
                  <Muted>
                    Each person gets a private link by email. Invites expire
                    after 14 days and can be resent.
                  </Muted>
                  <Text style={styles.label}>What they earn</Text>
                  <View style={styles.chips}>
                    {activeInvitable.map((offer) => (
                      <Chip
                        key={offer.id}
                        label={`${offer.name} · ${offerSummary(offer, currency, true)}`}
                        selected={inviteOffer === offer.id}
                        onPress={() => setInviteOffer(offer.id)}
                      />
                    ))}
                  </View>
                  {inviteRows.map((row, index) => (
                    <View key={index} style={styles.inviteRow}>
                      <Input
                        value={row.name}
                        onChangeText={(value) =>
                          setInviteRows((rows) =>
                            rows.map((item, i) =>
                              i === index ? { ...item, name: value } : item,
                            ),
                          )
                        }
                        placeholder="Name"
                        accessibilityLabel={`Promoter ${index + 1} name`}
                        style={programStyles.grow}
                      />
                      <Input
                        value={row.email}
                        onChangeText={(value) =>
                          setInviteRows((rows) =>
                            rows.map((item, i) =>
                              i === index ? { ...item, email: value } : item,
                            ),
                          )
                        }
                        variant="email"
                        placeholder="Email"
                        accessibilityLabel={`Promoter ${index + 1} email`}
                        style={programStyles.grow}
                      />
                    </View>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    label="Add another person"
                    onPress={() =>
                      setInviteRows((rows) => [
                        ...rows,
                        { name: "", email: "" },
                      ])
                    }
                  />
                  <FieldError message={error} />
                </>
              )}
            </SheetBody>
          </Sheet>
          <Sheet
            visible={creatingLink}
            onClose={() => setCreatingLink(false)}
            snapPoint="half"
          >
            <SheetBody title="New tracking link">
              <Muted>Measure a channel without paying anyone a reward.</Muted>
              <Input
                value={linkLabel}
                onChangeText={setLinkLabel}
                placeholder="Name, e.g. Instagram bio"
                accessibilityLabel="Link name"
                maxLength={60}
              />
              <View style={styles.slugRow}>
                <Text style={styles.slugPrefix}>usemingla.com/r/</Text>
                <TextInput
                  value={linkSlug}
                  onChangeText={(value) =>
                    setLinkSlug(value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))
                  }
                  style={styles.slugInput}
                  placeholder="summer-launch"
                  placeholderTextColor={textTokens.tertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={48}
                  accessibilityLabel="Link ending"
                />
              </View>
              {linkSlug.length > 0 && !slugIsValid(linkSlug) ? (
                <FieldError message="Use 6 to 48 lowercase letters, numbers, - or _." />
              ) : null}
              <FieldError message={error} />
              <Button
                fullWidth
                label="Create link"
                loading={linkWrite.isPending}
                disabled={
                  linkWrite.isPending ||
                  !linkLabel.trim() ||
                  !slugIsValid(linkSlug)
                }
                onPress={() => {
                  setError(null);
                  linkWrite.mutate();
                }}
              />
            </SheetBody>
          </Sheet>
          <Sheet
            visible={member !== null}
            onClose={() => setMember(null)}
            snapPoint="full"
          >
            {member ? (
              <SheetBody title={member.displayName}>
                <Muted>
                  {[member.email, memberStatusWords(member.status)]
                    .filter(Boolean)
                    .join(" · ")}
                </Muted>
                <Text
                  style={styles.link}
                  selectable
                >{`usemingla.com/r/${member.linkSlug}`}</Text>
                {member.code ? (
                  <Muted>{`Checkout code: ${member.code}`}</Muted>
                ) : null}
                <SummaryLine label="Sales" value={String(member.salesCount)} />
                <SummaryLine
                  label="Sold"
                  value={programMoney(
                    member.revenueMinor,
                    member.currency || currency,
                  )}
                />
                <SummaryLine
                  label="Earned"
                  value={programMoney(
                    member.owedMinor,
                    member.currency || currency,
                  )}
                />
                <SummaryLine
                  label="Paid"
                  value={programMoney(
                    member.paidMinor,
                    member.currency || currency,
                  )}
                />
                <SectionLabel>Activity</SectionLabel>
                <ListGroup>
                  <TimelineRow label="Invited" date={member.invitedAt} />
                  {member.joinedAt ? (
                    <TimelineRow label="Accepted" date={member.joinedAt} />
                  ) : null}
                  {member.activity.map((activity) => (
                    <TimelineRow
                      key={`${activity.orderKind}-${activity.orderId}`}
                      label={`${activity.status === "attributed" ? "Sale" : "Sale not counted"} · ${programMoney(activity.eligibleMinor, member.currency || currency)} · reward ${programMoney(activity.shareMinor, member.currency || currency)}`}
                      date={activity.happenedAt}
                    />
                  ))}
                </ListGroup>
                {member.status === "invited" && member.email ? (
                  <Button
                    fullWidth
                    variant="secondary"
                    label="Resend invite"
                    onPress={() => resend(member)}
                  />
                ) : null}
                {member.status !== "removed" ? (
                  <Button
                    fullWidth
                    variant="destructiveOutline"
                    label="Remove promoter"
                    onPress={() => setRemoving(member)}
                  />
                ) : null}
                <FieldError message={error} />
              </SheetBody>
            ) : null}
          </Sheet>
          <SimpleConfirmDialog
            visible={removing !== null}
            onClose={() => setRemoving(null)}
            onConfirm={() => {
              const row = removing;
              setRemoving(null);
              if (!row) return;
              void removeReferralMember(row.id)
                .then(refresh)
                .then(() => {
                  setMember(null);
                  setNotice(`${row.displayName} was removed.`);
                })
                .catch(fail("We couldn't remove this promoter. Try again."));
            }}
            title="Remove this promoter?"
            description="Their link stops earning new rewards. What they've already earned stays."
            confirmLabel="Remove"
            destructive
          />
        </>
      }
    >
      <ProgramColumns
        supportFirstOnCompact
        support={
          <>
            <StatStrip
              items={[
                { value: programMoneyShort(soldMinor, currency), label: "Sold" },
                {
                  value: String(Number(reportValue.orders ?? 0)),
                  label: "Tickets · 30d",
                },
                {
                  value: programMoneyShort(
                    Number(reportValue.paidMinor ?? 0),
                    currency,
                  ),
                  label: "Paid out",
                },
              ]}
            />
            <Text style={styles.feeNote}>
              Payouts are after Mingla&apos;s 5%. Buyers never pay extra, and
              tracking-only links never pay anyone.
            </Text>
          </>
        }
        primary={
          <>
            <Segmented
              options={TABS}
              value={tab}
              onChange={(next) => {
                setError(null);
                setTab(next);
              }}
            />
            {notice ? (
        <Text style={styles.notice} accessibilityLiveRegion="polite">
          {notice}
        </Text>
            ) : null}
            {acting === null && !inviting && !creatingLink && member === null ? (
        <FieldError message={error} />
            ) : null}

      {tab === "offers" ? (
        offers.isLoading ? (
          <ProgramLoading />
        ) : offers.isError ? (
          <Card>
            <Text style={programStyles.body}>Offers couldn&apos;t load.</Text>
            <Button
              variant="secondary"
              label="Try again"
              onPress={() => void refresh()}
            />
          </Card>
        ) : (offers.data ?? []).length === 0 ? (
          <Card>
            <Text style={programStyles.title}>No offers yet</Text>
            <Muted>
              Let buyers or invited promoters earn for the sales they bring you.
            </Muted>
            <Button label="Create offer" onPress={() => setEditing(null)} />
          </Card>
        ) : (
          <ListGroup>
            {(offers.data ?? []).map((row) => {
              const pill = offerPill(row);
              return (
                <ListRow
                  key={row.id}
                  compact
                  icon={row.audience === "buyers" ? "gift" : "users"}
                  title={row.name}
                  subtitle={offerRowSummary(row)}
                  right={<StatusTag label={pill.label} tone={pill.tone} />}
                  onPress={() => {
                    setError(null);
                    setActing(row);
                  }}
                />
              );
            })}
          </ListGroup>
        )
      ) : null}

      {tab === "promoters" ? (
        <>
          {leaderboard.length > 0 ? (
            <Card>
              <View style={styles.rowBetween}>
                <Text style={programStyles.title}>Leaderboard</Text>
                <Button
                  size="sm"
                  variant="ghost"
                  label={showBoard ? "Top 3" : "See all"}
                  onPress={() => setShowBoard((value) => !value)}
                />
              </View>
              {(showBoard ? leaderboard : leaderboard.slice(0, 3)).map(
                (row, index) => (
                  <ListRow
                    key={row.id}
                    leading={<Text style={styles.rank}>{index + 1}</Text>}
                    title={row.displayName}
                    right={`${row.salesCount} sale${row.salesCount === 1 ? "" : "s"}`}
                    chevron={false}
                  />
                ),
              )}
            </Card>
          ) : null}
          {members.isLoading ? (
            <ProgramLoading />
          ) : memberRows.length === 0 ? (
            <Card>
              <Text style={programStyles.title}>No promoters yet</Text>
              <Muted>People you invite, and what they earn, show here.</Muted>
            </Card>
          ) : (
            <ListGroup>
              {memberRows.map((row) => (
                <ListRow
                  key={row.id}
                  leading={<Initials name={row.displayName} />}
                  title={row.displayName}
                  subtitle={`${row.salesCount} sale${row.salesCount === 1 ? "" : "s"} · ${programMoney(row.revenueMinor, row.currency || currency)} sold`}
                  right={
                    <StatusTag
                      label={memberStatusWords(row.status)}
                      tone={row.status === "active" ? "done" : "waiting"}
                    />
                  }
                  onPress={() => {
                    setError(null);
                    setMember(row);
                  }}
                  accessibilityLabel={`View details for ${row.displayName}`}
                />
              ))}
            </ListGroup>
          )}
        </>
      ) : null}

      {tab === "links" ? (
        <>
          {links.isLoading ? (
            <ProgramLoading />
          ) : linkRows.length === 0 ? (
            <Card>
              <Text style={programStyles.title}>No tracking links</Text>
              <Muted>
                Make one per channel (Instagram bio, flyers, WhatsApp) to see
                which brings sales.
              </Muted>
            </Card>
          ) : (
            linkRows.map((row) => (
              <TrackingLinkRow
                key={row.id}
                row={row}
                currency={currency}
                qrOpen={qrSlug === row.slug}
                onQr={() =>
                  setQrSlug((current) =>
                    current === row.slug ? null : row.slug,
                  )
                }
                onArchive={() =>
                  void writeTrackingLink("archive", { id: row.id })
                    .then(refresh)
                    .catch(fail("We couldn't archive this link. Try again."))
                }
              />
            ))
          )}
        </>
      ) : null}

      {tab === "results" ? (
        <>
          <Card>
            <Text style={programStyles.title}>Last 30 days</Text>
            <SummaryLine
              label="Orders"
              value={String(Number(reportValue.orders ?? 0))}
            />
            <SummaryLine
              label="Sold"
              value={programMoney(soldMinor, currency)}
            />
            <SummaryLine
              label="Rewards"
              value={programMoney(
                Number(reportValue.shareMinor ?? 0),
                currency,
              )}
            />
            <SummaryLine
              label="Paid"
              value={programMoney(Number(reportValue.paidMinor ?? 0), currency)}
            />
            <SummaryLine
              label="Reversed after refunds"
              value={programMoney(
                Number(reportValue.reversedMinor ?? 0),
                currency,
              )}
            />
          </Card>
        </>
      ) : null}
          </>
        }
      />
    </ProgramScreen>
  );
};

const TrackingLinkRow: React.FC<{
  row: ReferralTrackingLink;
  currency: string;
  qrOpen: boolean;
  onQr: () => void;
  onArchive: () => void;
}> = ({ row, currency, qrOpen, onQr, onArchive }) => {
  const url = `https://usemingla.com/r/${row.slug}`;
  const [copied, setCopied] = React.useState(false);
  return (
    <Card>
      <ListRow
        title={row.label}
        subtitle={`${row.touchCount.toLocaleString()} clicks · ${row.orderCount} ticket${row.orderCount === 1 ? "" : "s"} · ${programMoney(row.revenueMinor, currency)}`}
        chevron={false}
      />
      <Text
        style={styles.link}
        selectable
      >{`usemingla.com/r/${row.slug}`}</Text>
      <View style={programStyles.footerRow}>
        <Button
          size="sm"
          variant="secondary"
          style={programStyles.grow}
          label={copied ? "Copied" : "Copy"}
          onPress={() => {
            void Clipboard.setStringAsync(url);
            setCopied(true);
          }}
        />
        <Button
          size="sm"
          variant="secondary"
          style={programStyles.grow}
          label={qrOpen ? "Hide QR" : "Show QR"}
          onPress={onQr}
        />
        <Button size="sm" variant="ghost" label="Archive" onPress={onArchive} />
      </View>
      {qrOpen ? (
        <View style={styles.qr}>
          <React.Suspense fallback={<ActivityIndicator color={accent.warm} />}>
            <QRCode value={url} size={176} />
          </React.Suspense>
          <Text style={styles.qrCaption}>Scan to open this link</Text>
        </View>
      ) : null}
    </Card>
  );
};

const TimelineRow: React.FC<{ label: string; date: string }> = ({
  label,
  date,
}) => <ListRow title={label} subtitle={shortDate(date)} chevron={false} />;

const styles = StyleSheet.create({
  plus: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  notice: { color: textTokens.primary, fontWeight: "600" },
  feeNote: { color: textTokens.tertiary, fontSize: 12, lineHeight: 16 },
  label: { color: textTokens.secondary, fontSize: 13, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  inviteRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rank: {
    width: 28,
    color: accent.warm,
    fontWeight: "800",
    fontSize: 16,
    textAlign: "center",
  },
  link: { color: accent.warm, fontWeight: "600" },
  slugRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: glass.border.control,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    minHeight: 48,
  },
  slugPrefix: { color: textTokens.tertiary, fontSize: 15 },
  slugInput: {
    flex: 1,
    color: textTokens.primary,
    fontSize: 15,
    paddingVertical: spacing.sm,
  },
  qr: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#FFFFFF",
  },
  qrCaption: { color: "#333333", fontSize: 12 },
});
