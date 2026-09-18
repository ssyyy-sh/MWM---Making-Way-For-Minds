import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import "./App.css";

/* ============ storage: multi-account ============ */
const ACCOUNTS_KEY = "mwm:accounts:v1";
const SESSION_KEY = "mwm:session:v1";
const LEGACY_KEY = "mwm:state:v1";
const LANG_KEY = "mwm:lang:v1";

function loadAccounts(){
  try{ const raw = localStorage.getItem(ACCOUNTS_KEY); return raw ? JSON.parse(raw) : {}; }catch(e){ return {}; }
}
function saveAccounts(a){ try{ localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(a)); }catch(e){} }
function loadSession(){
  try{ const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; }catch(e){ return null; }
}
function saveSession(s){ try{ if(s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); }catch(e){} }

const REPORTS_KEY = "mwm:reports:v1";
function loadReports(){
  try{ const raw = localStorage.getItem(REPORTS_KEY); return raw ? JSON.parse(raw) : []; }catch(e){ return []; }
}
function saveReports(list){ try{ localStorage.setItem(REPORTS_KEY, JSON.stringify(list)); }catch(e){} }

function vibrate(pattern){
  try{
    const tg = typeof window !== "undefined" ? window.Telegram && window.Telegram.WebApp : null;
    if(tg && tg.HapticFeedback){
      // Telegram's haptics API takes discrete styles, not ms patterns — map roughly.
      if(Array.isArray(pattern)) tg.HapticFeedback.notificationOccurred("success");
      else if(pattern && pattern > 20) tg.HapticFeedback.impactOccurred("medium");
      else tg.HapticFeedback.impactOccurred("light");
      return;
    }
  }catch(e){}
  try{ if(typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(pattern); }catch(e){}
}

/* ============ telegram mini app ============ */
function getTelegram(){
  try{ return (typeof window !== "undefined" && window.Telegram && window.Telegram.WebApp) || null; }catch(e){ return null; }
}
function telegramUserToAccount(tgUser, colorScheme){
  const langMap = { ru:"ru", uz:"uz" };
  const lang = langMap[tgUser.language_code] || "en";
  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || tgUser.username || "Telegram";
  const email = "tg_" + tgUser.id + "@telegram.local";
  return { name, email, lang, dark: colorScheme === "dark" };
}

function makeAccount({ name, email, lang }){
  return {
    name, email, lang: lang || "ru",
    onboarded: false, profile: null,
    saved: [], liked: [], myStories: [],
    progress: { p1: 0, p2: 0, p3: 0, p4: 0 },
    settings: { textSize: 1, contrast: false, motion: true, captions: true, dyslexic: false, voiceGuide: false, darkMode: false, readableFont: false, haptics: true, speechRate: 1 }
  };
}

// One-time migration from the old single-account version, so early testers keep their data.
function migrateLegacy(){
  try{
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    const accountsRaw = localStorage.getItem(ACCOUNTS_KEY);
    if(legacyRaw && !accountsRaw){
      const legacy = JSON.parse(legacyRaw);
      const guestEmail = "guest@local";
      const acc = makeAccount({ name: "Гость", email: guestEmail, lang: "ru" });
      Object.assign(acc, {
        onboarded: !!legacy.onboarded,
        profile: legacy.profile || null,
        saved: legacy.saved || [],
        liked: legacy.liked || [],
        myStories: legacy.myStories || [],
        progress: { ...acc.progress, ...(legacy.progress || {}) },
        settings: { ...acc.settings, ...(legacy.settings || {}) }
      });
      const accounts = { [guestEmail]: acc };
      saveAccounts(accounts);
      saveSession({ email: guestEmail });
      localStorage.removeItem(LEGACY_KEY);
      return { accounts, session: { email: guestEmail } };
    }
  }catch(e){}
  return null;
}
const MIGRATED = (typeof window !== "undefined") ? migrateLegacy() : null;

/* ============ speech (voice guide) ============ */
let CURRENT_TTS_LANG = "ru-RU";
let CURRENT_TTS_RATE = 0.98;
const TTS_LANG_MAP = { ru:"ru-RU", uz:"uz-UZ", en:"en-US" };
function setSpeechPrefs(lang, rate){
  if(lang) CURRENT_TTS_LANG = TTS_LANG_MAP[lang] || "ru-RU";
  if(rate) CURRENT_TTS_RATE = rate;
}
function speakText(text, opts){
  if(typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try{
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = (opts && opts.lang) || CURRENT_TTS_LANG;
    u.rate = (opts && opts.rate) || CURRENT_TTS_RATE;
    window.speechSynthesis.speak(u);
  }catch(e){}
}

/* ============ i18n ============ */
const LANGS = [
  { code: "ru", label: "Русский" },
  { code: "uz", label: "O'zbekcha" },
  { code: "en", label: "English" }
];

const STRINGS = {
  ru: {
    appTagline: "ДЕЛАЕМ ПУТЬ ДЛЯ РАЗУМА",
    splashQuote: "«Каждый разум заслуживает доступа к знаниям»",
    splashCta: "Начать",
    splashFooter: "Исследования · Инклюзия · Равенство",

    authTitle: "Добро пожаловать",
    authSubtitleLogin: "Войдите, чтобы вернуться к своим настройкам",
    authSubtitleRegister: "Создайте аккаунт — у каждого свои настройки",
    tabLogin: "Вход",
    tabRegister: "Регистрация",
    nameLabel: "Имя",
    namePlaceholder: "Как вас зовут",
    emailLabel: "Email",
    emailPlaceholder: "you@example.com",
    passwordLabel: "Пароль",
    passwordPlaceholder: "Не менее 4 символов",
    languageLabel: "Язык интерфейса",
    submitLogin: "Войти",
    submitRegister: "Создать аккаунт",
    switchToRegister: "Нет аккаунта? Зарегистрироваться",
    switchToLogin: "Уже есть аккаунт? Войти",
    guestLink: "Продолжить без регистрации",
    errNameRequired: "Введите имя",
    errEmailInvalid: "Проверьте email",
    errPasswordShort: "Пароль слишком короткий",
    errEmailTaken: "Такой email уже зарегистрирован",
    errEmailNotFound: "Аккаунт не найден — зарегистрируйтесь",
    errWrongPassword: "Неверный пароль",
    welcomeBack: "С возвращением",
    registeredToast: "Аккаунт создан",

    setupStep: "Шаг 1 из 1",
    setupTitle: "Каким должен быть интерфейс для вас?",
    setupSubtitle: "Мы делаем приложение для людей с разными типами восприятия. Выберите вариант — его всегда можно изменить в профиле.",
    setupContinue: "Продолжить",
    lowVisionTitle: "Слабое зрение",
    lowVisionSub: "Очень крупный текст и контраст",
    blindTitle: "Незрячим",
    blindSub: "Одна большая кнопка озвучивает экран",
    hearingTitle: "Слабослышащим",
    hearingSub: "Субтитры включены везде",
    standardTitle: "Продолжить как есть",
    standardSub: "Настроить это позже в профиле",

    navHome: "Главная", navLibrary: "Библиотека", navStories: "Истории", navProfile: "Профиль",

    goodMorning: "Доброе утро", goodAfternoon: "Добрый день", goodEvening: "Добрый вечер",
    welcomeTitle: "Добро пожаловать в MWM",
    missionEyebrow: "Наша миссия",
    missionText: "Исследуем доступность образования через истории, интервью и данные.",
    statsStories: "Историй", statsCountries: "Стран", statsFree: "Бесплатно",
    exploreLabel: "Разделы",
    tileLibraryTitle: "Библиотека", tileLibrarySub: "Книги, аудио и видео",
    tileHubTitle: "Learning Hub", tileHubSub: "Обучающие маршруты",
    tileShareTitle: "Поделиться историей", tileShareSub: "Ваш опыт важен",
    tileCommunityTitle: "Голоса сообщества", tileCommunitySub: "Истории со всего мира",
    recentLabel: "Недавнее",

    libraryTitle: "Библиотека",
    searchPlaceholder: "Поиск по названию и автору",
    filterAll: "Все", filterBook: "Книги", filterAudio: "Аудио", filterVisual: "Визуал", filterHearing: "Слух", filterLearning: "Обучение", filterSaved: "Сохранённые",
    libraryEmpty: "Ничего не найдено. Попробуйте другое слово или снимите фильтр.",

    storiesTitle: "Голоса сообщества",
    storiesSubtitle: "Личные истории учеников, учителей и семей из 18 стран.",

    profileTitle: "Профиль",
    statMyStories: "Ваши истории", statSaved: "Сохранено", statProgress: "Обучение",
    readingComfort: "Комфорт чтения",
    sizeStandard: "Обычный", sizeLarge: "Крупный", sizeLargest: "Очень крупный",
    accessibilityLabel: "Доступность",
    rowContrastTitle: "Высокий контраст", rowContrastSub: "Сильнее границы и темнее текст",
    rowAnimationTitle: "Анимация", rowAnimationSub: "Переходы между экранами",
    rowCaptionsTitle: "Субтитры по умолчанию", rowCaptionsSub: "Включать субтитры для видео",
    rowDyslexicTitle: "Удобные интервалы", rowDyslexicSub: "Шире межбуквенный и межстрочный интервал",
    rowVoiceTitle: "Голосовые подсказки", rowVoiceSub: "Одна кнопка озвучивает экран и действия",
    accessibilityProfileLabel: "Профиль восприятия",
    rerunSetup: "Пройти настройку заново",
    languageRowLabel: "Язык интерфейса",
    yourLibraryLabel: "Ваша библиотека",
    savedResourcesTitle: "Сохранённые материалы",
    learningPathsTitle: "Обучающие маршруты",
    learningPathsSub: "Продолжить с места остановки",
    appLabel: "Приложение",
    resetTitle: "Сбросить данные",
    resetSub: "Удалит сохранённое, лайки и ваши истории",
    logoutTitle: "Выйти из аккаунта",
    logoutSub: "Вернуться к экрану входа",
    footerTag: "Исследования · Инклюзия · Равенство",
    itemsWord: "элементов",

    savedAdded: "Сохранено в библиотеке", savedRemoved: "Убрано из сохранённого",
    likeAdded: "Понравилось", likeRemoved: "Лайк убран",
    storyPublished: "История опубликована",
    lessonDone: "Урок отмечен пройденным", pathwayDone: "Маршрут завершён",
    resetDone: "Данные сброшены",
    profileApplied: "Интерфейс подстроен под вас", profileAppliedPlain: "Готово",

    darkModeTitle: "Тёмная тема", darkModeSub: "Тёмный фон вместо светлого",
    readableFontTitle: "Читаемый шрифт", readableFontSub: "Шрифт Atkinson Hyperlegible для слабого зрения",
    hapticsTitle: "Вибрация при нажатиях", hapticsSub: "Лёгкий отклик на кнопки и уведомления",
    swipeHint: "Листайте влево-вправо, чтобы сменить раздел",
    reportOpen: "Сообщить о проблеме",
    reportWrong: "Неверная информация", reportOffensive: "Оскорбительный контент",
    reportBroken: "Не работает", reportOther: "Другое",
    reportNotePlaceholder: "Опишите подробнее (не обязательно)",
    reportSubmit: "Отправить",
    reportThanks: "Спасибо, мы посмотрим",
    insightsTitle: "Аналитика команды",
    insightsRow: "Аналитика команды",
    insightsSub: "Аккаунты, обучающие на этом устройстве",
    insightsAccounts: "Аккаунтов создано",
    insightsByProfile: "По профилю восприятия",
    insightsVoice: "С голосовыми подсказками",
    insightsStories: "Опубликовано историй",
    insightsReports: "Отправлено отчётов",
    insightsNote: "Данные только с этого устройства и браузера — для полной статистики команды нужен сервер.",

    libraryAudioBtn: "Аудио", libraryReadBtn: "Читать",

    learnTitle: "«Как вам удобнее учиться?»",
    uploadPdfTitle: "Загрузить PDF", uploadPdfSub: "Нажмите, чтобы выбрать документ",
    uploadPdfChosen: "Файл выбран",
    accessibilityOptionsLabel: "Опции доступности",
    optConvertAudio: "Преобразовать в аудио", optConvertAudioSub: "Озвучивание текста",
    optSimplify: "Упростить текст", optSimplifySub: "Версия простым языком",
    optSummarize: "Сократить содержание", optSummarizeSub: "Только ключевые мысли",
    optLargeText: "Крупный текст", optLargeTextSub: "Увеличенный размер шрифта",
    optScreenReader: "Для экранного диктора", optScreenReaderSub: "Оптимизировано для вспомогательных технологий",
    uploadCtaDisabled: "Загрузите PDF, чтобы продолжить",
    uploadCtaReady: "Обработать документ",
    uploadProcessing: "Обрабатываем документ…",
    uploadDone: "Готово — настройки применены",
    browsePathwaysLink: "Или откройте готовые маршруты обучения →",

    storyQuote: "«Ваш опыт важен»",
    storyIntro: "Помогите нам понять барьеры в образовании через ваш личный опыт. Каждая история влияет на исследование.",
    formatWrite: "Написать историю", formatWriteSub: "Введите текст своего опыта",
    formatVoice: "Голосовая запись", formatVoiceSub: "Расскажите историю голосом",
    formatVideo: "Загрузить видео", formatVideoSub: "Поделитесь видеообращением",
    chooseFormatCta: "Выберите формат выше",
    continueCta: "Продолжить",
    anonNote: "Можно поделиться анонимно · Принимаем любой формат",
    recStart: "Начать запись", recStop: "Остановить", recRetake: "Записать заново",
    recNeedMic: "Нужен доступ к микрофону",
    videoChoose: "Выбрать видеофайл", videoRetake: "Выбрать другое видео",
    attachTitleLabel: "Название", attachCountryLabel: "Страна",
    mediaNote: "Аудио и видео сохраняются только в этой сессии — после перезагрузки страницы файл нужно будет прикрепить заново.",
    continueAsTelegram: "Продолжить как {name}", orLabel: "или",

    speechRateLabel: "Скорость озвучивания",
    speedSlow: "Медленно", speedNormal: "Обычно", speedFast: "Быстро", speedFaster: "Очень быстро",

    scanTitle: "Съёмка текста",
    scanSub: "Наведите камеру на страницу, доску или документ — текст распознается прямо в браузере",
    scanTakePhoto: "Сделать снимок или выбрать фото",
    scanProcessing: "Распознаём текст…",
    scanEmpty: "Текст не найден. Попробуйте снимок при более ярком свете, ближе к тексту.",
    scanRetake: "Другое фото",
    scanRead: "Озвучить",
    scanCopy: "Скопировать текст",
    scanCopied: "Текст скопирован",

    transcriptTitle: "Живая расшифровка",
    transcriptSub: "Говорите — текст появится на экране. Хорошо подходит для лекций и уроков.",
    transcriptStart: "Начать расшифровку",
    transcriptStop: "Остановить",
    transcriptEmpty: "Здесь появится текст, как только начнёте говорить",
    transcriptUnsupported: "Этот браузер не поддерживает распознавание речи. Попробуйте Chrome или Edge.",
    transcriptClear: "Очистить",
    transcriptCopy: "Скопировать",
    transcriptCopied: "Расшифровка скопирована"
  },
  uz: {
    appTagline: "ONGGA YO'L OCHAMIZ",
    splashQuote: "“Har bir ong bilimga ega bo'lishga loyiq”",
    splashCta: "Boshlash",
    splashFooter: "Tadqiqot · Inklyuziya · Tenglik",

    authTitle: "Xush kelibsiz",
    authSubtitleLogin: "Sozlamalaringizga qaytish uchun tizimga kiring",
    authSubtitleRegister: "Hisob yarating — har kimning o'z sozlamalari bo'ladi",
    tabLogin: "Kirish",
    tabRegister: "Ro'yxatdan o'tish",
    nameLabel: "Ism",
    namePlaceholder: "Ismingiz",
    emailLabel: "Email",
    emailPlaceholder: "siz@example.com",
    passwordLabel: "Parol",
    passwordPlaceholder: "Kamida 4 ta belgi",
    languageLabel: "Interfeys tili",
    submitLogin: "Kirish",
    submitRegister: "Hisob yaratish",
    switchToRegister: "Hisobingiz yo'qmi? Ro'yxatdan o'ting",
    switchToLogin: "Hisobingiz bormi? Kiring",
    guestLink: "Ro'yxatdan o'tmasdan davom etish",
    errNameRequired: "Ismingizni kiriting",
    errEmailInvalid: "Emailni tekshiring",
    errPasswordShort: "Parol juda qisqa",
    errEmailTaken: "Bu email allaqachon ro'yxatdan o'tgan",
    errEmailNotFound: "Hisob topilmadi — ro'yxatdan o'ting",
    errWrongPassword: "Parol noto'g'ri",
    welcomeBack: "Xush kelibsiz, qaytganingizdan xursandmiz",
    registeredToast: "Hisob yaratildi",

    setupStep: "1-qadam / 1",
    setupTitle: "Interfeys siz uchun qanday bo'lishi kerak?",
    setupSubtitle: "Biz turli idrok turiga ega odamlar uchun ilova yaratyapmiz. Variantni tanlang — buni istalgan vaqt profilda o'zgartirish mumkin.",
    setupContinue: "Davom etish",
    lowVisionTitle: "Zaif ko'rish",
    lowVisionSub: "Juda katta matn va kontrast",
    blindTitle: "Ko'rmaydiganlar uchun",
    blindSub: "Bitta katta tugma ekranni ovoz bilan o'qiydi",
    hearingTitle: "Eshitish qiyin bo'lganlar uchun",
    hearingSub: "Subtitrlar hamma joyda yoqilgan",
    standardTitle: "Shu holicha davom etish",
    standardSub: "Buni keyin profilda sozlang",

    navHome: "Bosh sahifa", navLibrary: "Kutubxona", navStories: "Hikoyalar", navProfile: "Profil",

    goodMorning: "Xayrli tong", goodAfternoon: "Xayrli kun", goodEvening: "Xayrli kech",
    welcomeTitle: "MWM ga xush kelibsiz",
    missionEyebrow: "Bizning maqsadimiz",
    missionText: "Hikoyalar, intervyular va ma'lumotlar orqali ta'limga qulaylikni o'rganamiz.",
    statsStories: "Hikoyalar", statsCountries: "Davlatlar", statsFree: "Bepul",
    exploreLabel: "Bo'limlar",
    tileLibraryTitle: "Kutubxona", tileLibrarySub: "Kitoblar, audio va video",
    tileHubTitle: "Learning Hub", tileHubSub: "Ta'lim yo'nalishlari",
    tileShareTitle: "Hikoyangizni ulashing", tileShareSub: "Sizning tajribangiz muhim",
    tileCommunityTitle: "Jamoa ovozlari", tileCommunitySub: "Dunyo bo'ylab hikoyalar",
    recentLabel: "So'nggi",

    libraryTitle: "Kutubxona",
    searchPlaceholder: "Nom va muallif bo'yicha qidiring",
    filterAll: "Barchasi", filterBook: "Kitoblar", filterAudio: "Audio", filterVisual: "Vizual", filterHearing: "Eshitish", filterLearning: "Ta'lim", filterSaved: "Saqlangan",
    libraryEmpty: "Hech narsa topilmadi. Boshqa so'z bilan qidiring yoki filtrni olib tashlang.",

    storiesTitle: "Jamoa ovozlari",
    storiesSubtitle: "18 ta davlatdan o'quvchilar, o'qituvchilar va oilalarning shaxsiy hikoyalari.",

    profileTitle: "Profil",
    statMyStories: "Hikoyalaringiz", statSaved: "Saqlangan", statProgress: "O'quv",
    readingComfort: "O'qish qulayligi",
    sizeStandard: "Oddiy", sizeLarge: "Katta", sizeLargest: "Juda katta",
    accessibilityLabel: "Qulaylik",
    rowContrastTitle: "Yuqori kontrast", rowContrastSub: "Chegaralar qalinroq, matn to'qroq",
    rowAnimationTitle: "Animatsiya", rowAnimationSub: "Ekranlar orasidagi o'tishlar",
    rowCaptionsTitle: "Subtitrlar doim yoniq", rowCaptionsSub: "Videolarda subtitrlarni yoqish",
    rowDyslexicTitle: "Qulay masofalar", rowDyslexicSub: "Harflar va qatorlar orasidagi masofa kengroq",
    rowVoiceTitle: "Ovozli yordam", rowVoiceSub: "Bitta tugma ekran va amallarni ovoz bilan aytadi",
    accessibilityProfileLabel: "Idrok profili",
    rerunSetup: "Sozlamani qayta o'tish",
    languageRowLabel: "Interfeys tili",
    yourLibraryLabel: "Kutubxonangiz",
    savedResourcesTitle: "Saqlangan materiallar",
    learningPathsTitle: "Ta'lim yo'nalishlari",
    learningPathsSub: "To'xtagan joyingizdan davom eting",
    appLabel: "Ilova",
    resetTitle: "Ma'lumotlarni tozalash",
    resetSub: "Saqlanganlar, layklar va hikoyalaringiz o'chadi",
    logoutTitle: "Hisobdan chiqish",
    logoutSub: "Kirish ekraniga qaytish",
    footerTag: "Tadqiqot · Inklyuziya · Tenglik",
    itemsWord: "ta",

    savedAdded: "Kutubxonaga saqlandi", savedRemoved: "Saqlanganlardan olib tashlandi",
    likeAdded: "Yoqdi", likeRemoved: "Layk olib tashlandi",
    storyPublished: "Hikoya nashr qilindi",
    lessonDone: "Dars tugallangan deb belgilandi", pathwayDone: "Yo'nalish tugallandi",
    resetDone: "Ma'lumotlar tozalandi",
    profileApplied: "Interfeys siz uchun moslashtirildi", profileAppliedPlain: "Tayyor",

    darkModeTitle: "Tungi rejim", darkModeSub: "Yorug' fon o'rniga qorong'i fon",
    readableFontTitle: "O'qish uchun shrift", readableFontSub: "Zaif ko'rish uchun Atkinson Hyperlegible shrifti",
    hapticsTitle: "Bosganda tebranish", hapticsSub: "Tugmalar va bildirishnomalarda yengil tebranish",
    swipeHint: "Bo'limni almashtirish uchun chapga-o'ngga suring",
    reportOpen: "Muammo haqida xabar berish",
    reportWrong: "Noto'g'ri ma'lumot", reportOffensive: "Haqoratli kontent",
    reportBroken: "Ishlamayapti", reportOther: "Boshqa",
    reportNotePlaceholder: "Batafsil yozing (ixtiyoriy)",
    reportSubmit: "Yuborish",
    reportThanks: "Rahmat, ko'rib chiqamiz",
    insightsTitle: "Jamoa tahlili",
    insightsRow: "Jamoa tahlili",
    insightsSub: "Shu qurilmada o'qigan hisoblar",
    insightsAccounts: "Yaratilgan hisoblar",
    insightsByProfile: "Idrok profili bo'yicha",
    insightsVoice: "Ovozli yordam yoqilgan",
    insightsStories: "Nashr qilingan hikoyalar",
    insightsReports: "Yuborilgan xabarlar",
    insightsNote: "Ma'lumotlar faqat shu qurilma va brauzerdan — jamoaning to'liq statistikasi uchun server kerak.",

    libraryAudioBtn: "Audio", libraryReadBtn: "O'qish",

    learnTitle: "\u00abQanday o'qishni xohlaysiz?\u00bb",
    uploadPdfTitle: "PDF yuklash", uploadPdfSub: "Hujjat tanlash uchun bosing",
    uploadPdfChosen: "Fayl tanlandi",
    accessibilityOptionsLabel: "Qulaylik parametrlari",
    optConvertAudio: "Audioga aylantirish", optConvertAudioSub: "Matnni ovoz bilan o'qish",
    optSimplify: "Matnni soddalashtirish", optSimplifySub: "Oddiy til versiyasi",
    optSummarize: "Qisqacha mazmun", optSummarizeSub: "Faqat asosiy fikrlar",
    optLargeText: "Katta matn", optLargeTextSub: "Kattalashtirilgan shrift",
    optScreenReader: "Ekran diktori uchun", optScreenReaderSub: "Yordamchi texnologiyalar uchun moslashtirilgan",
    uploadCtaDisabled: "Davom etish uchun PDF yuklang",
    uploadCtaReady: "Hujjatni qayta ishlash",
    uploadProcessing: "Hujjat qayta ishlanmoqda…",
    uploadDone: "Tayyor — sozlamalar qo'llanildi",
    browsePathwaysLink: "Yoki tayyor ta'lim yo'nalishlarini ko'ring →",

    storyQuote: "\u00abSizning tajribangiz muhim\u00bb",
    storyIntro: "Shaxsiy tajribangiz orqali ta'limdagi to'siqlarni tushunishga yordam bering. Har bir hikoya tadqiqotga ta'sir qiladi.",
    formatWrite: "Hikoya yozish", formatWriteSub: "Tajribangizni matn sifatida kiriting",
    formatVoice: "Ovozli yozuv", formatVoiceSub: "Hikoyangizni ovoz bilan aytib bering",
    formatVideo: "Video yuklash", formatVideoSub: "Video murojaat bilan ulashing",
    chooseFormatCta: "Yuqoridan formatni tanlang",
    continueCta: "Davom etish",
    anonNote: "Anonim ulashish mumkin · Har qanday format qabul qilinadi",
    recStart: "Yozishni boshlash", recStop: "To'xtatish", recRetake: "Qayta yozish",
    recNeedMic: "Mikrofonga ruxsat kerak",
    videoChoose: "Video fayl tanlash", videoRetake: "Boshqa video tanlash",
    attachTitleLabel: "Sarlavha", attachCountryLabel: "Davlat",
    mediaNote: "Audio va video faqat shu seansda saqlanadi — sahifa yangilangach faylni qayta biriktirish kerak bo'ladi.",
    continueAsTelegram: "{name} sifatida davom etish", orLabel: "yoki",

    speechRateLabel: "Ovoz tezligi",
    speedSlow: "Sekin", speedNormal: "Oddiy", speedFast: "Tez", speedFaster: "Juda tez",

    scanTitle: "Matnni suratga olish",
    scanSub: "Kamerani sahifa, doska yoki hujjatga qarating — matn brauzerning o'zida taniladi",
    scanTakePhoto: "Surat olish yoki foto tanlash",
    scanProcessing: "Matn tanilmoqda…",
    scanEmpty: "Matn topilmadi. Yorug'roq joyda, matnga yaqinroq suratga oling.",
    scanRetake: "Boshqa surat",
    scanRead: "Ovoz bilan o'qish",
    scanCopy: "Matnni nusxalash",
    scanCopied: "Matn nusxalandi",

    transcriptTitle: "Jonli transkripsiya",
    transcriptSub: "Gapiring — matn ekranda paydo bo'ladi. Ma'ruza va darslar uchun qulay.",
    transcriptStart: "Yozib olishni boshlash",
    transcriptStop: "To'xtatish",
    transcriptEmpty: "Gapira boshlaganingizda shu yerda matn paydo bo'ladi",
    transcriptUnsupported: "Bu brauzer nutqni tanishni qo'llab-quvvatlamaydi. Chrome yoki Edge'ni sinab ko'ring.",
    transcriptClear: "Tozalash",
    transcriptCopy: "Nusxalash",
    transcriptCopied: "Transkripsiya nusxalandi"
  },
  en: {
    appTagline: "MAKING WAY FOR MINDS",
    splashQuote: "“Every mind deserves access to learning.”",
    splashCta: "Get Started",
    splashFooter: "Research · Inclusion · Equity",

    authTitle: "Welcome",
    authSubtitleLogin: "Log in to return to your settings",
    authSubtitleRegister: "Create an account — everyone gets their own settings",
    tabLogin: "Log in",
    tabRegister: "Register",
    nameLabel: "Name",
    namePlaceholder: "Your name",
    emailLabel: "Email",
    emailPlaceholder: "you@example.com",
    passwordLabel: "Password",
    passwordPlaceholder: "At least 4 characters",
    languageLabel: "Interface language",
    submitLogin: "Log in",
    submitRegister: "Create account",
    switchToRegister: "No account? Register",
    switchToLogin: "Already have an account? Log in",
    guestLink: "Continue without an account",
    errNameRequired: "Enter your name",
    errEmailInvalid: "Check your email",
    errPasswordShort: "Password is too short",
    errEmailTaken: "That email is already registered",
    errEmailNotFound: "No account found — please register",
    errWrongPassword: "Wrong password",
    welcomeBack: "Welcome back",
    registeredToast: "Account created",

    setupStep: "Step 1 of 1",
    setupTitle: "What should the interface be like for you?",
    setupSubtitle: "We're building this app for people with different kinds of perception. Pick an option — you can always change it later in your profile.",
    setupContinue: "Continue",
    lowVisionTitle: "Low vision",
    lowVisionSub: "Extra-large text and contrast",
    blindTitle: "Blind",
    blindSub: "One big button reads the screen aloud",
    hearingTitle: "Hard of hearing",
    hearingSub: "Captions turned on everywhere",
    standardTitle: "Continue as is",
    standardSub: "Set this up later in your profile",

    navHome: "Home", navLibrary: "Library", navStories: "Stories", navProfile: "Profile",

    goodMorning: "Good morning", goodAfternoon: "Good afternoon", goodEvening: "Good evening",
    welcomeTitle: "Welcome to MWM",
    missionEyebrow: "Our Mission",
    missionText: "Researching educational accessibility through stories, interviews, and data.",
    statsStories: "Stories", statsCountries: "Countries", statsFree: "Free Access",
    exploreLabel: "Explore",
    tileLibraryTitle: "Accessible Library", tileLibrarySub: "Books, audio & visual resources",
    tileHubTitle: "Learning Hub", tileHubSub: "Curated educational pathways",
    tileShareTitle: "Share Your Story", tileShareSub: "Your experience matters",
    tileCommunityTitle: "Community Voices", tileCommunitySub: "Stories from around the world",
    recentLabel: "Recent",

    libraryTitle: "Accessible Library",
    searchPlaceholder: "Search titles and authors",
    filterAll: "All", filterBook: "Book", filterAudio: "Audio", filterVisual: "Visual", filterHearing: "Hearing", filterLearning: "Learning", filterSaved: "Saved",
    libraryEmpty: "No resources match that. Try another word or clear the filter.",

    storiesTitle: "Community Voices",
    storiesSubtitle: "First-hand accounts from learners, teachers and families in 18 countries.",

    profileTitle: "Profile",
    statMyStories: "Your stories", statSaved: "Saved", statProgress: "Learning done",
    readingComfort: "Reading comfort",
    sizeStandard: "Standard", sizeLarge: "Large", sizeLargest: "Largest",
    accessibilityLabel: "Accessibility",
    rowContrastTitle: "High contrast", rowContrastSub: "Stronger borders and darker text",
    rowAnimationTitle: "Animation", rowAnimationSub: "Screen transitions and motion",
    rowCaptionsTitle: "Captions by default", rowCaptionsSub: "Turn on captions for every film",
    rowDyslexicTitle: "Reading-friendly spacing", rowDyslexicSub: "Wider letter and line spacing",
    rowVoiceTitle: "Voice guide", rowVoiceSub: "One button reads the screen and actions aloud",
    accessibilityProfileLabel: "Accessibility profile",
    rerunSetup: "Redo the setup",
    languageRowLabel: "Interface language",
    yourLibraryLabel: "Your library",
    savedResourcesTitle: "Saved resources",
    learningPathsTitle: "Learning pathways",
    learningPathsSub: "Continue where you stopped",
    appLabel: "App",
    resetTitle: "Reset app data",
    resetSub: "Clears saves, likes and your stories",
    logoutTitle: "Log out",
    logoutSub: "Return to the sign-in screen",
    footerTag: "Research · Inclusion · Equity",
    itemsWord: "items",

    savedAdded: "Saved to your library", savedRemoved: "Removed from saved",
    likeAdded: "Liked", likeRemoved: "Like removed",
    storyPublished: "Story published",
    lessonDone: "Lesson marked done", pathwayDone: "Pathway finished",
    resetDone: "Everything reset",
    profileApplied: "Interface adjusted for you", profileAppliedPlain: "Done",

    darkModeTitle: "Dark mode", darkModeSub: "Dark background instead of light",
    readableFontTitle: "Readable font", readableFontSub: "Atkinson Hyperlegible, designed for low vision",
    hapticsTitle: "Vibrate on tap", hapticsSub: "A light buzz on buttons and notifications",
    swipeHint: "Swipe left or right to switch sections",
    reportOpen: "Report a problem",
    reportWrong: "Incorrect info", reportOffensive: "Offensive content",
    reportBroken: "Not working", reportOther: "Other",
    reportNotePlaceholder: "Add details (optional)",
    reportSubmit: "Submit",
    reportThanks: "Thanks, we'll take a look",
    insightsTitle: "Team insights",
    insightsRow: "Team insights",
    insightsSub: "Accounts that trained on this device",
    insightsAccounts: "Accounts created",
    insightsByProfile: "By accessibility profile",
    insightsVoice: "With voice guide on",
    insightsStories: "Stories published",
    insightsReports: "Reports submitted",
    insightsNote: "This is device-and-browser-only data — a real team dashboard needs a server.",

    libraryAudioBtn: "Audio", libraryReadBtn: "Read",

    learnTitle: "\u201cHow would you like to learn?\u201d",
    uploadPdfTitle: "Upload PDF", uploadPdfSub: "Tap to select a document",
    uploadPdfChosen: "File selected",
    accessibilityOptionsLabel: "Accessibility Options",
    optConvertAudio: "Convert to Audio", optConvertAudioSub: "Text-to-speech output",
    optSimplify: "Simplify Text", optSimplifySub: "Plain language version",
    optSummarize: "Summarize Content", optSummarizeSub: "Key points only",
    optLargeText: "Large Text Mode", optLargeTextSub: "Increased font size",
    optScreenReader: "Screen Reader Friendly", optScreenReaderSub: "Optimized for assistive tech",
    uploadCtaDisabled: "Upload a PDF to continue",
    uploadCtaReady: "Process document",
    uploadProcessing: "Processing document…",
    uploadDone: "Done — settings applied",
    browsePathwaysLink: "Or browse structured pathways →",

    storyQuote: "\u201cYour experience matters.\u201d",
    storyIntro: "Help us understand barriers in education through your lived experience. Every story shapes future research.",
    formatWrite: "Write a Story", formatWriteSub: "Type your experience",
    formatVoice: "Voice Recording", formatVoiceSub: "Speak your story aloud",
    formatVideo: "Upload Video", formatVideoSub: "Share a video message",
    chooseFormatCta: "Choose a Format Above",
    continueCta: "Continue",
    anonNote: "Anonymous sharing available · All formats welcomed",
    recStart: "Start recording", recStop: "Stop", recRetake: "Record again",
    recNeedMic: "Microphone access needed",
    videoChoose: "Choose a video file", videoRetake: "Choose a different video",
    attachTitleLabel: "Title", attachCountryLabel: "Country",
    mediaNote: "Audio and video only last for this session — after a page reload you'll need to attach the file again.",
    continueAsTelegram: "Continue as {name}", orLabel: "or",

    speechRateLabel: "Reading speed",
    speedSlow: "Slow", speedNormal: "Normal", speedFast: "Fast", speedFaster: "Faster",

    scanTitle: "Scan Text",
    scanSub: "Point a camera at a page, board or document — text is recognized right in the browser",
    scanTakePhoto: "Take a photo or choose one",
    scanProcessing: "Recognizing text…",
    scanEmpty: "No text found. Try a brighter, closer shot.",
    scanRetake: "Different photo",
    scanRead: "Read aloud",
    scanCopy: "Copy text",
    scanCopied: "Text copied",

    transcriptTitle: "Live Transcript",
    transcriptSub: "Speak — the text appears on screen. Good for lectures and lessons.",
    transcriptStart: "Start transcribing",
    transcriptStop: "Stop",
    transcriptEmpty: "Text will appear here once you start speaking",
    transcriptUnsupported: "This browser doesn't support speech recognition. Try Chrome or Edge.",
    transcriptClear: "Clear",
    transcriptCopy: "Copy",
    transcriptCopied: "Transcript copied"
  }
};
function tFor(lang, key){
  return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.ru[key] || key;
}

/* ============ content ============ */
const LIBRARY = [
  { id:"l1", title:"Teaching Every Reader", author:"R. Okonkwo", format:"Book", category:"Book", tags:["Text","Braille"], hasAudio:false, hasRead:true, emoji:"📗", meta:"312 pages · EPUB, Braille-ready", year:2024,
    content:["Reading aloud works when it's a choice, not a requirement. This guide collects turn-taking methods that let a student opt into reading aloud on their own terms.",
      "Pair reading with a peer removes the spotlight while keeping the practice — both readers follow the same line, switching every paragraph.",
      "A five-minute daily check-in — \"What's one word that tripped you up today?\" — turns mistakes into data instead of embarrassment."] },
  { id:"l2", title:"Sound of a Classroom", author:"Narrated by M. Duarte", format:"Audio", category:"Hearing", tags:["Audio","Transcript"], hasAudio:true, hasRead:true, emoji:"🎧", meta:"4 h 12 min · Transcript included", year:2025,
    content:["A school bell rings, and children's voices overlap in a corridor. This is Room 4B, nine in the morning, on an ordinary Tuesday.",
      "A teacher reads instructions slowly, pausing after each sentence. Notice how the room goes quiet before every new activity — that pause is not empty, it's a signal.",
      "Recorded over one full term, this piece lets you hear what an accessible classroom actually sounds like, pacing and all."],
    transcript:["[0:00] A school bell rings. Children's voices overlap in a corridor.",
      "[0:42] Narrator: \"This is Room 4B, nine in the morning, on an ordinary Tuesday.\"",
      "[1:15] A teacher reads instructions slowly, pausing after each sentence.",
      "[2:03] Narrator: \"Notice how the room goes quiet before every new activity — that pause is not empty, it's a signal.\""] },
  { id:"l3", title:"Colour Contrast Field Guide", author:"MWM Research", format:"Visual", category:"Visual", tags:["Visual","Alt Text"], hasAudio:false, hasRead:true, emoji:"🎨", meta:"48 plates · Alt-text on every image", year:2025,
    content:["Forty-eight side-by-side comparisons of classroom materials — one version as usually printed, one adjusted for contrast.",
      "A wall painted dark navy behind a whiteboard cuts glare noticeably. A worksheet in near-black-on-cream reads faster than grey-on-white for almost every tester.",
      "Every plate includes the exact contrast ratio used, so a teacher can match it without guesswork."],
    altTexts:["Plate 3: a classroom wall painted dark navy behind a whiteboard, cutting glare noticeably.",
      "Plate 11: two versions of the same worksheet — one in grey-on-white, one in near-black-on-cream — shown side by side.",
      "Plate 27: a hallway sign using a 7:1 contrast ratio, photographed from ten metres away and still legible."] },
  { id:"l4", title:"Dyslexia in Early Grades", author:"S. Lindqvist", format:"Book", category:"Learning", tags:["Large Text"], hasAudio:false, hasRead:true, emoji:"📘", meta:"186 pages · Large-print edition", year:2023,
    content:["Letters that reverse, words that blur, and a clock that always seems to run out — dyslexia in early grades often gets mistaken for not trying hard enough.",
      "This book walks through classroom-tested large-print layouts, decodable text sets, and a simple screening checklist teachers can use before a formal diagnosis.",
      "Includes a parent letter template explaining what's changing and why, so home and classroom stay in sync."] },
  { id:"l5", title:"Signed Stories, Vol. 2", author:"Deaf Learners Collective", format:"Visual", category:"Hearing", tags:["Video","Captions"], hasAudio:false, hasRead:true, emoji:"🤟", meta:"22 films · Sign language + captions", year:2026,
    content:["Twenty-two short films, each told entirely in sign language with burned-in captions — no voiceover standing in for either.",
      "Stories range from a grandmother's recipe to a first day at a new school, chosen because Deaf children rarely see themselves as the main character.",
      "Each film comes with three discussion questions for classroom use, available in the same sign language as the story."] },
  { id:"l6", title:"Listening to Learners", author:"MWM Interviews", format:"Audio", category:"Learning", tags:["Audio"], hasAudio:true, hasRead:true, emoji:"🎙️", meta:"18 episodes · 42 countries", year:2026,
    content:["Eighteen unscripted conversations with students across 42 countries, recorded exactly as they happened — pauses, laughter, and all.",
      "The episode teachers ask about most: a nine-year-old in Nairobi explaining, in her own words, what \"boring\" actually means to her.",
      "No two episodes are edited the same way — the format follows whatever the learner wanted to talk about."] },
  { id:"l7", title:"Maths Without Sight", author:"A. Boateng", format:"Book", category:"Visual", tags:["Braille","Tactile"], hasAudio:false, hasRead:true, emoji:"📐", meta:"240 pages · Tactile diagrams", year:2024,
    content:["Tactile diagrams replace visual ones page for page — a raised-line graph is read by hand the way a sighted student reads it by eye.",
      "Covers arithmetic through early algebra, with a braille notation guide included for teachers who don't yet read braille themselves.",
      "Each chapter ends with a \"build it\" exercise — recreating a diagram from raised materials at home, to reinforce spatial memory."] },
  { id:"l8", title:"Rooms That Work", author:"MWM Research", format:"Visual", category:"Visual", tags:["Visual"], hasAudio:false, hasRead:true, emoji:"🏫", meta:"Photo study · 60 classrooms", year:2025,
    content:["Sixty classrooms photographed exactly as teachers actually arranged them — not staged, not idealized.",
      "Grouped by what they solve: glare, noise, wayfinding, and reach. Each photo has a one-line note on what changed and what it cost.",
      "Most fixes in this study cost under $50 and took one weekend."] },
  { id:"l9", title:"Seeing Differently", author:"MWM Research", format:"Visual", category:"Visual", tags:["Audio","Large Text"], hasAudio:true, hasRead:true, emoji:"👓", meta:"Visual accessibility guide", year:2026,
    description:"Visual accessibility guide",
    content:["A field guide to what \"low vision\" actually covers — it is rarely all-or-nothing, and this guide starts by unlearning that assumption.",
      "Walks through practical adjustments: lighting angles, font choices, and screen settings that help before any assistive device is needed.",
      "Written with input from students who have low vision, not just about them."] },
  { id:"l10", title:"Sound and Learning", author:"MWM Research", format:"Audio", category:"Hearing", tags:["Audio","Braille"], hasAudio:true, hasRead:true, emoji:"🔔", meta:"Hearing support strategies", year:2026,
    description:"Hearing support strategies",
    content:["Strategies gathered from Deaf and hard-of-hearing students on what actually helps in a hearing classroom — not the textbook list, the real one.",
      "Seating position matters more than most teachers realize; this guide explains why the corner seat is rarely the right one.",
      "Includes a short script for the first day of class, asking a teacher to introduce captioning without singling anyone out."] },
  { id:"l11", title:"Every Learner Counts", author:"MWM Research", format:"Book", category:"Learning", tags:["Text","Video"], hasAudio:false, hasRead:true, emoji:"🧩", meta:"Inclusive classroom tools", year:2026,
    description:"Inclusive classroom tools",
    content:["A toolkit for classrooms with a genuine mix of needs — not a single \"inclusive\" worksheet, but options within the same lesson.",
      "Every activity in this set has three entry points: read it, hear it, or do it — chosen by the student, not assigned by diagnosis.",
      "Field-tested across 30 classrooms before publication; the version here reflects what teachers actually kept using."] },
  { id:"l12", title:"Pathways to Reading", author:"MWM Research", format:"Book", category:"Learning", tags:["Audio","Simplified"], hasAudio:true, hasRead:true, emoji:"🛤️", meta:"Dyslexia-friendly formats", year:2026,
    description:"Dyslexia-friendly formats",
    content:["Dyslexia-friendly doesn't mean simplified — this collection keeps full vocabulary while changing spacing, font, and chunking.",
      "Each title is available in three formats from the same page: standard text, audio, and a version with syllables pre-marked.",
      "Chosen by readers with dyslexia as the books they'd actually recommend to a friend, not just the ones assigned to them."] }
];
const LIBRARY_CATEGORIES = ["All","Visual","Hearing","Learning","Book"];
const PATHS = [
  { id:"p1", title:"Foundations of Accessible Teaching", emoji:"🧭", lessons:8, mins:95, level:"Start here" },
  { id:"p2", title:"Designing Readable Materials", emoji:"📝", lessons:6, mins:70, level:"Practical" },
  { id:"p3", title:"Assistive Technology in Class", emoji:"🖥️", lessons:10, mins:140, level:"Deep dive" },
  { id:"p4", title:"Interviewing Learners with Care", emoji:"💬", lessons:5, mins:55, level:"For researchers" }
];
function pick(field, lang){
  if(field && typeof field === "object" && !Array.isArray(field)){
    return field[lang] || field.en || field.ru || Object.values(field)[0];
  }
  return field;
}
function pickArr(field, lang){
  if(field && typeof field === "object" && !Array.isArray(field)){
    return field[lang] || field.en || field.ru || Object.values(field)[0];
  }
  return field;
}

const STORIES = [
  { id:"s1", author:"Amara O.", country:"Kenya", ago:"5h ago", likes:212,
    title:{ en:"My Journey with Dyslexia", ru:"Мой путь с дислексией", uz:"Disleksiya bilan yo'lim" },
    body:{
      en:["I was eleven when a teacher stopped asking me to read aloud and started asking me to explain instead. That single change moved me from the back of the class to the front of my own learning.",
        "Letters still swim. What changed is the room around them: audio versions, extra time, a font that holds still long enough for me to catch it.",
        "I am studying to be a teacher now. The first thing I tell every student is that a slow reader is not a slow thinker."],
      ru:["Мне было одиннадцать, когда учительница перестала просить меня читать вслух и начала просить объяснять своими словами. Эта перемена перевела меня с задней парты на передний край собственного обучения.",
        "Буквы до сих пор плывут перед глазами. Изменилось то, что их окружает: аудиоверсии, больше времени, шрифт, который держится достаточно неподвижно, чтобы я успевала его разглядеть.",
        "Сейчас я учусь на педагога. Первое, что я говорю каждому ученику: медленно читающий — не значит медленно думающий."],
      uz:["O'n bir yoshimda edim, o'qituvchim meni ovoz chiqarib o'qishni emas, balki tushuntirishni so'ray boshladi. Shu bir o'zgarish meni sinfning orqa partasidan o'z ta'limimning old safiga olib chiqdi.",
        "Harflar hali ham ko'z oldimda suzadi. O'zgargani — atrofdagi sharoit: audio versiyalar, qo'shimcha vaqt, ko'zim ilg'ab ulguradigan darajada barqaror turadigan shrift.",
        "Hozir o'qituvchilikka o'qiyapman. Har bir o'quvchiga birinchi aytadigan gapim: sekin o'qish — sekin fikrlash degani emas."]
    } },
  { id:"s2", author:"Iker M.", country:"Peru", ago:"1d ago", likes:148,
    title:{ en:"The Library That Came to Us", ru:"Библиотека, которая приехала к нам", uz:"Bizga kelgan kutubxona" },
    body:{
      en:["Our village is four hours from the nearest library. Once a month, a van arrived with books, a projector and one very patient librarian.",
        "She left recordings behind so my grandmother, who never learned to read, could listen to the same stories we did.",
        "Access is not only about buildings. Sometimes it is about who is willing to drive."],
      ru:["От нашей деревни до ближайшей библиотеки четыре часа пути. Раз в месяц приезжал фургон с книгами, проектором и очень терпеливой библиотекаршей.",
        "Она оставляла записи, чтобы моя бабушка, которая так и не научилась читать, могла слушать те же истории, что и мы.",
        "Доступность — это не только про здания. Иногда это про то, кто готов сесть за руль и приехать."],
      uz:["Qishlog'imizdan eng yaqin kutubxonagacha to'rt soat yo'l. Oyda bir marta kitoblar, proyektor va juda sabrli kutubxonachi bilan mikroavtobus kelardi.",
        "U yozib olingan audiolarni qoldirib ketardi, shunda o'qishni hech qachon o'rganmagan buvim ham biz eshitgan hikoyalarni tinglay olardi.",
        "Qulaylik faqat binolar haqida emas. Ba'zan bu — kim mashina haydashga tayyorligi haqida."]
    } },
  { id:"s3", author:"Wei C.", country:"Singapore", ago:"2d ago", likes:96,
    title:{ en:"Learning to Hear Differently", ru:"Учиться слышать иначе", uz:"Boshqacha eshitishni o'rganish" },
    body:{
      en:["I lost most of my hearing at seven. For two years I copied notes I could not follow.",
        "Live captions changed everything — not because they are perfect, but because they let me choose when to look away.",
        "My advice to teachers: face the class when you speak, and repeat the question before you answer it."],
      ru:["Я почти полностью потерял слух в семь лет. Два года я переписывал конспекты, смысла которых не улавливал.",
        "Живые субтитры изменили всё — не потому что они идеальны, а потому что они позволяют мне самому решать, когда отвести взгляд.",
        "Мой совет учителям: стойте лицом к классу, когда говорите, и повторяйте вопрос, прежде чем на него отвечать."],
      uz:["Yetti yoshimda eshitishimning ko'p qismini yo'qotdim. Ikki yil davomida tushunmagan konspektlarni ko'chirib yozardim.",
        "Jonli subtitrlar hammasini o'zgartirdi — ular mukammal bo'lgani uchun emas, balki qachon ko'zimni olib qochishni o'zim tanlashimga imkon bergani uchun.",
        "O'qituvchilarga maslahatim: gapirayotganda sinfga qarab turing va javob berishdan oldin savolni takrorlang."]
    } },
  { id:"s4", author:"Nadia H.", country:"Jordan", ago:"4d ago", likes:74,
    title:{ en:"A Ramp Is a Curriculum Decision", ru:"Пандус — это решение об учебной программе", uz:"Pandus — bu o'quv dasturi bo'yicha qaror" },
    body:{
      en:["The science lab was on the second floor. For three years my classes were held elsewhere, with a textbook instead of an experiment.",
        "When the school finally installed a lift, my grades did not change — my ambitions did.",
        "Accessibility is not charity. It is the difference between reading about chemistry and doing it."],
      ru:["Кабинет естественных наук был на втором этаже. Три года мои занятия проходили в другом месте — с учебником вместо эксперимента.",
        "Когда в школе наконец установили лифт, мои оценки не изменились — изменились мои амбиции.",
        "Доступность — это не благотворительность. Это разница между чтением о химии и занятием ею."],
      uz:["Tabiiy fanlar laboratoriyasi ikkinchi qavatda edi. Uch yil davomida darslarim boshqa joyda — tajriba o'rniga darslik bilan o'tardi.",
        "Maktabda nihoyat lift o'rnatilganda, baholarim o'zgarmadi — orzularim o'zgardi.",
        "Qulaylik xayriya emas. Bu kimyo haqida o'qish bilan uni bevosita qilish orasidagi farq."]
    } },
  { id:"s5", author:"Diego R.", country:"Mexico", ago:"6d ago", likes:61,
    title:{ en:"Teaching in Two Languages", ru:"Преподавание на двух языках", uz:"Ikki tilda dars berish" },
    body:{
      en:["Half my students think in an Indigenous language and are tested in Spanish. That gap is rarely called an accessibility issue, but it is one.",
        "We started recording lessons in both languages. Attendance rose before the test scores did.",
        "Belonging comes first. Comprehension follows it."],
      ru:["Половина моих учеников думает на языке коренного народа, а экзамены сдают на испанском. Этот разрыв редко называют вопросом доступности, но это именно он.",
        "Мы начали записывать уроки на обоих языках. Посещаемость выросла раньше, чем оценки за тесты.",
        "Сначала — ощущение, что ты свой. Понимание приходит следом."],
      uz:["O'quvchilarimning yarmi mahalliy tilda fikrlaydi, lekin imtihonlar ispan tilida topshiriladi. Bu tafovut kamdan-kam hollarda qulaylik muammosi deb ataladi, lekin aslida shunday.",
        "Darslarni ikkala tilda yozib olishni boshladik. Davomat testlardagi ballardan oldin o'sdi.",
        "Avval — o'zingga tegishlilik hissi. Tushunish keyin keladi."]
    } }
];

const ARTICLES = [
  { id:"a1", kind:"Research", ago:"2h ago", read:"6 min read", author:"MWM Research Team",
    title:{ en:"Visual Accessibility in Classrooms", ru:"Визуальная доступность в классах", uz:"Sinflarda vizual qulaylik" },
    body:{
      en:["We measured lighting, contrast and seating in 60 classrooms across 12 countries. In two thirds of them, a student with low vision could not read the board from the back row — not because of eyesight, but because of glare.",
        "The cheapest fixes were the most effective: matte board surfaces, a 20-degree shift in blind angle, and printing handouts at 14pt instead of 11pt.",
        "Teachers reported the changes helped everyone. Students without a diagnosis asked fewer clarifying questions, and copying time fell by roughly a fifth."],
      ru:["Мы измерили освещение, контраст и расположение мест в 60 классах в 12 странах. В двух третях из них ученик со слабым зрением не мог разглядеть доску с задних рядов — не из-за зрения, а из-за бликов.",
        "Самые дешёвые решения оказались самыми эффективными: матовая поверхность доски, сдвиг слепой зоны на 20 градусов и печать раздаточных материалов 14-м кеглем вместо 11-го.",
        "Учителя отметили, что изменения помогли всем. Ученики без диагноза стали реже задавать уточняющие вопросы, а время на переписывание сократилось примерно на пятую часть."],
      uz:["Biz 12 mamlakatdagi 60 sinfda yoritish, kontrast va o'rindiqlar joylashuvini o'lchadik. Ularning uchdan ikki qismida zaif ko'ruvchi o'quvchi orqa qatordan taxtani o'qiy olmasdi — ko'rish qobiliyati emas, balki yaltirash sababli.",
        "Eng arzon yechimlar eng samarali bo'ldi: taxtaning mat sirti, ko'r nuqtani 20 darajaga siljitish va tarqatma materiallarni 11pt o'rniga 14pt bilan chop etish.",
        "O'qituvchilar bu o'zgarishlar hammaga yordam berganini ta'kidladi. Tashxissiz o'quvchilar kamroq aniqlashtiruvchi savol berishdi, ko'chirib yozish vaqti esa taxminan beshdan bir qismga qisqardi."]
    },
    quote:{ en:"When the room is designed for the hardest case, it works better for every case.",
      ru:"Когда помещение спроектировано для самого сложного случая, оно лучше работает для любого случая.",
      uz:"Xona eng qiyin holat uchun loyihalanganda, u har qanday holat uchun yaxshiroq ishlaydi." } },
  { id:"a2", kind:"Story", ago:"5h ago", read:"4 min read", author:"Amara O.", storyId:"s1",
    title:{ en:"My Journey with Dyslexia", ru:"Мой путь с дислексией", uz:"Disleksiya bilan yo'lim" } },
  { id:"a3", kind:"Interview", ago:"1d ago", read:"8 min read", author:"MWM Interviews",
    title:{ en:"What 2,400 Learners Told Us", ru:"Что рассказали нам 2 400 учеников", uz:"2400 ta o'quvchi bizga nima dedi" },
    body:{
      en:["Over three years we recorded 2,400 interviews in 18 countries. We asked one question first: what makes a good day of learning?",
        "Almost nobody answered with technology. They answered with people — a teacher who waited, a classmate who shared notes, a parent who did not treat a diagnosis as a verdict.",
        "Tools matter, but they arrive second. The first accessibility feature in any classroom is attention."],
      ru:["За три года мы записали 2 400 интервью в 18 странах. Первым делом мы спрашивали: что делает день учёбы хорошим?",
        "Почти никто не отвечал про технологии. Отвечали про людей — учителя, который подождал, одноклассника, поделившегося конспектом, родителя, который не воспринял диагноз как приговор.",
        "Инструменты важны, но они вторичны. Первая функция доступности в любом классе — это внимание."],
      uz:["Uch yil davomida 18 mamlakatda 2400 ta intervyu yozib oldik. Birinchi savolimiz: nima o'quv kunini yaxshi qiladi?",
        "Deyarli hech kim texnologiya haqida javob bermadi. Ular odamlar haqida gapirishdi — kutgan o'qituvchi, konspektini ulashgan sinfdosh, tashxisni hukm sifatida qabul qilmagan ota-ona.",
        "Vositalar muhim, lekin ular ikkinchi o'rinda. Har qanday sinfdagi birinchi qulaylik funksiyasi — bu e'tibor."]
    },
    quote:{ en:"Nobody said the word software. They said the name of a teacher.",
      ru:"Никто не назвал слово «программа». Все называли имя учителя.",
      uz:"Hech kim 'dastur' so'zini aytmadi. Hammasi o'qituvchining ismini aytishdi." } }
];

/* ============ icons ============ */
const I = {
  home:(p)=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/></svg>,
  library:(p)=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" {...p}><rect x="4" y="4" width="4" height="16" rx="1"/><rect x="10" y="4" width="4" height="16" rx="1"/><path d="M17.5 4.8 20.8 19"/></svg>,
  stories:(p)=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 5h16v11H9l-5 4V5z"/></svg>,
  profile:(p)=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" {...p}><circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 20c1.3-3.6 4-5.4 7.2-5.4s5.9 1.8 7.2 5.4"/></svg>,
  chevron:(p)=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m9 5 7 7-7 7"/></svg>,
  back:(p)=><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m14 5-7 7 7 7"/></svg>,
  arrow:(p)=><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 12h15"/><path d="m13 6 6 6-6 6"/></svg>,
  check:(p)=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m4 12.5 5 5L20 6.5"/></svg>,
  doc:(p)=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4"/></svg>,
  search:(p)=><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" {...p}><circle cx="11" cy="11" r="6.4"/><path d="m16 16 4.2 4.2"/></svg>,
  heart:(p)=><svg width="15" height="15" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" strokeLinejoin="round" {...p}><path d="M12 20s-7.5-4.6-7.5-9.6A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/></svg>,
  bookmark:(p)=><svg width="17" height="17" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" strokeLinejoin="round" {...p}><path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/></svg>,
  plus:(p)=><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><path d="M12 5v14M5 12h14"/></svg>,
  eye:(p)=><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3.2"/></svg>,
  eyeOff:(p)=><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 3l18 18"/><path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a15.6 15.6 0 0 1-3.6 4.4M6.6 6.6C4 8.3 2 12 2 12s3.6 7 10 7c1.4 0 2.6-.3 3.7-.8"/><path d="M9.5 9.8a3.2 3.2 0 0 0 4.4 4.4"/></svg>,
  ear:(p)=><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 18c-3 0-5.5-2.7-5.5-6.5S8 4 12 4a7 7 0 0 1 7 7c0 2.5-1.8 3.5-3 4s-2 1.3-2 3a2.5 2.5 0 0 1-5 0"/></svg>,
  sparkle:(p)=><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>,
  speaker:(p)=><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19.3 6a9 9 0 0 1 0 12"/></svg>,
  logout:(p)=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>,
  flag:(p)=><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 21V4"/><path d="M5 4h13l-3 4 3 4H5"/></svg>,
  moon:(p)=><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>,
  aa:(p)=><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 17 7.5 6l4.5 11"/><path d="M4.3 13.5h6.4"/><path d="M14 17c0-2.5 2-4 4-4s3.5 1.3 3.5 3v4M21.5 15.2c-.8-.5-1.7-.7-2.8-.4-1.6.4-2.2 2.6-.7 3.4 1 .5 2.2.2 3.1-.5"/></svg>,
  chart:(p)=><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 20V10M11 20V4M18 20v-7"/><path d="M3 20h18"/></svg>,
  upload:(p)=><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>,
  volume:(p)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>,
  wand:(p)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m15 4 1.5 3L20 8.5 16.5 10 15 13l-1.5-3L10 8.5 13.5 7Z"/><path d="m4 20 8-8"/></svg>,
  layers:(p)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg>,
  wheelchair:(p)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="9" cy="5" r="1.6"/><path d="M9 8v5l-4 6M9 13h6l3 6M9 13l4-2.5"/></svg>,
  mic:(p)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>,
  video:(p)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3Z"/></svg>,
  pencil:(p)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>,
  stop:(p)=><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}><rect x="5" y="5" width="14" height="14" rx="3"/></svg>,
  play:(p)=><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M7 4.5v15l13-7.5Z"/></svg>,
  signal:()=><svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1" opacity=".45"/></svg>,
  wifi:()=><svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M1 4.2a10.5 10.5 0 0 1 14 0"/><path d="M3.6 6.9a6.8 6.8 0 0 1 8.8 0"/><path d="M6.2 9.5a3 3 0 0 1 3.6 0"/></svg>,
  battery:()=><svg width="24" height="12" viewBox="0 0 24 12" fill="none"><rect x=".7" y=".7" width="19" height="10.6" rx="3" stroke="currentColor" strokeOpacity=".5"/><rect x="2.4" y="2.4" width="15.6" height="7.2" rx="1.8" fill="currentColor"/><path d="M21.4 4.4v3.2a2 2 0 0 0 0-3.2z" fill="currentColor" fillOpacity=".5"/></svg>
};

/* ============ shared bits ============ */
function StatusBar({ dark }){
  return (
    <div className={"statusbar" + (dark ? " on-dark" : "")}>
      <span>9:41</span>
      <span className="sb-icons"><I.signal/><I.wifi/><I.battery/></span>
    </div>
  );
}
function Toast({ text }){
  return <div className="toast"><I.check/> {text}</div>;
}
function LangRow({ lang, setLang }){
  return (
    <div className="lang-row" role="group" aria-label="Language">
      {LANGS.map(l=>(
        <button key={l.code} className={"lang-chip" + (lang === l.code ? " on" : "")}
                onClick={()=>setLang(l.code)}>{l.label}</button>
      ))}
    </div>
  );
}

/* ============ splash ============ */
function Splash({ onStart, lang, setLang, t }){
  return (
    <div className="screen anim-fade">
      <StatusBar/>
      <div className="splash">
        <LangRow lang={lang} setLang={setLang}/>
        <div className="logo-tile" style={{marginTop:14}}>M</div>
        <div className="wordmark serif">M<span className="g">W</span>M</div>
        <div className="tagline">{t("appTagline")}</div>

        <svg className="art" viewBox="0 0 220 120" fill="none" aria-hidden="true">
          <g stroke="#9DBE86" strokeWidth="1.6" strokeLinecap="round">
            <path d="M110 58V28M86 60V34M134 60V34"/>
            <ellipse cx="110" cy="21" rx="12" ry="9"/>
            <ellipse cx="85" cy="28" rx="10" ry="8"/>
            <ellipse cx="135" cy="28" rx="10" ry="8"/>
          </g>
          <path d="M30 100c0-24 36-42 80-42s80 18 80 42" stroke="#1D3055" strokeWidth="1.8" strokeLinecap="round"/>
          <path d="M110 58v42" stroke="#1D3055" strokeWidth="1.6"/>
          <g stroke="#B8CCA5" strokeWidth="1.1">
            <path d="M44 84c18-11 42-17 66-17s48 6 66 17"/>
            <path d="M37 92c20-13 46-20 73-20s53 7 73 20"/>
          </g>
          <path d="M30 100h160" stroke="#1D3055" strokeWidth="1.8" strokeLinecap="round"/>
          <path d="M40 107h140" stroke="#1D3055" strokeWidth="1.2" strokeDasharray="4 6" opacity=".55" strokeLinecap="round"/>
        </svg>

        <div style={{flex:1}}/>
        <p className="quote serif">{t("splashQuote")}</p>
        <div className="squiggle"><i/><span className="serif">∿</span><i/></div>
        <button className="cta" onClick={onStart}>{t("splashCta")} <I.arrow/></button>
        <div className="foot-note">{t("splashFooter")}</div>
      </div>
    </div>
  );
}

/* ============ auth: register / login ============ */
function AuthScreen({ lang, setLang, t, onAuth, error, setError, tgUser, onTelegramLogin }){
  const [mode, setMode] = useState("register");
  const [form, setForm] = useState({ name:"", email:"", password:"" });
  const emailOk = (v)=> /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const submit = ()=>{
    const email = form.email.trim().toLowerCase();
    if(mode === "register"){
      if(form.name.trim().length < 2){ setError(t("errNameRequired")); return; }
      if(!emailOk(email)){ setError(t("errEmailInvalid")); return; }
      if(form.password.length < 4){ setError(t("errPasswordShort")); return; }
      onAuth({ mode:"register", name:form.name.trim(), email, password:form.password, lang });
    }else{
      if(!emailOk(email)){ setError(t("errEmailInvalid")); return; }
      if(!form.password){ setError(t("errPasswordShort")); return; }
      onAuth({ mode:"login", email, password:form.password });
    }
  };

  return (
    <div className="screen anim-fade">
      <StatusBar/>
      <div className="auth">
        <LangRow lang={lang} setLang={setLang}/>
        <div className="logo-tile" style={{margin:"16px auto 0"}}>M</div>
        <h1 className="serif" style={{textAlign:"center", fontSize:"calc(22px * var(--fs))", marginTop:14, lineHeight:1.2}}>
          {t("authTitle")}
        </h1>
        <p className="muted" style={{textAlign:"center", fontSize:"calc(12.5px * var(--fs))", marginTop:6, lineHeight:1.5}}>
          {mode === "register" ? t("authSubtitleRegister") : t("authSubtitleLogin")}
        </p>

        {tgUser && (
          <React.Fragment>
            <button className="cta" style={{marginTop:18, background:"#2AABEE"}} onClick={onTelegramLogin}>
              {t("continueAsTelegram").replace("{name}", tgUser.first_name || "Telegram")} <I.arrow/>
            </button>
            <div className="squiggle" style={{margin:"16px 4px"}}><i/><span className="muted" style={{fontSize:11}}>{t("orLabel")}</span><i/></div>
          </React.Fragment>
        )}

        <div className="seg" style={{marginTop: tgUser ? 0 : 20}}>
          <button className={mode === "register" ? "on" : ""} onClick={()=>{ setMode("register"); setError(""); }}>{t("tabRegister")}</button>
          <button className={mode === "login" ? "on" : ""} onClick={()=>{ setMode("login"); setError(""); }}>{t("tabLogin")}</button>
        </div>

        <div style={{marginTop:16}}>
          {mode === "register" && (
            <div className="field">
              <label htmlFor="au-name">{t("nameLabel")}</label>
              <input id="au-name" value={form.name} onChange={e=>setForm({ ...form, name:e.target.value })} placeholder={t("namePlaceholder")}/>
            </div>
          )}
          <div className="field">
            <label htmlFor="au-email">{t("emailLabel")}</label>
            <input id="au-email" type="email" inputMode="email" value={form.email} onChange={e=>setForm({ ...form, email:e.target.value })} placeholder={t("emailPlaceholder")}/>
          </div>
          <div className="field">
            <label htmlFor="au-pass">{t("passwordLabel")}</label>
            <input id="au-pass" type="password" value={form.password} onChange={e=>setForm({ ...form, password:e.target.value })} placeholder={t("passwordPlaceholder")}/>
          </div>
          {mode === "register" && (
            <div className="field">
              <label>{t("languageLabel")}</label>
              <div className="chips" style={{paddingBottom:0}}>
                {LANGS.map(l=>(
                  <button key={l.code} type="button" className={"chip" + (lang === l.code ? " on" : "")} onClick={()=>setLang(l.code)}>{l.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {error ? <p role="alert" style={{color:"var(--danger)", fontSize:"calc(12px * var(--fs))", margin:"2px 0 0"}}>{error}</p> : null}

        <button className="cta" style={{marginTop:16}} onClick={submit}>
          {mode === "register" ? t("submitRegister") : t("submitLogin")} <I.arrow/>
        </button>
        <button className="link-btn" style={{marginTop:14}} onClick={()=>{ setMode(mode === "register" ? "login" : "register"); setError(""); }}>
          {mode === "register" ? t("switchToLogin") : t("switchToRegister")}
        </button>
        <button className="link-btn muted" style={{marginTop:8}} onClick={()=>onAuth({ mode:"guest", lang })}>
          {t("guestLink")}
        </button>
      </div>
    </div>
  );
}

/* ============ accessibility setup ============ */
function AccessibilitySetup({ onPick, t }){
  const [picked, setPicked] = useState(null);
  const PROFILES = [
    { id:"low-vision", icon:I.eye, titleKey:"lowVisionTitle", subKey:"lowVisionSub" },
    { id:"blind", icon:I.eyeOff, titleKey:"blindTitle", subKey:"blindSub" },
    { id:"hearing", icon:I.ear, titleKey:"hearingTitle", subKey:"hearingSub" },
    { id:"standard", icon:I.sparkle, titleKey:"standardTitle", subKey:"standardSub" }
  ];
  return (
    <div className="screen anim-fade">
      <StatusBar/>
      <div className="setup">
        <div className="eyebrow">{t("setupStep")}</div>
        <h1 style={{fontSize:"calc(24px * var(--fs))", marginTop:8, lineHeight:1.2}}>{t("setupTitle")}</h1>
        <p className="muted" style={{fontSize:"calc(13px * var(--fs))", lineHeight:1.55, marginTop:8}}>{t("setupSubtitle")}</p>

        <div className="setup-list">
          {PROFILES.map(p=>{
            const Icon = p.icon;
            const on = picked === p.id;
            const title = t(p.titleKey);
            return (
              <button key={p.id} className={"setup-card" + (on ? " on" : "")}
                      onClick={()=>{ setPicked(p.id); speakText(title); }}
                      aria-pressed={on}>
                <span className="setup-icon"><Icon/></span>
                <span style={{flex:1}}>
                  <b>{title}</b>
                  <small>{t(p.subKey)}</small>
                </span>
                {on ? <span className="setup-check"><I.check/></span> : null}
              </button>
            );
          })}
        </div>

        <button className="cta" style={{marginTop:"auto", opacity: picked ? 1 : .5}}
                disabled={!picked}
                onClick={()=>onPick(picked)}>
          {t("setupContinue")} <I.arrow/>
        </button>
      </div>
    </div>
  );
}

/* ============ voice fab — «одна кнопка» ============ */
function VoiceFab({ onPress, hasTabbar }){
  return (
    <button
      className={"voice-fab" + (hasTabbar ? "" : " no-tabbar")}
      onClick={onPress}
      aria-label="Озвучить, что на экране">
      <I.speaker/>
    </button>
  );
}

/* ============ home ============ */
function Home({ go, t, lang, greeting, simplified }){
  const tiles = [
    { key:"tileLibrary", emoji:"📚", to:{ tab:"library" } },
    { key:"tileHub", emoji:"🎓", to:{ view:{ type:"learn" } } },
    { key:"tileShare", emoji:"🎤", to:{ view:{ type:"compose" } } },
    { key:"tileCommunity", emoji:"🌍", to:{ tab:"stories" } }
  ];
  const recentItems = simplified ? ARTICLES.slice(0, 1) : ARTICLES;
  return (
    <div className="scroll with-tabs anim-fade">
      <div className="home-head">
        <div>
          <div className="eyebrow">{greeting}</div>
          <h1 style={{fontSize:"calc(27px * var(--fs))", marginTop:6}}>{t("welcomeTitle")}</h1>
        </div>
        <button className="avatar" onClick={()=>go({ tab:"profile" }, t("navProfile"))} aria-label={t("navProfile")}>M</button>
      </div>

      <section className="mission">
        <div className="row">
          <span className="badge"><I.check/></span>
          <span className="eyebrow">{t("missionEyebrow")}</span>
        </div>
        <p>{t("missionText")}</p>
        {!simplified && (
          <div className="stats">
            <div className="stat gold"><b>2,400+</b><span>{t("statsStories")}</span></div>
            <div className="stat"><b>18</b><span>{t("statsCountries")}</span></div>
            <div className="stat green"><b>100%</b><span>{t("statsFree")}</span></div>
          </div>
        )}
      </section>

      <div className="eyebrow section-label">{t("exploreLabel")}</div>
      <div className={"grid" + (simplified ? " single" : "")}>
        {tiles.map(tile=>{
          const title = t(tile.key + "Title");
          return (
            <button key={tile.key} className={"tile" + (simplified ? " big" : "")} onClick={()=>go(tile.to, title)}>
              <span className="emoji">{tile.emoji}</span>
              <b>{title}</b>
              {!simplified && <span>{t(tile.key + "Sub")}</span>}
            </button>
          );
        })}
      </div>

      <div className="eyebrow section-label">{t("recentLabel")}</div>
      {recentItems.map(a=>{
        const title = pick(a.title, lang);
        return (
          <button key={a.id} className="row-item" onClick={()=>go({ view:{ type:"article", id:a.id } }, title)}>
            <span className="row-icon"><I.doc/></span>
            <span style={{flex:1}}>
              <b>{title}</b>
              <small>{a.kind} · {a.ago}</small>
            </span>
            <I.chevron style={{color:"var(--muted)"}}/>
          </button>
        );
      })}
    </div>
  );
}

/* ============ library ============ */
const FILTER_KEYS = { All:"filterAll", Visual:"filterVisual", Hearing:"filterHearing", Learning:"filterLearning", Book:"filterBook", Saved:"filterSaved" };
function Library({ go, saved, toggleSave, t, lang }){
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("All");
  const filters = [...LIBRARY_CATEGORIES, "Saved"];
  const items = useMemo(()=>LIBRARY.filter(it=>{
    const okF = filter === "All" ? true : filter === "Saved" ? saved.includes(it.id) : it.category === filter;
    const okQ = (it.title + " " + it.author).toLowerCase().includes(q.trim().toLowerCase());
    return okF && okQ;
  }), [q, filter, saved]);

  const readAloud = (it)=>{
    const body = (it.content && it.content.join(" ")) || it.description || it.meta || "";
    speakText(it.title + ". " + body);
  };

  return (
    <div className="scroll with-tabs anim-fade">
      <h1 style={{fontSize:"calc(26px * var(--fs))", marginBottom:14}}>{t("libraryTitle")}</h1>
      <div className="search">
        <I.search style={{color:"var(--muted)"}}/>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")}/>
      </div>
      <div className="chips">
        {filters.map(f=>(
          <button key={f} className={"chip" + (filter === f ? " on" : "")} onClick={()=>setFilter(f)}>
            {t(FILTER_KEYS[f])}{f === "Saved" && saved.length ? " · " + saved.length : ""}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <div className="emoji">🔍</div>
          <p className="muted" style={{fontSize:13}}>{t("libraryEmpty")}</p>
        </div>
      ) : items.map((it,i)=>(
        <div key={it.id} className="lib-card">
          <div className="lib-card-top">
            <button className={"lib-thumb" + (i % 2 ? " navy" : "")} onClick={()=>go({ view:{ type:"resource", id:it.id } }, it.title)} aria-label={"Open " + it.title}>{it.emoji}</button>
            <button style={{flex:1, textAlign:"left"}} onClick={()=>go({ view:{ type:"resource", id:it.id } }, it.title)}>
              <b>{it.title}</b>
              <div className="meta">{it.description || it.meta}</div>
            </button>
            <button
              onClick={()=>toggleSave(it.id)}
              aria-label={saved.includes(it.id) ? "Remove from saved" : "Save for later"}
              style={{color: saved.includes(it.id) ? "var(--green)" : "var(--muted)"}}>
              <I.bookmark fill={saved.includes(it.id) ? "currentColor" : "none"}/>
            </button>
          </div>
          <div className="lib-tags">
            {it.tags.map(tag=><span key={tag} className="lib-tag">{tag}</span>)}
          </div>
          <div className="lib-actions">
            {it.hasAudio && (
              <button className="lib-btn audio" onClick={()=>readAloud(it)}>
                <I.play/> {t("libraryAudioBtn")}
              </button>
            )}
            <button className="lib-btn read" onClick={()=>go({ view:{ type:"resource", id:it.id } }, it.title)}>
              {t("libraryReadBtn")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============ stories ============ */
function Stories({ go, liked, toggleLike, myStories, t, lang }){
  const all = [...myStories, ...STORIES];
  return (
    <div className="scroll with-tabs anim-fade">
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14}}>
        <h1 style={{fontSize:"calc(26px * var(--fs))"}}>{t("storiesTitle")}</h1>
        <button className="icon-btn" onClick={()=>go({ view:{ type:"compose" } }, t("tileShareTitle"))} aria-label={t("tileShareTitle")}><I.plus/></button>
      </div>
      <p className="muted" style={{fontSize:"calc(12.5px * var(--fs))", marginTop:0, marginBottom:16, lineHeight:1.5}}>
        {t("storiesSubtitle")}
      </p>
      {all.map(s=>{
        const title = pick(s.title, lang);
        const body = pick(s.body, lang) || [];
        const preview = body[0]
          ? body[0].slice(0,132) + "…"
          : s.format === "voice" ? "🎙️ " + t("formatVoice")
          : s.format === "video" ? "🎬 " + t("formatVideo")
          : "";
        return (
          <button key={s.id} className="story-card" onClick={()=>go({ view:{ type:"story", id:s.id } }, title)}>
            <h3>{title}</h3>
            <p>{preview}</p>
            <div className="story-foot">
              <span>{s.author} · {s.country}</span>
              <span>{s.ago}</span>
              <span
                className={"like" + (liked.includes(s.id) ? " on" : "")}
                onClick={(e)=>{ e.stopPropagation(); toggleLike(s.id); }}
                role="button" tabIndex={0}
                onKeyDown={(e)=>{ if(e.key === "Enter"){ e.stopPropagation(); toggleLike(s.id); } }}>
                <I.heart fill={liked.includes(s.id) ? "currentColor" : "none"}/>
                {s.likes + (liked.includes(s.id) ? 1 : 0)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ============ profile ============ */
function Profile({ account, set, saved, myStories, go, notify, onRerunSetup, t, onLogout, onChangeLang, onReset, onOpenInsights }){
  const s = account.settings;
  const upd = (k,v)=>{ set(p=>({ ...p, settings:{ ...p.settings, [k]:v } })); vibrate(s.haptics ? 12 : 0); };
  const Row = ({ title, sub, on, onToggle }) => (
    <button className="setting" onClick={()=>{
      if(s.voiceGuide) speakText(title + (on ? " off" : " on"));
      onToggle();
    }} aria-pressed={on}>
      <span style={{flex:1}}><b>{title}</b><small>{sub}</small></span>
      <span className={"switch" + (on ? " on" : "")}><i/></span>
    </button>
  );
  const profileLabel = {
    "low-vision": t("lowVisionTitle"), "blind": t("blindTitle"),
    "hearing": t("hearingTitle"), "standard": t("standardTitle")
  }[account.profile] || "—";

  return (
    <div className="scroll with-tabs anim-fade">
      <h1 style={{fontSize:"calc(26px * var(--fs))", marginBottom:18}}>{t("profileTitle")}</h1>
      <div style={{display:"flex", alignItems:"center", gap:14, marginBottom:20}}>
        <div className="avatar" style={{width:56, height:56, fontSize:21}}>{(account.name || "?").trim().slice(0,1).toUpperCase()}</div>
        <div>
          <b className="serif" style={{fontSize:"calc(17px * var(--fs))"}}>{account.name}</b>
          <div className="muted" style={{fontSize:"calc(12px * var(--fs))"}}>{account.email}</div>
        </div>
      </div>

      <div className="mission" style={{marginTop:0}}>
        <div className="stats" style={{borderTop:0, paddingTop:0, marginTop:0}}>
          <div className="stat gold"><b>{myStories.length}</b><span>{t("statMyStories")}</span></div>
          <div className="stat"><b>{saved.length}</b><span>{t("statSaved")}</span></div>
          <div className="stat green"><b>{Math.round(Object.values(account.progress).reduce((a,b)=>a+b,0)/4)}%</b><span>{t("statProgress")}</span></div>
        </div>
      </div>

      <div className="eyebrow section-label">{t("readingComfort")}</div>
      <div className="seg" role="group" aria-label={t("readingComfort")}>
        {[["sizeStandard",1],["sizeLarge",1.14],["sizeLargest",1.3]].map(([key,val])=>(
          <button key={key} className={s.textSize === val ? "on" : ""} onClick={()=>upd("textSize", val)}>{t(key)}</button>
        ))}
      </div>

      <div className="eyebrow section-label">{t("speechRateLabel")}</div>
      <div className="seg" role="group" aria-label={t("speechRateLabel")}>
        {[["speedSlow",0.75],["speedNormal",1],["speedFast",1.25],["speedFaster",1.5]].map(([key,val])=>(
          <button key={key} className={s.speechRate === val ? "on" : ""}
                  onClick={()=>{ upd("speechRate", val); speakText(t(key), { rate: val }); }}>{t(key)}</button>
        ))}
      </div>

      <div className="eyebrow section-label">{t("accessibilityLabel")}</div>
      <Row title={t("rowContrastTitle")} sub={t("rowContrastSub")} on={s.contrast} onToggle={()=>upd("contrast", !s.contrast)}/>
      <Row title={t("rowAnimationTitle")} sub={t("rowAnimationSub")} on={s.motion} onToggle={()=>upd("motion", !s.motion)}/>
      <Row title={t("rowCaptionsTitle")} sub={t("rowCaptionsSub")} on={s.captions} onToggle={()=>upd("captions", !s.captions)}/>
      <Row title={t("rowDyslexicTitle")} sub={t("rowDyslexicSub")} on={s.dyslexic} onToggle={()=>upd("dyslexic", !s.dyslexic)}/>
      <Row title={t("rowVoiceTitle")} sub={t("rowVoiceSub")} on={s.voiceGuide} onToggle={()=>upd("voiceGuide", !s.voiceGuide)}/>
      <Row title={t("darkModeTitle")} sub={t("darkModeSub")} on={s.darkMode} onToggle={()=>upd("darkMode", !s.darkMode)}/>
      <Row title={t("readableFontTitle")} sub={t("readableFontSub")} on={s.readableFont} onToggle={()=>upd("readableFont", !s.readableFont)}/>
      <Row title={t("hapticsTitle")} sub={t("hapticsSub")} on={s.haptics} onToggle={()=>upd("haptics", !s.haptics)}/>

      <div className="eyebrow section-label">{t("accessibilityProfileLabel")}</div>
      <button className="row-item" onClick={onRerunSetup}>
        <span className="row-icon"><I.sparkle/></span>
        <span style={{flex:1}}><b>{profileLabel}</b><small>{t("rerunSetup")}</small></span>
        <I.chevron style={{color:"var(--muted)"}}/>
      </button>

      <div className="eyebrow section-label">{t("languageRowLabel")}</div>
      <div className="seg" role="group" aria-label={t("languageRowLabel")}>
        {LANGS.map(l=>(
          <button key={l.code} className={account.lang === l.code ? "on" : ""} onClick={()=>onChangeLang(l.code)}>{l.label}</button>
        ))}
      </div>

      <div className="eyebrow section-label">{t("yourLibraryLabel")}</div>
      <button className="row-item" onClick={()=>go({ tab:"library" }, t("navLibrary"))}>
        <span className="row-icon"><I.bookmark/></span>
        <span style={{flex:1}}><b>{t("savedResourcesTitle")}</b><small>{saved.length} {t("itemsWord")}</small></span>
        <I.chevron style={{color:"var(--muted)"}}/>
      </button>
      <button className="row-item" onClick={()=>go({ view:{ type:"paths" } }, t("tileHubTitle"))}>
        <span className="row-icon">🎓</span>
        <span style={{flex:1}}><b>{t("learningPathsTitle")}</b><small>{t("learningPathsSub")}</small></span>
        <I.chevron style={{color:"var(--muted)"}}/>
      </button>

      <div className="eyebrow section-label">{t("appLabel")}</div>
      <button className="row-item" onClick={onOpenInsights}>
        <span className="row-icon"><I.chart/></span>
        <span style={{flex:1}}><b>{t("insightsRow")}</b><small>{t("insightsSub")}</small></span>
        <I.chevron style={{color:"var(--muted)"}}/>
      </button>
      <button className="row-item" onClick={onReset}>
        <span className="row-icon" style={{color:"var(--danger)"}}>↺</span>
        <span style={{flex:1}}><b>{t("resetTitle")}</b><small>{t("resetSub")}</small></span>
      </button>
      <button className="row-item" onClick={onLogout}>
        <span className="row-icon"><I.logout/></span>
        <span style={{flex:1}}><b>{t("logoutTitle")}</b><small>{t("logoutSub")}</small></span>
        <I.chevron style={{color:"var(--muted)"}}/>
      </button>

      <p className="muted" style={{fontSize:11, textAlign:"center", margin:"22px 0 6px", letterSpacing:".06em"}}>
        {t("footerTag")}
      </p>
    </div>
  );
}

/* ============ detail views ============ */
function Detail({ title, onBack, children, action, onSwipeBack }){
  const touch = useRef({ x:0, y:0 });
  const onTouchStart = (e)=>{ const t0=e.touches[0]; touch.current = { x:t0.clientX, y:t0.clientY }; };
  const onTouchEnd = (e)=>{
    if(!onSwipeBack) return;
    const t0 = e.changedTouches[0];
    const dx = t0.clientX - touch.current.x;
    const dy = t0.clientY - touch.current.y;
    if(dx > 70 && Math.abs(dy) < 60) onSwipeBack();
  };
  return (
    <React.Fragment>
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><I.back/></button>
        <h2 style={{flex:1}}>{title}</h2>
        {action}
      </div>
      <div className="scroll detail-scroll anim-slide" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>{children}</div>
    </React.Fragment>
  );
}

function ReportBox({ t, onSubmit }){
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState("");
  const reasons = ["reportWrong","reportOffensive","reportBroken","reportOther"];
  if(!open){
    return (
      <div className="report-box">
        <button className="report-toggle" onClick={()=>setOpen(true)}>
          <I.flag/> {t("reportOpen")}
        </button>
      </div>
    );
  }
  return (
    <div className="report-box">
      <div className="report-form">
        <div className="report-reasons">
          {reasons.map(r=>(
            <button key={r} className={"report-reason" + (reason === r ? " on" : "")} onClick={()=>setReason(r)}>{t(r)}</button>
          ))}
        </div>
        <textarea rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder={t("reportNotePlaceholder")}
          style={{width:"100%", background:"var(--cream-3)", border:"1px solid transparent", borderRadius:13, padding:"10px 12px", fontSize:"calc(12.5px * var(--fs))", fontFamily:"inherit", resize:"none", color:"var(--navy)"}}/>
        <button className="cta" style={{marginTop:10, opacity: reason ? 1 : .5}} disabled={!reason}
          onClick={()=>{ onSubmit({ reason, note }); setOpen(false); setReason(null); setNote(""); }}>
          {t("reportSubmit")}
        </button>
      </div>
    </div>
  );
}

function ArticleView({ id, onBack, go, t, lang, onReport }){
  const a = ARTICLES.find(x=>x.id===id);
  if(a.storyId) return <StoryView id={a.storyId} onBack={onBack} t={t} lang={lang} onReport={onReport}/>;
  const body = pick(a.body, lang);
  const quote = pick(a.quote, lang);
  return (
    <Detail title={a.kind} onBack={onBack} onSwipeBack={onBack}>
      <article className="article">
        <div className="eyebrow kicker">{a.author} · {a.read}</div>
        <h1>{pick(a.title, lang)}</h1>
        {body.map((p,i)=>(
          <React.Fragment key={i}>
            <p>{p}</p>
            {i===0 && quote ? <blockquote>{quote}</blockquote> : null}
          </React.Fragment>
        ))}
        <button className="cta" style={{marginTop:14}} onClick={()=>go({ tab:"library" })}>
          Read related resources <I.arrow/>
        </button>
        <ReportBox t={t} onSubmit={(r)=>onReport({ type:"article", id:a.id, ...r })}/>
      </article>
    </Detail>
  );
}

function StoryView({ id, onBack, liked, toggleLike, myStories, t, lang, onReport }){
  const all = [...(myStories||[]), ...STORIES];
  const s = all.find(x=>x.id===id) || STORIES[0];
  const on = (liked||[]).includes(s.id);
  const body = pick(s.body, lang) || [];
  return (
    <Detail title="Story" onBack={onBack} onSwipeBack={onBack}
      action={toggleLike ? (
        <button className={"icon-btn like" + (on ? " on" : "")} onClick={()=>toggleLike(s.id)} aria-label="Like this story">
          <I.heart fill={on ? "currentColor" : "none"}/>
        </button>) : null}>
      <article className="article">
        <div className="eyebrow kicker">{s.author} · {s.country} · {s.ago}</div>
        <h1>{pick(s.title, lang)}</h1>
        {s.audioUrl ? <audio className="rec-audio" controls src={s.audioUrl} style={{marginTop:14}}/> : null}
        {s.videoUrl ? <video className="rec-video" controls src={s.videoUrl} style={{marginTop:14}}/> : null}
        {body.map((p,i)=><p key={i}>{p}</p>)}
        {t ? <ReportBox t={t} onSubmit={(r)=>onReport && onReport({ type:"story", id:s.id, ...r })}/> : null}
      </article>
    </Detail>
  );
}

function ResourceView({ id, onBack, saved, toggleSave, notify, t, onReport }){
  const r = LIBRARY.find(x=>x.id===id);
  const isSaved = saved.includes(r.id);
  const [showText, setShowText] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const content = r.content || [];

  const playAudio = ()=>{
    const body = content.length ? content.join(" ") : (r.description || r.meta || "");
    speakText(r.title + ". " + body);
  };

  return (
    <Detail title={r.format} onBack={onBack} onSwipeBack={onBack}>
      <div style={{display:"flex", gap:14, alignItems:"center", marginBottom:18}}>
        <div className="thumb" style={{width:64, height:64, fontSize:28, borderRadius:16, background:"var(--cream-2)", display:"grid", placeItems:"center"}}>{r.emoji}</div>
        <div>
          <h1 style={{fontSize:"calc(20px * var(--fs))", lineHeight:1.25}}>{r.title}</h1>
          <div className="muted" style={{fontSize:"calc(12px * var(--fs))", marginTop:4}}>{r.author} · {r.year}</div>
        </div>
      </div>
      <p className="muted" style={{fontSize:"calc(13px * var(--fs))", lineHeight:1.6}}>{r.meta}</p>
      <div className="card" style={{display:"block"}}>
        <b style={{marginBottom:8}}>Accessibility</b>
        {["Screen-reader tested","Alt text on all images","Adjustable text size", r.format==="Audio" ? "Full transcript" : "Large-print edition"].map(x=>(
          <div key={x} style={{display:"flex", gap:9, alignItems:"center", padding:"5px 0", fontSize:"calc(12.5px * var(--fs))"}}>
            <span style={{color:"var(--green)"}}><I.check/></span> {x}
          </div>
        ))}
      </div>

      <div style={{display:"flex", gap:8, marginTop:6}}>
        {r.hasAudio && (
          <button className="lib-btn audio" style={{flex:1, justifyContent:"center", padding:"13px 14px"}} onClick={playAudio}>
            <I.play/> {t ? t("libraryAudioBtn") : "Play"}
          </button>
        )}
        {r.hasRead && content.length > 0 && (
          <button className="lib-btn read" style={{flex:1, justifyContent:"center", padding:"13px 14px"}} onClick={()=>setShowText(v=>!v)}>
            {t ? t("libraryReadBtn") : "Read"}
          </button>
        )}
      </div>

      {showText && content.length > 0 && (
        <div className="card" style={{display:"block", marginTop:14}}>
          {content.map((p,i)=>(
            <p key={i} style={{fontSize:"calc(14.5px * var(--fs))", lineHeight:1.75, margin:"9px 0", color:"#3A465E"}}>{p}</p>
          ))}
        </div>
      )}

      <button className="cta" style={{marginTop:14, background:"var(--cream-2)", color:"var(--navy)"}} onClick={()=>toggleSave(r.id)}>
        {isSaved ? "Remove from saved" : "Save for later"}
      </button>

      {(r.transcript || r.altTexts) && (
        <div style={{marginTop:16}}>
          <button className="report-toggle" onClick={()=>setShowExtra(v=>!v)}>
            <I.doc/> {r.transcript ? "Show transcript" : "Show image descriptions"}
          </button>
          {showExtra && (
            <div className="card" style={{display:"block", marginTop:10}}>
              {(r.transcript || r.altTexts).map((line,i)=>(
                <p key={i} style={{fontSize:"calc(12.5px * var(--fs))", lineHeight:1.6, margin:"6px 0"}}>{line}</p>
              ))}
            </div>
          )}
        </div>
      )}
      {t ? <ReportBox t={t} onSubmit={(rep)=>onReport && onReport({ type:"resource", id:r.id, ...rep })}/> : null}
    </Detail>
  );
}

function InsightsView({ onBack, accounts, reports, t }){
  const list = Object.values(accounts || {});
  const total = list.length;
  const byProfile = { "low-vision":0, "blind":0, "hearing":0, "standard":0, "—":0 };
  let voiceOn = 0, storiesTotal = 0;
  list.forEach(acc=>{
    byProfile[acc.profile || "—"] = (byProfile[acc.profile || "—"] || 0) + 1;
    if(acc.settings && acc.settings.voiceGuide) voiceOn++;
    storiesTotal += (acc.myStories || []).length;
  });
  const profileLabels = { "low-vision":t("lowVisionTitle"), "blind":t("blindTitle"), "hearing":t("hearingTitle"), "standard":t("standardTitle"), "—":"—" };
  const maxProfile = Math.max(1, ...Object.values(byProfile));
  return (
    <Detail title={t("insightsTitle")} onBack={onBack} onSwipeBack={onBack}>
      <div className="insight-card">
        <b>{t("insightsAccounts")}</b>
        <div style={{fontSize:"calc(30px * var(--fs))", fontFamily:"Fraunces,serif", fontWeight:700}}>{total}</div>
      </div>
      <div className="insight-card">
        <b>{t("insightsByProfile")}</b>
        {Object.entries(byProfile).filter(([k,v])=>v>0 || k!=="—").map(([k,v])=>(
          <div key={k} className="insight-row">
            <span style={{width:110, flex:"none"}}>{profileLabels[k]}</span>
            <span className="insight-bar"><i style={{width:(v/maxProfile*100)+"%"}}/></span>
            <span className="insight-num">{v}</span>
          </div>
        ))}
      </div>
      <div className="insight-card">
        <b>{t("insightsVoice")}</b>
        <div className="insight-row">
          <span className="insight-bar"><i style={{width:(total? voiceOn/total*100:0)+"%"}}/></span>
          <span className="insight-num">{voiceOn}/{total}</span>
        </div>
      </div>
      <div className="insight-card">
        <b>{t("insightsStories")}</b>
        <div style={{fontSize:"calc(22px * var(--fs))", fontFamily:"Fraunces,serif", fontWeight:700}}>{storiesTotal}</div>
      </div>
      <div className="insight-card">
        <b>{t("insightsReports")}</b>
        <div style={{fontSize:"calc(22px * var(--fs))", fontFamily:"Fraunces,serif", fontWeight:700}}>{(reports||[]).length}</div>
      </div>
      <p className="muted" style={{fontSize:"calc(11.5px * var(--fs))", lineHeight:1.5}}>{t("insightsNote")}</p>
    </Detail>
  );
}

function PathsView({ onBack, progress, setProgress, notify }){
  return (
    <Detail title="Learning Hub" onBack={onBack}>
      <p className="muted" style={{fontSize:"calc(13px * var(--fs))", marginTop:0, lineHeight:1.6}}>
        Four pathways built from classroom research. Each lesson works offline and with a screen reader.
      </p>
      {PATHS.map(p=>{
        const v = progress[p.id];
        return (
          <div key={p.id} className="card" style={{display:"block"}}>
            <div style={{display:"flex", gap:12, alignItems:"flex-start"}}>
              <span className="thumb">{p.emoji}</span>
              <span style={{flex:1}}>
                <b>{p.title}</b>
                <div className="meta">{p.lessons} lessons · {p.mins} min · {p.level}</div>
              </span>
            </div>
            <div className="progress"><i style={{width:v + "%"}}/></div>
            <div style={{display:"flex", alignItems:"center", gap:10, marginTop:10}}>
              <span className="muted" style={{fontSize:"calc(11.5px * var(--fs))"}}>{v}% complete</span>
              <button
                style={{marginLeft:"auto", fontWeight:600, color:"var(--green)", fontSize:"calc(12.5px * var(--fs))"}}
                onClick={()=>{
                  const next = Math.min(100, v + Math.ceil(100/p.lessons));
                  setProgress(p.id, next);
                  notify(next===100 ? "Pathway finished" : "Lesson marked done");
                }}>
                {v===100 ? "Review pathway" : v===0 ? "Start pathway" : "Continue"}
              </button>
            </div>
          </div>
        );
      })}
    </Detail>
  );
}

/* ============ scan text (client-side OCR, no server) ============ */
const OCR_LANG_MAP = { ru:"rus", uz:"uzb", en:"eng" };
function ScanText({ onBack, t, lang, notify }){
  const [imgSrc, setImgSrc] = useState(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("idle"); // idle | processing | done | empty
  const fileRef = useRef(null);

  const runOcr = async (file)=>{
    setStatus("processing");
    setText("");
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    try{
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(OCR_LANG_MAP[lang] || "eng");
      const { data } = await worker.recognize(url);
      await worker.terminate();
      const cleaned = (data.text || "").trim();
      setText(cleaned);
      setStatus(cleaned ? "done" : "empty");
    }catch(e){
      setStatus("empty");
    }
  };
  const onPick = (e)=>{
    const f = e.target.files && e.target.files[0];
    if(f) runOcr(f);
  };
  const copyText = ()=>{
    try{ navigator.clipboard.writeText(text); notify(t("scanCopied")); }catch(e){}
  };

  return (
    <Detail title={t("scanTitle")} onBack={onBack} onSwipeBack={onBack}>
      <p className="choice-quote" style={{fontSize:"calc(15px * var(--fs))"}}>{t("scanSub")}</p>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={onPick}/>

      {imgSrc && (
        <img src={imgSrc} alt="" style={{width:"100%", borderRadius:14, marginTop:14, maxHeight:180, objectFit:"cover"}}/>
      )}

      <button className="cta" style={{marginTop:14}} onClick={()=>fileRef.current && fileRef.current.click()}>
        <I.upload/> {imgSrc ? t("scanRetake") : t("scanTakePhoto")}
      </button>

      {status === "processing" && (
        <div className="rec-box" style={{marginTop:16}}>
          <div className="rec-timer" style={{fontSize:"calc(16px * var(--fs))"}}><span className="rec-dot"/>{t("scanProcessing")}</div>
        </div>
      )}

      {status === "empty" && (
        <p className="muted" style={{marginTop:16, fontSize:"calc(13px * var(--fs))"}}>{t("scanEmpty")}</p>
      )}

      {status === "done" && (
        <div className="card" style={{display:"block", marginTop:16}}>
          <p style={{fontSize:"calc(16px * var(--fs))", lineHeight:1.65, whiteSpace:"pre-wrap"}}>{text}</p>
          <div style={{display:"flex", gap:8, marginTop:14}}>
            <button className="lib-btn audio" onClick={()=>speakText(text)}><I.play/> {t("scanRead")}</button>
            <button className="lib-btn read" onClick={copyText}>{t("scanCopy")}</button>
          </div>
        </div>
      )}
    </Detail>
  );
}

/* ============ live transcript (Web Speech API, no server) ============ */
const STT_LANG_MAP = { ru:"ru-RU", uz:"uz-UZ", en:"en-US" };
function LiveTranscript({ onBack, t, lang, notify }){
  const [supported] = useState(()=> typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition));
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const recRef = useRef(null);

  const start = ()=>{
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR) return;
    const rec = new SR();
    rec.lang = STT_LANG_MAP[lang] || "ru-RU";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e)=>{
      let finalChunk = "", interimChunk = "";
      for(let i = e.resultIndex; i < e.results.length; i++){
        const r = e.results[i];
        if(r.isFinal) finalChunk += r[0].transcript + " ";
        else interimChunk += r[0].transcript;
      }
      if(finalChunk) setFinalText(prev=>prev + finalChunk);
      setInterim(interimChunk);
    };
    rec.onerror = ()=>setListening(false);
    rec.onend = ()=>setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  };
  const stop = ()=>{ if(recRef.current) recRef.current.stop(); setListening(false); };
  useEffect(()=>()=>{ if(recRef.current) recRef.current.stop(); }, []);

  const fullText = (finalText + interim).trim();
  const copyText = ()=>{ try{ navigator.clipboard.writeText(finalText.trim()); notify(t("transcriptCopied")); }catch(e){} };

  return (
    <Detail title={t("transcriptTitle")} onBack={onBack} onSwipeBack={onBack}>
      <p className="choice-quote" style={{fontSize:"calc(15px * var(--fs))"}}>{t("transcriptSub")}</p>

      {!supported ? (
        <p style={{color:"var(--danger)", marginTop:16, fontSize:"calc(13px * var(--fs))"}}>{t("transcriptUnsupported")}</p>
      ) : (
        <React.Fragment>
          <div className="rec-box" style={{marginTop:16}}>
            {listening ? (
              <React.Fragment>
                <div className="rec-timer" style={{fontSize:"calc(15px * var(--fs))"}}><span className="rec-dot"/> REC</div>
                <button className="rec-btn stop" onClick={stop}><I.stop/> {t("transcriptStop")}</button>
              </React.Fragment>
            ) : (
              <button className="rec-btn" onClick={start}><I.mic/> {t("transcriptStart")}</button>
            )}
          </div>

          <div className="card" style={{display:"block", minHeight:120}}>
            <p style={{fontSize:"calc(15px * var(--fs))", lineHeight:1.65, whiteSpace:"pre-wrap"}}>
              {fullText ? fullText : <span className="muted">{t("transcriptEmpty")}</span>}
            </p>
          </div>

          {finalText.trim() && (
            <div style={{display:"flex", gap:8, marginTop:10}}>
              <button className="lib-btn read" onClick={copyText}>{t("transcriptCopy")}</button>
              <button className="lib-btn audio" onClick={()=>{ setFinalText(""); setInterim(""); }}>{t("transcriptClear")}</button>
            </div>
          )}
        </React.Fragment>
      )}
    </Detail>
  );
}

function LearnUpload({ onBack, onApply, onBrowsePaths, onOpenScan, onOpenTranscript, t }){
  const [file, setFile] = useState(null);
  const [opts, setOpts] = useState({ audio:false, simplify:false, summarize:false, largeText:false, screenReader:false });
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef(null);
  const toggle = (k)=>setOpts(o=>({ ...o, [k]: !o[k] }));
  const OPTIONS = [
    { key:"audio", icon:I.volume, titleKey:"optConvertAudio", subKey:"optConvertAudioSub" },
    { key:"simplify", icon:I.wand, titleKey:"optSimplify", subKey:"optSimplifySub" },
    { key:"summarize", icon:I.layers, titleKey:"optSummarize", subKey:"optSummarizeSub" },
    { key:"largeText", icon:I.aa, titleKey:"optLargeText", subKey:"optLargeTextSub" },
    { key:"screenReader", icon:I.wheelchair, titleKey:"optScreenReader", subKey:"optScreenReaderSub" }
  ];
  const ready = !!file;
  const submit = ()=>{
    if(!ready || processing) return;
    setProcessing(true);
    setTimeout(()=>{ setProcessing(false); onApply(opts, file.name); }, 900);
  };
  return (
    <Detail title={t("tileHubTitle")} onBack={onBack} onSwipeBack={onBack}>
      <p className="choice-quote">{t("learnTitle")}</p>

      <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{display:"none"}}
        onChange={e=>{ const f = e.target.files && e.target.files[0]; if(f) setFile(f); }}/>
      <button className={"upload-card" + (file ? " done" : "")} onClick={()=>fileRef.current && fileRef.current.click()}>
        <span className="upload-icon">{file ? <I.check/> : <I.upload/>}</span>
        <span>
          <b>{t("uploadPdfTitle")}</b>
          <div className="muted" style={{fontSize:"calc(11.5px * var(--fs))", marginTop:3}}>
            {file ? file.name : t("uploadPdfSub")}
          </div>
        </span>
      </button>

      <div className="eyebrow section-label">{t("accessibilityOptionsLabel")}</div>
      {OPTIONS.map(o=>{
        const Icon = o.icon;
        const on = opts[o.key];
        return (
          <button key={o.key} className="opt-row" onClick={()=>toggle(o.key)} aria-pressed={on}>
            <span className="opt-icon"><Icon/></span>
            <span style={{flex:1}}><b>{t(o.titleKey)}</b><small>{t(o.subKey)}</small></span>
            <span className={"opt-box" + (on ? " on" : "")}><I.check/></span>
          </button>
        );
      })}

      <button className="cta" style={{marginTop:20, opacity: ready ? 1 : .5}} disabled={!ready || processing} onClick={submit}>
        {processing ? t("uploadProcessing") : ready ? t("uploadCtaReady") : t("uploadCtaDisabled")}
      </button>

      <div className="eyebrow section-label">{t("exploreLabel")}</div>
      <button className="row-item" onClick={onOpenScan}>
        <span className="row-icon">📷</span>
        <span style={{flex:1}}><b>{t("scanTitle")}</b><small>{t("scanSub")}</small></span>
        <I.chevron style={{color:"var(--muted)"}}/>
      </button>
      <button className="row-item" onClick={onOpenTranscript}>
        <span className="row-icon"><I.mic/></span>
        <span style={{flex:1}}><b>{t("transcriptTitle")}</b><small>{t("transcriptSub")}</small></span>
        <I.chevron style={{color:"var(--muted)"}}/>
      </button>

      <button className="link-btn" style={{marginTop:14}} onClick={onBrowsePaths}>{t("browsePathwaysLink")}</button>
    </Detail>
  );
}

function Compose({ onBack, onSubmit, t }){
  const [format, setFormat] = useState(null);
  const [step, setStep] = useState("choose");
  const [title, setTitle] = useState("");
  const [country, setCountry] = useState("");
  const [body, setBody] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [micError, setMicError] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const videoInputRef = useRef(null);

  useEffect(()=>()=>clearInterval(timerRef.current), []);

  const FORMATS = [
    { id:"write", icon:I.pencil, titleKey:"formatWrite", subKey:"formatWriteSub" },
    { id:"voice", icon:I.mic, titleKey:"formatVoice", subKey:"formatVoiceSub" },
    { id:"video", icon:I.video, titleKey:"formatVideo", subKey:"formatVideoSub" }
  ];

  const startRecording = async ()=>{
    setMicError(false);
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio:true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e)=>{ if(e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = ()=>{
        const blob = new Blob(chunksRef.current, { type:"audio/webm" });
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach(tr=>tr.stop());
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
      setRecSeconds(0);
      timerRef.current = setInterval(()=>setRecSeconds(sec=>sec+1), 1000);
    }catch(e){ setMicError(true); }
  };
  const stopRecording = ()=>{
    if(mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") mediaRecorderRef.current.stop();
    setRecording(false);
    clearInterval(timerRef.current);
  };
  const onVideoPick = (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    setVideoUrl(URL.createObjectURL(f));
  };
  const fmtTime = (sec)=>{ const m = Math.floor(sec/60); const s = sec%60; return m + ":" + String(s).padStart(2,"0"); };

  if(step === "choose"){
    return (
      <Detail title={t("tileShareTitle")} onBack={onBack} onSwipeBack={onBack}>
        <div style={{textAlign:"center", margin:"6px 0 18px"}}>
          <div style={{fontSize:34, marginBottom:8}}>💬</div>
          <p className="choice-quote">{t("storyQuote")}</p>
          <p className="muted" style={{fontSize:"calc(12.5px * var(--fs))", lineHeight:1.55, marginTop:8}}>{t("storyIntro")}</p>
        </div>
        {FORMATS.map(fm=>{
          const Icon = fm.icon;
          const on = format === fm.id;
          return (
            <button key={fm.id} className={"format-card" + (on ? " on" : "")} onClick={()=>setFormat(fm.id)}>
              <span className="format-icon"><Icon/></span>
              <span style={{flex:1}}><b>{t(fm.titleKey)}</b><small>{t(fm.subKey)}</small></span>
              <span className="format-radio"/>
            </button>
          );
        })}
        <button className="cta" style={{marginTop:8, opacity: format ? 1 : .5}} disabled={!format}
          onClick={()=>setStep("fill")}>
          {format ? t("continueCta") : t("chooseFormatCta")}
        </button>
        <p className="muted" style={{fontSize:11, textAlign:"center", marginTop:12}}>{t("anonNote")}</p>
      </Detail>
    );
  }

  const canPublish = title.trim().length > 1 && (
    (format === "write" && body.trim().length > 30) ||
    (format === "voice" && !!audioUrl) ||
    (format === "video" && !!videoUrl)
  );

  return (
    <Detail title={t("tileShareTitle")} onBack={()=>setStep("choose")}>
      <div className="field">
        <label htmlFor="c-title">{t("attachTitleLabel")}</label>
        <input id="c-title" value={title} maxLength={70} onChange={e=>setTitle(e.target.value)} placeholder={t("attachTitleLabel")}/>
      </div>
      <div className="field">
        <label htmlFor="c-country">{t("attachCountryLabel")}</label>
        <input id="c-country" value={country} onChange={e=>setCountry(e.target.value)} placeholder={t("attachCountryLabel")}/>
      </div>

      {format === "write" && (
        <div className="field">
          <label htmlFor="c-body">{t("formatWrite")}</label>
          <textarea id="c-body" rows={8} value={body} onChange={e=>setBody(e.target.value)} placeholder={t("formatWriteSub")}/>
          <div className="hint">{body.trim().length} characters · min 30</div>
        </div>
      )}

      {format === "voice" && (
        <div className="rec-box">
          {audioUrl ? (
            <React.Fragment>
              <audio className="rec-audio" controls src={audioUrl}/>
              <button className="rec-btn" style={{marginTop:12}} onClick={()=>setAudioUrl(null)}><I.mic/> {t("recRetake")}</button>
            </React.Fragment>
          ) : recording ? (
            <React.Fragment>
              <div className="rec-timer"><span className="rec-dot"/>{fmtTime(recSeconds)}</div>
              <button className="rec-btn stop" onClick={stopRecording}><I.stop/> {t("recStop")}</button>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <I.mic/>
              <div><button className="rec-btn" style={{marginTop:10}} onClick={startRecording}><I.mic/> {t("recStart")}</button></div>
              {micError ? <p style={{color:"var(--danger)", fontSize:12, marginTop:8}}>{t("recNeedMic")}</p> : null}
            </React.Fragment>
          )}
        </div>
      )}

      {format === "video" && (
        <div className="rec-box">
          <input ref={videoInputRef} type="file" accept="video/*" style={{display:"none"}} onChange={onVideoPick}/>
          {videoUrl ? (
            <React.Fragment>
              <video className="rec-video" controls src={videoUrl}/>
              <button className="rec-btn" style={{marginTop:12}} onClick={()=>videoInputRef.current.click()}><I.video/> {t("videoRetake")}</button>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <I.video/>
              <div><button className="rec-btn" style={{marginTop:10}} onClick={()=>videoInputRef.current.click()}><I.upload/> {t("videoChoose")}</button></div>
            </React.Fragment>
          )}
        </div>
      )}

      {(format === "voice" || format === "video") && (
        <p className="muted" style={{fontSize:11, marginTop:4}}>{t("mediaNote")}</p>
      )}

      <button className="cta" disabled={!canPublish} style={{opacity: canPublish ? 1 : .45, marginTop:16}}
        onClick={()=>{ if(!canPublish) return; onSubmit({ title, country, body, format, audioUrl, videoUrl }); }}>
        Publish story <I.arrow/>
      </button>
    </Detail>
  );
}

/* ============ device-adaptive scale ============ */
function useDeviceScale(ref){
  const [scale, setScale] = useState(1);
  useEffect(()=>{
    const el = ref.current;
    if(!el || typeof ResizeObserver === "undefined") return;
    const compute = ()=>{
      const w = el.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 390);
      const raw = w / 390; // reference design width
      const clamped = Math.max(0.92, Math.min(1.18, raw));
      setScale(Number(clamped.toFixed(3)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    window.addEventListener("orientationchange", compute);
    return ()=>{ ro.disconnect(); window.removeEventListener("orientationchange", compute); };
  }, [ref]);
  return scale;
}

/* ============ app ============ */
function App(){
  const [accounts, setAccounts] = useState(()=> MIGRATED ? MIGRATED.accounts : loadAccounts());
  const [session, setSession] = useState(()=> MIGRATED ? MIGRATED.session : loadSession());
  const [uiLang, setUiLang] = useState(()=>{
    try{ return localStorage.getItem(LANG_KEY) || "ru"; }catch(e){ return "ru"; }
  });
  const [authError, setAuthError] = useState("");
  const [tab, setTab] = useState("home");
  const [view, setView] = useState(null);
  const [toast, setToast] = useState(null);
  const [stage, setStage] = useState(()=>{
    const sess = MIGRATED ? MIGRATED.session : loadSession();
    const accs = MIGRATED ? MIGRATED.accounts : loadAccounts();
    return (sess && accs[sess.email]) ? "app" : "splash";
  });
  const [reports, setReports] = useState(loadReports);
  const [tgUser, setTgUser] = useState(null);
  const scrollRef = useRef(null);
  const deviceScreenRef = useRef(null);
  const ds = useDeviceScale(deviceScreenRef);

  const account = session ? accounts[session.email] : null;

  // Telegram Mini App bootstrap: no-ops outside Telegram (window.Telegram is undefined).
  useEffect(()=>{
    const tg = getTelegram();
    if(!tg) return;
    try{ tg.ready(); }catch(e){}
    try{ tg.expand(); }catch(e){}
    // Telegram intercepts vertical swipes by default (to let people close the app
    // with a swipe-down gesture). That conflicts with normal in-page scrolling —
    // this hands vertical touch gestures back to the page. Each call is isolated
    // so an older client that doesn't support one method still runs the rest.
    try{ tg.disableVerticalSwipes && tg.disableVerticalSwipes(); }catch(e){}
    try{ tg.isVerticalSwipesEnabled = false; }catch(e){}
    try{ tg.setHeaderColor && tg.setHeaderColor("#16243F"); }catch(e){}
    try{ tg.setBackgroundColor && tg.setBackgroundColor("#16243F"); }catch(e){}
    try{ if(tg.initDataUnsafe && tg.initDataUnsafe.user) setTgUser(tg.initDataUnsafe.user); }catch(e){}
  }, []);

  useEffect(()=>{ saveAccounts(accounts); }, [accounts]);
  useEffect(()=>{ saveSession(session); }, [session]);
  useEffect(()=>{ try{ localStorage.setItem(LANG_KEY, uiLang); }catch(e){} }, [uiLang]);
  useEffect(()=>{ saveReports(reports); }, [reports]);
  useEffect(()=>{
    if(!toast) return;
    const tm = setTimeout(()=>setToast(null), 2200);
    return ()=>clearTimeout(tm);
  }, [toast]);
  useEffect(()=>()=>{ try{ window.speechSynthesis && window.speechSynthesis.cancel(); }catch(e){} }, []);
  useEffect(()=>{
    if(stage === "app" && !account) setStage("auth");
  }, [stage, account]);

  // Telegram's own back button stands in for our in-app back button when available.
  useEffect(()=>{
    const tg = getTelegram();
    if(!tg || !tg.BackButton) return;
    const onBack = ()=>setView(null);
    if(view){ tg.BackButton.show(); tg.BackButton.onClick(onBack); }
    else{ tg.BackButton.hide(); }
    return ()=>{ try{ tg.BackButton.offClick(onBack); }catch(e){} };
  }, [view]);

  const lang = account ? account.lang : uiLang;
  const t = useCallback((key)=> tFor(lang, key), [lang]);
  const notify = useCallback((text)=>setToast(text), []);
  useEffect(()=>{ try{ document.documentElement.lang = lang; }catch(e){} }, [lang]);
  useEffect(()=>{ setSpeechPrefs(lang, account ? account.settings.speechRate : 1); }, [lang, account && account.settings.speechRate]);

  const submitReport = ({ type, id, reason, note })=>{
    const entry = { id:"r"+Date.now(), type, targetId:id, reason, note, lang, at:new Date().toISOString() };
    setReports(prev=>[entry, ...prev]);
    notify(t("reportThanks"));
    vibrate(account && account.settings.haptics ? [10,40,10] : 0);
  };

  const updateAccount = (email, updater)=>{
    setAccounts(prev=>{
      const cur = prev[email];
      if(!cur) return prev;
      return { ...prev, [email]: updater(cur) };
    });
  };

  const voiceGuide = !!(account && account.settings.voiceGuide);
  const hapticsOn = !!(account && account.settings.haptics);
  const go = (to, label)=>{
    if(voiceGuide && label) speakText(label);
    if(hapticsOn) vibrate(10);
    if(to.tab){ setTab(to.tab); setView(null); }
    if(to.view){ setView(to.view); }
  };
  const toggleSave = (id)=>{
    if(!session) return;
    updateAccount(session.email, p=>{
      const has = p.saved.includes(id);
      const msg = has ? t("savedRemoved") : t("savedAdded");
      notify(msg);
      if(p.settings.voiceGuide) speakText(msg);
      if(p.settings.haptics) vibrate(has ? 8 : [8,30,8]);
      return { ...p, saved: has ? p.saved.filter(x=>x!==id) : [id, ...p.saved] };
    });
  };
  const toggleLike = (id)=>{
    if(!session) return;
    updateAccount(session.email, p=>{
      const has = p.liked.includes(id);
      if(p.settings.voiceGuide) speakText(has ? t("likeRemoved") : t("likeAdded"));
      if(p.settings.haptics) vibrate(has ? 8 : [8,30,8]);
      return { ...p, liked: has ? p.liked.filter(x=>x!==id) : [id, ...p.liked] };
    });
  };
  const setProgress = (id, v)=>{ if(session) updateAccount(session.email, p=>({ ...p, progress:{ ...p.progress, [id]:v } })); };
  const publish = (f)=>{
    if(!session || !account) return;
    const story = {
      id:"my" + Date.now(), title:f.title.trim(), author: account.name || "You",
      country:f.country.trim() || "—", ago:"just now", likes:0,
      format: f.format || "write",
      body: f.format === "write" ? f.body.trim().split(/\n{1,}/).filter(Boolean) : [],
      audioUrl: f.audioUrl || null,
      videoUrl: f.videoUrl || null
    };
    updateAccount(session.email, p=>({ ...p, myStories:[story, ...p.myStories] }));
    setView(null); setTab("stories"); notify(t("storyPublished"));
  };
  const handleLearnApply = (opts, fileName)=>{
    if(!session) return;
    updateAccount(session.email, p=>{
      const next = { ...p.settings };
      if(opts.largeText) next.textSize = 1.3;
      if(opts.screenReader) next.voiceGuide = true;
      return { ...p, settings: next };
    });
    notify(t("uploadDone"));
    if(opts.audio) setTimeout(()=>speakText(fileName + ". " + t("uploadDone")), 300);
    setView(null);
  };
  const applyProfile = (id)=>{
    if(!session) return;
    updateAccount(session.email, p=>{
      const next = { ...p.settings };
      if(id === "low-vision"){ next.textSize = 1.3; next.contrast = true; }
      if(id === "blind"){ next.textSize = 1.3; next.voiceGuide = true; }
      if(id === "hearing"){ next.captions = true; }
      return { ...p, onboarded:true, profile:id, settings: next };
    });
    setStage("app");
    notify(id === "standard" ? t("profileAppliedPlain") : t("profileApplied"));
    if(id === "blind" || id === "low-vision"){
      setTimeout(()=>speakText(t("welcomeTitle")), 400);
    }
  };
  const handleReset = ()=>{
    if(!session || !account) return;
    updateAccount(session.email, p=>makeAccount({ name:p.name, email:p.email, lang:p.lang }));
    setTab("home"); setView(null);
    setStage("setup");
    notify(t("resetDone"));
  };
  const logout = ()=>{
    setSession(null);
    setTab("home"); setView(null);
    setStage("auth");
  };
  const handleAuth = ({ mode, name, email, password, lang: chosenLang })=>{
    setAuthError("");
    if(mode === "guest"){
      const guestEmail = "guest@local";
      const existing = accounts[guestEmail];
      if(!existing){
        const guestName = chosenLang === "uz" ? "Mehmon" : chosenLang === "en" ? "Guest" : "Гость";
        setAccounts(prev=>({ ...prev, [guestEmail]: makeAccount({ name:guestName, email:guestEmail, lang:chosenLang }) }));
      }
      setSession({ email: guestEmail });
      setStage(existing && existing.onboarded ? "app" : "setup");
      return;
    }
    if(mode === "register"){
      if(accounts[email]){ setAuthError(tFor(chosenLang, "errEmailTaken")); return; }
      const acc = makeAccount({ name, email, lang: chosenLang });
      acc._password = password;
      setAccounts(prev=>({ ...prev, [email]: acc }));
      setSession({ email });
      setStage("setup");
      notify(tFor(chosenLang, "registeredToast"));
      return;
    }
    if(mode === "login"){
      const acc = accounts[email];
      if(!acc){ setAuthError(tFor(uiLang, "errEmailNotFound")); return; }
      if(acc._password && acc._password !== password){ setAuthError(tFor(uiLang, "errWrongPassword")); return; }
      setSession({ email });
      setStage(acc.onboarded ? "app" : "setup");
      notify(tFor(acc.lang, "welcomeBack"));
      return;
    }
  };

  const handleTelegramLogin = ()=>{
    if(!tgUser) return;
    const tg = getTelegram();
    const info = telegramUserToAccount(tgUser, tg && tg.colorScheme);
    const existing = accounts[info.email];
    if(!existing){
      const acc = makeAccount({ name: info.name, email: info.email, lang: info.lang });
      if(info.dark) acc.settings.darkMode = true;
      setAccounts(prev=>({ ...prev, [info.email]: acc }));
      setSession({ email: info.email });
      setStage("setup");
    }else{
      setSession({ email: info.email });
      setStage(existing.onboarded ? "app" : "setup");
      notify(tFor(existing.lang, "welcomeBack"));
    }
  };

  const greeting = useMemo(()=>{
    const h = new Date().getHours();
    const key = h < 12 ? "goodMorning" : h < 18 ? "goodAfternoon" : "goodEvening";
    return t(key);
  }, [t]);

  const s = account ? account.settings : { textSize:1, contrast:false, motion:true, dyslexic:false };
  const screenStyle = {
    "--user-fs": s.textSize,
    "--ds": String(ds),
    letterSpacing: s.dyslexic ? ".02em" : "normal",
    lineHeight: s.dyslexic ? 1.75 : 1.5
  };
  const simplified = !!account && (account.profile === "low-vision" || account.profile === "blind");

  if(stage === "splash"){
    return (
      <div className="device"><div className="device-screen" ref={deviceScreenRef} style={{ "--ds": String(ds) }}>
        <div className="island"/>
        <Splash onStart={()=>setStage("auth")} lang={uiLang} setLang={setUiLang} t={(k)=>tFor(uiLang,k)}/>
      </div></div>
    );
  }
  if(stage === "auth"){
    return (
      <div className="device"><div className="device-screen" ref={deviceScreenRef} style={{ "--ds": String(ds) }}>
        <div className="island"/>
        <AuthScreen lang={uiLang} setLang={setUiLang} t={(k)=>tFor(uiLang,k)} onAuth={handleAuth} error={authError} setError={setAuthError}
                    tgUser={tgUser} onTelegramLogin={handleTelegramLogin}/>
      </div></div>
    );
  }
  if(stage === "setup"){
    return (
      <div className="device"><div className="device-screen" ref={deviceScreenRef} style={{ "--ds": String(ds) }}>
        <div className="island"/>
        <AccessibilitySetup onPick={applyProfile} t={t}/>
      </div></div>
    );
  }
  if(!account){
    return (
      <div className="device"><div className="device-screen" ref={deviceScreenRef} style={{ "--ds": String(ds) }}>
        <div className="island"/>
      </div></div>
    );
  }

  const screenTitle =
    view?.type === "article" ? pick(ARTICLES.find(a=>a.id===view.id)?.title, lang) :
    view?.type === "story" ? "Story" :
    view?.type === "resource" ? (LIBRARY.find(r=>r.id===view.id)?.title || "") :
    view?.type === "paths" ? t("tileHubTitle") :
    view?.type === "learn" ? t("tileHubTitle") :
    view?.type === "scan" ? t("scanTitle") :
    view?.type === "transcript" ? t("transcriptTitle") :
    view?.type === "compose" ? t("tileShareTitle") :
    view?.type === "insights" ? t("insightsTitle") :
    tab === "home" ? t("welcomeTitle") : tab === "library" ? t("libraryTitle") :
    tab === "stories" ? t("storiesTitle") : t("profileTitle");

  const screenHint =
    !view && tab === "home" ? t("exploreLabel") + ": " + [t("tileLibraryTitle"), t("tileHubTitle"), t("tileShareTitle"), t("tileCommunityTitle")].join(", ") :
    !view && tab === "library" ? t("searchPlaceholder") :
    !view && tab === "stories" ? t("storiesSubtitle") :
    !view && tab === "profile" ? t("accessibilityLabel") :
    "";

  const announceScreen = ()=> speakText(screenTitle + (screenHint ? ". " + screenHint : ""));

  const tabOrder = ["home","library","stories","profile"];
  const tabs = [
    ["home", t("navHome"), I.home],
    ["library", t("navLibrary"), I.library],
    ["stories", t("navStories"), I.stories],
    ["profile", t("navProfile"), I.profile]
  ];
  const switchTab = (dir)=>{
    const i = tabOrder.indexOf(tab);
    const next = tabOrder[Math.min(tabOrder.length - 1, Math.max(0, i + dir))];
    if(next !== tab){ if(hapticsOn) vibrate(10); setTab(next); }
  };
  const touchRef = useRef({ x:0, y:0 });
  const onTabTouchStart = (e)=>{ const t0=e.touches[0]; touchRef.current = { x:t0.clientX, y:t0.clientY }; };
  const onTabTouchEnd = (e)=>{
    const t0 = e.changedTouches[0];
    const dx = t0.clientX - touchRef.current.x;
    const dy = t0.clientY - touchRef.current.y;
    if(Math.abs(dx) > 70 && Math.abs(dy) < 60) switchTab(dx < 0 ? 1 : -1);
  };

  let body;
  if(view){
    const back = ()=>setView(null);
    if(view.type==="article") body = <ArticleView id={view.id} onBack={back} go={go} t={t} lang={lang} onReport={submitReport}/>;
    else if(view.type==="story") body = <StoryView id={view.id} onBack={back} liked={account.liked} toggleLike={toggleLike} myStories={account.myStories} t={t} lang={lang} onReport={submitReport}/>;
    else if(view.type==="resource") body = <ResourceView id={view.id} onBack={back} saved={account.saved} toggleSave={toggleSave} notify={notify} t={t} onReport={submitReport}/>;
    else if(view.type==="paths") body = <PathsView onBack={back} progress={account.progress} setProgress={setProgress} notify={notify}/>;
    else if(view.type==="learn") body = <LearnUpload onBack={back} onApply={handleLearnApply} onBrowsePaths={()=>setView({ type:"paths" })}
                                                       onOpenScan={()=>setView({ type:"scan" })} onOpenTranscript={()=>setView({ type:"transcript" })} t={t}/>;
    else if(view.type==="scan") body = <ScanText onBack={back} t={t} lang={lang} notify={notify}/>;
    else if(view.type==="transcript") body = <LiveTranscript onBack={back} t={t} lang={lang} notify={notify}/>;
    else if(view.type==="compose") body = <Compose onBack={back} onSubmit={publish} t={t}/>;
    else if(view.type==="insights") body = <InsightsView onBack={back} accounts={accounts} reports={reports} t={t}/>;
  } else if(tab==="home") body = <Home go={go} t={t} lang={lang} greeting={greeting} simplified={simplified}/>;
  else if(tab==="library") body = <Library go={go} saved={account.saved} toggleSave={toggleSave} t={t} lang={lang}/>;
  else if(tab==="stories") body = <Stories go={go} liked={account.liked} toggleLike={toggleLike} myStories={account.myStories} t={t} lang={lang}/>;
  else body = <Profile account={account} set={(u)=>updateAccount(session.email, u)} saved={account.saved} myStories={account.myStories} go={go} notify={notify}
                        onRerunSetup={()=>setStage("setup")} t={t} onLogout={logout}
                        onChangeLang={(code)=>updateAccount(session.email, p=>({ ...p, lang:code }))}
                        onReset={handleReset} onOpenInsights={()=>go({ view:{ type:"insights" } })}/>;

  return (
    <div className="device">
      <div className="device-screen" ref={deviceScreenRef} style={{ "--ds": String(ds) }}>
        <div className="island"/>
        <div className="screen" style={screenStyle}
             data-contrast={s.contrast ? "on" : "off"}
             data-motion={s.motion ? "on" : "off"}
             data-dark={s.darkMode ? "on" : "off"}
             data-readable={s.readableFont ? "on" : "off"}>
          <StatusBar dark={s.darkMode}/>
          <div className="sr-only" aria-live="polite">{screenTitle}</div>
          <div ref={scrollRef} className="body-wrap" key={view ? view.type + (view.id||"") : tab}
               onTouchStart={!view ? onTabTouchStart : undefined}
               onTouchEnd={!view ? onTabTouchEnd : undefined}>
            {body}
          </div>
          {toast ? <Toast text={toast}/> : null}
          {voiceGuide ? <VoiceFab onPress={announceScreen} hasTabbar={!view}/> : null}
          {!view && (
            <nav className="tabbar">
              {tabs.map(([id,label,Icon])=>(
                <button key={id} className={"tab" + (tab===id ? " active" : "")}
                        onClick={()=>{ if(voiceGuide) speakText(label); if(hapticsOn) vibrate(10); setTab(id); setView(null); }}
                        aria-current={tab===id ? "page" : undefined}>
                  <Icon/><span>{label}</span>
                </button>
              ))}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;