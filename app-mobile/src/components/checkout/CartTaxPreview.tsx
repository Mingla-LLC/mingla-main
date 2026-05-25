import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { supabase } from "../../services/supabase";

export interface BuyerAddress {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postal: string;
  country: string;
}

export interface CartTaxPreviewResult {
  address: BuyerAddress;
  calculationId: string | null;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  taxBreakdown: unknown[];
}

interface Props {
  eventId: string;
  lines: Array<{ ticketTypeId: string; quantity: number }>;
  buyer: {
    name: string;
    email: string;
    phone: string;
    marketingOptIn?: boolean;
  };
  currency: string;
  disabled?: boolean;
  onPreviewChange: (result: CartTaxPreviewResult | null) => void;
}

const money = (cents: number, currency: string): string =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    cents / 100,
  );

const TAX_COUNTRY_UNSUPPORTED_COPY =
  "Tax couldn't be calculated for this country. Choose a different billing country.";

async function taxPreviewErrorCopy(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (
    ctx !== null &&
    typeof ctx === "object" &&
    typeof (ctx as { text?: () => Promise<string> }).text === "function"
  ) {
    try {
      const raw = await (ctx as { text: () => Promise<string> }).text();
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (parsed.error === "tax_country_unsupported") {
        return TAX_COUNTRY_UNSUPPORTED_COPY;
      }
    } catch {
      // Fall through to generic retry copy.
    }
  }
  return "Couldn't calculate tax. Tap to retry.";
}

export const CartTaxPreview: React.FC<Props> = ({
  eventId,
  lines,
  buyer,
  currency,
  disabled = false,
  onPreviewChange,
}) => {
  const [address, setAddress] = useState<BuyerAddress>({
    line1: "",
    city: "",
    state: "",
    postal: "",
    country: "US",
  });
  const [preview, setPreview] = useState<CartTaxPreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = useMemo(
    () =>
      address.line1.trim().length > 0 &&
      address.city.trim().length > 0 &&
      address.postal.trim().length > 0 &&
      /^[A-Z]{2}$/.test(address.country.trim()),
    [address],
  );

  const updateAddress = useCallback(
    (patch: Partial<BuyerAddress>) => {
      setAddress((current) => ({ ...current, ...patch }));
      setPreview(null);
      onPreviewChange(null);
    },
    [onPreviewChange],
  );

  const calculate = useCallback(async () => {
    if (!complete || disabled || loading) return;
    setLoading(true);
    setError(null);
    const cleanAddress = {
      ...address,
      line1: address.line1.trim(),
      line2: address.line2?.trim() || undefined,
      city: address.city.trim(),
      state: address.state?.trim() || undefined,
      postal: address.postal.trim(),
      country: address.country.trim().toUpperCase(),
    };
    const { data, error: invokeError } = await supabase.functions.invoke<{
      calculationId: string | null;
      subtotalCents: number;
      taxCents: number;
      totalCents: number;
      taxBreakdown: unknown[];
    }>("ticket-checkout-create", {
      body: {
        eventId,
        surface: "native",
        mode: "preview",
        buyer: { ...buyer, address: cleanAddress },
        lines,
      },
    });
    setLoading(false);
    if (invokeError || !data) {
      setError(await taxPreviewErrorCopy(invokeError));
      onPreviewChange(null);
      return;
    }
    const next = {
      address: cleanAddress,
      calculationId: data.calculationId,
      subtotalCents: data.subtotalCents,
      taxCents: data.taxCents,
      totalCents: data.totalCents,
      taxBreakdown: data.taxBreakdown ?? [],
    };
    setPreview(next);
    onPreviewChange(next);
  }, [
    address,
    buyer,
    complete,
    disabled,
    eventId,
    lines,
    loading,
    onPreviewChange,
  ]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>BILLING ADDRESS</Text>
      <TextInput
        accessibilityLabel="Billing address line 1"
        placeholder="Address line 1"
        placeholderTextColor="rgba(255,255,255,0.45)"
        style={styles.input}
        value={address.line1}
        autoComplete="address-line1"
        textContentType="streetAddressLine1"
        onChangeText={(line1) => updateAddress({ line1 })}
      />
      <TextInput
        accessibilityLabel="Billing address line 2"
        placeholder="Address line 2"
        placeholderTextColor="rgba(255,255,255,0.45)"
        style={styles.input}
        value={address.line2 ?? ""}
        autoComplete="address-line2"
        textContentType="streetAddressLine2"
        onChangeText={(line2) => updateAddress({ line2 })}
      />
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Billing city"
          placeholder="City"
          placeholderTextColor="rgba(255,255,255,0.45)"
          style={[styles.input, styles.flex]}
          value={address.city}
          textContentType="addressCity"
          onChangeText={(city) => updateAddress({ city })}
        />
        <TextInput
          accessibilityLabel="Billing state or region"
          placeholder="State"
          placeholderTextColor="rgba(255,255,255,0.45)"
          style={[styles.input, styles.state]}
          value={address.state ?? ""}
          textContentType="addressState"
          onChangeText={(state) => updateAddress({ state })}
        />
      </View>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Billing postal code"
          placeholder="Postal code"
          placeholderTextColor="rgba(255,255,255,0.45)"
          style={[styles.input, styles.flex]}
          value={address.postal}
          autoComplete="postal-code"
          textContentType="postalCode"
          onChangeText={(postal) => updateAddress({ postal })}
        />
        <TextInput
          accessibilityLabel="Billing country"
          placeholder="US"
          autoCapitalize="characters"
          maxLength={2}
          placeholderTextColor="rgba(255,255,255,0.45)"
          style={[styles.input, styles.country]}
          value={address.country}
          autoComplete="country"
          onChangeText={(country) =>
            updateAddress({ country: country.toUpperCase() })}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Calculate tax"
        disabled={!complete || disabled || loading}
        onPress={calculate}
        style={[
          styles.button,
          (!complete || disabled) && styles.buttonDisabled,
        ]}
      >
        {loading
          ? <ActivityIndicator color="#ffffff" />
          : <Text style={styles.buttonText}>Calculate tax</Text>}
      </Pressable>
      {preview
        ? (
          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Tax</Text>
              <Text style={styles.summaryValue}>
                {money(preview.taxCents, currency)}
              </Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>
                {money(preview.totalCents, currency)}
              </Text>
            </View>
          </View>
        )
        : error
        ? <Text style={styles.error}>{error}</Text>
        : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { gap: 10, marginTop: 16 },
  label: { color: "rgba(255,255,255,0.62)", fontSize: 12, fontWeight: "700" },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    color: "#ffffff",
    paddingHorizontal: 12,
  },
  row: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  state: { width: 96 },
  country: { width: 76 },
  button: {
    alignItems: "center",
    borderRadius: 12,
    backgroundColor: "#f97316",
    paddingVertical: 12,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: "#ffffff", fontWeight: "800" },
  summary: { gap: 8 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { color: "rgba(255,255,255,0.72)" },
  summaryValue: { color: "#ffffff" },
  totalLabel: { color: "#ffffff", fontWeight: "800" },
  totalValue: { color: "#ffffff", fontWeight: "800" },
  error: { color: "#fecaca" },
});
