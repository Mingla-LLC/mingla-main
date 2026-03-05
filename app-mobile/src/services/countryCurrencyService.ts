// Country to Currency mapping service
// Maps countries to their official currencies with region grouping

export interface CountryCurrency {
  countryCode: string;
  countryName: string;
  currencyCode: string;
  currencySymbol: string;
  region: 'africa' | 'europe' | 'north_america' | 'south_america' | 'asia' | 'oceania' | 'middle_east';
}

// Comprehensive list of countries grouped by region
export const countryCurrencies: CountryCurrency[] = [
  // ============ AFRICA ============
  { countryCode: 'DZ', countryName: 'Algeria', currencyCode: 'DZD', currencySymbol: 'د.ج', region: 'africa' },
  { countryCode: 'AO', countryName: 'Angola', currencyCode: 'AOA', currencySymbol: 'Kz', region: 'africa' },
  { countryCode: 'BJ', countryName: 'Benin', currencyCode: 'XOF', currencySymbol: 'CFA', region: 'africa' },
  { countryCode: 'BW', countryName: 'Botswana', currencyCode: 'BWP', currencySymbol: 'P', region: 'africa' },
  { countryCode: 'BF', countryName: 'Burkina Faso', currencyCode: 'XOF', currencySymbol: 'CFA', region: 'africa' },
  { countryCode: 'BI', countryName: 'Burundi', currencyCode: 'BIF', currencySymbol: 'FBu', region: 'africa' },
  { countryCode: 'CM', countryName: 'Cameroon', currencyCode: 'XAF', currencySymbol: 'FCFA', region: 'africa' },
  { countryCode: 'CV', countryName: 'Cape Verde', currencyCode: 'CVE', currencySymbol: '$', region: 'africa' },
  { countryCode: 'CF', countryName: 'Central African Republic', currencyCode: 'XAF', currencySymbol: 'FCFA', region: 'africa' },
  { countryCode: 'TD', countryName: 'Chad', currencyCode: 'XAF', currencySymbol: 'FCFA', region: 'africa' },
  { countryCode: 'KM', countryName: 'Comoros', currencyCode: 'KMF', currencySymbol: 'CF', region: 'africa' },
  { countryCode: 'CD', countryName: 'Congo (DRC)', currencyCode: 'CDF', currencySymbol: 'FC', region: 'africa' },
  { countryCode: 'CG', countryName: 'Congo (Republic)', currencyCode: 'XAF', currencySymbol: 'FCFA', region: 'africa' },
  { countryCode: 'CI', countryName: "Côte d'Ivoire", currencyCode: 'XOF', currencySymbol: 'CFA', region: 'africa' },
  { countryCode: 'DJ', countryName: 'Djibouti', currencyCode: 'DJF', currencySymbol: 'Fdj', region: 'africa' },
  { countryCode: 'EG', countryName: 'Egypt', currencyCode: 'EGP', currencySymbol: '£', region: 'africa' },
  { countryCode: 'GQ', countryName: 'Equatorial Guinea', currencyCode: 'XAF', currencySymbol: 'FCFA', region: 'africa' },
  { countryCode: 'ER', countryName: 'Eritrea', currencyCode: 'ERN', currencySymbol: 'Nfk', region: 'africa' },
  { countryCode: 'SZ', countryName: 'Eswatini', currencyCode: 'SZL', currencySymbol: 'L', region: 'africa' },
  { countryCode: 'ET', countryName: 'Ethiopia', currencyCode: 'ETB', currencySymbol: 'Br', region: 'africa' },
  { countryCode: 'GA', countryName: 'Gabon', currencyCode: 'XAF', currencySymbol: 'FCFA', region: 'africa' },
  { countryCode: 'GM', countryName: 'Gambia', currencyCode: 'GMD', currencySymbol: 'D', region: 'africa' },
  { countryCode: 'GH', countryName: 'Ghana', currencyCode: 'GHS', currencySymbol: '₵', region: 'africa' },
  { countryCode: 'GN', countryName: 'Guinea', currencyCode: 'GNF', currencySymbol: 'FG', region: 'africa' },
  { countryCode: 'GW', countryName: 'Guinea-Bissau', currencyCode: 'XOF', currencySymbol: 'CFA', region: 'africa' },
  { countryCode: 'KE', countryName: 'Kenya', currencyCode: 'KES', currencySymbol: 'KSh', region: 'africa' },
  { countryCode: 'LS', countryName: 'Lesotho', currencyCode: 'LSL', currencySymbol: 'L', region: 'africa' },
  { countryCode: 'LR', countryName: 'Liberia', currencyCode: 'LRD', currencySymbol: 'L$', region: 'africa' },
  { countryCode: 'LY', countryName: 'Libya', currencyCode: 'LYD', currencySymbol: 'ل.د', region: 'africa' },
  { countryCode: 'MG', countryName: 'Madagascar', currencyCode: 'MGA', currencySymbol: 'Ar', region: 'africa' },
  { countryCode: 'MW', countryName: 'Malawi', currencyCode: 'MWK', currencySymbol: 'MK', region: 'africa' },
  { countryCode: 'ML', countryName: 'Mali', currencyCode: 'XOF', currencySymbol: 'CFA', region: 'africa' },
  { countryCode: 'MR', countryName: 'Mauritania', currencyCode: 'MRU', currencySymbol: 'UM', region: 'africa' },
  { countryCode: 'MU', countryName: 'Mauritius', currencyCode: 'MUR', currencySymbol: '₨', region: 'africa' },
  { countryCode: 'MA', countryName: 'Morocco', currencyCode: 'MAD', currencySymbol: 'د.م.', region: 'africa' },
  { countryCode: 'MZ', countryName: 'Mozambique', currencyCode: 'MZN', currencySymbol: 'MT', region: 'africa' },
  { countryCode: 'NA', countryName: 'Namibia', currencyCode: 'NAD', currencySymbol: 'N$', region: 'africa' },
  { countryCode: 'NE', countryName: 'Niger', currencyCode: 'XOF', currencySymbol: 'CFA', region: 'africa' },
  { countryCode: 'NG', countryName: 'Nigeria', currencyCode: 'NGN', currencySymbol: '₦', region: 'africa' },
  { countryCode: 'RW', countryName: 'Rwanda', currencyCode: 'RWF', currencySymbol: 'RF', region: 'africa' },
  { countryCode: 'ST', countryName: 'São Tomé and Príncipe', currencyCode: 'STN', currencySymbol: 'Db', region: 'africa' },
  { countryCode: 'SN', countryName: 'Senegal', currencyCode: 'XOF', currencySymbol: 'CFA', region: 'africa' },
  { countryCode: 'SC', countryName: 'Seychelles', currencyCode: 'SCR', currencySymbol: '₨', region: 'africa' },
  { countryCode: 'SL', countryName: 'Sierra Leone', currencyCode: 'SLL', currencySymbol: 'Le', region: 'africa' },
  { countryCode: 'SO', countryName: 'Somalia', currencyCode: 'SOS', currencySymbol: 'Sh', region: 'africa' },
  { countryCode: 'ZA', countryName: 'South Africa', currencyCode: 'ZAR', currencySymbol: 'R', region: 'africa' },
  { countryCode: 'SS', countryName: 'South Sudan', currencyCode: 'SSP', currencySymbol: '£', region: 'africa' },
  { countryCode: 'SD', countryName: 'Sudan', currencyCode: 'SDG', currencySymbol: '£', region: 'africa' },
  { countryCode: 'TZ', countryName: 'Tanzania', currencyCode: 'TZS', currencySymbol: 'TSh', region: 'africa' },
  { countryCode: 'TG', countryName: 'Togo', currencyCode: 'XOF', currencySymbol: 'CFA', region: 'africa' },
  { countryCode: 'TN', countryName: 'Tunisia', currencyCode: 'TND', currencySymbol: 'د.ت', region: 'africa' },
  { countryCode: 'UG', countryName: 'Uganda', currencyCode: 'UGX', currencySymbol: 'USh', region: 'africa' },
  { countryCode: 'ZM', countryName: 'Zambia', currencyCode: 'ZMW', currencySymbol: 'ZK', region: 'africa' },
  { countryCode: 'ZW', countryName: 'Zimbabwe', currencyCode: 'ZWL', currencySymbol: 'Z$', region: 'africa' },

  // ============ EUROPE ============
  { countryCode: 'AL', countryName: 'Albania', currencyCode: 'ALL', currencySymbol: 'L', region: 'europe' },
  { countryCode: 'AD', countryName: 'Andorra', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'AT', countryName: 'Austria', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'BY', countryName: 'Belarus', currencyCode: 'BYN', currencySymbol: 'Br', region: 'europe' },
  { countryCode: 'BE', countryName: 'Belgium', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'BA', countryName: 'Bosnia and Herzegovina', currencyCode: 'BAM', currencySymbol: 'KM', region: 'europe' },
  { countryCode: 'BG', countryName: 'Bulgaria', currencyCode: 'BGN', currencySymbol: 'лв', region: 'europe' },
  { countryCode: 'HR', countryName: 'Croatia', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'CY', countryName: 'Cyprus', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'CZ', countryName: 'Czech Republic', currencyCode: 'CZK', currencySymbol: 'Kč', region: 'europe' },
  { countryCode: 'DK', countryName: 'Denmark', currencyCode: 'DKK', currencySymbol: 'kr', region: 'europe' },
  { countryCode: 'EE', countryName: 'Estonia', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'FI', countryName: 'Finland', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'FR', countryName: 'France', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'DE', countryName: 'Germany', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'GR', countryName: 'Greece', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'HU', countryName: 'Hungary', currencyCode: 'HUF', currencySymbol: 'Ft', region: 'europe' },
  { countryCode: 'IS', countryName: 'Iceland', currencyCode: 'ISK', currencySymbol: 'kr', region: 'europe' },
  { countryCode: 'IE', countryName: 'Ireland', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'IT', countryName: 'Italy', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'LV', countryName: 'Latvia', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'LI', countryName: 'Liechtenstein', currencyCode: 'CHF', currencySymbol: 'CHF', region: 'europe' },
  { countryCode: 'LT', countryName: 'Lithuania', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'LU', countryName: 'Luxembourg', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'MT', countryName: 'Malta', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'MD', countryName: 'Moldova', currencyCode: 'MDL', currencySymbol: 'L', region: 'europe' },
  { countryCode: 'MC', countryName: 'Monaco', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'ME', countryName: 'Montenegro', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'NL', countryName: 'Netherlands', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'MK', countryName: 'North Macedonia', currencyCode: 'MKD', currencySymbol: 'ден', region: 'europe' },
  { countryCode: 'NO', countryName: 'Norway', currencyCode: 'NOK', currencySymbol: 'kr', region: 'europe' },
  { countryCode: 'PL', countryName: 'Poland', currencyCode: 'PLN', currencySymbol: 'zł', region: 'europe' },
  { countryCode: 'PT', countryName: 'Portugal', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'RO', countryName: 'Romania', currencyCode: 'RON', currencySymbol: 'lei', region: 'europe' },
  { countryCode: 'RU', countryName: 'Russia', currencyCode: 'RUB', currencySymbol: '₽', region: 'europe' },
  { countryCode: 'SM', countryName: 'San Marino', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'RS', countryName: 'Serbia', currencyCode: 'RSD', currencySymbol: 'дин', region: 'europe' },
  { countryCode: 'SK', countryName: 'Slovakia', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'SI', countryName: 'Slovenia', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'ES', countryName: 'Spain', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },
  { countryCode: 'SE', countryName: 'Sweden', currencyCode: 'SEK', currencySymbol: 'kr', region: 'europe' },
  { countryCode: 'CH', countryName: 'Switzerland', currencyCode: 'CHF', currencySymbol: 'CHF', region: 'europe' },
  { countryCode: 'UA', countryName: 'Ukraine', currencyCode: 'UAH', currencySymbol: '₴', region: 'europe' },
  { countryCode: 'GB', countryName: 'United Kingdom', currencyCode: 'GBP', currencySymbol: '£', region: 'europe' },
  { countryCode: 'VA', countryName: 'Vatican City', currencyCode: 'EUR', currencySymbol: '€', region: 'europe' },

  // ============ NORTH AMERICA ============
  { countryCode: 'AG', countryName: 'Antigua and Barbuda', currencyCode: 'XCD', currencySymbol: '$', region: 'north_america' },
  { countryCode: 'BS', countryName: 'Bahamas', currencyCode: 'BSD', currencySymbol: '$', region: 'north_america' },
  { countryCode: 'BB', countryName: 'Barbados', currencyCode: 'BBD', currencySymbol: '$', region: 'north_america' },
  { countryCode: 'BZ', countryName: 'Belize', currencyCode: 'BZD', currencySymbol: '$', region: 'north_america' },
  { countryCode: 'CA', countryName: 'Canada', currencyCode: 'CAD', currencySymbol: 'C$', region: 'north_america' },
  { countryCode: 'CR', countryName: 'Costa Rica', currencyCode: 'CRC', currencySymbol: '₡', region: 'north_america' },
  { countryCode: 'CU', countryName: 'Cuba', currencyCode: 'CUP', currencySymbol: '$', region: 'north_america' },
  { countryCode: 'DM', countryName: 'Dominica', currencyCode: 'XCD', currencySymbol: '$', region: 'north_america' },
  { countryCode: 'DO', countryName: 'Dominican Republic', currencyCode: 'DOP', currencySymbol: 'RD$', region: 'north_america' },
  { countryCode: 'SV', countryName: 'El Salvador', currencyCode: 'USD', currencySymbol: '$', region: 'north_america' },
  { countryCode: 'GD', countryName: 'Grenada', currencyCode: 'XCD', currencySymbol: '$', region: 'north_america' },
  { countryCode: 'GT', countryName: 'Guatemala', currencyCode: 'GTQ', currencySymbol: 'Q', region: 'north_america' },
  { countryCode: 'HT', countryName: 'Haiti', currencyCode: 'HTG', currencySymbol: 'G', region: 'north_america' },
  { countryCode: 'HN', countryName: 'Honduras', currencyCode: 'HNL', currencySymbol: 'L', region: 'north_america' },
  { countryCode: 'JM', countryName: 'Jamaica', currencyCode: 'JMD', currencySymbol: 'J$', region: 'north_america' },
  { countryCode: 'MX', countryName: 'Mexico', currencyCode: 'MXN', currencySymbol: '$', region: 'north_america' },
  { countryCode: 'NI', countryName: 'Nicaragua', currencyCode: 'NIO', currencySymbol: 'C$', region: 'north_america' },
  { countryCode: 'PA', countryName: 'Panama', currencyCode: 'PAB', currencySymbol: 'B/.', region: 'north_america' },
  { countryCode: 'KN', countryName: 'Saint Kitts and Nevis', currencyCode: 'XCD', currencySymbol: '$', region: 'north_america' },
  { countryCode: 'LC', countryName: 'Saint Lucia', currencyCode: 'XCD', currencySymbol: '$', region: 'north_america' },
  { countryCode: 'VC', countryName: 'Saint Vincent and Grenadines', currencyCode: 'XCD', currencySymbol: '$', region: 'north_america' },
  { countryCode: 'TT', countryName: 'Trinidad and Tobago', currencyCode: 'TTD', currencySymbol: 'TT$', region: 'north_america' },
  { countryCode: 'US', countryName: 'United States', currencyCode: 'USD', currencySymbol: '$', region: 'north_america' },

  // ============ SOUTH AMERICA ============
  { countryCode: 'AR', countryName: 'Argentina', currencyCode: 'ARS', currencySymbol: '$', region: 'south_america' },
  { countryCode: 'BO', countryName: 'Bolivia', currencyCode: 'BOB', currencySymbol: 'Bs.', region: 'south_america' },
  { countryCode: 'BR', countryName: 'Brazil', currencyCode: 'BRL', currencySymbol: 'R$', region: 'south_america' },
  { countryCode: 'CL', countryName: 'Chile', currencyCode: 'CLP', currencySymbol: '$', region: 'south_america' },
  { countryCode: 'CO', countryName: 'Colombia', currencyCode: 'COP', currencySymbol: '$', region: 'south_america' },
  { countryCode: 'EC', countryName: 'Ecuador', currencyCode: 'USD', currencySymbol: '$', region: 'south_america' },
  { countryCode: 'GY', countryName: 'Guyana', currencyCode: 'GYD', currencySymbol: '$', region: 'south_america' },
  { countryCode: 'PY', countryName: 'Paraguay', currencyCode: 'PYG', currencySymbol: '₲', region: 'south_america' },
  { countryCode: 'PE', countryName: 'Peru', currencyCode: 'PEN', currencySymbol: 'S/', region: 'south_america' },
  { countryCode: 'SR', countryName: 'Suriname', currencyCode: 'SRD', currencySymbol: '$', region: 'south_america' },
  { countryCode: 'UY', countryName: 'Uruguay', currencyCode: 'UYU', currencySymbol: '$U', region: 'south_america' },
  { countryCode: 'VE', countryName: 'Venezuela', currencyCode: 'VES', currencySymbol: 'Bs.', region: 'south_america' },

  // ============ ASIA ============
  { countryCode: 'AF', countryName: 'Afghanistan', currencyCode: 'AFN', currencySymbol: '؋', region: 'asia' },
  { countryCode: 'AM', countryName: 'Armenia', currencyCode: 'AMD', currencySymbol: '֏', region: 'asia' },
  { countryCode: 'AZ', countryName: 'Azerbaijan', currencyCode: 'AZN', currencySymbol: '₼', region: 'asia' },
  { countryCode: 'BD', countryName: 'Bangladesh', currencyCode: 'BDT', currencySymbol: '৳', region: 'asia' },
  { countryCode: 'BT', countryName: 'Bhutan', currencyCode: 'BTN', currencySymbol: 'Nu.', region: 'asia' },
  { countryCode: 'BN', countryName: 'Brunei', currencyCode: 'BND', currencySymbol: '$', region: 'asia' },
  { countryCode: 'KH', countryName: 'Cambodia', currencyCode: 'KHR', currencySymbol: '៛', region: 'asia' },
  { countryCode: 'CN', countryName: 'China', currencyCode: 'CNY', currencySymbol: '¥', region: 'asia' },
  { countryCode: 'GE', countryName: 'Georgia', currencyCode: 'GEL', currencySymbol: '₾', region: 'asia' },
  { countryCode: 'HK', countryName: 'Hong Kong', currencyCode: 'HKD', currencySymbol: 'HK$', region: 'asia' },
  { countryCode: 'IN', countryName: 'India', currencyCode: 'INR', currencySymbol: '₹', region: 'asia' },
  { countryCode: 'ID', countryName: 'Indonesia', currencyCode: 'IDR', currencySymbol: 'Rp', region: 'asia' },
  { countryCode: 'JP', countryName: 'Japan', currencyCode: 'JPY', currencySymbol: '¥', region: 'asia' },
  { countryCode: 'KZ', countryName: 'Kazakhstan', currencyCode: 'KZT', currencySymbol: '₸', region: 'asia' },
  { countryCode: 'KG', countryName: 'Kyrgyzstan', currencyCode: 'KGS', currencySymbol: 'с', region: 'asia' },
  { countryCode: 'LA', countryName: 'Laos', currencyCode: 'LAK', currencySymbol: '₭', region: 'asia' },
  { countryCode: 'MO', countryName: 'Macau', currencyCode: 'MOP', currencySymbol: 'MOP$', region: 'asia' },
  { countryCode: 'MY', countryName: 'Malaysia', currencyCode: 'MYR', currencySymbol: 'RM', region: 'asia' },
  { countryCode: 'MV', countryName: 'Maldives', currencyCode: 'MVR', currencySymbol: 'Rf', region: 'asia' },
  { countryCode: 'MN', countryName: 'Mongolia', currencyCode: 'MNT', currencySymbol: '₮', region: 'asia' },
  { countryCode: 'MM', countryName: 'Myanmar', currencyCode: 'MMK', currencySymbol: 'K', region: 'asia' },
  { countryCode: 'NP', countryName: 'Nepal', currencyCode: 'NPR', currencySymbol: '₨', region: 'asia' },
  { countryCode: 'KP', countryName: 'North Korea', currencyCode: 'KPW', currencySymbol: '₩', region: 'asia' },
  { countryCode: 'PK', countryName: 'Pakistan', currencyCode: 'PKR', currencySymbol: '₨', region: 'asia' },
  { countryCode: 'PH', countryName: 'Philippines', currencyCode: 'PHP', currencySymbol: '₱', region: 'asia' },
  { countryCode: 'SG', countryName: 'Singapore', currencyCode: 'SGD', currencySymbol: 'S$', region: 'asia' },
  { countryCode: 'KR', countryName: 'South Korea', currencyCode: 'KRW', currencySymbol: '₩', region: 'asia' },
  { countryCode: 'LK', countryName: 'Sri Lanka', currencyCode: 'LKR', currencySymbol: '₨', region: 'asia' },
  { countryCode: 'TW', countryName: 'Taiwan', currencyCode: 'TWD', currencySymbol: 'NT$', region: 'asia' },
  { countryCode: 'TJ', countryName: 'Tajikistan', currencyCode: 'TJS', currencySymbol: 'SM', region: 'asia' },
  { countryCode: 'TH', countryName: 'Thailand', currencyCode: 'THB', currencySymbol: '฿', region: 'asia' },
  { countryCode: 'TL', countryName: 'Timor-Leste', currencyCode: 'USD', currencySymbol: '$', region: 'asia' },
  { countryCode: 'TM', countryName: 'Turkmenistan', currencyCode: 'TMT', currencySymbol: 'm', region: 'asia' },
  { countryCode: 'UZ', countryName: 'Uzbekistan', currencyCode: 'UZS', currencySymbol: 'сўм', region: 'asia' },
  { countryCode: 'VN', countryName: 'Vietnam', currencyCode: 'VND', currencySymbol: '₫', region: 'asia' },

  // ============ MIDDLE EAST ============
  { countryCode: 'BH', countryName: 'Bahrain', currencyCode: 'BHD', currencySymbol: '.د.ب', region: 'middle_east' },
  { countryCode: 'IR', countryName: 'Iran', currencyCode: 'IRR', currencySymbol: '﷼', region: 'middle_east' },
  { countryCode: 'IQ', countryName: 'Iraq', currencyCode: 'IQD', currencySymbol: 'ع.د', region: 'middle_east' },
  { countryCode: 'IL', countryName: 'Israel', currencyCode: 'ILS', currencySymbol: '₪', region: 'middle_east' },
  { countryCode: 'JO', countryName: 'Jordan', currencyCode: 'JOD', currencySymbol: 'د.ا', region: 'middle_east' },
  { countryCode: 'KW', countryName: 'Kuwait', currencyCode: 'KWD', currencySymbol: 'د.ك', region: 'middle_east' },
  { countryCode: 'LB', countryName: 'Lebanon', currencyCode: 'LBP', currencySymbol: 'ل.ل', region: 'middle_east' },
  { countryCode: 'OM', countryName: 'Oman', currencyCode: 'OMR', currencySymbol: 'ر.ع.', region: 'middle_east' },
  { countryCode: 'PS', countryName: 'Palestine', currencyCode: 'ILS', currencySymbol: '₪', region: 'middle_east' },
  { countryCode: 'QA', countryName: 'Qatar', currencyCode: 'QAR', currencySymbol: 'ر.ق', region: 'middle_east' },
  { countryCode: 'SA', countryName: 'Saudi Arabia', currencyCode: 'SAR', currencySymbol: 'ر.س', region: 'middle_east' },
  { countryCode: 'SY', countryName: 'Syria', currencyCode: 'SYP', currencySymbol: '£', region: 'middle_east' },
  { countryCode: 'TR', countryName: 'Turkey', currencyCode: 'TRY', currencySymbol: '₺', region: 'middle_east' },
  { countryCode: 'AE', countryName: 'United Arab Emirates', currencyCode: 'AED', currencySymbol: 'د.إ', region: 'middle_east' },
  { countryCode: 'YE', countryName: 'Yemen', currencyCode: 'YER', currencySymbol: '﷼', region: 'middle_east' },

  // ============ OCEANIA ============
  { countryCode: 'AU', countryName: 'Australia', currencyCode: 'AUD', currencySymbol: 'A$', region: 'oceania' },
  { countryCode: 'FJ', countryName: 'Fiji', currencyCode: 'FJD', currencySymbol: '$', region: 'oceania' },
  { countryCode: 'NZ', countryName: 'New Zealand', currencyCode: 'NZD', currencySymbol: 'NZ$', region: 'oceania' },
  { countryCode: 'PG', countryName: 'Papua New Guinea', currencyCode: 'PGK', currencySymbol: 'K', region: 'oceania' },
  { countryCode: 'WS', countryName: 'Samoa', currencyCode: 'WST', currencySymbol: 'T', region: 'oceania' },
  { countryCode: 'SB', countryName: 'Solomon Islands', currencyCode: 'SBD', currencySymbol: '$', region: 'oceania' },
  { countryCode: 'TO', countryName: 'Tonga', currencyCode: 'TOP', currencySymbol: 'T$', region: 'oceania' },
  { countryCode: 'VU', countryName: 'Vanuatu', currencyCode: 'VUV', currencySymbol: 'VT', region: 'oceania' },
];

