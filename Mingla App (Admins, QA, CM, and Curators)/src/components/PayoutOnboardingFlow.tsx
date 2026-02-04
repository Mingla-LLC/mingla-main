import React, { useState } from 'react';
import { X, ChevronRight, ChevronLeft, Check, AlertCircle, Upload, Lock, Globe, DollarSign, CreditCard, Building, Info, Shield, FileText, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select } from './ui/select';

interface PayoutOnboardingFlowProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (data: PayoutSetupData) => void;
  existingData?: Partial<PayoutSetupData>;
}

export interface PayoutSetupData {
  country: string;
  currency: string;
  payoutMethod: 'bank' | 'stripe' | 'paypal' | 'local';
  instantPayouts: boolean;
  kycStatus: 'pending' | 'verified' | 'rejected';
  taxFormType: string;
  taxFormUploaded: boolean;
  bankDetails?: {
    bankCountry: string;
    accountHolder: string;
    accountNumber?: string;
    routingNumber?: string;
    iban?: string;
    swiftBic?: string;
    bsb?: string; // Australia
    sortCode?: string; // UK
    ifsc?: string; // India
    branchCode?: string; // Various countries
    transitNumber?: string; // Canada
    institutionNumber?: string; // Canada
    clabe?: string; // Mexico
    cbu?: string; // Argentina
    bankCode?: string; // Germany, Japan, etc.
    branchNumber?: string; // Japan
    bic?: string; // Europe
  };
  verificationDocuments?: File[];
}

