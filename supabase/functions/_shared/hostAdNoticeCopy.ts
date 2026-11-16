// supabase/functions/_shared/hostAdNoticeCopy.ts
//
// #4238 W4b (amendment B §9): every Host ad notice in all 29 Host locales.
// Rendered server-side in the recipient's profiles.preferred_language; English
// only when the language is missing. Machine-translated with no human review
// (standing rule: users report). Generated from one key order so every locale
// has every key; issue_4238_host_ad_notices.test.ts fails on a missing key, an
// extra key or a {placeholder} that does not match English.

export const HOST_AD_NOTICE_LOCALES = [
  "ar",
  "bin",
  "bn",
  "de",
  "el",
  "en",
  "es",
  "fr",
  "ha",
  "he",
  "hi",
  "id",
  "ig",
  "it",
  "ja",
  "ko",
  "ms",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "yo",
  "zh",
] as const;

export type HostAdNoticeLocale = typeof HOST_AD_NOTICE_LOCALES[number];

export const HOST_AD_NOTICE_COPY_KEYS = [
  "live_title",
  "live_body",
  "rejected_title",
  "part_rejected_title",
  "part_suffix",
  "review_fallback",
  "paused_title",
  "paused_sold_out",
  "paused_credit_out",
  "paused_host",
  "paused_event_ended",
  "paused_destination",
  "paused_safety",
  "paused_generic",
  "credit_low_title",
  "credit_low_body",
  "ended_title",
  "ended_returned",
  "ended_nothing",
  "slow_title",
  "slow_body",
  "tired_title",
  "tired_body",
  "last_title",
  "last_body",
  "reason_text_heavy",
  "fix_text_heavy",
  "reason_alcohol",
  "fix_alcohol",
  "reason_personal_attributes",
  "fix_personal_attributes",
  "reason_misleading",
  "fix_misleading",
  "reason_landing_page",
  "fix_landing_page",
  "reason_low_quality",
  "fix_low_quality",
  "reason_prohibited",
  "fix_prohibited",
  "reason_identity",
  "fix_identity",
] as const;

export type HostAdNoticeCopyKey = typeof HOST_AD_NOTICE_COPY_KEYS[number];

export const HOST_AD_NOTICE_COPY: Readonly<
  Record<HostAdNoticeLocale, Readonly<Record<HostAdNoticeCopyKey, string>>>
