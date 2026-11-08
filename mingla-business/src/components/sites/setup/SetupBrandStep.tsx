import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import type { ThemeInput } from "@mingla/offering-rendering";
import { useAuth } from "../../../context/AuthContext";
import { useBrand, useUpdateBrand } from "../../../hooks/useBrands";
import { joinBrandDescription } from "../../../services/brandMapping";
import { brandSiteKeys } from "../../../sites/brandSiteKeys";
import { useMarkNotApplicable } from "../../../sites/setupApi";
import type { BrandContextField, SitePlanState } from "../../../sites/sitePlanState";
import type { Brand } from "../../../store/currentBrandStore";
import type { BrandAddressPatch } from "../../../utils/brandAddressPatch";
import { parsePhoneEntry } from "../../../../../packages/phone-input/phoneNumber";
import { ThemeControlRow } from "../../theme/ThemeControlRow";
import { ThemeSheet } from "../../theme/ThemeSheetLazy";
import { Input, PHONE_COUNTRIES } from "../../ui/Input";
import type { AriFlowUploadCopy, AriFlowUploadKind } from "../../ari/ariFlowCards";
import { Chip, Field, Hint, WButton, ui } from "../website/ui";

/**
 * The brand contact email rule, word for word from `utils/brandContactEmail`
 * (its owner; a test pins the two together). Kept here so this lazy screen does
 * not pull that module, which the brand edit screen also loads, into the shared
 * web bundle every visitor downloads.
 */
export const SETUP_CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const SETUP_CONTACT_EMAIL_INVALID = "That doesn't look like an email address. Fix it or clear it to save.";
const validateSetupEmail = (value: string): string | null =>
  value.trim().length === 0 || SETUP_CONTACT_EMAIL_RE.test(value.trim()) ? null : SETUP_CONTACT_EMAIL_INVALID;

/*
 * Brand details in place (#2830 §4.2). Writes through the same useUpdateBrand
 * mutation Brand Edit uses, one field at a time, so nothing new writes `brands`
 * and the readiness trigger closes stale findings on a by-hand save.
 *
 * Both of these load on intent: a static import next to Brand Edit's would hoist
 * them into __common (measured, 5,232 B with the patch helpers).
 */
const LazyAddressField = React.lazy(() =>
  import("../../brand/BrandEditAddressField").then((m) => ({ default: m.BrandEditAddressField })),
);
const LazyUploadCard = React.lazy(() =>
  import("../../ari/AriFlowUploadCard").then((m) => ({ default: m.AriFlowUploadCard })),
);

// Setup's own words, so this chunk does not share ariFlowCards with the chat.
const UPLOAD_COPY: Readonly<Record<Extract<AriFlowUploadKind, "logo" | "cover">, AriFlowUploadCopy>> = {
  logo: { action: "Upload your logo", note: "Square works best, JPEG, PNG or WebP under 20 MB", answer: "" },
  cover: { action: "Upload a photo", note: "Wide photo, JPEG, PNG or WebP under 20 MB", answer: "" },
};

/** The nine the server accepts as "doesn't apply". Never a required field. */
const NOT_APPLICABLE_KEYS: ReadonlySet<string> = new Set([
  "venue_descriptor", "contact_email", "contact_phone", "address", "city_country",
  "social_links", "profile_photo", "cover_media", "theme",
]);

const ORDER = ["name", "description", "city_country", "contact_email", "contact_phone", "address", "social_links", "profile_photo", "cover_media", "theme"];

const SETTLED_WORDS: Readonly<Record<string, string>> = { profile_photo: "Added", cover_media: "Added", theme: "Set" };

function settledValue(field: BrandContextField): string {
  if (field.state === "not_applicable") return "Doesn't apply";
  if (SETTLED_WORDS[field.key]) return SETTLED_WORDS[field.key];
  if (typeof field.value === "string") return field.value;
  if (field.key === "city_country") {
    const place = (field.value ?? {}) as { city?: unknown; country_code?: unknown };
    return [place.city, place.country_code].filter((part) => typeof part === "string" && part).join(", ");
  }
  if (field.key === "social_links") {
    const links = ((field.value ?? {}) as { social_links?: Record<string, unknown> }).social_links ?? {};
    return Object.keys(links).length ? `${Object.keys(links).length} added` : "";
  }
  return "";
}

