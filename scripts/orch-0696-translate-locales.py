#!/usr/bin/env python3
"""
ORCH-0696 — translate 17 new event-modal i18n keys into 28 non-en locales.

Idempotent. Adds keys × 28 locales. Re-runs are no-ops once locales are in sync.

Run from project root:
    python scripts/orch-0696-translate-locales.py
"""

import json
from pathlib import Path

LOCALES_DIR = Path("app-mobile/src/i18n/locales")

# 17 new keys × 28 non-en locales = 476 native translations.
# Keys are flat with `expanded.*` prefix in cards.json (matches existing pattern).
TRANSLATIONS = {
    "expanded.tickets_tba": {
        "ar": "التذاكر قيد الإعلان",
        "bin": "Tikiti yo gha rri ne odẹ",
        "bn": "টিকিট শীঘ্রই ঘোষণা",
        "de": "Tickets folgen",
        "el": "Εισιτήρια σύντομα",
        "es": "Entradas por confirmar",
        "fr": "Billets à venir",
        "ha": "Tikiti za a sanar",
        "he": "כרטיסים בקרוב",
        "hi": "टिकट जल्द ही",
        "id": "Tiket akan diumumkan",
        "ig": "Akwụkwọ ikike ga-abịa",
        "it": "Biglietti in arrivo",
        "ja": "チケット未定",
        "ko": "티켓 추후 공지",
        "ms": "Tiket akan diumumkan",
        "nl": "Tickets komen eraan",
        "pl": "Bilety wkrótce",
        "pt": "Ingressos em breve",
        "ro": "Bilete în curând",
        "ru": "Билеты скоро",
        "sv": "Biljetter kommer",
        "th": "ตั๋วประกาศภายหลัง",
        "tr": "Biletler yakında",
        "uk": "Квитки незабаром",
        "vi": "Vé sắp ra mắt",
        "yo": "Awọn tikẹti laipẹ",
        "zh": "门票待定",
    },
    "expanded.save": {
        "ar": "حفظ", "bin": "Yẹ", "bn": "সংরক্ষণ", "de": "Speichern", "el": "Αποθήκευση",
        "es": "Guardar", "fr": "Enregistrer", "ha": "Adana", "he": "שמור", "hi": "सहेजें",
        "id": "Simpan", "ig": "Chekwaa", "it": "Salva", "ja": "保存", "ko": "저장",
        "ms": "Simpan", "nl": "Opslaan", "pl": "Zapisz", "pt": "Salvar", "ro": "Salvează",
        "ru": "Сохранить", "sv": "Spara", "th": "บันทึก", "tr": "Kaydet", "uk": "Зберегти",
        "vi": "Lưu", "yo": "Pamọ", "zh": "保存",
    },
    "expanded.saved": {
        "ar": "تم الحفظ", "bin": "Eyẹ", "bn": "সংরক্ষিত", "de": "Gespeichert", "el": "Αποθηκεύτηκε",
        "es": "Guardado", "fr": "Enregistré", "ha": "An adana", "he": "נשמר", "hi": "सहेजा गया",
        "id": "Tersimpan", "ig": "Echekwala", "it": "Salvato", "ja": "保存済み", "ko": "저장됨",
        "ms": "Disimpan", "nl": "Opgeslagen", "pl": "Zapisano", "pt": "Salvo", "ro": "Salvat",
        "ru": "Сохранено", "sv": "Sparad", "th": "บันทึกแล้ว", "tr": "Kaydedildi", "uk": "Збережено",
        "vi": "Đã lưu", "yo": "Ti pamọ", "zh": "已保存",
    },
    "expanded.share": {
        "ar": "مشاركة", "bin": "Yan", "bn": "শেয়ার", "de": "Teilen", "el": "Κοινοποίηση",
        "es": "Compartir", "fr": "Partager", "ha": "Raba", "he": "שתף", "hi": "साझा करें",
        "id": "Bagikan", "ig": "Kekọrịta", "it": "Condividi", "ja": "共有", "ko": "공유",
        "ms": "Kongsi", "nl": "Delen", "pl": "Udostępnij", "pt": "Compartilhar", "ro": "Distribuie",
        "ru": "Поделиться", "sv": "Dela", "th": "แชร์", "tr": "Paylaş", "uk": "Поділитися",
        "vi": "Chia sẻ", "yo": "Pin", "zh": "分享",
    },
    "expanded.add_to_calendar": {
        "ar": "أضف إلى التقويم", "bin": "Sin ye kalẹnda", "bn": "ক্যালেন্ডারে যোগ করুন",
        "de": "Zum Kalender hinzufügen", "el": "Προσθήκη στο ημερολόγιο",
        "es": "Añadir al calendario", "fr": "Ajouter au calendrier", "ha": "Ƙara zuwa kalanda",
        "he": "הוסף ליומן", "hi": "कैलेंडर में जोड़ें", "id": "Tambah ke kalender",
        "ig": "Tinye na kalenda", "it": "Aggiungi al calendario", "ja": "カレンダーに追加",
        "ko": "캘린더에 추가", "ms": "Tambah ke kalendar", "nl": "Aan agenda toevoegen",
        "pl": "Dodaj do kalendarza", "pt": "Adicionar ao calendário", "ro": "Adaugă în calendar",
        "ru": "В календарь", "sv": "Lägg till i kalendern", "th": "เพิ่มในปฏิทิน",
        "tr": "Takvime ekle", "uk": "Додати в календар", "vi": "Thêm vào lịch",
        "yo": "Fi kun kalẹnda", "zh": "添加到日历",
    },
    "expanded.about": {
        "ar": "نبذة", "bin": "Eseta", "bn": "বিবরণ", "de": "Über", "el": "Σχετικά",
        "es": "Acerca de", "fr": "À propos", "ha": "Game da", "he": "אודות", "hi": "विवरण",
        "id": "Tentang", "ig": "Maka", "it": "Informazioni", "ja": "概要", "ko": "소개",
        "ms": "Tentang", "nl": "Over", "pl": "O wydarzeniu", "pt": "Sobre", "ro": "Despre",
        "ru": "Описание", "sv": "Om", "th": "เกี่ยวกับ", "tr": "Hakkında", "uk": "Про",
        "vi": "Giới thiệu", "yo": "Nipa", "zh": "关于",
    },
    "expanded.when_and_where": {
        "ar": "متى وأين", "bin": "Vbe ye gba kpaọ", "bn": "কখন ও কোথায়",
        "de": "Wann & Wo", "el": "Πότε & Πού", "es": "Cuándo y dónde",
        "fr": "Quand et où", "ha": "Yaushe da Ina", "he": "מתי ואיפה",
        "hi": "कब और कहाँ", "id": "Kapan & Di mana", "ig": "Mgbe na Ebee",
        "it": "Quando e dove", "ja": "日時と場所", "ko": "일정 & 장소",
        "ms": "Bila & Di mana", "nl": "Wanneer & Waar", "pl": "Kiedy i gdzie",
        "pt": "Quando e onde", "ro": "Când și unde", "ru": "Когда и где",
        "sv": "När & Var", "th": "เมื่อไหร่ & ที่ไหน", "tr": "Ne zaman & Nerede",
        "uk": "Коли і де", "vi": "Khi nào & Ở đâu", "yo": "Igba & Ibi",
        "zh": "时间和地点",
    },
    "expanded.tags": {
        "ar": "وسوم", "bin": "Awa", "bn": "ট্যাগ", "de": "Tags", "el": "Ετικέτες",
        "es": "Etiquetas", "fr": "Tags", "ha": "Tags", "he": "תגיות", "hi": "टैग",
        "id": "Tag", "ig": "Akara", "it": "Tag", "ja": "タグ", "ko": "태그",
        "ms": "Tag", "nl": "Tags", "pl": "Tagi", "pt": "Tags", "ro": "Etichete",
        "ru": "Теги", "sv": "Taggar", "th": "แท็ก", "tr": "Etiketler", "uk": "Теги",
        "vi": "Thẻ", "yo": "Awọn àmì", "zh": "标签",
    },
    "expanded.open_in_maps": {
        "ar": "افتح في الخرائط", "bin": "Hiọn ye Maps", "bn": "মানচিত্রে খুলুন",
        "de": "In Karten öffnen", "el": "Άνοιγμα στους Χάρτες",
        "es": "Abrir en Mapas", "fr": "Ouvrir dans Plans", "ha": "Buɗe a Maps",
        "he": "פתח במפות", "hi": "मैप्स में खोलें", "id": "Buka di Peta",
        "ig": "Mepee na Maps", "it": "Apri in Mappe", "ja": "マップで開く",
        "ko": "지도에서 열기", "ms": "Buka di Peta", "nl": "Openen in Kaarten",
        "pl": "Otwórz w Mapach", "pt": "Abrir no Mapas", "ro": "Deschide în Hărți",
        "ru": "Открыть в Картах", "sv": "Öppna i Kartor", "th": "เปิดในแผนที่",
        "tr": "Haritalar'da aç", "uk": "Відкрити в Картах", "vi": "Mở trong Bản đồ",
        "yo": "Ṣii ni Maps", "zh": "在地图中打开",
    },
    "expanded.show_more": {
        "ar": "المزيد", "bin": "Nọkharha", "bn": "আরও", "de": "Mehr", "el": "Περισσότερα",
        "es": "Más", "fr": "Plus", "ha": "Ƙari", "he": "עוד", "hi": "और",
        "id": "Selengkapnya", "ig": "Ọzọ", "it": "Altro", "ja": "もっと見る", "ko": "더 보기",
        "ms": "Lagi", "nl": "Meer", "pl": "Więcej", "pt": "Mais", "ro": "Mai mult",
        "ru": "Ещё", "sv": "Mer", "th": "เพิ่มเติม", "tr": "Daha fazla", "uk": "Ще",
        "vi": "Thêm", "yo": "Diẹ sii", "zh": "更多",
    },
    "expanded.show_less": {
        "ar": "أقل", "bin": "Kekere", "bn": "কম", "de": "Weniger", "el": "Λιγότερα",
        "es": "Menos", "fr": "Moins", "ha": "Ƙasa", "he": "פחות", "hi": "कम",
        "id": "Lebih sedikit", "ig": "Mpe", "it": "Meno", "ja": "閉じる", "ko": "간략히",
        "ms": "Kurang", "nl": "Minder", "pl": "Mniej", "pt": "Menos", "ro": "Mai puțin",
        "ru": "Меньше", "sv": "Mindre", "th": "น้อยลง", "tr": "Daha az", "uk": "Менше",
        "vi": "Ít hơn", "yo": "Kere", "zh": "收起",
    },
    "expanded.calendar_permission_title": {
        "ar": "هناك حاجة للوصول إلى التقويم",
        "bin": "I khẹrhẹ ne kalẹnda",
        "bn": "ক্যালেন্ডারে অ্যাক্সেস প্রয়োজন",
        "de": "Kalenderzugriff erforderlich",
        "el": "Απαιτείται πρόσβαση στο ημερολόγιο",
        "es": "Se necesita acceso al calendario",
        "fr": "Accès au calendrier requis",
        "ha": "Ana buƙatar damar kalanda",
        "he": "נדרשת גישה ליומן",
        "hi": "कैलेंडर एक्सेस आवश्यक",
        "id": "Izin kalender diperlukan",
        "ig": "Ikike kalenda dị mkpa",
        "it": "Accesso al calendario necessario",
        "ja": "カレンダーへのアクセスが必要です",
        "ko": "캘린더 접근 권한 필요",
        "ms": "Akses kalendar diperlukan",
        "nl": "Toegang tot agenda vereist",
        "pl": "Wymagany dostęp do kalendarza",
        "pt": "Permissão de calendário necessária",
        "ro": "Este necesar accesul la calendar",
        "ru": "Требуется доступ к календарю",
        "sv": "Kalenderåtkomst krävs",
        "th": "ต้องการสิทธิ์เข้าถึงปฏิทิน",
        "tr": "Takvim erişimi gerekli",
        "uk": "Потрібен доступ до календаря",
        "vi": "Cần quyền truy cập lịch",
        "yo": "A nilo iwọle si kalẹnda",
        "zh": "需要日历访问权限",
    },
    "expanded.calendar_permission_body": {
        "ar": "اسمح بالوصول إلى التقويم في الإعدادات لإضافة هذا الحدث.",
        "bin": "Yẹ kalẹnda ye Settings ne ọ na sin oghẹ ne ye.",
        "bn": "এই ইভেন্ট যোগ করতে সেটিংসে ক্যালেন্ডার অ্যাক্সেস অনুমতি দিন।",
        "de": "Erlaube Kalenderzugriff in den Einstellungen, um dieses Event hinzuzufügen.",
        "el": "Επιτρέψτε την πρόσβαση στο ημερολόγιο στις Ρυθμίσεις για να προσθέσετε αυτήν την εκδήλωση.",
        "es": "Permite el acceso al calendario en Ajustes para añadir este evento.",
        "fr": "Autorise l'accès au calendrier dans les Réglages pour ajouter cet événement.",
        "ha": "Ƙyale damar kalanda a Saituna don ƙara wannan taron.",
        "he": "אפשר גישה ליומן בהגדרות כדי להוסיף את האירוע הזה.",
        "hi": "इस इवेंट को जोड़ने के लिए सेटिंग्स में कैलेंडर एक्सेस की अनुमति दें।",
        "id": "Izinkan akses kalender di Pengaturan untuk menambahkan acara ini.",
        "ig": "Kwe ka ikike kalenda na Ntọala iji tinye mmemme a.",
        "it": "Consenti l'accesso al calendario nelle Impostazioni per aggiungere questo evento.",
        "ja": "このイベントを追加するには設定でカレンダーへのアクセスを許可してください。",
        "ko": "이 이벤트를 추가하려면 설정에서 캘린더 접근을 허용하세요.",
        "ms": "Benarkan akses kalendar dalam Tetapan untuk tambah acara ini.",
        "nl": "Sta agendatoegang toe in Instellingen om dit evenement toe te voegen.",
        "pl": "Zezwól na dostęp do kalendarza w Ustawieniach, aby dodać to wydarzenie.",
        "pt": "Permita o acesso ao calendário nas Configurações para adicionar este evento.",
        "ro": "Permite accesul la calendar din Setări pentru a adăuga acest eveniment.",
        "ru": "Разрешите доступ к календарю в Настройках, чтобы добавить это событие.",
        "sv": "Tillåt kalenderåtkomst i Inställningar för att lägga till detta evenemang.",
        "th": "อนุญาตการเข้าถึงปฏิทินในการตั้งค่าเพื่อเพิ่มกิจกรรมนี้",
        "tr": "Bu etkinliği eklemek için Ayarlar'dan takvim erişimine izin verin.",
        "uk": "Дозвольте доступ до календаря в Налаштуваннях, щоб додати цю подію.",
        "vi": "Cho phép quyền truy cập lịch trong Cài đặt để thêm sự kiện này.",
        "yo": "Gba laaye iwọle kalẹnda ni Eto lati ṣafikun iṣẹlẹ yii.",
        "zh": "在设置中允许日历访问以添加此活动。",
    },
    "expanded.calendar_unavailable": {
        "ar": "لم يتم العثور على تقويم قابل للكتابة على هذا الجهاز.",
        "bin": "I miẹ kalẹnda ne u ya ya gbe.",
        "bn": "এই ডিভাইসে কোনো লেখার যোগ্য ক্যালেন্ডার পাওয়া যায়নি।",
        "de": "Kein beschreibbarer Kalender auf diesem Gerät gefunden.",
        "el": "Δεν βρέθηκε εγγράψιμο ημερολόγιο σε αυτή τη συσκευή.",
        "es": "No se encontró un calendario editable en este dispositivo.",
        "fr": "Aucun calendrier modifiable trouvé sur cet appareil.",
        "ha": "Ba a sami kalanda da za a iya rubutawa ba a wannan na'urar.",
        "he": "לא נמצא יומן הניתן לעריכה במכשיר זה.",
        "hi": "इस डिवाइस पर कोई लिखने योग्य कैलेंडर नहीं मिला।",
        "id": "Tidak ada kalender yang dapat ditulis di perangkat ini.",
        "ig": "Achọtaghị kalenda enwere ike ide na ngwaọrụ a.",
        "it": "Nessun calendario modificabile trovato su questo dispositivo.",
        "ja": "このデバイスに書き込み可能なカレンダーがありません。",
        "ko": "이 기기에서 쓰기 가능한 캘린더를 찾을 수 없습니다.",
        "ms": "Tiada kalendar boleh tulis ditemui pada peranti ini.",
        "nl": "Geen schrijfbare agenda op dit apparaat gevonden.",
        "pl": "Nie znaleziono zapisywalnego kalendarza na tym urządzeniu.",
        "pt": "Nenhum calendário editável encontrado neste dispositivo.",
        "ro": "Niciun calendar editabil găsit pe acest dispozitiv.",
        "ru": "На этом устройстве не найден доступный для записи календарь.",
        "sv": "Ingen skrivbar kalender hittades på den här enheten.",
        "th": "ไม่พบปฏิทินที่เขียนได้ในอุปกรณ์นี้",
        "tr": "Bu cihazda yazılabilir bir takvim bulunamadı.",
        "uk": "На цьому пристрої не знайдено календар з можливістю запису.",
        "vi": "Không tìm thấy lịch có thể ghi trên thiết bị này.",
        "yo": "Ko si kalẹnda ti o le kọ silẹ lori ẹrọ yii.",
        "zh": "在此设备上未找到可写日历。",
    },
    "expanded.calendar_date_parse_error": {
        "ar": "لم نتمكن من قراءة وقت الحدث.",
        "bin": "I ma fian re ẹgheghe ye oghẹ.",
        "bn": "ইভেন্টের সময় পড়া যায়নি।",
        "de": "Konnten die Eventzeit nicht lesen.",
        "el": "Δεν μπορέσαμε να διαβάσουμε την ώρα της εκδήλωσης.",
        "es": "No pudimos leer la hora del evento.",
        "fr": "Impossible de lire l'heure de l'événement.",
        "ha": "Ba mu iya karanta lokacin taron ba.",
        "he": "לא הצלחנו לקרוא את זמן האירוע.",
        "hi": "इवेंट का समय पढ़ नहीं सके।",
        "id": "Tidak dapat membaca waktu acara.",
        "ig": "Anyị enweghị ike ịgụ oge mmemme.",
        "it": "Non siamo riusciti a leggere l'ora dell'evento.",
        "ja": "イベントの時刻を読み取れませんでした。",
        "ko": "이벤트 시간을 읽을 수 없습니다.",
        "ms": "Tidak dapat membaca masa acara.",
        "nl": "Kon de tijd van het evenement niet lezen.",
        "pl": "Nie udało się odczytać czasu wydarzenia.",
        "pt": "Não conseguimos ler o horário do evento.",
        "ro": "Nu am putut citi ora evenimentului.",
        "ru": "Не удалось прочитать время события.",
        "sv": "Kunde inte läsa evenemangets tid.",
        "th": "ไม่สามารถอ่านเวลาของกิจกรรมได้",
        "tr": "Etkinlik saati okunamadı.",
        "uk": "Не вдалося прочитати час події.",
        "vi": "Không đọc được thời gian sự kiện.",
        "yo": "A ko le ka akoko iṣẹlẹ.",
        "zh": "无法读取活动时间。",
    },
    "expanded.calendar_added": {
        "ar": "تمت الإضافة إلى التقويم", "bin": "I sin re kalẹnda",
        "bn": "ক্যালেন্ডারে যোগ করা হয়েছে", "de": "Zum Kalender hinzugefügt",
        "el": "Προστέθηκε στο ημερολόγιο", "es": "Añadido al calendario",
        "fr": "Ajouté au calendrier", "ha": "An ƙara zuwa kalanda",
        "he": "נוסף ליומן", "hi": "कैलेंडर में जोड़ा गया",
        "id": "Ditambahkan ke kalender", "ig": "Tinyere na kalenda",
        "it": "Aggiunto al calendario", "ja": "カレンダーに追加しました",
        "ko": "캘린더에 추가됨", "ms": "Ditambah ke kalendar",
        "nl": "Aan agenda toegevoegd", "pl": "Dodano do kalendarza",
        "pt": "Adicionado ao calendário", "ro": "Adăugat în calendar",
        "ru": "Добавлено в календарь", "sv": "Tillagt i kalendern",
        "th": "เพิ่มในปฏิทินแล้ว", "tr": "Takvime eklendi",
        "uk": "Додано в календар", "vi": "Đã thêm vào lịch",
        "yo": "Ti fi kun kalẹnda", "zh": "已添加到日历",
    },
    "expanded.calendar_error": {
        "ar": "تعذرت الإضافة إلى التقويم. حاول مرة أخرى.",
        "bin": "I ma sin re kalẹnda. Ye vbe.",
        "bn": "ক্যালেন্ডারে যোগ করা যায়নি। আবার চেষ্টা করুন।",
        "de": "Konnte nicht zum Kalender hinzugefügt werden. Versuche es erneut.",
        "el": "Αδυναμία προσθήκης στο ημερολόγιο. Δοκιμάστε ξανά.",
        "es": "No se pudo añadir al calendario. Inténtalo de nuevo.",
        "fr": "Impossible d'ajouter au calendrier. Réessayez.",
        "ha": "Ba a iya ƙarawa zuwa kalanda. Sake gwadawa.",
        "he": "לא ניתן היה להוסיף ליומן. נסה שוב.",
        "hi": "कैलेंडर में जोड़ नहीं सके। पुनः प्रयास करें।",
        "id": "Tidak dapat menambahkan ke kalender. Coba lagi.",
        "ig": "Enweghị ike ịtinye na kalenda. Nwaa ọzọ.",
        "it": "Impossibile aggiungere al calendario. Riprova.",
        "ja": "カレンダーに追加できませんでした。もう一度お試しください。",
        "ko": "캘린더에 추가할 수 없습니다. 다시 시도해 주세요.",
        "ms": "Tidak dapat tambah ke kalendar. Cuba lagi.",
        "nl": "Kon niet aan agenda toevoegen. Probeer opnieuw.",
        "pl": "Nie udało się dodać do kalendarza. Spróbuj ponownie.",
        "pt": "Não foi possível adicionar ao calendário. Tente novamente.",
        "ro": "Nu s-a putut adăuga în calendar. Încearcă din nou.",
        "ru": "Не удалось добавить в календарь. Попробуйте снова.",
        "sv": "Det gick inte att lägga till i kalendern. Försök igen.",
        "th": "ไม่สามารถเพิ่มในปฏิทินได้ ลองอีกครั้ง",
        "tr": "Takvime eklenemedi. Tekrar deneyin.",
        "uk": "Не вдалося додати в календар. Спробуйте ще раз.",
        "vi": "Không thể thêm vào lịch. Thử lại.",
        "yo": "Ko le fi kun kalẹnda. Gbiyanju lẹẹkansi.",
        "zh": "无法添加到日历。请重试。",
    },
}


def main() -> None:
    locales = sorted(d.name for d in LOCALES_DIR.iterdir() if d.is_dir() and d.name != "en")
    if len(locales) != 28:
        print(f"WARN: expected 28 non-en locales, found {len(locales)}: {locales}")

    total_added = 0
    for locale in locales:
        f = LOCALES_DIR / locale / "cards.json"
        if not f.exists():
            print(f"SKIP: {f} missing")
            continue
        data = json.load(f.open(encoding="utf-8"))
        added = 0
        for key, locale_map in TRANSLATIONS.items():
            translated = locale_map.get(locale)
            if translated is None:
                print(f"WARN: no {locale} translation for {key}")
                continue
            if data.get(key) == translated:
                continue
            data[key] = translated
            added += 1
        with f.open("w", encoding="utf-8") as out:
            json.dump(data, out, ensure_ascii=False, indent=2)
            out.write("\n")
        total_added += added
        print(f"{locale}: +{added} keys")

    print(f"\nTotal: +{total_added} translations across {len(locales)} locales.")


if __name__ == "__main__":
    main()