> = {
  ar: {
    live_title: "إعلانك يعمل الآن",
    live_body: "{event} يظهر الآن على {app}.",
    rejected_title: "لم يوافق {app} على إعلانك",
    part_rejected_title: "لم يوافق {app} على {n} من إعلاناتك",
    part_suffix: "إعلاناتك الأخرى مستمرة.",
    review_fallback:
      "لم يوافق {app} على {n} من إعلاناتك. افتح الإعلان لترى ما يجب تغييره.",
    paused_title: "إعلانك متوقف مؤقتًا",
    paused_sold_out: "نفدت تذاكر {event}، لذلك توقف إعلانك. لن يُصرف شيء آخر.",
    paused_credit_out: "استخدم إعلانك الرصيد المخصص له. أضف ميزانية ليستمر.",
    paused_host: "أوقف {name} إعلانك مؤقتًا. يمكنك تشغيله مجددًا في أي وقت.",
    paused_event_ended: "انتهى {event}، لذلك توقف إعلانك.",
    paused_destination:
      "صفحتك ليست عامة الآن، لذلك توقف إعلانك. اجعلها عامة لتشغيله مجددًا.",
    paused_safety:
      "أوقفنا إعلانك مؤقتًا للأمان لأننا لم نتمكن من قراءة إنفاقه. سنتحقق مرة أخرى قريبًا.",
    paused_generic: "توقف إعلانك. افتح الإعلان لمعرفة السبب.",
    credit_low_title: "رصيد الإعلانات يوشك على النفاد",
    credit_low_body:
      "تبقى نحو {days} أيام من الرصيد بإنفاق اليوم. اشحن {amount} لتستمر إعلاناتك أسبوعًا.",
    ended_title: "انتهى إعلانك",
    ended_returned:
      "المصروف: {spend}. النتائج التي احتسبتها Mingla: {results}. عاد {amount} من الرصيد غير المستخدم إلى رصيدك.",
    ended_nothing:
      "المصروف: {spend}. النتائج التي احتسبتها Mingla: {results}. لم يتبقَّ شيء.",
    slow_title: "المبيعات أبطأ من المتوقع",
    slow_body: "{event} يبيع تذاكر أقل من المتوقع. افتح الإعلان لترى أفكارًا.",
    tired_title: "إعلانك بدأ يفقد تأثيره",
    tired_body:
      "شاهده الناس على {app} كثيرًا. أضف فيديو أو صورة جديدة للحفاظ على النتائج.",
    last_title: "تبقّت تذاكر قليلة فقط",
    last_body:
      "هل تريد أن يقول إعلانك إنها آخر التذاكر لـ {event}؟ افتح الإعلان لتفعيل ذلك.",
    reason_text_heavy: "الصورة تحتوي على نص كثير.",
    fix_text_heavy: "استخدم صورة بكتابة أقل.",
    reason_alcohol: "يعرض الكحول أو يذكره.",
    fix_alcohol: "احذف المشروبات من النص والصورة، أو اعرضه للبالغين فقط.",
    reason_personal_attributes: "النص يشير إلى هوية القارئ.",
    fix_personal_attributes: "صف الفعالية بدلًا من الشخص الذي يقرأ.",
    reason_misleading: "النص يعد بأكثر مما تقدمه الفعالية.",
    fix_misleading: "اكتب فقط ما سيحصل عليه الناس فعلًا.",
    reason_landing_page: "لم يتمكن التطبيق من فتح صفحتك، أو لم تطابق الإعلان.",
    fix_landing_page: "تأكد أن الصفحة عامة وتطابق الإعلان.",
    reason_low_quality: "جودة الفيديو أو الصورة منخفضة جدًا.",
    fix_low_quality: "استخدم فيديو أو صورة أوضح.",
    reason_prohibited: "يعرض شيئًا لا يسمح به التطبيق.",
    fix_prohibited: "احذف هذا الجزء من الصورة أو النص.",
    reason_identity:
      "يحتاج التطبيق إلى إثبات أنه يحق لك استخدام هذا الاسم أو الصورة.",
    fix_identity: "استخدم اسم علامتك التجارية وصورًا تملكها.",
  },
  bin: {
    live_title: "Ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ ọ̀ rhiẹ ẹ̀rhù",
    live_body: "{event} ghá rhiẹ ẹ̀ hẹ {app} nọ̀ọ̀ ẹ̀rẹ̀.",
    rejected_title: "{app} i ya ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ",
    part_rejected_title: "{app} i ya {n} vbe ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ",
    part_suffix: "Ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ ni kpa ghá kha.",
    review_fallback:
      "{app} i ya {n} vbe ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ. Dọ̀ ọ̀ghọ̀ ẹ̀kpọ̀n na ne u miẹn emwi ne u gha fiẹ̀.",
    paused_title: "Ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ mudia rre",
    paused_sold_out:
      "Tikẹti {event} fo, ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ na mudia. Ọ̀ i gha kpọ̀n igho ọvbehe.",
    paused_credit_out:
      "Ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ loo igho ne a ya khian ọ fo. Ya igho rre ne ọ̀ ghá kha.",
    paused_host:
      "{name} ya ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ mudia. U sẹ̀tin ya ọ̀ ghá rhiẹ ẹ̀rhù ẹghẹ hia.",
    paused_event_ended: "{event} fo, ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ na mudia.",
    paused_destination:
      "Ẹbe ruẹ i rre ẹvbo nọ̀ọ̀ ẹ̀rẹ̀, ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ na mudia. Ya ọ̀ rre ẹvbo ne ọ̀ ghá kha.",
    paused_safety:
      "Ma ya ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ mudia rhunmwuda ma i sẹ̀tin bie igho ne ọ̀ loo. Ma gha ghee ẹ̀ ẹ̀kẹ̀ ọvbehe.",
    paused_generic: "Ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ mudia. Dọ̀ ọ̀ ne u rẹn emwi ne ọ̀ ya.",
    credit_low_title: "Igho ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ ghá fo",
    credit_low_body:
      "Ọ̀ kpaye vbe ẹdẹ {days} vbe igho ne u loo ẹdẹ nẹ. Ya {amount} rre ne ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ ghá kha ẹ̀ izu ọkpa.",
    ended_title: "Ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ fo",
    ended_returned:
      "Ne a loo: {spend}. Emwi ne Mingla bu: {results}. {amount} igho ne a i loo dẹ̀ rre ẹbe ruẹ.",
    ended_nothing:
      "Ne a loo: {spend}. Emwi ne Mingla bu: {results}. Ẹmwi rhọkpa i kpaye.",
    slow_title: "Ẹ̀ khiẹn ghá kha vbe ẹrhẹẹ sẹ ne a rhọ",
    slow_body:
      "{event} ghá khiẹn tikẹti kherhe sẹ ne a rhọ. Dọ̀ ọ̀ghọ̀ ẹ̀kpọ̀n na ne u miẹn ẹ̀ rhọ.",
    tired_title: "Ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ ghá fiẹ ẹ̀ mwan ọ̀ yẹ",
    tired_body:
      "Emwan nọ rre {app} miẹn ọ̀ vbe ẹghẹ nibun. Ya fídíò ra foto ọ̀kpa rre ne ọ̀ ghá ye ẹ̀ si.",
    last_title: "Tikẹti kherhe ọ kpaye",
    last_body:
      "U hoo ne ọ̀ghọ̀ ẹ̀kpọ̀n ruẹ khare wẹ tikẹti ọkpelọ vbe {event} ẹre ọ̀ rhiẹre? Dọ̀ ọ̀ghọ̀ ẹ̀kpọ̀n na ne u ya ọ̀ rhiẹ ẹ̀rhù.",
    reason_text_heavy: "Ẹ̀mwi nibun rre uhunmwu foto na.",
    fix_text_heavy: "Loo foto ne ẹ̀mwi kherhe rre uhunmwu ẹre.",
    reason_alcohol: "Ọ̀ ghá rhiẹ ayọ̀n hẹ ra tae ẹ̀ rhọ ayọ̀n.",
    fix_alcohol:
      "Fan ayọ̀n kua vbe ẹ̀mwi kevbe foto, ra rhiẹ ọ̀ hẹ ivbi okhaemwen ọkpa.",
    reason_personal_attributes: "Ẹ̀mwi na ghá tae ẹ̀ rhọ ọmwan ne ọ̀ ghá bie ọ̀.",
    fix_personal_attributes: "Tae ẹ̀ rhọ ugie na, i rhiẹ ọmwan ne ọ̀ ghá bie ọ̀.",
    reason_misleading: "Ẹ̀mwi na ya ẹ̀ ẹ̀ sẹ emwi ne ugie na gha rhie.",
    fix_misleading: "Gbẹn emwi ne emwan gha miẹn vbe ẹmwata ọkpa.",
    reason_landing_page:
      "Ẹ̀ app na i sẹ̀tin dọ̀ ẹbe ruẹ, ra ọ̀ i khẹ̀khẹ̀ hẹ ọ̀ghọ̀ ẹ̀kpọ̀n na.",
    fix_landing_page: "Ghee wẹ ẹbe na rre ẹvbo ọ̀ ghi khẹ̀khẹ̀ hẹ ọ̀ghọ̀ ẹ̀kpọ̀n na.",
    reason_low_quality: "Fídíò ra foto na i maan sẹ.",
    fix_low_quality: "Loo fídíò ra foto ne ọ̀ maan sẹ̀ẹ̀.",
    reason_prohibited: "Ọ̀ ghá rhiẹ emwi ne app na i ya hẹ.",
    fix_prohibited: "Fan ẹ̀ ẹ̀ vbe foto ra ẹ̀mwi na kua.",
    reason_identity: "Ẹ̀ app na hoo ẹ̀ rhiẹre wẹ u sẹ̀tin loo ẹ̀ ẹ̀ ra foto na.",
    fix_identity: "Loo ẹ̀ ẹ̀ ẹ̀ ruẹ kevbe foto ne ọ̀ rhiẹ ẹ̀ ruẹ.",
  },
  bn: {
    live_title: "আপনার বিজ্ঞাপন চালু হয়েছে",
    live_body: "{event} এখন {app}-এ দেখানো হচ্ছে।",
    rejected_title: "{app} আপনার বিজ্ঞাপন অনুমোদন করেনি",
    part_rejected_title: "{app} আপনার {n}টি বিজ্ঞাপন অনুমোদন করেনি",
    part_suffix: "আপনার অন্য বিজ্ঞাপনগুলো চলতে থাকবে।",
    review_fallback:
      "{app} আপনার {n}টি বিজ্ঞাপন অনুমোদন করেনি। কী বদলাতে হবে দেখতে বিজ্ঞাপনটি খুলুন।",
    paused_title: "আপনার বিজ্ঞাপন বিরতিতে আছে",
    paused_sold_out:
      "{event}-এর টিকিট শেষ, তাই বিজ্ঞাপন থেমে গেছে। আর কিছু খরচ হবে না।",
    paused_credit_out:
      "বিজ্ঞাপনটি তার জন্য রাখা ক্রেডিট ব্যবহার করে ফেলেছে। চালু রাখতে বাজেট যোগ করুন।",
    paused_host: "{name} আপনার বিজ্ঞাপন থামিয়েছেন। যেকোনো সময় আবার চালু করতে পারবেন।",
    paused_event_ended: "{event} শেষ হয়েছে, তাই বিজ্ঞাপন থেমে গেছে।",
    paused_destination:
      "আপনার পেজ এখন পাবলিক নয়, তাই বিজ্ঞাপন থেমে গেছে। আবার চালাতে পেজটি পাবলিক করুন।",
    paused_safety:
      "খরচ পড়তে না পারায় নিরাপত্তার জন্য বিজ্ঞাপন থামানো হয়েছে। শিগগির আবার দেখব।",
    paused_generic: "আপনার বিজ্ঞাপন থেমে গেছে। কারণ জানতে বিজ্ঞাপনটি খুলুন।",
    credit_low_title: "বিজ্ঞাপন ক্রেডিট কমে আসছে",
    credit_low_body:
      "আজকের খরচে প্রায় {days} দিনের ক্রেডিট বাকি। এক সপ্তাহ বিজ্ঞাপন চালাতে {amount} টপ আপ করুন।",
    ended_title: "আপনার বিজ্ঞাপন শেষ হয়েছে",
    ended_returned:
      "খরচ: {spend}। Mingla-র গোনা ফলাফল: {results}। অব্যবহৃত {amount} ক্রেডিট আপনার ব্যালেন্সে ফিরে এসেছে।",
    ended_nothing: "খরচ: {spend}। Mingla-র গোনা ফলাফল: {results}। কিছুই বাকি নেই।",
    slow_title: "বিক্রি প্রত্যাশার চেয়ে ধীর",
    slow_body:
      "{event} প্রত্যাশার চেয়ে কম টিকিট বিক্রি করছে। আইডিয়ার জন্য বিজ্ঞাপনটি খুলুন।",
    tired_title: "আপনার বিজ্ঞাপন একঘেয়ে হয়ে যাচ্ছে",
    tired_body:
      "{app}-এ মানুষ এটি অনেকবার দেখেছে। ফলাফল ধরে রাখতে নতুন ভিডিও বা ছবি যোগ করুন।",
    last_title: "মাত্র কয়েকটি টিকিট বাকি",
    last_body:
      "আপনি কি চান বিজ্ঞাপনে বলা হোক এগুলো {event}-এর শেষ টিকিট? চালু করতে বিজ্ঞাপনটি খুলুন।",
    reason_text_heavy: "ছবিতে অনেক বেশি লেখা আছে।",
    fix_text_heavy: "কম লেখাওয়ালা ছবি ব্যবহার করুন।",
    reason_alcohol: "এতে মদ দেখানো বা উল্লেখ করা হয়েছে।",
    fix_alcohol: "লেখা ও ছবি থেকে পানীয় সরান, বা শুধু প্রাপ্তবয়স্কদের দেখান।",
    reason_personal_attributes: "লেখাটি পাঠক কে, সেদিকে ইঙ্গিত করে।",
    fix_personal_attributes: "পাঠকের বদলে ইভেন্টটির বর্ণনা দিন।",
    reason_misleading: "লেখাটি ইভেন্টের চেয়ে বেশি প্রতিশ্রুতি দেয়।",
    fix_misleading: "মানুষ আসলে যা পাবে শুধু তা-ই লিখুন।",
    reason_landing_page:
      "অ্যাপটি আপনার পেজ খুলতে পারেনি, বা পেজটি বিজ্ঞাপনের সাথে মেলেনি।",
    fix_landing_page: "পেজটি পাবলিক ও বিজ্ঞাপনের সাথে মিলছে কিনা দেখুন।",
    reason_low_quality: "ভিডিও বা ছবির মান খুব কম।",
    fix_low_quality: "আরও পরিষ্কার ভিডিও বা ছবি ব্যবহার করুন।",
    reason_prohibited: "এতে এমন কিছু আছে যা অ্যাপ অনুমতি দেয় না।",
    fix_prohibited: "ছবি বা লেখা থেকে সেই অংশটি সরান।",
    reason_identity: "এই নাম বা ছবি ব্যবহারের অধিকারের প্রমাণ অ্যাপের দরকার।",
    fix_identity: "নিজের ব্র্যান্ডের নাম ও নিজের ছবি ব্যবহার করুন।",
  },
  de: {
    live_title: "Deine Anzeige ist live",
    live_body: "{event} wird jetzt auf {app} gezeigt.",
    rejected_title: "{app} hat deine Anzeige nicht genehmigt",
    part_rejected_title: "{app} hat {n} deiner Anzeigen nicht genehmigt",
    part_suffix: "Deine anderen Anzeigen laufen weiter.",
    review_fallback:
      "{app} hat {n} deiner Anzeigen nicht genehmigt. Öffne die Anzeige, um zu sehen, was du ändern kannst.",
    paused_title: "Deine Anzeige ist pausiert",
    paused_sold_out:
      "{event} ist ausverkauft, deshalb wurde deine Anzeige gestoppt. Es wird nichts mehr ausgegeben.",
    paused_credit_out:
      "Deine Anzeige hat das für sie reservierte Guthaben verbraucht. Füge Budget hinzu, damit sie weiterläuft.",
    paused_host:
      "{name} hat deine Anzeige pausiert. Du kannst sie jederzeit wieder einschalten.",
    paused_event_ended:
      "{event} ist vorbei, deshalb wurde deine Anzeige gestoppt.",
    paused_destination:
      "Deine Seite ist gerade nicht öffentlich, deshalb wurde deine Anzeige gestoppt. Mach sie öffentlich, um sie wieder zu starten.",
    paused_safety:
      "Wir haben deine Anzeige sicherheitshalber pausiert, weil wir ihre Ausgaben nicht lesen konnten. Wir prüfen bald erneut.",
    paused_generic:
      "Deine Anzeige läuft nicht mehr. Öffne die Anzeige, um den Grund zu sehen.",
    credit_low_title: "Dein Anzeigenguthaben wird knapp",
    credit_low_body:
      "Bei den heutigen Ausgaben reicht das Guthaben noch etwa {days} Tage. Lade {amount} auf, damit deine Anzeigen eine Woche laufen.",
    ended_title: "Deine Anzeige ist beendet",
    ended_returned:
      "Ausgegeben: {spend}. Von Mingla gezählte Ergebnisse: {results}. {amount} ungenutztes Guthaben ist zurück auf deinem Konto.",
    ended_nothing:
      "Ausgegeben: {spend}. Von Mingla gezählte Ergebnisse: {results}. Es ist nichts übrig.",
    slow_title: "Der Verkauf läuft langsamer als erwartet",
    slow_body:
      "{event} verkauft weniger Tickets als erwartet. Öffne die Anzeige für Ideen.",
    tired_title: "Deine Anzeige nutzt sich ab",
    tired_body:
      "Die Leute auf {app} haben sie schon oft gesehen. Füge ein neues Video oder Foto hinzu, um die Ergebnisse zu halten.",
    last_title: "Nur noch wenige Tickets",
    last_body:
      "Soll deine Anzeige sagen, dass es die letzten Tickets für {event} sind? Öffne die Anzeige, um es einzuschalten.",
    reason_text_heavy: "Das Bild hat zu viel Text.",
    fix_text_heavy: "Nutze ein Foto mit weniger Schrift.",
    reason_alcohol: "Sie zeigt oder erwähnt Alkohol.",
    fix_alcohol:
      "Nimm Getränke aus Text und Bild oder zeige sie nur Erwachsenen.",
    reason_personal_attributes: "Der Text zielt darauf, wer der Leser ist.",
    fix_personal_attributes: "Beschreibe das Event statt der lesenden Person.",
    reason_misleading: "Der Text verspricht mehr, als das Event bieten kann.",
    fix_misleading:
      "Beschränke den Text auf das, was die Leute wirklich bekommen.",
    reason_landing_page:
      "Die App konnte deine Seite nicht öffnen, oder sie passte nicht zur Anzeige.",
    fix_landing_page:
      "Prüfe, ob die Seite öffentlich ist und zur Anzeige passt.",
    reason_low_quality: "Die Qualität des Videos oder Fotos ist zu niedrig.",
    fix_low_quality: "Nutze ein schärferes Video oder Foto.",
    reason_prohibited: "Sie zeigt etwas, das die App nicht erlaubt.",
    fix_prohibited: "Entferne diesen Teil aus Bild oder Text.",
    reason_identity:
      "Die App braucht einen Nachweis, dass du diesen Namen oder dieses Bild nutzen darfst.",
    fix_identity: "Nutze deinen eigenen Markennamen und eigene Fotos.",
  },
  el: {
    live_title: "Η διαφήμισή σου είναι ενεργή",
    live_body: "Το {event} εμφανίζεται τώρα στο {app}.",
    rejected_title: "Το {app} δεν ενέκρινε τη διαφήμισή σου",
    part_rejected_title: "Το {app} δεν ενέκρινε {n} από τις διαφημίσεις σου",
    part_suffix: "Οι άλλες διαφημίσεις σου συνεχίζουν.",
    review_fallback:
      "Το {app} δεν ενέκρινε {n} από τις διαφημίσεις σου. Άνοιξε τη διαφήμιση για να δεις τι να αλλάξεις.",
    paused_title: "Η διαφήμισή σου είναι σε παύση",
    paused_sold_out:
      "Το {event} εξαντλήθηκε, οπότε η διαφήμιση σταμάτησε. Δεν ξοδεύεται τίποτα άλλο.",
    paused_credit_out:
      "Η διαφήμιση χρησιμοποίησε την πίστωση που είχε κρατηθεί. Πρόσθεσε προϋπολογισμό για να συνεχίσει.",
    paused_host:
      "Ο/Η {name} έβαλε τη διαφήμιση σε παύση. Μπορείς να την ξανανοίξεις όποτε θέλεις.",
    paused_event_ended: "Το {event} τελείωσε, οπότε η διαφήμιση σταμάτησε.",
    paused_destination:
      "Η σελίδα σου δεν είναι δημόσια τώρα, οπότε η διαφήμιση σταμάτησε. Κάν' την δημόσια για να ξαναρχίσει.",
    paused_safety:
      "Βάλαμε τη διαφήμιση σε παύση για ασφάλεια, γιατί δεν μπορέσαμε να διαβάσουμε τα έξοδά της. Θα ελέγξουμε ξανά σύντομα.",
    paused_generic: "Η διαφήμισή σου σταμάτησε. Άνοιξέ την για να δεις γιατί.",
    credit_low_title: "Η πίστωση διαφημίσεων τελειώνει",
    credit_low_body:
      "Απομένουν περίπου {days} μέρες πίστωσης με τα σημερινά έξοδα. Φόρτισε {amount} για να τρέχουν οι διαφημίσεις μια εβδομάδα.",
    ended_title: "Η διαφήμισή σου ολοκληρώθηκε",
    ended_returned:
      "Ξοδεύτηκαν: {spend}. Αποτελέσματα που μέτρησε η Mingla: {results}. {amount} αχρησιμοποίητης πίστωσης επέστρεψαν στο υπόλοιπό σου.",
    ended_nothing:
      "Ξοδεύτηκαν: {spend}. Αποτελέσματα που μέτρησε η Mingla: {results}. Δεν περίσσεψε τίποτα.",
    slow_title: "Οι πωλήσεις είναι πιο αργές από το αναμενόμενο",
    slow_body:
      "Το {event} πουλά λιγότερα εισιτήρια από το αναμενόμενο. Άνοιξε τη διαφήμιση για ιδέες.",
    tired_title: "Η διαφήμισή σου κουράζει",
    tired_body:
      "Οι χρήστες στο {app} την έχουν δει πολλές φορές. Πρόσθεσε νέο βίντεο ή φωτογραφία για να κρατήσεις τα αποτελέσματα.",
    last_title: "Έμειναν λίγα εισιτήρια",
    last_body:
      "Θέλεις η διαφήμιση να λέει ότι είναι τα τελευταία εισιτήρια για το {event}; Άνοιξε τη διαφήμιση για να το ενεργοποιήσεις.",
    reason_text_heavy: "Η εικόνα έχει πολύ κείμενο.",
    fix_text_heavy: "Χρησιμοποίησε φωτογραφία με λιγότερα γράμματα.",
    reason_alcohol: "Δείχνει ή αναφέρει αλκοόλ.",
    fix_alcohol:
      "Βγάλε τα ποτά από το κείμενο και την εικόνα ή δείξ' την μόνο σε ενήλικες.",
    reason_personal_attributes:
      "Το κείμενο στοχεύει στο ποιος είναι ο αναγνώστης.",
    fix_personal_attributes:
      "Περιέγραψε την εκδήλωση αντί για αυτόν που διαβάζει.",
    reason_misleading:
      "Το κείμενο υπόσχεται περισσότερα από όσα δίνει η εκδήλωση.",
    fix_misleading: "Γράψε μόνο ό,τι θα πάρει πραγματικά ο κόσμος.",
    reason_landing_page:
      "Η εφαρμογή δεν άνοιξε τη σελίδα σου ή δεν ταίριαζε με τη διαφήμιση.",
    fix_landing_page:
      "Έλεγξε ότι η σελίδα είναι δημόσια και ταιριάζει με τη διαφήμιση.",
    reason_low_quality:
      "Η ποιότητα του βίντεο ή της φωτογραφίας είναι πολύ χαμηλή.",
    fix_low_quality: "Χρησιμοποίησε πιο καθαρό βίντεο ή φωτογραφία.",
    reason_prohibited: "Δείχνει κάτι που η εφαρμογή δεν επιτρέπει.",
    fix_prohibited: "Αφαίρεσε αυτό το κομμάτι από την εικόνα ή το κείμενο.",
    reason_identity:
      "Η εφαρμογή θέλει απόδειξη ότι μπορείς να χρησιμοποιείς αυτό το όνομα ή την εικόνα.",
    fix_identity:
      "Χρησιμοποίησε το δικό σου όνομα brand και δικές σου φωτογραφίες.",
  },
  en: {
    live_title: "Your ad is live",
    live_body: "{event} is now showing on {app}.",
    rejected_title: "{app} didn't approve your ad",
    part_rejected_title: "{app} didn't approve {n} of your ads",
    part_suffix: "Your other ads keep running.",
    review_fallback:
      "{app} didn't approve {n} of your ads. Open the ad to see what to change.",
    paused_title: "Your ad is paused",
    paused_sold_out:
      "{event} is sold out, so your ad stopped. Nothing more is spent.",
    paused_credit_out:
      "Your ad has used the credit set aside for it. Add budget to keep it running.",
    paused_host: "{name} paused your ad. You can turn it back on any time.",
    paused_event_ended: "{event} has ended, so your ad stopped.",
    paused_destination:
      "Your page isn't public right now, so your ad stopped. Make it public to run it again.",
    paused_safety:
      "We paused your ad for safety because we couldn't read its spend. We'll check again soon.",
    paused_generic: "Your ad stopped running. Open the ad to see why.",
    credit_low_title: "Ad credit is running low",
    credit_low_body:
      "About {days} days of credit left at today's spend. Top up {amount} to keep your ads running for a week.",
    ended_title: "Your ad has ended",
    ended_returned:
      "Spent {spend}. Results counted by Mingla: {results}. {amount} of unused credit is back in your balance.",
    ended_nothing:
      "Spent {spend}. Results counted by Mingla: {results}. Nothing was left over.",
    slow_title: "Sales are slower than expected",
    slow_body:
      "{event} is selling fewer tickets than expected. Open the ad for ideas to pick it up.",
    tired_title: "Your ad is getting tired",
    tired_body:
      "People on {app} have seen it a lot. Add a new video or photo to keep results up.",
    last_title: "Only a few tickets left",
    last_body:
      "Want your ad to say these are the last tickets for {event}? Open the ad to turn it on.",
    reason_text_heavy: "The image has too much text.",
    fix_text_heavy: "Use a photo with less writing on it.",
    reason_alcohol: "It shows or mentions alcohol.",
    fix_alcohol:
      "Take drinks out of the words and picture, or show it to adults only.",
    reason_personal_attributes: "The words point at who the reader is.",
    fix_personal_attributes:
      "Describe the event instead of the person reading.",
    reason_misleading: "The words promise more than the event can give.",
    fix_misleading: "Keep the words to what people will really get.",
    reason_landing_page:
      "The app couldn't open your page, or it didn't match the ad.",
    fix_landing_page: "Check the page is public and matches the ad.",
    reason_low_quality: "The video or photo quality is too low.",
    fix_low_quality: "Use a sharper video or photo.",
    reason_prohibited: "It shows something the app doesn't allow.",
    fix_prohibited: "Remove that part of the picture or words.",
    reason_identity: "The app needs proof you can use this name or image.",
    fix_identity: "Use your own brand name and photos you own.",
  },
  es: {
    live_title: "Tu anuncio está activo",
    live_body: "{event} ya se muestra en {app}.",
    rejected_title: "{app} no aprobó tu anuncio",
    part_rejected_title: "{app} no aprobó {n} de tus anuncios",
    part_suffix: "Tus otros anuncios siguen activos.",
    review_fallback:
      "{app} no aprobó {n} de tus anuncios. Abre el anuncio para ver qué cambiar.",
    paused_title: "Tu anuncio está en pausa",
    paused_sold_out:
      "{event} está agotado, así que tu anuncio se detuvo. No se gasta nada más.",
    paused_credit_out:
      "Tu anuncio usó el crédito reservado para él. Añade presupuesto para mantenerlo activo.",
    paused_host: "{name} pausó tu anuncio. Puedes reactivarlo cuando quieras.",
    paused_event_ended: "{event} ha terminado, así que tu anuncio se detuvo.",
    paused_destination:
      "Tu página no es pública ahora mismo, así que tu anuncio se detuvo. Hazla pública para volver a activarlo.",
    paused_safety:
      "Pausamos tu anuncio por seguridad porque no pudimos leer su gasto. Lo revisaremos pronto.",
    paused_generic:
      "Tu anuncio dejó de mostrarse. Abre el anuncio para ver por qué.",
    credit_low_title: "Tu crédito para anuncios se está acabando",
    credit_low_body:
      "Quedan unos {days} días de crédito al gasto actual. Recarga {amount} para mantener tus anuncios una semana.",
    ended_title: "Tu anuncio ha terminado",
    ended_returned:
      "Gastado: {spend}. Resultados contados por Mingla: {results}. {amount} de crédito sin usar ha vuelto a tu saldo.",
    ended_nothing:
      "Gastado: {spend}. Resultados contados por Mingla: {results}. No sobró nada.",
    slow_title: "Las ventas van más lentas de lo esperado",
    slow_body:
      "{event} está vendiendo menos entradas de lo esperado. Abre el anuncio para ver ideas.",
    tired_title: "Tu anuncio se está desgastando",
    tired_body:
      "La gente en {app} lo ha visto mucho. Añade un video o foto nuevos para mantener los resultados.",
    last_title: "Quedan pocas entradas",
    last_body:
      "¿Quieres que tu anuncio diga que son las últimas entradas para {event}? Abre el anuncio para activarlo.",
    reason_text_heavy: "La imagen tiene demasiado texto.",
    fix_text_heavy: "Usa una foto con menos texto.",
    reason_alcohol: "Muestra o menciona alcohol.",
    fix_alcohol:
      "Quita las bebidas del texto y la imagen, o muéstralo solo a adultos.",
    reason_personal_attributes: "El texto señala cómo es quien lo lee.",
    fix_personal_attributes:
      "Describe el evento en lugar de a la persona que lee.",
    reason_misleading: "El texto promete más de lo que el evento ofrece.",
    fix_misleading: "Limita el texto a lo que la gente realmente recibirá.",
    reason_landing_page:
      "La app no pudo abrir tu página o no coincidía con el anuncio.",
    fix_landing_page:
      "Comprueba que la página sea pública y coincida con el anuncio.",
    reason_low_quality: "La calidad del video o la foto es muy baja.",
    fix_low_quality: "Usa un video o una foto más nítidos.",
    reason_prohibited: "Muestra algo que la app no permite.",
    fix_prohibited: "Quita esa parte de la imagen o del texto.",
    reason_identity:
      "La app necesita pruebas de que puedes usar este nombre o imagen.",
    fix_identity: "Usa tu propio nombre de marca y fotos que sean tuyas.",
  },
  fr: {
    live_title: "Votre pub est en ligne",
    live_body: "{event} est maintenant diffusé sur {app}.",
    rejected_title: "{app} n'a pas approuvé votre pub",
    part_rejected_title: "{app} n'a pas approuvé {n} de vos pubs",
    part_suffix: "Vos autres pubs continuent de tourner.",
    review_fallback:
      "{app} n'a pas approuvé {n} de vos pubs. Ouvrez la pub pour voir quoi changer.",
    paused_title: "Votre pub est en pause",
    paused_sold_out:
      "{event} est complet, votre pub s'est donc arrêtée. Rien de plus n'est dépensé.",
    paused_credit_out:
      "Votre pub a utilisé le crédit qui lui était réservé. Ajoutez du budget pour la garder active.",
    paused_host:
      "{name} a mis votre pub en pause. Vous pouvez la relancer à tout moment.",
    paused_event_ended: "{event} est terminé, votre pub s'est donc arrêtée.",
    paused_destination:
      "Votre page n'est pas publique pour le moment, votre pub s'est donc arrêtée. Rendez-la publique pour la relancer.",
    paused_safety:
      "Nous avons mis votre pub en pause par sécurité car nous n'avons pas pu lire ses dépenses. Nous revérifions bientôt.",
    paused_generic:
      "Votre pub s'est arrêtée. Ouvrez la pub pour savoir pourquoi.",
    credit_low_title: "Votre crédit pub s'épuise",
    credit_low_body:
      "Environ {days} jours de crédit restants au rythme actuel. Rechargez {amount} pour garder vos pubs actives une semaine.",
    ended_title: "Votre pub est terminée",
    ended_returned:
      "Dépensé : {spend}. Résultats comptés par Mingla : {results}. {amount} de crédit non utilisé est revenu sur votre solde.",
    ended_nothing:
      "Dépensé : {spend}. Résultats comptés par Mingla : {results}. Il ne reste rien.",
    slow_title: "Les ventes sont plus lentes que prévu",
    slow_body:
      "{event} vend moins de billets que prévu. Ouvrez la pub pour des idées de relance.",
    tired_title: "Votre pub s'essouffle",
    tired_body:
      "Les gens sur {app} l'ont beaucoup vue. Ajoutez une nouvelle vidéo ou photo pour garder de bons résultats.",
    last_title: "Il ne reste que quelques billets",
    last_body:
      "Voulez-vous que votre pub annonce les derniers billets pour {event} ? Ouvrez la pub pour l'activer.",
    reason_text_heavy: "L'image contient trop de texte.",
    fix_text_heavy: "Utilisez une photo avec moins d'écriture.",
    reason_alcohol: "Elle montre ou mentionne de l'alcool.",
    fix_alcohol:
      "Retirez les boissons du texte et de l'image, ou montrez-la aux adultes seulement.",
    reason_personal_attributes: "Le texte vise qui est le lecteur.",
    fix_personal_attributes:
      "Décrivez l'événement plutôt que la personne qui lit.",
    reason_misleading: "Le texte promet plus que l'événement ne peut offrir.",
    fix_misleading: "Limitez le texte à ce que les gens auront vraiment.",
    reason_landing_page:
      "L'app n'a pas pu ouvrir votre page, ou elle ne correspondait pas à la pub.",
    fix_landing_page:
      "Vérifiez que la page est publique et correspond à la pub.",
    reason_low_quality: "La qualité de la vidéo ou de la photo est trop basse.",
    fix_low_quality: "Utilisez une vidéo ou une photo plus nette.",
    reason_prohibited: "Elle montre quelque chose que l'app n'autorise pas.",
    fix_prohibited: "Retirez cette partie de l'image ou du texte.",
    reason_identity:
      "L'app a besoin d'une preuve que vous pouvez utiliser ce nom ou cette image.",
    fix_identity: "Utilisez votre propre nom de marque et vos propres photos.",
  },
  ha: {
    live_title: "Tallanka yana gudana",
    live_body: "{event} yanzu yana bayyana a {app}.",
    rejected_title: "{app} bai amince da tallanka ba",
    part_rejected_title:
      "{app} bai amince da {n} daga cikin tallace-tallacenka ba",
    part_suffix: "Sauran tallace-tallacenka suna ci gaba.",
    review_fallback:
      "{app} bai amince da {n} daga cikin tallace-tallacenka ba. Bude tallan don ganin abin da za a canza.",
    paused_title: "An dakatar da tallanka na ɗan lokaci",
    paused_sold_out:
      "Tikitin {event} sun ƙare, don haka tallanka ya tsaya. Ba za a ƙara kashe kuɗi ba.",
    paused_credit_out:
      "Tallanka ya yi amfani da kuɗin da aka keɓe masa. Ƙara kasafi don ya ci gaba.",
    paused_host:
      "{name} ya dakatar da tallanka. Za ka iya sake kunna shi kowane lokaci.",
    paused_event_ended: "{event} ya ƙare, don haka tallanka ya tsaya.",
    paused_destination:
      "Shafinka ba na jama'a ba ne yanzu, don haka tallanka ya tsaya. Mayar da shi na jama'a don sake gudanar da shi.",
    paused_safety:
      "Mun dakatar da tallanka don tsaro saboda ba mu iya karanta kuɗin da ya kashe ba. Za mu sake dubawa nan ba da jimawa ba.",
    paused_generic: "Tallanka ya tsaya. Bude tallan don ganin dalili.",
    credit_low_title: "Kuɗin tallanka yana ƙarewa",
    credit_low_body:
      "Saura kusan kwanaki {days} na kuɗi bisa kashewar yau. Ƙara {amount} don tallace-tallacenka su yi mako guda.",
    ended_title: "Tallanka ya ƙare",
    ended_returned:
      "An kashe: {spend}. Sakamakon da Mingla ta ƙidaya: {results}. {amount} na kuɗin da ba a yi amfani da shi ba ya dawo cikin asusunka.",
    ended_nothing:
      "An kashe: {spend}. Sakamakon da Mingla ta ƙidaya: {results}. Babu abin da ya rage.",
    slow_title: "Sayarwa tana tafiya a hankali fiye da yadda ake tsammani",
    slow_body:
      "{event} yana sayar da tikiti ƙasa da yadda ake tsammani. Bude tallan don samun dabaru.",
    tired_title: "Mutane sun gaji da ganin tallanka",
    tired_body:
      "Mutane a {app} sun gan shi sau da yawa. Ƙara sabon bidiyo ko hoto don sakamako ya ci gaba.",
    last_title: "Tikiti kaɗan ne suka rage",
    last_body:
      "Kana so tallanka ya ce waɗannan su ne tikitin ƙarshe na {event}? Bude tallan don kunna shi.",
    reason_text_heavy: "Hoton yana da rubutu da yawa.",
    fix_text_heavy: "Yi amfani da hoto mai ƙarancin rubutu.",
    reason_alcohol: "Yana nuna ko ambaton barasa.",
    fix_alcohol:
      "Cire abin sha daga rubutu da hoto, ko nuna shi ga manya kaɗai.",
    reason_personal_attributes: "Rubutun yana nuna wane ne mai karatu.",
    fix_personal_attributes: "Bayyana taron maimakon mai karatu.",
    reason_misleading:
      "Rubutun yana alkawarin abin da ya fi abin da taron zai bayar.",
    fix_misleading: "Rubuta abin da mutane za su samu da gaske kawai.",
    reason_landing_page:
      "Manhajar ba ta iya buɗe shafinka ba, ko bai dace da tallan ba.",
    fix_landing_page: "Tabbatar shafin na jama'a ne kuma ya dace da tallan.",
    reason_low_quality: "Ingancin bidiyo ko hoton ya yi ƙasa sosai.",
    fix_low_quality: "Yi amfani da bidiyo ko hoto mafi bayyana.",
    reason_prohibited: "Yana nuna abin da manhajar ba ta yarda da shi ba.",
    fix_prohibited: "Cire wannan ɓangaren hoton ko rubutun.",
    reason_identity:
      "Manhajar tana buƙatar shaidar cewa za ka iya amfani da wannan suna ko hoto.",
    fix_identity: "Yi amfani da sunan alamarka da hotunan da suke naka.",
  },
  he: {
    live_title: "המודעה שלך פעילה",
    live_body: "{event} מוצג עכשיו ב-{app}.",
    rejected_title: "{app} לא אישר את המודעה שלך",
    part_rejected_title: "{app} לא אישר {n} מהמודעות שלך",
    part_suffix: "שאר המודעות שלך ממשיכות לרוץ.",
    review_fallback:
      "{app} לא אישר {n} מהמודעות שלך. פתח את המודעה כדי לראות מה לשנות.",
    paused_title: "המודעה שלך מושהית",
    paused_sold_out:
      "הכרטיסים ל-{event} אזלו, לכן המודעה נעצרה. לא נוציא יותר.",
    paused_credit_out:
      "המודעה השתמשה בקרדיט ששוריין לה. הוסף תקציב כדי שתמשיך לרוץ.",
    paused_host: "{name} השהה את המודעה. אפשר להפעיל אותה שוב בכל זמן.",
    paused_event_ended: "{event} הסתיים, לכן המודעה נעצרה.",
    paused_destination:
      "הדף שלך לא ציבורי כרגע, לכן המודעה נעצרה. הפוך אותו לציבורי כדי להריץ שוב.",
    paused_safety:
      "השהינו את המודעה ליתר ביטחון כי לא הצלחנו לקרוא את ההוצאה שלה. נבדוק שוב בקרוב.",
    paused_generic: "המודעה שלך הפסיקה לרוץ. פתח אותה כדי לראות למה.",
    credit_low_title: "קרדיט הפרסום שלך אוזל",
    credit_low_body:
      "נשארו בערך {days} ימים של קרדיט בקצב ההוצאה של היום. טען {amount} כדי שהמודעות ירוצו שבוע.",
    ended_title: "המודעה שלך הסתיימה",
    ended_returned:
      "הוצאה: {spend}. תוצאות לפי ספירת Mingla: {results}. {amount} של קרדיט שלא נוצל חזר ליתרה שלך.",
    ended_nothing:
      "הוצאה: {spend}. תוצאות לפי ספירת Mingla: {results}. לא נשאר כלום.",
    slow_title: "המכירות איטיות מהצפוי",
    slow_body: "{event} מוכר פחות כרטיסים מהצפוי. פתח את המודעה לרעיונות.",
    tired_title: "המודעה שלך מתעייפת",
    tired_body:
      "אנשים ב-{app} ראו אותה הרבה. הוסף סרטון או תמונה חדשים כדי לשמור על התוצאות.",
    last_title: "נשארו רק כמה כרטיסים",
    last_body:
      "רוצה שהמודעה תגיד שאלה הכרטיסים האחרונים ל-{event}? פתח את המודעה כדי להפעיל.",
    reason_text_heavy: "בתמונה יש יותר מדי טקסט.",
    fix_text_heavy: "השתמש בתמונה עם פחות כיתוב.",
    reason_alcohol: "היא מציגה או מזכירה אלכוהול.",
    fix_alcohol: "הוצא משקאות מהטקסט ומהתמונה, או הצג רק למבוגרים.",
    reason_personal_attributes: "הטקסט מתייחס למי שהקורא הוא.",
    fix_personal_attributes: "תאר את האירוע במקום את מי שקורא.",
    reason_misleading: "הטקסט מבטיח יותר ממה שהאירוע נותן.",
    fix_misleading: "כתוב רק את מה שאנשים באמת יקבלו.",
    reason_landing_page:
      "האפליקציה לא הצליחה לפתוח את הדף שלך, או שהוא לא תאם את המודעה.",
    fix_landing_page: "בדוק שהדף ציבורי ותואם את המודעה.",
    reason_low_quality: "איכות הסרטון או התמונה נמוכה מדי.",
    fix_low_quality: "השתמש בסרטון או תמונה חדים יותר.",
    reason_prohibited: "היא מציגה משהו שהאפליקציה לא מתירה.",
    fix_prohibited: "הסר את החלק הזה מהתמונה או מהטקסט.",
    reason_identity: "האפליקציה צריכה הוכחה שמותר לך להשתמש בשם או בתמונה.",
    fix_identity: "השתמש בשם המותג שלך ובתמונות שלך.",
  },
  hi: {
    live_title: "आपका विज्ञापन लाइव है",
    live_body: "{event} अब {app} पर दिख रहा है।",
    rejected_title: "{app} ने आपका विज्ञापन मंज़ूर नहीं किया",
    part_rejected_title: "{app} ने आपके {n} विज्ञापन मंज़ूर नहीं किए",
    part_suffix: "आपके बाकी विज्ञापन चलते रहेंगे।",
    review_fallback:
      "{app} ने आपके {n} विज्ञापन मंज़ूर नहीं किए। क्या बदलना है, देखने के लिए विज्ञापन खोलें।",
    paused_title: "आपका विज्ञापन रुका हुआ है",
    paused_sold_out:
      "{event} के टिकट बिक चुके हैं, इसलिए विज्ञापन रुक गया। अब कुछ और खर्च नहीं होगा।",
    paused_credit_out:
      "विज्ञापन ने अपने लिए रखा क्रेडिट इस्तेमाल कर लिया। चलाते रहने के लिए बजट जोड़ें।",
    paused_host: "{name} ने आपका विज्ञापन रोका। आप इसे कभी भी फिर चालू कर सकते हैं।",
    paused_event_ended: "{event} खत्म हो गया, इसलिए विज्ञापन रुक गया।",
    paused_destination:
      "आपका पेज अभी सार्वजनिक नहीं है, इसलिए विज्ञापन रुक गया। फिर चलाने के लिए इसे सार्वजनिक करें।",
    paused_safety:
      "हम खर्च नहीं पढ़ पाए, इसलिए सुरक्षा के लिए विज्ञापन रोका गया। हम जल्द फिर जाँचेंगे।",
    paused_generic: "आपका विज्ञापन रुक गया। कारण जानने के लिए विज्ञापन खोलें।",
    credit_low_title: "विज्ञापन क्रेडिट कम हो रहा है",
    credit_low_body:
      "आज के खर्च पर करीब {days} दिन का क्रेडिट बचा है। एक हफ़्ते विज्ञापन चलाने के लिए {amount} टॉप अप करें।",
    ended_title: "आपका विज्ञापन खत्म हो गया",
    ended_returned:
      "खर्च: {spend}। Mingla द्वारा गिने गए नतीजे: {results}। {amount} का बिना इस्तेमाल हुआ क्रेडिट आपके बैलेंस में वापस आ गया।",
    ended_nothing:
      "खर्च: {spend}। Mingla द्वारा गिने गए नतीजे: {results}। कुछ नहीं बचा।",
    slow_title: "बिक्री उम्मीद से धीमी है",
    slow_body: "{event} उम्मीद से कम टिकट बेच रहा है। सुझावों के लिए विज्ञापन खोलें।",
    tired_title: "आपका विज्ञापन पुराना लगने लगा है",
    tired_body:
      "{app} पर लोग इसे कई बार देख चुके हैं। नतीजे बनाए रखने के लिए नया वीडियो या फ़ोटो जोड़ें।",
    last_title: "बस कुछ ही टिकट बचे हैं",
    last_body:
      "क्या आप चाहते हैं कि विज्ञापन कहे कि ये {event} के आखिरी टिकट हैं? चालू करने के लिए विज्ञापन खोलें।",
    reason_text_heavy: "तस्वीर में बहुत ज़्यादा टेक्स्ट है।",
    fix_text_heavy: "कम लिखावट वाली फ़ोटो इस्तेमाल करें।",
    reason_alcohol: "इसमें शराब दिखती है या उसका ज़िक्र है।",
    fix_alcohol: "टेक्स्ट और तस्वीर से ड्रिंक्स हटाएँ, या इसे सिर्फ़ वयस्कों को दिखाएँ।",
    reason_personal_attributes: "टेक्स्ट पढ़ने वाले की पहचान की ओर इशारा करता है।",
    fix_personal_attributes: "पढ़ने वाले की जगह इवेंट के बारे में बताएँ।",
    reason_misleading: "टेक्स्ट इवेंट से ज़्यादा का वादा करता है।",
    fix_misleading: "सिर्फ़ वही लिखें जो लोगों को सच में मिलेगा।",
    reason_landing_page:
      "ऐप आपका पेज नहीं खोल पाया, या वह विज्ञापन से मेल नहीं खाता था।",
    fix_landing_page: "जाँचें कि पेज सार्वजनिक है और विज्ञापन से मेल खाता है।",
    reason_low_quality: "वीडियो या फ़ोटो की क्वालिटी बहुत कम है।",
    fix_low_quality: "ज़्यादा साफ़ वीडियो या फ़ोटो इस्तेमाल करें।",
    reason_prohibited: "इसमें कुछ ऐसा है जिसकी ऐप अनुमति नहीं देता।",
    fix_prohibited: "तस्वीर या टेक्स्ट से वह हिस्सा हटाएँ।",
    reason_identity: "ऐप को सबूत चाहिए कि आप यह नाम या तस्वीर इस्तेमाल कर सकते हैं।",
    fix_identity: "अपने ब्रांड का नाम और अपनी फ़ोटो इस्तेमाल करें।",
  },
  id: {
    live_title: "Iklan kamu sudah tayang",
    live_body: "{event} sekarang tampil di {app}.",
    rejected_title: "{app} tidak menyetujui iklan kamu",
    part_rejected_title: "{app} tidak menyetujui {n} iklan kamu",
    part_suffix: "Iklan kamu yang lain tetap berjalan.",
    review_fallback:
      "{app} tidak menyetujui {n} iklan kamu. Buka iklannya untuk melihat apa yang perlu diubah.",
    paused_title: "Iklan kamu dijeda",
    paused_sold_out:
      "Tiket {event} habis terjual, jadi iklan kamu berhenti. Tidak ada biaya lagi.",
    paused_credit_out:
      "Iklan kamu sudah memakai kredit yang disisihkan untuknya. Tambah anggaran agar tetap berjalan.",
    paused_host:
      "{name} menjeda iklan kamu. Kamu bisa menyalakannya lagi kapan saja.",
    paused_event_ended: "{event} sudah selesai, jadi iklan kamu berhenti.",
    paused_destination:
      "Halaman kamu sedang tidak publik, jadi iklan kamu berhenti. Jadikan publik untuk menjalankannya lagi.",
    paused_safety:
      "Kami menjeda iklan kamu demi keamanan karena biayanya tidak terbaca. Kami akan cek lagi segera.",
    paused_generic:
      "Iklan kamu berhenti. Buka iklannya untuk melihat alasannya.",
    credit_low_title: "Kredit iklan kamu hampir habis",
    credit_low_body:
      "Sisa kredit sekitar {days} hari dengan biaya hari ini. Isi ulang {amount} agar iklan berjalan seminggu.",
    ended_title: "Iklan kamu sudah berakhir",
    ended_returned:
      "Terpakai: {spend}. Hasil yang dihitung Mingla: {results}. {amount} kredit yang tidak terpakai sudah kembali ke saldo kamu.",
    ended_nothing:
      "Terpakai: {spend}. Hasil yang dihitung Mingla: {results}. Tidak ada sisa.",
    slow_title: "Penjualan lebih lambat dari perkiraan",
    slow_body:
      "{event} menjual lebih sedikit tiket dari perkiraan. Buka iklannya untuk ide.",
    tired_title: "Iklan kamu mulai membosankan",
    tired_body:
      "Orang di {app} sudah sering melihatnya. Tambahkan video atau foto baru agar hasil tetap bagus.",
    last_title: "Tinggal sedikit tiket",
    last_body:
      "Mau iklan kamu bilang ini tiket terakhir untuk {event}? Buka iklannya untuk menyalakan.",
    reason_text_heavy: "Gambarnya terlalu banyak teks.",
    fix_text_heavy: "Pakai foto dengan tulisan lebih sedikit.",
    reason_alcohol: "Menampilkan atau menyebut alkohol.",
    fix_alcohol:
      "Hapus minuman dari teks dan gambar, atau tampilkan hanya untuk orang dewasa.",
    reason_personal_attributes: "Teksnya menyinggung siapa pembacanya.",
    fix_personal_attributes: "Gambarkan acaranya, bukan orang yang membaca.",
    reason_misleading:
      "Teksnya menjanjikan lebih dari yang bisa diberikan acara.",
    fix_misleading: "Tulis hanya yang benar-benar akan didapat orang.",
    reason_landing_page:
      "Aplikasi tidak bisa membuka halaman kamu, atau halamannya tidak cocok dengan iklan.",
    fix_landing_page: "Pastikan halamannya publik dan cocok dengan iklan.",
    reason_low_quality: "Kualitas video atau foto terlalu rendah.",
    fix_low_quality: "Pakai video atau foto yang lebih tajam.",
    reason_prohibited: "Menampilkan sesuatu yang tidak diizinkan aplikasi.",
    fix_prohibited: "Hapus bagian gambar atau teks itu.",
    reason_identity:
      "Aplikasi butuh bukti kamu boleh memakai nama atau gambar ini.",
    fix_identity: "Pakai nama brand kamu sendiri dan foto milikmu.",
  },
  ig: {
    live_title: "Mgbasa ozi gị na-agba ugbu a",
    live_body: "{event} na-egosi ugbu a na {app}.",
    rejected_title: "{app} anabataghị mgbasa ozi gị",
    part_rejected_title: "{app} anabataghị {n} n'ime mgbasa ozi gị",
    part_suffix: "Mgbasa ozi gị ndị ọzọ na-aga n'ihu.",
    review_fallback:
      "{app} anabataghị {n} n'ime mgbasa ozi gị. Mepee mgbasa ozi ahụ ka ịhụ ihe ị ga-agbanwe.",
    paused_title: "Akwụsịtụrụ mgbasa ozi gị",
    paused_sold_out:
      "Tiketi {event} agwụla, ya mere mgbasa ozi gị kwụsịrị. A gaghị emefu ego ọzọ.",
    paused_credit_out:
      "Mgbasa ozi gị ejirila ego e debere maka ya. Tinye ego ka ọ gaa n'ihu.",
    paused_host:
      "{name} kwụsịtụrụ mgbasa ozi gị. Ị nwere ike ịgbanye ya ọzọ mgbe ọ bụla.",
    paused_event_ended: "{event} agwụla, ya mere mgbasa ozi gị kwụsịrị.",
    paused_destination:
      "Ibe gị abụghị nke ọha ugbu a, ya mere mgbasa ozi gị kwụsịrị. Mee ka ọ bụrụ nke ọha ka ọ malite ọzọ.",
    paused_safety:
      "Anyị kwụsịtụrụ mgbasa ozi gị maka nchekwa n'ihi na anyị enweghị ike ịgụ ego o mefuru. Anyị ga-elele ọzọ n'oge na-adịghị anya.",
    paused_generic: "Mgbasa ozi gị kwụsịrị. Mepee ya ka ịmata ihe kpatara ya.",
    credit_low_title: "Ego mgbasa ozi gị na-agwụ",
    credit_low_body:
      "Ọ fọdụrụ ihe dị ka ụbọchị {days} n'ego ị na-emefu taa. Tinye {amount} ka mgbasa ozi gị gaa izu otu.",
    ended_title: "Mgbasa ozi gị agwụla",
    ended_returned:
      "E mefuru: {spend}. Nsonaazụ Mingla gụrụ: {results}. {amount} ego a na-ejighị laghachiri n'akaụntụ gị.",
    ended_nothing:
      "E mefuru: {spend}. Nsonaazụ Mingla gụrụ: {results}. Ọ dịghị ihe fọdụrụ.",
    slow_title: "Ire na-aga nwayọọ karịa ka a tụrụ anya",
    slow_body:
      "{event} na-ere tiketi pere mpe karịa ka a tụrụ anya. Mepee mgbasa ozi ahụ maka echiche.",
    tired_title: "Ndị mmadụ agwụla ike ịhụ mgbasa ozi gị",
    tired_body:
      "Ndị nọ na {app} ahụla ya ọtụtụ ugboro. Tinye vidiyo ma ọ bụ foto ọhụrụ ka nsonaazụ dị mma.",
    last_title: "Tiketi ole na ole fọdụrụ",
    last_body:
      "Ị chọrọ ka mgbasa ozi gị kwuo na ndị a bụ tiketi ikpeazụ maka {event}? Mepee mgbasa ozi ahụ ka ịgbanye ya.",
    reason_text_heavy: "Foto ahụ nwere ederede karịrị akarị.",
    fix_text_heavy: "Jiri foto nwere obere ederede.",
    reason_alcohol: "Ọ na-egosi ma ọ bụ kwuo maka mmanya.",
    fix_alcohol:
      "Wepụ ihe ọṅụṅụ n'ederede na foto, ma ọ bụ gosi ya naanị ndị okenye.",
    reason_personal_attributes:
      "Ederede ahụ na-atụ aka n'onye onye na-agụ ya bụ.",
    fix_personal_attributes: "Kọwaa mmemme ahụ kama onye na-agụ ya.",
    reason_misleading: "Ederede ahụ na-ekwe nkwa karịa ihe mmemme ahụ ga-enye.",
    fix_misleading: "Dee naanị ihe ndị mmadụ ga-enweta n'ezie.",
    reason_landing_page:
      "Ngwa ahụ enweghị ike imepe ibe gị, ma ọ bụ na ọ dabaghị na mgbasa ozi ahụ.",
    fix_landing_page:
      "Lelee na ibe ahụ bụ nke ọha ma dabara na mgbasa ozi ahụ.",
    reason_low_quality: "Ogo vidiyo ma ọ bụ foto ahụ dị ala nke ukwuu.",
    fix_low_quality: "Jiri vidiyo ma ọ bụ foto doro anya karịa.",
    reason_prohibited: "Ọ na-egosi ihe ngwa ahụ anaghị ekwe.",
    fix_prohibited: "Wepụ akụkụ ahụ na foto ma ọ bụ ederede.",
    reason_identity:
      "Ngwa ahụ chọrọ ihe akaebe na ị nwere ike iji aha ma ọ bụ foto a.",
    fix_identity: "Jiri aha ụdị gị na foto ndị bụ nke gị.",
  },
  it: {
    live_title: "Il tuo annuncio è attivo",
    live_body: "{event} ora è visibile su {app}.",
    rejected_title: "{app} non ha approvato il tuo annuncio",
    part_rejected_title: "{app} non ha approvato {n} dei tuoi annunci",
    part_suffix: "Gli altri annunci restano attivi.",
    review_fallback:
      "{app} non ha approvato {n} dei tuoi annunci. Apri l'annuncio per vedere cosa cambiare.",
    paused_title: "Il tuo annuncio è in pausa",
    paused_sold_out:
      "{event} è sold out, quindi il tuo annuncio si è fermato. Non si spende altro.",
    paused_credit_out:
      "Il tuo annuncio ha usato il credito riservato. Aggiungi budget per tenerlo attivo.",
    paused_host:
      "{name} ha messo in pausa il tuo annuncio. Puoi riattivarlo quando vuoi.",
    paused_event_ended:
      "{event} è finito, quindi il tuo annuncio si è fermato.",
    paused_destination:
      "La tua pagina ora non è pubblica, quindi il tuo annuncio si è fermato. Rendila pubblica per riattivarlo.",
    paused_safety:
      "Abbiamo messo in pausa l'annuncio per sicurezza perché non riuscivamo a leggerne la spesa. Ricontrolleremo presto.",
    paused_generic:
      "Il tuo annuncio si è fermato. Apri l'annuncio per vedere perché.",
    credit_low_title: "Il credito per gli annunci sta finendo",
    credit_low_body:
      "Restano circa {days} giorni di credito con la spesa attuale. Ricarica {amount} per tenere attivi gli annunci per una settimana.",
    ended_title: "Il tuo annuncio è terminato",
    ended_returned:
      "Speso: {spend}. Risultati contati da Mingla: {results}. {amount} di credito non usato è tornato nel tuo saldo.",
    ended_nothing:
      "Speso: {spend}. Risultati contati da Mingla: {results}. Non è avanzato nulla.",
    slow_title: "Le vendite sono più lente del previsto",
    slow_body:
      "{event} sta vendendo meno biglietti del previsto. Apri l'annuncio per qualche idea.",
    tired_title: "Il tuo annuncio si sta stancando",
    tired_body:
      "Le persone su {app} l'hanno visto spesso. Aggiungi un nuovo video o foto per mantenere i risultati.",
    last_title: "Restano pochi biglietti",
    last_body:
      "Vuoi che l'annuncio dica che sono gli ultimi biglietti per {event}? Apri l'annuncio per attivarlo.",
    reason_text_heavy: "L'immagine ha troppo testo.",
    fix_text_heavy: "Usa una foto con meno scritte.",
    reason_alcohol: "Mostra o cita alcol.",
    fix_alcohol:
      "Togli le bevande da testo e immagine, o mostralo solo agli adulti.",
    reason_personal_attributes: "Il testo si riferisce a chi legge.",
    fix_personal_attributes:
      "Descrivi l'evento invece della persona che legge.",
    reason_misleading: "Il testo promette più di quanto l'evento offra.",
    fix_misleading: "Limita il testo a ciò che le persone avranno davvero.",
    reason_landing_page:
      "L'app non è riuscita ad aprire la pagina, o non corrispondeva all'annuncio.",
    fix_landing_page:
      "Controlla che la pagina sia pubblica e corrisponda all'annuncio.",
    reason_low_quality: "La qualità del video o della foto è troppo bassa.",
    fix_low_quality: "Usa un video o una foto più nitidi.",
    reason_prohibited: "Mostra qualcosa che l'app non consente.",
    fix_prohibited: "Togli quella parte dall'immagine o dal testo.",
    reason_identity:
      "L'app vuole una prova che puoi usare questo nome o immagine.",
    fix_identity: "Usa il tuo nome del brand e foto tue.",
  },
  ja: {
    live_title: "広告が配信されました",
    live_body: "{event}が{app}で表示されています。",
    rejected_title: "{app}が広告を承認しませんでした",
    part_rejected_title: "{app}が{n}件の広告を承認しませんでした",
    part_suffix: "ほかの広告は配信を続けます。",
    review_fallback:
      "{app}が{n}件の広告を承認しませんでした。広告を開いて直す点を確認してください。",
    paused_title: "広告は一時停止中です",
    paused_sold_out:
      "{event}が完売したため、広告を停止しました。これ以上費用はかかりません。",
    paused_credit_out:
      "広告用に確保したクレジットを使い切りました。続けるには予算を追加してください。",
    paused_host: "{name}さんが広告を一時停止しました。いつでも再開できます。",
    paused_event_ended: "{event}が終了したため、広告を停止しました。",
    paused_destination:
      "ページが公開されていないため、広告を停止しました。公開すると再開できます。",
    paused_safety:
      "費用を読み取れなかったため、安全のため広告を一時停止しました。まもなく再確認します。",
    paused_generic: "広告が停止しました。理由は広告を開いて確認してください。",
    credit_low_title: "広告クレジットが残りわずかです",
    credit_low_body:
      "今日の費用で約{days}日分のクレジットが残っています。1週間配信するには{amount}をチャージしてください。",
    ended_title: "広告が終了しました",
    ended_returned:
      "使用額：{spend}。Minglaが数えた成果：{results}。未使用の{amount}が残高に戻りました。",
    ended_nothing:
      "使用額：{spend}。Minglaが数えた成果：{results}。残りはありません。",
    slow_title: "売れ行きが予想より遅いです",
    slow_body:
      "{event}のチケット販売が予想を下回っています。広告を開いてヒントを確認しましょう。",
    tired_title: "広告が見飽きられてきました",
    tired_body:
      "{app}で何度も表示されています。成果を保つため新しい動画や写真を追加しましょう。",
    last_title: "チケットは残りわずかです",
    last_body:
      "{event}の最後のチケットだと広告で伝えますか？広告を開いてオンにしてください。",
    reason_text_heavy: "画像の文字が多すぎます。",
    fix_text_heavy: "文字の少ない写真を使ってください。",
    reason_alcohol: "お酒を見せたり触れたりしています。",
    fix_alcohol: "文章と画像からお酒を外すか、大人だけに表示してください。",
    reason_personal_attributes: "文章が読む人の属性を指しています。",
    fix_personal_attributes: "読む人ではなくイベントについて書いてください。",
    reason_misleading: "文章がイベントの内容以上のことを約束しています。",
    fix_misleading: "実際に得られることだけを書いてください。",
    reason_landing_page:
      "アプリがページを開けなかったか、広告と一致しませんでした。",
    fix_landing_page:
      "ページが公開され、広告と一致しているか確認してください。",
    reason_low_quality: "動画や写真の画質が低すぎます。",
    fix_low_quality: "より鮮明な動画や写真を使ってください。",
    reason_prohibited: "アプリが認めていない内容が含まれています。",
    fix_prohibited: "画像や文章のその部分を削除してください。",
    reason_identity: "この名前や画像を使える証明がアプリに必要です。",
    fix_identity: "自分のブランド名と自分の写真を使ってください。",
  },
  ko: {
    live_title: "광고가 게재되었어요",
    live_body: "{event} 광고가 이제 {app}에 표시돼요.",
    rejected_title: "{app}에서 광고를 승인하지 않았어요",
    part_rejected_title: "{app}에서 광고 {n}개를 승인하지 않았어요",
    part_suffix: "다른 광고는 계속 게재돼요.",
    review_fallback:
      "{app}에서 광고 {n}개를 승인하지 않았어요. 광고를 열어 바꿀 점을 확인하세요.",
    paused_title: "광고가 일시 중지되었어요",
    paused_sold_out:
      "{event}이(가) 매진되어 광고가 멈췄어요. 더 이상 비용이 들지 않아요.",
    paused_credit_out:
      "광고에 배정한 크레딧을 모두 썼어요. 계속하려면 예산을 추가하세요.",
    paused_host:
      "{name} 님이 광고를 일시 중지했어요. 언제든 다시 켤 수 있어요.",
    paused_event_ended: "{event}이(가) 끝나서 광고가 멈췄어요.",
    paused_destination:
      "페이지가 지금 공개 상태가 아니라 광고가 멈췄어요. 다시 게재하려면 공개로 바꾸세요.",
    paused_safety:
      "비용을 읽지 못해 안전을 위해 광고를 일시 중지했어요. 곧 다시 확인할게요.",
    paused_generic: "광고가 멈췄어요. 이유를 보려면 광고를 여세요.",
    credit_low_title: "광고 크레딧이 얼마 남지 않았어요",
    credit_low_body:
      "오늘 비용 기준으로 약 {days}일치 크레딧이 남았어요. 일주일 동안 게재하려면 {amount}을(를) 충전하세요.",
    ended_title: "광고가 종료되었어요",
    ended_returned:
      "사용액: {spend}. Mingla가 집계한 성과: {results}. 사용하지 않은 {amount}이(가) 잔액으로 돌아왔어요.",
    ended_nothing:
      "사용액: {spend}. Mingla가 집계한 성과: {results}. 남은 금액은 없어요.",
    slow_title: "판매가 예상보다 느려요",
    slow_body:
      "{event}의 티켓 판매가 예상보다 적어요. 광고를 열어 아이디어를 확인하세요.",
    tired_title: "광고가 식상해지고 있어요",
    tired_body:
      "{app} 사용자들이 여러 번 봤어요. 성과를 유지하려면 새 동영상이나 사진을 추가하세요.",
    last_title: "티켓이 몇 장 안 남았어요",
    last_body:
      "광고에 {event}의 마지막 티켓이라고 표시할까요? 광고를 열어 켜세요.",
    reason_text_heavy: "이미지에 글자가 너무 많아요.",
    fix_text_heavy: "글자가 적은 사진을 사용하세요.",
    reason_alcohol: "술을 보여주거나 언급하고 있어요.",
    fix_alcohol: "문구와 이미지에서 음료를 빼거나 성인에게만 보여주세요.",
    reason_personal_attributes: "문구가 읽는 사람이 누구인지를 지목해요.",
    fix_personal_attributes: "읽는 사람 대신 이벤트를 설명하세요.",
    reason_misleading: "문구가 이벤트보다 더 많은 것을 약속해요.",
    fix_misleading: "사람들이 실제로 얻는 것만 쓰세요.",
    reason_landing_page: "앱이 페이지를 열지 못했거나 광고와 맞지 않았어요.",
    fix_landing_page: "페이지가 공개되어 있고 광고와 맞는지 확인하세요.",
    reason_low_quality: "동영상이나 사진 화질이 너무 낮아요.",
    fix_low_quality: "더 선명한 동영상이나 사진을 사용하세요.",
    reason_prohibited: "앱에서 허용하지 않는 내용이 있어요.",
    fix_prohibited: "이미지나 문구에서 그 부분을 빼세요.",
    reason_identity: "이 이름이나 이미지를 써도 된다는 증빙이 필요해요.",
    fix_identity: "내 브랜드 이름과 직접 가진 사진을 사용하세요.",
  },
  ms: {
    live_title: "Iklan anda sudah disiarkan",
    live_body: "{event} kini dipaparkan di {app}.",
    rejected_title: "{app} tidak meluluskan iklan anda",
    part_rejected_title: "{app} tidak meluluskan {n} daripada iklan anda",
    part_suffix: "Iklan anda yang lain terus berjalan.",
    review_fallback:
      "{app} tidak meluluskan {n} daripada iklan anda. Buka iklan untuk melihat apa yang perlu diubah.",
    paused_title: "Iklan anda dijeda",
    paused_sold_out:
      "Tiket {event} sudah habis, jadi iklan anda berhenti. Tiada perbelanjaan lagi.",
    paused_credit_out:
      "Iklan anda telah menggunakan kredit yang diketepikan untuknya. Tambah bajet supaya ia terus berjalan.",
    paused_host:
      "{name} menjeda iklan anda. Anda boleh menghidupkannya semula bila-bila masa.",
    paused_event_ended: "{event} telah tamat, jadi iklan anda berhenti.",
    paused_destination:
      "Halaman anda tidak awam sekarang, jadi iklan anda berhenti. Jadikannya awam untuk menjalankannya semula.",
    paused_safety:
      "Kami menjeda iklan anda demi keselamatan kerana perbelanjaannya tidak dapat dibaca. Kami akan semak semula tidak lama lagi.",
    paused_generic: "Iklan anda berhenti. Buka iklan untuk melihat sebabnya.",
    credit_low_title: "Kredit iklan anda hampir habis",
    credit_low_body:
      "Baki kredit kira-kira {days} hari pada perbelanjaan hari ini. Tambah nilai {amount} supaya iklan berjalan seminggu.",
    ended_title: "Iklan anda telah tamat",
    ended_returned:
      "Dibelanjakan: {spend}. Hasil yang dikira Mingla: {results}. {amount} kredit yang tidak digunakan telah kembali ke baki anda.",
    ended_nothing:
      "Dibelanjakan: {spend}. Hasil yang dikira Mingla: {results}. Tiada baki.",
    slow_title: "Jualan lebih perlahan daripada jangkaan",
    slow_body:
      "{event} menjual lebih sedikit tiket daripada jangkaan. Buka iklan untuk idea.",
    tired_title: "Iklan anda semakin jemu dilihat",
    tired_body:
      "Orang di {app} sudah kerap melihatnya. Tambah video atau foto baharu untuk mengekalkan hasil.",
    last_title: "Tinggal beberapa tiket sahaja",
    last_body:
      "Mahu iklan anda kata ini tiket terakhir untuk {event}? Buka iklan untuk menghidupkannya.",
    reason_text_heavy: "Imej mempunyai terlalu banyak teks.",
    fix_text_heavy: "Gunakan foto dengan kurang tulisan.",
    reason_alcohol: "Ia menunjukkan atau menyebut alkohol.",
    fix_alcohol:
      "Buang minuman daripada teks dan gambar, atau tunjukkan kepada orang dewasa sahaja.",
    reason_personal_attributes: "Teks menyentuh siapa pembacanya.",
    fix_personal_attributes: "Terangkan acara, bukan orang yang membaca.",
    reason_misleading: "Teks menjanjikan lebih daripada yang acara boleh beri.",
    fix_misleading: "Tulis hanya apa yang orang benar-benar akan dapat.",
    reason_landing_page:
      "Aplikasi tidak dapat membuka halaman anda, atau ia tidak sepadan dengan iklan.",
    fix_landing_page: "Pastikan halaman itu awam dan sepadan dengan iklan.",
    reason_low_quality: "Kualiti video atau foto terlalu rendah.",
    fix_low_quality: "Gunakan video atau foto yang lebih jelas.",
    reason_prohibited:
      "Ia menunjukkan sesuatu yang tidak dibenarkan oleh aplikasi.",
    fix_prohibited: "Buang bahagian gambar atau teks itu.",
    reason_identity:
      "Aplikasi memerlukan bukti anda boleh menggunakan nama atau imej ini.",
    fix_identity: "Gunakan nama jenama anda sendiri dan foto milik anda.",
  },
  nl: {
    live_title: "Je advertentie is live",
    live_body: "{event} wordt nu getoond op {app}.",
    rejected_title: "{app} heeft je advertentie niet goedgekeurd",
    part_rejected_title: "{app} heeft {n} van je advertenties niet goedgekeurd",
    part_suffix: "Je andere advertenties blijven lopen.",
    review_fallback:
      "{app} heeft {n} van je advertenties niet goedgekeurd. Open de advertentie om te zien wat je moet aanpassen.",
    paused_title: "Je advertentie is gepauzeerd",
    paused_sold_out:
      "{event} is uitverkocht, dus je advertentie is gestopt. Er wordt niets meer uitgegeven.",
    paused_credit_out:
      "Je advertentie heeft het gereserveerde tegoed gebruikt. Voeg budget toe om hem te laten lopen.",
    paused_host:
      "{name} heeft je advertentie gepauzeerd. Je kunt hem altijd weer aanzetten.",
    paused_event_ended: "{event} is afgelopen, dus je advertentie is gestopt.",
    paused_destination:
      "Je pagina is nu niet openbaar, dus je advertentie is gestopt. Maak hem openbaar om weer te starten.",
    paused_safety:
      "We hebben je advertentie voor de zekerheid gepauzeerd omdat we de uitgaven niet konden lezen. We kijken snel opnieuw.",
    paused_generic:
      "Je advertentie loopt niet meer. Open de advertentie om te zien waarom.",
    credit_low_title: "Je advertentietegoed raakt op",
    credit_low_body:
      "Nog ongeveer {days} dagen tegoed bij de huidige uitgaven. Waardeer {amount} op om je advertenties een week te laten lopen.",
    ended_title: "Je advertentie is afgelopen",
    ended_returned:
      "Uitgegeven: {spend}. Resultaten geteld door Mingla: {results}. {amount} ongebruikt tegoed staat weer op je saldo.",
    ended_nothing:
      "Uitgegeven: {spend}. Resultaten geteld door Mingla: {results}. Er is niets over.",
    slow_title: "De verkoop gaat trager dan verwacht",
    slow_body:
      "{event} verkoopt minder tickets dan verwacht. Open de advertentie voor ideeën.",
    tired_title: "Je advertentie raakt uitgekeken",
    tired_body:
      "Mensen op {app} hebben hem vaak gezien. Voeg een nieuwe video of foto toe om de resultaten op peil te houden.",
    last_title: "Nog maar een paar tickets",
    last_body:
      "Wil je dat je advertentie zegt dat dit de laatste tickets voor {event} zijn? Open de advertentie om het aan te zetten.",
    reason_text_heavy: "De afbeelding heeft te veel tekst.",
    fix_text_heavy: "Gebruik een foto met minder tekst erop.",
    reason_alcohol: "Hij toont of noemt alcohol.",
    fix_alcohol:
      "Haal drank uit de tekst en afbeelding, of toon hem alleen aan volwassenen.",
    reason_personal_attributes: "De tekst wijst op wie de lezer is.",
    fix_personal_attributes: "Beschrijf het evenement in plaats van de lezer.",
    reason_misleading: "De tekst belooft meer dan het evenement kan bieden.",
    fix_misleading: "Houd de tekst bij wat mensen echt krijgen.",
    reason_landing_page:
      "De app kon je pagina niet openen, of die paste niet bij de advertentie.",
    fix_landing_page:
      "Controleer of de pagina openbaar is en bij de advertentie past.",
    reason_low_quality: "De kwaliteit van de video of foto is te laag.",
    fix_low_quality: "Gebruik een scherpere video of foto.",
    reason_prohibited: "Hij toont iets wat de app niet toestaat.",
    fix_prohibited: "Haal dat deel uit de afbeelding of tekst.",
    reason_identity:
      "De app wil bewijs dat je deze naam of afbeelding mag gebruiken.",
    fix_identity: "Gebruik je eigen merknaam en foto's die van jou zijn.",
  },
  pl: {
    live_title: "Twoja reklama działa",
    live_body: "{event} wyświetla się teraz w {app}.",
    rejected_title: "{app} nie zatwierdził Twojej reklamy",
    part_rejected_title: "{app} nie zatwierdził {n} Twoich reklam",
    part_suffix: "Pozostałe reklamy nadal działają.",
    review_fallback:
      "{app} nie zatwierdził {n} Twoich reklam. Otwórz reklamę, aby zobaczyć, co zmienić.",
    paused_title: "Twoja reklama jest wstrzymana",
    paused_sold_out:
      "{event} jest wyprzedane, więc reklama się zatrzymała. Nic więcej nie jest wydawane.",
    paused_credit_out:
      "Reklama wykorzystała zarezerwowany dla niej kredyt. Dodaj budżet, aby dalej działała.",
    paused_host:
      "{name} wstrzymał(a) Twoją reklamę. Możesz ją włączyć w każdej chwili.",
    paused_event_ended: "{event} się zakończyło, więc reklama się zatrzymała.",
    paused_destination:
      "Twoja strona nie jest teraz publiczna, więc reklama się zatrzymała. Upublicznij ją, aby znów działała.",
    paused_safety:
      "Wstrzymaliśmy reklamę dla bezpieczeństwa, bo nie mogliśmy odczytać jej wydatków. Wkrótce sprawdzimy ponownie.",
    paused_generic:
      "Twoja reklama przestała działać. Otwórz ją, aby zobaczyć dlaczego.",
    credit_low_title: "Kończy się kredyt na reklamy",
    credit_low_body:
      "Przy obecnych wydatkach zostało około {days} dni kredytu. Doładuj {amount}, aby reklamy działały przez tydzień.",
    ended_title: "Twoja reklama się zakończyła",
    ended_returned:
      "Wydano: {spend}. Wyniki policzone przez Mingla: {results}. {amount} niewykorzystanego kredytu wróciło na Twoje saldo.",
    ended_nothing:
      "Wydano: {spend}. Wyniki policzone przez Mingla: {results}. Nic nie zostało.",
    slow_title: "Sprzedaż idzie wolniej niż zakładano",
    slow_body:
      "{event} sprzedaje mniej biletów niż zakładano. Otwórz reklamę, aby zobaczyć pomysły.",
    tired_title: "Twoja reklama się opatrzyła",
    tired_body:
      "Ludzie w {app} widzieli ją już wiele razy. Dodaj nowe wideo lub zdjęcie, aby utrzymać wyniki.",
    last_title: "Zostało tylko kilka biletów",
    last_body:
      "Chcesz, aby reklama mówiła, że to ostatnie bilety na {event}? Otwórz reklamę, aby to włączyć.",
    reason_text_heavy: "Obraz ma za dużo tekstu.",
    fix_text_heavy: "Użyj zdjęcia z mniejszą ilością napisów.",
    reason_alcohol: "Pokazuje lub wspomina alkohol.",
    fix_alcohol:
      "Usuń napoje z tekstu i obrazu albo pokazuj ją tylko dorosłym.",
    reason_personal_attributes: "Tekst odnosi się do tego, kim jest czytelnik.",
    fix_personal_attributes: "Opisz wydarzenie zamiast osoby, która czyta.",
    reason_misleading: "Tekst obiecuje więcej, niż wydarzenie może dać.",
    fix_misleading: "Pisz tylko o tym, co ludzie naprawdę dostaną.",
    reason_landing_page:
      "Aplikacja nie mogła otworzyć strony albo nie pasowała ona do reklamy.",
    fix_landing_page: "Sprawdź, czy strona jest publiczna i pasuje do reklamy.",
    reason_low_quality: "Jakość wideo lub zdjęcia jest za niska.",
    fix_low_quality: "Użyj ostrzejszego wideo lub zdjęcia.",
    reason_prohibited: "Pokazuje coś, na co aplikacja nie pozwala.",
    fix_prohibited: "Usuń tę część obrazu lub tekstu.",
    reason_identity:
      "Aplikacja potrzebuje dowodu, że możesz używać tej nazwy lub obrazu.",
    fix_identity: "Używaj własnej nazwy marki i własnych zdjęć.",
  },
  pt: {
    live_title: "Seu anúncio está no ar",
    live_body: "{event} já aparece no {app}.",
    rejected_title: "O {app} não aprovou seu anúncio",
    part_rejected_title: "O {app} não aprovou {n} dos seus anúncios",
    part_suffix: "Seus outros anúncios continuam no ar.",
    review_fallback:
      "O {app} não aprovou {n} dos seus anúncios. Abra o anúncio para ver o que mudar.",
    paused_title: "Seu anúncio está pausado",
    paused_sold_out:
      "{event} esgotou, então seu anúncio parou. Nada mais é gasto.",
    paused_credit_out:
      "Seu anúncio usou o crédito reservado para ele. Adicione orçamento para mantê-lo no ar.",
    paused_host:
      "{name} pausou seu anúncio. Você pode reativá-lo quando quiser.",
    paused_event_ended: "{event} terminou, então seu anúncio parou.",
    paused_destination:
      "Sua página não está pública agora, então seu anúncio parou. Deixe-a pública para rodar de novo.",
    paused_safety:
      "Pausamos seu anúncio por segurança porque não conseguimos ler o gasto. Vamos verificar de novo em breve.",
    paused_generic:
      "Seu anúncio parou de rodar. Abra o anúncio para ver o motivo.",
    credit_low_title: "Seu crédito de anúncios está acabando",
    credit_low_body:
      "Restam cerca de {days} dias de crédito no gasto atual. Recarregue {amount} para manter seus anúncios por uma semana.",
    ended_title: "Seu anúncio terminou",
    ended_returned:
      "Gasto: {spend}. Resultados contados pela Mingla: {results}. {amount} de crédito não usado voltou ao seu saldo.",
    ended_nothing:
      "Gasto: {spend}. Resultados contados pela Mingla: {results}. Não sobrou nada.",
    slow_title: "As vendas estão mais lentas que o esperado",
    slow_body:
      "{event} está vendendo menos ingressos que o esperado. Abra o anúncio para ver ideias.",
    tired_title: "Seu anúncio está cansando",
    tired_body:
      "As pessoas no {app} já o viram muito. Adicione um vídeo ou foto novos para manter os resultados.",
    last_title: "Restam poucos ingressos",
    last_body:
      "Quer que seu anúncio diga que são os últimos ingressos para {event}? Abra o anúncio para ativar.",
    reason_text_heavy: "A imagem tem texto demais.",
    fix_text_heavy: "Use uma foto com menos texto.",
    reason_alcohol: "Mostra ou menciona álcool.",
    fix_alcohol:
      "Tire as bebidas do texto e da imagem, ou mostre só para adultos.",
    reason_personal_attributes: "O texto aponta quem é o leitor.",
    fix_personal_attributes: "Descreva o evento em vez da pessoa que lê.",
    reason_misleading: "O texto promete mais do que o evento oferece.",
    fix_misleading: "Fale só do que as pessoas vão receber de verdade.",
    reason_landing_page:
      "O app não conseguiu abrir sua página, ou ela não combinava com o anúncio.",
    fix_landing_page:
      "Confira se a página está pública e combina com o anúncio.",
    reason_low_quality: "A qualidade do vídeo ou da foto está baixa demais.",
    fix_low_quality: "Use um vídeo ou foto mais nítidos.",
    reason_prohibited: "Mostra algo que o app não permite.",
    fix_prohibited: "Remova essa parte da imagem ou do texto.",
    reason_identity:
      "O app precisa de prova de que você pode usar este nome ou imagem.",
    fix_identity: "Use o nome da sua marca e fotos que sejam suas.",
  },
  ro: {
    live_title: "Reclama ta este activă",
    live_body: "{event} apare acum pe {app}.",
    rejected_title: "{app} nu ți-a aprobat reclama",
    part_rejected_title: "{app} nu a aprobat {n} dintre reclamele tale",
    part_suffix: "Celelalte reclame continuă să ruleze.",
    review_fallback:
      "{app} nu a aprobat {n} dintre reclamele tale. Deschide reclama ca să vezi ce să schimbi.",
    paused_title: "Reclama ta este pusă pe pauză",
    paused_sold_out:
      "{event} este sold out, așa că reclama s-a oprit. Nu se mai cheltuie nimic.",
    paused_credit_out:
      "Reclama a folosit creditul rezervat pentru ea. Adaugă buget ca să continue.",
    paused_host: "{name} a pus reclama pe pauză. O poți porni din nou oricând.",
    paused_event_ended: "{event} s-a încheiat, așa că reclama s-a oprit.",
    paused_destination:
      "Pagina ta nu este publică acum, așa că reclama s-a oprit. Fă-o publică pentru a rula din nou.",
    paused_safety:
      "Am pus reclama pe pauză din motive de siguranță, pentru că nu am putut citi cheltuielile. Verificăm din nou curând.",
    paused_generic: "Reclama ta s-a oprit. Deschide reclama ca să vezi de ce.",
    credit_low_title: "Creditul pentru reclame se termină",
    credit_low_body:
      "Mai sunt aproximativ {days} zile de credit la cheltuiala de azi. Reîncarcă {amount} ca reclamele să ruleze o săptămână.",
    ended_title: "Reclama ta s-a încheiat",
    ended_returned:
      "Cheltuit: {spend}. Rezultate numărate de Mingla: {results}. {amount} credit nefolosit a revenit în soldul tău.",
    ended_nothing:
      "Cheltuit: {spend}. Rezultate numărate de Mingla: {results}. Nu a rămas nimic.",
    slow_title: "Vânzările merg mai încet decât te așteptai",
    slow_body:
      "{event} vinde mai puține bilete decât era de așteptat. Deschide reclama pentru idei.",
    tired_title: "Reclama ta începe să obosească",
    tired_body:
      "Oamenii de pe {app} au văzut-o de multe ori. Adaugă un video sau o fotografie nouă ca să păstrezi rezultatele.",
    last_title: "Au mai rămas puține bilete",
    last_body:
      "Vrei ca reclama să spună că sunt ultimele bilete pentru {event}? Deschide reclama ca să activezi.",
    reason_text_heavy: "Imaginea are prea mult text.",
    fix_text_heavy: "Folosește o fotografie cu mai puțin text.",
    reason_alcohol: "Arată sau menționează alcool.",
    fix_alcohol:
      "Scoate băuturile din text și imagine sau arat-o doar adulților.",
    reason_personal_attributes: "Textul vizează cine este cititorul.",
    fix_personal_attributes: "Descrie evenimentul, nu persoana care citește.",
    reason_misleading: "Textul promite mai mult decât poate oferi evenimentul.",
    fix_misleading: "Rezumă-te la ce vor primi oamenii cu adevărat.",
    reason_landing_page:
      "Aplicația nu a putut deschide pagina sau nu se potrivea cu reclama.",
    fix_landing_page:
      "Verifică dacă pagina e publică și se potrivește cu reclama.",
    reason_low_quality:
      "Calitatea videoclipului sau a fotografiei este prea slabă.",
    fix_low_quality: "Folosește un video sau o fotografie mai clară.",
    reason_prohibited: "Arată ceva ce aplicația nu permite.",
    fix_prohibited: "Elimină acea parte din imagine sau text.",
    reason_identity:
      "Aplicația vrea dovada că poți folosi acest nume sau această imagine.",
    fix_identity: "Folosește numele propriului brand și fotografii proprii.",
  },
  ru: {
    live_title: "Ваша реклама запущена",
    live_body: "{event} теперь показывается в {app}.",
    rejected_title: "{app} не одобрил вашу рекламу",
    part_rejected_title: "{app} не одобрил {n} ваших объявлений",
    part_suffix: "Остальные объявления продолжают работать.",
    review_fallback:
      "{app} не одобрил {n} ваших объявлений. Откройте рекламу, чтобы увидеть, что изменить.",
    paused_title: "Ваша реклама на паузе",
    paused_sold_out:
      "Билеты на {event} распроданы, поэтому реклама остановлена. Больше ничего не тратится.",
    paused_credit_out:
      "Реклама израсходовала выделенный для неё кредит. Добавьте бюджет, чтобы она продолжала работать.",
    paused_host:
      "{name} поставил(а) рекламу на паузу. Вы можете включить её снова в любой момент.",
    paused_event_ended: "{event} закончилось, поэтому реклама остановлена.",
    paused_destination:
      "Ваша страница сейчас не публичная, поэтому реклама остановлена. Сделайте её публичной, чтобы снова запустить.",
    paused_safety:
      "Мы поставили рекламу на паузу для безопасности, потому что не смогли прочитать её расходы. Скоро проверим снова.",
    paused_generic:
      "Ваша реклама остановилась. Откройте её, чтобы узнать почему.",
    credit_low_title: "Кредит на рекламу заканчивается",
    credit_low_body:
      "При текущих расходах кредита хватит примерно на {days} дн. Пополните {amount}, чтобы реклама работала неделю.",
    ended_title: "Ваша реклама завершена",
    ended_returned:
      "Потрачено: {spend}. Результаты по подсчёту Mingla: {results}. {amount} неиспользованного кредита вернулось на ваш баланс.",
    ended_nothing:
      "Потрачено: {spend}. Результаты по подсчёту Mingla: {results}. Ничего не осталось.",
    slow_title: "Продажи идут медленнее, чем ожидалось",
    slow_body:
      "{event} продаёт меньше билетов, чем ожидалось. Откройте рекламу, чтобы найти идеи.",
    tired_title: "Ваша реклама приелась",
    tired_body:
      "Люди в {app} видели её много раз. Добавьте новое видео или фото, чтобы сохранить результаты.",
    last_title: "Осталось всего несколько билетов",
    last_body:
      "Хотите, чтобы реклама говорила, что это последние билеты на {event}? Откройте рекламу, чтобы включить.",
    reason_text_heavy: "На изображении слишком много текста.",
    fix_text_heavy: "Используйте фото с меньшим количеством надписей.",
    reason_alcohol: "Показывает или упоминает алкоголь.",
    fix_alcohol:
      "Уберите напитки из текста и картинки или показывайте только взрослым.",
    reason_personal_attributes: "Текст указывает на то, кто читатель.",
    fix_personal_attributes: "Опишите мероприятие, а не того, кто читает.",
    reason_misleading: "Текст обещает больше, чем может дать мероприятие.",
    fix_misleading: "Пишите только о том, что люди действительно получат.",
    reason_landing_page:
      "Приложение не смогло открыть вашу страницу или она не соответствовала рекламе.",
    fix_landing_page:
      "Проверьте, что страница публичная и соответствует рекламе.",
    reason_low_quality: "Слишком низкое качество видео или фото.",
    fix_low_quality: "Используйте более чёткое видео или фото.",
    reason_prohibited: "Показывает то, что приложение не разрешает.",
    fix_prohibited: "Уберите эту часть изображения или текста.",
    reason_identity:
      "Приложению нужно подтверждение, что вы можете использовать это имя или изображение.",
    fix_identity: "Используйте своё название бренда и свои фотографии.",
  },
  sv: {
    live_title: "Din annons är live",
    live_body: "{event} visas nu på {app}.",
    rejected_title: "{app} godkände inte din annons",
    part_rejected_title: "{app} godkände inte {n} av dina annonser",
    part_suffix: "Dina andra annonser fortsätter att visas.",
    review_fallback:
      "{app} godkände inte {n} av dina annonser. Öppna annonsen för att se vad du ska ändra.",
    paused_title: "Din annons är pausad",
    paused_sold_out:
      "{event} är slutsålt, så din annons stoppades. Inget mer spenderas.",
    paused_credit_out:
      "Din annons har använt krediten som var avsatt för den. Lägg till budget för att hålla den igång.",
    paused_host:
      "{name} pausade din annons. Du kan slå på den igen när du vill.",
    paused_event_ended: "{event} är slut, så din annons stoppades.",
    paused_destination:
      "Din sida är inte offentlig just nu, så din annons stoppades. Gör den offentlig för att köra den igen.",
    paused_safety:
      "Vi pausade din annons för säkerhets skull eftersom vi inte kunde läsa av kostnaden. Vi kollar igen snart.",
    paused_generic:
      "Din annons visas inte längre. Öppna annonsen för att se varför.",
    credit_low_title: "Din annonskredit börjar ta slut",
    credit_low_body:
      "Ungefär {days} dagars kredit kvar med dagens kostnad. Fyll på {amount} för att hålla annonserna igång en vecka.",
    ended_title: "Din annons har avslutats",
    ended_returned:
      "Spenderat: {spend}. Resultat räknade av Mingla: {results}. {amount} oanvänd kredit är tillbaka på ditt saldo.",
    ended_nothing:
      "Spenderat: {spend}. Resultat räknade av Mingla: {results}. Inget blev över.",
    slow_title: "Försäljningen går långsammare än väntat",
    slow_body:
      "{event} säljer färre biljetter än väntat. Öppna annonsen för idéer.",
    tired_title: "Din annons börjar bli sliten",
    tired_body:
      "Folk på {app} har sett den många gånger. Lägg till en ny video eller bild för att hålla resultaten uppe.",
    last_title: "Bara några biljetter kvar",
    last_body:
      "Vill du att annonsen säger att det är de sista biljetterna till {event}? Öppna annonsen för att slå på det.",
    reason_text_heavy: "Bilden har för mycket text.",
    fix_text_heavy: "Använd en bild med mindre text på.",
    reason_alcohol: "Den visar eller nämner alkohol.",
    fix_alcohol:
      "Ta bort drycker från text och bild, eller visa den bara för vuxna.",
    reason_personal_attributes: "Texten pekar ut vem läsaren är.",
    fix_personal_attributes:
      "Beskriv eventet i stället för personen som läser.",
    reason_misleading: "Texten lovar mer än eventet kan ge.",
    fix_misleading: "Håll texten till det folk verkligen får.",
    reason_landing_page:
      "Appen kunde inte öppna din sida, eller så matchade den inte annonsen.",
    fix_landing_page:
      "Kontrollera att sidan är offentlig och matchar annonsen.",
    reason_low_quality: "Kvaliteten på videon eller bilden är för låg.",
    fix_low_quality: "Använd en skarpare video eller bild.",
    reason_prohibited: "Den visar något som appen inte tillåter.",
    fix_prohibited: "Ta bort den delen av bilden eller texten.",
    reason_identity:
      "Appen behöver bevis på att du får använda namnet eller bilden.",
    fix_identity: "Använd ditt eget varumärkesnamn och egna bilder.",
  },
  th: {
    live_title: "โฆษณาของคุณออนไลน์แล้ว",
    live_body: "{event} กำลังแสดงบน {app}",
    rejected_title: "{app} ไม่อนุมัติโฆษณาของคุณ",
    part_rejected_title: "{app} ไม่อนุมัติโฆษณาของคุณ {n} รายการ",
    part_suffix: "โฆษณาอื่นของคุณยังทำงานต่อ",
    review_fallback:
      "{app} ไม่อนุมัติโฆษณาของคุณ {n} รายการ เปิดโฆษณาเพื่อดูว่าต้องแก้อะไร",
    paused_title: "โฆษณาของคุณหยุดชั่วคราว",
    paused_sold_out: "บัตร {event} ขายหมดแล้ว โฆษณาจึงหยุด ไม่มีการใช้จ่ายเพิ่ม",
    paused_credit_out: "โฆษณาใช้เครดิตที่กันไว้หมดแล้ว เพิ่มงบเพื่อให้ทำงานต่อ",
    paused_host: "{name} หยุดโฆษณาของคุณชั่วคราว คุณเปิดใหม่ได้ทุกเมื่อ",
    paused_event_ended: "{event} จบแล้ว โฆษณาจึงหยุด",
    paused_destination:
      "หน้าของคุณไม่ได้เป็นสาธารณะตอนนี้ โฆษณาจึงหยุด ตั้งเป็นสาธารณะเพื่อเปิดใหม่",
    paused_safety:
      "เราหยุดโฆษณาไว้เพื่อความปลอดภัยเพราะอ่านค่าใช้จ่ายไม่ได้ เราจะตรวจอีกครั้งเร็ว ๆ นี้",
    paused_generic: "โฆษณาของคุณหยุดทำงาน เปิดโฆษณาเพื่อดูสาเหตุ",
    credit_low_title: "เครดิตโฆษณาใกล้หมด",
    credit_low_body:
      "เหลือเครดิตประมาณ {days} วันตามการใช้จ่ายวันนี้ เติม {amount} เพื่อให้โฆษณาทำงานหนึ่งสัปดาห์",
    ended_title: "โฆษณาของคุณสิ้นสุดแล้ว",
    ended_returned:
      "ใช้ไป: {spend} ผลลัพธ์ที่ Mingla นับ: {results} เครดิตที่ไม่ได้ใช้ {amount} กลับเข้ายอดคงเหลือแล้ว",
    ended_nothing: "ใช้ไป: {spend} ผลลัพธ์ที่ Mingla นับ: {results} ไม่มีเหลือ",
    slow_title: "ยอดขายช้ากว่าที่คาด",
    slow_body: "{event} ขายบัตรได้น้อยกว่าที่คาด เปิดโฆษณาเพื่อดูไอเดีย",
    tired_title: "โฆษณาของคุณเริ่มจืด",
    tired_body: "คนบน {app} เห็นมันบ่อยแล้ว เพิ่มวิดีโอหรือรูปใหม่เพื่อรักษาผลลัพธ์",
    last_title: "เหลือบัตรอีกไม่กี่ใบ",
    last_body: "อยากให้โฆษณาบอกว่าเป็นบัตรชุดสุดท้ายของ {event} ไหม เปิดโฆษณาเพื่อเปิดใช้",
    reason_text_heavy: "รูปมีข้อความมากเกินไป",
    fix_text_heavy: "ใช้รูปที่มีตัวหนังสือน้อยลง",
    reason_alcohol: "แสดงหรือกล่าวถึงแอลกอฮอล์",
    fix_alcohol: "เอาเครื่องดื่มออกจากข้อความและรูป หรือแสดงให้ผู้ใหญ่เท่านั้น",
    reason_personal_attributes: "ข้อความพุ่งเป้าว่าผู้อ่านเป็นใคร",
    fix_personal_attributes: "บรรยายงานแทนการพูดถึงผู้อ่าน",
    reason_misleading: "ข้อความสัญญาเกินกว่าที่งานให้ได้",
    fix_misleading: "เขียนเฉพาะสิ่งที่ผู้คนจะได้รับจริง",
    reason_landing_page: "แอปเปิดหน้าของคุณไม่ได้ หรือหน้าไม่ตรงกับโฆษณา",
    fix_landing_page: "ตรวจว่าหน้าเป็นสาธารณะและตรงกับโฆษณา",
    reason_low_quality: "คุณภาพวิดีโอหรือรูปต่ำเกินไป",
    fix_low_quality: "ใช้วิดีโอหรือรูปที่คมชัดกว่า",
    reason_prohibited: "แสดงสิ่งที่แอปไม่อนุญาต",
    fix_prohibited: "เอาส่วนนั้นออกจากรูปหรือข้อความ",
    reason_identity: "แอปต้องการหลักฐานว่าคุณใช้ชื่อหรือรูปนี้ได้",
    fix_identity: "ใช้ชื่อแบรนด์ของคุณเองและรูปที่เป็นของคุณ",
  },
  tr: {
    live_title: "Reklamın yayında",
    live_body: "{event} artık {app} üzerinde gösteriliyor.",
    rejected_title: "{app} reklamını onaylamadı",
    part_rejected_title: "{app} reklamlarından {n} tanesini onaylamadı",
    part_suffix: "Diğer reklamların yayında kalıyor.",
    review_fallback:
      "{app} reklamlarından {n} tanesini onaylamadı. Neyi değiştireceğini görmek için reklamı aç.",
    paused_title: "Reklamın duraklatıldı",
    paused_sold_out:
      "{event} tükendi, bu yüzden reklamın durdu. Daha fazla harcama yapılmıyor.",
    paused_credit_out:
      "Reklamın kendisi için ayrılan krediyi kullandı. Yayında kalması için bütçe ekle.",
    paused_host:
      "{name} reklamını duraklattı. İstediğin zaman yeniden açabilirsin.",
    paused_event_ended: "{event} sona erdi, bu yüzden reklamın durdu.",
    paused_destination:
      "Sayfan şu an herkese açık değil, bu yüzden reklamın durdu. Tekrar yayınlamak için sayfayı herkese aç.",
    paused_safety:
      "Harcamasını okuyamadığımız için reklamını güvenlik amacıyla duraklattık. Yakında tekrar kontrol edeceğiz.",
    paused_generic: "Reklamın durdu. Nedenini görmek için reklamı aç.",
    credit_low_title: "Reklam kredin azalıyor",
    credit_low_body:
      "Bugünkü harcamayla yaklaşık {days} günlük kredin kaldı. Reklamların bir hafta yayında kalsın diye {amount} yükle.",
    ended_title: "Reklamın sona erdi",
    ended_returned:
      "Harcanan: {spend}. Mingla'nın saydığı sonuçlar: {results}. Kullanılmayan {amount} kredi bakiyene geri döndü.",
    ended_nothing:
      "Harcanan: {spend}. Mingla'nın saydığı sonuçlar: {results}. Hiçbir şey artmadı.",
    slow_title: "Satışlar beklenenden yavaş",
    slow_body:
      "{event} beklenenden az bilet satıyor. Fikirler için reklamı aç.",
    tired_title: "Reklamın yıpranıyor",
    tired_body:
      "{app} kullanıcıları onu çok gördü. Sonuçları korumak için yeni bir video veya fotoğraf ekle.",
    last_title: "Sadece birkaç bilet kaldı",
    last_body:
      "Reklamının {event} için son biletler olduğunu söylemesini ister misin? Açmak için reklamı aç.",
    reason_text_heavy: "Görselde çok fazla yazı var.",
    fix_text_heavy: "Daha az yazı içeren bir fotoğraf kullan.",
    reason_alcohol: "Alkol gösteriyor veya alkolden bahsediyor.",
    fix_alcohol:
      "İçecekleri metinden ve görselden çıkar ya da yalnızca yetişkinlere göster.",
    reason_personal_attributes: "Metin okuyanın kim olduğunu işaret ediyor.",
    fix_personal_attributes: "Okuyan kişi yerine etkinliği anlat.",
    reason_misleading:
      "Metin etkinliğin verebileceğinden fazlasını vaat ediyor.",
    fix_misleading: "Metni insanların gerçekten alacağı şeyle sınırla.",
    reason_landing_page:
      "Uygulama sayfanı açamadı ya da sayfa reklamla uyuşmadı.",
    fix_landing_page:
      "Sayfanın herkese açık olduğunu ve reklamla uyuştuğunu kontrol et.",
    reason_low_quality: "Video veya fotoğraf kalitesi çok düşük.",
    fix_low_quality: "Daha net bir video veya fotoğraf kullan.",
    reason_prohibited: "Uygulamanın izin vermediği bir şey gösteriyor.",
    fix_prohibited: "Görselin veya metnin o kısmını kaldır.",
    reason_identity:
      "Uygulama bu adı veya görseli kullanabileceğine dair kanıt istiyor.",
    fix_identity: "Kendi marka adını ve sana ait fotoğrafları kullan.",
  },
  uk: {
    live_title: "Ваша реклама запущена",
    live_body: "{event} тепер показується в {app}.",
    rejected_title: "{app} не схвалив вашу рекламу",
    part_rejected_title: "{app} не схвалив {n} ваших оголошень",
    part_suffix: "Інші оголошення продовжують працювати.",
    review_fallback:
      "{app} не схвалив {n} ваших оголошень. Відкрийте рекламу, щоб побачити, що змінити.",
    paused_title: "Ваша реклама на паузі",
    paused_sold_out:
      "Квитки на {event} розпродано, тому реклама зупинилася. Більше нічого не витрачається.",
    paused_credit_out:
      "Реклама використала виділений для неї кредит. Додайте бюджет, щоб вона працювала далі.",
    paused_host:
      "{name} поставив(ла) рекламу на паузу. Ви можете увімкнути її знову будь-коли.",
    paused_event_ended: "{event} завершилася, тому реклама зупинилася.",
    paused_destination:
      "Ваша сторінка зараз не публічна, тому реклама зупинилася. Зробіть її публічною, щоб запустити знову.",
    paused_safety:
      "Ми поставили рекламу на паузу для безпеки, бо не змогли прочитати її витрати. Скоро перевіримо знову.",
    paused_generic:
      "Ваша реклама зупинилася. Відкрийте її, щоб дізнатися чому.",
    credit_low_title: "Кредит на рекламу закінчується",
    credit_low_body:
      "За поточних витрат кредиту вистачить приблизно на {days} дн. Поповніть {amount}, щоб реклама працювала тиждень.",
    ended_title: "Ваша реклама завершилася",
    ended_returned:
      "Витрачено: {spend}. Результати за підрахунком Mingla: {results}. {amount} невикористаного кредиту повернулося на ваш баланс.",
    ended_nothing:
      "Витрачено: {spend}. Результати за підрахунком Mingla: {results}. Нічого не залишилося.",
    slow_title: "Продажі йдуть повільніше, ніж очікувалося",
    slow_body:
      "{event} продає менше квитків, ніж очікувалося. Відкрийте рекламу, щоб знайти ідеї.",
    tired_title: "Ваша реклама набридла",
    tired_body:
      "Люди в {app} бачили її багато разів. Додайте нове відео чи фото, щоб зберегти результати.",
    last_title: "Залишилося лише кілька квитків",
    last_body:
      "Хочете, щоб реклама казала, що це останні квитки на {event}? Відкрийте рекламу, щоб увімкнути.",
    reason_text_heavy: "На зображенні забагато тексту.",
    fix_text_heavy: "Використайте фото з меншою кількістю написів.",
    reason_alcohol: "Показує або згадує алкоголь.",
    fix_alcohol:
      "Приберіть напої з тексту й зображення або показуйте лише дорослим.",
    reason_personal_attributes: "Текст вказує на те, хто читач.",
    fix_personal_attributes: "Опишіть подію, а не того, хто читає.",
    reason_misleading: "Текст обіцяє більше, ніж може дати подія.",
    fix_misleading: "Пишіть лише про те, що люди справді отримають.",
    reason_landing_page:
      "Застосунок не зміг відкрити вашу сторінку або вона не відповідала рекламі.",
    fix_landing_page: "Перевірте, що сторінка публічна й відповідає рекламі.",
    reason_low_quality: "Якість відео чи фото надто низька.",
    fix_low_quality: "Використайте чіткіше відео чи фото.",
    reason_prohibited: "Показує те, що застосунок не дозволяє.",
    fix_prohibited: "Приберіть цю частину зображення чи тексту.",
    reason_identity:
      "Застосунку потрібне підтвердження, що ви можете використовувати цю назву чи зображення.",
    fix_identity: "Використовуйте власну назву бренду й власні фото.",
  },
  vi: {
    live_title: "Quảng cáo của bạn đã chạy",
    live_body: "{event} hiện đang hiển thị trên {app}.",
    rejected_title: "{app} không duyệt quảng cáo của bạn",
    part_rejected_title: "{app} không duyệt {n} quảng cáo của bạn",
    part_suffix: "Các quảng cáo khác vẫn tiếp tục chạy.",
    review_fallback:
      "{app} không duyệt {n} quảng cáo của bạn. Mở quảng cáo để xem cần sửa gì.",
    paused_title: "Quảng cáo của bạn đang tạm dừng",
    paused_sold_out:
      "{event} đã bán hết vé nên quảng cáo đã dừng. Không chi thêm gì nữa.",
    paused_credit_out:
      "Quảng cáo đã dùng hết khoản tín dụng dành cho nó. Thêm ngân sách để tiếp tục chạy.",
    paused_host:
      "{name} đã tạm dừng quảng cáo. Bạn có thể bật lại bất cứ lúc nào.",
    paused_event_ended: "{event} đã kết thúc nên quảng cáo đã dừng.",
    paused_destination:
      "Trang của bạn hiện không công khai nên quảng cáo đã dừng. Hãy công khai trang để chạy lại.",
    paused_safety:
      "Chúng tôi tạm dừng quảng cáo để an toàn vì không đọc được chi phí. Chúng tôi sẽ kiểm tra lại sớm.",
    paused_generic: "Quảng cáo của bạn đã dừng. Mở quảng cáo để xem lý do.",
    credit_low_title: "Tín dụng quảng cáo sắp hết",
    credit_low_body:
      "Còn khoảng {days} ngày tín dụng theo mức chi hôm nay. Nạp {amount} để quảng cáo chạy thêm một tuần.",
    ended_title: "Quảng cáo của bạn đã kết thúc",
    ended_returned:
      "Đã chi: {spend}. Kết quả do Mingla đếm: {results}. {amount} tín dụng chưa dùng đã trở lại số dư của bạn.",
    ended_nothing:
      "Đã chi: {spend}. Kết quả do Mingla đếm: {results}. Không còn dư.",
    slow_title: "Doanh số chậm hơn dự kiến",
    slow_body: "{event} bán được ít vé hơn dự kiến. Mở quảng cáo để xem gợi ý.",
    tired_title: "Quảng cáo của bạn đang nhàm",
    tired_body:
      "Mọi người trên {app} đã xem nó nhiều lần. Thêm video hoặc ảnh mới để giữ kết quả.",
    last_title: "Chỉ còn vài vé",
    last_body:
      "Bạn muốn quảng cáo nói đây là những vé cuối cho {event}? Mở quảng cáo để bật.",
    reason_text_heavy: "Hình ảnh có quá nhiều chữ.",
    fix_text_heavy: "Dùng ảnh có ít chữ hơn.",
    reason_alcohol: "Có hình ảnh hoặc nhắc đến rượu bia.",
    fix_alcohol: "Bỏ đồ uống khỏi chữ và ảnh, hoặc chỉ hiển thị cho người lớn.",
    reason_personal_attributes: "Nội dung nhắm vào việc người đọc là ai.",
    fix_personal_attributes: "Mô tả sự kiện thay vì người đang đọc.",
    reason_misleading: "Nội dung hứa hẹn nhiều hơn sự kiện có thể mang lại.",
    fix_misleading: "Chỉ viết những gì mọi người thực sự nhận được.",
    reason_landing_page:
      "Ứng dụng không mở được trang của bạn, hoặc trang không khớp với quảng cáo.",
    fix_landing_page: "Kiểm tra trang đã công khai và khớp với quảng cáo.",
    reason_low_quality: "Chất lượng video hoặc ảnh quá thấp.",
    fix_low_quality: "Dùng video hoặc ảnh sắc nét hơn.",
    reason_prohibited: "Có nội dung ứng dụng không cho phép.",
    fix_prohibited: "Bỏ phần đó khỏi ảnh hoặc chữ.",
    reason_identity:
      "Ứng dụng cần bằng chứng bạn được dùng tên hoặc hình ảnh này.",
    fix_identity: "Dùng tên thương hiệu của bạn và ảnh của chính bạn.",
  },
  yo: {
    live_title: "Ìpolówó rẹ ti bẹ̀rẹ̀",
    live_body: "{event} ti ń hàn lórí {app} báyìí.",
    rejected_title: "{app} kò fọwọ́ sí ìpolówó rẹ",
    part_rejected_title: "{app} kò fọwọ́ sí {n} nínú àwọn ìpolówó rẹ",
    part_suffix: "Àwọn ìpolówó rẹ yòókù ń bá a lọ.",
    review_fallback:
      "{app} kò fọwọ́ sí {n} nínú àwọn ìpolówó rẹ. Ṣí ìpolówó náà láti rí ohun tí o máa yí padà.",
    paused_title: "Ìpolówó rẹ ti dúró díẹ̀",
    paused_sold_out:
      "Tíkẹ́ẹ̀tì {event} ti tán, nítorí náà ìpolówó rẹ dúró. Kò sí owó mìíràn tí a ó ná.",
    paused_credit_out:
      "Ìpolówó rẹ ti lo owó tí a yà sọ́tọ̀ fún un. Fi owó kún un kí ó lè máa bá a lọ.",
    paused_host: "{name} dá ìpolówó rẹ dúró. O lè tún tàn án nígbàkigbà.",
    paused_event_ended: "{event} ti parí, nítorí náà ìpolówó rẹ dúró.",
    paused_destination:
      "Ojú-ìwé rẹ kò sí ní gbangba báyìí, nítorí náà ìpolówó rẹ dúró. Sọ ọ́ di gbangba láti tún bẹ̀rẹ̀.",
    paused_safety:
      "A dá ìpolówó rẹ dúró fún ààbò nítorí a kò lè ka owó tí ó ná. A ó tún ṣàyẹ̀wò láìpẹ́.",
    paused_generic: "Ìpolówó rẹ ti dúró. Ṣí i láti mọ ìdí.",
    credit_low_title: "Owó ìpolówó rẹ ń tán",
    credit_low_body:
      "Ó ku nǹkan bí ọjọ́ {days} ní ìnáwó òní. Fi {amount} kún un kí àwọn ìpolówó rẹ lè lọ fún ọ̀sẹ̀ kan.",
    ended_title: "Ìpolówó rẹ ti parí",
    ended_returned:
      "A ná: {spend}. Èsì tí Mingla kà: {results}. {amount} owó tí a kò lò ti padà sí àkọọ́lẹ̀ rẹ.",
    ended_nothing:
      "A ná: {spend}. Èsì tí Mingla kà: {results}. Kò sí ohun tó ṣẹ́kù.",
    slow_title: "Títà ń lọ lọ́ra ju bí a ṣe rò lọ",
    slow_body:
      "{event} ń ta tíkẹ́ẹ̀tì díẹ̀ ju bí a ṣe rò lọ. Ṣí ìpolówó náà fún àwọn èrò.",
    tired_title: "Àwọn ènìyàn ti ń sú ìpolówó rẹ",
    tired_body:
      "Àwọn ènìyàn lórí {app} ti rí i lọ́pọ̀ ìgbà. Fi fídíò tàbí fọ́tò tuntun kún un kí èsì lè dára.",
    last_title: "Tíkẹ́ẹ̀tì díẹ̀ ló kù",
    last_body:
      "Ṣé o fẹ́ kí ìpolówó rẹ sọ pé ìwọ̀nyí ni tíkẹ́ẹ̀tì ìkẹyìn fún {event}? Ṣí ìpolówó náà láti tàn án.",
    reason_text_heavy: "Àwòrán náà ní ọ̀rọ̀ púpọ̀ jù.",
    fix_text_heavy: "Lo fọ́tò tí ó ní ọ̀rọ̀ díẹ̀.",
    reason_alcohol: "Ó ń fi ọtí hàn tàbí ń sọ nípa rẹ̀.",
    fix_alcohol:
      "Yọ ohun mímu kúrò nínú ọ̀rọ̀ àti àwòrán, tàbí fi hàn fún àgbàlagbà nìkan.",
    reason_personal_attributes: "Ọ̀rọ̀ náà ń tọ́ka sí irú ẹni tí òǹkàwé jẹ́.",
    fix_personal_attributes: "Ṣàlàyé ayẹyẹ náà dípò ẹni tí ń kà á.",
    reason_misleading: "Ọ̀rọ̀ náà ṣèlérí ju ohun tí ayẹyẹ náà lè fúnni lọ.",
    fix_misleading: "Kọ ohun tí àwọn ènìyàn máa rí gbà nìkan.",
    reason_landing_page:
      "Ohun èlò náà kò lè ṣí ojú-ìwé rẹ, tàbí kò bá ìpolówó náà mu.",
    fix_landing_page:
      "Rí i dájú pé ojú-ìwé náà wà ní gbangba ó sì bá ìpolówó mu.",
    reason_low_quality: "Dídára fídíò tàbí fọ́tò náà kéré jù.",
    fix_low_quality: "Lo fídíò tàbí fọ́tò tí ó mọ́ kedere.",
    reason_prohibited: "Ó ń fi ohun tí ohun èlò náà kò gbà láàyè hàn.",
    fix_prohibited: "Yọ apá yẹn kúrò nínú àwòrán tàbí ọ̀rọ̀ náà.",
    reason_identity: "Ohun èlò náà nílò ẹ̀rí pé o lè lo orúkọ tàbí àwòrán yìí.",
    fix_identity: "Lo orúkọ àmì-ìdámọ̀ rẹ àti àwọn fọ́tò tí ó jẹ́ tìrẹ.",
  },
  zh: {
    live_title: "你的广告已上线",
    live_body: "{event} 现在正在 {app} 上展示。",
    rejected_title: "{app} 未批准你的广告",
    part_rejected_title: "{app} 未批准你的 {n} 个广告",
    part_suffix: "你的其他广告会继续投放。",
    review_fallback: "{app} 未批准你的 {n} 个广告。打开广告查看需要修改什么。",
    paused_title: "你的广告已暂停",
    paused_sold_out: "{event} 已售罄，因此广告已停止。不会再产生费用。",
    paused_credit_out: "广告已用完为它预留的额度。添加预算即可继续投放。",
    paused_host: "{name} 暂停了你的广告。你可以随时重新开启。",
    paused_event_ended: "{event} 已结束，因此广告已停止。",
    paused_destination:
      "你的页面目前不是公开的，因此广告已停止。设为公开即可重新投放。",
    paused_safety:
      "由于无法读取花费，我们为安全起见暂停了广告。我们很快会再次检查。",
    paused_generic: "你的广告已停止投放。打开广告查看原因。",
    credit_low_title: "广告额度快用完了",
    credit_low_body:
      "按今天的花费，额度还剩约 {days} 天。充值 {amount} 可让广告再投放一周。",
    ended_title: "你的广告已结束",
    ended_returned:
      "已花费：{spend}。Mingla 统计的成果：{results}。{amount} 未用额度已退回你的余额。",
    ended_nothing: "已花费：{spend}。Mingla 统计的成果：{results}。没有剩余。",
    slow_title: "销售比预期慢",
    slow_body: "{event} 的售票少于预期。打开广告查看建议。",
    tired_title: "你的广告开始疲劳了",
    tired_body: "{app} 上的人已经多次看到它。添加新的视频或照片来保持效果。",
    last_title: "只剩几张票了",
    last_body: "想让广告说明这是 {event} 的最后几张票吗？打开广告即可开启。",
    reason_text_heavy: "图片上的文字太多。",
    fix_text_heavy: "请使用文字更少的照片。",
    reason_alcohol: "展示或提到了酒精。",
    fix_alcohol: "把饮品从文字和图片中去掉，或只向成年人展示。",
    reason_personal_attributes: "文字针对了读者的身份。",
    fix_personal_attributes: "描述活动本身，而不是阅读的人。",
    reason_misleading: "文字承诺的内容超出了活动所能提供的。",
    fix_misleading: "只写大家真正能得到的内容。",
    reason_landing_page: "应用无法打开你的页面，或页面与广告不符。",
    fix_landing_page: "请确认页面已公开并与广告一致。",
    reason_low_quality: "视频或照片的画质太低。",
    fix_low_quality: "请使用更清晰的视频或照片。",
    reason_prohibited: "包含应用不允许的内容。",
    fix_prohibited: "请删除图片或文字中的那一部分。",
    reason_identity: "应用需要证明你有权使用这个名称或图片。",
    fix_identity: "请使用你自己的品牌名称和你拥有的照片。",
  },
};

/** "pt-BR" → "pt"; unknown or missing → "en". */
export function hostAdNoticeLocale(language: unknown): HostAdNoticeLocale {
  const code = typeof language === "string"
    ? language.trim().toLowerCase().split(/[-_]/)[0]
    : "";
  return (HOST_AD_NOTICE_LOCALES as readonly string[]).includes(code)
    ? code as HostAdNoticeLocale
    : "en";
}

/** One string in one locale, with {placeholders} filled (missing → ""). */
export function hostAdNoticeText(
  locale: HostAdNoticeLocale,
  key: HostAdNoticeCopyKey,
  params: Readonly<Record<string, string | number>> = {},
): string {
  const template = HOST_AD_NOTICE_COPY[locale]?.[key] ??
    HOST_AD_NOTICE_COPY.en[key];
  return template.replace(
    /\{(\w+)\}/g,
    (_match, name: string) => String(params[name] ?? ""),
  ).replace(/\s+/g, " ").trim();
}
