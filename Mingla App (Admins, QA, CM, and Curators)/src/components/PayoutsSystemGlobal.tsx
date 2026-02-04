import React from 'react';
import { Smartphone, Globe, DollarSign } from 'lucide-react';
import { motion } from 'motion/react';

// Comprehensive list of supported countries with mobile money services
export const GLOBAL_COUNTRIES = [
  // Africa - 30+ countries
  { name: 'South Africa', code: 'ZA', flag: '🇿🇦', currency: 'ZAR', region: 'Africa', mobileMoney: ['PayShap', 'SnapScan'] },
  { name: 'Nigeria', code: 'NG', flag: '🇳🇬', currency: 'NGN', region: 'Africa', mobileMoney: ['Paga', 'OPay', 'PalmPay', 'Kuda'] },
  { name: 'Kenya', code: 'KE', flag: '🇰🇪', currency: 'KES', region: 'Africa', mobileMoney: ['M-Pesa', 'Airtel Money'] },
  { name: 'Egypt', code: 'EG', flag: '🇪🇬', currency: 'EGP', region: 'Africa', mobileMoney: ['Vodafone Cash', 'Fawry'] },
  { name: 'Ghana', code: 'GH', flag: '🇬🇭', currency: 'GHS', region: 'Africa', mobileMoney: ['MTN Mobile Money', 'AirtelTigo Money'] },
  { name: 'Tanzania', code: 'TZ', flag: '🇹🇿', currency: 'TZS', region: 'Africa', mobileMoney: ['M-Pesa', 'Tigo Pesa', 'Airtel Money'] },
  { name: 'Uganda', code: 'UG', flag: '🇺🇬', currency: 'UGX', region: 'Africa', mobileMoney: ['MTN Mobile Money', 'Airtel Money'] },
  { name: 'Ethiopia', code: 'ET', flag: '🇪🇹', currency: 'ETB', region: 'Africa', mobileMoney: ['M-Birr', 'HelloCash'] },
  { name: 'Morocco', code: 'MA', flag: '🇲🇦', currency: 'MAD', region: 'Africa', mobileMoney: [] },
  { name: 'Algeria', code: 'DZ', flag: '🇩🇿', currency: 'DZD', region: 'Africa', mobileMoney: [] },
  { name: 'Tunisia', code: 'TN', flag: '🇹🇳', currency: 'TND', region: 'Africa', mobileMoney: [] },
  { name: 'Rwanda', code: 'RW', flag: '🇷🇼', currency: 'RWF', region: 'Africa', mobileMoney: ['MTN Mobile Money', 'Airtel Money'] },
  { name: 'Senegal', code: 'SN', flag: '🇸🇳', currency: 'XOF', region: 'Africa', mobileMoney: ['Orange Money', 'Wave'] },
  { name: 'Ivory Coast', code: 'CI', flag: '🇨🇮', currency: 'XOF', region: 'Africa', mobileMoney: ['Orange Money', 'MTN Mobile Money'] },
  { name: 'Cameroon', code: 'CM', flag: '🇨🇲', currency: 'XAF', region: 'Africa', mobileMoney: ['Orange Money', 'MTN Mobile Money'] },
  { name: 'Zambia', code: 'ZM', flag: '🇿🇲', currency: 'ZMW', region: 'Africa', mobileMoney: ['Airtel Money', 'MTN Mobile Money'] },
  { name: 'Zimbabwe', code: 'ZW', flag: '🇿🇼', currency: 'USD', region: 'Africa', mobileMoney: ['EcoCash', 'OneMoney'] },
  { name: 'Botswana', code: 'BW', flag: '🇧🇼', currency: 'BWP', region: 'Africa', mobileMoney: ['Orange Money'] },
  { name: 'Mozambique', code: 'MZ', flag: '🇲🇿', currency: 'MZN', region: 'Africa', mobileMoney: ['M-Pesa', 'e-Mola'] },
  { name: 'Namibia', code: 'NA', flag: '🇳🇦', currency: 'NAD', region: 'Africa', mobileMoney: ['MobiPay'] },
  { name: 'Angola', code: 'AO', flag: '🇦🇴', currency: 'AOA', region: 'Africa', mobileMoney: [] },
  { name: 'Mali', code: 'ML', flag: '🇲🇱', currency: 'XOF', region: 'Africa', mobileMoney: ['Orange Money'] },
  { name: 'Burkina Faso', code: 'BF', flag: '🇧🇫', currency: 'XOF', region: 'Africa', mobileMoney: ['Orange Money'] },
  { name: 'Benin', code: 'BJ', flag: '🇧🇯', currency: 'XOF', region: 'Africa', mobileMoney: ['MTN Mobile Money'] },
  { name: 'Togo', code: 'TG', flag: '🇹🇬', currency: 'XOF', region: 'Africa', mobileMoney: ['Flooz', 'TMoney'] },
  { name: 'Mauritius', code: 'MU', flag: '🇲🇺', currency: 'MUR', region: 'Africa', mobileMoney: ['juice'] },
  { name: 'Malawi', code: 'MW', flag: '🇲🇼', currency: 'MWK', region: 'Africa', mobileMoney: ['Airtel Money'] },
  { name: 'Congo (DRC)', code: 'CD', flag: '🇨🇩', currency: 'CDF', region: 'Africa', mobileMoney: ['Airtel Money', 'Orange Money'] },
  { name: 'Madagascar', code: 'MG', flag: '🇲🇬', currency: 'MGA', region: 'Africa', mobileMoney: ['Airtel Money', 'Orange Money'] },
  { name: 'Gabon', code: 'GA', flag: '🇬🇦', currency: 'XAF', region: 'Africa', mobileMoney: ['Airtel Money'] },
  
  // Americas
  { name: 'United States', code: 'US', flag: '🇺🇸', currency: 'USD', region: 'Americas', mobileMoney: [] },
  { name: 'Canada', code: 'CA', flag: '🇨🇦', currency: 'CAD', region: 'Americas', mobileMoney: [] },
  { name: 'Mexico', code: 'MX', flag: '🇲🇽', currency: 'MXN', region: 'Americas', mobileMoney: [] },
  { name: 'Brazil', code: 'BR', flag: '🇧🇷', currency: 'BRL', region: 'Americas', mobileMoney: ['PIX'] },
  { name: 'Argentina', code: 'AR', flag: '🇦🇷', currency: 'ARS', region: 'Americas', mobileMoney: ['Mercado Pago'] },
  { name: 'Chile', code: 'CL', flag: '🇨🇱', currency: 'CLP', region: 'Americas', mobileMoney: [] },
  { name: 'Colombia', code: 'CO', flag: '🇨🇴', currency: 'COP', region: 'Americas', mobileMoney: ['Nequi', 'Daviplata'] },
  { name: 'Peru', code: 'PE', flag: '🇵🇪', currency: 'PEN', region: 'Americas', mobileMoney: ['Yape', 'Plin'] },
  
  // Europe
  { name: 'United Kingdom', code: 'GB', flag: '🇬🇧', currency: 'GBP', region: 'Europe', mobileMoney: [] },
  { name: 'Germany', code: 'DE', flag: '🇩🇪', currency: 'EUR', region: 'Europe', mobileMoney: [] },
  { name: 'France', code: 'FR', flag: '🇫🇷', currency: 'EUR', region: 'Europe', mobileMoney: [] },
  { name: 'Italy', code: 'IT', flag: '🇮🇹', currency: 'EUR', region: 'Europe', mobileMoney: [] },
  { name: 'Spain', code: 'ES', flag: '🇪🇸', currency: 'EUR', region: 'Europe', mobileMoney: [] },
  { name: 'Netherlands', code: 'NL', flag: '🇳🇱', currency: 'EUR', region: 'Europe', mobileMoney: [] },
  { name: 'Switzerland', code: 'CH', flag: '🇨🇭', currency: 'CHF', region: 'Europe', mobileMoney: [] },
  { name: 'Sweden', code: 'SE', flag: '🇸🇪', currency: 'SEK', region: 'Europe', mobileMoney: ['Swish'] },
  { name: 'Norway', code: 'NO', flag: '🇳🇴', currency: 'NOK', region: 'Europe', mobileMoney: ['Vipps'] },
  { name: 'Denmark', code: 'DK', flag: '🇩🇰', currency: 'DKK', region: 'Europe', mobileMoney: ['MobilePay'] },
  { name: 'Poland', code: 'PL', flag: '🇵🇱', currency: 'PLN', region: 'Europe', mobileMoney: [] },
  
  // Asia
  { name: 'India', code: 'IN', flag: '🇮🇳', currency: 'INR', region: 'Asia', mobileMoney: ['Paytm', 'PhonePe', 'Google Pay'] },
  { name: 'China', code: 'CN', flag: '🇨🇳', currency: 'CNY', region: 'Asia', mobileMoney: ['WeChat Pay', 'Alipay'] },
  { name: 'Japan', code: 'JP', flag: '🇯🇵', currency: 'JPY', region: 'Asia', mobileMoney: [] },
  { name: 'South Korea', code: 'KR', flag: '🇰🇷', currency: 'KRW', region: 'Asia', mobileMoney: ['Kakao Pay'] },
  { name: 'Singapore', code: 'SG', flag: '🇸🇬', currency: 'SGD', region: 'Asia', mobileMoney: ['PayNow'] },
  { name: 'Thailand', code: 'TH', flag: '🇹🇭', currency: 'THB', region: 'Asia', mobileMoney: ['PromptPay'] },
  { name: 'Malaysia', code: 'MY', flag: '🇲🇾', currency: 'MYR', region: 'Asia', mobileMoney: ['Touch n Go'] },
  { name: 'Indonesia', code: 'ID', flag: '🇮🇩', currency: 'IDR', region: 'Asia', mobileMoney: ['GoPay', 'OVO'] },
  { name: 'Philippines', code: 'PH', flag: '🇵🇭', currency: 'PHP', region: 'Asia', mobileMoney: ['GCash', 'PayMaya'] },
  { name: 'Vietnam', code: 'VN', flag: '🇻🇳', currency: 'VND', region: 'Asia', mobileMoney: ['MoMo', 'ZaloPay'] },
  { name: 'Pakistan', code: 'PK', flag: '🇵🇰', currency: 'PKR', region: 'Asia', mobileMoney: ['Easypaisa', 'JazzCash'] },
  { name: 'Bangladesh', code: 'BD', flag: '🇧🇩', currency: 'BDT', region: 'Asia', mobileMoney: ['bKash', 'Nagad'] },
  
  // Middle East
  { name: 'UAE', code: 'AE', flag: '🇦🇪', currency: 'AED', region: 'Middle East', mobileMoney: [] },
  { name: 'Saudi Arabia', code: 'SA', flag: '🇸🇦', currency: 'SAR', region: 'Middle East', mobileMoney: ['STC Pay'] },
  { name: 'Israel', code: 'IL', flag: '🇮🇱', currency: 'ILS', region: 'Middle East', mobileMoney: ['Bit'] },
  { name: 'Turkey', code: 'TR', flag: '🇹🇷', currency: 'TRY', region: 'Middle East', mobileMoney: [] },
  
  // Oceania
  { name: 'Australia', code: 'AU', flag: '🇦🇺', currency: 'AUD', region: 'Oceania', mobileMoney: [] },
  { name: 'New Zealand', code: 'NZ', flag: '🇳🇿', currency: 'NZD', region: 'Oceania', mobileMoney: [] },
];