/** Web: scroll the field into view and put the cursor in it. */
export function revealSetupField(key: string): void {
  const doc = (globalThis as { document?: { querySelector?: (selector: string) => unknown } }).document;
  const host = doc?.querySelector?.(`[data-testid="setup-field-${key}"]`) as
    | { scrollIntoView?: (options: unknown) => void; focus?: () => void; querySelector?: (selector: string) => { focus?: () => void } | null }
    | null
    | undefined;
  host?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  (host?.querySelector?.("input, textarea") ?? host)?.focus?.();
}

type SavedPlace = { city: string | undefined; countryCode: string | undefined };

/** The saved City and country field, as the plan read reports it. */
export function planPlace(plan: SitePlanState): SavedPlace {
  const field = plan.completeness?.fields.find((row) => row.key === "city_country");
  if (!field || field.state !== "verified") return { city: undefined, countryCode: undefined };
  const value = (field.value ?? {}) as { city?: unknown; country_code?: unknown };
  return {
    city: typeof value.city === "string" && value.city ? value.city : undefined,
    countryCode: typeof value.country_code === "string" && value.country_code ? value.country_code : undefined,
  };
}

type FieldSave = (patch: Partial<Brand>) => Promise<boolean>;
/** Saves what is typed but not sent. True: nothing is left, or it saved. */
type Flush = () => Promise<boolean>;
type RegisterFlush = (key: string, flush: Flush | null) => void;

/** A tap on Next doesn't blur a field on native, so Next asks each field to send. */
function useFlush(register: RegisterFlush, key: string, flush: Flush): void {
  const latest = useRef(flush);
  latest.current = flush;
  useEffect(() => {
    register(key, () => latest.current());
    return () => register(key, null);
  }, [key, register]);
}

function SavedRow({ field }: { field: BrandContextField }): React.ReactElement {
  return (
    <View style={styles.saved} testID={`setup-saved-${field.key}`}>
      <View style={styles.tick}><Text style={styles.tickMark}>✓</Text></View>
      <Text style={styles.savedLabel}>{field.label}</Text>
      <Text style={styles.savedValue} numberOfLines={1}>{settledValue(field)}</Text>
    </View>
  );
}

