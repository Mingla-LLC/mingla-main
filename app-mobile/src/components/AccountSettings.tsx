import React, { useState } from 'react';
import { Text, View, TouchableOpacity } from 'react-native';
import { ArrowLeft, Globe, Ruler, Trash2, AlertTriangle, Check } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from './ui/alert-dialog';

interface AccountSettingsProps {
  accountPreferences: {
    currency: string;
    measurementSystem: 'Metric' | 'Imperial';
  };
  onUpdatePreferences: (preferences: any) => void;
  onDeleteAccount: () => void;
  onNavigateBack: () => void;
}

// Mock exchange rates - in real app this would come from an API
const exchangeRates = {
  USD: 1.00,
  AUD: 1.35,
  BIF: 2000.0,  // Burundian Franc
  BRL: 5.15,
  BWP: 11.2,    // Botswanan Pula
  CAD: 1.25,
  CHF: 0.92,
  CNY: 6.45,
  CVE: 95.8,    // Cape Verdean Escudo
  CZK: 21.5,
  DJF: 177.0,   // Djiboutian Franc
  DKK: 6.34,
  DZD: 134.0,   // Algerian Dinar
  EGP: 31.0,    // Egyptian Pound
  ERN: 15.0,    // Eritrean Nakfa
  ETB: 50.8,    // Ethiopian Birr
  EUR: 0.85,
  GBP: 0.73,
  GHS: 12.05,   // Ghanaian Cedi
  GMD: 53.5,    // Gambian Dalasi
  GNF: 8600.0,  // Guinean Franc
  HKD: 7.78,
  HUF: 298.0,
  ILS: 3.25,
  INR: 74.8,
  JPY: 110.0,
  KES: 108.5,   // Kenyan Shilling
  KMF: 425.0,   // Comorian Franc
  KRW: 1180.0,
  LRD: 151.0,   // Liberian Dollar
  LSL: 14.2,    // Lesotho Loti
  LYD: 4.8,     // Libyan Dinar
  MAD: 10.1,    // Moroccan Dirham
  MGA: 4150.0,  // Malagasy Ariary
  MRU: 36.8,    // Mauritanian Ouguiya
  MUR: 44.2,    // Mauritian Rupee
  MXN: 17.8,
  NAD: 14.2,    // Namibian Dollar
  NGN: 460.0,   // Nigerian Naira
  NOK: 8.85,
  NZD: 1.42,
  PLN: 3.89,
  RUB: 74.5,
  RWF: 1020.0,  // Rwandan Franc
  SCR: 13.4,    // Seychellois Rupee
  SDG: 600.0,   // Sudanese Pound
  SEK: 8.95,
  SGD: 1.32,
  SLL: 11500.0, // Sierra Leonean Leone
  SOS: 570.0,   // Somali Shilling
  SSP: 130.2,   // South Sudanese Pound
  SZL: 14.2,    // Swazi Lilangeni
  TND: 3.1,     // Tunisian Dinar
  TRY: 8.45,
  TZS: 2320.0,  // Tanzanian Shilling
  UGX: 3650.0,  // Ugandan Shilling
  XOF: 565.0,   // West African CFA Franc
  ZAR: 14.2
};