// Get region display name
export const regionDisplayNames: Record<string, string> = {
  'north_america': 'North America',
  'south_america': 'South America',
  'europe': 'Europe',
  'africa': 'Africa',
  'asia': 'Asia',
  'middle_east': 'Middle East',
  'oceania': 'Oceania',
};

// Get countries grouped by region
export function getCountriesByRegion(): Record<string, CountryCurrency[]> {
  const grouped: Record<string, CountryCurrency[]> = {};
  
  for (const country of countryCurrencies) {
    if (!grouped[country.region]) {
      grouped[country.region] = [];
    }
    grouped[country.region].push(country);
  }
  
  // Sort countries alphabetically within each region
  for (const region of Object.keys(grouped)) {
    grouped[region].sort((a, b) => a.countryName.localeCompare(b.countryName));
  }
  
  return grouped;
}

// Get currency by country code
export function getCurrencyByCountryCode(countryCode: string): CountryCurrency | undefined {
  return countryCurrencies.find(c => c.countryCode.toUpperCase() === countryCode.toUpperCase());
}

// Get currency by currency code
export function getCountryByCurrencyCode(currencyCode: string): CountryCurrency | undefined {
  return countryCurrencies.find(c => c.currencyCode === currencyCode);
}

// Get all unique currency codes
export function getAllCurrencyCodes(): string[] {
  const codes = new Set(countryCurrencies.map(c => c.currencyCode));
  return Array.from(codes).sort();
}

