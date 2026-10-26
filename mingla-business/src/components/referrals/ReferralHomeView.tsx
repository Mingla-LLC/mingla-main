import React from "react";
import {
  Alert,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { ScrollView } from "../../wrappers/SmartScrollView";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  accent,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { formatCurrency } from "../../utils/currency";
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
import { Button } from "../ui/Button";
import { ReferralOfferSheet } from "./ReferralOfferSheet";

const ROOT = "brand-referrals";
const QRCode = React.lazy(() => import("react-native-qrcode-svg"));
type Tab = "offers" | "promoters" | "leaderboard" | "links" | "results";
const TABS: [Tab, string][] = [
  ["offers", "Offers"],
  ["promoters", "Promoters"],
  ["leaderboard", "Leaderboard"],
  ["links", "Tracking links"],
  ["results", "Results"],
];

export interface ReferralHomeViewProps {
  brandId: string;
  rank: number;
  currency: string;
}

export const ReferralHomeView: React.FC<ReferralHomeViewProps> = ({
  brandId,
  rank,
  currency,
}) => {
  const client = useQueryClient();
  const { width } = useWindowDimensions();
  const [tab, setTab] = React.useState<Tab>("offers");
  const [editing, setEditing] = React.useState<
    ReferralOffer | null | undefined
  >(undefined);
  const [inviteOffer, setInviteOffer] = React.useState<string>("");
  const [inviteEmails, setInviteEmails] = React.useState("");
  const [linkLabel, setLinkLabel] = React.useState("");
  const [linkSlug, setLinkSlug] = React.useState("");
  const now = React.useMemo(() => new Date(), []);
  const reportFrom = React.useMemo(() => {
    const value = new Date(now);
    value.setUTCDate(value.getUTCDate() - 30);
    return value.toISOString();
  }, [now]);

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
  const refreshing =
    offers.isFetching ||
    members.isFetching ||
    links.isFetching ||
    report.isFetching;

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
    onSuccess: refresh,
  });
  const invite = useMutation({
    mutationFn: async () => {
      const emails = Array.from(
        new Set(
          inviteEmails
            .split(/[\s,;]+/)
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean),
        ),
      );
      if (!inviteOffer) throw new Error("Choose an invited-promoter offer.");
      if (emails.length === 0)
        throw new Error("Enter at least one email address.");
      return inviteReferralMembers(
        inviteOffer,
        emails.map((email) => ({ email })),
      );
    },
    onSuccess: async (data) => {
      setInviteEmails("");
      await refresh();
      const failed = data.delivery.filter((row) => !row.sent).length;
      Alert.alert(
        failed ? "Invites saved" : "Invites sent",
        failed
          ? `${failed} email${failed === 1 ? "" : "s"} could not be delivered yet. You can retry safely.`
          : "Promoters can accept from their email.",
      );
    },
    onError: (error) =>
      Alert.alert(
        "Couldn’t invite promoters",
        error instanceof Error ? error.message : "Try again.",
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
      setLinkLabel("");
      setLinkSlug("");
      await refresh();
    },
    onError: (error) =>
      Alert.alert(
        "Couldn’t create link",
        error instanceof Error ? error.message : "Try again.",
      ),
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

  return (
    <View style={styles.page}>
      <View style={styles.hero}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>REFERRALS</Text>
          <Text style={styles.heroTitle}>
            Turn happy buyers into your street team
          </Text>
          <Text style={styles.sub}>
            Choose who can share, what they earn, and where the offer works.
            Mingla attributes the sale and handles eligible payouts.
          </Text>
          <View style={styles.metrics}>
            <Metric
              label="Active offers"
              value={String(
                (offers.data ?? []).filter((row) => row.status === "active")
                  .length,
              )}
            />
            <Metric
              label="Promoters"
              value={String(
                (members.data ?? []).filter((row) => row.status !== "removed")
                  .length,
              )}
            />
            <Metric
              label="Attributed orders"
              value={String(Number(report.data?.orders ?? 0))}
            />
            <Metric
              label="Revenue"
              value={formatCurrency(
                Number(report.data?.revenueMinor ?? 0),
                currency,
                true,
              )}
            />
          </View>
        </View>
        <Button label="Create offer" onPress={() => setEditing(null)} />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabs}
      >
        {TABS.map(([value, label]) => (
          <Pressable
            key={value}
            accessibilityLabel={`Open ${label} referral tab`}
            onPress={() => setTab(value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            style={[styles.tab, tab === value && styles.tabOn]}
          >
            <Text style={[styles.tabText, tab === value && styles.tabTextOn]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
          />
        }
        contentContainerStyle={styles.content}
      >
        {tab === "offers" ? (
          <Offers
            rows={offers.data ?? []}
            loading={offers.isLoading}
            error={offers.isError}
            currency={currency}
            onEdit={setEditing}
            onAction={(row, action) => offerAction.mutate({ row, action })}
          />
        ) : null}
        {tab === "promoters" ? (
          <Promoters
            rows={members.data ?? []}
            offers={activeInvitable}
            selectedOffer={inviteOffer}
            emails={inviteEmails}
            currency={currency}
            compact={width < 720}
            onSelectOffer={setInviteOffer}
            onChangeEmails={setInviteEmails}
            onInvite={() => invite.mutate()}
            inviting={invite.isPending}
            onResend={(row) => {
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
                  Alert.alert(
                    "Invite resent",
                    `A fresh private link was sent to ${row.email}.`,
                  );
                })
                .catch((error) => {
                  Alert.alert(
                    "Couldn’t resend invite",
                    error instanceof Error ? error.message : "Try again.",
                  );
                });
            }}
            onRemove={(row) =>
              Alert.alert(
                "Remove this promoter?",
                "Their link stops earning new rewards. Existing earnings remain in the ledger.",
                [
                  { text: "Keep", style: "cancel" },
                  {
                    text: "Remove",
                    style: "destructive",
                    onPress: () =>
                      void removeReferralMember(row.id)
                        .then(refresh)
                        .catch((error) =>
                          Alert.alert(
                            "Couldn’t remove promoter",
                            error instanceof Error
                              ? error.message
                              : "Try again.",
                          ),
                        ),
                  },
                ],
              )
            }
          />
        ) : null}
        {tab === "leaderboard" ? (
          <Leaderboard rows={members.data ?? []} currency={currency} />
        ) : null}
        {tab === "links" ? (
          <TrackingLinks
            rows={links.data ?? []}
            currency={currency}
            label={linkLabel}
            slug={linkSlug}
            onLabel={setLinkLabel}
            onSlug={setLinkSlug}
            creating={linkWrite.isPending}
            onCreate={() => linkWrite.mutate()}
            onCopy={(slug) =>
              void Clipboard.setStringAsync(`https://usemingla.com/r/${slug}`)
            }
            onArchive={(id) =>
              void writeTrackingLink("archive", { id })
                .then(refresh)
                .catch((error) =>
                  Alert.alert(
                    "Couldn’t archive link",
                    error instanceof Error ? error.message : "Try again.",
                  ),
                )
            }
          />
        ) : null}
        {tab === "results" ? (
          <Results value={report.data} currency={currency} />
        ) : null}
      </ScrollView>
      <ReferralOfferSheet
        visible={editing !== undefined}
        brandId={brandId}
        rank={rank}
        currency={currency}
        offer={editing}
        listings={listings.data ?? []}
        onClose={() => setEditing(undefined)}
        onSave={(draft) => offerWrite.mutateAsync(draft).then(() => undefined)}
      />
    </View>
  );
};

const Offers: React.FC<{
  rows: ReferralOffer[];
  loading: boolean;
  error: boolean;
  currency: string;
  onEdit: (row: ReferralOffer) => void;
  onAction: (
    row: ReferralOffer,
    action: "pause" | "resume" | "end" | "delete_draft",
  ) => void;
}> = ({ rows, loading, error, currency, onEdit, onAction }) => {
  if (loading) return <State text="Loading referral offers…" />;
  if (error)
    return <State text="Referral offers couldn’t load. Pull to try again." />;
  if (rows.length === 0)
    return (
      <State
        title="No referral offers yet"
        text="Create one to let buyers or invited promoters earn for sales they bring you."
      />
    );
  return (
    <View style={styles.stack}>
      {rows.map((row) => (
        <View key={row.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.grow}>
              <Text style={styles.cardTitle}>{row.name}</Text>
              <Text style={styles.meta}>
                {row.audience === "both"
                  ? "Buyers + promoters"
                  : row.audience === "buyers"
                    ? "Every buyer"
                    : "Invited promoters"}{" "}
                · {row.status}
              </Text>
            </View>
            <Status value={row.status} />
          </View>
          <Text style={styles.reward}>
            {row.rewardKind === "cash"
              ? `${(row.shareBps ?? 0) / 100}% of eligible sales`
              : row.rewardKind === "voucher"
                ? "Future-order voucher"
                : row.perkText}
          </Text>
          <View style={styles.metrics}>
            <Metric label="People" value={String(row.memberCount)} />
            <Metric label="Sales" value={String(row.salesCount)} />
            <Metric
              label="Rewards"
              value={formatCurrency(
                row.shareMinor,
                row.currency || currency,
                true,
              )}
            />
          </View>
          <View style={styles.actions}>
            <Button
              size="sm"
              variant="secondary"
              label="Edit"
              onPress={() => onEdit(row)}
            />
            {row.status === "active" ? (
              <Button
                size="sm"
                variant="secondary"
                label="Pause"
                onPress={() => onAction(row, "pause")}
              />
            ) : null}
            {row.status === "paused" ? (
              <Button
                size="sm"
                variant="secondary"
                label="Resume"
                onPress={() => onAction(row, "resume")}
              />
            ) : null}
            {row.status === "draft" ? (
              <Button
                size="sm"
                variant="destructiveOutline"
                label="Delete draft"
                onPress={() => onAction(row, "delete_draft")}
              />
            ) : row.status !== "ended" ? (
              <Button
                size="sm"
                variant="destructiveOutline"
                label="End"
                onPress={() => onAction(row, "end")}
              />
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
};

const Promoters: React.FC<{
  rows: ReferralMember[];
  offers: ReferralOffer[];
  selectedOffer: string;
  emails: string;
  currency: string;
  compact: boolean;
  inviting: boolean;
  onSelectOffer: (id: string) => void;
  onChangeEmails: (value: string) => void;
  onInvite: () => void;
  onResend: (row: ReferralMember) => void;
  onRemove: (row: ReferralMember) => void;
}> = ({
  rows,
  offers,
  selectedOffer,
  emails,
  currency,
  compact,
  inviting,
  onSelectOffer,
  onChangeEmails,
  onInvite,
  onResend,
  onRemove,
}) => {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Invite promoters</Text>
        <Text style={styles.sub}>
          Email a private acceptance link. Invites expire after 14 days and can
          be retried safely.
        </Text>
        <View style={styles.chips}>
          {offers.map((offer) => (
            <Pressable
              key={offer.id}
              accessibilityLabel={`Select referral offer ${offer.name}`}
              onPress={() => onSelectOffer(offer.id)}
              style={[styles.chip, selectedOffer === offer.id && styles.chipOn]}
            >
              <Text
                style={[
                  styles.chipText,
                  selectedOffer === offer.id && styles.tabTextOn,
                ]}
              >
                {offer.name}
              </Text>
            </Pressable>
          ))}
        </View>
        {offers.length === 0 ? (
          <Text style={styles.warning}>
            Create an active “Invited promoters” or “Buyers + promoters” offer
            first.
          </Text>
        ) : (
          <>
            <TextInput
              value={emails}
              onChangeText={onChangeEmails}
              style={[styles.input, styles.multiline]}
              multiline
              placeholder="alex@example.com, sam@example.com"
              placeholderTextColor={textTokens.tertiary}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Button
              label={inviting ? "Sending…" : "Send invites"}
              disabled={inviting || !emails.trim()}
              onPress={onInvite}
            />
          </>
        )}
      </View>
      {rows.length === 0 ? (
        <State
          title="No promoters yet"
          text="Invited people and their earnings will appear here."
        />
      ) : (
        rows.map((row) => (
          <View
            key={row.id}
            style={[styles.card, compact && styles.cardCompact]}
          >
            <View style={styles.rowBetween}>
              <View style={styles.grow}>
                <Text style={styles.cardTitle}>{row.displayName}</Text>
                <Text style={styles.meta}>
                  {row.email ?? "Signed-in member"} · {row.status}
                </Text>
              </View>
              {row.status !== "removed" ? (
                <View style={styles.actions}>
                  {row.status === "invited" && row.email ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      label="Resend"
                      onPress={() => onResend(row)}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    variant="destructiveOutline"
                    label="Remove"
                    onPress={() => onRemove(row)}
                  />
                </View>
              ) : null}
            </View>
            <View style={styles.metrics}>
              <Metric label="Sales" value={String(row.salesCount)} />
              <Metric
                label="Revenue"
                value={formatCurrency(
                  row.revenueMinor,
                  row.currency || currency,
                  true,
                )}
              />
              <Metric
                label="Earned"
                value={formatCurrency(
                  row.owedMinor,
                  row.currency || currency,
                  true,
                )}
              />
              <Metric
                label="Paid"
                value={formatCurrency(
                  row.paidMinor,
                  row.currency || currency,
                  true,
                )}
              />
            </View>
            <Button
              size="sm"
              variant="secondary"
              label={expandedId === row.id ? "Hide details" : "View details"}
              onPress={() =>
                setExpandedId((current) => (current === row.id ? null : row.id))
              }
            />
            {expandedId === row.id ? (
              <View style={styles.detailPanel}>
                <Text style={styles.detailTitle}>Promoter details</Text>
                <Text style={styles.link}>usemingla.com/r/{row.linkSlug}</Text>
                {row.code ? (
                  <Text style={styles.meta}>Checkout code: {row.code}</Text>
                ) : null}
                <View style={styles.timeline}>
                  <TimelineRow label="Invited" date={row.invitedAt} />
                  {row.joinedAt ? (
                    <TimelineRow label="Accepted" date={row.joinedAt} />
                  ) : null}
                  {row.activity.map((activity) => (
                    <TimelineRow
                      key={`${activity.orderKind}-${activity.orderId}`}
                      label={`${activity.status === "attributed" ? "Attributed" : "Rejected"} ${activity.orderKind === "ticket" ? "ticket" : "venue"} order · ${formatCurrency(activity.eligibleMinor, row.currency || currency, true)} revenue · ${formatCurrency(activity.shareMinor, row.currency || currency, true)} reward`}
                      date={activity.happenedAt}
                    />
                  ))}
                  {row.activity.length === 0 ? (
                    <Text style={styles.meta}>No attributed orders yet.</Text>
                  ) : null}
                </View>
              </View>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
};

const Leaderboard: React.FC<{ rows: ReferralMember[]; currency: string }> = ({
  rows,
  currency,
}) => {
  const ranked = [...rows]
    .filter((row) => row.status !== "removed")
    .sort(
      (a, b) =>
        b.salesCount - a.salesCount ||
        b.revenueMinor - a.revenueMinor ||
        a.displayName.localeCompare(b.displayName),
    );
  if (ranked.length === 0)
    return (
      <State
        title="No leaderboard yet"
        text="Invite promoters and their attributed sales will rank here."
      />
    );
  return (
    <View style={styles.stack}>
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>Promoter leaderboard</Text>
        <Text style={styles.sub}>
          Ranked by attributed sales, then revenue. Removed promoters are
          excluded.
        </Text>
      </View>
      {ranked.map((row, index) => (
        <View key={row.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.rank}>
              <Text style={styles.rankText}>#{index + 1}</Text>
            </View>
            <View style={styles.grow}>
              <Text style={styles.cardTitle}>{row.displayName}</Text>
              <Text style={styles.meta}>
                {row.status} · {row.email ?? "Signed-in member"}
              </Text>
            </View>
            <Text style={styles.reward}>
              {row.salesCount} sale{row.salesCount === 1 ? "" : "s"}
            </Text>
          </View>
          <View style={styles.metrics}>
            <Metric
              label="Revenue"
              value={formatCurrency(
                row.revenueMinor,
                row.currency || currency,
                true,
              )}
            />
            <Metric
              label="Earned"
              value={formatCurrency(
                row.owedMinor,
                row.currency || currency,
                true,
              )}
            />
            <Metric
              label="Paid"
              value={formatCurrency(
                row.paidMinor,
                row.currency || currency,
                true,
              )}
            />
          </View>
        </View>
      ))}
    </View>
  );
};

const TimelineRow: React.FC<{ label: string; date: string }> = ({
  label,
  date,
}) => (
  <View style={styles.timelineRow}>
    <View style={styles.timelineDot} />
    <View style={styles.grow}>
      <Text style={styles.timelineLabel}>{label}</Text>
      <Text style={styles.meta}>{new Date(date).toLocaleString()}</Text>
    </View>
  </View>
);

const TrackingLinks: React.FC<{
  rows: ReferralTrackingLink[];
  currency: string;
  label: string;
  slug: string;
  creating: boolean;
  onLabel: (value: string) => void;
  onSlug: (value: string) => void;
  onCreate: () => void;
  onCopy: (slug: string) => void;
  onArchive: (id: string) => void;
}> = ({
  rows,
  currency,
  label,
  slug,
  creating,
  onLabel,
  onSlug,
  onCreate,
  onCopy,
  onArchive,
}) => {
  const [qrSlug, setQrSlug] = React.useState<string | null>(null);
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Create a tracking-only link</Text>
        <Text style={styles.sub}>
          Measure a channel without assigning a person or paying a reward.
        </Text>
        <View style={styles.formRow}>
          <TextInput
            value={label}
            onChangeText={onLabel}
            style={styles.input}
            placeholder="Instagram bio"
            placeholderTextColor={textTokens.tertiary}
            maxLength={60}
          />
          <TextInput
            value={slug}
            onChangeText={onSlug}
            style={styles.input}
            placeholder="summer-launch"
            placeholderTextColor={textTokens.tertiary}
            autoCapitalize="none"
            maxLength={48}
          />
          <Button
            label={creating ? "Creating…" : "Create link"}
            disabled={
              creating ||
              !label.trim() ||
              !/^[a-z0-9][a-z0-9_-]{5,47}$/.test(slug)
            }
            onPress={onCreate}
          />
        </View>
      </View>
      {rows.length === 0 ? (
        <State
          title="No tracking links"
          text="Create one when you need channel attribution without a referral reward."
        />
      ) : (
        rows.map((row) => (
          <View key={row.id} style={styles.card}>
            <View style={styles.rowBetween}>
              <View style={styles.grow}>
                <Text style={styles.cardTitle}>{row.label}</Text>
                <Text style={styles.link}>usemingla.com/r/{row.slug}</Text>
                <View style={styles.metrics}>
                  <Metric label="Visits" value={String(row.touchCount)} />
                  <Metric label="Orders" value={String(row.orderCount)} />
                  <Metric
                    label="Revenue"
                    value={formatCurrency(row.revenueMinor, currency, true)}
                  />
                </View>
              </View>
              <View style={styles.actions}>
                <Button
                  size="sm"
                  variant="secondary"
                  label="Copy"
                  onPress={() => onCopy(row.slug)}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  label={qrSlug === row.slug ? "Hide QR" : "Show QR"}
                  onPress={() =>
                    setQrSlug((current) =>
                      current === row.slug ? null : row.slug,
                    )
                  }
                />
                {row.archivedAt === null ? (
                  <Button
                    size="sm"
                    variant="destructiveOutline"
                    label="Archive"
                    onPress={() => onArchive(row.id)}
                  />
                ) : (
                  <Status value="archived" />
                )}
              </View>
            </View>
            {qrSlug === row.slug ? (
              <View style={styles.qrPanel}>
                <React.Suspense
                  fallback={<ActivityIndicator color={accent.warm} />}
                >
                  <QRCode
                    value={`https://usemingla.com/r/${row.slug}`}
                    size={176}
                  />
                </React.Suspense>
                <Text style={styles.meta}>
                  Scan to open this tracking link.
                </Text>
              </View>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
};

const Results: React.FC<{
  value: Record<string, unknown> | undefined;
  currency: string;
}> = ({ value, currency }) => (
  <View style={styles.stack}>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Last 30 days</Text>
      <Text style={styles.sub}>
        Attributed orders and referral rewards. Tracking-only links never create
        a payee.
      </Text>
      <View style={styles.metrics}>
        <Metric label="Orders" value={String(Number(value?.orders ?? 0))} />
        <Metric
          label="Revenue"
          value={formatCurrency(
            Number(value?.revenueMinor ?? 0),
            currency,
            true,
          )}
        />
        <Metric
          label="Rewards"
          value={formatCurrency(Number(value?.shareMinor ?? 0), currency, true)}
        />
        <Metric
          label="Paid"
          value={formatCurrency(Number(value?.paidMinor ?? 0), currency, true)}
        />
        <Metric
          label="Reversed"
          value={formatCurrency(
            Number(value?.reversedMinor ?? 0),
            currency,
            true,
          )}
        />
      </View>
    </View>
    <View style={styles.notice}>
      <Text style={styles.noticeTitle}>How payout fees work</Text>
      <Text style={styles.sub}>
        The payee absorbs provider transfer fees. Buyers are never charged an
        extra referral fee, and the host’s configured reward budget remains the
        gross reward amount.
      </Text>
    </View>
  </View>
);

const Metric: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <View style={styles.metric}>
    <Text style={styles.metricValue}>{value}</Text>
    <Text style={styles.meta}>{label}</Text>
  </View>
);
const Status: React.FC<{ value: string }> = ({ value }) => (
  <View style={styles.status}>
    <Text style={styles.statusText}>{value.replaceAll("_", " ")}</Text>
  </View>
);
const State: React.FC<{ title?: string; text: string }> = ({ title, text }) => (
  <View style={styles.state}>
    {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
    <Text style={styles.sub}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: canvas.profile },
  hero: {
    padding: spacing.lg,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    alignItems: "center",
    borderBottomWidth: 1,
    borderColor: glass.border.control,
  },
  grow: { flex: 1 },
  eyebrow: {
    color: accent.warm,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  heroTitle: {
    color: textTokens.primary,
    fontSize: 26,
    fontWeight: "900",
    marginTop: spacing.xs,
  },
  sub: { color: textTokens.secondary, lineHeight: 20, marginTop: spacing.xs },
  tabs: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
    borderBottomWidth: 1,
    borderColor: glass.border.control,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
    borderColor: "transparent",
  },
  tabOn: { borderColor: accent.warm },
  tabText: { color: textTokens.secondary, fontWeight: "700" },
  tabTextOn: { color: accent.warm },
  content: { padding: spacing.lg, paddingBottom: 80 },
  stack: { gap: spacing.md },
  card: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.control,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardCompact: { padding: spacing.sm },
  detailPanel: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  detailTitle: { color: textTokens.primary, fontWeight: "800" },
  cardTitle: { color: textTokens.primary, fontSize: 17, fontWeight: "800" },
  meta: { color: textTokens.tertiary, fontSize: 12, marginTop: 2 },
  reward: { color: textTokens.secondary, fontSize: 15, fontWeight: "600" },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    alignItems: "center",
  },
  metrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  metric: {
    minWidth: 110,
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  metricValue: { color: textTokens.primary, fontSize: 18, fontWeight: "800" },
  status: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    backgroundColor: "rgba(249,115,22,0.14)",
  },
  statusText: {
    color: accent.warm,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  rank: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: "rgba(249,115,22,0.16)",
  },
  rankText: { color: accent.warm, fontSize: 15, fontWeight: "900" },
  timeline: { gap: spacing.sm, marginTop: spacing.xs },
  timelineRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  timelineDot: {
    width: 10,
    height: 10,
    marginTop: 5,
    borderRadius: 5,
    backgroundColor: accent.warm,
  },
  timelineLabel: {
    color: textTokens.primary,
    fontWeight: "700",
    lineHeight: 19,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginVertical: spacing.xs,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: glass.border.control,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  chipOn: {
    borderColor: accent.warm,
    backgroundColor: "rgba(249,115,22,0.10)",
  },
  chipText: { color: textTokens.secondary, fontWeight: "700" },
  input: {
    minHeight: 44,
    minWidth: 180,
    flex: 1,
    color: textTokens.primary,
    borderWidth: 1,
    borderColor: glass.border.control,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    backgroundColor: canvas.profile,
  },
  multiline: {
    minHeight: 88,
    paddingTop: spacing.sm,
    textAlignVertical: "top",
  },
  formRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignItems: "center",
  },
  state: {
    alignItems: "center",
    padding: spacing.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: glass.border.control,
    borderRadius: radius.lg,
  },
  warning: { color: semantic.warning, fontWeight: "700" },
  link: { color: accent.warm, marginTop: 3 },
  qrPanel: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#FFFFFF",
  },
  notice: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(249,115,22,0.45)",
    backgroundColor: "rgba(249,115,22,0.08)",
    padding: spacing.md,
  },
  noticeTitle: { color: textTokens.primary, fontWeight: "800" },
});