export function SetupBrandStep({ brandId, plan, readOnly, hotField, focusRequest = null, onNext, nextStepLabel }: {
  brandId: string;
  plan: SitePlanState;
  readOnly: boolean;
  /** The field Ari is asking about right now. */
  hotField: string | null;
  /** "Add it myself" from Ari beside this form: bring this field into view. */
  focusRequest?: { key: string; at: number } | null;
  onNext: () => void;
  nextStepLabel: string | null;
}): React.ReactElement {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const brand = useBrand(brandId);
  const update = useUpdateBrand();
  const markNa = useMarkNotApplicable(brandId);
  const [problem, setProblem] = useState<{ key: string; message: string } | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const flushers = useRef(new Map<string, Flush>());
  const registerFlush = useCallback<RegisterFlush>((key, flush) => {
    if (flush) flushers.current.set(key, flush);
    else flushers.current.delete(key);
  }, []);

  const fields = useMemo(() => {
    const byKey = new Map((plan.completeness?.fields ?? []).map((field) => [field.key, field]));
    return ORDER.map((key) => byKey.get(key)).filter((field): field is BrandContextField => field !== undefined && field.requirement !== "optional");
  }, [plan.completeness]);
  const open = fields.filter((field) => field.state !== "verified" && field.state !== "not_applicable");
  // #2830 — Ari saves City and country straight to the brand context. The
  // plan read has it at once; the brand row this screen holds may be older.
  const savedPlace = useMemo(() => planPlace(plan), [plan]);
  const contextRevision = plan.completeness?.contextRevision ?? "";
  const seenRevision = useRef(contextRevision);
  const refetchBrand = brand.refetch;
  useEffect(() => {
    if (seenRevision.current === contextRevision) return;
    seenRevision.current = contextRevision;
    void refetchBrand?.();
  }, [contextRevision, refetchBrand]);
  const settled = fields.filter((field) => field.state === "verified" || field.state === "not_applicable");
  const data = brand.data ?? null;

  const save = useCallback<FieldSave>(async (patch) => {
    if (!data || !user?.id) return false;
    await update.mutateAsync({
      brandId,
      patch,
      existingDescription: joinBrandDescription(data.tagline, data.bio),
      accountId: user.id,
    });
    await queryClient.invalidateQueries({ queryKey: brandSiteKeys.plan(brandId) });
    return true;
  }, [brandId, data, queryClient, update, user?.id]);

  const guarded = useCallback(async (key: string, patch: Partial<Brand>): Promise<boolean> => {
    setProblem(null);
    setSaving(key);
    try {
      return await save(patch);
    } catch {
      // The field keeps the owner's text; Try again sends it again.
      setProblem({ key, message: "That didn't save" });
      return false;
    } finally {
      setSaving(null);
    }
  }, [save]);

  useEffect(() => {
    if (!focusRequest) return;
    setFocused(focusRequest.key);
    revealSetupField(focusRequest.key);
  }, [focusRequest]);

  const firstOpen = open[0] ?? null;
  const currentKey = focused && open.some((field) => field.key === focused) ? focused : firstOpen?.key ?? null;
  const nextField = open.find((field) => field.key !== currentKey) ?? null;
  const canSkip = currentKey !== null && NOT_APPLICABLE_KEYS.has(currentKey) && !readOnly;

  const onNotApplicable = () => {
    if (!currentKey) return;
    setProblem(null);
    markNa.mutate(
      { fieldKey: currentKey, contextRevision: plan.completeness?.contextRevision ?? "" },
      { onError: () => setProblem({ key: currentKey, message: "That didn't save" }) },
    );
  };

  if (brand.isLoading) return <View style={styles.loading}><ActivityIndicator accessibilityLabel="Loading your brand details" /></View>;

  return (
    <View style={styles.host} testID="setup-brand">
      <Text style={styles.title} role="heading" aria-level={2}>Your brand details</Text>
      <Hint>These appear on your website. Saved the moment you move on.</Hint>
      {data ? open.map((field) => (
        <SetupFieldEditor
          key={field.key}
          field={field}
          brand={data}
          savedPlace={savedPlace}
          brandId={brandId}
          accountId={user?.id ?? null}
          hot={hotField === field.key || (hotField === null && currentKey === field.key)}
          readOnly={readOnly}
          problem={problem?.key === field.key ? problem.message : null}
          saving={saving === field.key}
          onFocus={() => setFocused(field.key)}
          registerFlush={registerFlush}
          onSave={(patch) => guarded(field.key, patch)}
          onProblem={(message) => setProblem(message ? { key: field.key, message } : null)}
        />
      )) : null}
      {settled.map((field) => <SavedRow key={field.key} field={field} />)}
      {readOnly ? null : (
        <View style={styles.row}>
          <WButton
            label={nextField ? `Next: ${nextField.label.toLowerCase()}` : nextStepLabel ? `Next: ${nextStepLabel.toLowerCase()}` : "Next"}
            variant="primary"
            onPress={() => {
              void (async () => {
                for (const flush of [...flushers.current.values()]) {
                  // What didn't save stays on screen with why; Next stays here.
                  if (!(await flush())) return;
                }
                if (nextField) setFocused(nextField.key);
                else onNext();
              })();
            }}
            testID="setup-next"
          />
          {canSkip ? <WButton label="Doesn't apply to my brand" variant="ghost" loading={markNa.isPending} onPress={onNotApplicable} testID="setup-not-applicable" /> : null}
        </View>
      )}
    </View>
  );
}

