/**
 * #3872 — My creators (approved P-roster / M-roster): the list first, with
 * status (On Mingla / Invited / Link only); Add sits behind the + button and
 * each creator opens a sheet to invite, share their link or read notes.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Button } from "../../../../src/components/ui/Button";
import { Icon } from "../../../../src/components/ui/Icon";
import { Input } from "../../../../src/components/ui/Input";
import { Sheet } from "../../../../src/components/ui/Sheet";
import {
  Card,
  Chip,
  FieldError,
  Initials,
  ListGroup,
  ListRow,
  Muted,
  ProgramLoading,
  ProgramScreen,
  SheetBody,
  StatusTag,
  programStyles,
} from "../../../../src/components/programs/ProgramKit";
import { useProgramParams } from "../../../../src/components/programs/useProgramParams";
import {
  creatorRosterService,
  type CreatorRosterRow,
} from "../../../../src/services/creatorRosterService";
import { postHogService } from "../../../../src/services/postHogService";
import { shareBusinessCanonicalFallback } from "../../../../src/services/canonicalShareTransport";
import {
  fetchReferralOffers,
  inviteReferralMembers,
  type ReferralOffer,
} from "../../../../src/services/referralService";
import {
  platformLabel,
  programErrorMessage,
  programMoney,
  shortDate,
} from "../../../../src/utils/creatorProgramFormat";
import {
  rosterStatus,
  type RosterFilter,
} from "../../../../src/components/programs/rosterStatus";
import {
  spacing,
  text as textTokens,
} from "../../../../src/constants/designSystem";

const PLATFORMS = ["instagram", "tiktok", "youtube", "x", "snapchat"] as const;

export default function CreatorRoster(): React.ReactElement {
  const { brandId } = useProgramParams();
  const [rows, setRows] = useState<CreatorRosterRow[] | null>(null);
  const [offers, setOffers] = useState<ReferralOffer[]>([]);
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<CreatorRosterRow | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [platform, setPlatform] =
    useState<(typeof PLATFORMS)[number]>("instagram");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoadError(null);
    try {
      const [nextRows, nextOffers] = await Promise.all([
        creatorRosterService.list(brandId),
        fetchReferralOffers(brandId).catch(() => [] as ReferralOffer[]),
      ]);
      const invitable = nextOffers.filter(
        (offer) =>
          offer.status === "active" &&
          (offer.audience === "invited" || offer.audience === "both"),
      );
      setRows(nextRows);
      setOffers(invitable);
      setOfferId((current) =>
        current && invitable.some((offer) => offer.id === current)
          ? current
          : (invitable[0]?.id ?? null),
      );
    } catch (rosterError) {
      setRows((current) => current ?? []);
      setLoadError(
        programErrorMessage(
          rosterError,
          "We couldn't load your creators. Pull to try again.",
        ),
      );
    }
  }, [brandId]);
  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const all = rows ?? [];
    return {
      all: all.length,
      on_mingla: all.filter((row) => rosterStatus(row).key === "on_mingla")
        .length,
      invited: all.filter((row) => rosterStatus(row).key === "invited").length,
    };
  }, [rows]);
  const visible = (rows ?? []).filter(
    (row) => filter === "all" || rosterStatus(row).key === filter,
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await creatorRosterService.save(brandId, {
        name: name.trim(),
        platform,
        handle: handle.trim().replace(/^@/, "").toLowerCase() || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
        status: "active",
      });
      postHogService.capture("roster_creator_added");
      setAdding(false);
      setName("");
      setHandle("");
      setEmail("");
      setNotes("");
      setNotice(`${name.trim()} is in your creators.`);
      await load();
    } catch (saveError) {
      setError(
        programErrorMessage(
          saveError,
          "We couldn't save this creator. Check the details and try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const invite = async (row: CreatorRosterRow) => {
    const offer = offers.find((item) => item.id === offerId);
    if (!row.email || !offer) return;
    setBusy(true);
    setError(null);
    try {
      const result = await inviteReferralMembers(offer.id, [
        { email: row.email, displayName: row.name },
      ]);
      const member = (result.members[0] ?? null) as { id?: unknown } | null;
      if (!member || typeof member.id !== "string")
        throw new Error("invite_not_recorded");
      await creatorRosterService.linkInvite(row.id, member.id);
      postHogService.capture("roster_invite_sent");
      setSelected(null);
      setNotice(
        result.delivery[0]?.sent === true
          ? `Invite sent to ${row.name}.`
          : `Invite created for ${row.name}. Share their link if the email doesn't arrive.`,
      );
      await load();
    } catch (inviteError) {
      setError(
        programErrorMessage(
          inviteError,
          `We couldn't invite ${row.name}. Try again.`,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const shareLink = async (row: CreatorRosterRow) => {
    if (!row.link_slug) return;
    const url = `https://usemingla.com/r/${row.link_slug}`;
    await shareBusinessCanonicalFallback({
      title: `${row.name}'s Mingla link`,
      message: `${row.name}'s Mingla link: ${url}`,
      url,
    });
  };

  return (
    <ProgramScreen
      title="My creators"
      fallback={`/brand/${brandId}/creators`}
      right={
        <Pressable
          onPress={() => {
            setError(null);
            setAdding(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Add a creator"
          hitSlop={8}
          style={styles.plus}
        >
          <Icon name="plus" size={22} color={textTokens.primary} />
        </Pressable>
      }
      refreshing={false}
      onRefresh={() => void load()}
      overlay={
        <>
          <Sheet
            visible={adding}
            onClose={() => setAdding(false)}
            snapPoint="full"
          >
            <SheetBody title="Add a creator">
              <Muted>
                Someone you already work with. This list is private to your
                team.
              </Muted>
              <Input
                value={name}
                onChangeText={setName}
                placeholder="Name"
                accessibilityLabel="Creator name"
              />
              <View style={styles.chips}>
                {PLATFORMS.map((item) => (
                  <Chip
                    key={item}
                    label={platformLabel(item)}
                    selected={platform === item}
                    onPress={() => setPlatform(item)}
                  />
                ))}
              </View>
              <Input
                value={handle}
                onChangeText={setHandle}
                placeholder={`${platformLabel(platform)} handle`}
                accessibilityLabel={`${platformLabel(platform)} handle`}
              />
              <Input
                value={email}
                onChangeText={setEmail}
                variant="email"
                placeholder="Email (needed to invite)"
                accessibilityLabel="Email"
              />
              <Input
                value={notes}
                onChangeText={setNotes}
                multiline
                placeholder="Private notes"
                accessibilityLabel="Private notes"
              />
              <FieldError message={error} />
              <Button
                fullWidth
                label="Save"
                loading={busy}
                disabled={busy || name.trim().length < 2}
                onPress={() => void save()}
              />
            </SheetBody>
          </Sheet>
          <Sheet
            visible={selected !== null}
            onClose={() => setSelected(null)}
            snapPoint="full"
          >
            {selected ? (
              <SheetBody title={selected.name}>
                <Muted>
                  {[
                    selected.handle
                      ? `${platformLabel(selected.platform)} @${selected.handle}`
                      : null,
                    selected.email,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No contact details yet"}
                </Muted>
                {selected.notes ? (
                  <Text style={styles.notes}>{selected.notes}</Text>
                ) : null}
                {selected.referral_member_id ? (
                  <ListGroup>
                    <ListRow
                      title="Tracked sales"
                      right={String(selected.sales_count)}
                      chevron={false}
                    />
                    <ListRow
                      title="Sold through their link"
                      right={programMoney(
                        selected.revenue_minor,
                        selected.currency,
                      )}
                      chevron={false}
                    />
                    {selected.offer_name ? (
                      <ListRow
                        title="Offer"
                        right={selected.offer_name}
                        chevron={false}
                      />
                    ) : null}
                  </ListGroup>
                ) : null}
                {!selected.referral_member_id ? (
                  offers.length === 0 ? (
                    <Muted>
                      To invite creators, start a referral offer for invited
                      promoters in Referrals.
                    </Muted>
                  ) : (
                    <>
                      <Text style={styles.label}>Invite with offer</Text>
                      <View style={styles.chips}>
                        {offers.map((offer) => (
                          <Chip
                            key={offer.id}
                            label={offer.name}
                            selected={offer.id === offerId}
                            onPress={() => setOfferId(offer.id)}
                          />
                        ))}
                      </View>
                      {!selected.email ? (
                        <FieldError message="Add an email address to send an invitation." />
                      ) : null}
                      <Button
                        fullWidth
                        label="Invite to Mingla"
                        loading={busy}
                        disabled={busy || !selected.email || !offerId}
                        onPress={() => void invite(selected)}
                      />
                    </>
                  )
                ) : null}
                {selected.link_slug ? (
                  <Button
                    fullWidth
                    variant="secondary"
                    label="Share their link"
                    onPress={() => void shareLink(selected)}
                  />
                ) : null}
                <FieldError message={error} />
              </SheetBody>
            ) : null}
          </Sheet>
        </>
      }
    >
      {rows === null ? <ProgramLoading /> : null}
      {loadError ? <FieldError message={loadError} /> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {rows !== null ? (
        <>
          <View style={styles.chips}>
            <Chip
              label={`All ${counts.all}`}
              selected={filter === "all"}
              onPress={() => setFilter("all")}
            />
            <Chip
              label="On Mingla"
              selected={filter === "on_mingla"}
              onPress={() => setFilter("on_mingla")}
            />
            <Chip
              label="Invited"
              selected={filter === "invited"}
              onPress={() => setFilter("invited")}
            />
          </View>
          {visible.length === 0 ? (
            <Card>
              <Text style={programStyles.title}>
                {rows.length === 0 ? "No creators yet" : "No one here yet"}
              </Text>
              <Muted>
                Add someone you already work with. Invite them so their sales
                and payouts run through Mingla.
              </Muted>
              {rows.length === 0 ? (
                <Button
                  label="Add a creator"
                  leadingIcon="plus"
                  onPress={() => setAdding(true)}
                />
              ) : null}
            </Card>
          ) : (
            <ListGroup>
              {visible.map((row) => {
                const status = rosterStatus(row);
                return (
                  <ListRow
                    key={row.id}
                    leading={<Initials name={row.name} />}
                    title={row.name}
                    subtitle={
                      status.key === "on_mingla" || row.sales_count > 0
                        ? `${row.sales_count} sale${row.sales_count === 1 ? "" : "s"} · ${programMoney(row.revenue_minor, row.currency)} in sales`
                        : status.key === "invited"
                          ? `Invite sent ${shortDate(row.updated_at)}`
                          : "Track sales with a link"
                    }
                    right={
                      <StatusTag label={status.label} tone={status.tone} />
                    }
                    onPress={() => {
                      setError(null);
                      setSelected(row);
                    }}
                  />
                );
              })}
            </ListGroup>
          )}
          <Muted>
            Paid gig work starts only after a creator joins Mingla and accepts
            your offer.
          </Muted>
        </>
      ) : null}
    </ProgramScreen>
  );
}

const styles = StyleSheet.create({
  plus: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  label: { color: textTokens.secondary, fontSize: 13, fontWeight: "600" },
  notes: {
    color: textTokens.secondary,
    fontStyle: "italic",
    fontSize: 14,
    lineHeight: 20,
  },
  notice: { color: textTokens.primary, fontWeight: "600" },
});
