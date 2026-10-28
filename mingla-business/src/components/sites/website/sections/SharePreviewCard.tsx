import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useWebsite } from "../WebsiteContext";
import { Card, CardTitle, Hint, MiniButton, Segmented, Spinner, WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import { ConfirmDialog } from "../../../ui/ConfirmDialog";
import {
  useBrandSiteShareLinks,
  useCreateBrandSiteShareLink,
  useRevokeBrandSiteShareLink,
} from "../../../../hooks/useBrandSite";
import { BrandSitesError, type BrandSiteShareLink, type BrandSiteShareLinkCreated } from "../../../../services/brandSitesService";
import { copyAddressText } from "../../../../utils/copyAddressText";
import { formatWebsiteDateTime } from "../../../../sites/websiteCopy";

type Ttl = "1" | "7" | "14";
const TTL_OPTIONS: Array<{ value: Ttl; label: string }> = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
];

/** One plain line about a link: who made it, until when, and whether anyone opened it. */
export function shareLinkLine(link: BrandSiteShareLink, format: (iso: string) => string = formatWebsiteDateTime): string {
  const who = link.created_by_name ? `Made by ${link.created_by_name}` : "Made by a teammate";
  const state = link.state === "revoked"
    ? "turned off"
    : link.state === "expired"
      ? `ended ${format(link.expires_at)}`
      : `works until ${format(link.expires_at)}`;
  const views = link.view_count > 0
    ? ` · opened ${link.view_count === 1 ? "once" : `${link.view_count} times`}${link.last_viewed_at ? `, last ${format(link.last_viewed_at)}` : ""}`
    : " · not opened yet";
  return `${who} · ${state}${views}`;
}

/**
 * #2829 W10 (S2, "build for a client") — share the draft with someone outside
 * the team, like a client, without them signing in. The link shows the
 * site's latest draft preview, stays out of search engines, and stops working
 * when it ends or is turned off. Its address is shown ONCE (Mingla keeps only
 * a digest). Brand admins and owners only (Core decides; this follows Core's
 * publish capability, the same rank).
 *
 * Placement: the approved Website design has no slot for this; it sits in
 * Settings (Manage) in the same card language (W10 deviation, reported).
 */
export function SharePreviewCard(): React.ReactElement {
  const ctx = useWebsite();
  const { controller, toast, brandId } = ctx;
  const siteId = controller.siteId;
  const canManage = controller.capabilities.canPublish;
  const links = useBrandSiteShareLinks(siteId, canManage);
  const create = useCreateBrandSiteShareLink(brandId, siteId);
  const revoke = useRevokeBrandSiteShareLink(siteId);
  const [ttl, setTtl] = useState<Ttl>("7");
  const [made, setMade] = useState<BrandSiteShareLinkCreated | null>(null);
  const [turningOff, setTurningOff] = useState<BrandSiteShareLink | null>(null);

  const failed = (error: unknown, fallback: string) => toast(error instanceof BrandSitesError ? error.message : fallback, "error");
  const makeLink = () => {
    setMade(null);
    create.mutate(Number(ttl) as 1 | 7 | 14, {
      onSuccess: (result) => setMade(result),
      onError: (error) => failed(error, "Mingla couldn’t make a preview link. Try again."),
    });
  };
  const copy = (value: string) => {
    copyAddressText(value)
      .then(() => toast("Link copied", "success"))
      .catch(() => toast("Couldn’t copy. Select the link and copy it instead.", "error"));
  };
  const active = (links.data ?? []).filter((link) => link.state === "active");
  const ended = (links.data ?? []).filter((link) => link.state !== "active");

  return (
    <Card testID="settings-share">
      <View style={styles.row}>
        <View style={styles.grow}>
          <CardTitle>Share a private preview</CardTitle>
          <Hint>Send your draft to someone outside your team, like a client. They don&apos;t need to sign in. The link shows your latest draft, stays out of search engines and stops working when it ends or you turn it off.</Hint>
        </View>
        {!canManage ? <WebsiteIcon name="lock" color={ui.t3} /> : null}
      </View>
      {!canManage ? (
        <Text style={styles.help}>Only brand admins and owners can share a private preview.</Text>
      ) : (
        <>
          <Text style={styles.label}>Link works for</Text>
          <View style={styles.controls}>
            <Segmented<Ttl> label="Link works for" options={TTL_OPTIONS} value={ttl} onChange={setTtl} disabled={create.isPending} compact testIDPrefix="share-ttl" />
            <WButton label={create.isPending ? "Making your link…" : "Make a link"} icon="ext" variant="primary" size="sm" onPress={makeLink} loading={create.isPending} testID="share-create" />
          </View>
          {made ? (
            <View style={styles.made} testID="share-made" accessibilityLiveRegion="polite">
              <Text style={styles.url} selectable testID="share-url">{made.url}</Text>
              <View style={styles.madeActions}>
                <MiniButton icon="copy" label="Copy link" onPress={() => copy(made.url)} testID="share-copy" />
              </View>
              <Text style={styles.help}>{`Copy it now: Mingla shows this link only once. It works until ${formatWebsiteDateTime(made.expires_at)}.`}</Text>
              {!made.preview_ready ? (
                <Text style={styles.warn} role="alert">Your draft preview isn&apos;t ready yet. The link will show it as soon as it is; try opening it in a minute.</Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.list} testID="share-links">
            {links.isLoading ? <Spinner label="Loading your preview links" /> : null}
            {links.isError ? <Text style={styles.error} role="alert">Your preview links couldn&apos;t be loaded. Try again in a moment.</Text> : null}
            {active.map((link) => (
              <View key={link.id} style={styles.linkRow} testID={`share-link-${link.id}`}>
                <Text style={styles.linkText}>{shareLinkLine(link)}</Text>
                <WButton label="Turn off" variant="ghost" size="sm" onPress={() => setTurningOff(link)} loading={revoke.isPending && revoke.variables === link.id} testID={`share-revoke-${link.id}`} />
              </View>
            ))}
            {ended.length ? (
              <Text style={styles.help}>{`${ended.length} earlier ${ended.length === 1 ? "link no longer works" : "links no longer work"}.`}</Text>
            ) : null}
          </View>
        </>
      )}
      <ConfirmDialog
        visible={turningOff !== null}
        onClose={() => setTurningOff(null)}
        onConfirm={() => {
          const link = turningOff;
          setTurningOff(null);
          if (!link) return;
          revoke.mutate(link.id, {
            onSuccess: () => toast("Link turned off", "success"),
            onError: (error) => failed(error, "Mingla couldn’t turn that link off. Try again."),
          });
        }}
        title="Turn off this link?"
        description="Anyone who opens it will see a “not found” page. You can make a new link any time."
        confirmLabel="Turn off"
        cancelLabel="Keep it"
        destructive
        testID="share-revoke-confirm"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "600", color: ui.t2, marginTop: 12 },
  controls: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 6 },
  made: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: ui.cardBorder, gap: 6 },
  madeActions: { flexDirection: "row" },
  url: { fontFamily: "monospace", fontSize: 13, color: ui.t1 },
  list: { marginTop: 12, gap: 4 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, borderTopWidth: 1, borderTopColor: ui.cardBorder },
  linkText: { flex: 1, minWidth: 0, fontSize: 13, color: ui.t2 },
  help: { fontSize: 12, lineHeight: 16, color: ui.t3, marginTop: 8 },
  warn: { fontSize: 12, lineHeight: 16, color: ui.warn, marginTop: 4 },
  error: { fontSize: 12, color: ui.err, marginTop: 8 },
});
