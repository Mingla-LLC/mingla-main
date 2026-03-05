/**
 * Translation Service for Multi-language Support
 * Provides translation capabilities for recommendations and UI elements
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
  rtl: boolean;
}

export interface Translation {
  key: string;
  value: string;
  language: string;
  context?: string;
  lastUpdated: string;
}

export interface TranslationCache {
  [language: string]: {
    [key: string]: string;
  };
}

export interface TranslationConfig {
  defaultLanguage: string;
  fallbackLanguage: string;
  supportedLanguages: Language[];
  autoDetectLanguage: boolean;
  cacheTranslations: boolean;
  cacheExpiry: number; // hours
}

class TranslationService {
  private readonly DEFAULT_CONFIG: TranslationConfig = {
    defaultLanguage: 'en',
    fallbackLanguage: 'en',
    supportedLanguages: [
      { code: 'en', name: 'English', nativeName: 'English', flag: '🇺🇸', rtl: false },
      { code: 'es', name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', rtl: false },
      { code: 'fr', name: 'French', nativeName: 'Français', flag: '🇫🇷', rtl: false },
      { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪', rtl: false },
      { code: 'it', name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹', rtl: false },
      { code: 'pt', name: 'Portuguese', nativeName: 'Português', flag: '🇵🇹', rtl: false },
      { code: 'ru', name: 'Russian', nativeName: 'Русский', flag: '🇷🇺', rtl: false },
      { code: 'ja', name: 'Japanese', nativeName: '日本語', flag: '🇯🇵', rtl: false },
      { code: 'ko', name: 'Korean', nativeName: '한국어', flag: '🇰🇷', rtl: false },
      { code: 'zh', name: 'Chinese', nativeName: '中文', flag: '🇨🇳', rtl: false },
      { code: 'ar', name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', rtl: true },
      { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳', rtl: false }
    ],
    autoDetectLanguage: true,
    cacheTranslations: true,
    cacheExpiry: 24 // 24 hours
  };

  private config: TranslationConfig;
  private currentLanguage: string;
  private translationCache: TranslationCache = {};
  private deviceLanguage: string = 'en';

  constructor(config?: Partial<TranslationConfig>) {
    this.config = { ...this.DEFAULT_CONFIG, ...config };
    this.currentLanguage = this.config.defaultLanguage;
    this.initializeService();
  }

  /**
   * Initialize the translation service
   */
  private async initializeService(): Promise<void> {
    try {
      // Load saved language preference
      const savedLanguage = await AsyncStorage.getItem('selected_language');
      if (savedLanguage && this.isLanguageSupported(savedLanguage)) {
        this.currentLanguage = savedLanguage;
      } else if (this.config.autoDetectLanguage) {
        this.currentLanguage = await this.detectDeviceLanguage();
      }

      // Load translation cache
      if (this.config.cacheTranslations) {
        await this.loadTranslationCache();
      }

    } catch (error) {
      console.error('Error initializing translation service:', error);
    }
  }

  /**
   * Get current language
   */
  getCurrentLanguage(): string {
    return this.currentLanguage;
  }

  /**
   * Set current language
   */
  async setLanguage(languageCode: string): Promise<boolean> {
    if (!this.isLanguageSupported(languageCode)) {
      console.warn(`Language ${languageCode} is not supported`);
      return false;
    }

    try {
      this.currentLanguage = languageCode;
      await AsyncStorage.setItem('selected_language', languageCode);
      
      // Load translations for the new language if not cached
      if (this.config.cacheTranslations && !this.translationCache[languageCode]) {
        await this.loadLanguageTranslations(languageCode);
      }

      return true;
    } catch (error) {
      console.error('Error setting language:', error);
      return false;
    }
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages(): Language[] {
    return this.config.supportedLanguages;
  }

  /**
   * Translate a key to the current language
   */
  async translate(key: string, params?: Record<string, any>): Promise<string> {
    try {
      // Check cache first
      if (this.config.cacheTranslations && this.translationCache[this.currentLanguage]) {
        const cachedTranslation = this.translationCache[this.currentLanguage][key];
        if (cachedTranslation) {
          return this.interpolateParams(cachedTranslation, params);
        }
      }

      // Try to get translation from API or local files
      const translation = await this.getTranslation(key, this.currentLanguage);
      
      if (translation) {
        // Cache the translation
        if (this.config.cacheTranslations) {
          this.cacheTranslation(this.currentLanguage, key, translation);
        }
        return this.interpolateParams(translation, params);
      }

      // Fallback to fallback language
      if (this.currentLanguage !== this.config.fallbackLanguage) {
        const fallbackTranslation = await this.getTranslation(key, this.config.fallbackLanguage);
        if (fallbackTranslation) {
          return this.interpolateParams(fallbackTranslation, params);
        }
      }

      // For recommendation-specific keys, return the original text if available
      if (key.startsWith('recommendation.') && params?.original) {
        return params.original;
      }

      // Return the key itself as last resort
      console.warn(`Translation not found for key: ${key}`);
      return key;
    } catch (error) {
      console.error('Error translating:', error);
      // For recommendation-specific keys, return the original text if available
      if (key.startsWith('recommendation.') && params?.original) {
        return params.original;
      }
      return key;
    }
  }

  /**
   * Translate recommendation content
   */
  async translateRecommendation(recommendation: any): Promise<any> {
    try {
      const translated = { ...recommendation };

      // Translate basic fields (will fall back to original text if no translation exists)
      if (recommendation.title) {
        translated.title = await this.translate(`recommendation.title.${recommendation.id}`, {
          original: recommendation.title
        });
      }

      if (recommendation.subtitle) {
        translated.subtitle = await this.translate(`recommendation.subtitle.${recommendation.id}`, {
          original: recommendation.subtitle
        });
      }

      if (recommendation.copy?.oneLiner) {
        translated.copy = {
          ...recommendation.copy,
          oneLiner: await this.translate(`recommendation.oneLiner.${recommendation.id}`, {
            original: recommendation.copy.oneLiner
          })
        };
      }

      if (recommendation.copy?.tip) {
        translated.copy = {
          ...translated.copy,
          tip: await this.translate(`recommendation.tip.${recommendation.id}`, {
            original: recommendation.copy.tip
          })
        };
      }

      // Translate category
      if (recommendation.category) {
        const categoryTranslation = await this.translate(`category.${recommendation.category}`);
        // Only use translation if it's different from the key (meaning translation exists)
        if (categoryTranslation !== `category.${recommendation.category}`) {
          translated.category = categoryTranslation;
        }
      }

      return translated;
    } catch (error) {
      console.error('Error translating recommendation:', error);
      return recommendation;
    }
  }

  /**
   * Translate multiple recommendations
   */
  async translateRecommendations(recommendations: any[]): Promise<any[]> {
    try {
      const translatedPromises = recommendations.map(rec => this.translateRecommendation(rec));
      return await Promise.all(translatedPromises);
    } catch (error) {
      console.error('Error translating recommendations:', error);
      return recommendations;
    }
  }

  /**
   * Get translation for a specific key and language
   */
  private async getTranslation(key: string, language: string): Promise<string | null> {
    try {
      // This would typically call a translation API or load from local files
      // For now, we'll use a simple mapping approach
      
      const translations = this.getBuiltInTranslations();
      return translations[language]?.[key] || null;
    } catch (error) {
      console.error('Error getting translation:', error);
      return null;
    }
  }

  /**
   * Get built-in translations (in a real app, these would come from a translation service)
   */
  private getBuiltInTranslations(): Record<string, Record<string, string>> {
    return {
      en: {
        'category.restaurant': 'Restaurant',
        'category.entertainment': 'Entertainment',
        'category.shopping': 'Shopping',
        'category.outdoor': 'Outdoor',
        'category.culture': 'Culture',
        'category.nightlife': 'Nightlife',
        'category.fitness': 'Fitness',
        'category.wellness': 'Wellness',
        'recommendation.loading': 'Loading recommendations...',
        'recommendation.error': 'Failed to load recommendations',
        'recommendation.no_results': 'No recommendations found',
        'recommendation.save': 'Save',
        'recommendation.share': 'Share',
        'recommendation.like': 'Like',
        'recommendation.dislike': 'Dislike',
        'analytics.overview': 'Overview',
        'analytics.engagement': 'Engagement',
        'analytics.preferences': 'Preferences',
        'analytics.behavior': 'Behavior',
        'analytics.recommendations': 'Recommendations',
        'analytics.social': 'Social',
        'cache.management': 'Cache Management',
        'cache.clear': 'Clear Cache',
        'cache.optimize': 'Optimize Cache',
        'cache.stats': 'Cache Statistics'
      },
      es: {
        'category.restaurant': 'Restaurante',
        'category.entertainment': 'Entretenimiento',
        'category.shopping': 'Compras',
        'category.outdoor': 'Exterior',
        'category.culture': 'Cultura',
        'category.nightlife': 'Vida Nocturna',
        'category.fitness': 'Fitness',
        'category.wellness': 'Bienestar',
        'recommendation.loading': 'Cargando recomendaciones...',
        'recommendation.error': 'Error al cargar recomendaciones',
        'recommendation.no_results': 'No se encontraron recomendaciones',
        'recommendation.save': 'Guardar',
        'recommendation.share': 'Compartir',
        'recommendation.like': 'Me gusta',
        'recommendation.dislike': 'No me gusta',
        'analytics.overview': 'Resumen',
        'analytics.engagement': 'Participación',
        'analytics.preferences': 'Preferencias',
        'analytics.behavior': 'Comportamiento',
        'analytics.recommendations': 'Recomendaciones',
        'analytics.social': 'Social',
        'cache.management': 'Gestión de Caché',
        'cache.clear': 'Limpiar Caché',
        'cache.optimize': 'Optimizar Caché',
        'cache.stats': 'Estadísticas de Caché'
      },
      fr: {
        'category.restaurant': 'Restaurant',
        'category.entertainment': 'Divertissement',
        'category.shopping': 'Shopping',
        'category.outdoor': 'Extérieur',
        'category.culture': 'Culture',
        'category.nightlife': 'Vie Nocturne',
        'category.fitness': 'Fitness',
        'category.wellness': 'Bien-être',
        'recommendation.loading': 'Chargement des recommandations...',
        'recommendation.error': 'Échec du chargement des recommandations',
        'recommendation.no_results': 'Aucune recommandation trouvée',
        'recommendation.save': 'Enregistrer',
        'recommendation.share': 'Partager',
        'recommendation.like': 'J\'aime',
        'recommendation.dislike': 'Je n\'aime pas',
        'analytics.overview': 'Aperçu',
        'analytics.engagement': 'Engagement',
        'analytics.preferences': 'Préférences',
        'analytics.behavior': 'Comportement',
        'analytics.recommendations': 'Recommandations',
        'analytics.social': 'Social',
        'cache.management': 'Gestion du Cache',
        'cache.clear': 'Vider le Cache',
        'cache.optimize': 'Optimiser le Cache',
        'cache.stats': 'Statistiques du Cache'
      }
    };
  }

  /**
   * Detect device language
   */
  private async detectDeviceLanguage(): Promise<string> {
    try {
      // In React Native, you would use react-native-localize or similar
      // For now, we'll return a default
      const deviceLang = this.deviceLanguage || 'en';
      return this.isLanguageSupported(deviceLang) ? deviceLang : this.config.defaultLanguage;
    } catch (error) {
      console.error('Error detecting device language:', error);
      return this.config.defaultLanguage;
    }
  }

  /**
   * Check if language is supported
   */
  private isLanguageSupported(languageCode: string): boolean {
    return this.config.supportedLanguages.some(lang => lang.code === languageCode);
  }

  /**
   * Load translations for a specific language
   */
  private async loadLanguageTranslations(languageCode: string): Promise<void> {
    try {
      // In a real app, this would load from a translation API or local files
      const translations = this.getBuiltInTranslations();
      this.translationCache[languageCode] = translations[languageCode] || {};
    } catch (error) {
      console.error('Error loading language translations:', error);
    }
  }

  /**
   * Load translation cache from storage
   */
  private async loadTranslationCache(): Promise<void> {
    try {
      const cached = await AsyncStorage.getItem('translation_cache');
      if (cached) {
        this.translationCache = JSON.parse(cached);
      }
    } catch (error) {
      console.error('Error loading translation cache:', error);
    }
  }

  /**
   * Save translation cache to storage
   */
  private async saveTranslationCache(): Promise<void> {
    try {
      await AsyncStorage.setItem('translation_cache', JSON.stringify(this.translationCache));
    } catch (error) {
      console.error('Error saving translation cache:', error);
    }
  }

  /**
   * Cache a translation
   */
  private cacheTranslation(language: string, key: string, value: string): void {
    if (!this.translationCache[language]) {
      this.translationCache[language] = {};
    }
    this.translationCache[language][key] = value;
    
    // Save to storage periodically
    this.saveTranslationCache();
  }

  /**
   * Interpolate parameters in translation string
   */
  private interpolateParams(translation: string, params?: Record<string, any>): string {
    if (!params) return translation;

    return translation.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return params[key] !== undefined ? String(params[key]) : match;
    });
  }

  /**
   * Get language direction (LTR/RTL)
   */
  getLanguageDirection(): 'ltr' | 'rtl' {
    const language = this.config.supportedLanguages.find(lang => lang.code === this.currentLanguage);
    return language?.rtl ? 'rtl' : 'ltr';
  }

  /**
   * Get current language info
   */
  getCurrentLanguageInfo(): Language | null {
    return this.config.supportedLanguages.find(lang => lang.code === this.currentLanguage) || null;
  }

  /**
   * Clear translation cache
   */
  async clearTranslationCache(): Promise<void> {
    try {
      this.translationCache = {};
      await AsyncStorage.removeItem('translation_cache');
    } catch (error) {
      console.error('Error clearing translation cache:', error);
    }
  }
}

export const translationService = new TranslationService();
