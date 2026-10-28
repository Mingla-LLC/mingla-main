/**
 * #2829 W8 (AD-10) — "Your addresses": the brand's Mingla subdomain and the
 * domains it owns. Pure helpers for the Business screen: the status chip for
 * each address, the registrar-specific steps, the "also add www" offer and the
 * words for disconnecting. The screen never names Mingla's infrastructure
 * providers; it may name the owner's registrar.
 */
import {
  detectRegistrar,
  dnsGuide,
  isDnsRegistrar,
  recordHostLabel,
  type DnsGuide,
} from "../../../packages/site-contracts/src/dnsGuides.ts";
import type { BrandSiteDomainHost, BrandSiteDomains } from "./contracts";

export type DomainChip =
  | "Mingla address"
  | "Waiting for DNS"
  | "Securing"
  | "Live"
  | "Needs attention"
  | "Disconnecting";

export interface DomainChipView {
  label: DomainChip;
  tone: "neutral" | "progress" | "success" | "warning" | "muted";
}

/** The chip shown next to an address. */
export function domainChip(host: Pick<BrandSiteDomainHost, "kind" | "status" | "dns_state" | "tls_state">): DomainChipView {
  if (host.kind === "mingla_subdomain") return { label: "Mingla address", tone: "neutral" };
  switch (host.status) {
    case "pending":
      return { label: "Waiting for DNS", tone: "progress" };
    case "verifying":
      return { label: "Securing", tone: "progress" };
    case "detaching":
      return { label: "Disconnecting", tone: "muted" };
    case "suspended":
      return { label: "Needs attention", tone: "warning" };
    case "active":
      return host.dns_state === "misconfigured" || host.tls_state === "failed"
        ? { label: "Needs attention", tone: "warning" }
        : { label: "Live", tone: "success" };
    default: {
      const never: never = host.status;
      return never;
    }
  }
}

export const MX_WARNING =
  "Your email records changed. We didn't touch them, but check with your email provider.";

/** The steps for an address that is not live yet, or needs fixing. */
export function domainGuide(host: Pick<BrandSiteDomainHost, "hostname" | "apex" | "registrar" | "records">): DnsGuide {
  return dnsGuide({
    registrar: isDnsRegistrar(host.registrar) ? host.registrar : detectRegistrar([]),
    apexDomain: host.apex ?? host.hostname,
    records: host.records,
  });
}

/** The Name/Host field to type for a record of this address. */
export function recordNameFor(host: Pick<BrandSiteDomainHost, "hostname" | "apex">, recordName: string): string {
  return recordHostLabel(recordName, host.apex ?? host.hostname);
}

/** Should guidance (records + steps) show for this address? */
export function needsSetup(host: Pick<BrandSiteDomainHost, "kind" | "status" | "dns_state">): boolean {
  return host.kind === "custom_domain" &&
    (host.status === "pending" || host.status === "verifying" ||
      (host.status === "active" && host.dns_state === "misconfigured"));
}

/** The address the owner can become the main one ("Make this my main address"). */
export function canMakeMain(host: Pick<BrandSiteDomainHost, "status" | "is_primary">): boolean {
  return host.status === "active" && !host.is_primary;
}

/**
 * After adding an apex (`brand.com`), offer `www.brand.com` too unless the
 * site already has it. Returns the name to offer, or null.
 */
export function wwwOffer(
  added: Pick<BrandSiteDomainHost, "hostname" | "is_apex">,
  domains: Pick<BrandSiteDomains, "hosts" | "max_custom_domains">,
): string | null {
  if (!added.is_apex) return null;
  const www = `www.${added.hostname}`;
  const custom = domains.hosts.filter((host) => host.kind === "custom_domain");
  if (custom.some((host) => host.hostname === www)) return null;
  if (custom.length >= domains.max_custom_domains) return null;
  return www;
}

/** The disconnect sheet's explanation. */
export function disconnectExplanation(
  host: Pick<BrandSiteDomainHost, "hostname" | "status" | "is_primary">,
  subdomain: string | null,
): string {
  const mingla = subdomain ?? "your Mingla address";
  if (host.status === "detaching") {
    return `${host.hostname} is already redirecting visitors to ${mingla}. If you've moved your DNS somewhere else, you can disconnect it now.`;
  }
  if (host.status !== "active") {
    return `${host.hostname} isn't live yet, so nothing changes for your visitors. It's removed straight away.`;
  }
  return `${host.is_primary ? `${mingla} becomes your main address immediately. ` : ""}` +
    `${host.hostname} will keep redirecting visitors to ${mingla} for 30 days, then disconnect.`;
}

/** The domain list in display order: the main address first. */
export function orderedHosts(hosts: readonly BrandSiteDomainHost[]): BrandSiteDomainHost[] {
  return [...hosts].sort((left, right) =>
    Number(right.is_primary) - Number(left.is_primary) ||
    Number(left.kind === "custom_domain") - Number(right.kind === "custom_domain") ||
    left.created_at.localeCompare(right.created_at)
  );
}
