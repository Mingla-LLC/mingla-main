#!/usr/bin/env python3
"""
ORCH-0670 Slice A — Discover screen i18n parity pass.

Adds 10 new keys with native translations across all 28 non-en locales,
and deletes 14 orphan keys (verified zero consumers in app-mobile/src) from
all 29 locale files (en already done in-place by editor).

Idempotent: re-runs are no-ops once locales are in sync.

Run from project root:
    python3 scripts/orch-0670-translate-locales.py
"""

import json
from pathlib import Path

LOCALES_DIR = Path("app-mobile/src/i18n/locales")

# 14 orphan keys to delete from every locale (en included for safety re-run).
# Verified zero consumers via grep across app-mobile/src on 2026-04-28.
ORPHAN_KEYS = [
    "empty.no_events",
    "empty.no_events_nearby",
    "empty.no_matching",
    "empty.no_matching_filters",
    "empty.show_all_parties",
    "empty.adjust_preferences",
    "empty.no_experiences",
    "error.try_again",
    "loading.for_you",
    "loading.nightlife",
    "nightout.on_sale",
    "nightout.sold_out",
    "nightout.soon",
    "nightout.tba",
]

# 10 new keys × 28 non-en locales = 280 translations.
# Native quality — manually curated. No interpolation tokens in this set.
TRANSLATIONS = {
    "title": {
        "ar": "فعاليات",
        "bin": "Akpata",
        "bn": "ইভেন্ট",
        "de": "Events",
        "el": "Εκδηλώσεις",
        "es": "Eventos",
        "fr": "Événements",
        "ha": "Abubuwan",
        "he": "אירועים",
        "hi": "इवेंट्स",
        "id": "Acara",
        "ig": "Ihe omume",
        "it": "Eventi",
        "ja": "イベント",
        "ko": "이벤트",
        "ms": "Acara",
        "nl": "Evenementen",
        "pl": "Wydarzenia",
        "pt": "Eventos",
        "ro": "Evenimente",
        "ru": "События",
        "sv": "Evenemang",
        "th": "กิจกรรม",
        "tr": "Etkinlikler",
        "uk": "Події",
        "vi": "Sự kiện",
        "yo": "Awọn iṣẹlẹ",
        "zh": "活动",
    },
    "error.subtitle": {
        "ar": "اسحب للأسفل لإعادة المحاولة، أو تحقق من اتصالك.",
        "bin": "Khu hin gha rhulẹ rọ vbe ye, ya gba na ye konexion.",
        "bn": "পুনরায় চেষ্টা করতে নিচে টানুন বা আপনার সংযোগ পরীক্ষা করুন।",
        "de": "Nach unten ziehen, um erneut zu versuchen, oder Verbindung prüfen.",
        "el": "Σύρετε προς τα κάτω για να δοκιμάσετε ξανά ή ελέγξτε τη σύνδεσή σας.",
        "es": "Desliza hacia abajo para reintentar o verifica tu conexión.",
        "fr": "Tirez vers le bas pour réessayer ou vérifiez votre connexion.",
        "ha": "Ja ƙasa don sake gwadawa, ko duba haɗin ka.",
        "he": "גרור מטה כדי לנסות שוב, או בדוק את החיבור שלך.",
        "hi": "पुनः प्रयास करने के लिए नीचे खींचें, या अपना कनेक्शन जांचें।",
        "id": "Tarik ke bawah untuk mencoba lagi, atau periksa koneksi Anda.",
        "ig": "Dọrọ ala iji gbalịa ọzọ, ma ọ bụ lelee njikọ gị.",
        "it": "Tira verso il basso per riprovare o controlla la connessione.",
        "ja": "下に引っ張って再試行するか、接続を確認してください。",
        "ko": "아래로 당겨서 다시 시도하거나 연결을 확인하세요.",
        "ms": "Tarik ke bawah untuk cuba lagi, atau semak sambungan anda.",
        "nl": "Trek omlaag om opnieuw te proberen, of controleer je verbinding.",
        "pl": "Pociągnij w dół, aby spróbować ponownie, lub sprawdź połączenie.",
        "pt": "Puxe para baixo para tentar novamente ou verifique sua conexão.",
        "ro": "Trage în jos pentru a reîncerca sau verifică conexiunea.",
        "ru": "Потяните вниз, чтобы повторить, или проверьте соединение.",
        "sv": "Dra nedåt för att försöka igen, eller kontrollera anslutningen.",
        "th": "ดึงลงเพื่อลองอีกครั้ง หรือตรวจสอบการเชื่อมต่อของคุณ",
        "tr": "Tekrar denemek için aşağı çekin veya bağlantınızı kontrol edin.",
        "uk": "Потягніть вниз, щоб повторити, або перевірте з'єднання.",
        "vi": "Kéo xuống để thử lại hoặc kiểm tra kết nối của bạn.",
        "yo": "Fa silẹ lati gbiyanju lẹẹkansi, tabi ṣayẹwo asopọ rẹ.",
        "zh": "下拉以重试，或检查您的连接。",
    },
    "empty.no_events_title": {
        "ar": "لا توجد فعاليات بالقرب منك الليلة",
        "bin": "I rri ọkpa ye ehe ọmwa na vbe asọn",
        "bn": "আজ রাতে আপনার কাছাকাছি কোনো ইভেন্ট নেই",
        "de": "Heute Abend keine Events in deiner Nähe",
        "el": "Καμία εκδήλωση κοντά σας απόψε",
        "es": "No hay eventos cerca de ti esta noche",
        "fr": "Aucun événement près de chez vous ce soir",
        "ha": "Babu abubuwan da ke kusa da kai a daren yau",
        "he": "אין אירועים בקרבתך הלילה",
        "hi": "आज रात आपके पास कोई इवेंट नहीं है",
        "id": "Tidak ada acara di dekat Anda malam ini",
        "ig": "Enweghị ihe omume gbara gị gburugburu n'abalị a",
        "it": "Nessun evento vicino a te stasera",
        "ja": "今夜近くにイベントはありません",
        "ko": "오늘 밤 근처에 이벤트가 없습니다",
        "ms": "Tiada acara berdekatan anda malam ini",
        "nl": "Geen evenementen in de buurt vanavond",
        "pl": "Brak wydarzeń w pobliżu dzisiaj wieczorem",
        "pt": "Sem eventos perto de você esta noite",
        "ro": "Niciun eveniment lângă tine în seara asta",
        "ru": "Сегодня вечером нет событий поблизости",
        "sv": "Inga evenemang nära dig i kväll",
        "th": "ไม่มีงานใกล้คุณคืนนี้",
        "tr": "Bu gece yakınınızda etkinlik yok",
        "uk": "Сьогодні ввечері поблизу немає подій",
        "vi": "Không có sự kiện gần bạn tối nay",
        "yo": "Ko si awọn iṣẹlẹ nitosi rẹ ni alẹ yii",
        "zh": "今晚你附近没有活动",
    },
    "empty.no_events_subtitle": {
        "ar": "جرب نطاقًا زمنيًا أوسع أو أجواء مختلفة.",
        "bin": "Tan ighedu nọ ye gha hiọn, ra avbe ọkpa.",
        "bn": "বৃহত্তর তারিখ পরিসর বা ভিন্ন ভাব চেষ্টা করুন।",
        "de": "Versuche einen größeren Zeitraum oder einen anderen Vibe.",
        "el": "Δοκιμάστε ευρύτερο εύρος ημερομηνιών ή διαφορετική ατμόσφαιρα.",
        "es": "Prueba un rango de fechas más amplio o un ambiente diferente.",
        "fr": "Essayez une plage de dates plus large ou une autre ambiance.",
        "ha": "Gwada faffadan kewayon kwanaki ko motsi daban.",
        "he": "נסה טווח תאריכים רחב יותר או אווירה אחרת.",
        "hi": "व्यापक तारीख सीमा या अलग वाइब आज़माएं।",
        "id": "Coba rentang tanggal yang lebih luas atau suasana berbeda.",
        "ig": "Gbalịa oge sara mbara ma ọ bụ ụdị dị iche.",
        "it": "Prova un intervallo di date più ampio o un'altra atmosfera.",
        "ja": "日付範囲を広げるか、違う雰囲気を試してみて。",
        "ko": "더 넓은 날짜 범위나 다른 분위기를 시도해 보세요.",
        "ms": "Cuba julat tarikh yang lebih luas atau suasana berbeza.",
        "nl": "Probeer een ruimer datumbereik of een andere sfeer.",
        "pl": "Spróbuj szerszego zakresu dat lub innego klimatu.",
        "pt": "Experimente um intervalo de datas maior ou outro clima.",
        "ro": "Încearcă un interval de date mai larg sau o atmosferă diferită.",
        "ru": "Попробуйте более широкий диапазон дат или другую атмосферу.",
        "sv": "Prova ett bredare datumintervall eller en annan stämning.",
        "th": "ลองช่วงวันที่กว้างขึ้นหรือบรรยากาศอื่น",
        "tr": "Daha geniş bir tarih aralığı veya farklı bir hava deneyin.",
        "uk": "Спробуйте ширший діапазон дат або іншу атмосферу.",
        "vi": "Thử khoảng ngày rộng hơn hoặc không khí khác.",
        "yo": "Gbiyanju ibiti ọjọ gbooro tabi iṣesi yatọ.",
        "zh": "试试更宽的日期范围或不同氛围。",
    },
    "empty.expand_radius": {
        "ar": "حاول مرة أخرى",
        "bin": "Ye vbe",
        "bn": "আবার চেষ্টা করুন",
        "de": "Erneut versuchen",
        "el": "Δοκιμάστε ξανά",
        "es": "Reintentar",
        "fr": "Réessayer",
        "ha": "Sake gwadawa",
        "he": "נסה שוב",
        "hi": "पुनः प्रयास करें",
        "id": "Coba lagi",
        "ig": "Nwaa ọzọ",
        "it": "Riprova",
        "ja": "再試行",
        "ko": "다시 시도",
        "ms": "Cuba lagi",
        "nl": "Opnieuw proberen",
        "pl": "Spróbuj ponownie",
        "pt": "Tentar novamente",
        "ro": "Reîncearcă",
        "ru": "Повторить",
        "sv": "Försök igen",
        "th": "ลองอีกครั้ง",
        "tr": "Tekrar dene",
        "uk": "Спробувати ще раз",
        "vi": "Thử lại",
        "yo": "Gbiyanju lẹẹkansi",
        "zh": "重试",
    },
    "empty.no_match_title": {
        "ar": "لا توجد فعاليات تطابق المرشحات",
        "bin": "I rri okhuo nọ na hian ye filtas ne ọ ya",
        "bn": "আপনার ফিল্টারের সাথে কোনো ইভেন্ট মেলেনি",
        "de": "Keine Events stimmen mit deinen Filtern überein",
        "el": "Καμία εκδήλωση δεν ταιριάζει με τα φίλτρα σας",
        "es": "Ningún evento coincide con tus filtros",
        "fr": "Aucun événement ne correspond à vos filtres",
        "ha": "Babu abubuwa da suka dace da matatun ku",
        "he": "אין אירועים שתואמים את המסננים שלך",
        "hi": "आपके फ़िल्टर से कोई इवेंट मेल नहीं खाता",
        "id": "Tidak ada acara yang cocok dengan filter Anda",
        "ig": "Enweghị ihe omume dabara na nzacha gị",
        "it": "Nessun evento corrisponde ai tuoi filtri",
        "ja": "フィルターに一致するイベントはありません",
        "ko": "필터에 맞는 이벤트가 없습니다",
        "ms": "Tiada acara sepadan dengan penapis anda",
        "nl": "Geen evenementen die voldoen aan je filters",
        "pl": "Brak wydarzeń pasujących do filtrów",
        "pt": "Nenhum evento corresponde aos seus filtros",
        "ro": "Niciun eveniment nu se potrivește cu filtrele tale",
        "ru": "Нет событий, соответствующих фильтрам",
        "sv": "Inga evenemang matchar dina filter",
        "th": "ไม่มีงานที่ตรงกับตัวกรองของคุณ",
        "tr": "Filtrelerinize uyan etkinlik yok",
        "uk": "Немає подій, що відповідають фільтрам",
        "vi": "Không có sự kiện nào khớp với bộ lọc của bạn",
        "yo": "Ko si iṣẹlẹ ti o baamu awọn àlẹmọ rẹ",
        "zh": "没有符合您筛选条件的活动",
    },
    "empty.no_match_subtitle": {
        "ar": "اضبط المرشحات أو أعد الضبط لمشاهدة المزيد.",
        "bin": "Tan filtas ra rhulẹ ne ọ na bie nọkharha.",
        "bn": "আরও দেখতে ফিল্টার সমন্বয় করুন বা রিসেট করুন।",
        "de": "Passe Filter an oder setze sie zurück für mehr Ergebnisse.",
        "el": "Προσαρμόστε τα φίλτρα ή επαναφέρετε για περισσότερα.",
        "es": "Ajusta los filtros o restablece para ver más.",
        "fr": "Ajustez les filtres ou réinitialisez pour voir plus.",
        "ha": "Daidaita matata ko sake saiti don ganin ƙarin.",
        "he": "התאם מסננים או אפס כדי לראות עוד.",
        "hi": "अधिक देखने के लिए फ़िल्टर समायोजित करें या रीसेट करें।",
        "id": "Sesuaikan filter atau atur ulang untuk melihat lebih banyak.",
        "ig": "Megharịa nzacha ma ọ bụ tọgharịa iji hụ karịa.",
        "it": "Modifica i filtri o reimposta per vedere altro.",
        "ja": "フィルターを調整するかリセットしてもっと表示。",
        "ko": "더 보려면 필터를 조정하거나 재설정하세요.",
        "ms": "Laraskan penapis atau set semula untuk lihat lagi.",
        "nl": "Pas filters aan of herstel om meer te zien.",
        "pl": "Dostosuj filtry lub zresetuj, aby zobaczyć więcej.",
        "pt": "Ajuste os filtros ou redefina para ver mais.",
        "ro": "Ajustează filtrele sau resetează pentru a vedea mai mult.",
        "ru": "Настройте фильтры или сбросьте, чтобы увидеть больше.",
        "sv": "Justera filter eller återställ för att se fler.",
        "th": "ปรับตัวกรองหรือรีเซ็ตเพื่อดูเพิ่มเติม",
        "tr": "Daha fazlası için filtreleri ayarlayın veya sıfırlayın.",
        "uk": "Налаштуйте фільтри або скиньте, щоб побачити більше.",
        "vi": "Điều chỉnh bộ lọc hoặc đặt lại để xem thêm.",
        "yo": "Ṣatunṣe àwọn àlẹmọ tabi tunto lati ri diẹ sii.",
        "zh": "调整或重置筛选条件以查看更多。",
    },
    "empty.reset_filters": {
        "ar": "إعادة تعيين المرشحات",
        "bin": "Rhulẹ filtas",
        "bn": "ফিল্টার রিসেট করুন",
        "de": "Filter zurücksetzen",
        "el": "Επαναφορά φίλτρων",
        "es": "Restablecer filtros",
        "fr": "Réinitialiser les filtres",
        "ha": "Sake saiti matata",
        "he": "אפס מסננים",
        "hi": "फ़िल्टर रीसेट करें",
        "id": "Atur ulang filter",
        "ig": "Tọgharịa nzacha",
        "it": "Reimposta filtri",
        "ja": "フィルターをリセット",
        "ko": "필터 재설정",
        "ms": "Set semula penapis",
        "nl": "Filters herstellen",
        "pl": "Zresetuj filtry",
        "pt": "Redefinir filtros",
        "ro": "Resetează filtrele",
        "ru": "Сбросить фильтры",
        "sv": "Återställ filter",
        "th": "รีเซ็ตตัวกรอง",
        "tr": "Filtreleri sıfırla",
        "uk": "Скинути фільтри",
        "vi": "Đặt lại bộ lọc",
        "yo": "Tunto àwọn àlẹmọ",
        "zh": "重置筛选",
    },
    "filters.all_dates_short": {
        "ar": "الكل",
        "bin": "Hia",
        "bn": "সব",
        "de": "Alle",
        "el": "Όλα",
        "es": "Todo",
        "fr": "Tout",
        "ha": "Duka",
        "he": "הכל",
        "hi": "सब",
        "id": "Semua",
        "ig": "Ha niile",
        "it": "Tutto",
        "ja": "すべて",
        "ko": "전체",
        "ms": "Semua",
        "nl": "Alle",
        "pl": "Wszystko",
        "pt": "Tudo",
        "ro": "Tot",
        "ru": "Все",
        "sv": "Alla",
        "th": "ทั้งหมด",
        "tr": "Tümü",
        "uk": "Усі",
        "vi": "Tất cả",
        "yo": "Gbogbo",
        "zh": "全部",
    },
    "filters.tonight": {
        "ar": "الليلة",
        "bin": "Asọn na",
        "bn": "আজ রাতে",
        "de": "Heute Abend",
        "el": "Απόψε",
        "es": "Esta noche",
        "fr": "Ce soir",
        "ha": "Yau dare",
        "he": "הערב",
        "hi": "आज रात",
        "id": "Malam ini",
        "ig": "Anyasị a",
        "it": "Stasera",
        "ja": "今夜",
        "ko": "오늘 밤",
        "ms": "Malam ini",
        "nl": "Vanavond",
        "pl": "Dziś wieczorem",
        "pt": "Esta noite",
        "ro": "La noapte",
        "ru": "Сегодня вечером",
        "sv": "I kväll",
        "th": "คืนนี้",
        "tr": "Bu gece",
        "uk": "Сьогодні ввечері",
        "vi": "Tối nay",
        "yo": "Ni alẹ yii",
        "zh": "今晚",
    },
}


