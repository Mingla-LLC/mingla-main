/**
 * Input — single-line text input primitive.
 *
 * Variants map to `keyboardType` + `secureTextEntry` + autoCapitalize/auto-
 * Complete defaults so callers don't have to remember the right combo per
 * field type. `search` variant injects a leading magnifying-glass icon.
 *
 * Border animates from idle 1px to focus 1.5px `accent.warm` over 120ms.
 *
 * # Phone variant (ORCH-BIZ-0a-E2)
 * Renders a country chip on the left (flag + dial code + chevron-down).
 * Tap opens a Sheet with a hardcoded 12-country list (UK default per
 * Strategic Plan). Caller's `value` carries only the local-number portion;
 * caller reconstructs E.164 from `country.dialCode + value`. The selected
 * country is reported via the optional `onCountryChange` callback. Default
 * country can be overridden via `defaultCountryIso` (ISO 3166-1 alpha-2).
 *
 * # Password variant (ORCH-BIZ-0a-E3)
 * Renders a trailing eye-toggle button. Tap toggles `secureTextEntry`. The
 * eye icon dims when text is visible (no `eye-off` glyph in the Icon set —
 * tracked as D-IMPL-22). The `clearable` prop is intentionally ignored on
 * the password variant to avoid visual conflict with the eye toggle.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type {
  StyleProp,
  TextInputProps,
  ViewStyle,
} from "react-native";

type TextInputFocusHandler = NonNullable<TextInputProps["onFocus"]>;
type TextInputFocusEvent = Parameters<TextInputFocusHandler>[0];

import {
  accent,
  durations,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import { Sheet } from "./Sheet";

// ---------------------------------------------------------------------------
// Phone country list (ORCH-BIZ-0a-E2)
// ---------------------------------------------------------------------------

export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 code. */
  iso: string;
  /** English display name. */
  name: string;
  /** E.164 dial code with leading "+". */
  dialCode: string;
  /** Emoji flag — no image asset needed. */
  flag: string;
}

