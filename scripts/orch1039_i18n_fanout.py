#!/usr/bin/env python3
"""
ORCH-1039 — fan out the locked collaboration-step copy across all 29 locales.

Sets, in each <lang>/onboarding.json `collaborations` block:
  headline, body, start_button (NEW),
  trip_chats_header (NEW), trip_chats_loading (NEW),
  trip_chats_join_subtitle (NEW), trip_chats_join_button (NEW)

Locked EN (operator-final):
  headline    = "Plan it together"
  body        = "Start a group with your crew, or jump into a chat or trip you're already invited to."
  start_button= "Start the group"
  trip_chats_header        = "Your trip and event chats"
  trip_chats_loading       = "Loading chats…"
  trip_chats_join_subtitle = "Join the buyer group chat"
  trip_chats_join_button   = "Join chat"

Translations are faithful (not literal calques), matching each file's existing
register. Pre-0929 "session" framing is removed from headline/body. Never dating.
Key ordering: start_button is inserted right after body; the four trip_chats_*
keys are appended at the END of the block. JSON is re-emitted preserving the
existing key order otherwise, 2-space indent, ensure_ascii=False, trailing NL.
"""
import json
import os
from collections import OrderedDict

LOCALES_DIR = os.path.join(
    os.path.dirname(__file__), "..", "app-mobile", "src", "i18n", "locales"
)