function SetupFieldEditor({ field, brand, savedPlace, brandId, accountId, hot, readOnly, problem, saving, registerFlush, onFocus, onSave, onProblem }: {
  field: BrandContextField;
  brand: Brand;
  savedPlace: SavedPlace;
  brandId: string;
  accountId: string | null;
  hot: boolean;
  readOnly: boolean;
  problem: string | null;
  saving: boolean;
  registerFlush: RegisterFlush;
  onFocus: () => void;
  onSave: FieldSave;
  onProblem: (message: string | null) => void;
}): React.ReactElement {
  const statusChip = field.humanActionRequired ? <Chip label="Needs your upload" tone="accent" /> : null;
  const retry = problem ? (
    <Text style={styles.problem} accessibilityRole="alert" testID={`setup-problem-${field.key}`}>{problem}</Text>
  ) : null;
  switch (field.key) {
    case "name":
      return <TextFieldEditor field={field} initial={brand.displayName ?? ""} max={80} hot={hot} readOnly={readOnly} problem={problem} saving={saving} registerFlush={registerFlush} onFocus={onFocus} commit={(value) => onSave({ displayName: value })} />;
    case "description":
      return <TextFieldEditor field={field} multiline initial={joinBrandDescription(brand.tagline, brand.bio) ?? ""} max={500} hot={hot} readOnly={readOnly} problem={problem} saving={saving} registerFlush={registerFlush} onFocus={onFocus} commit={(value) => onSave({ tagline: "", bio: value })} />;
    case "contact_email":
      return <TextFieldEditor field={field} initial={brand.contact?.email ?? ""} placeholder="hello@yourbrand.com" keyboardType="email-address" hot={hot} readOnly={readOnly} problem={problem} saving={saving} registerFlush={registerFlush} onFocus={onFocus} validate={validateSetupEmail} commit={(value) => onSave({ contact: { ...brand.contact, email: value } })} />;
    case "contact_phone":
      return <PhoneEditor field={field} brand={brand} readOnly={readOnly} problem={problem} registerFlush={registerFlush} onFocus={onFocus} onSave={onSave} onProblem={onProblem} />;
    case "address":
    case "city_country":
      return <AddressEditor field={field} brand={brand} savedPlace={savedPlace} readOnly={readOnly} problem={problem} saving={saving} registerFlush={registerFlush} onSave={onSave} />;
    case "social_links":
      return <LinksEditor field={field} brand={brand} hot={hot} readOnly={readOnly} problem={problem} registerFlush={registerFlush} onFocus={onFocus} onSave={onSave} onProblem={onProblem} />;
    case "profile_photo":
    case "cover_media":
      return (
        <View style={styles.field}>
          <View style={styles.labelRow}><Text style={styles.label}>{field.label}</Text>{statusChip}</View>
          <Suspense fallback={<ActivityIndicator accessibilityLabel={`Loading ${field.label}`} />}>
            <LazyUploadCard
              kind={field.key === "profile_photo" ? "logo" : "cover"}
              copy={UPLOAD_COPY[field.key === "profile_photo" ? "logo" : "cover"]}
              brandId={brandId}
              accountId={accountId}
              disabled={readOnly}
              onUploaded={() => undefined}
            />
          </Suspense>
          {retry}
        </View>
      );
    case "theme":
      return <ThemeEditor field={field} brand={brand} readOnly={readOnly} problem={problem} onSave={onSave} />;
    default:
      return <View />;
  }
}