const supportedCurrencies = [
  // USD first as default
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  
  // All other currencies in alphabetical order by currency code
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'BIF', name: 'Burundian Franc', symbol: 'FBu' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'BWP', name: 'Botswanan Pula', symbol: 'P' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'CVE', name: 'Cape Verdean Escudo', symbol: '$' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
  { code: 'DJF', name: 'Djiboutian Franc', symbol: 'Fdj' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'DZD', name: 'Algerian Dinar', symbol: 'د.ج' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: '£' },
  { code: 'ERN', name: 'Eritrean Nakfa', symbol: 'Nfk' },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: '₵' },
  { code: 'GMD', name: 'Gambian Dalasi', symbol: 'D' },
  { code: 'GNF', name: 'Guinean Franc', symbol: 'FG' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft' },
  { code: 'ILS', name: 'Israeli Shekel', symbol: '₪' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
  { code: 'KMF', name: 'Comorian Franc', symbol: 'CF' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'LRD', name: 'Liberian Dollar', symbol: 'L$' },
  { code: 'LSL', name: 'Lesotho Loti', symbol: 'L' },
  { code: 'LYD', name: 'Libyan Dinar', symbol: 'ل.د' },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'د.م.' },
  { code: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar' },
  { code: 'MRU', name: 'Mauritanian Ouguiya', symbol: 'UM' },
  { code: 'MUR', name: 'Mauritian Rupee', symbol: '₨' },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$' },
  { code: 'NAD', name: 'Namibian Dollar', symbol: 'N$' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'PLN', name: 'Polish Złoty', symbol: 'zł' },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽' },
  { code: 'RWF', name: 'Rwandan Franc', symbol: 'RF' },
  { code: 'SCR', name: 'Seychellois Rupee', symbol: '₨' },
  { code: 'SDG', name: 'Sudanese Pound', symbol: '£' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'SLL', name: 'Sierra Leonean Leone', symbol: 'Le' },
  { code: 'SOS', name: 'Somali Shilling', symbol: 'Sh' },
  { code: 'SSP', name: 'South Sudanese Pound', symbol: '£' },
  { code: 'SZL', name: 'Swazi Lilangeni', symbol: 'L' },
  { code: 'TND', name: 'Tunisian Dinar', symbol: 'د.ت' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh' },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh' },
  { code: 'XOF', name: 'West African CFA Franc', symbol: 'CFA' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' }
];

export default function AccountSettings({ 
  accountPreferences, 
  onUpdatePreferences, 
  onDeleteAccount,
  onNavigateBack 
}: AccountSettingsProps) {
  const [selectedCurrency, setSelectedCurrency] = useState(accountPreferences.currency);
  const [selectedMeasurement, setSelectedMeasurement] = useState(accountPreferences.measurementSystem);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleCurrencyChange = (currencyCode: string) => {
    setSelectedCurrency(currencyCode);
    const updatedPreferences = {
      ...accountPreferences,
      currency: currencyCode
    };
    onUpdatePreferences(updatedPreferences);
  };

  const handleMeasurementChange = (system: 'Metric' | 'Imperial') => {
    setSelectedMeasurement(system);
    const updatedPreferences = {
      ...accountPreferences,
      measurementSystem: system
    };
    onUpdatePreferences(updatedPreferences);
  };

  const formatCurrency = (amount: number, currencyCode: string) => {
    const currency = supportedCurrencies.find(c => c.code === currencyCode);
    const rate = exchangeRates[currencyCode as keyof typeof exchangeRates];
    const convertedAmount = amount * rate;
    
    // Currencies that don't use decimal places (whole numbers only)
    const wholeNumberCurrencies = [
      'JPY', 'KRW', 'HUF', 'XOF', 'SLL', 'GNF', 'UGX', 'TZS', 'RWF', 'BIF', 
      'SOS', 'DJF', 'KMF', 'MGA', 'DZD'
    ];
    
    if (wholeNumberCurrencies.includes(currencyCode)) {
      return `${currency?.symbol}${Math.round(convertedAmount).toLocaleString()}`;
    }
    
    return `${currency?.symbol}${convertedAmount.toFixed(2)}`;
  };

  const getCurrentCurrency = () => {
    return supportedCurrencies.find(c => c.code === selectedCurrency);
  };

  return (
    <View className="h-full bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <View className="bg-white border-b border-gray-200 px-4 py-4 sticky top-0 z-10">
        <View className="flex items-center gap-3">
          <TouchableOpacity
            onClick={onNavigateBack}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </TouchableOpacity>
          <Text className="text-xl font-semibold text-gray-900">Account Settings</Text>
        </View>
      </View>

      {/* Content */}
      <View className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Currency Preference */}
        <View className="bg-white rounded-2xl border border-gray-200 p-6">
          <View className="flex items-center gap-3 mb-4">
            <Globe className="w-5 h-5 text-[#eb7825]" />
            <Text className="font-semibold text-gray-900">Currency Preference</Text>
          </View>
          
          <Text className="text-sm text-gray-600 mb-4">
            Choose your preferred currency for displaying prices throughout the app. 
            All amounts are converted from USD using current exchange rates.
          </Text>

          <View className="space-y-2">
            <View className="grid grid-cols-1 gap-3 max-h-60 overflow-y-auto">
              {supportedCurrencies.map((currency) => (
                <TouchableOpacity
                  key={currency.code}
                  onClick={() => handleCurrencyChange(currency.code)}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                    selectedCurrency === currency.code
                      ? 'border-[#eb7825] bg-orange-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <View className="flex items-center gap-3">
                    <Text className="text-lg font-medium">{currency.symbol}</Text>
                    <View className="text-left">
                      <View className="font-medium text-gray-900">{currency.code}</View>
                      <View className="text-sm text-gray-500">{currency.name}</View>
                    </View>
                  </View>
                  <View className="text-right">
                    <View className="text-sm font-medium text-gray-900">
                      Example: {formatCurrency(25, currency.code)}
                    </View>
                    <View className="text-xs text-gray-500">
                      1 USD = {exchangeRates[currency.code as keyof typeof exchangeRates]} {currency.code}
                    </View>
                  </View>
                  {selectedCurrency === currency.code && (
                    <Check className="w-5 h-5 text-[#eb7825] ml-2" />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {selectedCurrency !== 'USD' && (
            <View className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <Text className="text-sm text-[#eb7825]">
                <strong>Selected:</strong> {getCurrentCurrency()?.name} ({getCurrentCurrency()?.symbol})
                <br />
                Exchange rates are updated regularly and may fluctuate.
              </Text>
            </View>
          )}
        </View>

        {/* Measurement System */}
        <View className="bg-white rounded-2xl border border-gray-200 p-6">
          <View className="flex items-center gap-3 mb-4">
            <Ruler className="w-5 h-5 text-[#eb7825]" />
            <Text className="font-semibold text-gray-900">Measurement System</Text>
          </View>
          
          <Text className="text-sm text-gray-600 mb-4">
            Choose how distances, sizes, and other measurements are displayed throughout the app.
          </Text>

          <View className="space-y-3">
            <TouchableOpacity
              onClick={() => handleMeasurementChange('Imperial')}
              className={`w-full flex items-center justify-between p-4 rounded-lg border transition-all ${
                selectedMeasurement === 'Imperial'
                  ? 'border-[#eb7825] bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <View className="text-left">
                <View className="font-medium text-gray-900">Imperial</View>
                <View className="text-sm text-gray-500">Miles, feet, inches, Fahrenheit</View>
              </View>
              {selectedMeasurement === 'Imperial' && (
                <Check className="w-5 h-5 text-[#eb7825]" />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onClick={() => handleMeasurementChange('Metric')}
              className={`w-full flex items-center justify-between p-4 rounded-lg border transition-all ${
                selectedMeasurement === 'Metric'
                  ? 'border-[#eb7825] bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <View className="text-left">
                <View className="font-medium text-gray-900">Metric</View>
                <View className="text-sm text-gray-500">Kilometers, meters, centimeters, Celsius</View>
              </View>
              {selectedMeasurement === 'Metric' && (
                <Check className="w-5 h-5 text-[#eb7825]" />
              )}
            </TouchableOpacity>
          </View>

          <View className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <Text className="text-sm text-[#eb7825]">
              <strong>Selected:</strong> {selectedMeasurement} system
              <br />
              This will apply to all distance and measurement displays in the app.
            </Text>
          </View>
        </View>

        {/* Account Lifecycle */}
        <View className="bg-white rounded-2xl border border-gray-200 p-6">
          <View className="flex items-center gap-3 mb-4">
            <Trash2 className="w-5 h-5 text-red-500" />
            <Text className="font-semibold text-gray-900">Delete Account</Text>
          </View>
          
          <Text className="text-sm text-gray-600 mb-4">
            Permanently delete your Mingla account and all associated data.
          </Text>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <TouchableOpacity className="w-full flex items-center justify-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 hover:bg-red-100 transition-colors">
                <Trash2 className="w-4 h-4" />
                Delete Account
              </TouchableOpacity>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-md">
              <AlertDialogHeader>
                <View className="flex items-center gap-3">
                  <AlertTriangle className="w-6 h-6 text-red-500" />
                  <AlertDialogTitle>Delete Account</AlertDialogTitle>
                </View>
                <AlertDialogDescription className="text-left">
                  Are you sure you want to permanently delete your Mingla account? 
                  
                  <View className="mt-3 p-3 bg-red-50 rounded-lg">
                    <Text className="text-sm text-red-700 font-medium mb-2">This will permanently remove:</Text>
                    <ul className="text-sm text-red-600 space-y-1">
                      <li>• Your profile and personal information</li>
                      <li>• All saved experiences and boards</li>
                      <li>• Your connections and collaborations</li>
                      <li>• Calendar entries and activity history</li>
                      <li>• All app preferences and settings</li>
                    </ul>
                  </View>
                  
                  <Text className="mt-3 text-sm font-medium text-red-700">
                    This action cannot be undone.
                  </Text>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={onDeleteAccount}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  Delete Account
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <View className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <Text className="text-sm text-[#eb7825]">
              <strong>Warning:</strong> Account deletion is permanent and cannot be reversed. 
              Make sure to save any important information before proceeding.
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}