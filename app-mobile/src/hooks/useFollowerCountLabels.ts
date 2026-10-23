import { formatFollowerCountA11y } from '@mingla/offering-rendering/followerCount';
import type { FollowerCountLabels } from '@mingla/offering-rendering/FollowerCountLine';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export function useFollowerCountLabels(): FollowerCountLabels {
  const { t, i18n } = useTranslation('followers');
  const language = (i18n.resolvedLanguage ?? i18n.language ?? 'en').split('-')[0];

  return useMemo(
    () => ({
      zero: t('first'),
      line: (count: number, formatted: string) =>
        t('count', { count, formatted }),
      a11y: (count: number, formatted: string) => {
        if (count === 0) return t('a11y_none');
        if (count < 1_000) return t('a11y_exact', { count });
        if (language === 'en') {
          return formatFollowerCountA11y(count) ?? t('a11y_approx', { formatted });
        }
        return t('a11y_approx', { count, formatted });
      },
    }),
    [language, t],
  );
}
