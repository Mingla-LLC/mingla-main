import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useWebsite } from "../WebsiteContext";
import { OfflineBanner } from "./OverviewSection";
import { Card, CardTitle, Hint, SectionHead, Spinner, Toggle, WButton, ui } from "../ui";
import { WebsiteIcon } from "../WebsiteIcon";
import { ConfirmDialog } from "../../../ui/ConfirmDialog";
import { EXPORT_MEDIA_LINKS_NOTE } from "../../../../sites/exportCopy";
import { SharePreviewCard } from "./SharePreviewCard";

/**
 * #2829 W9r (DESIGN_SPEC §1.6 Settings) — the destructive and rare things,
 * out of the main flow: online/offline (confirm to go offline), download
 * everything, sharing a private preview (#2829 W10; no designed slot, so it
 * lives here), who can do what (Core's answer for this member), and the
 * advanced page editor.
 */
export function SettingsSection(): React.ReactElement {
  const ctx = useWebsite();
  const { controller, phone, headingRef } = ctx;
  const router = useRouter();
  const site = controller.site.data!;
  const offline = Boolean(site.owner_offline_at);
  const canManage = controller.capabilities.canPublish;
  const [confirmOffline, setConfirmOffline] = useState(false);
  const exported = controller.exportResult;
  const preparing = controller.isExporting || (exported !== null && exported.status !== "succeeded" && exported.status !== "failed");
  const ready = exported?.status === "succeeded" && exported.download_url;

  return (
    <View testID="website-settings">
      <SectionHead ref={headingRef} phone={phone} title="Settings" />
      <OfflineBanner />
      <Card testID="settings-online">
        <View style={styles.row}>
          <View style={styles.grow}>
            <CardTitle>Website online</CardTitle>
            <Hint>{`${offline ? "Offline: visitors see a short “temporarily unavailable” page." : "Visitors can see your website."} Taking it offline keeps every draft, version and address.`}</Hint>
          </View>
          {canManage ? (
            <Toggle
              value={!offline}
              onChange={(online) => {
                if (online) controller.actions.setOffline(false);
                else setConfirmOffline(true);
              }}
              label="Website online"
              disabled={controller.isTogglingOffline}
              testID="settings-online-toggle"
            />
          ) : <WebsiteIcon name="lock" color={ui.t3} />}
        </View>
        {!canManage ? <View style={styles.ask}><WButton label="Ask an admin" icon="msg" size="sm" onPress={() => ctx.askAdmin("offline")} loading={ctx.asking} testID="settings-ask-offline" /></View> : null}
      </Card>
      <Card testID="settings-download">
        <View style={styles.row}>
          <View style={styles.grow}>
            <CardTitle>Download everything</CardTitle>
            <Hint>Every page, collection entry, photo and video, plus your design settings, in one file. Yours to keep.</Hint>
          </View>
          {!canManage ? <WebsiteIcon name="lock" color={ui.t3} /> : preparing ? (
            <View style={styles.row}><Spinner label="Preparing your download" /><Hint>Preparing… about a minute</Hint></View>
          ) : ready ? (
            <WButton label="Get your file" icon="download" variant="primary" onPress={() => controller.actions.openUrl(exported!.download_url!)} testID="settings-get-file" />
          ) : (
            <WButton label="Download" icon="download" onPress={controller.actions.requestExport} testID="settings-download-button" />
          )}
        </View>
        {ready ? (
          <View style={styles.readyRow}>
            <Text style={styles.help}>Ready · the link works for 24 hours.</Text>
            <WButton label="Make a new one" variant="ghost" size="sm" onPress={controller.actions.requestExport} testID="settings-download-again" />
          </View>
        ) : null}
        {exported?.status === "failed" ? <Text style={styles.error} role="alert">Mingla couldn&apos;t prepare your download. Try again.</Text> : null}
        {canManage ? <Text style={styles.help}>{EXPORT_MEDIA_LINKS_NOTE}</Text> : null}
        {!canManage ? <View style={styles.ask}><WButton label="Ask an admin" icon="msg" size="sm" onPress={() => ctx.askAdmin("download")} loading={ctx.asking} testID="settings-ask-download" /></View> : null}
      </Card>
      <SharePreviewCard />
      <Card testID="settings-roles">
        <CardTitle>Who can do what</CardTitle>
        <Hint>What your role can do with this website, from Mingla.</Hint>
        {[
          ["Edit pages, design and content", controller.capabilities.canEdit],
          ["Confirm reviews are real", canManage],
          ["Publish and restore versions", canManage],
          ["Addresses, offline, download", canManage],
          ["Share a private preview", canManage],
        ].map(([label, allowed]) => (
          <View key={String(label)} style={styles.roleRow}>
            <Text style={styles.roleLabel}>{String(label)}</Text>
            {allowed ? (
              <View style={styles.roleYes}><WebsiteIcon name="check" size={16} color={ui.ok} /><Text style={styles.roleText}>You can</Text></View>
            ) : <Text style={styles.roleText}>Ask an admin</Text>}
          </View>
        ))}
        <Text style={styles.help}>Change roles in Brand profile › Team.</Text>
        <WButton label="Open Team" variant="ghost" size="sm" onPress={() => router.push(`/brand/${ctx.brandId}/team` as never)} style={styles.teamLink} />
      </Card>
      <Card testID="settings-advanced">
        <View style={styles.row}>
          <View style={styles.grow}>
            <CardTitle>Advanced page editor</CardTitle>
            <Hint>Block-by-block layout control for every page. Most changes are easier here or with Ari.</Hint>
          </View>
          <WButton label="Open" icon="ext" size="sm" onPress={() => controller.actions.openStudio()} loading={controller.isOpeningStudio} testID="settings-open-editor" />
        </View>
      </Card>
      <ConfirmDialog
        visible={confirmOffline}
        onClose={() => setConfirmOffline(false)}
        onConfirm={() => {
          setConfirmOffline(false);
          controller.actions.setOffline(true);
        }}
        title="Take your website offline?"
        description={"Visitors will see a short “temporarily unavailable” page until you bring it back. Drafts, versions and your address are all kept."}
        confirmLabel="Take it offline"
        cancelLabel="Keep it online"
        destructive
        testID="settings-offline-confirm"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  ask: { marginTop: 10, flexDirection: "row" },
  readyRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  help: { fontSize: 12, lineHeight: 16, color: ui.t3, marginTop: 8 },
  error: { fontSize: 12, color: ui.err, marginTop: 8 },
  roleRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 40, borderTopWidth: 1, borderTopColor: ui.cardBorder, marginTop: 8 },
  roleLabel: { flex: 1, fontSize: 13, color: ui.t1 },
  roleYes: { flexDirection: "row", alignItems: "center", gap: 6 },
  roleText: { fontSize: 13, color: ui.t2 },
  teamLink: { alignSelf: "flex-start", marginTop: 4 },
});