// Default country code to currency code mapping for quick lookups
export const countryToCurrencyMap: Record<string, string> = countryCurrencies.reduce((acc, c) => {
  acc[c.countryCode] = c.currencyCode;
  return acc;
}, {} as Record<string, string>);

// Currency code to symbol mapping
export const currencySymbolMap: Record<string, string> = countryCurrencies.reduce((acc, c) => {
  if (!acc[c.currencyCode]) {
    acc[c.currencyCode] = c.currencySymbol;
  }
  return acc;
}, {} as Record<string, string>);

// Get currency by country name (fuzzy match for geocoding results)
export function getCurrencyByCountryName(countryName: string): CountryCurrency | undefined {
  if (!countryName) return undefined;
  
  const normalized = countryName.toLowerCase().trim();
  
  // Direct match first
  const direct = countryCurrencies.find(
    c => c.countryName.toLowerCase() === normalized
  );
  if (direct) return direct;
  
  // Common aliases and variations
  const aliases: Record<string, string> = {
    'united states of america': 'US',
    'usa': 'US',
    'u.s.': 'US',
    'u.s.a.': 'US',
    'america': 'US',
    'united kingdom': 'GB',
    'uk': 'GB',
    'great britain': 'GB',
    'england': 'GB',
    'scotland': 'GB',
    'wales': 'GB',
    'northern ireland': 'GB',
    'south korea': 'KR',
    'republic of korea': 'KR',
    'korea': 'KR',
    'north korea': 'KP',
    "democratic people's republic of korea": 'KP',
    'russia': 'RU',
    'russian federation': 'RU',
    'china': 'CN',
    "people's republic of china": 'CN',
    'taiwan': 'TW',
    'republic of china': 'TW',
    'vietnam': 'VN',
    'viet nam': 'VN',
    'ivory coast': 'CI',
    "cote d'ivoire": 'CI',
    'the netherlands': 'NL',
    'holland': 'NL',
    'czech republic': 'CZ',
    'czechia': 'CZ',
    'uae': 'AE',
    'emirates': 'AE',
    'dr congo': 'CD',
    'drc': 'CD',
    'democratic republic of the congo': 'CD',
    'republic of the congo': 'CG',
    'congo-brazzaville': 'CG',
    'congo-kinshasa': 'CD',
    'swaziland': 'SZ',
    'burma': 'MM',
    'persia': 'IR',
    'deutschland': 'DE',
    'espana': 'ES',
    'france': 'FR',
    'italia': 'IT',
    'brasil': 'BR',
    'nippon': 'JP',
    'nihon': 'JP',
  };
  
  const aliasCode = aliases[normalized];
  if (aliasCode) {
    return getCurrencyByCountryCode(aliasCode);
  }
  
  // Partial match - check if country name contains the search term
  const partial = countryCurrencies.find(
    c => c.countryName.toLowerCase().includes(normalized) ||
         normalized.includes(c.countryName.toLowerCase())
  );
  
  return partial;
}

// Detect currency from geocoding result
export function detectCurrencyFromLocation(geocodeResult: {
  country?: string;
  state?: string;
  city?: string;
}): CountryCurrency | undefined {
  if (geocodeResult.country) {
    return getCurrencyByCountryName(geocodeResult.country);
  }
  return undefined;
}
