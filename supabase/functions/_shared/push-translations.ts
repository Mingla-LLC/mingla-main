// supabase/functions/_shared/push-translations.ts
//
// Server-side push notification translations.
// Push notifications are rendered by the OS outside the app,
// so they cannot use the client-side i18n system.
//
// Each notification type has a title/body template per language.
// Templates use {{variable}} placeholders filled at send time.

interface TranslationEntry {
  title: string;
  body: string;
}

type TranslationMap = Record<string, Record<string, TranslationEntry>>;

const translations: TranslationMap = {
  // ── Friend / pair requests ───────────────────────────────────────────────
  friend_request_received: {
    en: {
      title: "{{name}} wants to connect",
      body: "Tap to accept or pass.",
    },
    es: {
      title: "{{name}} quiere conectar contigo",
      body: "Toca para aceptar o pasar.",
    },
  },
  friend_request_accepted: {
    en: {
      title: "{{name}} accepted your request",
      body: "You're now connected — start planning together!",
    },
    es: {
      title: "{{name}} aceptó tu solicitud",
      body: "Ya están conectados — ¡empiecen a planear juntos!",
    },
  },
  pair_request_received: {
    en: {
      title: "{{name}} wants to pair with you",
      body: "Accept to discover experiences for each other.",
    },
    es: {
      title: "{{name}} quiere emparejarse contigo",
      body: "Acepta para descubrir experiencias el uno para el otro.",
    },
  },
  pair_request_accepted: {
    en: {
      title: "{{name}} accepted your pair request",
      body: "You're now paired — explore together!",
    },
    es: {
      title: "{{name}} aceptó tu solicitud de pareja",
      body: "Ya están emparejados — ¡exploren juntos!",
    },
  },

  // ── Pair activity ────────────────────────────────────────────────────────
  paired_user_saved_card: {
    en: {
      title: "{{name}} found something for you",
      body: 'They saved "{{cardName}}" — take a look.',
    },
    es: {
      title: "{{name}} encontró algo para ti",
      body: 'Guardó "{{cardName}}" — échale un vistazo.',
    },
  },
  paired_user_visited: {
    en: {
      title: "{{name}} visited a place",
      body: "{{name}} visited {{placeName}}",
    },
    es: {
      title: "{{name}} visitó un lugar",
      body: "{{name}} visitó {{placeName}}",
    },
  },

  // ── Collaboration ────────────────────────────────────────────────────────
  collaboration_invite_received: {
    en: {
      title: "{{name}} invited you",
      body: 'Join "{{sessionName}}" and start swiping together.',
    },
    es: {
      title: "{{name}} te invitó",
      body: 'Únete a "{{sessionName}}" y empiecen a deslizar juntos.',
    },
  },
  collaboration_invite_accepted: {
    en: {
      title: "{{name}} is in!",
      body: 'They joined "{{sessionName}}." Time to plan.',
    },
    es: {
      title: "¡{{name}} se unió!",
      body: 'Se unió a "{{sessionName}}." Hora de planear.',
    },
  },
  collaboration_invite_declined: {
    en: {
      title: "{{name}} can't make it",
      body: 'They passed on "{{sessionName}}." Invite someone else?',
    },
    es: {
      title: "{{name}} no puede",
      body: 'Pasó de "{{sessionName}}." ¿Invitar a alguien más?',
    },
  },

  // ── Messaging ────────────────────────────────────────────────────────────
  direct_message_received: {
    en: {
      title: "{{senderName}}",
      body: "{{messagePreview}}",
    },
    es: {
      title: "{{senderName}}",
      body: "{{messagePreview}}",
    },
  },
  board_message_received: {
    en: {
      title: "{{senderName}} in {{sessionName}}",
      body: "{{messagePreview}}",
    },
    es: {
      title: "{{senderName}} en {{sessionName}}",
      body: "{{messagePreview}}",
    },
  },
  board_message_mention: {
    en: {
      title: "{{senderName}} mentioned you",
      body: 'in "{{sessionName}}": {{messagePreview}}',
    },
    es: {
      title: "{{senderName}} te mencionó",
      body: 'en "{{sessionName}}": {{messagePreview}}',
    },
  },
  board_card_message: {
    en: {
      title: "{{senderName}} commented on {{cardName}}",
      body: "{{messagePreview}}",
    },
    es: {
      title: "{{senderName}} comentó en {{cardName}}",
      body: "{{messagePreview}}",
    },
  },

  // ── Calendar / reminders ─────────────────────────────────────────────────
  calendar_reminder_tomorrow: {
    en: {
      title: "Tomorrow: {{experienceName}}",
      body: "Don't forget — {{experienceName}} is tomorrow{{timeClause}}.",
    },
    es: {
      title: "Mañana: {{experienceName}}",
      body: "No olvides — {{experienceName}} es mañana{{timeClause}}.",
    },
  },
  calendar_reminder_today: {
    en: {
      title: "Today: {{experienceName}}",
      body: "Enjoy your experience{{timeClause}}!",
    },
    es: {
      title: "Hoy: {{experienceName}}",
      body: "¡Disfruta tu experiencia{{timeClause}}!",
    },
  },
  visit_feedback_prompt: {
    en: {
      title: "How was {{experienceName}}?",
      body: "Leave a quick review — it helps your future recommendations.",
    },
    es: {
      title: "¿Qué tal {{experienceName}}?",
      body: "Deja una reseña rápida — mejora tus futuras recomendaciones.",
    },
  },
  holiday_reminder: {
    en: {
      title: "Tomorrow is {{personName}}'s {{holidayName}}!",
      body: "Don't forget to plan something special.",
    },
    es: {
      title: "¡Mañana es el {{holidayName}} de {{personName}}!",
      body: "No olvides planear algo especial.",
    },
  },

  // ── Re-engagement / marketing ────────────────────────────────────────────
  re_engagement: {
    en: {
      title: "You're almost there",
      body: "Finish setting up and start discovering experiences.",
    },
    es: {
      title: "Ya casi estás",
      body: "Termina de configurar y empieza a descubrir experiencias.",
    },
  },
  re_engagement_3d: {
    en: {
      title: "New experiences near you",
      body: "Come back and see what's new.",
    },
    es: {
      title: "Nuevas experiencias cerca de ti",
      body: "Vuelve y descubre lo nuevo.",
    },
  },
  re_engagement_7d: {
    en: {
      title: "Miss you on Mingla",
      body: "New experiences are waiting for you.",
    },
    es: {
      title: "Te extrañamos en Mingla",
      body: "Nuevas experiencias te esperan.",
    },
  },
  weekly_digest: {
    en: {
      title: "Your week on Mingla",
      body: "{{digestBody}}",
    },
    es: {
      title: "Tu semana en Mingla",
      body: "{{digestBody}}",
    },
  },
  referral_credited: {
    en: {
      title: "You earned a free month!",
      body: "{{name}} joined Mingla from your invite.",
    },
    es: {
      title: "¡Ganaste un mes gratis!",
      body: "{{name}} se unió a Mingla desde tu invitación.",
    },
  },
};

/**
 * Returns translated title and body for a push notification.
 *
 * - Falls back to 'en' if the requested language isn't available.
 * - Returns null if the notification type isn't in the translation map
 *   (caller should use the original English strings).
 * - Replaces all {{variable}} placeholders with values from `variables`.
 *   Missing variables are replaced with empty string to avoid broken templates.
 * - Never throws — all errors are caught and logged, returning null.
 */
export function getTranslatedNotification(
  type: string,
  language: string,
  variables: Record<string, string>,
): { title: string; body: string } | null {
  try {
    const typeTranslations = translations[type];
    if (!typeTranslations) {
      return null;
    }

    // Use requested language, fall back to English
    const entry = typeTranslations[language] ?? typeTranslations["en"];
    if (!entry) {
      return null;
    }

    const interpolate = (template: string): string =>
      template.replace(/\{\{(\w+)\}\}/g, (_match, key) => variables[key] ?? "");

    return {
      title: interpolate(entry.title),
      body: interpolate(entry.body),
    };
  } catch (err) {
    console.warn("[push-translations] Translation failed:", { type, language, err });
    return null;
  }
}