function TextFieldEditor({ field, initial, max, multiline, placeholder, keyboardType, hot, readOnly, problem, saving, registerFlush, onFocus, validate, commit }: {
  field: BrandContextField;
  initial: string;
  max?: number;
  multiline?: boolean;
  placeholder?: string;
  keyboardType?: "email-address";
  hot: boolean;
  readOnly: boolean;
  problem: string | null;
  saving: boolean;
  registerFlush: RegisterFlush;
  onFocus: () => void;
  validate?: (value: string) => string | null;
  commit: (value: string) => Promise<boolean>;
}): React.ReactElement {
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState<string | null>(null);
  // Blur and Next can both fire for one edit: one value is sent once.
  const sent = useRef<{ value: string; result: Promise<boolean> } | null>(null);
  const send: Flush = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed === initial.trim()) return Promise.resolve(true);
    const bad = validate?.(trimmed) ?? null;
    setInvalid(bad);
    if (bad) return Promise.resolve(false);
    if (sent.current?.value === trimmed) return sent.current.result;
    const result = commit(trimmed).then((saved) => {
      if (!saved) sent.current = null;
      return saved;
    });
    sent.current = { value: trimmed, result };
    return result;
  };
  useFlush(registerFlush, field.key, send);
  return (
    <View style={[styles.field, hot ? styles.hot : null]}>
      <Field
        label={field.label}
        value={value}
        max={max}
        multiline={multiline}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoCapitalize={keyboardType ? "none" : undefined}
        editable={!readOnly}
        onFocus={onFocus}
        onBlur={() => { void send(); }}
        onChangeText={(next) => { setValue(next); if (invalid) setInvalid(null); }}
        error={invalid}
        testID={`setup-field-${field.key}`}
      />
      {problem ? <ProblemRetry problem={problem} fieldKey={field.key} onRetry={() => { void send(); }} saving={saving} /> : null}
    </View>
  );
}

function ProblemRetry({ problem, fieldKey, onRetry, saving }: { problem: string; fieldKey: string; onRetry: () => void; saving?: boolean }): React.ReactElement {
  return (
    <View style={styles.problemRow}>
      <Text style={styles.problem} accessibilityRole="alert" testID={`setup-problem-${fieldKey}`}>{problem}</Text>
      <WButton label="Try again" size="sm" onPress={onRetry} loading={saving} testID={`setup-retry-${fieldKey}`} />
    </View>
  );
}

/**
 * An open phone field has nothing valid saved. Same parser and same E.164 result
 * as Brand Edit; its rules module is not shared here, or it would hoist 4,401 B
 * into __common for every Host (measured).
 */