# Per-locale values for the 7 keys.
# Order: headline, body, start_button, trip_chats_header, trip_chats_loading,
#        trip_chats_join_subtitle, trip_chats_join_button
T = {
    "en": [
        "Plan it together",
        "Start a group with your crew, or jump into a chat or trip you're already invited to.",
        "Start the group",
        "Your trip and event chats",
        "Loading chats…",
        "Join the buyer group chat",
        "Join chat",
    ],
    "ar": [
        "خططوا معًا",
        "ابدأ مجموعة مع أصدقائك، أو انضم إلى محادثة أو رحلة دُعيت إليها بالفعل.",
        "ابدأ المجموعة",
        "محادثات رحلاتك وفعالياتك",
        "جارٍ تحميل المحادثات…",
        "انضم إلى محادثة مجموعة المشترين",
        "انضم إلى المحادثة",
    ],
    "bin": [
        "Plan it together",
        "Bụlọ otu vbe iyẹnmwẹ ruẹ, ra dee yọ chat ra trip nẹ a na tie ruẹ.",
        "Bụlọ otu",
        "Trip kevbe event chat ruẹ",
        "A loading chat…",
        "Dee yọ buyer group chat",
        "Dee yọ chat",
    ],
    "bn": [
        "একসাথে পরিকল্পনা করুন",
        "আপনার বন্ধুদের নিয়ে একটি গ্রুপ শুরু করুন, অথবা আপনি ইতিমধ্যে আমন্ত্রিত আছেন এমন কোনো চ্যাট বা ট্রিপে যোগ দিন।",
        "গ্রুপ শুরু করুন",
        "আপনার ট্রিপ ও ইভেন্ট চ্যাট",
        "চ্যাট লোড হচ্ছে…",
        "ক্রেতাদের গ্রুপ চ্যাটে যোগ দিন",
        "চ্যাটে যোগ দিন",
    ],
    "de": [
        "Plant es gemeinsam",
        "Starte eine Gruppe mit deiner Crew oder spring in einen Chat oder Trip, zu dem du schon eingeladen bist.",
        "Gruppe starten",
        "Deine Trip- und Event-Chats",
        "Chats werden geladen…",
        "Dem Käufer-Gruppenchat beitreten",
        "Chat beitreten",
    ],
    "el": [
        "Σχεδιάστε το μαζί",
        "Ξεκίνα μια ομάδα με την παρέα σου ή μπες σε μια συνομιλία ή εκδρομή στην οποία είσαι ήδη προσκεκλημένος.",
        "Ξεκίνα την ομάδα",
        "Οι συνομιλίες ταξιδιών και εκδηλώσεών σου",
        "Φόρτωση συνομιλιών…",
        "Μπες στην ομαδική συνομιλία αγοραστών",
        "Μπες στη συνομιλία",
    ],
    "es": [
        "Planéenlo juntos",
        "Crea un grupo con tu gente, o únete a un chat o viaje al que ya te invitaron.",
        "Crear el grupo",
        "Tus chats de viajes y eventos",
        "Cargando chats…",
        "Únete al chat grupal de compradores",
        "Unirse al chat",
    ],
    "fr": [
        "Organisez-le ensemble",
        "Crée un groupe avec ta bande, ou rejoins une conversation ou un voyage où tu es déjà invité.",
        "Créer le groupe",
        "Tes conversations de voyages et d'événements",
        "Chargement des conversations…",
        "Rejoindre le chat de groupe des acheteurs",
        "Rejoindre le chat",
    ],
    "ha": [
        "Ku tsara shi tare",
        "Fara rukuni da abokanka, ko ka shiga hira ko tafiya da aka riga aka gayyace ka.",
        "Fara rukunin",
        "Hirarrakin tafiye-tafiye da abubuwan da kake da su",
        "Ana loda hirarraki…",
        "Shiga hirar rukunin masu siye",
        "Shiga hira",
    ],
    "he": [
        "תכננו ביחד",
        "פתחו קבוצה עם החבר'ה שלכם, או הצטרפו לצ'אט או טיול שכבר הוזמנתם אליו.",
        "פתחו קבוצה",
        "הצ'אטים של הטיולים והאירועים שלך",
        "טוען צ'אטים…",
        "הצטרפו לצ'אט הקבוצתי של הקונים",
        "הצטרפו לצ'אט",
    ],
    "hi": [
        "मिलकर प्लान बनाएं",
        "अपने दोस्तों के साथ एक ग्रुप शुरू करें, या किसी ऐसी चैट या ट्रिप में शामिल हों जिसमें आपको पहले से न्योता मिला है।",
        "ग्रुप शुरू करें",
        "आपकी ट्रिप और इवेंट चैट",
        "चैट लोड हो रही हैं…",
        "खरीदारों की ग्रुप चैट में शामिल हों",
        "चैट में शामिल हों",
    ],
    "id": [
        "Rencanakan bareng",
        "Mulai grup bareng teman-temanmu, atau gabung ke obrolan atau trip yang sudah mengundangmu.",
        "Mulai grupnya",
        "Obrolan trip dan acaramu",
        "Memuat obrolan…",
        "Gabung obrolan grup pembeli",
        "Gabung obrolan",
    ],
    "ig": [
        "Hazienụ ya ọnụ",
        "Malite otù ya na ndị enyi gị, ma ọ bụ banye na nkata ma ọ bụ njem a kpọrọ gị maka ya.",
        "Malite otù ahụ",
        "Nkata njem na emume gị",
        "Na-ebu nkata…",
        "Sonye na nkata otù ndị na-azụ ahịa",
        "Sonye na nkata",
    ],
    "it": [
        "Organizzatelo insieme",
        "Crea un gruppo con la tua compagnia, o entra in una chat o in un viaggio a cui sei già stato invitato.",
        "Crea il gruppo",
        "Le tue chat di viaggi ed eventi",
        "Caricamento chat…",
        "Entra nella chat di gruppo degli acquirenti",
        "Entra nella chat",
    ],
    "ja": [
        "みんなで計画しよう",
        "仲間とグループを作るか、すでに招待されているチャットや旅行に参加しよう。",
        "グループを作る",
        "旅行・イベントのチャット",
        "チャットを読み込み中…",
        "購入者グループチャットに参加",
        "チャットに参加",
    ],
    "ko": [
        "함께 계획해요",
        "친구들과 그룹을 만들거나, 이미 초대받은 채팅이나 여행에 참여하세요.",
        "그룹 시작하기",
        "내 여행 및 이벤트 채팅",
        "채팅 불러오는 중…",
        "구매자 그룹 채팅 참여",
        "채팅 참여",
    ],
    "ms": [
        "Rancang bersama",
        "Mulakan kumpulan dengan rakan anda, atau sertai sembang atau perjalanan yang anda telah dijemput.",
        "Mulakan kumpulan",
        "Sembang perjalanan dan acara anda",
        "Memuatkan sembang…",
        "Sertai sembang kumpulan pembeli",
        "Sertai sembang",
    ],
    "nl": [
        "Plan het samen",
        "Begin een groep met je crew, of spring in een chat of trip waarvoor je al bent uitgenodigd.",
        "Start de groep",
        "Je trip- en evenementchats",
        "Chats laden…",
        "Doe mee met de groepschat voor kopers",
        "Doe mee met de chat",
    ],
    "pl": [
        "Zaplanujcie to razem",
        "Załóż grupę ze znajomymi albo dołącz do czatu lub wyjazdu, na który masz już zaproszenie.",
        "Załóż grupę",
        "Twoje czaty z wyjazdów i wydarzeń",
        "Ładowanie czatów…",
        "Dołącz do czatu grupowego kupujących",
        "Dołącz do czatu",
    ],
    "pt": [
        "Planejem juntos",
        "Crie um grupo com a sua turma, ou entre em um chat ou viagem para os quais você já foi convidado.",
        "Criar o grupo",
        "Seus chats de viagens e eventos",
        "Carregando chats…",
        "Entrar no chat em grupo dos compradores",
        "Entrar no chat",
    ],
    "ro": [
        "Planificați împreună",
        "Pornește un grup cu gașca ta sau intră într-o conversație ori o excursie la care ești deja invitat.",
        "Pornește grupul",
        "Conversațiile tale despre excursii și evenimente",
        "Se încarcă conversațiile…",
        "Intră în conversația de grup a cumpărătorilor",
        "Intră în conversație",
    ],
    "ru": [
        "Спланируйте вместе",
        "Создайте группу со своей компанией или присоединитесь к чату или поездке, куда вас уже пригласили.",
        "Создать группу",
        "Ваши чаты поездок и мероприятий",
        "Загрузка чатов…",
        "Присоединиться к групповому чату покупателей",
        "Войти в чат",
    ],
    "sv": [
        "Planera ihop",
        "Starta en grupp med ditt gäng, eller hoppa in i en chatt eller resa du redan är inbjuden till.",
        "Starta gruppen",
        "Dina rese- och evenemangschattar",
        "Laddar chattar…",
        "Gå med i köparnas gruppchatt",
        "Gå med i chatten",
    ],
    "th": [
        "วางแผนไปด้วยกัน",
        "เริ่มกลุ่มกับเพื่อนๆ ของคุณ หรือเข้าร่วมแชทหรือทริปที่คุณได้รับเชิญอยู่แล้ว",
        "เริ่มกลุ่ม",
        "แชททริปและอีเวนต์ของคุณ",
        "กำลังโหลดแชท…",
        "เข้าร่วมแชทกลุ่มผู้ซื้อ",
        "เข้าร่วมแชท",
    ],
    "tr": [
        "Birlikte planlayın",
        "Ekibinle bir grup başlat ya da çoktan davet edildiğin bir sohbete veya geziye katıl.",
        "Grubu başlat",
        "Gezi ve etkinlik sohbetlerin",
        "Sohbetler yükleniyor…",
        "Alıcı grup sohbetine katıl",
        "Sohbete katıl",
    ],
    "uk": [
        "Сплануйте разом",
        "Створіть групу зі своєю компанією або приєднайтеся до чату чи поїздки, куди вас уже запросили.",
        "Створити групу",
        "Ваші чати подорожей і подій",
        "Завантаження чатів…",
        "Приєднатися до групового чату покупців",
        "Приєднатися до чату",
    ],
    "vi": [
        "Cùng nhau lên kế hoạch",
        "Tạo nhóm với hội bạn của bạn, hoặc tham gia cuộc trò chuyện hay chuyến đi mà bạn đã được mời.",
        "Tạo nhóm",
        "Trò chuyện chuyến đi và sự kiện của bạn",
        "Đang tải cuộc trò chuyện…",
        "Tham gia trò chuyện nhóm người mua",
        "Tham gia trò chuyện",
    ],
    "yo": [
        "Ẹ jọ gbero rẹ",
        "Bẹrẹ ẹgbẹ kan pẹlu àwọn ọ̀rẹ́ rẹ, tàbí dara pọ̀ mọ́ ìfọ̀rọ̀wánilẹ́nuwò tàbí ìrìnàjò tí a ti pè ọ́ sí.",
        "Bẹrẹ ẹgbẹ náà",
        "Àwọn ìfọ̀rọ̀wérọ̀ ìrìnàjò àti ìṣẹ̀lẹ̀ rẹ",
        "Ń gbé àwọn ìfọ̀rọ̀wérọ̀ wọlé…",
        "Dara pọ̀ mọ́ ìfọ̀rọ̀wérọ̀ ẹgbẹ́ àwọn ará-ọjà",
        "Dara pọ̀ mọ́ ìfọ̀rọ̀wérọ̀",
    ],
    "zh": [
        "一起来计划",
        "和你的小伙伴建一个群，或者加入你已受邀的聊天或行程。",
        "建群",
        "你的行程和活动聊天",
        "正在加载聊天…",
        "加入买家群聊",
        "加入聊天",
    ],
}