const SUPPORTED_COUNTRIES = [
  { code: 'US', name: 'United States', flag: '🇺🇸', currency: 'USD' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP' },
  { code: 'EU', name: 'European Union', flag: '🇪🇺', currency: 'EUR' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', currency: 'CAD' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', currency: 'AUD' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', currency: 'BRL' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', currency: 'JPY' },
  { code: 'IN', name: 'India', flag: '🇮🇳', currency: 'INR' },
];

const PAYOUT_METHODS = {
  US: [
    { 
      id: 'bank', 
      name: 'Bank Transfer (ACH)', 
      icon: Building, 
      timeline: '3-5 business days', 
      fee: 'Free',
      limits: 'Min $50',
      description: 'Direct deposit to your US bank account'
    },
    { 
      id: 'stripe', 
      name: 'Stripe', 
      icon: CreditCard, 
      timeline: 'Instant', 
      fee: '2.9%',
      limits: 'Min $10',
      description: 'Fast transfers via Stripe Connect'
    },
    { 
      id: 'paypal', 
      name: 'PayPal', 
      icon: DollarSign, 
      timeline: 'Instant', 
      fee: '2.9% + $0.30',
      limits: 'Min $10',
      description: 'Direct to your PayPal account'
    },
  ],
  EU: [
    { 
      id: 'bank', 
      name: 'Bank Transfer (SEPA)', 
      icon: Building, 
      timeline: '1-3 business days', 
      fee: 'Free',
      limits: 'Min €50',
      description: 'SEPA transfer to EU bank account'
    },
    { 
      id: 'local', 
      name: 'SOFORT', 
      icon: CreditCard, 
      timeline: 'Instant', 
      fee: '1.4%',
      limits: 'Min €10',
      description: 'Direct bank transfer'
    },
  ],
  GB: [
    { 
      id: 'bank', 
      name: 'Bank Transfer (Faster Payments)', 
      icon: Building, 
      timeline: 'Same day', 
      fee: 'Free',
      limits: 'Min £50',
      description: 'UK bank transfer via Faster Payments'
    },
  ],
  BR: [
    { 
      id: 'local', 
      name: 'PIX', 
      icon: CreditCard, 
      timeline: 'Instant', 
      fee: '1.5%',
      limits: 'Min R$20',
      description: 'Instant transfer via PIX'
    },
  ],
};

const TAX_FORMS = {
  US: { type: 'W-9', name: 'W-9 Form (US Citizens/Residents)', required: true },
  nonUS: { type: 'W-8BEN', name: 'W-8BEN Form (Non-US Persons)', required: true },
  EU: { type: 'VAT', name: 'VAT Registration (if applicable)', required: false },
  BR: { type: 'CPF/CNPJ', name: 'CPF or CNPJ', required: true },
};

// Country-specific bank account field requirements
const BANK_FIELDS_BY_COUNTRY: Record<string, {
  fields: Array<{
    key: string;
    label: string;
    placeholder: string;
    format?: string;
    required: boolean;
  }>;
  instructions?: string;
}> = {
  // North America
  'US': {
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Full name as shown on account', required: true },
      { key: 'routingNumber', label: 'Routing Number (ABA)', placeholder: '9 digits', format: '9 digits', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: 'Account number', required: true },
    ],
    instructions: 'You can find your routing and account numbers on your checks or bank statement.'
  },
  'CA': {
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Full name as shown on account', required: true },
      { key: 'institutionNumber', label: 'Institution Number', placeholder: '3 digits', format: '3 digits', required: true },
      { key: 'transitNumber', label: 'Transit Number', placeholder: '5 digits', format: '5 digits', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: '7-12 digits', required: true },
    ],
    instructions: 'Find these numbers on your void cheque or online banking.'
  },
  'MX': {
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Nombre completo', required: true },
      { key: 'clabe', label: 'CLABE', placeholder: '18 digits', format: '18 digits', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC (for international)', placeholder: '8 or 11 characters', required: false },
    ],
    instructions: 'CLABE is required for Mexican bank transfers. SWIFT is optional for international transfers.'
  },
  
  // UK & Ireland
  'GB': {
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Full name as shown on account', required: true },
      { key: 'sortCode', label: 'Sort Code', placeholder: '12-34-56', format: 'XX-XX-XX', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: '8 digits', format: '8 digits', required: true },
      { key: 'iban', label: 'IBAN (optional)', placeholder: 'GB29 NWBK 6016 1331 9268 19', required: false },
    ],
    instructions: 'You can find your sort code and account number on your bank card or statement.'
  },
  'IE': {
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Full name as shown on account', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'IE29 AIBK 9311 5212 3456 78', format: 'IE + 20 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ],
    instructions: 'IBAN and BIC are required for Irish bank transfers.'
  },
  
  // Europe - SEPA countries (use IBAN)
  'AT': { // Austria
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Full name', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'AT61 1904 3002 3457 3201', format: 'AT + 18 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'BE': { // Belgium
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Nom complet / Volledige naam', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'BE68 5390 0754 7034', format: 'BE + 14 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'BG': { // Bulgaria
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Пълно име', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'BG80 BNBG 9661 1020 3456 78', format: 'BG + 20 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'HR': { // Croatia
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Puno ime', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'HR12 1001 0051 8630 0016 0', format: 'HR + 19 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'CY': { // Cyprus
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Πλήρες όνομα', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'CY17 0020 0128 0000 0012 0052 7600', format: 'CY + 26 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'CZ': { // Czech Republic
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Celé jméno', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'CZ65 0800 0000 1920 0014 5399', format: 'CZ + 22 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'DK': { // Denmark
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Fulde navn', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'DK50 0040 0440 1162 43', format: 'DK + 16 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'EE': { // Estonia
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Täisnimi', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'EE38 2200 2210 2014 5685', format: 'EE + 18 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'FI': { // Finland
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Koko nimi', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'FI21 1234 5600 0007 85', format: 'FI + 16 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'FR': { // France
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Nom complet', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'FR14 2004 1010 0505 0001 3M02 606', format: 'FR + 25 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'DE': { // Germany
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Vollständiger Name', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'DE89 3704 0044 0532 0130 00', format: 'DE + 20 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'GR': { // Greece
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Πλήρες όνομα', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'GR16 0110 1250 0000 0001 2300 695', format: 'GR + 25 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'HU': { // Hungary
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Teljes név', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'HU42 1177 3016 1111 1018 0000 0000', format: 'HU + 26 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'IS': { // Iceland
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Fullt nafn', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'IS14 0159 2600 7654 5510 7303 39', format: 'IS + 24 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'IT': { // Italy
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Nome completo', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'IT60 X054 2811 1010 0000 0123 456', format: 'IT + 25 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'LV': { // Latvia
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Pilns vārds', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'LV80 BANK 0000 4351 9500 1', format: 'LV + 19 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'LT': { // Lithuania
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Pilnas vardas', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'LT12 1000 0111 0100 1000', format: 'LT + 18 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'LU': { // Luxembourg
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Nom complet', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'LU28 0019 4006 4475 0000', format: 'LU + 18 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'MT': { // Malta
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Isem sħiħ', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'MT84 MALT 0110 0001 2345 MTLC AST0 01S', format: 'MT + 29 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'NL': { // Netherlands
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Volledige naam', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'NL91 ABNA 0417 1643 00', format: 'NL + 16 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'NO': { // Norway
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Fullt navn', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'NO93 8601 1117 947', format: 'NO + 13 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'PL': { // Poland
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Pełna nazwa', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'PL61 1090 1014 0000 0712 1981 2874', format: 'PL + 26 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'PT': { // Portugal
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Nome completo', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'PT50 0002 0123 1234 5678 9015 4', format: 'PT + 23 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'RO': { // Romania
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Nume complet', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'RO49 AAAA 1B31 0075 9384 0000', format: 'RO + 22 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'SK': { // Slovakia
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Celé meno', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'SK31 1200 0000 1987 4263 7541', format: 'SK + 22 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'SI': { // Slovenia
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Polno ime', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'SI56 2633 0001 2039 086', format: 'SI + 17 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'ES': { // Spain
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Nombre completo', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'ES91 2100 0418 4502 0005 1332', format: 'ES + 22 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'SE': { // Sweden
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Fullständigt namn', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'SE45 5000 0000 0583 9825 7466', format: 'SE + 22 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'CH': { // Switzerland
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Nom complet / Vollständiger Name', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'CH93 0076 2011 6238 5295 7', format: 'CH + 19 characters', required: true },
      { key: 'bic', label: 'BIC/SWIFT', placeholder: '8 or 11 characters', required: true },
    ]
  },
  
  // Asia-Pacific
  'AU': { // Australia
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Full name as shown on account', required: true },
      { key: 'bsb', label: 'BSB Number', placeholder: '6 digits (e.g., 062-000)', format: 'XXX-XXX', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: '6-9 digits', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC (for international)', placeholder: '8 or 11 characters', required: false },
    ],
    instructions: 'BSB and account number can be found on your bank statement or online banking.'
  },
  'NZ': { // New Zealand
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Full name', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: '16 digits (XX-XXXX-XXXXXXX-XX)', format: '16 digits', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC (for international)', placeholder: '8 or 11 characters', required: false },
    ]
  },
  'JP': { // Japan
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name (Katakana)', placeholder: 'カタカナで口座名義', required: true },
      { key: 'bankCode', label: 'Bank Code (金融機関コード)', placeholder: '4 digits', format: '4 digits', required: true },
      { key: 'branchCode', label: 'Branch Code (支店コード)', placeholder: '3 digits', format: '3 digits', required: true },
      { key: 'accountNumber', label: 'Account Number (口座番号)', placeholder: '7 digits', format: '7 digits', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC (for international)', placeholder: '8 or 11 characters', required: false },
    ],
    instructions: 'Please ensure account holder name is in Katakana for Japanese bank transfers.'
  },
  'IN': { // India
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Full name as per PAN', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: 'Bank account number', required: true },
      { key: 'ifsc', label: 'IFSC Code', placeholder: '11 characters (e.g., SBIN0001234)', format: '11 characters', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC (for international)', placeholder: '8 or 11 characters', required: false },
    ],
    instructions: 'IFSC code is mandatory for Indian domestic transfers. Find it on your passbook or bank statement.'
  },
  'SG': { // Singapore
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Full name', required: true },
      { key: 'bankCode', label: 'Bank Code', placeholder: '4 digits', format: '4 digits', required: true },
      { key: 'branchCode', label: 'Branch Code', placeholder: '3 digits', format: '3 digits', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: '9-12 digits', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'HK': { // Hong Kong
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Full name', required: true },
      { key: 'bankCode', label: 'Bank Code', placeholder: '3 digits', format: '3 digits', required: true },
      { key: 'branchCode', label: 'Branch Code', placeholder: '3 digits', format: '3 digits', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: '6-12 digits', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC (for international)', placeholder: '8 or 11 characters', required: false },
    ]
  },
  'MY': { // Malaysia
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Nama penuh', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: 'Nombor akaun', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'TH': { // Thailand
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'ชื่อบัญชี', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: 'หมายเลขบัญชี (10-12 digits)', format: '10-12 digits', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'PH': { // Philippines
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Buong pangalan', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: 'Account number', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'CN': { // China
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name (Chinese)', placeholder: '账户持有人姓名', required: true },
      { key: 'accountNumber', label: 'Bank Account Number', placeholder: '银行账号', required: true },
      { key: 'bankCode', label: 'Bank Code', placeholder: '6 digits', format: '6 digits', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'KR': { // South Korea
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: '예금주명', required: true },
      { key: 'bankCode', label: 'Bank Code', placeholder: '3 digits', format: '3 digits', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: '계좌번호', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC (for international)', placeholder: '8 or 11 characters', required: false },
    ]
  },
  
  // Latin America
  'BR': { // Brazil
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Nome completo', required: true },
      { key: 'bankCode', label: 'Bank Code (Código do Banco)', placeholder: '3 digits', format: '3 digits', required: true },
      { key: 'branchCode', label: 'Branch Code (Agência)', placeholder: '4 digits', format: '4 digits', required: true },
      { key: 'accountNumber', label: 'Account Number (Conta)', placeholder: 'Número da conta', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC (for international)', placeholder: '8 or 11 characters', required: false },
    ],
    instructions: 'For PIX, you can also use your PIX key. Bank details are for traditional transfers.'
  },
  'AR': { // Argentina
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Nombre completo', required: true },
      { key: 'cbu', label: 'CBU', placeholder: '22 digits', format: '22 digits', required: true },
      { key: 'accountNumber', label: 'Account Number (optional)', placeholder: 'Número de cuenta', required: false },
      { key: 'swiftBic', label: 'SWIFT/BIC (for international)', placeholder: '8 or 11 characters', required: false },
    ]
  },
  'CL': { // Chile
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Nombre completo', required: true },
      { key: 'bankCode', label: 'Bank Code', placeholder: 'Código del banco', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: 'Número de cuenta', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'CO': { // Colombia
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Nombre completo', required: true },
      { key: 'bankCode', label: 'Bank Code', placeholder: 'Código del banco', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: 'Número de cuenta', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC (for international)', placeholder: '8 or 11 characters', required: false },
    ]
  },
  
  // Middle East & Africa
  'ZA': { // South Africa
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Full name', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: 'Account number', required: true },
      { key: 'branchCode', label: 'Branch Code', placeholder: '6 digits', format: '6 digits', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'AE': { // UAE
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'الاسم الكامل / Full name', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'AE07 0331 2345 6789 0123 456', format: 'AE + 21 characters', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'SA': { // Saudi Arabia
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'الاسم الكامل / Full name', required: true },
      { key: 'iban', label: 'IBAN', placeholder: 'SA03 8000 0000 6080 1016 7519', format: 'SA + 22 characters', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC', placeholder: '8 or 11 characters', required: true },
    ]
  },
  'IL': { // Israel
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'שם מלא', required: true },
      { key: 'bankCode', label: 'Bank Code', placeholder: '2 digits', format: '2 digits', required: true },
      { key: 'branchCode', label: 'Branch Code', placeholder: '3 digits', format: '3 digits', required: true },
      { key: 'accountNumber', label: 'Account Number', placeholder: 'מספר חשבון', required: true },
      { key: 'iban', label: 'IBAN (for international)', placeholder: 'IL62 0108 0000 0009 9999 999', required: false },
    ]
  },
  'NG': { // Nigeria
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Full name', required: true },
      { key: 'accountNumber', label: 'Account Number (NUBAN)', placeholder: '10 digits', format: '10 digits', required: true },
      { key: 'bankCode', label: 'Bank Code', placeholder: '3 digits', format: '3 digits', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC (for international)', placeholder: '8 or 11 characters', required: false },
    ]
  },
  
  // Default for other countries
  'DEFAULT': {
    fields: [
      { key: 'accountHolder', label: 'Account Holder Name', placeholder: 'Full name as shown on account', required: true },
      { key: 'iban', label: 'IBAN (if available)', placeholder: 'International Bank Account Number', required: false },
      { key: 'accountNumber', label: 'Account Number', placeholder: 'Bank account number', required: true },
      { key: 'swiftBic', label: 'SWIFT/BIC Code', placeholder: '8 or 11 characters', required: true },
      { key: 'bankCode', label: 'Bank Code (if applicable)', placeholder: 'Bank identifier code', required: false },
      { key: 'branchCode', label: 'Branch Code (if applicable)', placeholder: 'Branch identifier', required: false },
    ],
    instructions: 'Please provide all available bank details. SWIFT/BIC is required for international transfers.'
  }
};

export default function PayoutOnboardingFlow({ isOpen, onClose, onComplete, existingData }: PayoutOnboardingFlowProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<Partial<PayoutSetupData>>(existingData || {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const totalSteps = 6; // Increased to 6 to include bank details step

  const selectedCountry = SUPPORTED_COUNTRIES.find(c => c.code === formData.country);
  const availableMethods = formData.country ? (PAYOUT_METHODS[formData.country as keyof typeof PAYOUT_METHODS] || PAYOUT_METHODS.US) : PAYOUT_METHODS.US;

  const handleNext = () => {
    if (validateStep(currentStep)) {
      let nextStep = currentStep + 1;
      
      // Skip bank details step (4) if payout method is not bank
      if (currentStep === 3 && formData.payoutMethod !== 'bank') {
        nextStep = 5; // Skip to KYC/Tax step
      }
      
      setCurrentStep(Math.min(nextStep, totalSteps));
    }
  };

  const handleBack = () => {
    let prevStep = currentStep - 1;
    
    // Skip bank details step (4) when going back if payout method is not bank
    if (currentStep === 5 && formData.payoutMethod !== 'bank') {
      prevStep = 3; // Go back to payout method selection
    }
    
    setCurrentStep(Math.max(prevStep, 1));
  };

  const validateStep = (step: number): boolean => {
    const newErrors: Record<string, string> = {};

    switch (step) {
      case 2:
        if (!formData.country) newErrors.country = 'Please select a country';
        if (!formData.currency) newErrors.currency = 'Please select a currency';
        break;
      case 3:
        if (!formData.payoutMethod) newErrors.payoutMethod = 'Please select a payout method';
        break;
      case 4:
        // Bank details validation (only for bank transfer method)
        if (formData.payoutMethod === 'bank') {
          if (!formData.bankDetails?.bankCountry) {
            newErrors.bankCountry = 'Please select bank country';
          }
          if (!formData.bankDetails?.accountHolder) {
            newErrors.accountHolder = 'Account holder name is required';
          }
          
          // Validate required fields based on country
          const bankCountry = formData.bankDetails?.bankCountry || 'DEFAULT';
          const countryFields = BANK_FIELDS_BY_COUNTRY[bankCountry] || BANK_FIELDS_BY_COUNTRY['DEFAULT'];
          
          countryFields.fields.forEach(field => {
            if (field.required && !formData.bankDetails?.[field.key as keyof typeof formData.bankDetails]) {
              newErrors[field.key] = `${field.label} is required`;
            }
          });
        }
        break;
      case 5:
        if (!formData.taxFormUploaded) newErrors.taxForm = 'Please upload required tax form';
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleComplete = async () => {
    if (!validateStep(currentStep)) return;

    setIsSubmitting(true);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    onComplete(formData as PayoutSetupData);
    setIsSubmitting(false);
  };

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: totalSteps }).map((_, index) => (
        <React.Fragment key={index}>
          <div className={`flex items-center justify-center w-8 h-8 rounded-full transition-all ${
            index + 1 < currentStep
              ? 'bg-green-500 text-white'
              : index + 1 === currentStep
              ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white'
              : 'bg-gray-200 text-gray-400'
          }`}>
            {index + 1 < currentStep ? (
              <Check className="w-4 h-4" />
            ) : (
              <span className="text-xs">{index + 1}</span>
            )}
          </div>
          {index < totalSteps - 1 && (
            <div className={`w-12 h-0.5 ${
              index + 1 < currentStep ? 'bg-green-500' : 'bg-gray-200'
            }`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );

  const renderStep1Welcome = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="text-center"
    >
      <div className="w-16 h-16 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-2xl flex items-center justify-center mx-auto mb-6">
        <Globe className="w-8 h-8 text-white" />
      </div>
      
      <h2 className="text-2xl mb-4">Set Up Your Payouts</h2>
      <p className="text-gray-600 mb-8 max-w-md mx-auto">
        Get paid globally with multiple currency and payment method options. We'll guide you through a quick setup process.
      </p>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-8">
        <div className="flex items-start gap-3 text-left">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-medium mb-1">What you'll need:</p>
            <ul className="space-y-1 text-blue-700">
              <li>• Government-issued ID</li>
              <li>• Tax identification number</li>
              <li>• Bank account or payment processor details</li>
              <li>• ~5 minutes to complete</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="p-4 bg-gray-50 rounded-xl">
          <div className="text-2xl mb-2">🌍</div>
          <p className="text-xs text-gray-600">8+ Countries Supported</p>
        </div>
        <div className="p-4 bg-gray-50 rounded-xl">
          <div className="text-2xl mb-2">⚡</div>
          <p className="text-xs text-gray-600">Instant Payouts Available</p>
        </div>
        <div className="p-4 bg-gray-50 rounded-xl">
          <div className="text-2xl mb-2">🔒</div>
          <p className="text-xs text-gray-600">Bank-Level Security</p>
        </div>
      </div>

      <Button
        onClick={handleNext}
        className="w-full bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white"
      >
        Start Setup
        <ChevronRight className="w-4 h-4 ml-2" />
      </Button>
    </motion.div>
  );

  const renderStep2CountryCurrency = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <h2 className="text-2xl mb-2">Country & Currency</h2>
      <p className="text-gray-600 mb-6">Select your payout country and preferred currency.</p>

      <div className="space-y-6">
        <div>
          <Label htmlFor="country" className="flex items-center gap-2 mb-2">
            <Globe className="w-4 h-4" />
            Payout Country
          </Label>
          <select
            id="country"
            value={formData.country || ''}
            onChange={(e) => {
              const country = SUPPORTED_COUNTRIES.find(c => c.code === e.target.value);
              setFormData({ 
                ...formData, 
                country: e.target.value,
                currency: country?.currency
              });
              setErrors({ ...errors, country: '' });
            }}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#eb7825]"
          >
            <option value="">Select country...</option>
            {SUPPORTED_COUNTRIES.map(country => (
              <option key={country.code} value={country.code}>
                {country.flag} {country.name}
              </option>
            ))}
          </select>
          {errors.country && (
            <p className="text-red-500 text-xs mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {errors.country}
            </p>
          )}
        </div>

        {selectedCountry && (
          <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="text-3xl">{selectedCountry.flag}</div>
              <div className="flex-1">
                <p className="text-sm mb-2">
                  <span className="font-medium">Selected:</span> {selectedCountry.name}
                </p>
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  <DollarSign className="w-4 h-4" />
                  <span>Payout currency: <strong>{selectedCountry.currency}</strong></span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div>
          <Label htmlFor="currency" className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4" />
            Payout Currency
          </Label>
          <Input
            id="currency"
            value={formData.currency || ''}
            disabled
            className="bg-gray-50"
          />
          <div className="flex items-start gap-2 mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <Lock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              <strong>Currency locked:</strong> Once you receive your first payout, your currency cannot be changed. All future earnings will be paid in {formData.currency || 'your selected currency'}.
            </p>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-600" />
            Regional Information
          </h4>
          <ul className="space-y-1 text-xs text-blue-800">
            <li>• Processing times: {selectedCountry?.code === 'US' ? '3-5 business days' : selectedCountry?.code === 'EU' ? '1-3 business days' : '1-5 business days'}</li>
            <li>• Minimum payout: {selectedCountry?.currency === 'USD' ? '$50' : selectedCountry?.currency === 'EUR' ? '€50' : selectedCountry?.currency === 'GBP' ? '£50' : `50 ${selectedCountry?.currency}`}</li>
            <li>• Tax requirements: {selectedCountry?.code === 'US' ? 'W-9 or W-8BEN' : 'Country-specific forms required'}</li>
          </ul>
        </div>
      </div>
    </motion.div>
  );

  const renderStep3PayoutMethod = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <h2 className="text-2xl mb-2">Choose Payout Method</h2>
      <p className="text-gray-600 mb-6">Select how you'd like to receive your earnings.</p>

      <div className="space-y-3 mb-6">
        {availableMethods.map((method) => {
          const Icon = method.icon;
          const isSelected = formData.payoutMethod === method.id;
          
          return (
            <button
              key={method.id}
              onClick={() => {
                setFormData({ ...formData, payoutMethod: method.id as any });
                setErrors({ ...errors, payoutMethod: '' });
              }}
              className={`w-full p-4 border-2 rounded-xl text-left transition-all ${
                isSelected
                  ? 'border-[#eb7825] bg-orange-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  isSelected ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white' : 'bg-gray-100 text-gray-600'
                }`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-medium">{method.name}</h4>
                    {isSelected && <CheckCircle className="w-5 h-5 text-[#eb7825]" />}
                  </div>
                  <p className="text-xs text-gray-600 mb-2">{method.description}</p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <span className="flex items-center gap-1 text-gray-500">
                      <Clock className="w-3 h-3" />
                      {method.timeline}
                    </span>
                    <span className="flex items-center gap-1 text-gray-500">
                      <DollarSign className="w-3 h-3" />
                      {method.fee}
                    </span>
                    <span className="text-gray-400">{method.limits}</span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {formData.payoutMethod && (formData.payoutMethod === 'stripe' || formData.payoutMethod === 'paypal') && (
        <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl mb-6">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.instantPayouts || false}
              onChange={(e) => setFormData({ ...formData, instantPayouts: e.target.checked })}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-sm">Enable Instant Payouts</span>
                <span className="px-2 py-0.5 bg-purple-600 text-white text-xs rounded-full">Premium</span>
              </div>
              <p className="text-xs text-purple-800 mb-2">
                Receive your earnings immediately after each transaction (adds 3% fee)
              </p>
              <p className="text-xs text-purple-600">
                Standard: {availableMethods.find(m => m.id === formData.payoutMethod)?.timeline} | Instant: Within minutes
              </p>
            </div>
          </label>
        </div>
      )}

      {errors.payoutMethod && (
        <p className="text-red-500 text-xs flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {errors.payoutMethod}
        </p>
      )}
    </motion.div>
  );

  const renderStep4BankDetails = () => {
    // Only show this step if bank transfer is selected
    if (formData.payoutMethod !== 'bank') {
      return null;
    }

    const bankCountry = formData.bankDetails?.bankCountry || '';
    const countryFields = BANK_FIELDS_BY_COUNTRY[bankCountry] || BANK_FIELDS_BY_COUNTRY['DEFAULT'];

    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
      >
        <h2 className="text-2xl mb-2">Bank Account Details</h2>
        <p className="text-gray-600 mb-6">Enter your bank account information for payouts.</p>

        <div className="space-y-4">
          {/* Bank Country Selection - Always First */}
          <div>
            <Label htmlFor="bankCountry" className="flex items-center gap-2 mb-2">
              <Globe className="w-4 h-4" />
              Bank Country
            </Label>
            <select
              id="bankCountry"
              value={bankCountry}
              onChange={(e) => {
                setFormData({
                  ...formData,
                  bankDetails: { ...formData.bankDetails, bankCountry: e.target.value }
                });
                setErrors({ ...errors, bankCountry: '' });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
            >
              <option value="">Select bank country...</option>
              <optgroup label="North America">
                <option value="US">🇺🇸 United States</option>
                <option value="CA">🇨🇦 Canada</option>
                <option value="MX">🇲🇽 Mexico</option>
              </optgroup>
              <optgroup label="Europe - Western">
                <option value="GB">🇬🇧 United Kingdom</option>
                <option value="IE">🇮🇪 Ireland</option>
                <option value="FR">🇫🇷 France</option>
                <option value="DE">🇩🇪 Germany</option>
                <option value="NL">🇳🇱 Netherlands</option>
                <option value="BE">🇧🇪 Belgium</option>
                <option value="LU">🇱🇺 Luxembourg</option>
                <option value="CH">🇨🇭 Switzerland</option>
                <option value="AT">🇦🇹 Austria</option>
              </optgroup>
              <optgroup label="Europe - Southern">
                <option value="ES">🇪🇸 Spain</option>
                <option value="IT">🇮🇹 Italy</option>
                <option value="PT">🇵🇹 Portugal</option>
                <option value="GR">🇬🇷 Greece</option>
                <option value="MT">🇲🇹 Malta</option>
                <option value="CY">🇨🇾 Cyprus</option>
              </optgroup>
              <optgroup label="Europe - Northern">
                <option value="SE">🇸🇪 Sweden</option>
                <option value="NO">🇳🇴 Norway</option>
                <option value="DK">🇩🇰 Denmark</option>
                <option value="FI">🇫🇮 Finland</option>
                <option value="IS">🇮🇸 Iceland</option>
              </optgroup>
              <optgroup label="Europe - Eastern">
                <option value="PL">🇵🇱 Poland</option>
                <option value="CZ">🇨🇿 Czech Republic</option>
                <option value="SK">🇸🇰 Slovakia</option>
                <option value="HU">🇭🇺 Hungary</option>
                <option value="RO">🇷🇴 Romania</option>
                <option value="BG">🇧🇬 Bulgaria</option>
                <option value="HR">🇭🇷 Croatia</option>
                <option value="SI">🇸🇮 Slovenia</option>
                <option value="EE">🇪🇪 Estonia</option>
                <option value="LV">🇱🇻 Latvia</option>
                <option value="LT">🇱🇹 Lithuania</option>
              </optgroup>
              <optgroup label="Asia-Pacific">
                <option value="AU">🇦🇺 Australia</option>
                <option value="NZ">🇳🇿 New Zealand</option>
                <option value="JP">🇯🇵 Japan</option>
                <option value="SG">🇸🇬 Singapore</option>
                <option value="HK">🇭🇰 Hong Kong</option>
                <option value="IN">🇮🇳 India</option>
                <option value="CN">🇨🇳 China</option>
                <option value="KR">🇰🇷 South Korea</option>
                <option value="MY">🇲🇾 Malaysia</option>
                <option value="TH">🇹🇭 Thailand</option>
                <option value="PH">🇵🇭 Philippines</option>
              </optgroup>
              <optgroup label="Latin America">
                <option value="BR">🇧🇷 Brazil</option>
                <option value="AR">🇦🇷 Argentina</option>
                <option value="CL">🇨🇱 Chile</option>
                <option value="CO">🇨🇴 Colombia</option>
              </optgroup>
              <optgroup label="Middle East & Africa">
                <option value="AE">🇦🇪 United Arab Emirates</option>
                <option value="SA">🇸🇦 Saudi Arabia</option>
                <option value="IL">🇮🇱 Israel</option>
                <option value="ZA">🇿🇦 South Africa</option>
                <option value="NG">🇳🇬 Nigeria</option>
              </optgroup>
              <optgroup label="Other">
                <option value="DEFAULT">🌍 Other Country</option>
              </optgroup>
            </select>
            {errors.bankCountry && (
              <p className="text-red-500 text-xs flex items-center gap-1 mt-1">
                <AlertCircle className="w-3 h-3" />
                {errors.bankCountry}
              </p>
            )}
          </div>

          {/* Dynamic fields based on selected country */}
          {bankCountry && (
            <>
              {countryFields.instructions && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-blue-900">{countryFields.instructions}</p>
                  </div>
                </div>
              )}

              {countryFields.fields.map((field) => (
                <div key={field.key}>
                  <Label htmlFor={field.key} className="mb-2 flex items-center gap-2">
                    {field.label}
                    {field.required && <span className="text-red-500">*</span>}
                    {field.format && (
                      <span className="text-xs text-gray-500">({field.format})</span>
                    )}
                  </Label>
                  <Input
                    id={field.key}
                    value={(formData.bankDetails?.[field.key as keyof typeof formData.bankDetails] as string) || ''}
                    onChange={(e) => {
                      setFormData({
                        ...formData,
                        bankDetails: {
                          ...formData.bankDetails,
                          bankCountry,
                          [field.key]: e.target.value
                        }
                      });
                      setErrors({ ...errors, [field.key]: '' });
                    }}
                    placeholder={field.placeholder}
                    className="w-full"
                  />
                  {errors[field.key] && (
                    <p className="text-red-500 text-xs flex items-center gap-1 mt-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors[field.key]}
                    </p>
                  )}
                </div>
              ))}

              <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-green-600" />
                  <p className="text-sm text-green-900">
                    Your bank details are encrypted and stored securely. We never share your financial information.
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </motion.div>
    );
  };

  const renderStep5KYCTax = () => {
    const taxForm = formData.country === 'US' ? TAX_FORMS.US : TAX_FORMS.nonUS;
    
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
      >
        <h2 className="text-2xl mb-2">Verification & Tax Information</h2>
        <p className="text-gray-600 mb-6">Complete identity verification and tax requirements.</p>

        <div className="space-y-6">
          {/* KYC Section */}
          <div className="p-4 border-2 border-gray-200 rounded-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Shield className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h4 className="font-medium">Identity Verification (KYC)</h4>
                <p className="text-xs text-gray-600">Required for security and compliance</p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label htmlFor="fullName" className="mb-2">Full Legal Name</Label>
                <Input
                  id="fullName"
                  placeholder="As shown on government ID"
                  className="w-full"
                />
              </div>

              <div>
                <Label className="mb-2">Government-Issued ID</Label>
                <div className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-[#eb7825] transition-colors cursor-pointer">
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm mb-1">Upload ID Document</p>
                  <p className="text-xs text-gray-500">Passport, Driver's License, or National ID</p>
                  <input type="file" className="hidden" accept="image/*,.pdf" />
                </div>
              </div>
            </div>
          </div>

          {/* Tax Section */}
          <div className="p-4 border-2 border-gray-200 rounded-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h4 className="font-medium">Tax Information</h4>
                <p className="text-xs text-gray-600">{taxForm.name}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label htmlFor="taxId" className="mb-2">
                  Tax ID / {formData.country === 'US' ? 'SSN/EIN' : 'Tax Number'}
                </Label>
                <Input
                  id="taxId"
                  placeholder={formData.country === 'US' ? 'XXX-XX-XXXX' : 'Enter tax identification number'}
                  className="w-full"
                />
              </div>

              <div>
                <Label className="mb-2">Upload Tax Form ({taxForm.type})</Label>
                <div 
                  onClick={() => setFormData({ ...formData, taxFormUploaded: true })}
                  className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-[#eb7825] transition-colors cursor-pointer"
                >
                  {formData.taxFormUploaded ? (
                    <div className="flex items-center justify-center gap-2 text-green-600">
                      <CheckCircle className="w-6 h-6" />
                      <span className="text-sm font-medium">Form Uploaded</span>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                      <p className="text-sm mb-1">Upload {taxForm.type}</p>
                      <p className="text-xs text-gray-500">PDF or image format</p>
                    </>
                  )}
                  <input type="file" className="hidden" accept=".pdf,image/*" />
                </div>
              </div>
            </div>
          </div>

          {errors.taxForm && (
            <p className="text-red-500 text-xs flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {errors.taxForm}
            </p>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <p className="font-medium mb-1">Verification Timeline</p>
                <p className="text-amber-800">
                  Identity and tax verification typically takes 1-3 business days. You'll receive an email once approved, and payouts will be enabled automatically.
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    );
  };

  const renderStep6Review = () => (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-2xl mb-2">Review & Confirm</h2>
        <p className="text-gray-600">Please review your payout setup details.</p>
      </div>

      <div className="space-y-4 mb-6">
        {/* Country & Currency */}
        <div className="p-4 bg-gray-50 rounded-xl">
          <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-3">Location & Currency</h4>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Country</span>
              <span className="text-sm font-medium">
                {SUPPORTED_COUNTRIES.find(c => c.code === formData.country)?.flag}{' '}
                {SUPPORTED_COUNTRIES.find(c => c.code === formData.country)?.name}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Currency</span>
              <span className="text-sm font-medium flex items-center gap-1">
                {formData.currency}
                <Lock className="w-3 h-3 text-gray-400" />
              </span>
            </div>
          </div>
        </div>

        {/* Payout Method */}
        <div className="p-4 bg-gray-50 rounded-xl">
          <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-3">Payout Method</h4>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Method</span>
              <span className="text-sm font-medium">
                {availableMethods.find(m => m.id === formData.payoutMethod)?.name}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Processing Time</span>
              <span className="text-sm text-gray-600">
                {formData.instantPayouts ? 'Instant' : availableMethods.find(m => m.id === formData.payoutMethod)?.timeline}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Fee</span>
              <span className="text-sm text-gray-600">
                {formData.instantPayouts ? '3%' : availableMethods.find(m => m.id === formData.payoutMethod)?.fee}
              </span>
            </div>
          </div>
        </div>

        {/* Verification Status */}
        <div className="p-4 bg-gray-50 rounded-xl">
          <h4 className="text-xs uppercase tracking-wide text-gray-500 mb-3">Verification Status</h4>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Identity (KYC)</span>
              <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full">
                Pending Verification
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Tax Forms</span>
              <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded-full">
                Under Review
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-900">
            <p className="font-medium mb-1">Next Steps</p>
            <ul className="space-y-1 text-blue-800">
              <li>• Your documents will be reviewed within 1-3 business days</li>
              <li>• You'll receive an email notification once verified</li>
              <li>• Payouts will be automatically enabled after approval</li>
              <li>• You can start earning immediately</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-green-600" />
          <p className="text-sm text-green-900">
            Your information is encrypted and securely stored. We never share your data with third parties.
          </p>
        </div>
      </div>
    </motion.div>
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h3 className="font-medium">Payout Setup</h3>
            <p className="text-xs text-gray-500">Step {currentStep} of {totalSteps}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
          {renderStepIndicator()}

          <AnimatePresence mode="wait">
            {currentStep === 1 && renderStep1Welcome()}
            {currentStep === 2 && renderStep2CountryCurrency()}
            {currentStep === 3 && renderStep3PayoutMethod()}
            {currentStep === 4 && (formData.payoutMethod === 'bank' ? renderStep4BankDetails() : renderStep5KYCTax())}
            {currentStep === 5 && (formData.payoutMethod === 'bank' ? renderStep5KYCTax() : renderStep6Review())}
            {currentStep === 6 && renderStep6Review()}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-6 border-t border-gray-200 bg-gray-50">
          {currentStep > 1 ? (
            <Button
              onClick={handleBack}
              variant="outline"
              className="flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </Button>
          ) : (
            <div />
          )}

          {currentStep < totalSteps ? (
            <Button
              onClick={handleNext}
              className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white"
            >
              Continue
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleComplete}
              disabled={isSubmitting}
              className="bg-gradient-to-r from-green-500 to-emerald-600 text-white"
            >
              {isSubmitting ? 'Submitting...' : 'Complete Setup'}
              <CheckCircle className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function Clock({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}
