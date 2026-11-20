import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { radius, space } from "../../../../constants/designSystem";
import { Banner, Chip, SectionHead, Skeleton, WButton, ui } from "../ui";
import { useWebsite } from "../WebsiteContext";
import { teamRequestStatusLine } from "../../../../sites/ariWorkspace";
import { formatWebsiteDateTime } from "../../../../sites/websiteCopy";
import type { TeamRequest } from "../../../../sites/teamRequestsPort";
import { parts } from "./parts";

/*
 * #4453 — "Requests to the team": what the owner asked the Mingla team to
 * build, and where each one stands. A finished request sends the owner to
 * the page to read what the team made; it still goes live only through
 * Publish.
 */
export function RequestsPane({ requests, loading, failed, onRetry, highlightId, pageTitleOf, onRead, onAsk }: {
  requests: TeamRequest[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  highlightId: string | null;
  pageTitleOf: (pagePath: string | null) => string | null;
  onRead: (request: TeamRequest) => void;
  onAsk: () => void;
}): React.ReactElement {
  const { phone, headingRef } = useWebsite();
  return (
    <View testID="requests-pane">
      <SectionHead ref={headingRef} phone={phone} title="Requests to the team" subtitle="Ask for anything Ari can’t build yet. The team makes it on your draft, usually within 24 hours, and you publish when you’re happy." right={<WButton label="Ask the Mingla team" icon="team" size="sm" onPress={onAsk} testID="requests-ask" />} />
      {loading ? <View role="status" accessibilityLabel="Loading your requests"><Skeleton height={72} style={styles.gap} /><Skeleton height={72} /></View> : null}
      {failed ? (
        <Banner tone="err" icon="alert" title="Your requests couldn’t be loaded" body="Check your connection and try again." testID="requests-error">
          <WButton label="Try again" size="sm" onPress={onRetry} />
        </Banner>
      ) : null}
      {!loading && !failed && requests.length === 0 ? (
        <View style={[parts.box, styles.empty]} testID="requests-empty">
          <Text style={parts.title}>None yet</Text>
          <Text style={parts.body}>Click any part of your page, then choose Ask the Mingla team. Or start one here.</Text>
          <WButton label="Ask the Mingla team" icon="team" size="sm" variant="primary" onPress={onAsk} style={styles.start} testID="requests-empty-ask" />
        </View>
      ) : null}
      {requests.map((request) => {
        const status = teamRequestStatusLine(request.status);
        const where = [pageTitleOf(request.pagePath), request.sectionLabel].filter(Boolean).join(" › ");
        return (
          <View key={request.ticketId} style={[parts.box, styles.row, request.ticketId === highlightId ? styles.rowOn : null]} testID={`request-${request.ticketId}`}>
            <View style={parts.row}>
              <Text style={[parts.title, parts.grow]} numberOfLines={3}>{request.what}</Text>
              <Chip label={status.text} tone={status.tone} testID={`request-status-${request.ticketId}`} />
            </View>
            <Text style={parts.small}>
              {[request.ticketNumber, where, request.createdAt ? `asked ${formatWebsiteDateTime(request.createdAt)}` : null].filter(Boolean).join(" · ")}
            </Text>
            {request.status === "ready" ? (
              <WButton label="Read it on the page" size="sm" variant="primary" onPress={() => onRead(request)} style={styles.start} testID={`request-read-${request.ticketId}`} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { marginBottom: space[2] },
  empty: { gap: space[2] },
  start: { alignSelf: "flex-start" },
  row: { marginBottom: space[2], gap: 6, borderRadius: radius.sm },
  rowOn: { borderColor: ui.t2 },
});
