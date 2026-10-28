import React, { useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { useWebsite } from "../WebsiteContext";
import { Banner, Card, CardTitle, CheckCircle, Chip, Hint, ListBox, MiniButton, Row, SectionHead, Segmented, Skeleton, Spinner, WButton, ui } from "../ui";
import { ConfirmDialog } from "../../../ui/ConfirmDialog";
import {
  useAttachBrandSiteDomain,
  useBrandSiteDomains,
  useCheckBrandSiteDomain,
  useDetachBrandSiteDomain,
  useSetPrimaryBrandSiteDomain,
} from "../../../../hooks/useBrandSite";
import { BrandSitesError } from "../../../../services/brandSitesService";
import { copyAddressText } from "../../../../utils/copyAddressText";
import type { BrandSiteDomainHost } from "../../../../sites/contracts";
import { canMakeMain, disconnectExplanation, domainChip, MX_WARNING, needsSetup, orderedHosts, recordNameFor, wwwOffer } from "../../../../sites/siteDomains";
import { dnsGuide, isDnsRegistrar, type DnsRegistrar } from "../../../../../../packages/site-contracts/src/dnsGuides.ts";
import { formatWebsiteDateTime } from "../../../../sites/websiteCopy";

const REGISTRARS: readonly { value: DnsRegistrar; label: string }[] = [
  { value: "namecheap", label: "Namecheap" },
  { value: "godaddy", label: "GoDaddy" },
  { value: "cloudflare", label: "Cloudflare" },
  { value: "squarespace", label: "Squarespace" },
  { value: "unknown", label: "Other" },
];

const CHIP_TONE = { neutral: "neutral", progress: "info", success: "ok", warning: "warn", muted: "neutral" } as const;
const mono = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" });

/**
 * #2829 W9r (DESIGN_SPEC §1.6 Addresses) — one place for the site's
 * addresses: the permanent Mingla address, then a domain the brand owns with
 * its registrar's steps, the exact records, Check now, securing, live, main
 * address and disconnect. Brand admins and owners change addresses (Core
 * decides); everyone else reads and can ask an admin.
 */
export function AddressesSection(): React.ReactElement {
  const ctx = useWebsite();
  const { controller, phone, headingRef, toast, brandId } = ctx;
  const siteId = controller.siteId;
  const domains = useBrandSiteDomains(siteId, siteId !== null);
  const attach = useAttachBrandSiteDomain(brandId, siteId);
  const check = useCheckBrandSiteDomain(brandId, siteId);
  const primary = useSetPrimaryBrandSiteDomain(brandId, siteId);
  const detach = useDetachBrandSiteDomain(brandId, siteId);
  const [domain, setDomain] = useState("");
  const [www, setWww] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "main" | "disconnect"; host: BrandSiteDomainHost }>(null);
  const canManage = domains.data?.can_manage === true;
  const hosts = orderedHosts(domains.data?.hosts ?? []);
  const mingla = hosts.find((host) => host.kind === "mingla_subdomain") ?? null;
  const own = hosts.filter((host) => host.kind === "custom_domain");

  const failed = (error: unknown, fallback: string) => toast(error instanceof BrandSitesError ? error.message : fallback, "error");
  const copy = (value: string) => {
    copyAddressText(value).then(() => toast(`Copied ${value}`, "success")).catch(() => toast("Couldn’t copy. Select the text and copy it instead.", "error"));
  };

  return (
    <View testID="website-addresses">
      <SectionHead ref={headingRef} phone={phone} title="Addresses" subtitle="Your website always keeps its Mingla address. Add a domain you own and we show exactly what to set up." />
      {domains.isLoading ? <Skeleton height={64} /> : domains.isError ? (
        <Card>
          <CardTitle>Your addresses couldn&apos;t be loaded</CardTitle>
          <Hint>{domains.error instanceof BrandSitesError ? domains.error.message : "Check your connection and try again."}</Hint>
          <WButton label="Try again" size="sm" onPress={() => { void domains.refetch(); }} style={{ alignSelf: "flex-start", marginTop: 12 }} />
        </Card>
      ) : (
        <>
          {!canManage ? (
            <Banner tone="info" icon="lock" title="Only brand admins and owners can change addresses" body="You can see them here." testID="addresses-readonly">
              <WButton label="Ask an admin" icon="msg" size="sm" onPress={() => ctx.askAdmin("domain")} loading={ctx.asking} testID="addresses-ask" />
            </Banner>
          ) : null}
          <ListBox style={styles.listGap}>
            {mingla ? (
              <Row testID="address-mingla">
                <View style={styles.grow}>
                  <Text style={styles.host} selectable>{mingla.hostname}</Text>
                  <Text style={styles.sub}>{`${mingla.is_primary ? "Main address · every other address sends visitors here" : "Still works and sends visitors to your main address"} · permanent`}</Text>
                </View>
                <Chip label="Mingla address" />
                <MiniButton icon="copy" label="Copy address" onPress={() => copy(mingla.hostname)} testID="address-copy-mingla" />
              </Row>
            ) : null}
            {own.map((host) => {
              const chip = domainChip(host);
              return (
                <Row key={host.id} testID={`address-${host.hostname}`}>
                  <View style={styles.grow}>
                    <Text style={styles.host} selectable>{host.hostname}</Text>
                    <Text style={styles.sub}>{host.is_primary ? "Main address" : host.status === "active" ? "Sends visitors to your website" : "Not live yet"}</Text>
                  </View>
                  <Chip label={chip.label} tone={CHIP_TONE[chip.tone]} />
                </Row>
              );
            })}
          </ListBox>

          {own.length === 0 ? (
            <Card testID="address-connect">
              <CardTitle>Connect a domain you own</CardTitle>
              <Hint>Bought your domain somewhere like Namecheap or GoDaddy? Connect it here. We never touch your email records.</Hint>
              <Text style={styles.label} nativeID="domain-label">Your domain</Text>
              <View style={styles.inputRow}>
                <TextInput value={domain} onChangeText={setDomain} placeholder="yourbrand.com" placeholderTextColor={ui.t4} autoCapitalize="none" autoCorrect={false}
                  keyboardType={Platform.OS === "ios" ? "url" : "default"} accessibilityLabel="Your domain" editable={canManage} style={[styles.input, styles.grow]} testID="domain-input" />
                <WButton label="Continue" variant="primary" onPress={() => attach.mutate(domain.trim(), {
                  onSuccess: (result) => {
                    setDomain("");
                    const added = result.domains?.hosts.find((host) => host.id === result.host_id);
                    setWww(added && result.domains ? wwwOffer(added, result.domains) : null);
                    toast(`${result.hostname} was added. Follow the steps below, then press Check now.`, "success");
                  },
                  onError: (error) => failed(error, "That domain couldn’t be added. Try again."),
                })} disabled={!canManage || !domain.trim()} loading={attach.isPending} testID="domain-continue" />
              </View>
            </Card>
          ) : null}

          {www && canManage ? (
            <Card testID="address-www-offer">
              <CardTitle>{`Also add ${www}?`}</CardTitle>
              <Hint>Visitors often type it. It sends them to the same website.</Hint>
              <View style={styles.actions}>
                <WButton label={`Add ${www}`} size="sm" variant="primary" loading={attach.isPending} onPress={() => attach.mutate(www, {
                  onSuccess: (result) => { setWww(null); toast(`${result.hostname} was added. Its records are below.`, "success"); },
                  onError: (error) => failed(error, "That domain couldn’t be added. Try again."),
                })} testID="address-www-add" />
                <WButton label="Not now" size="sm" variant="ghost" onPress={() => setWww(null)} testID="address-www-dismiss" />
              </View>
            </Card>
          ) : null}

          {own.map((host) => (
            <HostCard key={host.id} host={host} canManage={canManage} subdomain={mingla?.hostname ?? null}
              checking={check.isPending}
              onCopy={copy}
              onCheck={() => check.mutate(host.id, {
                onSuccess: (result) => toast(result.status === "active"
                  ? "Checked. This address is live."
                  : result.status === "verifying"
                    ? "Records found. Mingla is securing the address now; this can take a few minutes."
                    : "Checked. Mingla can't see the records yet. Changes can take up to a day to show up.", "info"),
                onError: (error) => failed(error, "Mingla couldn’t check that address. Try again."),
              })}
              onMakeMain={() => setConfirm({ kind: "main", host })}
              onDisconnect={() => setConfirm({ kind: "disconnect", host })}
            />
          ))}
        </>
      )}
      <ConfirmDialog
        visible={confirm?.kind === "main"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const host = confirm!.host;
          setConfirm(null);
          primary.mutate(host.id, {
            onSuccess: () => toast(`${host.hostname} is now your main address`, "success"),
            onError: (error) => failed(error, "Your main address couldn’t be changed. Try again."),
          });
        }}
        title={`Make ${confirm?.host.hostname ?? ""} your main address?`}
        description="Search engines will show it, and your Mingla address will forward to it. You can switch back any time."
        confirmLabel="Make it main"
        testID="address-main-confirm"
      />
      <ConfirmDialog
        visible={confirm?.kind === "disconnect"}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const host = confirm!.host;
          setConfirm(null);
          detach.mutate(host.id, {
            onSuccess: (result) => toast(result.release_now ? "Disconnected." : "Disconnected. Your Mingla address is your main address again.", "success"),
            onError: (error) => failed(error, "That address couldn’t be disconnected. Try again."),
          });
        }}
        title={`Disconnect ${confirm?.host.hostname ?? ""}?`}
        description={confirm ? `${disconnectExplanation(confirm.host, mingla?.hostname ?? null)} Remove the records at your provider afterwards; we never touch your email settings.` : ""}
        confirmLabel="Disconnect"
        destructive
        testID="address-disconnect-confirm"
      />
    </View>
  );
}

