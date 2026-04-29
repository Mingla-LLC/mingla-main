#!/usr/bin/env python3
"""
ORCH-0690 — translate 9 new picker-related keys into 28 non-en locales.
Run from project root: python3 scripts/orch-0690-translate-locales.py
"""

import json
import os
from pathlib import Path

LOCALES_DIR = Path("app-mobile/src/i18n/locales")
EN_FILE = LOCALES_DIR / "en" / "expanded_details.json"

# 9 new keys + their translations across 28 locales.
# Translations sourced manually for native quality. {{date}} and {{venueName}} are i18next interpolations — preserved verbatim.
TRANSLATIONS = {
    "back_to_date": {
        "ar": "العودة إلى التاريخ",
        "bin": "Gha rhulẹ ye ẹdẹ",
        "bn": "তারিখে ফিরুন",
        "de": "Zurück zum Datum",
        "el": "Πίσω στην ημερομηνία",
        "es": "Volver a fecha",
        "fr": "Retour à la date",
        "ha": "Komawa kwanan wata",
        "he": "חזרה לתאריך",
        "hi": "तारीख पर वापस",
        "id": "Kembali ke tanggal",
        "ig": "Laghachi na ụbọchị",
        "it": "Torna alla data",
        "ja": "日付に戻る",
        "ko": "날짜로 돌아가기",
        "ms": "Kembali ke tarikh",
        "nl": "Terug naar datum",
        "pl": "Wróć do daty",
        "pt": "Voltar à data",
        "ro": "Înapoi la dată",
        "ru": "Назад к дате",
        "sv": "Tillbaka till datum",
        "th": "กลับไปที่วันที่",
        "tr": "Tarihe dön",
        "uk": "Назад до дати",
        "vi": "Quay lại ngày",
        "yo": "Pada si ọjọ",
        "zh": "返回日期",
    },
    "confirm_date_title": {
        "ar": "تم اختيار التاريخ",
        "bin": "Ẹdẹ na zẹ",
        "bn": "তারিখ নির্বাচিত",
        "de": "Datum ausgewählt",
        "el": "Επιλέχθηκε η ημερομηνία",
        "es": "Fecha seleccionada",
        "fr": "Date sélectionnée",
        "ha": "An zaɓi ranar",
        "he": "התאריך נבחר",
        "hi": "तारीख चुनी गई",
        "id": "Tanggal dipilih",
        "ig": "Ahọrọla ụbọchị",
        "it": "Data selezionata",
        "ja": "日付を選択しました",
        "ko": "날짜가 선택됨",
        "ms": "Tarikh dipilih",
        "nl": "Datum geselecteerd",
        "pl": "Data wybrana",
        "pt": "Data selecionada",
        "ro": "Dată selectată",
        "ru": "Дата выбрана",
        "sv": "Datum valt",
        "th": "เลือกวันที่แล้ว",
        "tr": "Tarih seçildi",
        "uk": "Дату вибрано",
        "vi": "Đã chọn ngày",
        "yo": "Ti yan ọjọ",
        "zh": "已选择日期",
    },
    "confirm_date_message": {
        "ar": "لقد اخترت {{date}}. هل تريد المتابعة لاختيار الوقت؟",
        "bin": "U zẹ {{date}}. U khian gha kpe ye ẹgheghe ra?",
        "bn": "আপনি {{date}} বেছে নিয়েছেন। সময় নির্বাচনে এগিয়ে যাবেন?",
        "de": "Du hast {{date}} gewählt. Weiter zur Uhrzeit?",
        "el": "Επιλέξατε {{date}}. Συνέχεια στην επιλογή ώρας;",
        "es": "Elegiste {{date}}. ¿Continuar con la hora?",
        "fr": "Vous avez choisi {{date}}. Passer à la sélection de l'heure ?",
        "ha": "Ka zaɓi {{date}}. Ci gaba zuwa zaɓen lokaci?",
        "he": "בחרת ב-{{date}}. להמשיך לבחירת שעה?",
        "hi": "आपने {{date}} चुना। समय चयन पर जाएं?",
        "id": "Anda memilih {{date}}. Lanjut ke pemilihan waktu?",
        "ig": "Ị họọrọ {{date}}. Gaa n'ihu na nhọrọ oge?",
        "it": "Hai scelto {{date}}. Continuare con la selezione dell'ora?",
        "ja": "{{date}}を選択しました。時刻の選択に進みますか?",
        "ko": "{{date}}을(를) 선택했습니다. 시간 선택으로 진행할까요?",
        "ms": "Anda memilih {{date}}. Teruskan ke pemilihan masa?",
        "nl": "Je hebt {{date}} gekozen. Doorgaan naar tijd?",
        "pl": "Wybrałeś {{date}}. Kontynuować wybór godziny?",
        "pt": "Você escolheu {{date}}. Continuar para a seleção de hora?",
        "ro": "Ai ales {{date}}. Continui la selecția orei?",
        "ru": "Вы выбрали {{date}}. Перейти к выбору времени?",
        "sv": "Du valde {{date}}. Fortsätta till tidsval?",
        "th": "คุณเลือก {{date}} ดำเนินการต่อไปยังการเลือกเวลาหรือไม่?",
        "tr": "{{date}} seçtiniz. Saat seçimine devam edilsin mi?",
        "uk": "Ви вибрали {{date}}. Перейти до вибору часу?",
        "vi": "Bạn đã chọn {{date}}. Tiếp tục chọn giờ?",
        "yo": "O yan {{date}}. Tẹsiwaju si yiyan akoko?",
        "zh": "您选择了{{date}}。继续选择时间?",
    },
    "change_date": {
        "ar": "تغيير التاريخ",
        "bin": "Khian ẹdẹ",
        "bn": "তারিখ পরিবর্তন",
        "de": "Datum ändern",
        "el": "Αλλαγή ημερομηνίας",
        "es": "Cambiar fecha",
        "fr": "Changer la date",
        "ha": "Canza kwanan wata",
        "he": "שנה תאריך",
        "hi": "तारीख बदलें",
        "id": "Ubah tanggal",
        "ig": "Gbanwee ụbọchị",
        "it": "Cambia data",
        "ja": "日付を変更",
        "ko": "날짜 변경",
        "ms": "Tukar tarikh",
        "nl": "Datum wijzigen",
        "pl": "Zmień datę",
        "pt": "Alterar data",
        "ro": "Schimbă data",
        "ru": "Изменить дату",
        "sv": "Ändra datum",
        "th": "เปลี่ยนวันที่",
        "tr": "Tarihi değiştir",
        "uk": "Змінити дату",
        "vi": "Đổi ngày",
        "yo": "Yi ọjọ pada",
        "zh": "更改日期",
    },
    "pick_time": {
        "ar": "اختر الوقت",
        "bin": "Zẹ ẹgheghe",
        "bn": "সময় বেছে নিন",
        "de": "Uhrzeit wählen",
        "el": "Επιλέξτε ώρα",
        "es": "Elegir hora",
        "fr": "Choisir l'heure",
        "ha": "Zaɓi lokaci",
        "he": "בחר שעה",
        "hi": "समय चुनें",
        "id": "Pilih waktu",
        "ig": "Họrọ oge",
        "it": "Scegli l'ora",
        "ja": "時刻を選ぶ",
        "ko": "시간 선택",
        "ms": "Pilih masa",
        "nl": "Tijd kiezen",
        "pl": "Wybierz godzinę",
        "pt": "Escolher hora",
        "ro": "Alege ora",
        "ru": "Выбрать время",
        "sv": "Välj tid",
        "th": "เลือกเวลา",
        "tr": "Saat seç",
        "uk": "Вибрати час",
        "vi": "Chọn giờ",
        "yo": "Yan akoko",
        "zh": "选择时间",
    },
    "unverified_hours_title": {
        "ar": "ساعات العمل غير متاحة",
        "bin": "Aghae oghae I rhirhi",
        "bn": "সময়সূচী অনুপলব্ধ",
        "de": "Öffnungszeiten unbekannt",
        "el": "Ωράριο μη διαθέσιμο",
        "es": "Horario no disponible",
        "fr": "Horaires indisponibles",
        "ha": "Lokutan buɗewa ba sa samuwa",
        "he": "שעות פתיחה לא זמינות",
        "hi": "समय अनुपलब्ध",
        "id": "Jam buka tidak tersedia",
        "ig": "Awa enweghị",
        "it": "Orari non disponibili",
        "ja": "営業時間が不明",
        "ko": "영업시간 정보 없음",
        "ms": "Waktu operasi tidak tersedia",
        "nl": "Openingstijden onbekend",
        "pl": "Godziny niedostępne",
        "pt": "Horários indisponíveis",
        "ro": "Program indisponibil",
        "ru": "Часы работы недоступны",
        "sv": "Öppettider saknas",
        "th": "ไม่มีข้อมูลเวลาทำการ",
        "tr": "Çalışma saatleri yok",
        "uk": "Години роботи недоступні",
        "vi": "Không có giờ mở cửa",
        "yo": "Awọn wakati ko si",
        "zh": "营业时间未知",
    },
    "unverified_hours_message": {
        "ar": "لم نتمكن من التحقق من ساعات عمل {{venueName}} في ذلك الوقت. هل تريد الجدولة على أي حال؟",
        "bin": "I ma fian re aghae oghae {{venueName}} ye ẹgheghe na. U ya gha lae ra?",
        "bn": "আমরা সেই সময়ে {{venueName}}-এর সময়সূচী যাচাই করতে পারিনি। তবুও সময় নির্ধারণ করবেন?",
        "de": "Wir konnten die Öffnungszeiten von {{venueName}} für diese Zeit nicht überprüfen. Trotzdem planen?",
        "el": "Δεν μπορέσαμε να επαληθεύσουμε τις ώρες του {{venueName}} για αυτήν την ώρα. Προγραμματισμός ούτως ή άλλως;",
        "es": "No pudimos verificar el horario de {{venueName}} para esa hora. ¿Programar de todos modos?",
        "fr": "Nous n'avons pas pu vérifier les horaires de {{venueName}} pour ce créneau. Planifier quand même ?",
        "ha": "Ba mu iya tabbatar da lokutan buɗe {{venueName}} ba na wannan lokacin. Tsara duk da haka?",
        "he": "לא הצלחנו לאמת את שעות הפתיחה של {{venueName}} בשעה זו. לתזמן בכל זאת?",
        "hi": "हम उस समय के लिए {{venueName}} के समय की पुष्टि नहीं कर सके। फिर भी शेड्यूल करें?",
        "id": "Kami tidak dapat memverifikasi jam buka {{venueName}} untuk waktu itu. Tetap jadwalkan?",
        "ig": "Anyị enweghị ike igosipụta oge {{venueName}} maka oge ahụ. Hazie agbanyeghị?",
        "it": "Non siamo riusciti a verificare gli orari di {{venueName}} per quell'ora. Programmare comunque?",
        "ja": "その時刻の{{venueName}}の営業時間を確認できませんでした。それでも予約しますか?",
        "ko": "해당 시간 {{venueName}}의 영업 여부를 확인할 수 없습니다. 그래도 예약할까요?",
        "ms": "Kami tidak dapat mengesahkan waktu {{venueName}} pada masa itu. Jadualkan tetap?",
        "nl": "We konden de openingstijden van {{venueName}} voor dat moment niet verifiëren. Toch plannen?",
        "pl": "Nie mogliśmy zweryfikować godzin {{venueName}} o tej porze. Zaplanować mimo to?",
        "pt": "Não conseguimos verificar os horários de {{venueName}} para esse momento. Agendar mesmo assim?",
        "ro": "Nu am putut verifica programul {{venueName}} pentru acea oră. Programezi oricum?",
        "ru": "Мы не смогли проверить часы работы {{venueName}} на это время. Запланировать всё равно?",
        "sv": "Vi kunde inte verifiera {{venueName}}s öppettider för den tiden. Boka ändå?",
        "th": "เราไม่สามารถยืนยันเวลาทำการของ {{venueName}} ในช่วงเวลานั้นได้ จัดตารางต่อไปหรือไม่?",
        "tr": "{{venueName}} mekânının o saatteki çalışma saatlerini doğrulayamadık. Yine de planlansın mı?",
        "uk": "Ми не змогли перевірити години роботи {{venueName}} на цей час. Запланувати все одно?",
        "vi": "Chúng tôi không thể xác minh giờ mở cửa của {{venueName}} vào lúc đó. Vẫn lên lịch?",
        "yo": "A ko le ṣayẹwo awọn wakati {{venueName}} fun akoko yẹn. Ṣeto sibẹsibẹ?",
        "zh": "我们无法验证{{venueName}}在该时段的营业时间。仍要安排吗?",
    },
    "error_past_date_title": {
        "ar": "اختر وقتًا في المستقبل",
        "bin": "Zẹ ẹgheghe ne ọ rre ne odẹ",
        "bn": "ভবিষ্যতের সময় বেছে নিন",
        "de": "Wähle eine zukünftige Zeit",
        "el": "Επιλέξτε μελλοντική ώρα",
        "es": "Elige una hora futura",
        "fr": "Choisir une heure future",
        "ha": "Zaɓi lokaci na nan gaba",
        "he": "בחר שעה עתידית",
        "hi": "भविष्य का समय चुनें",
        "id": "Pilih waktu mendatang",
        "ig": "Họrọ oge n'ihu",
        "it": "Scegli un orario futuro",
        "ja": "未来の時刻を選択",
        "ko": "미래 시간 선택",
        "ms": "Pilih masa akan datang",
        "nl": "Kies een toekomstige tijd",
        "pl": "Wybierz godzinę w przyszłości",
        "pt": "Escolha uma hora futura",
        "ro": "Alege o oră viitoare",
        "ru": "Выберите будущее время",
        "sv": "Välj en framtida tid",
        "th": "เลือกเวลาในอนาคต",
        "tr": "Gelecekte bir saat seç",
        "uk": "Виберіть майбутній час",
        "vi": "Chọn thời gian trong tương lai",
        "yo": "Yan akoko ọjọ iwaju",
        "zh": "选择将来的时间",
    },
    "error_past_date_message": {
        "ar": "لقد مر هذا الوقت بالفعل. يرجى اختيار وقت في المستقبل.",
        "bin": "Ẹgheghe na guolo nẹ. Zẹ ẹgheghe ne ọ rre ne odẹ.",
        "bn": "সেই সময় ইতিমধ্যে পেরিয়ে গেছে। অনুগ্রহ করে ভবিষ্যতের একটি সময় বেছে নিন।",
        "de": "Diese Zeit ist bereits vergangen. Bitte wähle eine zukünftige Zeit.",
        "el": "Αυτή η ώρα έχει ήδη περάσει. Παρακαλώ επιλέξτε μελλοντική ώρα.",
        "es": "Esa hora ya pasó. Por favor, elige una hora futura.",
        "fr": "Cette heure est déjà passée. Veuillez choisir une heure future.",
        "ha": "Wannan lokacin ya wuce. Da fatan zaɓi lokaci na nan gaba.",
        "he": "השעה הזו כבר עברה. בחר שעה עתידית.",
        "hi": "यह समय बीत चुका है। कृपया भविष्य का समय चुनें।",
        "id": "Waktu itu sudah berlalu. Silakan pilih waktu yang akan datang.",
        "ig": "Oge ahụ agafeela. Biko họrọ oge n'ihu.",
        "it": "Quell'orario è già passato. Scegli un orario futuro.",
        "ja": "その時刻は過ぎています。未来の時刻を選んでください。",
        "ko": "이미 지난 시간입니다. 미래의 시간을 선택해 주세요.",
        "ms": "Masa itu telah berlalu. Sila pilih masa akan datang.",
        "nl": "Die tijd is al voorbij. Kies een toekomstige tijd.",
        "pl": "Ta godzina już minęła. Wybierz godzinę w przyszłości.",
        "pt": "Esse horário já passou. Por favor, escolha um horário futuro.",
        "ro": "Acea oră a trecut deja. Te rog alege o oră viitoare.",
        "ru": "Это время уже прошло. Пожалуйста, выберите будущее время.",
        "sv": "Den tiden har redan passerat. Välj en framtida tid.",
        "th": "เวลานั้นผ่านไปแล้ว โปรดเลือกเวลาในอนาคต",
        "tr": "O saat geçmiş. Lütfen gelecekte bir saat seçin.",
        "uk": "Цей час вже минув. Будь ласка, виберіть майбутній час.",
        "vi": "Thời gian đó đã qua. Vui lòng chọn thời gian trong tương lai.",
        "yo": "Akoko yẹn ti kọja tẹlẹ. Jọwọ yan akoko ọjọ iwaju.",
        "zh": "该时间已过。请选择将来的时间。",
    },
}


def main():
    locales = sorted(d.name for d in LOCALES_DIR.iterdir() if d.is_dir() and d.name != "en")
    if len(locales) != 28:
        print(f"WARN: expected 28 non-en locales, found {len(locales)}: {locales}")

    for locale in locales:
        locale_file = LOCALES_DIR / locale / "expanded_details.json"
        if not locale_file.exists():
            print(f"SKIP: {locale_file} missing")
            continue

        with locale_file.open("r", encoding="utf-8") as f:
            data = json.load(f)

        action_buttons = data.setdefault("action_buttons", {})
        added = 0
        for key, locale_map in TRANSLATIONS.items():
            translated = locale_map.get(locale)
            if translated is None:
                print(f"WARN: no {locale} translation for key {key}; skipping")
                continue
            if key in action_buttons and action_buttons[key] == translated:
                continue
            action_buttons[key] = translated
            added += 1

        with locale_file.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")  # trailing newline (matches existing style)

        print(f"{locale}: +{added} keys")

    print("\nDone.")


if __name__ == "__main__":
    main()