KEYS = [
    "headline",
    "body",
    "start_button",
    "trip_chats_header",
    "trip_chats_loading",
    "trip_chats_join_subtitle",
    "trip_chats_join_button",
]


def main() -> None:
    changed = []
    for lang, vals in T.items():
        path = os.path.join(LOCALES_DIR, lang, "onboarding.json")
        with open(path, "r", encoding="utf-8") as f:
            doc = json.load(f, object_pairs_hook=OrderedDict)
        collab = doc.get("collaborations")
        if collab is None:
            raise SystemExit(f"{lang}: no 'collaborations' block")

        vmap = dict(zip(KEYS, vals))

        # Rebuild the block: keep existing key order, overwrite headline/body in
        # place, insert start_button right after body, append the four trip keys
        # at the end (if not already present).
        new_collab = OrderedDict()
        for k, v in collab.items():
            if k in ("headline", "body"):
                new_collab[k] = vmap[k]
            elif k in (
                "start_button",
                "trip_chats_header",
                "trip_chats_loading",
                "trip_chats_join_subtitle",
                "trip_chats_join_button",
            ):
                # skip — re-added in canonical position below
                continue
            else:
                new_collab[k] = v
            if k == "body":
                new_collab["start_button"] = vmap["start_button"]
        # append trip keys at end
        for k in (
            "trip_chats_header",
            "trip_chats_loading",
            "trip_chats_join_subtitle",
            "trip_chats_join_button",
        ):
            new_collab[k] = vmap[k]

        doc["collaborations"] = new_collab

        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
            f.write("\n")
        changed.append(lang)

    print(f"Updated {len(changed)} locales: {', '.join(sorted(changed))}")


if __name__ == "__main__":
    main()