def main() -> None:
    locales = sorted(d.name for d in LOCALES_DIR.iterdir() if d.is_dir() and d.name != "en")
    if len(locales) != 28:
        print(f"WARN: expected 28 non-en locales, found {len(locales)}: {locales}")

    total_added = 0
    total_deleted = 0

    for locale in locales:
        locale_file = LOCALES_DIR / locale / "discover.json"
        if not locale_file.exists():
            print(f"SKIP: {locale_file} missing")
            continue

        with locale_file.open("r", encoding="utf-8") as f:
            data = json.load(f)

        added = 0
        for key, locale_map in TRANSLATIONS.items():
            translated = locale_map.get(locale)
            if translated is None:
                print(f"WARN: no {locale} translation for key {key}; skipping")
                continue
            if data.get(key) == translated:
                continue
            data[key] = translated
            added += 1

        deleted = 0
        for orphan in ORPHAN_KEYS:
            if orphan in data:
                del data[orphan]
                deleted += 1

        with locale_file.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")  # trailing newline

        total_added += added
        total_deleted += deleted
        print(f"{locale}: +{added} keys, -{deleted} orphans")

    print(f"\nTotal: +{total_added} translations across {len(locales)} locales, -{total_deleted} orphans cleaned.")


if __name__ == "__main__":
    main()