// Summary component showing global coverage
export function GlobalCoverageSummary() {
  const africaCount = GLOBAL_COUNTRIES.filter(c => c.region === 'Africa').length;
  const mobileMoneyCount = GLOBAL_COUNTRIES.filter(c => c.mobileMoney.length > 0).length;
  
  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-200 mb-6">
      <h3 className="text-gray-900 mb-4 flex items-center gap-2">
        <Globe className="w-5 h-5 text-blue-600" />
        Global Payment Coverage
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center">
          <div className="text-3xl text-blue-900">{GLOBAL_COUNTRIES.length}</div>
          <div className="text-sm text-blue-700">Countries</div>
        </div>
        <div className="text-center">
          <div className="text-3xl text-green-900">{africaCount}</div>
          <div className="text-sm text-green-700">in Africa 🌍</div>
        </div>
        <div className="text-center">
          <div className="text-3xl text-purple-900">{mobileMoneyCount}</div>
          <div className="text-sm text-purple-700">Mobile Money</div>
        </div>
        <div className="text-center">
          <div className="text-3xl text-orange-900">40+</div>
          <div className="text-sm text-orange-700">Currencies</div>
        </div>
      </div>
    </div>
  );
}

// Country selector component
export function CountrySelector({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
    >
      <option value="">Select your country</option>
      {['Africa', 'Americas', 'Asia', 'Europe', 'Middle East', 'Oceania'].map((region) => (
        <optgroup key={region} label={`${region} (${GLOBAL_COUNTRIES.filter(c => c.region === region).length})`}>
          {GLOBAL_COUNTRIES.filter(c => c.region === region).map((country) => (
            <option key={country.code} value={country.code}>
              {country.flag} {country.name} {country.mobileMoney.length > 0 ? '📱' : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// Show mobile money info for selected country
export function MobileMoneyInfo({ countryCode }: { countryCode: string }) {
  const country = GLOBAL_COUNTRIES.find(c => c.code === countryCode);
  
  if (!country || country.mobileMoney.length === 0) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-blue-50 border border-blue-200 rounded-xl p-4 mt-4"
    >
      <div className="flex gap-3">
        <Smartphone className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="text-blue-900 text-sm mb-2">
            ✨ Mobile Money Available in {country.name}
          </h4>
          <div className="flex flex-wrap gap-2 mb-2">
            {country.mobileMoney.map((service) => (
              <span
                key={service}
                className="text-xs bg-blue-100 text-blue-800 px-3 py-1.5 rounded-full inline-flex items-center gap-1"
              >
                <Smartphone className="w-3 h-3" />
                {service}
              </span>
            ))}
          </div>
          <p className="text-xs text-blue-700">
            ⚡ Instant payouts • 💰 Lower fees • 🏦 No bank account needed
          </p>
        </div>
      </div>
    </motion.div>
  );
}