function PhoneEditor({ field, brand, readOnly, problem, registerFlush, onFocus, onSave, onProblem }: {
  field: BrandContextField;
  brand: Brand;
  readOnly: boolean;
  problem: string | null;
  registerFlush: RegisterFlush;
  onFocus: () => void;
  onSave: FieldSave;
  onProblem: (message: string | null) => void;
}): React.ReactElement {
  const own = PHONE_COUNTRIES.find((country) => country.iso === brand.countryCode) ?? null;
  const [text, setText] = useState(brand.contact?.phone?.startsWith("+") ? "" : brand.contact?.phone ?? "");
  const [iso, setIso] = useState<string | null>(own?.iso ?? null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const sent = useRef<{ value: string; result: Promise<boolean> } | null>(null);
  const send: Flush = () => {
    const typed = text.trim();
    if (typed.length === 0) return Promise.resolve(true);
    const country = PHONE_COUNTRIES.find((row) => row.iso === iso) ?? null;
    if (country === null && !typed.startsWith("+")) {
      setInvalid("Choose the country for this phone number.");
      return Promise.resolve(false);
    }
    const parsed = parsePhoneEntry(typed, { countryIso: country?.iso ?? null, dialCode: country?.dialCode ?? "+1", mode: "any" });
    if (!parsed.ok) {
      setInvalid(parsed.message);
      return Promise.resolve(false);
    }
    setInvalid(null);
    onProblem(null);
    if (sent.current?.value === parsed.e164) return sent.current.result;
    const result = onSave({ contact: { ...brand.contact, phone: parsed.e164 } }).then((saved) => {
      if (!saved) sent.current = null;
      return saved;
    });
    sent.current = { value: parsed.e164, result };
    return result;
  };
  useFlush(registerFlush, field.key, send);
  return (
    <View style={styles.field} testID="setup-field-contact_phone">
      <Text style={styles.label}>{field.label}</Text>
      <Input
        variant="phone"
        value={text}
        editable={!readOnly}
        onFocus={onFocus}
        onBlur={() => { void send(); }}
        onChangeText={(next) => { setText(next); if (invalid) setInvalid(null); }}
        defaultCountryIso={own?.iso}
        countryIso={iso ?? undefined}
        onCountryChange={(country) => setIso(country.iso)}
        countryPlaceholder={iso === null ? "Choose country" : undefined}
        placeholder="Phone number"
        accessibilityLabel={field.label}
        error={invalid}
        errorId="setup-contact-phone-error"
      />
      {problem ? <ProblemRetry problem={problem} fieldKey={field.key} onRetry={() => { void send(); }} /> : null}
    </View>
  );
}

function AddressEditor({ field, brand, savedPlace, readOnly, problem, saving, registerFlush, onSave }: {
  field: BrandContextField;
  brand: Brand;
  /** City and country as the plan read has them (what Ari just saved). */
  savedPlace: SavedPlace;
  readOnly: boolean;
  problem: string | null;
  saving: boolean;
  registerFlush: RegisterFlush;
  onSave: FieldSave;
}): React.ReactElement {
  const [pending, setPending] = useState<BrandAddressPatch | null>(null);
  // A pick or a placed address carries the city, so it saves as it lands.
  useEffect(() => {
    if (pending?.city || pending?.countryCode) void onSave(pending).then((saved) => { if (saved) setPending(null); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
  useFlush(registerFlush, field.key, () => (pending
    ? onSave(pending).then((saved) => {
      if (saved) setPending(null);
      return saved;
    })
    : Promise.resolve(true)));
  return (
    <View style={styles.field} testID={`setup-field-${field.key}`}>
      <Text style={styles.label}>{field.label}</Text>
      {readOnly ? <Hint>{brand.address ?? "Not added yet"}</Hint> : (
        <Suspense fallback={<ActivityIndicator accessibilityLabel={`Loading ${field.label}`} />}>
          <LazyAddressField
            address={pending?.address ?? brand.address}
            city={pending?.city ?? (brand.city || savedPlace.city)}
            countryCode={pending?.countryCode ?? (brand.countryCode || savedPlace.countryCode)}
            lat={pending?.lat ?? brand.lat}
            lng={pending?.lng ?? brand.lng}
            onChange={(patch) => setPending((current) => ({ ...(current ?? {}), ...patch }))}
            testID={`setup-address-${field.key}`}
          />
        </Suspense>
      )}
      {pending && !pending.city && !pending.countryCode && pending.address ? (
        <WButton label="Save address" size="sm" onPress={() => { void onSave(pending).then((saved) => { if (saved) setPending(null); }); }} loading={saving} testID={`setup-save-${field.key}`} />
      ) : null}
      {problem ? <ProblemRetry problem={problem} fieldKey={field.key} onRetry={() => { if (pending) void onSave(pending); }} saving={saving} /> : null}
    </View>
  );
}

const MORE_LINKS: ReadonlyArray<[keyof NonNullable<Brand["links"]>, string]> = [
  ["tiktok", "TikTok"], ["x", "X"], ["facebook", "Facebook"], ["youtube", "YouTube"], ["linkedin", "LinkedIn"], ["threads", "Threads"],
];

function LinksEditor({ field, brand, hot, readOnly, problem, registerFlush, onFocus, onSave, onProblem }: {
  field: BrandContextField;
  brand: Brand;
  hot: boolean;
  readOnly: boolean;
  problem: string | null;
  registerFlush: RegisterFlush;
  onFocus: () => void;
  onSave: FieldSave;
  onProblem: (message: string | null) => void;
}): React.ReactElement {
  const [more, setMore] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<string | null>(null);
  const valueOf = (key: string) => draft[key] ?? ((brand.links as Record<string, unknown> | undefined)?.[key] as string | undefined) ?? "";
  const sent = useRef<{ value: string; result: Promise<boolean> } | null>(null);
  const send: Flush = () => {
    const changed = Object.entries(draft).filter(([, value]) => value.trim().length > 0);
    if (changed.length === 0) return Promise.resolve(true);
    // The audit only accepts https links, so say so here rather than after a save.
    if (changed.some(([, value]) => !/^https:\/\//i.test(value.trim()))) {
      setInvalid("Links need to start with https://");
      return Promise.resolve(false);
    }
    setInvalid(null);
    onProblem(null);
    const key = JSON.stringify(changed);
    if (sent.current?.value === key) return sent.current.result;
    const result = onSave({ links: { ...brand.links, ...Object.fromEntries(changed.map(([name, value]) => [name, value.trim()])) } }).then((saved) => {
      if (!saved) sent.current = null;
      return saved;
    });
    sent.current = { value: key, result };
    return result;
  };
  useFlush(registerFlush, field.key, send);
  const input = (key: string, label: string) => (
    <Field
      key={key}
      label={label}
      value={valueOf(key)}
      placeholder="https://"
      autoCapitalize="none"
      editable={!readOnly}
      onFocus={onFocus}
      onBlur={() => { void send(); }}
      onChangeText={(next) => { setDraft((current) => ({ ...current, [key]: next })); if (invalid) setInvalid(null); }}
      testID={`setup-link-${key}`}
    />
  );
  return (
    <View style={[styles.field, hot ? styles.hot : null]} testID={`setup-field-${field.key}`}>
      {input("website", "Website")}
      {input("instagram", "Instagram")}
      {more ? MORE_LINKS.map(([key, label]) => input(String(key), label)) : (
        <WButton label="More links" variant="ghost" size="sm" onPress={() => setMore(true)} testID="setup-more-links" />
      )}
      {invalid ? <Text style={styles.problem} accessibilityRole="alert">{invalid}</Text> : null}
      {problem ? <ProblemRetry problem={problem} fieldKey={field.key} onRetry={() => { void send(); }} /> : null}
    </View>
  );
}

function ThemeEditor({ field, brand, readOnly, problem, onSave }: {
  field: BrandContextField;
  brand: Brand;
  readOnly: boolean;
  problem: string | null;
  onSave: FieldSave;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ThemeInput | null>(brand.theme ?? null);
  const change = (theme: ThemeInput | null) => {
    setDraft(theme);
    void onSave({ theme });
  };
  return (
    <View style={styles.field} testID={`setup-field-${field.key}`}>
      <ThemeControlRow value={draft} onChange={change} scope="brand" onPress={() => { if (!readOnly) setOpen(true); }} testID="setup-theme-row" />
      {problem ? <ProblemRetry problem={problem} fieldKey={field.key} onRetry={() => change(draft)} /> : null}
      {/* I-SUB-SHEET-INSIDE-PARENT — last child of this field's View. */}
      <ThemeSheet visible={open} onClose={() => setOpen(false)} value={draft} onChange={change} scope="brand" testID="setup-theme-sheet" />
    </View>
  );
}

const styles = StyleSheet.create({
  host: { gap: 14 },
  loading: { padding: 24, alignItems: "center" },
  title: { fontSize: 19, lineHeight: 24, fontWeight: "600", color: ui.t1 },
  field: { gap: 6, borderRadius: 12 },
  hot: { borderLeftWidth: 2, borderLeftColor: ui.accent, paddingLeft: 10 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" },
  label: { fontSize: 13, fontWeight: "600", color: ui.t1 },
  saved: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "rgba(255, 255, 255, 0.04)" },
  tick: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#7ee2a3", alignItems: "center", justifyContent: "center" },
  tickMark: { fontSize: 12, fontWeight: "800", color: "#0c2417" },
  savedLabel: { fontSize: 14, color: ui.t1 },
  savedValue: { flex: 1, textAlign: "right", fontSize: 14, color: ui.t3 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center" },
  problemRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  problem: { fontSize: 13, color: ui.err },
});