function HostCard({ host, canManage, subdomain, checking, onCopy, onCheck, onMakeMain, onDisconnect }: {
  host: BrandSiteDomainHost;
  canManage: boolean;
  subdomain: string | null;
  checking: boolean;
  onCopy: (value: string) => void;
  onCheck: () => void;
  onMakeMain: () => void;
  onDisconnect: () => void;
}): React.ReactElement {
  const detected: DnsRegistrar = isDnsRegistrar(host.registrar) ? host.registrar : "unknown";
  const [registrar, setRegistrar] = useState<DnsRegistrar>(REGISTRARS.some((row) => row.value === detected) ? detected : "unknown");
  const attention = host.status === "suspended" || (host.status === "active" && (host.dns_state === "misconfigured" || host.tls_state === "failed"));
  void subdomain;
  if (host.status === "verifying") {
    return (
      <Card testID={`address-securing-${host.hostname}`}>
        <View style={styles.rowCenter}>
          <Spinner />
          <View style={styles.grow}>
            <CardTitle>{`Records found · securing ${host.hostname}`}</CardTitle>
            <Hint>Getting the padlock (HTTPS) certificate. Usually a few minutes. You can leave this page.</Hint>
          </View>
        </View>
        <View style={styles.actions}><WButton label="Check now" size="sm" onPress={onCheck} loading={checking} disabled={!canManage} /></View>
      </Card>
    );
  }
  if (host.status === "active" && !attention) {
    return (
      <Card testID={`address-live-${host.hostname}`}>
        <View style={styles.rowCenter}>
          <CheckCircle state="on" />
          <View style={styles.grow}>
            <CardTitle>{`${host.hostname} is live`}</CardTitle>
            <Hint>Secure and pointing at your website. We check it every hour and tell you if it breaks.</Hint>
          </View>
        </View>
        {host.mx_missing ? <Banner tone="warn" icon="alert" title={MX_WARNING} /> : null}
        <View style={styles.actions}>
          {host.is_primary ? <Chip label="Main address" tone="accent" /> : canMakeMain(host)
            ? <WButton label="Make this my main address" variant="primary" size="sm" onPress={onMakeMain} disabled={!canManage} testID="address-make-main" />
            : null}
          <WButton label="Disconnect" variant="danger" size="sm" onPress={onDisconnect} disabled={!canManage} testID="address-disconnect" />
        </View>
        <Text style={styles.help}>Your main address is the one search engines see. The other address keeps working and forwards to it.</Text>
      </Card>
    );
  }
  const guide = dnsGuide({ registrar, apexDomain: host.apex ?? host.hostname, records: host.records });
  return (
    <Card testID={`address-setup-${host.hostname}`}>
      {attention ? (
        <Banner tone="warn" icon="alert" title={`${host.hostname} isn't pointing at your website any more`}
          body={`Noticed ${host.misconfigured_since ? formatWebsiteDateTime(host.misconfigured_since) : "recently"}. Visitors to it may see an error. Check the records below.`} />
      ) : null}
      <CardTitle>Add these records at your domain provider</CardTitle>
      {needsSetup(host) || attention ? (
        <>
          <Text style={styles.label}>Where did you buy it?</Text>
          <Segmented label="Where did you buy it?" compact options={REGISTRARS} value={registrar} onChange={setRegistrar} testIDPrefix="registrar" />
          <View style={styles.steps}>
            {guide.steps.map((step, index) => <Text key={index} style={styles.step}>{`${index + 1}. ${step}`}</Text>)}
            <Text style={styles.step}>{`${guide.steps.length + 1}. Come back and press Check now. It can take up to a few hours.`}</Text>
          </View>
        </>
      ) : null}
      {host.records.length ? (
        <View style={styles.table} role="table" accessibilityLabel="Records to add">
          <View style={[styles.tr, styles.th]}>
            <Text style={[styles.cell, styles.thText, styles.cType]}>Type</Text>
            <Text style={[styles.cell, styles.thText, styles.cName]}>Name</Text>
            <Text style={[styles.cell, styles.thText, styles.grow]}>Value</Text>
            <View style={styles.cCopy} />
          </View>
          {host.records.map((record) => (
            <View key={`${record.type}-${record.name}`} style={styles.tr}>
              <Text style={[styles.cell, styles.cType]}>{record.type}</Text>
              <Text style={[styles.cell, styles.monoText, styles.cName]} selectable>{recordNameFor(host, record.name)}</Text>
              <Text style={[styles.cell, styles.monoText, styles.grow]} selectable>{record.value}</Text>
              <View style={styles.cCopy}><MiniButton icon="copy" label={`Copy ${record.value}`} onPress={() => onCopy(record.value)} /></View>
            </View>
          ))}
        </View>
      ) : <Hint>Mingla is getting the records for this address. Press Check now in a minute.</Hint>}
      <View style={styles.actions}>
        <WButton label="Check now" variant="primary" onPress={onCheck} loading={checking} disabled={!canManage} testID="address-check" />
        <Hint style={styles.grow}>{host.last_checked_at ? `Last checked ${formatWebsiteDateTime(host.last_checked_at)} · records not found yet` : "Not checked yet"}</Hint>
        <WButton label="Remove domain" variant="danger" size="sm" onPress={onDisconnect} disabled={!canManage} testID="address-remove" />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  listGap: { marginBottom: 16 },
  host: { fontFamily: mono, fontSize: 14, color: ui.t1, fontWeight: "600" },
  sub: { fontSize: 12.5, lineHeight: 17, color: ui.t3 },
  label: { fontSize: 13, fontWeight: "600", color: ui.t2, marginTop: 14, marginBottom: 6 },
  inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: ui.border2, backgroundColor: "rgba(255,255,255,0.03)", paddingHorizontal: 12, color: ui.t1, fontSize: 14 },
  rowCenter: { flexDirection: "row", alignItems: "center", gap: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 14 },
  help: { fontSize: 12, lineHeight: 16, color: ui.t3, marginTop: 8 },
  steps: { gap: 6, marginTop: 12 },
  step: { fontSize: 13.5, lineHeight: 22, color: ui.t2 },
  table: { marginTop: 12, borderTopWidth: 1, borderTopColor: ui.cardBorder },
  tr: { flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: ui.cardBorder, minHeight: 44 },
  th: { minHeight: 32 },
  thText: { color: ui.t3, fontWeight: "600", fontSize: 12 },
  cell: { paddingVertical: 8, paddingHorizontal: 6, fontSize: 13, color: ui.t1 },
  cType: { width: 64 },
  cName: { width: 90 },
  cCopy: { width: 40, alignItems: "center" },
  monoText: { fontFamily: mono, fontSize: 12.5 },
});