/**
 * Full ISO 3166-1 country list for the phone picker. 220+ entries.
 *
 * Sorted alphabetically by `name` for predictable picker UX. Each entry
 * carries ISO alpha-2, English display name, E.164 dial code, and emoji
 * flag. No phone-number validation library required (we don't validate;
 * we just present the chip).
 *
 * Multi-dial-code countries (US/Canada both +1, etc.) are listed once
 * each by ISO code — disambiguation is by name + flag. Phone validation
 * lives at backend B1+ when real number formatting is needed.
 */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { iso: "AF", name: "Afghanistan", dialCode: "+93", flag: "🇦🇫" },
  { iso: "AL", name: "Albania", dialCode: "+355", flag: "🇦🇱" },
  { iso: "DZ", name: "Algeria", dialCode: "+213", flag: "🇩🇿" },
  { iso: "AS", name: "American Samoa", dialCode: "+1684", flag: "🇦🇸" },
  { iso: "AD", name: "Andorra", dialCode: "+376", flag: "🇦🇩" },
  { iso: "AO", name: "Angola", dialCode: "+244", flag: "🇦🇴" },
  { iso: "AI", name: "Anguilla", dialCode: "+1264", flag: "🇦🇮" },
  { iso: "AG", name: "Antigua and Barbuda", dialCode: "+1268", flag: "🇦🇬" },
  { iso: "AR", name: "Argentina", dialCode: "+54", flag: "🇦🇷" },
  { iso: "AM", name: "Armenia", dialCode: "+374", flag: "🇦🇲" },
  { iso: "AW", name: "Aruba", dialCode: "+297", flag: "🇦🇼" },
  { iso: "AU", name: "Australia", dialCode: "+61", flag: "🇦🇺" },
  { iso: "AT", name: "Austria", dialCode: "+43", flag: "🇦🇹" },
  { iso: "AZ", name: "Azerbaijan", dialCode: "+994", flag: "🇦🇿" },
  { iso: "BS", name: "Bahamas", dialCode: "+1242", flag: "🇧🇸" },
  { iso: "BH", name: "Bahrain", dialCode: "+973", flag: "🇧🇭" },
  { iso: "BD", name: "Bangladesh", dialCode: "+880", flag: "🇧🇩" },
  { iso: "BB", name: "Barbados", dialCode: "+1246", flag: "🇧🇧" },
  { iso: "BY", name: "Belarus", dialCode: "+375", flag: "🇧🇾" },
  { iso: "BE", name: "Belgium", dialCode: "+32", flag: "🇧🇪" },
  { iso: "BZ", name: "Belize", dialCode: "+501", flag: "🇧🇿" },
  { iso: "BJ", name: "Benin", dialCode: "+229", flag: "🇧🇯" },
  { iso: "BM", name: "Bermuda", dialCode: "+1441", flag: "🇧🇲" },
  { iso: "BT", name: "Bhutan", dialCode: "+975", flag: "🇧🇹" },
  { iso: "BO", name: "Bolivia", dialCode: "+591", flag: "🇧🇴" },
  { iso: "BA", name: "Bosnia and Herzegovina", dialCode: "+387", flag: "🇧🇦" },
  { iso: "BW", name: "Botswana", dialCode: "+267", flag: "🇧🇼" },
  { iso: "BR", name: "Brazil", dialCode: "+55", flag: "🇧🇷" },
  { iso: "IO", name: "British Indian Ocean Territory", dialCode: "+246", flag: "🇮🇴" },
  { iso: "VG", name: "British Virgin Islands", dialCode: "+1284", flag: "🇻🇬" },
  { iso: "BN", name: "Brunei", dialCode: "+673", flag: "🇧🇳" },
  { iso: "BG", name: "Bulgaria", dialCode: "+359", flag: "🇧🇬" },
  { iso: "BF", name: "Burkina Faso", dialCode: "+226", flag: "🇧🇫" },
  { iso: "BI", name: "Burundi", dialCode: "+257", flag: "🇧🇮" },
  { iso: "KH", name: "Cambodia", dialCode: "+855", flag: "🇰🇭" },
  { iso: "CM", name: "Cameroon", dialCode: "+237", flag: "🇨🇲" },
  { iso: "CA", name: "Canada", dialCode: "+1", flag: "🇨🇦" },
  { iso: "CV", name: "Cape Verde", dialCode: "+238", flag: "🇨🇻" },
  { iso: "KY", name: "Cayman Islands", dialCode: "+1345", flag: "🇰🇾" },
  { iso: "CF", name: "Central African Republic", dialCode: "+236", flag: "🇨🇫" },
  { iso: "TD", name: "Chad", dialCode: "+235", flag: "🇹🇩" },
  { iso: "CL", name: "Chile", dialCode: "+56", flag: "🇨🇱" },
  { iso: "CN", name: "China", dialCode: "+86", flag: "🇨🇳" },
  { iso: "CX", name: "Christmas Island", dialCode: "+61", flag: "🇨🇽" },
  { iso: "CC", name: "Cocos Islands", dialCode: "+61", flag: "🇨🇨" },
  { iso: "CO", name: "Colombia", dialCode: "+57", flag: "🇨🇴" },
  { iso: "KM", name: "Comoros", dialCode: "+269", flag: "🇰🇲" },
  { iso: "CK", name: "Cook Islands", dialCode: "+682", flag: "🇨🇰" },
  { iso: "CR", name: "Costa Rica", dialCode: "+506", flag: "🇨🇷" },
  { iso: "HR", name: "Croatia", dialCode: "+385", flag: "🇭🇷" },
  { iso: "CU", name: "Cuba", dialCode: "+53", flag: "🇨🇺" },
  { iso: "CW", name: "Curaçao", dialCode: "+599", flag: "🇨🇼" },
  { iso: "CY", name: "Cyprus", dialCode: "+357", flag: "🇨🇾" },
  { iso: "CZ", name: "Czechia", dialCode: "+420", flag: "🇨🇿" },
  { iso: "CD", name: "DR Congo", dialCode: "+243", flag: "🇨🇩" },
  { iso: "DK", name: "Denmark", dialCode: "+45", flag: "🇩🇰" },
  { iso: "DJ", name: "Djibouti", dialCode: "+253", flag: "🇩🇯" },
  { iso: "DM", name: "Dominica", dialCode: "+1767", flag: "🇩🇲" },
  { iso: "DO", name: "Dominican Republic", dialCode: "+1", flag: "🇩🇴" },
  { iso: "EC", name: "Ecuador", dialCode: "+593", flag: "🇪🇨" },
  { iso: "EG", name: "Egypt", dialCode: "+20", flag: "🇪🇬" },
  { iso: "SV", name: "El Salvador", dialCode: "+503", flag: "🇸🇻" },
  { iso: "GQ", name: "Equatorial Guinea", dialCode: "+240", flag: "🇬🇶" },
  { iso: "ER", name: "Eritrea", dialCode: "+291", flag: "🇪🇷" },
  { iso: "EE", name: "Estonia", dialCode: "+372", flag: "🇪🇪" },
  { iso: "SZ", name: "Eswatini", dialCode: "+268", flag: "🇸🇿" },
  { iso: "ET", name: "Ethiopia", dialCode: "+251", flag: "🇪🇹" },
  { iso: "FK", name: "Falkland Islands", dialCode: "+500", flag: "🇫🇰" },
  { iso: "FO", name: "Faroe Islands", dialCode: "+298", flag: "🇫🇴" },
  { iso: "FJ", name: "Fiji", dialCode: "+679", flag: "🇫🇯" },
  { iso: "FI", name: "Finland", dialCode: "+358", flag: "🇫🇮" },
  { iso: "FR", name: "France", dialCode: "+33", flag: "🇫🇷" },
  { iso: "GF", name: "French Guiana", dialCode: "+594", flag: "🇬🇫" },
  { iso: "PF", name: "French Polynesia", dialCode: "+689", flag: "🇵🇫" },
  { iso: "GA", name: "Gabon", dialCode: "+241", flag: "🇬🇦" },
  { iso: "GM", name: "Gambia", dialCode: "+220", flag: "🇬🇲" },
  { iso: "GE", name: "Georgia", dialCode: "+995", flag: "🇬🇪" },
  { iso: "DE", name: "Germany", dialCode: "+49", flag: "🇩🇪" },
  { iso: "GH", name: "Ghana", dialCode: "+233", flag: "🇬🇭" },
  { iso: "GI", name: "Gibraltar", dialCode: "+350", flag: "🇬🇮" },
  { iso: "GR", name: "Greece", dialCode: "+30", flag: "🇬🇷" },
  { iso: "GL", name: "Greenland", dialCode: "+299", flag: "🇬🇱" },
  { iso: "GD", name: "Grenada", dialCode: "+1473", flag: "🇬🇩" },
  { iso: "GP", name: "Guadeloupe", dialCode: "+590", flag: "🇬🇵" },
  { iso: "GU", name: "Guam", dialCode: "+1671", flag: "🇬🇺" },
  { iso: "GT", name: "Guatemala", dialCode: "+502", flag: "🇬🇹" },
  { iso: "GG", name: "Guernsey", dialCode: "+44", flag: "🇬🇬" },
  { iso: "GN", name: "Guinea", dialCode: "+224", flag: "🇬🇳" },
  { iso: "GW", name: "Guinea-Bissau", dialCode: "+245", flag: "🇬🇼" },
  { iso: "GY", name: "Guyana", dialCode: "+592", flag: "🇬🇾" },
  { iso: "HT", name: "Haiti", dialCode: "+509", flag: "🇭🇹" },
  { iso: "HN", name: "Honduras", dialCode: "+504", flag: "🇭🇳" },
  { iso: "HK", name: "Hong Kong", dialCode: "+852", flag: "🇭🇰" },
  { iso: "HU", name: "Hungary", dialCode: "+36", flag: "🇭🇺" },
  { iso: "IS", name: "Iceland", dialCode: "+354", flag: "🇮🇸" },
  { iso: "IN", name: "India", dialCode: "+91", flag: "🇮🇳" },
  { iso: "ID", name: "Indonesia", dialCode: "+62", flag: "🇮🇩" },
  { iso: "IR", name: "Iran", dialCode: "+98", flag: "🇮🇷" },
  { iso: "IQ", name: "Iraq", dialCode: "+964", flag: "🇮🇶" },
  { iso: "IE", name: "Ireland", dialCode: "+353", flag: "🇮🇪" },
  { iso: "IM", name: "Isle of Man", dialCode: "+44", flag: "🇮🇲" },
  { iso: "IL", name: "Israel", dialCode: "+972", flag: "🇮🇱" },
  { iso: "IT", name: "Italy", dialCode: "+39", flag: "🇮🇹" },
  { iso: "CI", name: "Ivory Coast", dialCode: "+225", flag: "🇨🇮" },
  { iso: "JM", name: "Jamaica", dialCode: "+1876", flag: "🇯🇲" },
  { iso: "JP", name: "Japan", dialCode: "+81", flag: "🇯🇵" },
  { iso: "JE", name: "Jersey", dialCode: "+44", flag: "🇯🇪" },
  { iso: "JO", name: "Jordan", dialCode: "+962", flag: "🇯🇴" },
  { iso: "KZ", name: "Kazakhstan", dialCode: "+7", flag: "🇰🇿" },
  { iso: "KE", name: "Kenya", dialCode: "+254", flag: "🇰🇪" },
  { iso: "KI", name: "Kiribati", dialCode: "+686", flag: "🇰🇮" },
  { iso: "XK", name: "Kosovo", dialCode: "+383", flag: "🇽🇰" },
  { iso: "KW", name: "Kuwait", dialCode: "+965", flag: "🇰🇼" },
  { iso: "KG", name: "Kyrgyzstan", dialCode: "+996", flag: "🇰🇬" },
  { iso: "LA", name: "Laos", dialCode: "+856", flag: "🇱🇦" },
  { iso: "LV", name: "Latvia", dialCode: "+371", flag: "🇱🇻" },
  { iso: "LB", name: "Lebanon", dialCode: "+961", flag: "🇱🇧" },
  { iso: "LS", name: "Lesotho", dialCode: "+266", flag: "🇱🇸" },
  { iso: "LR", name: "Liberia", dialCode: "+231", flag: "🇱🇷" },
  { iso: "LY", name: "Libya", dialCode: "+218", flag: "🇱🇾" },
  { iso: "LI", name: "Liechtenstein", dialCode: "+423", flag: "🇱🇮" },
  { iso: "LT", name: "Lithuania", dialCode: "+370", flag: "🇱🇹" },
  { iso: "LU", name: "Luxembourg", dialCode: "+352", flag: "🇱🇺" },
  { iso: "MO", name: "Macao", dialCode: "+853", flag: "🇲🇴" },
  { iso: "MG", name: "Madagascar", dialCode: "+261", flag: "🇲🇬" },
  { iso: "MW", name: "Malawi", dialCode: "+265", flag: "🇲🇼" },
  { iso: "MY", name: "Malaysia", dialCode: "+60", flag: "🇲🇾" },
  { iso: "MV", name: "Maldives", dialCode: "+960", flag: "🇲🇻" },
  { iso: "ML", name: "Mali", dialCode: "+223", flag: "🇲🇱" },
  { iso: "MT", name: "Malta", dialCode: "+356", flag: "🇲🇹" },
  { iso: "MH", name: "Marshall Islands", dialCode: "+692", flag: "🇲🇭" },
  { iso: "MQ", name: "Martinique", dialCode: "+596", flag: "🇲🇶" },
  { iso: "MR", name: "Mauritania", dialCode: "+222", flag: "🇲🇷" },
  { iso: "MU", name: "Mauritius", dialCode: "+230", flag: "🇲🇺" },
  { iso: "YT", name: "Mayotte", dialCode: "+262", flag: "🇾🇹" },
  { iso: "MX", name: "Mexico", dialCode: "+52", flag: "🇲🇽" },
  { iso: "FM", name: "Micronesia", dialCode: "+691", flag: "🇫🇲" },
  { iso: "MD", name: "Moldova", dialCode: "+373", flag: "🇲🇩" },
  { iso: "MC", name: "Monaco", dialCode: "+377", flag: "🇲🇨" },
  { iso: "MN", name: "Mongolia", dialCode: "+976", flag: "🇲🇳" },
  { iso: "ME", name: "Montenegro", dialCode: "+382", flag: "🇲🇪" },
  { iso: "MS", name: "Montserrat", dialCode: "+1664", flag: "🇲🇸" },
  { iso: "MA", name: "Morocco", dialCode: "+212", flag: "🇲🇦" },
  { iso: "MZ", name: "Mozambique", dialCode: "+258", flag: "🇲🇿" },
  { iso: "MM", name: "Myanmar", dialCode: "+95", flag: "🇲🇲" },
  { iso: "NA", name: "Namibia", dialCode: "+264", flag: "🇳🇦" },
  { iso: "NR", name: "Nauru", dialCode: "+674", flag: "🇳🇷" },
  { iso: "NP", name: "Nepal", dialCode: "+977", flag: "🇳🇵" },
  { iso: "NL", name: "Netherlands", dialCode: "+31", flag: "🇳🇱" },
  { iso: "NC", name: "New Caledonia", dialCode: "+687", flag: "🇳🇨" },
  { iso: "NZ", name: "New Zealand", dialCode: "+64", flag: "🇳🇿" },
  { iso: "NI", name: "Nicaragua", dialCode: "+505", flag: "🇳🇮" },
  { iso: "NE", name: "Niger", dialCode: "+227", flag: "🇳🇪" },
  { iso: "NG", name: "Nigeria", dialCode: "+234", flag: "🇳🇬" },
  { iso: "NU", name: "Niue", dialCode: "+683", flag: "🇳🇺" },
  { iso: "NF", name: "Norfolk Island", dialCode: "+672", flag: "🇳🇫" },
  { iso: "KP", name: "North Korea", dialCode: "+850", flag: "🇰🇵" },
  { iso: "MK", name: "North Macedonia", dialCode: "+389", flag: "🇲🇰" },
  { iso: "MP", name: "Northern Mariana Islands", dialCode: "+1670", flag: "🇲🇵" },
  { iso: "NO", name: "Norway", dialCode: "+47", flag: "🇳🇴" },
  { iso: "OM", name: "Oman", dialCode: "+968", flag: "🇴🇲" },
  { iso: "PK", name: "Pakistan", dialCode: "+92", flag: "🇵🇰" },
  { iso: "PW", name: "Palau", dialCode: "+680", flag: "🇵🇼" },
  { iso: "PS", name: "Palestine", dialCode: "+970", flag: "🇵🇸" },
  { iso: "PA", name: "Panama", dialCode: "+507", flag: "🇵🇦" },
  { iso: "PG", name: "Papua New Guinea", dialCode: "+675", flag: "🇵🇬" },
  { iso: "PY", name: "Paraguay", dialCode: "+595", flag: "🇵🇾" },
  { iso: "PE", name: "Peru", dialCode: "+51", flag: "🇵🇪" },
  { iso: "PH", name: "Philippines", dialCode: "+63", flag: "🇵🇭" },
  { iso: "PL", name: "Poland", dialCode: "+48", flag: "🇵🇱" },
  { iso: "PT", name: "Portugal", dialCode: "+351", flag: "🇵🇹" },
  { iso: "PR", name: "Puerto Rico", dialCode: "+1", flag: "🇵🇷" },
  { iso: "QA", name: "Qatar", dialCode: "+974", flag: "🇶🇦" },
  { iso: "CG", name: "Republic of the Congo", dialCode: "+242", flag: "🇨🇬" },
  { iso: "RE", name: "Réunion", dialCode: "+262", flag: "🇷🇪" },
  { iso: "RO", name: "Romania", dialCode: "+40", flag: "🇷🇴" },
  { iso: "RU", name: "Russia", dialCode: "+7", flag: "🇷🇺" },
  { iso: "RW", name: "Rwanda", dialCode: "+250", flag: "🇷🇼" },
  { iso: "BL", name: "Saint Barthélemy", dialCode: "+590", flag: "🇧🇱" },
  { iso: "SH", name: "Saint Helena", dialCode: "+290", flag: "🇸🇭" },
  { iso: "KN", name: "Saint Kitts and Nevis", dialCode: "+1869", flag: "🇰🇳" },
  { iso: "LC", name: "Saint Lucia", dialCode: "+1758", flag: "🇱🇨" },
  { iso: "MF", name: "Saint Martin", dialCode: "+590", flag: "🇲🇫" },
  { iso: "PM", name: "Saint Pierre and Miquelon", dialCode: "+508", flag: "🇵🇲" },
  { iso: "VC", name: "Saint Vincent and the Grenadines", dialCode: "+1784", flag: "🇻🇨" },
  { iso: "WS", name: "Samoa", dialCode: "+685", flag: "🇼🇸" },
  { iso: "SM", name: "San Marino", dialCode: "+378", flag: "🇸🇲" },
  { iso: "ST", name: "Sao Tome and Principe", dialCode: "+239", flag: "🇸🇹" },
  { iso: "SA", name: "Saudi Arabia", dialCode: "+966", flag: "🇸🇦" },
  { iso: "SN", name: "Senegal", dialCode: "+221", flag: "🇸🇳" },
  { iso: "RS", name: "Serbia", dialCode: "+381", flag: "🇷🇸" },
  { iso: "SC", name: "Seychelles", dialCode: "+248", flag: "🇸🇨" },
  { iso: "SL", name: "Sierra Leone", dialCode: "+232", flag: "🇸🇱" },
  { iso: "SG", name: "Singapore", dialCode: "+65", flag: "🇸🇬" },
  { iso: "SX", name: "Sint Maarten", dialCode: "+1721", flag: "🇸🇽" },
  { iso: "SK", name: "Slovakia", dialCode: "+421", flag: "🇸🇰" },
  { iso: "SI", name: "Slovenia", dialCode: "+386", flag: "🇸🇮" },
  { iso: "SB", name: "Solomon Islands", dialCode: "+677", flag: "🇸🇧" },
  { iso: "SO", name: "Somalia", dialCode: "+252", flag: "🇸🇴" },
  { iso: "ZA", name: "South Africa", dialCode: "+27", flag: "🇿🇦" },
  { iso: "KR", name: "South Korea", dialCode: "+82", flag: "🇰🇷" },
  { iso: "SS", name: "South Sudan", dialCode: "+211", flag: "🇸🇸" },
  { iso: "ES", name: "Spain", dialCode: "+34", flag: "🇪🇸" },
  { iso: "LK", name: "Sri Lanka", dialCode: "+94", flag: "🇱🇰" },
  { iso: "SD", name: "Sudan", dialCode: "+249", flag: "🇸🇩" },
  { iso: "SR", name: "Suriname", dialCode: "+597", flag: "🇸🇷" },
  { iso: "SE", name: "Sweden", dialCode: "+46", flag: "🇸🇪" },
  { iso: "CH", name: "Switzerland", dialCode: "+41", flag: "🇨🇭" },
  { iso: "SY", name: "Syria", dialCode: "+963", flag: "🇸🇾" },
  { iso: "TW", name: "Taiwan", dialCode: "+886", flag: "🇹🇼" },
  { iso: "TJ", name: "Tajikistan", dialCode: "+992", flag: "🇹🇯" },
  { iso: "TZ", name: "Tanzania", dialCode: "+255", flag: "🇹🇿" },
  { iso: "TH", name: "Thailand", dialCode: "+66", flag: "🇹🇭" },
  { iso: "TL", name: "Timor-Leste", dialCode: "+670", flag: "🇹🇱" },
  { iso: "TG", name: "Togo", dialCode: "+228", flag: "🇹🇬" },
  { iso: "TK", name: "Tokelau", dialCode: "+690", flag: "🇹🇰" },
  { iso: "TO", name: "Tonga", dialCode: "+676", flag: "🇹🇴" },
  { iso: "TT", name: "Trinidad and Tobago", dialCode: "+1868", flag: "🇹🇹" },
  { iso: "TN", name: "Tunisia", dialCode: "+216", flag: "🇹🇳" },
  { iso: "TR", name: "Turkey", dialCode: "+90", flag: "🇹🇷" },
  { iso: "TM", name: "Turkmenistan", dialCode: "+993", flag: "🇹🇲" },
  { iso: "TC", name: "Turks and Caicos Islands", dialCode: "+1649", flag: "🇹🇨" },
  { iso: "TV", name: "Tuvalu", dialCode: "+688", flag: "🇹🇻" },
  { iso: "UG", name: "Uganda", dialCode: "+256", flag: "🇺🇬" },
  { iso: "UA", name: "Ukraine", dialCode: "+380", flag: "🇺🇦" },
  { iso: "AE", name: "United Arab Emirates", dialCode: "+971", flag: "🇦🇪" },
  { iso: "GB", name: "United Kingdom", dialCode: "+44", flag: "🇬🇧" },
  { iso: "US", name: "United States", dialCode: "+1", flag: "🇺🇸" },
  { iso: "UY", name: "Uruguay", dialCode: "+598", flag: "🇺🇾" },
  { iso: "UZ", name: "Uzbekistan", dialCode: "+998", flag: "🇺🇿" },
  { iso: "VU", name: "Vanuatu", dialCode: "+678", flag: "🇻🇺" },
  { iso: "VA", name: "Vatican City", dialCode: "+39", flag: "🇻🇦" },
  { iso: "VE", name: "Venezuela", dialCode: "+58", flag: "🇻🇪" },
  { iso: "VN", name: "Vietnam", dialCode: "+84", flag: "🇻🇳" },
  { iso: "VI", name: "U.S. Virgin Islands", dialCode: "+1340", flag: "🇻🇮" },
  { iso: "WF", name: "Wallis and Futuna", dialCode: "+681", flag: "🇼🇫" },
  { iso: "EH", name: "Western Sahara", dialCode: "+212", flag: "🇪🇭" },
  { iso: "YE", name: "Yemen", dialCode: "+967", flag: "🇾🇪" },
  { iso: "ZM", name: "Zambia", dialCode: "+260", flag: "🇿🇲" },
  { iso: "ZW", name: "Zimbabwe", dialCode: "+263", flag: "🇿🇼" },
];

