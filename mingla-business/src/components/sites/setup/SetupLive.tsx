import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { openWebsiteUrl } from "../../../sites/websiteExternalOpen";
import { copyAddressText } from "../../../utils/copyAddressText";
import { Chip, WButton, ui } from "../website/ui";

/** Design state 14. The address is the headline. */
export function SetupLive({ hostname, onEdit, toast }: {
  hostname: string | null;
  onEdit: () => void;
  toast: (message: string, kind?: "success" | "info" | "warn" | "error") => void;
}): React.ReactElement {
  return (
    <View style={styles.host} testID="setup-live">
      <View style={styles.chip}><Chip label="Live" tone="ok" /></View>
      <Text style={styles.title} role="heading" aria-level={2}>Your website is live.</Text>
      {hostname ? <Text style={styles.address} selectable testID="setup-live-address">{hostname}</Text> : null}
      <View style={styles.row}>
        {hostname ? (
          <>
            <WButton label="Open my website" variant="primary" onPress={() => { void openWebsiteUrl(`https://${hostname}`); }} testID="setup-live-open" />
            <WButton
              label="Copy link"
              onPress={() => {
                copyAddressText(`https://${hostname}`)
                  .then(() => toast("Link copied", "success"))
                  .catch(() => toast("Couldn’t copy. Select the address and copy it instead.", "error"));
              }}
              testID="setup-live-copy"
            />
          </>
        ) : null}
        <WButton label="Edit website" variant="ghost" onPress={onEdit} testID="setup-live-edit" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: 12 },
  chip: { alignSelf: "flex-start" },
  title: { fontSize: 26, lineHeight: 32, fontWeight: "700", color: ui.t1 },
  address: { fontSize: 15, color: ui.t1 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
});
