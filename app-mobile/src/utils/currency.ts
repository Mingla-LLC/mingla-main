// Currency symbols and formatting utilities
export const getCurrencySymbol = (currency: string): string => {
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
    AUD: '$',
    CAD: '$',
    CHF: '₣',
    CNY: '¥',
    SEK: 'kr',
    NZD: '$',
    MXN: '$',
    SGD: '$',
    HKD: '$',
    NOK: 'kr',
    KRW: '₩',
    TRY: '₺',
    RUB: '₽',
    INR: '₹',
    BRL: 'R$',
    ZAR: 'R',
    DKK: 'kr',
    PLN: 'zł',
    TWD: '$',
    THB: '฿',
    MYR: 'RM',
    CZK: 'Kč',
    HUF: 'Ft',
    ILS: '₪',
    CLP: '$',
    PHP: '₱',
    AED: 'د.إ',
    COP: '$',
    SAR: '﷼',
    RON: 'lei',
    BGN: 'лв',
    HRK: 'kn',
    ISK: 'kr',
    IDR: 'Rp',
    VND: '₫',
    EGP: '£',
    QAR: '﷼',
    KWD: 'د.ك',
    BHD: 'د.ب',
    OMR: '﷼',
    JOD: 'د.ا',
    LBP: '£',
    PEN: 'S/',
    UYU: '$',
    ARS: '$',
    NGN: '₦'
  };
  
  return symbols[currency] || currency;
};

export const formatCurrency = (amount: number, currency: string = 'USD'): string => {
  const symbol = getCurrencySymbol(currency);
  
  // Format with appropriate decimal places
  if (currency === 'JPY' || currency === 'KRW' || currency === 'VND') {
    // No decimal places for these currencies
    return `${symbol}${Math.round(amount)}`;
  }
  
  return `${symbol}${amount.toFixed(0)}`;
};