// Default country preserved across J-A8-polish — explicit GB lookup so
// alphabetical sort doesn't break the previous behavior (was PHONE_COUNTRIES[0]).
const DEFAULT_PHONE_COUNTRY: PhoneCountry =
  PHONE_COUNTRIES.find((c) => c.iso === "GB") ?? PHONE_COUNTRIES[0];

const findCountryByIso = (iso: string | undefined): PhoneCountry => {
  if (iso === undefined) return DEFAULT_PHONE_COUNTRY;
  const match = PHONE_COUNTRIES.find((c) => c.iso === iso.toUpperCase());
  if (match === undefined) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(`[Input] Unknown defaultCountryIso "${iso}". Falling back to ${DEFAULT_PHONE_COUNTRY.iso}.`);
    }
    return DEFAULT_PHONE_COUNTRY;
  }
  return match;
};

// ---------------------------------------------------------------------------
// Variant behaviour map
// ---------------------------------------------------------------------------

export type InputVariant =
  | "text"
  | "email"
  | "phone"
  | "number"
  | "password"
  | "search";

type VariantBehaviour = Pick<
  TextInputProps,
  "keyboardType" | "autoCapitalize" | "autoComplete" | "autoCorrect"
>;

const VARIANT_BEHAVIOUR: Record<InputVariant, VariantBehaviour> = {
  text: {},
  email: {
    keyboardType: "email-address",
    autoCapitalize: "none",
    autoComplete: "email",
  },
  phone: {
    keyboardType: "phone-pad",
    autoComplete: "tel",
  },
  number: {
    keyboardType: "numeric",
  },
  password: {
    autoComplete: "password",
    autoCapitalize: "none",
  },
  search: {
    autoCorrect: false,
    autoCapitalize: "none",
  },
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface InputProps
  extends Omit<
    TextInputProps,
    | "value"
    | "onChangeText"
    | "keyboardType"
    | "secureTextEntry"
    | "autoCapitalize"
    | "autoComplete"
    | "autoCorrect"
    | "style"
  > {
  value: string;
  onChangeText: (next: string) => void;
  variant?: InputVariant;
  placeholder?: string;
  leadingIcon?: IconName;
  /**
   * Show the trailing clear (×) button when value is non-empty.
   * Ignored on the `password` variant (visual conflict with the eye toggle).
   */
  clearable?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;

  // Phone-only ----------------------------------------------------------
  /** Default country ISO (alpha-2). Defaults to "GB". Phone variant only. */
  defaultCountryIso?: string;
  /** Fires when the user picks a different country. Phone variant only. */
  onCountryChange?: (country: PhoneCountry) => void;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const HEIGHT = 48;
const PADDING_X = 14;
const ICON_SIZE = 18;
const IDLE_BORDER = "rgba(255, 255, 255, 0.12)";
const BACKGROUND = "rgba(255, 255, 255, 0.04)";
const COUNTRY_CHIP_GAP = 8;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PickerSearchInput — internal search bar for the country picker Sheet.
// Composed inline (no recursive use of the main Input component) to keep
// state machinery simple and avoid edge cases in nested Input variants.
// ---------------------------------------------------------------------------

interface PickerSearchInputProps {
  value: string;
  onChangeText: (next: string) => void;
}

const PickerSearchInput: React.FC<PickerSearchInputProps> = ({
  value,
  onChangeText,
}) => {
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={[
        styles.container,
        {
          borderColor: focused ? accent.warm : IDLE_BORDER,
          borderWidth: focused ? 1.5 : 1,
        },
      ]}
    >
      <View style={styles.leadingIcon}>
        <Icon name="search" size={ICON_SIZE} color={textTokens.tertiary} />
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Search country or dial code"
        placeholderTextColor={textTokens.quaternary}
        autoCapitalize="none"
        autoCorrect={false}
        underlineColorAndroid="transparent"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel="Search countries"
        style={[
          styles.input,
          {
            color: textTokens.primary,
            fontSize: typography.body.fontSize,
            fontWeight: typography.body.fontWeight,
            paddingLeft: 0,
            paddingRight: PADDING_X,
          },
          Platform.OS === "android" ? styles.inputAndroid : null,
        ]}
      />
    </View>
  );
};

// ---------------------------------------------------------------------------
// Main Input component
// ---------------------------------------------------------------------------

export const Input: React.FC<InputProps> = ({
  value,
  onChangeText,
  variant = "text",
  placeholder,
  leadingIcon,
  clearable = false,
  disabled = false,
  testID,
  style,
  accessibilityLabel,
  defaultCountryIso,
  onCountryChange,
  onFocus,
  onBlur,
  ...rest
}) => {
  const [focused, setFocused] = useState(false);
  const [secureRevealed, setSecureRevealed] = useState(false);
  const [country, setCountry] = useState<PhoneCountry>(() =>
    findCountryByIso(defaultCountryIso),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState<string>("");

  // Filter the country list as the user types. Matches:
  //   - case-insensitive substring on `name`
  //   - startsWith on `dialCode` (with implicit "+" prefix tolerance)
  const filteredCountries = useMemo<readonly PhoneCountry[]>(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (q.length === 0) return PHONE_COUNTRIES;
    const dialQuery = q.startsWith("+") ? q : `+${q}`;
    return PHONE_COUNTRIES.filter((c) => {
      const nameMatch = c.name.toLowerCase().includes(q);
      const dialMatch = c.dialCode.toLowerCase().startsWith(dialQuery);
      return nameMatch || dialMatch;
    });
  }, [pickerSearch]);

  // Reset search when picker closes so reopening shows the full list.
  useEffect(() => {
    if (!pickerOpen) setPickerSearch("");
  }, [pickerOpen]);

  const behaviour = VARIANT_BEHAVIOUR[variant];
  const isPhone = variant === "phone";
  const isPassword = variant === "password";
  const secureTextEntry = isPassword && !secureRevealed;

  // Phone variant suppresses the generic leadingIcon prop — the chip occupies
  // that slot. For other variants, fall back to the search auto-icon.
  const resolvedLeadingIcon: IconName | undefined = isPhone
    ? undefined
    : leadingIcon ?? (variant === "search" ? "search" : undefined);

  const handleFocus = useCallback(
    (event: TextInputFocusEvent): void => {
      setFocused(true);
      onFocus?.(event);
    },
    [onFocus],
  );

  const handleBlur = useCallback(
    (event: TextInputFocusEvent): void => {
      setFocused(false);
      onBlur?.(event);
    },
    [onBlur],
  );

  const handleClear = useCallback((): void => {
    onChangeText("");
  }, [onChangeText]);

  const handleToggleSecure = useCallback((): void => {
    setSecureRevealed((prev) => !prev);
  }, []);

  const handleOpenPicker = useCallback((): void => {
    if (!disabled) setPickerOpen(true);
  }, [disabled]);

  const handlePickCountry = useCallback(
    (next: PhoneCountry): void => {
      setCountry(next);
      setPickerOpen(false);
      onCountryChange?.(next);
    },
    [onCountryChange],
  );

  const handleClosePicker = useCallback((): void => {
    setPickerOpen(false);
  }, []);

  // Trailing slot priority: password eye > clear button.
  const showPasswordToggle = isPassword && !disabled;
  const showClear = !isPassword && clearable && value.length > 0 && !disabled;

  return (
    <>
      <View
        testID={testID}
        style={[
          styles.container,
          {
            borderColor: focused ? accent.warm : IDLE_BORDER,
            borderWidth: focused ? 1.5 : 1,
            opacity: disabled ? 0.5 : 1,
          },
          style,
        ]}
      >
        {isPhone ? (
          <Pressable
            onPress={handleOpenPicker}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Country: ${country.name}, ${country.dialCode}. Tap to change.`}
            style={styles.countryChip}
          >
            <Text style={styles.countryFlag}>{country.flag}</Text>
            <Icon name="chevD" size={14} color={textTokens.tertiary} />
          </Pressable>
        ) : null}

        {resolvedLeadingIcon !== undefined ? (
          <View style={styles.leadingIcon}>
            <Icon name={resolvedLeadingIcon} size={ICON_SIZE} color={textTokens.tertiary} />
          </View>
        ) : null}

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={textTokens.quaternary}
          editable={!disabled}
          onFocus={handleFocus}
          onBlur={handleBlur}
          secureTextEntry={secureTextEntry}
          underlineColorAndroid="transparent"
          accessibilityLabel={accessibilityLabel ?? placeholder}
          style={[
            styles.input,
            {
              color: textTokens.primary,
              fontSize: typography.body.fontSize,
              fontWeight: typography.body.fontWeight,
              // No `lineHeight` — TextInput on iOS treats lineHeight as
              // line-box height, drifting the text baseline toward the
              // bottom (visible bottom-skew on the text variant). Container
              // already centers via `alignItems: "center"` + height: 100%.
              paddingLeft:
                resolvedLeadingIcon !== undefined ? 0 : PADDING_X,
              paddingRight: showClear || showPasswordToggle ? 0 : PADDING_X,
            },
            Platform.OS === "android"
              ? styles.inputAndroid
              : null,
          ]}
          {...behaviour}
          {...rest}
        />

        {showPasswordToggle ? (
          <Pressable
            onPress={handleToggleSecure}
            accessibilityRole="button"
            accessibilityLabel={secureRevealed ? "Hide password" : "Show password"}
            style={styles.trailingButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon
              name="eye"
              size={ICON_SIZE}
              color={secureRevealed ? textTokens.tertiary : textTokens.primary}
            />
          </Pressable>
        ) : null}

        {showClear ? (
          <Pressable
            onPress={handleClear}
            accessibilityRole="button"
            accessibilityLabel="Clear text"
            style={styles.trailingButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="close" size={ICON_SIZE} color={textTokens.tertiary} />
          </Pressable>
        ) : null}
      </View>

      {isPhone ? (
        <Sheet visible={pickerOpen} onClose={handleClosePicker} snapPoint="full">
          {/*
            Flex-column wrapper guarantees the ScrollView gets remaining
            vertical space after the search bar takes its natural height.
            Sheet's GlassCard padding-wrapper doesn't propagate flex on
            its own (D-IMPL-42 / D-IMPL-44 lesson family from Cycle 1),
            so we make the column explicit here. Without this wrapper
            the country list collapses to 0 height — only search + handle
            visible.
          */}
          <View style={styles.pickerColumn}>
            <View style={styles.pickerSearchWrap}>
              <PickerSearchInput
                value={pickerSearch}
                onChangeText={setPickerSearch}
              />
            </View>
            <ScrollView
              style={styles.pickerScroll}
              contentContainerStyle={styles.pickerScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              {filteredCountries.length === 0 ? (
                <Text style={styles.pickerEmpty}>No matches</Text>
              ) : null}
              {filteredCountries.map((c) => {
              const isSelected = c.iso === country.iso;
              return (
                <Pressable
                  key={c.iso}
                  onPress={() => handlePickCountry(c)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${c.name}, ${c.dialCode}`}
                  style={({ pressed }) => [
                    styles.pickerRow,
                    pressed ? styles.pickerRowPressed : null,
                  ]}
                >
                  <Text style={styles.pickerFlag}>{c.flag}</Text>
                  <View style={styles.pickerLabelCol}>
                    <Text style={styles.pickerName}>{c.name}</Text>
                    <Text style={styles.pickerDialCode}>{c.dialCode}</Text>
                  </View>
                  {isSelected ? (
                    <Icon name="check" size={ICON_SIZE} color={accent.warm} />
                  ) : null}
                </Pressable>
              );
            })}
            </ScrollView>
          </View>
        </Sheet>
      ) : null}
    </>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    height: HEIGHT,
    borderRadius: radiusTokens.sm,
    backgroundColor: BACKGROUND,
    transitionProperty: "border-color",
    transitionDuration: `${durations.fast}ms`,
  } as ViewStyle,
  leadingIcon: {
    paddingLeft: PADDING_X,
    paddingRight: 8,
    height: "100%",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    height: "100%",
    // Neutralise platform default vertical padding on both iOS and Android
    // so placeholder + typed text both vertically center inside the field
    // (relying on the container's `alignItems: "center"` + `height: HEIGHT`).
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  inputAndroid: {
    // Android-specific: kill the EditText font padding that would push text
    // down + force vertical centering even when paddingVertical is 0.
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  trailingButton: {
    paddingLeft: 8,
    paddingRight: PADDING_X - 2,
    height: "100%",
    justifyContent: "center",
  },
  countryChip: {
    flexDirection: "row",
    alignItems: "center",
    height: "100%",
    paddingLeft: PADDING_X,
    paddingRight: COUNTRY_CHIP_GAP,
    gap: 6,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: glass.border.profileBase,
  },
  countryFlag: {
    fontSize: 18,
  },
  pickerColumn: {
    // Explicit flex-column wrapper inside the Sheet — gives the ScrollView
    // room to fill remaining vertical space after the search bar takes its
    // natural height. Without this, ScrollView flex:1 collapses to 0
    // (D-IMPL-42 / D-IMPL-44 lesson — GlassCard padding-wrapper doesn't
    // propagate flex through to children).
    flex: 1,
  },
  pickerSearchWrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  pickerEmpty: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
    textAlign: "center",
    paddingVertical: spacing.lg,
  },
  pickerScroll: {
    flex: 1,
  },
  pickerScrollContent: {
    paddingBottom: spacing.lg,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
    gap: spacing.md,
  },
  pickerRowPressed: {
    backgroundColor: glass.tint.profileBase,
  },
  pickerFlag: {
    fontSize: 22,
  },
  pickerLabelCol: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickerName: {
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
    flex: 1,
  },
  pickerDialCode: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
    marginLeft: spacing.sm,
  },
});

export default Input;
