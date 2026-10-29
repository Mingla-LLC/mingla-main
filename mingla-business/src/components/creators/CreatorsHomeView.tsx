/**
 * #3872 round 2 — Creators home (approved M-creators / M-blastcreators),
 * shown in Blast › Creators for the current brand. What needs the host
 * first, then gigs and hired creators, My creators and Results as chips, and
 * Hire a creator. Gig, contract and profile pages open from here as before.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Button } from "../ui/Button";
import { Icon, type IconName } from "../ui/Icon";
import { ProgramSheet } from "../programs/ProgramSheet";
import { useRefreshOnFocus } from "../programs/useScreenLifecycle";
import {
  Card,
  Initials,
  ListGroup,
  ListRow,
  Muted,
  ProgramEmpty,
  ProgramColumns,
  ProgramLoading,
  ProgramScreen,
  SectionLabel,
  SheetBody,
  StatusTag,
  programStyles,
} from "../programs/ProgramKit";
import { useMarketingActionRegistration } from "../people/MarketingBrandSwitcherContext";
import {
  creatorGigsService,
  type HostHome,
} from "../../services/creatorGigsService";
import {
  fetchReferralListingOptions,
  type ReferralListingOption,
} from "../../services/referralService";
import {
  contractNeedsHost,
  gigStatusLabel,
  hostContractPill,
  needsYouCopy,
  programErrorMessage,
  shortDate,
} from "../../utils/creatorProgramFormat";
import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

export interface CreatorsHomeViewProps {
  brandId: string;
}

export const CreatorsHomeView: React.FC<CreatorsHomeViewProps> = ({
  brandId,
}) => {
  const router = useRouter();
  const [home, setHome] = useState<HostHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [listings, setListings] = useState<ReferralListingOption[] | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError(null);
    try {
      setHome(await creatorGigsService.hostHome(brandId));
    } catch (loadError) {
      setError(
        programErrorMessage(
          loadError,
          "We couldn't load your creators. Pull to try again.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [brandId]);
  useEffect(() => {
    setHome(null);
    setListings(null);
    void load();
  }, [load]);
  useRefreshOnFocus(load);

  useEffect(() => {
    if (!picking || listings !== null) return;
    void fetchReferralListingOptions(brandId)
      .then(setListings)
      .catch(() => setListings([]));
  }, [picking, listings, brandId]);

  const contracts = home?.contracts ?? [];
  const needs = contracts.filter(contractNeedsHost);
  const hired = contracts.filter((contract) => !contractNeedsHost(contract));
  const gigs = home?.gigs ?? [];
  const openContract = (id: string) =>
    router.push(`/brand/${brandId}/creators/contract/${id}` as never);
  const hireAction = React.useMemo(
    () => ({
      id: "creators-hire",
      label: "Hire a creator",
      compactLabel: "Hire",
      icon: "video" as const,
      onPress: () => setPicking(true),
    }),
    [],
  );
  useMarketingActionRegistration(hireAction);

  return (
    <ProgramScreen
      embedded
      title="Creators"
      fallback="/(tabs)/marketing"
      refreshing={loading && home !== null}
      onRefresh={() => void load()}
      overlay={
        <ProgramSheet
          visible={picking}
          onClose={() => setPicking(false)}
          snapPoint="half"
        >
          <SheetBody title="What should creators promote?">
            {listings === null ? (
              <ProgramLoading />
            ) : listings.length === 0 ? (
              <Muted>
                Publish an event or venue first. Creators promote a specific
                listing.
              </Muted>
            ) : (
              <ListGroup>
                {listings.map((item) => (
                  <ListRow
                    key={`${item.listingKind}:${item.listingId}`}
                    title={item.label}
                    subtitle={item.listingKind === "venue" ? "Venue" : "Event"}
                    onPress={() => {
                      setPicking(false);
                      router.push(
                        `/brand/${brandId}/creators/brief?listingKind=${item.listingKind}&listingId=${item.listingId}` as never,
                      );
                    }}
                  />
                ))}
              </ListGroup>
            )}
          </SheetBody>
        </ProgramSheet>
      }
    >
      {loading && !home ? <ProgramLoading /> : null}
      {error ? (
        <Card>
          <Text style={programStyles.body}>{error}</Text>
          <Button
            variant="secondary"
            label="Try again"
            onPress={() => void load()}
          />
        </Card>
      ) : null}

      {home ? (
        <ProgramColumns
          primary={
            <>
              {needs.length > 0 ? <SectionLabel>Needs you</SectionLabel> : null}
              {needs.map((contract) => {
                const copy = needsYouCopy(
                  contract.state,
                  contract.creator,
                  contract.due_at,
                );
                return (
                  <Card key={contract.id}>
                    <Text style={programStyles.title}>{copy.title}</Text>
                    <Muted>
                      {[contract.title, copy.body].filter(Boolean).join(" · ")}
                    </Muted>
                    <Button label={copy.cta} size="sm" onPress={() => openContract(contract.id)} />
                  </Card>
                );
              })}
              <SectionLabel>Gigs</SectionLabel>
              {gigs.length === 0 ? (
                <ProgramEmpty
                  icon="video"
                  title="No gigs yet"
                  body="Post a brief for an event or venue. Creators in your city tell you they're interested."
                />
              ) : (
                <ListGroup>
                  {gigs.map((gig) => (
                    <ListRow
                      key={gig.id}
                      title={gig.title_public}
                      subtitle={[
                        gig.post_by ? `Video by ${shortDate(gig.post_by)}` : null,
                        gig.interest_count > 0 ? `${gig.interest_count} interested` : null,
                        `${gig.hired_count} of ${gig.slots} hired`,
                      ].filter(Boolean).join(" · ")}
                      right={<StatusTag label={gigStatusLabel(gig.status)} tone={gig.status === "open" ? "live" : "ended"} />}
                      onPress={() => router.push(`/brand/${brandId}/creators/${gig.id}/interest` as never)}
                    />
                  ))}
                </ListGroup>
              )}
            </>
          }
          support={
            <>
              {hired.length > 0 ? <SectionLabel>Hired</SectionLabel> : null}
              {hired.length > 0 ? (
                <ListGroup>
                  {hired.map((contract) => {
                    const pill = hostContractPill(contract);
                    return (
                      <ListRow
                        key={contract.id}
                        leading={<Initials name={contract.creator} size={32} />}
                        title={contract.creator}
                        subtitle={contract.payment_pending ? `${contract.title} · Retry payment` : contract.title}
                        right={<StatusTag label={pill.label} tone={pill.tone} />}
                        onPress={() => contract.payment_pending
                          ? router.push(`/brand/${brandId}/creators/${contract.gig_id}/interest` as never)
                          : openContract(contract.id)}
                      />
                    );
                  })}
                </ListGroup>
              ) : null}
              <View style={styles.chips}>
                <LinkChip icon="star" label="My creators" onPress={() => router.replace(`/(tabs)/marketing/creators?view=roster` as never)} />
                <LinkChip icon="chart" label="Results" onPress={() => router.replace(`/(tabs)/marketing/creators?view=results` as never)} />
              </View>
            </>
          }
        />
      ) : null}
    </ProgramScreen>
  );
};

/** Small icon chip that opens another page (My creators, Results). */
export function LinkChip({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
    >
      <Icon name={icon} size={14} color={accent.warm} />
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileBase,
  },
  chipPressed: { opacity: 0.85 },
  chipText: { color: textTokens.primary, fontSize: 14, fontWeight: "600" },
});
