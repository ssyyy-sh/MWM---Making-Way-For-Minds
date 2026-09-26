import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import "./App.css";

// Shared community stories, real cross-device sync via Supabase (free tier).
// Empty by default — the app works entirely offline/local until these are filled in.
// See /supabase-setup/README.md for the exact setup steps.
const SUPABASE_URL = "https://kxfwcgfnwffxeabksgfq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_q8X3jHb2KS-eTQ6jEnpf3g_DzeV3uBp";
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY) ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

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

// Minimal usage log: fire-and-forget message to a Cloudflare Worker, which relays
// it into a Telegram chat via the Bot API. See /telegram-log-worker/README.md.
// Empty by default — nothing is sent anywhere until this is filled in.
const LOG_WORKER_URL = "";
function logToTelegram(user, event){
  if(!LOG_WORKER_URL || !user) return;
  try{
    fetch(LOG_WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, event })
    }).catch(()=>{});
  }catch(e){}
}

function makeAccount({ name, email, lang }){
  return {
    name, email, lang: lang || "ru",
    onboarded: false, profile: null,
    saved: [], liked: [], myStories: [], myRatings: {},
    progress: { p1: 0, p2: 0, p3: 0, p4: 0 },
    settings: { textSize: 1, contrast: false, motion: true, captions: true, dyslexic: false, voiceGuide: false, darkMode: "off", readableFont: false, haptics: true, speechRate: 1, colorFilter: "none", showActivity: true, boldText: false },
    tourSeen: false,
    activityDates: [],
    lastViewed: null
  };
}
function normalizeDarkMode(v){
  if(v === true) return "on";
  if(v === false || v === undefined || v === null) return "off";
  return v;
}

const APP_BUGS_KEY = "mwm:appbugs:v1";
function loadAppBugs(){
  try{ const raw = localStorage.getItem(APP_BUGS_KEY); return raw ? JSON.parse(raw) : []; }catch(e){ return []; }
}
function saveAppBugs(list){ try{ localStorage.setItem(APP_BUGS_KEY, JSON.stringify(list.slice(-50))); }catch(e){} }
function addAppBug(entry){
  const list = loadAppBugs();
  list.push({ id:"bug" + Date.now(), at:new Date().toISOString(), ...entry });
  saveAppBugs(list);
}

function getCrashLang(){
  try{
    const sessRaw = localStorage.getItem(SESSION_KEY);
    const accRaw = localStorage.getItem(ACCOUNTS_KEY);
    if(sessRaw && accRaw){
      const sess = JSON.parse(sessRaw);
      const accs = JSON.parse(accRaw);
      const acc = accs[sess.email];
      if(acc && acc.lang) return acc.lang;
    }
    const uiLang = localStorage.getItem(LANG_KEY);
    if(uiLang) return uiLang;
  }catch(e){}
  return "ru";
}
const CRASH_TEXT = {
  ru: { title:"Что-то сломалось", body:"Произошла непредвиденная ошибка. Ваши данные — сохранённое, аккаунт, прогресс — не пострадали, они хранятся отдельно от экрана, который сейчас упал.",
    reload:"Перезагрузить", report:"Отправить отчёт и перезагрузить", sent:"Отчёт сохранён локально" },
  uz: { title:"Nimadir buzildi", body:"Kutilmagan xatolik yuz berdi. Ma'lumotlaringiz — saqlanganlar, hisob, progress — buzilmagan, ular hozir qulagan ekrandan alohida saqlanadi.",
    reload:"Qayta yuklash", report:"Xabar yuborish va qayta yuklash", sent:"Xabar lokal saqlandi" },
  en: { title:"Something broke", body:"An unexpected error happened. Your data — saved items, account, progress — is safe, it's stored separately from the screen that just crashed.",
    reload:"Reload", report:"Send report and reload", sent:"Report saved locally" }
};
function CrashScreen({ error, onReload, onReport }){
  const lang = getCrashLang();
  const tx = CRASH_TEXT[lang] || CRASH_TEXT.ru;
  const [sent, setSent] = useState(false);
  return (
    <div style={{
      position:"fixed", inset:0, background:"#F7F4EA", color:"#16243F",
      display:"flex", alignItems:"center", justifyContent:"center", padding:28, fontFamily:"Inter,sans-serif", zIndex:9999
    }}>
      <div style={{ maxWidth:360, textAlign:"center" }}>
        <div style={{ fontSize:38, marginBottom:14 }}>⚠️</div>
        <h1 style={{ fontFamily:"Georgia,serif", fontSize:22, margin:0 }}>{tx.title}</h1>
        <p style={{ fontSize:14, lineHeight:1.6, color:"#3A465E", marginTop:12 }}>{tx.body}</p>
        <button onClick={onReload} style={{
          width:"100%", marginTop:20, background:"#16243F", color:"#F7F4EA", border:0,
          borderRadius:999, padding:16, fontSize:15, fontWeight:600, cursor:"pointer"
        }}>{tx.reload}</button>
        {!sent ? (
          <button onClick={()=>{ onReport(error); setSent(true); }} style={{
            width:"100%", marginTop:10, background:"none", color:"#3A465E", border:"1px solid rgba(22,36,63,.25)",
            borderRadius:999, padding:14, fontSize:13, fontWeight:600, cursor:"pointer"
          }}>{tx.report}</button>
        ) : (
          <p style={{ fontSize:12, color:"#4E7031", marginTop:12 }}>{tx.sent}</p>
        )}
      </div>
    </div>
  );
}
class ErrorBoundary extends React.Component {
  constructor(props){
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error){
    return { error };
  }
  componentDidCatch(error, info){
    try{ console.error("MWM crash:", error, info); }catch(e){}
  }
  render(){
    if(this.state.error){
      return (
        <CrashScreen
          error={this.state.error}
          onReload={()=>{ try{ window.location.reload(); }catch(e){} }}
          onReport={(error)=>{
            addAppBug({ source:"crash", message: String(error && error.message || error), stack: (error && error.stack || "").slice(0,2000) });
          }}
        />
      );
    }
    return this.props.children;
  }
}

async function fetchSharedStories(){
  if(!supabase) return [];
  try{
    // owner_token is deliberately excluded here — it must never be readable by
    // anyone but the author's own browser, since it's what authorizes deletion.
    const { data, error } = await supabase
      .from("stories")
      .select("id,title,author,country,body,lang,likes,created_at")
      .order("created_at", { ascending:false })
      .limit(200);
    if(error){
      try{ console.error("MWM: fetchSharedStories failed:", error); }catch(e){}
      return [];
    }
    if(!data) return [];
    return data.map(row=>({
      id: row.id,
      title: row.title,
      author: row.author,
      country: row.country || "—",
      ago: timeAgo(row.created_at),
      likes: row.likes || 0,
      format: "write",
      body: Array.isArray(row.body) ? row.body : String(row.body || "").split("\n\n").filter(Boolean),
      shared: true
    }));
  }catch(e){ return []; }
}
function makeOwnerToken(){
  try{
    if(typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  }catch(e){}
  return "t" + Date.now() + Math.random().toString(36).slice(2);
}
async function publishSharedStory(story, lang, ownerToken){
  if(!supabase) return { ok:false, reason:"not-configured" };
  try{
    const { error } = await supabase.from("stories").insert({
      id: story.id,
      title: story.title,
      author: story.author,
      country: story.country,
      body: story.body,
      lang: lang || "ru",
      owner_token: ownerToken
    });
    if(error){
      try{ console.error("MWM: publishSharedStory failed:", error); }catch(e){}
      try{ addAppBug({ source:"sync", message:"publish failed: " + (error.message || JSON.stringify(error)) }); }catch(e){}
      return { ok:false, reason:error.message || String(error) };
    }
    return { ok:true };
  }catch(e){
    try{ console.error("MWM: publishSharedStory threw:", e); }catch(e2){}
    try{ addAppBug({ source:"sync", message:"publish threw: " + String(e && e.message || e) }); }catch(e2){}
    return { ok:false, reason:String(e) };
  }
}
async function deleteSharedStory(id, ownerToken){
  if(!supabase || !ownerToken) return { ok:false };
  try{
    const { error } = await supabase.from("stories").delete().eq("id", id).eq("owner_token", ownerToken);
    if(error){
      try{ console.error("MWM: deleteSharedStory failed:", error); }catch(e){}
      return { ok:false, reason:error.message };
    }
    return { ok:true };
  }catch(e){
    return { ok:false, reason:String(e) };
  }
}
function timeAgo(iso){
  try{
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if(mins < 1) return "just now";
    if(mins < 60) return mins + "m ago";
    const hrs = Math.floor(mins / 60);
    if(hrs < 24) return hrs + "h ago";
    return Math.floor(hrs / 24) + "d ago";
  }catch(e){ return ""; }
}

const RATINGS_KEY = "mwm:ratings:v1";
function loadRatings(){
  try{ const raw = localStorage.getItem(RATINGS_KEY); return raw ? JSON.parse(raw) : {}; }catch(e){ return {}; }
}
function saveRatings(r){ try{ localStorage.setItem(RATINGS_KEY, JSON.stringify(r)); }catch(e){} }

function logActivityDate(dates){
  const key = new Date().toISOString().slice(0, 10);
  const list = (dates || []).includes(key) ? (dates || []) : [...(dates || []), key];
  return list.slice(-60);
}
function computeStreak(dates){
  const set = new Set(dates || []);
  let streak = 0;
  const d = new Date();
  while(true){
    const key = d.toISOString().slice(0, 10);
    if(set.has(key)){ streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}
function computeWeekCount(dates){
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 6);
  return (dates || []).filter(k => new Date(k) >= cutoff).length;
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
    splashVoiceIntro: "Приложение MWM — Делаем путь для разума. Внизу экрана — кнопка «Начать». Нажмите на неё, чтобы перейти к регистрации.",

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
    authVoiceIntro: "Экран регистрации. Вверху — вход через Телеграм, если доступен. Ниже — поля: имя, email и пароль, и кнопка «Регистрация» снизу. Есть также вкладка «Вход» для тех, у кого уже есть аккаунт, и ссылка «Продолжить без регистрации». Чтобы услышать это снова, нажмите на круглую кнопку с динамиком внизу экрана.",
    replayAudioLabel: "Озвучить экран ещё раз",
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
    setupVoiceIntro: "Экран настройки. Выберите, каким должен быть интерфейс: слабовидящим — крупный текст и контраст; незрячим — одна кнопка озвучивает экран; слабослышащим — субтитры; или обычный вид. Нажмите на вариант, чтобы услышать его название, затем — «Продолжить» внизу.",
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
    tileHubTitle: "Учебный центр", tileHubSub: "Обучающие маршруты",
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
    sizeStandard: "Обычный", sizeLarge: "Крупный", sizeLargest: "Очень крупный", sizeHuge: "Огромный",
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
    resetProgressTitle: "Сбросить прогресс обучения",
    resetProgressSub: "Обнулит проценты по всем маршрутам, остальное не тронет",
    resetProgressDone: "Прогресс обучения сброшен",

    ratingHelpful: "Полезно", ratingNotHelpful: "Не очень",

    darkModeOff: "Светлая", darkModeOn: "Тёмная", darkModeSystem: "Как в системе",

    aboutRow: "О приложении",
    aboutTitle: "О приложении",
    aboutIntro: "MWM — исследовательский проект о доступности образования. Мы собираем истории, интервью и данные, чтобы понять, какие барьеры мешают учиться, и делимся материалами бесплатно.",
    aboutFeaturesLabel: "Что умеет приложение",
    aboutFeatureVoice: "Голосовые подсказки: одна кнопка озвучивает весь экран",
    aboutFeatureScan: "Съёмка текста камерой с распознаванием прямо в браузере",
    aboutFeatureTranscript: "Живая расшифровка речи в текст",
    aboutFeatureOffline: "Материалы библиотеки доступны офлайн после первого захода",
    aboutFeatureLangs: "Интерфейс на русском, o'zbekcha и English",
    aboutVersionLabel: "Версия",
    aboutFooter: "Исследования · Инклюзия · Равенство",
    resetTitle: "Сбросить данные",
    resetSub: "Удалит сохранённое, лайки и ваши истории",
    logoutTitle: "Выйти из аккаунта",
    logoutSub: "Вернуться к экрану входа",
    footerTag: "Исследования · Инклюзия · Равенство",
    itemsWord: "элементов",

    savedAdded: "Сохранено в библиотеке", savedRemoved: "Убрано из сохранённого",
    likeAdded: "Понравилось", likeRemoved: "Лайк убран",
    storyPublished: "История опубликована",
    storySyncFailedToast: "Сохранена у вас, но не отправилась в общую ленту — проверьте интернет",
    lessonDone: "Урок отмечен пройденным", pathwayDone: "Маршрут завершён",
    resetDone: "Данные сброшены",
    profileApplied: "Интерфейс подстроен под вас", profileAppliedPlain: "Готово",

    darkModeTitle: "Тёмная тема", darkModeSub: "Тёмный фон вместо светлого",
    readableFontTitle: "Читаемый шрифт", readableFontSub: "Шрифт Atkinson Hyperlegible для слабого зрения",
    hapticsTitle: "Вибрация при нажатиях", hapticsSub: "Лёгкий отклик на кнопки и уведомления",
    colorFilterLabel: "Симуляция цветовосприятия",
    colorFilterSub: "Не для коррекции — показывает, как экран выглядит при разных типах дальтонизма (для исследователей и близких)",
    colorFilterNone: "Обычное", colorFilterProtan: "Протанопия", colorFilterDeutan: "Дейтеранопия", colorFilterTritan: "Тританопия",
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
    scanLangLabel: "Язык текста на фото",
    scanLangHint: "Распознавание работает точнее, если выбрать язык, на котором написан текст — не обязательно язык интерфейса.",
    scanLangRu: "Русский", scanLangUk: "Українська", scanLangUz: "O'zbekcha", scanLangEn: "English",
    scanScreenTip: "Фото с бумаги или книги распознаётся лучше, чем фото экрана телефона или монитора — это общее ограничение любого распознавания текста.",
    scanLowConfidence: "Распознавание получилось ненадёжным — сам движок не уверен в результате. Попробуйте: более яркий свет, текст ближе и крупнее в кадре, без наклона, и проверьте, тот ли язык выбран выше.",
    scanShowAnyway: "Всё равно показать, что распозналось",

    transcriptTitle: "Живая расшифровка",
    transcriptSub: "Говорите — текст появится на экране. Хорошо подходит для лекций и уроков.",
    transcriptStart: "Начать расшифровку",
    transcriptStop: "Остановить",
    transcriptEmpty: "Здесь появится текст, как только начнёте говорить",
    transcriptUnsupported: "Этот браузер не поддерживает распознавание речи. Попробуйте Chrome или Edge.",
    transcriptClear: "Очистить",
    transcriptCopy: "Скопировать",
    transcriptCopied: "Расшифровка скопирована",

    pathHubSubtitle: "Четыре маршрута на основе исследований в классах. Каждый урок работает офлайн и с экранным диктором.",
    lessonsWord: "уроков", minWord: "мин", completeWord: "пройдено",
    pathStart: "Начать маршрут", pathReview: "Повторить маршрут",
    a11yLabel: "Доступность",
    a11yScreenReader: "Проверено с экранным диктором", a11yAltText: "Alt-текст у всех изображений",
    a11yAdjustable: "Регулируемый размер текста", a11yTranscript: "Полная расшифровка", a11yLargePrint: "Издание крупным шрифтом",
    showTranscriptBtn: "Показать расшифровку", showAltTextBtn: "Показать описания изображений",

    boldTextTitle: "Жирный текст", boldTextSub: "Делает текст контрастнее без увеличения размера",
    continueWhereLabel: "Продолжить с места остановки",
    exportSavedBtn: "Выгрузить сохранённое в файл",
    quizTitle: "Мини-проверка", quizBtn: "Мини-проверка",
    quizDoneTitle: "Готово!", quizDoneBody: "Правильных ответов: {n} из {total}. Это не экзамен — просто закрепление пройденного.",
    quizNextBtn: "Следующий вопрос", quizFinishBtn: "Завершить",

    appBugRow: "Сообщить о проблеме в приложении", appBugRowSub: "Не про материал, а про само приложение",
    appBugTitle: "Проблема в приложении",
    appBugIntro: "Опишите, что пошло не так — что вы делали и что произошло вместо ожидаемого. Это не про содержимое материалов, а про работу самого приложения.",
    appBugFieldLabel: "Что случилось", appBugPlaceholder: "Например: нажал «Выйти из аккаунта», и экран завис…",
    appBugSubmitBtn: "Отправить", appBugSentToast: "Спасибо, отчёт сохранён",
    appBugsListLabel: "Отчёты о проблемах приложения",
    appBugSourceCrash: "Автоматически при сбое", appBugSourceUser: "От пользователя", appBugSourceSync: "Сбой синхронизации",

    deleteStoryBtn: "Удалить эту историю",
    deleteStoryConfirm: "Удалить историю без возможности восстановить?",
    deleteStoryYes: "Да, удалить", deleteStoryCancel: "Отмена",
    storyDeletedToast: "История удалена",
    removeSavedBtn: "Убрать из сохранённого", saveForLaterBtn: "Сохранить на потом",
    readRelatedBtn: "Похожие материалы",
    storyLabel: "История",
    kindResearch: "Исследование", kindStory: "История", kindInterview: "Интервью",
    charsMinWord: "символов · минимум 30",
    publishStoryBtn: "Опубликовать историю",
    globalSearchTitle: "Поиск по всему приложению", globalSearchPlaceholder: "Ищите в библиотеке, историях, статьях",
    globalSearchHint: "Начните вводить — поиск идёт сразу по библиотеке, историям и статьям.",
    tourSkip: "Пропустить", tourNext: "Далее", tourDone: "Понятно, начать",
    tour1Title: "Добро пожаловать в MWM", tour1Body: "Быстрый тур — 5 шагов, займёт меньше минуты. Можно пропустить в любой момент.",
    tour2Title: "Главный экран", tour2Body: "Отсюда — библиотека, обучение, ваши истории и голоса сообщества. Всё в четырёх плитках.",
    tour3Title: "Библиотека", tour3Body: "Материалы с тегами доступности: аудио, крупный текст, брайль. У каждого — свой текст и озвучка.",
    tour4Title: "Голосовые подсказки", tour4Body: "Если включите в профиле — появится одна большая кнопка, которая озвучивает весь экран.",
    tour5Title: "Профиль — всё настраивается", tour5Body: "Размер текста, скорость речи, контраст, язык — всё меняется в профиле в любой момент.",
    insightsReportsList: "Тексты жалоб",
    insightsExportCsv: "Выгрузить в CSV",
    insightsNoReports: "Пока нет ни одной жалобы",
    lessonWord: "Урок", markDoneBtn: "Отметить пройденным",

    certificateTitle: "Сертификат", certificateBtn: "Посмотреть сертификат",
    certificateHeading: "Сертификат о прохождении",
    certificateCompletedText: "успешно завершил(а) маршрут",
    certificateDatePrefix: "Дата завершения",
    certificateDownload: "Скачать",
    certificateFooter: "MWM — Making Way for Minds",

    switchAccountTitle: "Сменить аккаунт", switchAccountRow: "Сменить аккаунт",
    switchAccountSub: "Другие аккаунты на этом устройстве",
    switchAccountAddNew: "Добавить другой аккаунт",
    switchAccountCurrent: "Текущий",

    activityLabel: "Активность",
    activityStreakSuffix: "дней подряд",
    activityWeekSuffix: "активных дней за неделю",
    activityToggleTitle: "Показывать активность", activityToggleSub: "Дни подряд и активность за неделю в профиле",
    activityNoneYet: "Пока нет активности — пройдите урок или опубликуйте историю"
  },
  uz: {
    appTagline: "ONGGA YO'L OCHAMIZ",
    splashQuote: "“Har bir ong bilimga ega bo'lishga loyiq”",
    splashCta: "Boshlash",
    splashFooter: "Tadqiqot · Inklyuziya · Tenglik",
    splashVoiceIntro: "MWM ilovasi — Ongga yo'l ochamiz. Ekran pastida «Boshlash» tugmasi bor. Ro'yxatdan o'tishga o'tish uchun uni bosing.",

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
    authVoiceIntro: "Ro'yxatdan o'tish ekrani. Yuqorida — agar mavjud bo'lsa, Telegram orqali kirish. Pastda — ism, email va parol maydonlari, va pastda «Ro'yxatdan o'tish» tugmasi. Shuningdek, hisobi bor foydalanuvchilar uchun «Kirish» bo'limi va «Ro'yxatdan o'tmasdan davom etish» havolasi bor. Buni qayta eshitish uchun ekran pastidagi dumaloq karnay tugmasini bosing.",
    replayAudioLabel: "Ekranni qayta ovozli o'qish",
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
    setupVoiceIntro: "Sozlash ekrani. Interfeys qanday bo'lishini tanlang: kam ko'ruvchilar uchun — katta matn va kontrast; ko'rmaydiganlar uchun — bitta tugma ekranni ovoz bilan o'qiydi; eshitishda qiyinchiligi borlar uchun — subtitrlar; yoki oddiy ko'rinish. Nomini eshitish uchun variantga bosing, so'ng pastdagi «Davom etish» tugmasini bosing.",
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
    tileHubTitle: "Ta'lim markazi", tileHubSub: "Ta'lim yo'nalishlari",
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
    sizeStandard: "Oddiy", sizeLarge: "Katta", sizeLargest: "Juda katta", sizeHuge: "Ulkan",
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
    resetProgressTitle: "O'quv jarayonini tozalash",
    resetProgressSub: "Barcha yo'nalishlar foizini nolga tushiradi, qolganiga tegmaydi",
    resetProgressDone: "O'quv jarayoni tozalandi",

    ratingHelpful: "Foydali", ratingNotHelpful: "Unchalik emas",

    darkModeOff: "Yorug'", darkModeOn: "Tungi", darkModeSystem: "Tizim kabi",

    aboutRow: "Ilova haqida",
    aboutTitle: "Ilova haqida",
    aboutIntro: "MWM — ta'lim qulayligi haqidagi tadqiqot loyihasi. Biz o'rganishga to'sqinlik qiladigan to'siqlarni tushunish uchun hikoyalar, intervyular va ma'lumotlar to'playmiz va materiallarni bepul ulashamiz.",
    aboutFeaturesLabel: "Ilova nimalarni bila oladi",
    aboutFeatureVoice: "Ovozli yordam: bitta tugma butun ekranni ovoz bilan o'qiydi",
    aboutFeatureScan: "Kamera bilan matnni suratga olib, brauzerning o'zida tanish",
    aboutFeatureTranscript: "Nutqni jonli matnga aylantirish",
    aboutFeatureOffline: "Birinchi kirishdan keyin kutubxona materiallari oflayn ishlaydi",
    aboutFeatureLangs: "Interfeys ruscha, o'zbekcha va inglizcha",
    aboutVersionLabel: "Versiya",
    aboutFooter: "Tadqiqot · Inklyuziya · Tenglik",
    resetTitle: "Ma'lumotlarni tozalash",
    resetSub: "Saqlanganlar, layklar va hikoyalaringiz o'chadi",
    logoutTitle: "Hisobdan chiqish",
    logoutSub: "Kirish ekraniga qaytish",
    footerTag: "Tadqiqot · Inklyuziya · Tenglik",
    itemsWord: "ta",

    savedAdded: "Kutubxonaga saqlandi", savedRemoved: "Saqlanganlardan olib tashlandi",
    likeAdded: "Yoqdi", likeRemoved: "Layk olib tashlandi",
    storyPublished: "Hikoya nashr qilindi",
    storySyncFailedToast: "Sizda saqlandi, lekin umumiy lentaga yuborilmadi — internetni tekshiring",
    lessonDone: "Dars tugallangan deb belgilandi", pathwayDone: "Yo'nalish tugallandi",
    resetDone: "Ma'lumotlar tozalandi",
    profileApplied: "Interfeys siz uchun moslashtirildi", profileAppliedPlain: "Tayyor",

    darkModeTitle: "Tungi rejim", darkModeSub: "Yorug' fon o'rniga qorong'i fon",
    readableFontTitle: "O'qish uchun shrift", readableFontSub: "Zaif ko'rish uchun Atkinson Hyperlegible shrifti",
    hapticsTitle: "Bosganda tebranish", hapticsSub: "Tugmalar va bildirishnomalarda yengil tebranish",
    colorFilterLabel: "Rang idrokini simulyatsiya qilish",
    colorFilterSub: "Tuzatish uchun emas — turli xil rang ko'rish farqlarida ekran qanday ko'rinishini ko'rsatadi (tadqiqotchilar va yaqinlar uchun)",
    colorFilterNone: "Oddiy", colorFilterProtan: "Protanopiya", colorFilterDeutan: "Deyteranopiya", colorFilterTritan: "Tritanopiya",
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
    scanLangLabel: "Suratdagi matn tili",
    scanLangHint: "Matn qaysi tilda yozilgan bo'lsa, o'sha tilni tanlasangiz, tanish aniqroq bo'ladi — bu interfeys tili bilan bir xil bo'lishi shart emas.",
    scanLangRu: "Ruscha", scanLangUk: "Ukraincha", scanLangUz: "O'zbekcha", scanLangEn: "Inglizcha",
    scanScreenTip: "Qog'oz yoki kitobdan olingan surat telefon yoki monitor ekranidan olingan suratdan yaxshiroq tanib olinadi — bu har qanday matn tanish texnologiyasining umumiy cheklovi.",
    scanLowConfidence: "Tanish ishonchli chiqmadi — dvigatelning o'zi natijaga ishonchi yo'q. Sinab ko'ring: yorqinroq yorug'lik, matnni kadrga yaqinroq va kattaroq joylashtiring, egmasdan, va yuqorida to'g'ri til tanlanganini tekshiring.",
    scanShowAnyway: "Baribir nima tanilganini ko'rsatish",

    transcriptTitle: "Jonli transkripsiya",
    transcriptSub: "Gapiring — matn ekranda paydo bo'ladi. Ma'ruza va darslar uchun qulay.",
    transcriptStart: "Yozib olishni boshlash",
    transcriptStop: "To'xtatish",
    transcriptEmpty: "Gapira boshlaganingizda shu yerda matn paydo bo'ladi",
    transcriptUnsupported: "Bu brauzer nutqni tanishni qo'llab-quvvatlamaydi. Chrome yoki Edge'ni sinab ko'ring.",
    transcriptClear: "Tozalash",
    transcriptCopy: "Nusxalash",
    transcriptCopied: "Transkripsiya nusxalandi",

    pathHubSubtitle: "Sinfdagi tadqiqotlar asosidagi to'rtta yo'nalish. Har bir dars oflayn va ekran diktori bilan ishlaydi.",
    lessonsWord: "dars", minWord: "daqiqa", completeWord: "bajarildi",
    pathStart: "Yo'nalishni boshlash", pathReview: "Yo'nalishni qayta ko'rish",
    a11yLabel: "Qulaylik",
    a11yScreenReader: "Ekran diktori bilan sinovdan o'tgan", a11yAltText: "Barcha rasmlarda alt-matn",
    a11yAdjustable: "Sozlanadigan matn o'lchami", a11yTranscript: "To'liq transkripsiya", a11yLargePrint: "Katta shriftli nashr",
    showTranscriptBtn: "Transkripsiyani ko'rsatish", showAltTextBtn: "Rasm tavsiflarini ko'rsatish",

    boldTextTitle: "Qalin matn", boldTextSub: "O'lchamni oshirmasdan matnni kontrastliroq qiladi",
    continueWhereLabel: "To'xtagan joyingizdan davom eting",
    exportSavedBtn: "Saqlanganlarni faylga yuklab olish",
    quizTitle: "Qisqa tekshiruv", quizBtn: "Qisqa tekshiruv",
    quizDoneTitle: "Tayyor!", quizDoneBody: "To'g'ri javoblar: {total} tadan {n} ta. Bu imtihon emas — shunchaki mustahkamlash.",
    quizNextBtn: "Keyingi savol", quizFinishBtn: "Yakunlash",

    appBugRow: "Ilovadagi muammo haqida xabar berish", appBugRowSub: "Material haqida emas, ilovaning o'zi haqida",
    appBugTitle: "Ilovadagi muammo",
    appBugIntro: "Nima noto'g'ri ketganini tasvirlang — nima qilayotgan edingiz va kutilganidan boshqa nima sodir bo'ldi. Bu materiallar mazmuni haqida emas, ilovaning o'zi ishlashi haqida.",
    appBugFieldLabel: "Nima bo'ldi", appBugPlaceholder: "Masalan: «Hisobdan chiqish»ni bosdim, ekran muzlab qoldi…",
    appBugSubmitBtn: "Yuborish", appBugSentToast: "Rahmat, xabar saqlandi",
    appBugsListLabel: "Ilova muammolari haqidagi xabarlar",
    appBugSourceCrash: "Nosozlikda avtomatik", appBugSourceUser: "Foydalanuvchidan", appBugSourceSync: "Sinxronlashda xato",

    deleteStoryBtn: "Bu hikoyani o'chirish",
    deleteStoryConfirm: "Hikoyani qaytarib bo'lmaydigan tarzda o'chirasizmi?",
    deleteStoryYes: "Ha, o'chirish", deleteStoryCancel: "Bekor qilish",
    storyDeletedToast: "Hikoya o'chirildi",
    removeSavedBtn: "Saqlanganlardan olib tashlash", saveForLaterBtn: "Keyinroq uchun saqlash",
    readRelatedBtn: "O'xshash materiallar",
    storyLabel: "Hikoya",
    kindResearch: "Tadqiqot", kindStory: "Hikoya", kindInterview: "Intervyu",
    charsMinWord: "belgi · kamida 30",
    publishStoryBtn: "Hikoyani nashr qilish",
    globalSearchTitle: "Ilova bo'ylab qidirish", globalSearchPlaceholder: "Kutubxona, hikoyalar, maqolalardan qidiring",
    globalSearchHint: "Yoza boshlang — qidiruv kutubxona, hikoyalar va maqolalarda birdan boradi.",
    tourSkip: "O'tkazib yuborish", tourNext: "Keyingisi", tourDone: "Tushunarli, boshlash",
    tour1Title: "MWM ga xush kelibsiz", tour1Body: "Tezkor tur — 5 qadam, bir daqiqadan kam vaqt oladi. Istalgan paytda o'tkazib yuborish mumkin.",
    tour2Title: "Bosh sahifa", tour2Body: "Bu yerdan — kutubxona, ta'lim, hikoyalaringiz va jamoa ovozlari. Hammasi to'rtta blokda.",
    tour3Title: "Kutubxona", tour3Body: "Qulaylik teglari bilan materiallar: audio, katta matn, brayl. Har birida o'z matni va ovozi bor.",
    tour4Title: "Ovozli yordam", tour4Body: "Profilda yoqsangiz — butun ekranni ovoz bilan o'qiydigan bitta katta tugma paydo bo'ladi.",
    tour5Title: "Profil — hammasi sozlanadi", tour5Body: "Matn o'lchami, nutq tezligi, kontrast, til — hammasi istalgan payt profilda o'zgaradi.",
    insightsReportsList: "Xabarlar matni",
    insightsExportCsv: "CSV formatida yuklab olish",
    insightsNoReports: "Hali birorta ham xabar yo'q",
    lessonWord: "Dars", markDoneBtn: "Bajarildi deb belgilash",

    certificateTitle: "Sertifikat", certificateBtn: "Sertifikatni ko'rish",
    certificateHeading: "Bitirish sertifikati",
    certificateCompletedText: "yo'nalishni muvaffaqiyatli tugatdi",
    certificateDatePrefix: "Tugatilgan sana",
    certificateDownload: "Yuklab olish",
    certificateFooter: "MWM — Making Way for Minds",

    switchAccountTitle: "Hisobni almashtirish", switchAccountRow: "Hisobni almashtirish",
    switchAccountSub: "Shu qurilmadagi boshqa hisoblar",
    switchAccountAddNew: "Boshqa hisob qo'shish",
    switchAccountCurrent: "Joriy",

    activityLabel: "Faollik",
    activityStreakSuffix: "kun ketma-ket",
    activityWeekSuffix: "faol kun shu hafta",
    activityToggleTitle: "Faollikni ko'rsatish", activityToggleSub: "Profilda ketma-ket kunlar va haftalik faollik",
    activityNoneYet: "Hali faollik yo'q — dars o'ting yoki hikoya nashr qiling"
  },
  en: {
    appTagline: "MAKING WAY FOR MINDS",
    splashQuote: "“Every mind deserves access to learning.”",
    splashCta: "Get Started",
    splashFooter: "Research · Inclusion · Equity",
    splashVoiceIntro: "The MWM app — Making Way for Minds. There's a Get Started button at the bottom of the screen. Tap it to go to registration.",

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
    authVoiceIntro: "Registration screen. At the top, sign in with Telegram if available. Below are fields for name, email and password, with a Register button underneath. There's also a Login tab for people who already have an account, and a link to continue without an account. To hear this again, press the round speaker button at the bottom of the screen.",
    replayAudioLabel: "Read this screen aloud again",
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
    setupVoiceIntro: "Setup screen. Choose how the interface should work for you: low vision — large text and contrast; blind — one button reads the screen aloud; hard of hearing — captions; or the standard look. Tap an option to hear its name, then tap Continue at the bottom.",
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
    sizeStandard: "Standard", sizeLarge: "Large", sizeLargest: "Largest", sizeHuge: "Huge",
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
    resetProgressTitle: "Reset learning progress",
    resetProgressSub: "Zeroes every pathway's percentage, leaves everything else alone",
    resetProgressDone: "Learning progress reset",

    ratingHelpful: "Helpful", ratingNotHelpful: "Not helpful",

    darkModeOff: "Light", darkModeOn: "Dark", darkModeSystem: "Match system",

    aboutRow: "About",
    aboutTitle: "About",
    aboutIntro: "MWM is a research project on educational accessibility. We gather stories, interviews and data to understand what gets in the way of learning, and share materials for free.",
    aboutFeaturesLabel: "What this app can do",
    aboutFeatureVoice: "Voice guide: one button reads the whole screen aloud",
    aboutFeatureScan: "Camera text scan, recognized right in the browser",
    aboutFeatureTranscript: "Live speech-to-text transcription",
    aboutFeatureOffline: "Library materials work offline after the first visit",
    aboutFeatureLangs: "Interface in Russian, o'zbekcha and English",
    aboutVersionLabel: "Version",
    aboutFooter: "Research · Inclusion · Equity",
    resetTitle: "Reset app data",
    resetSub: "Clears saves, likes and your stories",
    logoutTitle: "Log out",
    logoutSub: "Return to the sign-in screen",
    footerTag: "Research · Inclusion · Equity",
    itemsWord: "items",

    savedAdded: "Saved to your library", savedRemoved: "Removed from saved",
    likeAdded: "Liked", likeRemoved: "Like removed",
    storyPublished: "Story published",
    storySyncFailedToast: "Saved on your device, but didn't reach the shared feed — check your connection",
    lessonDone: "Lesson marked done", pathwayDone: "Pathway finished",
    resetDone: "Everything reset",
    profileApplied: "Interface adjusted for you", profileAppliedPlain: "Done",

    darkModeTitle: "Dark mode", darkModeSub: "Dark background instead of light",
    readableFontTitle: "Readable font", readableFontSub: "Atkinson Hyperlegible, designed for low vision",
    hapticsTitle: "Vibrate on tap", hapticsSub: "A light buzz on buttons and notifications",
    colorFilterLabel: "Colour vision simulation",
    colorFilterSub: "Not a correction — shows how the screen looks under different colour vision differences (for researchers and family)",
    colorFilterNone: "Normal", colorFilterProtan: "Protanopia", colorFilterDeutan: "Deuteranopia", colorFilterTritan: "Tritanopia",
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
    scanLangLabel: "Language of the text in the photo",
    scanLangHint: "Recognition works better when you pick the language the text is actually written in — it doesn't have to match the interface language.",
    scanLangRu: "Russian", scanLangUk: "Ukrainian", scanLangUz: "Uzbek", scanLangEn: "English",
    scanScreenTip: "A photo of paper or a book is recognized better than a photo of a phone or monitor screen — that's a general limitation of any text recognition, not specific to this app.",
    scanLowConfidence: "The recognition came out unreliable — the engine itself isn't confident in the result. Try: brighter light, text closer and larger in the frame, no tilt, and check the language chip above matches the text.",
    scanShowAnyway: "Show what it recognized anyway",

    transcriptTitle: "Live Transcript",
    transcriptSub: "Speak — the text appears on screen. Good for lectures and lessons.",
    transcriptStart: "Start transcribing",
    transcriptStop: "Stop",
    transcriptEmpty: "Text will appear here once you start speaking",
    transcriptUnsupported: "This browser doesn't support speech recognition. Try Chrome or Edge.",
    transcriptClear: "Clear",
    transcriptCopy: "Copy",
    transcriptCopied: "Transcript copied",

    pathHubSubtitle: "Four pathways built from classroom research. Each lesson works offline and with a screen reader.",
    lessonsWord: "lessons", minWord: "min", completeWord: "complete",
    pathStart: "Start pathway", pathReview: "Review pathway",
    a11yLabel: "Accessibility",
    a11yScreenReader: "Screen-reader tested", a11yAltText: "Alt text on all images",
    a11yAdjustable: "Adjustable text size", a11yTranscript: "Full transcript", a11yLargePrint: "Large-print edition",
    showTranscriptBtn: "Show transcript", showAltTextBtn: "Show image descriptions",

    boldTextTitle: "Bold text", boldTextSub: "Makes text bolder without increasing its size",
    continueWhereLabel: "Continue where you left off",
    exportSavedBtn: "Export saved items to a file",
    quizTitle: "Quick check-in", quizBtn: "Quick check-in",
    quizDoneTitle: "Done!", quizDoneBody: "Correct answers: {n} out of {total}. This isn't an exam — just reinforcing what you covered.",
    quizNextBtn: "Next question", quizFinishBtn: "Finish",

    appBugRow: "Report an app problem", appBugRowSub: "Not about content — about the app itself",
    appBugTitle: "App problem",
    appBugIntro: "Describe what went wrong — what you were doing and what happened instead of what you expected. This is about how the app itself behaves, not about the content of any material.",
    appBugFieldLabel: "What happened", appBugPlaceholder: "For example: tapped \"Log out\" and the screen froze…",
    appBugSubmitBtn: "Send", appBugSentToast: "Thanks, the report was saved",
    appBugsListLabel: "App problem reports",
    appBugSourceCrash: "Automatic, on crash", appBugSourceUser: "From a user", appBugSourceSync: "Sync failure",

    deleteStoryBtn: "Delete this story",
    deleteStoryConfirm: "Delete this story permanently?",
    deleteStoryYes: "Yes, delete", deleteStoryCancel: "Cancel",
    storyDeletedToast: "Story deleted",
    removeSavedBtn: "Remove from saved", saveForLaterBtn: "Save for later",
    readRelatedBtn: "Read related resources",
    storyLabel: "Story",
    kindResearch: "Research", kindStory: "Story", kindInterview: "Interview",
    charsMinWord: "characters · min 30",
    publishStoryBtn: "Publish story",
    globalSearchTitle: "Search everything", globalSearchPlaceholder: "Search library, stories, articles",
    globalSearchHint: "Start typing — search covers the library, stories and articles at once.",
    tourSkip: "Skip", tourNext: "Next", tourDone: "Got it, let's start",
    tour1Title: "Welcome to MWM", tour1Body: "A quick tour — 5 steps, under a minute. Skip anytime.",
    tour2Title: "Home screen", tour2Body: "From here: the library, learning, your stories, and community voices — all in four tiles.",
    tour3Title: "Library", tour3Body: "Resources tagged for accessibility: audio, large text, braille. Each one has its own text and narration.",
    tour4Title: "Voice guide", tour4Body: "Turn it on in your profile and one big button appears that reads the whole screen aloud.",
    tour5Title: "Profile — everything is adjustable", tour5Body: "Text size, speech speed, contrast, language — all changeable anytime in your profile.",
    insightsReportsList: "Report texts",
    insightsExportCsv: "Export as CSV",
    insightsNoReports: "No reports yet",
    lessonWord: "Lesson", markDoneBtn: "Mark as done",

    certificateTitle: "Certificate", certificateBtn: "View certificate",
    certificateHeading: "Certificate of Completion",
    certificateCompletedText: "has successfully completed the pathway",
    certificateDatePrefix: "Completed on",
    certificateDownload: "Download",
    certificateFooter: "MWM — Making Way for Minds",

    switchAccountTitle: "Switch account", switchAccountRow: "Switch account",
    switchAccountSub: "Other accounts on this device",
    switchAccountAddNew: "Add another account",
    switchAccountCurrent: "Current",

    activityLabel: "Activity",
    activityStreakSuffix: "day streak",
    activityWeekSuffix: "active days this week",
    activityToggleTitle: "Show activity", activityToggleSub: "Streak and weekly activity in your profile",
    activityNoneYet: "No activity yet — finish a lesson or publish a story"
  }
};
function tFor(lang, key){
  return (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.ru[key] || key;
}

/* ============ content ============ */
function pick(field, lang){
  if(field && typeof field === "object" && !Array.isArray(field)){
    return field[lang] || field.en || field.ru || Object.values(field)[0];
  }
  return field;
}

const LIBRARY = [
  { id:"l1", author:"R. Okonkwo", format:"Book", category:"Book", tags:["Text","Braille"], hasAudio:false, hasRead:true, emoji:"📗", year:2024,
    title:{ en:"Teaching Every Reader", ru:"Учим каждого читателя", uz:"Har bir o'quvchini o'rgatish" },
    meta:{ en:"Excerpt from a 312-page guide · ~1 min read", ru:"Отрывок из руководства на 312 страниц · ~1 мин на чтение", uz:"312 sahifali qo'llanmadan parcha · ~1 daqiqalik o'qish" },
    content:{
      en:["Reading aloud works when it's a choice, not a requirement. This guide collects turn-taking methods that let a student opt into reading aloud on their own terms.",
        "Pair reading with a peer removes the spotlight while keeping the practice — both readers follow the same line, switching every paragraph.",
        "A five-minute daily check-in — \"What's one word that tripped you up today?\" — turns mistakes into data instead of embarrassment."],
      ru:["Чтение вслух работает, когда это выбор, а не обязанность. В руководстве собраны способы поочерёдного чтения, которые позволяют ученику решать самому, читать вслух или нет.",
        "Чтение в паре с одноклассником снимает напряжение, сохраняя саму практику — оба читают одну и ту же строку, меняясь местами каждый абзац.",
        "Пятиминутный ежедневный вопрос — «Какое слово сегодня застало вас врасплох?» — превращает ошибки в данные, а не в повод для стыда."],
      uz:["Ovoz chiqarib o'qish majburiyat emas, tanlov bo'lganda ishlaydi. Bu qo'llanmada o'quvchiga o'zi hal qilish imkonini beradigan navbat bilan o'qish usullari to'plangan.",
        "Sinfdoshi bilan juftlikda o'qish e'tiborni kamaytiradi, amaliyotni saqlab qoladi — ikkala o'quvchi ham bir xil qatorni o'qiydi, har abzatsda almashadi.",
        "Kunlik besh daqiqalik savol — \"Bugun qaysi so'z sizni to'xtatib qo'ydi?\" — xatolarni uyalish o'rniga ma'lumotga aylantiradi."]
    } },
  { id:"l2", author:"Narrated by M. Duarte", format:"Audio", category:"Hearing", tags:["Audio","Transcript"], hasAudio:true, hasRead:true, emoji:"🎧", year:2025,
    title:{ en:"Sound of a Classroom", ru:"Звук класса", uz:"Sinfning ovozi" },
    meta:{ en:"Excerpt from a 4 h 12 min recording · ~1 min listen", ru:"Отрывок из записи на 4 ч 12 мин · ~1 мин прослушивания", uz:"4 soat 12 daqiqalik yozuvdan parcha · ~1 daqiqalik tinglash" },
    content:{
      en:["A school bell rings, and children's voices overlap in a corridor. This is Room 4B, nine in the morning, on an ordinary Tuesday.",
        "A teacher reads instructions slowly, pausing after each sentence. Notice how the room goes quiet before every new activity — that pause is not empty, it's a signal.",
        "Recorded over one full term, this piece lets you hear what an accessible classroom actually sounds like, pacing and all."],
      ru:["Звенит школьный звонок, в коридоре смешиваются детские голоса. Это кабинет 4B, девять утра, обычный вторник.",
        "Учитель медленно читает инструкции, делая паузу после каждого предложения. Обратите внимание, как в классе становится тихо перед каждым новым заданием — эта пауза не пустая, это сигнал.",
        "Запись сделана за целую четверть — она позволяет услышать, как на самом деле звучит доступный класс, вместе со всем его темпом."],
      uz:["Maktab qo'ng'irog'i chalinadi, yo'lakda bolalar ovozi aralashadi. Bu 4B xona, ertalab soat to'qqiz, oddiy seshanba kuni.",
        "O'qituvchi ko'rsatmalarni sekin, har jumladan keyin pauza qilib o'qiydi. Har yangi mashg'ulotdan oldin sinf qanday jim bo'lishiga e'tibor bering — bu pauza bo'sh emas, bu signal.",
        "Butun chorak davomida yozilgan bu parcha qulay sinf haqiqatda qanday eshitilishini, barcha sur'ati bilan, eshitish imkonini beradi."]
    },
    transcript:["[0:00] A school bell rings. Children's voices overlap in a corridor.",
      "[0:42] Narrator: \"This is Room 4B, nine in the morning, on an ordinary Tuesday.\"",
      "[1:15] A teacher reads instructions slowly, pausing after each sentence.",
      "[2:03] Narrator: \"Notice how the room goes quiet before every new activity — that pause is not empty, it's a signal.\""] },
  { id:"l3", author:"MWM Research", format:"Visual", category:"Visual", tags:["Visual","Alt Text"], hasAudio:false, hasRead:true, emoji:"🎨", year:2025,
    title:{ en:"Colour Contrast Field Guide", ru:"Полевой справочник по цветовому контрасту", uz:"Rang kontrasti bo'yicha qo'llanma" },
    meta:{ en:"3 of 48 plates shown · ~1 min read", ru:"Показаны 3 из 48 иллюстраций · ~1 мин на чтение", uz:"48 tasidan 3 tasi ko'rsatilgan · ~1 daqiqalik o'qish" },
    content:{
      en:["Forty-eight side-by-side comparisons of classroom materials — one version as usually printed, one adjusted for contrast.",
        "A wall painted dark navy behind a whiteboard cuts glare noticeably. A worksheet in near-black-on-cream reads faster than grey-on-white for almost every tester.",
        "Every plate includes the exact contrast ratio used, so a teacher can match it without guesswork."],
      ru:["Сорок восемь сравнений «до и после» учебных материалов — обычная версия и версия с усиленным контрастом рядом.",
        "Стена, окрашенная в тёмно-синий за доской, заметно снижает блики. Рабочий лист в почти-чёрном на кремовом читается быстрее, чем серый на белом — почти у всех тестировавших.",
        "У каждой иллюстрации указано точное соотношение контраста, чтобы учитель мог повторить его без догадок."],
      uz:["O'quv materiallarining qirq sakkizta \"oldin va keyin\" taqqoslashi — odatdagi versiya va kontrast oshirilgan versiya yonma-yon.",
        "Doska ortidagi to'q ko'k devor yaltirashni sezilarli darajada kamaytiradi. Deyarli qora-kremli varaq deyarli barcha sinovchilar uchun kulrang-oqdan tezroq o'qiladi.",
        "Har bir rasmda aniq kontrast nisbati ko'rsatilgan, shunda o'qituvchi uni taxmin qilmasdan takrorlashi mumkin."]
    },
    altTexts:["Plate 3: a classroom wall painted dark navy behind a whiteboard, cutting glare noticeably.",
      "Plate 11: two versions of the same worksheet — one in grey-on-white, one in near-black-on-cream — shown side by side.",
      "Plate 27: a hallway sign using a 7:1 contrast ratio, photographed from ten metres away and still legible."] },
  { id:"l4", author:"S. Lindqvist", format:"Book", category:"Learning", tags:["Large Text"], hasAudio:false, hasRead:true, emoji:"📘", year:2023,
    title:{ en:"Dyslexia in Early Grades", ru:"Дислексия в начальных классах", uz:"Boshlang'ich sinflarda disleksiya" },
    meta:{ en:"Excerpt from a 186-page book · ~1 min read", ru:"Отрывок из книги на 186 страниц · ~1 мин на чтение", uz:"186 sahifali kitobdan parcha · ~1 daqiqalik o'qish" },
    content:{
      en:["Letters that reverse, words that blur, and a clock that always seems to run out — dyslexia in early grades often gets mistaken for not trying hard enough.",
        "This book walks through classroom-tested large-print layouts, decodable text sets, and a simple screening checklist teachers can use before a formal diagnosis.",
        "Includes a parent letter template explaining what's changing and why, so home and classroom stay in sync."],
      ru:["Буквы, которые переворачиваются, слова, которые расплываются, и часы, которых будто всегда не хватает — дислексию в начальных классах часто принимают за недостаток старания.",
        "В книге собраны проверенные в классах макеты крупным шрифтом, наборы текстов для декодирования и простой чек-лист для скрининга, который учитель может использовать ещё до официального диагноза.",
        "Есть шаблон письма родителям, объясняющий, что меняется и почему — чтобы дом и класс действовали согласованно."],
      uz:["Teskari aylanadigan harflar, xiralashgan so'zlar va doim yetishmayotgandek tuyuladigan vaqt — boshlang'ich sinflarda disleksiya ko'pincha yetarlicha harakat qilmaslik deb noto'g'ri tushuniladi.",
        "Bu kitobda sinfda sinovdan o'tgan katta shriftli maketlar, dekodlash uchun matn to'plamlari va rasmiy tashxisdan oldin o'qituvchi foydalanishi mumkin bo'lgan oddiy skrining ro'yxati bor.",
        "Uyda va sinfda bir xil tushunish bo'lishi uchun nima o'zgarayotgani va nima uchunligini tushuntiruvchi ota-onalarga xat namunasi ham kiritilgan."]
    } },
  { id:"l5", author:"Deaf Learners Collective", format:"Visual", category:"Hearing", tags:["Video","Captions"], hasAudio:false, hasRead:true, emoji:"🤟", year:2026,
    title:{ en:"Signed Stories, Vol. 2", ru:"Истории на жестовом языке, том 2", uz:"Imo-ishora tilidagi hikoyalar, 2-jild" },
    meta:{ en:"Overview of a 22-film series · ~1 min read", ru:"Обзор серии из 22 фильмов · ~1 мин на чтение", uz:"22 ta filmdan iborat seriyaga umumiy nazar · ~1 daqiqalik o'qish" },
    content:{
      en:["Twenty-two short films, each told entirely in sign language with burned-in captions — no voiceover standing in for either.",
        "Stories range from a grandmother's recipe to a first day at a new school, chosen because Deaf children rarely see themselves as the main character.",
        "Each film comes with three discussion questions for classroom use, available in the same sign language as the story."],
      ru:["Двадцать два коротких фильма, каждый полностью рассказан на жестовом языке со встроенными субтитрами — без закадрового голоса вместо того или другого.",
        "Истории — от бабушкиного рецепта до первого дня в новой школе, выбраны потому, что глухие дети редко видят себя главными героями.",
        "К каждому фильму прилагаются три вопроса для обсуждения в классе — на том же жестовом языке, что и сама история."],
      uz:["Yigirma ikkita qisqa film, har biri to'liq imo-ishora tilida, o'rnatilgan subtitrlar bilan — hech biri o'rnida ovoz o'qish yo'q.",
        "Hikoyalar buvining retseptidan yangi maktabdagi birinchi kungacha — Kar bolalar o'zlarini kamdan-kam bosh qahramon sifatida ko'rishlari sababli tanlangan.",
        "Har bir film bilan sinfda muhokama uchun uchta savol keladi, xuddi hikoyaning o'zi kabi shu imo-ishora tilida."]
    } },
  { id:"l6", author:"MWM Interviews", format:"Audio", category:"Learning", tags:["Audio"], hasAudio:true, hasRead:true, emoji:"🎙️", year:2026,
    title:{ en:"Listening to Learners", ru:"Слушая учеников", uz:"O'quvchilarni tinglash" },
    meta:{ en:"Excerpt from an 18-episode series · ~1 min listen", ru:"Отрывок из серии на 18 эпизодов · ~1 мин прослушивания", uz:"18 qismli seriyadan parcha · ~1 daqiqalik tinglash" },
    content:{
      en:["Eighteen unscripted conversations with students across 42 countries, recorded exactly as they happened — pauses, laughter, and all.",
        "The episode teachers ask about most: a nine-year-old in Nairobi explaining, in her own words, what \"boring\" actually means to her.",
        "No two episodes are edited the same way — the format follows whatever the learner wanted to talk about."],
      ru:["Восемнадцать неотрепетированных разговоров с учениками из 42 стран, записанных именно так, как они происходили — с паузами, смехом, всем.",
        "Эпизод, о котором учителя спрашивают чаще всего: девятилетняя девочка из Найроби своими словами объясняет, что для неё на самом деле значит слово «скучно».",
        "Ни один эпизод не смонтирован так же, как другой — формат следует за тем, о чём хотел говорить сам ученик."],
      uz:["42 mamlakatdan o'quvchilar bilan o'n sakkizta ssenariysiz suhbat, aynan bo'lgani kabi yozilgan — pauzalar, kulgi va hammasi bilan.",
        "O'qituvchilar eng ko'p so'raydigan qism: Nairobidan to'qqiz yoshli qiz o'z so'zlari bilan \"zerikarli\" so'zi unga aslida nimani anglatishini tushuntiradi.",
        "Ikkita qism bir xil tahrir qilinmagan — format o'quvchi nima haqida gaplashishni xohlaganiga qarab shakllanadi."]
    } },
  { id:"l7", author:"A. Boateng", format:"Book", category:"Visual", tags:["Braille","Tactile"], hasAudio:false, hasRead:true, emoji:"📐", year:2024,
    title:{ en:"Maths Without Sight", ru:"Математика без зрения", uz:"Ko'rmasdan matematika" },
    meta:{ en:"Excerpt from a 240-page guide · ~1 min read", ru:"Отрывок из пособия на 240 страниц · ~1 мин на чтение", uz:"240 sahifali qo'llanmadan parcha · ~1 daqiqalik o'qish" },
    content:{
      en:["Tactile diagrams replace visual ones page for page — a raised-line graph is read by hand the way a sighted student reads it by eye.",
        "Covers arithmetic through early algebra, with a braille notation guide included for teachers who don't yet read braille themselves.",
        "Each chapter ends with a \"build it\" exercise — recreating a diagram from raised materials at home, to reinforce spatial memory."],
      ru:["Тактильные диаграммы заменяют визуальные один в один — выпуклый график читается рукой так же, как зрячий ученик читает его глазами.",
        "Охватывает арифметику вплоть до начальной алгебры, включает руководство по брайлевской нотации для учителей, которые сами ещё не читают брайль.",
        "Каждая глава заканчивается заданием «собери сам» — воссоздать диаграмму из рельефных материалов дома, чтобы закрепить пространственную память."],
      uz:["Taktil diagrammalar vizual diagrammalarni sahifama-sahifa almashtiradi — bo'rtma chiziqli grafik ko'zi ojiz bo'lmagan o'quvchi uni ko'z bilan o'qigani kabi qo'l bilan o'qiladi.",
        "Arifmetikadan boshlang'ich algebragacha bo'lgan mavzularni qamrab oladi, brayl yozuvini hali o'zi o'qiy olmaydigan o'qituvchilar uchun brayl belgilari qo'llanmasi ham bor.",
        "Har bir bob \"o'zing yasa\" mashqi bilan tugaydi — fazoviy xotirani mustahkamlash uchun uyda bo'rtma materiallardan diagrammani qayta yaratish."]
    } },
  { id:"l8", author:"MWM Research", format:"Visual", category:"Visual", tags:["Visual"], hasAudio:false, hasRead:true, emoji:"🏫", year:2025,
    title:{ en:"Rooms That Work", ru:"Помещения, которые работают", uz:"Ishlaydigan xonalar" },
    meta:{ en:"Highlights from a 60-classroom study · ~1 min read", ru:"Основное из исследования 60 классов · ~1 мин на чтение", uz:"60 ta sinf tadqiqotidan asosiylari · ~1 daqiqalik o'qish" },
    content:{
      en:["Sixty classrooms photographed exactly as teachers actually arranged them — not staged, not idealized.",
        "Grouped by what they solve: glare, noise, wayfinding, and reach. Each photo has a one-line note on what changed and what it cost.",
        "Most fixes in this study cost under $50 and took one weekend."],
      ru:["Шестьдесят классов сфотографированы именно так, как их на самом деле расставили учителя — без постановки, без приукрашивания.",
        "Сгруппировано по тому, что решает каждое решение: блики, шум, ориентация в пространстве, доступность. У каждого фото — короткая заметка о том, что изменили и во сколько это обошлось.",
        "Большинство решений в этом исследовании стоили меньше 50 долларов и заняли один выходной."],
      uz:["Oltmish sinf xonasi o'qituvchilar aslida qanday joylashtirgan bo'lsa, aynan shunday suratga olingan — sahnalashtirilmagan, idealizatsiya qilinmagan.",
        "Nima hal qilishiga qarab guruhlangan: yaltirash, shovqin, yo'nalish topish va qo'l yetkazish. Har bir suratda nima o'zgargani va bu qanchaga tushgani haqida bir qatorlik izoh bor.",
        "Bu tadqiqotdagi ko'pchilik yechimlar 50 dollardan arzon bo'lib, bir dam olish kunini oldi."]
    } },
  { id:"l9", author:"MWM Research", format:"Visual", category:"Visual", tags:["Audio","Large Text"], hasAudio:true, hasRead:true, emoji:"👓", year:2026,
    title:{ en:"Seeing Differently", ru:"Видеть иначе", uz:"Boshqacha ko'rish" },
    meta:{ en:"Guide excerpt · ~1 min read", ru:"Отрывок из руководства · ~1 мин на чтение", uz:"Qo'llanmadan parcha · ~1 daqiqalik o'qish" },
    description:{ en:"Visual accessibility guide", ru:"Руководство по визуальной доступности", uz:"Vizual qulaylik bo'yicha qo'llanma" },
    content:{
      en:["A field guide to what \"low vision\" actually covers — it is rarely all-or-nothing, and this guide starts by unlearning that assumption.",
        "Walks through practical adjustments: lighting angles, font choices, and screen settings that help before any assistive device is needed.",
        "Written with input from students who have low vision, not just about them."],
      ru:["Полевой справочник о том, что на самом деле означает «слабое зрение» — оно редко бывает «всё или ничего», и это руководство начинается с отказа от этого предположения.",
        "Рассказывает о практических изменениях: угол освещения, выбор шрифта и настройки экрана, которые помогают ещё до того, как понадобится вспомогательное устройство.",
        "Написано с участием студентов со слабым зрением, а не просто о них."],
      uz:["\"Zaif ko'rish\" aslida nimani qamrab olishi haqidagi qo'llanma — bu kamdan-kam \"hammasi yoki hech narsa\" bo'ladi, va bu qo'llanma shu taxminni unutishdan boshlanadi.",
        "Amaliy o'zgarishlarni ko'rsatadi: yoritish burchagi, shrift tanlovi va har qanday yordamchi qurilma kerak bo'lishidan oldin yordam beradigan ekran sozlamalari.",
        "Zaif ko'ruvchi talabalar ishtirokida yozilgan, ular haqida emas, ular bilan birga."]
    } },
  { id:"l10", author:"MWM Research", format:"Audio", category:"Hearing", tags:["Audio","Braille"], hasAudio:true, hasRead:true, emoji:"🔔", year:2026,
    title:{ en:"Sound and Learning", ru:"Звук и обучение", uz:"Ovoz va ta'lim" },
    meta:{ en:"Guide excerpt · ~1 min read", ru:"Отрывок из руководства · ~1 мин на чтение", uz:"Qo'llanmadan parcha · ~1 daqiqalik o'qish" },
    description:{ en:"Hearing support strategies", ru:"Стратегии поддержки слуха", uz:"Eshitishni qo'llab-quvvatlash strategiyalari" },
    content:{
      en:["Strategies gathered from Deaf and hard-of-hearing students on what actually helps in a hearing classroom — not the textbook list, the real one.",
        "Seating position matters more than most teachers realize; this guide explains why the corner seat is rarely the right one.",
        "Includes a short script for the first day of class, asking a teacher to introduce captioning without singling anyone out."],
      ru:["Стратегии, собранные от глухих и слабослышащих учеников о том, что на самом деле помогает в обычном классе — не учебничный список, а настоящий.",
        "Место, где сидит ученик, значит больше, чем думает большинство учителей; в руководстве объясняется, почему угловое место почти никогда не подходит.",
        "Есть короткий сценарий для первого дня занятий — как учителю ввести субтитры, никого не выделяя."],
      uz:["Kar va zaif eshituvchi o'quvchilardan to'plangan, eshituvchilar sinfida haqiqatan yordam beradigan strategiyalar — darslikdagi ro'yxat emas, haqiqiy ro'yxat.",
        "O'tirish joyi ko'pchilik o'qituvchilar o'ylagandan ko'ra muhimroq; bu qo'llanma nima uchun burchakdagi joy deyarli hech qachon to'g'ri emasligini tushuntiradi.",
        "Darsning birinchi kuni uchun qisqa skript bor — o'qituvchi hech kimni ajratib ko'rsatmasdan subtitrlarni qanday kiritishi haqida."]
    } },
  { id:"l11", author:"MWM Research", format:"Book", category:"Learning", tags:["Text","Video"], hasAudio:false, hasRead:true, emoji:"🧩", year:2026,
    title:{ en:"Every Learner Counts", ru:"Каждый ученик важен", uz:"Har bir o'quvchi muhim" },
    meta:{ en:"Toolkit excerpt · ~1 min read", ru:"Отрывок из набора инструментов · ~1 мин на чтение", uz:"Vositalar to'plamidan parcha · ~1 daqiqalik o'qish" },
    description:{ en:"Inclusive classroom tools", ru:"Инструменты инклюзивного класса", uz:"Inklyuziv sinf vositalari" },
    content:{
      en:["A toolkit for classrooms with a genuine mix of needs — not a single \"inclusive\" worksheet, but options within the same lesson.",
        "Every activity in this set has three entry points: read it, hear it, or do it — chosen by the student, not assigned by diagnosis.",
        "Field-tested across 30 classrooms before publication; the version here reflects what teachers actually kept using."],
      ru:["Набор инструментов для классов с по-настоящему разными потребностями — не один «инклюзивный» рабочий лист, а варианты внутри одного и того же урока.",
        "У каждого задания в наборе три входа: прочитать, услышать или сделать — выбирает ученик, а не диагноз.",
        "Опробовано в 30 классах перед публикацией; версия здесь отражает то, чем учителя действительно продолжили пользоваться."],
      uz:["Haqiqiy xilma-xil ehtiyojlari bo'lgan sinflar uchun vositalar to'plami — bitta \"inklyuziv\" varaq emas, bir xil dars ichida tanlovlar.",
        "Ushbu to'plamdagi har bir mashq uchta kirish nuqtasiga ega: o'qish, eshitish yoki bajarish — tashxis emas, o'quvchi tanlaydi.",
        "Nashrdan oldin 30 ta sinfda sinovdan o'tkazilgan; bu yerdagi versiya o'qituvchilar haqiqatda foydalanishda davom etgan narsani aks ettiradi."]
    } },
  { id:"l12", author:"MWM Research", format:"Book", category:"Learning", tags:["Audio","Simplified"], hasAudio:true, hasRead:true, emoji:"🛤️", year:2026,
    title:{ en:"Pathways to Reading", ru:"Пути к чтению", uz:"O'qishga yo'llar" },
    meta:{ en:"Guide excerpt · ~1 min read", ru:"Отрывок из руководства · ~1 мин на чтение", uz:"Qo'llanmadan parcha · ~1 daqiqalik o'qish" },
    description:{ en:"Dyslexia-friendly formats", ru:"Форматы для людей с дислексией", uz:"Disleksiyaga qulay formatlar" },
    content:{
      en:["Dyslexia-friendly doesn't mean simplified — this collection keeps full vocabulary while changing spacing, font, and chunking.",
        "Each title is available in three formats from the same page: standard text, audio, and a version with syllables pre-marked.",
        "Chosen by readers with dyslexia as the books they'd actually recommend to a friend, not just the ones assigned to them."],
      ru:["«Удобно для дислексии» не значит «упрощено» — в этой подборке сохранён полный словарный запас, меняются только интервалы, шрифт и разбивка текста.",
        "Каждое название доступно в трёх форматах с одной и той же страницы: обычный текст, аудио и версия с заранее размеченными слогами.",
        "Выбрано самими читателями с дислексией как книги, которые они бы правда порекомендовали другу, а не просто те, что им задали."],
      uz:["\"Disleksiyaga qulay\" soddalashtirilgan degani emas — bu to'plamda to'liq lug'at saqlanadi, faqat oraliq, shrift va matn bo'linishi o'zgaradi.",
        "Har bir nom bitta sahifadan uchta formatda mavjud: oddiy matn, audio va bo'g'inlari oldindan belgilangan versiya.",
        "Disleksiyasi bor o'quvchilarning o'zlari do'stiga haqiqatan tavsiya qiladigan kitoblar sifatida tanlangan, shunchaki ularga topshirilgan kitoblar emas."]
    } }
];
const LIBRARY_CATEGORIES = ["All","Visual","Hearing","Learning","Book"];
const PATHS = [
  { id:"p1", emoji:"🧭", mins:60,
    title:{ en:"Foundations of Accessible Teaching", ru:"Основы доступного преподавания", uz:"Qulay o'qitish asoslari" },
    level:{ en:"Start here", ru:"Начните отсюда", uz:"Shu yerdan boshlang" },
    lessons:[
      { title:{ en:"Start with the room, not the student", ru:"Начните с помещения, не с ученика", uz:"Xonadan boshlang, o'quvchidan emas" },
        body:{ en:"Before adjusting anything for one learner, look at the room itself — lighting, noise, seating. Most accessibility problems are architectural before they're personal.",
          ru:"Прежде чем что-то менять под одного ученика, посмотрите на само помещение — свет, шум, рассадку. Большинство проблем доступности — архитектурные, а не личные.",
          uz:"Bitta o'quvchi uchun biror narsani o'zgartirishdan oldin xonaning o'ziga qarang — yorug'lik, shovqin, o'tirish joyi. Ko'pchilik qulaylik muammolari shaxsiy emas, arxitektura muammosi." } },
      { title:{ en:"One question beats one label", ru:"Один вопрос лучше одного диагноза", uz:"Bitta savol bitta tashxisdan ustun" },
        body:{ en:"Instead of asking what a diagnosis means, ask the student directly: what makes a lesson easier or harder for you? Their answer is usually more useful than any file.",
          ru:"Вместо того чтобы гадать, что значит диагноз, спросите ученика напрямую: что делает урок легче или труднее? Его ответ обычно полезнее любой карточки.",
          uz:"Tashxis nimani anglatishini taxmin qilish o'rniga o'quvchidan to'g'ridan-to'g'ri so'rang: nima darsni osonroq yoki qiyinroq qiladi? Uning javobi odatda har qanday hujjatdan foydaliroq." } },
      { title:{ en:"Multiple ways in", ru:"Несколько входов в урок", uz:"Darsga bir nechta kirish nuqtasi" },
        body:{ en:"Give every lesson at least two entry points — read it, hear it, or do it. Let students choose, don't assign the format by assumption.",
          ru:"Дайте каждому уроку минимум два входа — прочитать, услышать или сделать. Пусть ученик выбирает сам, не назначайте формат по предположению.",
          uz:"Har bir darsga kamida ikkita kirish nuqtasi bering — o'qish, eshitish yoki bajarish. O'quvchi o'zi tanlasin, formatni taxmin bilan belgilamang." } },
      { title:{ en:"Small, visible changes first", ru:"Сначала — маленькие заметные изменения", uz:"Avval kichik, ko'rinadigan o'zgarishlar" },
        body:{ en:"Bigger print, more pause time, a seat away from glare — these cost nothing and often help before you know exactly what's needed.",
          ru:"Крупнее шрифт, больше времени на паузу, место подальше от бликов — это ничего не стоит и часто помогает ещё до того, как понятно, что именно нужно.",
          uz:"Kattaroq shrift, ko'proq pauza vaqti, yaltirashdan uzoqroq joy — bularning narxi yo'q va ko'pincha aniq nima kerakligini bilishdan oldin ham yordam beradi." } },
      { title:{ en:"Ask, don't guess", ru:"Спрашивайте, не догадывайтесь", uz:"So'rang, taxmin qilmang" },
        body:{ en:"The fastest way to get accessibility wrong is to guess on someone's behalf. A two-minute conversation usually beats an hour of assumptions.",
          ru:"Быстрее всего ошибиться в доступности — решить за человека. Двухминутный разговор обычно полезнее часа предположений.",
          uz:"Qulaylikda eng tez xato qilish yo'li — kimningdir o'rniga qaror qabul qilish. Ikki daqiqalik suhbat odatda bir soatlik taxmindan foydaliroq." } }
    ],
    quiz:[
      { q:{ en:"What should you look at first, before adjusting anything for one learner?", ru:"Что стоит посмотреть в первую очередь, прежде чем что-то менять под одного ученика?", uz:"Bitta o'quvchi uchun biror narsani o'zgartirishdan oldin birinchi navbatda nimaga qarash kerak?" },
        options:{ en:["The student's diagnosis file","The room itself — lighting, noise, seating","A specialist's report"],
          ru:["Диагноз в личном деле","Само помещение — свет, шум, рассадку","Заключение специалиста"],
          uz:["Shaxsiy ishdagi tashxis","Xonaning o'zi — yorug'lik, shovqin, o'tirish joyi","Mutaxassis xulosasi"] }, correct:1 },
      { q:{ en:"What's often more useful than asking what a diagnosis means?", ru:"Что обычно полезнее, чем гадать, что значит диагноз?", uz:"Tashxis nimani anglatishini taxmin qilishdan ko'ra nima foydaliroq?" },
        options:{ en:["Reading a textbook","Asking the student directly","Guessing based on similar cases"],
          ru:["Прочитать учебник","Спросить ученика напрямую","Опираться на похожие случаи"],
          uz:["Darslik o'qish","O'quvchidan to'g'ridan-to'g'ri so'rash","O'xshash holatlarga tayanish"] }, correct:1 },
      { q:{ en:"A good lesson should offer:", ru:"Хороший урок должен предлагать:", uz:"Yaxshi dars nimani taklif qilishi kerak:" },
        options:{ en:["One fixed format for everyone","At least two entry points chosen by the student","Only a written worksheet"],
          ru:["Один фиксированный формат для всех","Минимум два входа на выбор ученика","Только письменный лист"],
          uz:["Hamma uchun bitta qat'iy format","O'quvchi tanlashi uchun kamida ikkita kirish nuqtasi","Faqat yozma varaq"] }, correct:1 }
    ] },
  { id:"p2", emoji:"📝", mins:45,
    title:{ en:"Designing Readable Materials", ru:"Создание читаемых материалов", uz:"O'qish uchun qulay materiallar yaratish" },
    level:{ en:"Practical", ru:"Практика", uz:"Amaliyot" },
    lessons:[
      { title:{ en:"Font over decoration", ru:"Шрифт важнее оформления", uz:"Shrift bezakdan muhimroq" },
        body:{ en:"A plain, well-spaced sans-serif font beats a stylish one every time text needs to be read quickly and accurately.",
          ru:"Простой, хорошо разнесённый шрифт без засечек побеждает стильный каждый раз, когда текст нужно прочитать быстро и точно.",
          uz:"Matnni tez va aniq o'qish kerak bo'lganda oddiy, yaxshi oralig'i bor serif-siz shrift har doim chiroyli shriftdan ustun keladi." } },
      { title:{ en:"Contrast is not optional", ru:"Контраст — не опция", uz:"Kontrast ixtiyoriy emas" },
        body:{ en:"Light grey text on white looks modern and is nearly unreadable for many people. Aim for strong, simple contrast by default.",
          ru:"Светло-серый текст на белом выглядит современно и почти нечитаем для многих. По умолчанию стремитесь к сильному, простому контрасту.",
          uz:"Oq fondagi och kulrang matn zamonaviy ko'rinadi, lekin ko'pchilik uchun deyarli o'qib bo'lmaydi. Odatiy holatda kuchli, oddiy kontrastga intiling." } },
      { title:{ en:"Shorter lines, more white space", ru:"Короче строки, больше пустого места", uz:"Qisqaroq qatorlar, ko'proq bo'sh joy" },
        body:{ en:"Long unbroken lines of text are tiring to track. Shorter lines with real margins are easier to follow, especially for dyslexic readers.",
          ru:"Длинные сплошные строки текста утомляют взгляд. Более короткие строки с реальными полями легче отслеживать — особенно при дислексии.",
          uz:"Uzun, uzluksiz matn qatorlarini kuzatish charchatadi. Haqiqiy chekkalari bor qisqaroq qatorlarni kuzatish osonroq — ayniqsa disleksiyada." } },
      { title:{ en:"One idea per paragraph", ru:"Одна мысль на абзац", uz:"Har abzatsda bitta fikr" },
        body:{ en:"Dense paragraphs hide their point. One idea, then a break, makes a worksheet far easier to navigate — for everyone, not only accessibility needs.",
          ru:"Плотные абзацы прячут свою суть. Одна мысль, затем пауза — рабочий лист становится намного проще для навигации, причём для всех, не только с особыми потребностями.",
          uz:"Zich abzatslar o'z mohiyatini yashiradi. Bitta fikr, keyin tanaffus — ish varag'ini navigatsiya qilish ancha osonlashadi, va bu faqat qulaylik ehtiyoji borlar uchun emas, hamma uchun." } }
    ],
    quiz:[
      { q:{ en:"For fast, accurate reading, which font works best?", ru:"Для быстрого и точного чтения лучше всего подходит:", uz:"Tez va aniq o'qish uchun eng yaxshi mos keladigani:" },
        options:{ en:["A stylish decorative font","A plain, well-spaced sans-serif font","Italic throughout"],
          ru:["Стильный декоративный шрифт","Простой, хорошо разнесённый шрифт без засечек","Курсив по всему тексту"],
          uz:["Chiroyli bezakli shrift","Oddiy, yaxshi oralig'i bor serif-siz shrift","Butun matn kursiv"] }, correct:1 },
      { q:{ en:"Light grey text on white is a problem because:", ru:"Светло-серый текст на белом — проблема, потому что:", uz:"Oq fondagi och kulrang matn muammo, chunki:" },
        options:{ en:["It looks unprofessional","It's nearly unreadable for many people","It uses more ink"],
          ru:["Выглядит непрофессионально","Почти нечитаем для многих людей","Расходует больше чернил"],
          uz:["Norasmiy ko'rinadi","Ko'pchilik uchun deyarli o'qib bo'lmaydi","Ko'proq siyoh sarflaydi"] }, correct:1 },
      { q:{ en:"Long unbroken lines of text are:", ru:"Длинные сплошные строки текста:", uz:"Uzun, uzluksiz matn qatorlari:" },
        options:{ en:["Easier to scan","Tiring to track, especially for dyslexic readers","Always faster to read"],
          ru:["Легче пробегать глазами","Утомляют взгляд, особенно при дислексии","Всегда читаются быстрее"],
          uz:["Ko'z bilan kuzatish osonroq","Charchatadi, ayniqsa disleksiyada","Har doim tezroq o'qiladi"] }, correct:1 }
    ] },
  { id:"p3", emoji:"🖥️", mins:70,
    title:{ en:"Assistive Technology in Class", ru:"Вспомогательные технологии в классе", uz:"Sinfda yordamchi texnologiyalar" },
    level:{ en:"Deep dive", ru:"Глубокое погружение", uz:"Chuqur o'rganish" },
    lessons:[
      { title:{ en:"Screen readers read structure, not just words", ru:"Экранный диктор читает структуру, не просто слова", uz:"Ekran diktori tuzilmani o'qiydi, shunchaki so'zlarni emas" },
        body:{ en:"A screen reader announces headings, lists and buttons by their structure. Materials built with proper headings are far easier to navigate than ones that just look organized.",
          ru:"Экранный диктор объявляет заголовки, списки и кнопки по их структуре. Материалы с правильной разметкой заголовков читаются намного проще, чем просто аккуратно оформленные на вид.",
          uz:"Ekran diktori sarlavhalar, ro'yxatlar va tugmalarni ularning tuzilmasiga qarab e'lon qiladi. To'g'ri sarlavha bilan tuzilgan materiallar shunchaki tartibli ko'ringan materiallardan ancha oson navigatsiya qilinadi." } },
      { title:{ en:"Captions help more people than expected", ru:"Субтитры помогают шире, чем кажется", uz:"Subtitrlar kutilganidan ko'proq odamga yordam beradi" },
        body:{ en:"Captions are used far beyond deaf and hard-of-hearing students — in noisy rooms, for second-language learners, for anyone who processes text better than speech.",
          ru:"Субтитрами пользуются далеко не только глухие и слабослышащие — в шумном помещении, при изучении второго языка, всем, кому текст даётся легче речи.",
          uz:"Subtitrlardan nafaqat kar va zaif eshituvchi o'quvchilar foydalanadi — shovqinli xonada, ikkinchi tilni o'rganishda, matnni nutqdan yaxshiroq qabul qiladigan har kim uchun ham." } },
      { title:{ en:"Text-to-speech is a reading tool, not a shortcut", ru:"Text-to-speech — инструмент чтения, не обход", uz:"Text-to-speech o'qish vositasi, aylanib o'tish emas" },
        body:{ en:"Letting a student listen while following the text builds reading skill, it doesn't replace it. Treat it as a support, not a workaround.",
          ru:"Слушать текст, следя за ним глазами, развивает навык чтения, а не заменяет его. Относитесь к этому как к поддержке, а не как к обходному пути.",
          uz:"Matnni kuzatib turib tinglash o'qish ko'nikmasini rivojlantiradi, uni almashtirmaydi. Buni qo'llab-quvvatlash sifatida ko'ring, aylanib o'tish yo'li sifatida emas." } },
      { title:{ en:"Low-tech counts as assistive technology too", ru:"Простые средства — тоже вспомогательные технологии", uz:"Oddiy vositalar ham yordamchi texnologiya hisoblanadi" },
        body:{ en:"A pencil grip, a slant board, a highlighter strip — assistive technology doesn't have to be digital to matter.",
          ru:"Насадка на карандаш, наклонная доска, полоска-выделитель — вспомогательная технология не обязана быть цифровой, чтобы иметь значение.",
          uz:"Qalam tutqichi, qiyshiq taxta, ajratuvchi chiziq — yordamchi texnologiya ahamiyatli bo'lishi uchun raqamli bo'lishi shart emas." } },
      { title:{ en:"Test it with the student, not for them", ru:"Проверяйте вместе с учеником, а не вместо него", uz:"O'quvchi bilan birga sinab ko'ring, u uchun emas" },
        body:{ en:"The only way to know if a tool actually helps is to watch the student use it — not to assume it will work because it worked for someone else.",
          ru:"Единственный способ узнать, помогает ли инструмент на самом деле — понаблюдать, как ученик им пользуется, а не решить, что сработает, потому что сработало у кого-то другого.",
          uz:"Vosita haqiqatan yordam berayotganini bilishning yagona yo'li — o'quvchi undan qanday foydalanayotganini kuzatish, boshqa birov uchun ishlagani uchun ishlaydi deb taxmin qilish emas." } }
    ],
    quiz:[
      { q:{ en:"A screen reader announces:", ru:"Экранный диктор объявляет:", uz:"Ekran diktori nimani e'lon qiladi:" },
        options:{ en:["Only the words on the page","Headings, lists, and buttons by their structure","Nothing unless told to"],
          ru:["Только слова на странице","Заголовки, списки и кнопки по их структуре","Ничего, пока не попросишь"],
          uz:["Faqat sahifadagi so'zlarni","Sarlavhalar, ro'yxatlar va tugmalarni tuzilmasiga qarab","So'ralmaguncha hech narsani"] }, correct:1 },
      { q:{ en:"Captions are useful for:", ru:"Субтитры полезны:", uz:"Subtitrlar foydali:" },
        options:{ en:["Only deaf and hard-of-hearing students","A much wider range of learners","Nobody in a quiet room"],
          ru:["Только глухим и слабослышащим","Гораздо более широкому кругу людей","Никому в тихой комнате"],
          uz:["Faqat kar va zaif eshituvchilarga","Ancha keng doiradagi o'quvchilarga","Tinch xonada hech kimga"] }, correct:1 },
      { q:{ en:"The best way to know if a tool helps a student:", ru:"Лучший способ узнать, помогает ли инструмент ученику:", uz:"Vosita o'quvchiga haqiqatan yordam berayotganini bilishning eng yaxshi yo'li:" },
        options:{ en:["Assume it works because it worked elsewhere","Watch the student actually use it","Skip testing entirely"],
          ru:["Решить, что сработает, раз сработало у других","Понаблюдать, как ученик им реально пользуется","Вообще не проверять"],
          uz:["Boshqalarda ishlagani uchun ishlaydi deb taxmin qilish","O'quvchi undan qanday foydalanayotganini kuzatish","Umuman tekshirmaslik"] }, correct:1 }
    ] },
  { id:"p4", emoji:"💬", mins:40,
    title:{ en:"Interviewing Learners with Care", ru:"Бережное интервьюирование учеников", uz:"O'quvchilar bilan ehtiyotkorlik bilan intervyu" },
    level:{ en:"For researchers", ru:"Для исследователей", uz:"Tadqiqotchilar uchun" },
    lessons:[
      { title:{ en:"Ask what a good day looks like", ru:"Спросите, как выглядит хороший день", uz:"Yaxshi kun qanday ko'rinishini so'rang" },
        body:{ en:"Open with something concrete and positive — \"what makes a good day of learning?\" — before asking about anything difficult.",
          ru:"Начните с чего-то конкретного и позитивного — «что делает день учёбы хорошим?» — прежде чем переходить к трудному.",
          uz:"Qiyin narsalar haqida so'rashdan oldin aniq va ijobiy narsadan boshlang — \"yaxshi o'quv kunini nima qiladi?\"" } },
      { title:{ en:"Let silence sit", ru:"Дайте тишине побыть", uz:"Sukunatga joy bering" },
        body:{ en:"A pause after a question is not a problem to fix. Some of the most honest answers come after several seconds of quiet.",
          ru:"Пауза после вопроса — это не проблема, которую нужно исправлять. Самые честные ответы часто приходят после нескольких секунд молчания.",
          uz:"Savoldan keyingi pauza tuzatish kerak bo'lgan muammo emas. Eng samimiy javoblar ko'pincha bir necha soniyalik sukunatdan keyin keladi." } },
      { title:{ en:"Their words, not your summary", ru:"Их слова, а не ваш пересказ", uz:"Ularning so'zlari, sizning bayoningiz emas" },
        body:{ en:"Write down what a student actually said, not your paraphrase of it. The exact wording often carries more than the general idea.",
          ru:"Записывайте то, что ученик действительно сказал, а не ваш пересказ этого. Точная формулировка часто несёт больше, чем общий смысл.",
          uz:"O'quvchi aslida nima deganini yozing, uning bayoningizni emas. Aniq so'zlar ko'pincha umumiy g'oyadan ko'proq narsani ifodalaydi." } },
      { title:{ en:"Always ask what to leave out", ru:"Всегда спрашивайте, что не включать", uz:"Har doim nimani kiritmaslikni so'rang" },
        body:{ en:"Before publishing anything from an interview, ask the person what they'd rather you not include. Consent isn't a one-time checkbox.",
          ru:"Прежде чем публиковать что-либо из интервью, спросите человека, что он предпочёл бы не включать. Согласие — не разовая галочка.",
          uz:"Intervyudan biror narsa nashr qilishdan oldin, odamdan nimani kiritmaslikni xohlashini so'rang. Rozilik bir martalik belgi emas." } }
    ],
    quiz:[
      { q:{ en:"How should you open an interview with a student?", ru:"Как лучше начать интервью с учеником?", uz:"O'quvchi bilan intervyuni qanday boshlash kerak?" },
        options:{ en:["With the hardest question first","With something concrete and positive","With a written form only"],
          ru:["Сразу с самого трудного вопроса","С чего-то конкретного и позитивного","Только с письменной анкеты"],
          uz:["Darhol eng qiyin savoldan","Aniq va ijobiy narsadan","Faqat yozma anketadan"] }, correct:1 },
      { q:{ en:"A pause after a question is:", ru:"Пауза после вопроса — это:", uz:"Savoldan keyingi pauza — bu:" },
        options:{ en:["A problem to fix immediately","Often where honest answers come from","A sign the question was bad"],
          ru:["Проблема, которую надо сразу исправлять","Часто момент, откуда приходят честные ответы","Признак того, что вопрос был плохим"],
          uz:["Darhol tuzatish kerak bo'lgan muammo","Ko'pincha samimiy javoblar keladigan payt","Savol yomon bo'lganining belgisi"] }, correct:1 },
      { q:{ en:"Before publishing anything from an interview, you should:", ru:"Перед публикацией чего-либо из интервью нужно:", uz:"Intervyudan biror narsa nashr qilishdan oldin nima qilish kerak:" },
        options:{ en:["Just publish it","Ask what they'd rather you not include","Assume it's fine since they talked to you"],
          ru:["Просто опубликовать","Спросить, что человек предпочёл бы не включать","Считать, что раз согласился говорить — значит, согласен на всё"],
          uz:["Shunchaki nashr qilish","Odamdan nimani kiritmaslikni xohlashini so'rash","Gaplashishga rozi bo'lgani uchun hammasiga rozi deb hisoblash"] }, correct:1 }
    ] }
];

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
  award:(p)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="8" r="5.5"/><path d="m8.5 12.8-1.7 7.2 5.2-2.8 5.2 2.8-1.7-7.2"/></svg>,
  users:(p)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.8-3.3 2.9-5 5.5-5s4.7 1.7 5.5 5"/><circle cx="17" cy="8.5" r="2.4"/><path d="M15.8 14.2c2.1.4 3.5 2 4.1 4.8"/></svg>,
  flame:(p)=><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 22c4 0 6.5-2.6 6.5-6.2 0-3-1.8-4.9-3-7.1-.4 1.6-1.2 2.6-2 3.2C13.8 9 13 6.5 13 4c-3.5 2.2-6.5 6-6.5 10 0 4 2.9 6 5.5 6Z"/></svg>,
  download:(p)=><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 4v11M7 11l5 5 5-5"/><path d="M4 19h16"/></svg>,
  thumbsUp:(p)=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M7 10v11H4V10h3Zm0 0 5-7c1 0 2 1 2 2.4V9h5.2c1 0 1.8.9 1.6 1.9l-1.4 7A2 2 0 0 1 17.5 19H10a3 3 0 0 1-3-3v-6Z"/></svg>,
  thumbsDown:(p)=><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M17 14V3h3v11h-3Zm0 0-5 7c-1 0-2-1-2-2.4V15H4.8c-1 0-1.8-.9-1.6-1.9l1.4-7A2 2 0 0 1 6.5 5H14a3 3 0 0 1 3 3v6Z"/></svg>,
  info:(p)=><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>,
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
  useEffect(()=>{
    const timer = setTimeout(()=>{ speakText(t("splashVoiceIntro"), { lang: TTS_LANG_MAP[lang] }); }, 500);
    return ()=>clearTimeout(timer);
  }, [lang]);
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
      <button className="voice-fab no-tabbar" aria-label={t("replayAudioLabel")}
              onClick={()=>speakText(t("splashVoiceIntro"), { lang: TTS_LANG_MAP[lang] })}>
        <I.speaker/>
      </button>
    </div>
  );
}

/* ============ auth: register / login ============ */
function AuthScreen({ lang, setLang, t, onAuth, error, setError, tgUser, onTelegramLogin }){
  const [mode, setMode] = useState("register");
  const [form, setForm] = useState({ name:"", email:"", password:"" });
  const emailOk = (v)=> /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  useEffect(()=>{
    const timer = setTimeout(()=>{ speakText(t("authVoiceIntro"), { lang: TTS_LANG_MAP[lang] }); }, 500);
    return ()=>clearTimeout(timer);
  }, [lang]);

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
      <button className="voice-fab no-tabbar" aria-label={t("replayAudioLabel")}
              onClick={()=>speakText(t("authVoiceIntro"), { lang: TTS_LANG_MAP[lang] })}>
        <I.speaker/>
      </button>
    </div>
  );
}

/* ============ accessibility setup ============ */
function AccessibilitySetup({ onPick, t }){
  const [picked, setPicked] = useState(null);
  useEffect(()=>{
    const timer = setTimeout(()=>{ speakText(t("setupVoiceIntro")); }, 500);
    return ()=>clearTimeout(timer);
  }, []);
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
      <button className="voice-fab no-tabbar" aria-label={t("replayAudioLabel")}
              onClick={()=>speakText(t("setupVoiceIntro"))}>
        <I.speaker/>
      </button>
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
function Home({ go, t, lang, greeting, simplified, lastViewed }){
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
        <div style={{display:"flex", alignItems:"center", gap:10}}>
          <button className="icon-btn" onClick={()=>go({ view:{ type:"search" } }, t("globalSearchTitle"))} aria-label={t("globalSearchTitle")}><I.search/></button>
          <button className="avatar" onClick={()=>go({ tab:"profile" }, t("navProfile"))} aria-label={t("navProfile")}>M</button>
        </div>
      </div>

      {lastViewed && !simplified && (
        <button className="row-item" style={{background:"var(--cream-2)", borderRadius:14, marginTop:14}}
                onClick={()=>go({ view:{ type:lastViewed.type, id:lastViewed.id } }, lastViewed.title)}>
          <span className="row-icon"><I.doc/></span>
          <span style={{flex:1}}><b>{t("continueWhereLabel")}</b><small>{lastViewed.title}</small></span>
          <I.chevron style={{color:"var(--muted)"}}/>
        </button>
      )}

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
              <small>{t(KIND_KEYS[a.kind] || "kindResearch")} · {a.ago}</small>
            </span>
            <I.chevron style={{color:"var(--muted)"}}/>
          </button>
        );
      })}
    </div>
  );
}

/* ============ library ============ */
const FILTER_KEYS = { All:"filterAll", Book:"filterBook", Audio:"filterAudio", Visual:"filterVisual", Saved:"filterSaved" };
const TAG_LABELS = {
  "Text": { en:"Text", ru:"Текст", uz:"Matn" },
  "Braille": { en:"Braille", ru:"Брайль", uz:"Brayl" },
  "Audio": { en:"Audio", ru:"Аудио", uz:"Audio" },
  "Transcript": { en:"Transcript", ru:"Расшифровка", uz:"Transkripsiya" },
  "Visual": { en:"Visual", ru:"Визуал", uz:"Vizual" },
  "Alt Text": { en:"Alt Text", ru:"Alt-текст", uz:"Alt-matn" },
  "Large Text": { en:"Large Text", ru:"Крупный текст", uz:"Katta matn" },
  "Video": { en:"Video", ru:"Видео", uz:"Video" },
  "Captions": { en:"Captions", ru:"Субтитры", uz:"Subtitr" },
  "Tactile": { en:"Tactile", ru:"Тактильно", uz:"Taktil" },
  "Simplified": { en:"Simplified", ru:"Упрощённо", uz:"Soddalashtirilgan" }
};
function Library({ go, saved, toggleSave, t, lang }){
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("All");
  const filters = ["All","Book","Audio","Visual","Saved"];
  const items = useMemo(()=>LIBRARY.filter(it=>{
    const okF = filter === "All" ? true : filter === "Saved" ? saved.includes(it.id) : it.format === filter;
    const title = pick(it.title, lang);
    const okQ = (title + " " + it.author).toLowerCase().includes(q.trim().toLowerCase());
    return okF && okQ;
  }), [q, filter, saved, lang]);

  const exportSaved = ()=>{
    const savedItems = LIBRARY.filter(it=>saved.includes(it.id));
    const lines = savedItems.map(it=>{
      const title = pick(it.title, lang);
      const meta = pick(it.meta, lang) || pick(it.description, lang) || "";
      const content = (pick(it.content, lang) || []).join("\n\n");
      return title + "\n" + it.author + " · " + it.year + "\n" + meta + "\n\n" + content;
    });
    const text = lines.join("\n\n" + "—".repeat(20) + "\n\n");
    const blob = new Blob([text], { type:"text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "mwm-saved.txt";
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
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

      {filter === "Saved" && saved.length > 0 && (
        <button className="report-toggle" style={{marginBottom:14}} onClick={exportSaved}>
          <I.download/> {t("exportSavedBtn")}
        </button>
      )}

      {items.length === 0 ? (
        <div className="empty">
          <div className="emoji">🔍</div>
          <p className="muted" style={{fontSize:13}}>{t("libraryEmpty")}</p>
        </div>
      ) : items.map(it=>{
        const title = pick(it.title, lang);
        return (
          <div key={it.id} className="card">
            <button className="thumb" onClick={()=>go({ view:{ type:"resource", id:it.id } }, title)} aria-label={"Open " + title}>{it.emoji}</button>
            <button style={{flex:1, textAlign:"left"}} onClick={()=>go({ view:{ type:"resource", id:it.id } }, title)}>
              <b>{title}</b>
              <div className="meta">{it.author} · {it.year}</div>
              <span className={"pill " + it.format.toLowerCase()}>{t(FILTER_KEYS[it.format] || it.format)}</span>
            </button>
            <button
              onClick={()=>toggleSave(it.id)}
              aria-label={saved.includes(it.id) ? t("removeSavedBtn") : t("saveForLaterBtn")}
              style={{color: saved.includes(it.id) ? "var(--green)" : "var(--muted)"}}>
              <I.bookmark fill={saved.includes(it.id) ? "currentColor" : "none"}/>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ============ stories ============ */
function Stories({ go, liked, toggleLike, myStories, sharedStories, t, lang }){
  const seen = new Set();
  const all = [...myStories, ...(sharedStories || []), ...STORIES].filter(s=>{
    if(seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
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
function Profile({ account, set, saved, myStories, go, notify, onRerunSetup, t, onLogout, onChangeLang, onReset, onResetProgress, onOpenInsights }){
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
          <div className="stat green"><b>{Math.round(Object.values(account.progress).reduce((a,b)=>a+b,0)/PATHS.length)}%</b><span>{t("statProgress")}</span></div>
        </div>
      </div>

      {s.showActivity !== false && (
        <div className="insight-card" style={{marginTop:12}}>
          <b>{t("activityLabel")}</b>
          {(account.activityDates || []).length === 0 ? (
            <p className="muted" style={{fontSize:"calc(12px * var(--fs))", marginTop:6}}>{t("activityNoneYet")}</p>
          ) : (
            <div style={{display:"flex", gap:18, marginTop:8}}>
              <div style={{display:"flex", alignItems:"center", gap:6}}>
                <I.flame style={{color:"var(--gold)"}}/>
                <span style={{fontFamily:"Fraunces,serif", fontWeight:700, fontSize:"calc(18px * var(--fs))"}}>{computeStreak(account.activityDates)}</span>
                <span className="muted" style={{fontSize:"calc(11.5px * var(--fs))"}}>{t("activityStreakSuffix")}</span>
              </div>
              <div style={{display:"flex", alignItems:"center", gap:6}}>
                <span style={{fontFamily:"Fraunces,serif", fontWeight:700, fontSize:"calc(18px * var(--fs))"}}>{computeWeekCount(account.activityDates)}</span>
                <span className="muted" style={{fontSize:"calc(11.5px * var(--fs))"}}>{t("activityWeekSuffix")}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="eyebrow section-label">{t("readingComfort")}</div>
      <div className="seg" role="group" aria-label={t("readingComfort")}>
        {[["sizeStandard",1],["sizeLarge",1.14],["sizeLargest",1.3],["sizeHuge",1.8]].map(([key,val])=>(
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
      <div className="setting" style={{alignItems:"center"}}>
        <span style={{flex:1}}><b>{t("darkModeTitle")}</b><small>{t("darkModeSub")}</small></span>
        <div className="seg" style={{width:"auto"}}>
          {[["darkModeOff","off"],["darkModeOn","on"],["darkModeSystem","system"]].map(([key,val])=>(
            <button key={val} className={normalizeDarkMode(s.darkMode) === val ? "on" : ""} onClick={()=>upd("darkMode", val)}>{t(key)}</button>
          ))}
        </div>
      </div>
      <Row title={t("readableFontTitle")} sub={t("readableFontSub")} on={s.readableFont} onToggle={()=>{
        const turningOn = !s.readableFont;
        upd("readableFont", turningOn);
        if(turningOn) upd("textSize", 1.8);
      }}/>
      <Row title={t("boldTextTitle")} sub={t("boldTextSub")} on={s.boldText} onToggle={()=>upd("boldText", !s.boldText)}/>
      <Row title={t("hapticsTitle")} sub={t("hapticsSub")} on={s.haptics} onToggle={()=>upd("haptics", !s.haptics)}/>

      <div className="eyebrow section-label">{t("colorFilterLabel")}</div>
      <p className="muted" style={{fontSize:"calc(11px * var(--fs))", marginTop:0, marginBottom:10, lineHeight:1.5}}>{t("colorFilterSub")}</p>
      <div className="seg" role="group" aria-label={t("colorFilterLabel")}>
        {[["colorFilterNone","none"],["colorFilterProtan","protanopia"],["colorFilterDeutan","deuteranopia"],["colorFilterTritan","tritanopia"]].map(([key,val])=>(
          <button key={val} className={(s.colorFilter||"none") === val ? "on" : ""} onClick={()=>upd("colorFilter", val)}>{t(key)}</button>
        ))}
      </div>

      <Row title={t("activityToggleTitle")} sub={t("activityToggleSub")} on={s.showActivity !== false} onToggle={()=>upd("showActivity", s.showActivity === false)}/>

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
      <button className="row-item" onClick={()=>go({ view:{ type:"about" } }, t("aboutRow"))}>
        <span className="row-icon"><I.info/></span>
        <span style={{flex:1}}><b>{t("aboutRow")}</b></span>
        <I.chevron style={{color:"var(--muted)"}}/>
      </button>
      <button className="row-item" onClick={()=>go({ view:{ type:"appBugReport" } }, t("appBugTitle"))}>
        <span className="row-icon"><I.flag/></span>
        <span style={{flex:1}}><b>{t("appBugRow")}</b><small>{t("appBugRowSub")}</small></span>
        <I.chevron style={{color:"var(--muted)"}}/>
      </button>
      <button className="row-item" onClick={onOpenInsights}>
        <span className="row-icon"><I.chart/></span>
        <span style={{flex:1}}><b>{t("insightsRow")}</b><small>{t("insightsSub")}</small></span>
        <I.chevron style={{color:"var(--muted)"}}/>
      </button>
      <button className="row-item" onClick={onResetProgress}>
        <span className="row-icon" style={{color:"var(--danger)"}}>↺</span>
        <span style={{flex:1}}><b>{t("resetProgressTitle")}</b><small>{t("resetProgressSub")}</small></span>
      </button>
      <button className="row-item" onClick={onReset}>
        <span className="row-icon" style={{color:"var(--danger)"}}>↺</span>
        <span style={{flex:1}}><b>{t("resetTitle")}</b><small>{t("resetSub")}</small></span>
      </button>
      <button className="row-item" onClick={()=>go({ view:{ type:"switchAccount" } }, t("switchAccountRow"))}>
        <span className="row-icon"><I.users/></span>
        <span style={{flex:1}}><b>{t("switchAccountRow")}</b><small>{t("switchAccountSub")}</small></span>
        <I.chevron style={{color:"var(--muted)"}}/>
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

const KIND_KEYS = { Research:"kindResearch", Story:"kindStory", Interview:"kindInterview" };
function ArticleView({ id, onBack, go, t, lang, onReport }){
  const a = ARTICLES.find(x=>x.id===id);
  if(a.storyId) return <StoryView id={a.storyId} onBack={onBack} t={t} lang={lang} onReport={onReport}/>;
  const body = pick(a.body, lang);
  const quote = pick(a.quote, lang);
  return (
    <Detail title={t(KIND_KEYS[a.kind] || "kindResearch")} onBack={onBack} onSwipeBack={onBack}>
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
          {t("readRelatedBtn")} <I.arrow/>
        </button>
        <ReportBox t={t} onSubmit={(r)=>onReport({ type:"article", id:a.id, ...r })}/>
      </article>
    </Detail>
  );
}

function StoryView({ id, onBack, liked, toggleLike, myStories, sharedStories, t, lang, onReport, onDelete }){
  const all = [...(myStories||[]), ...(sharedStories||[]), ...STORIES];
  const s = all.find(x=>x.id===id) || STORIES[0];
  const on = (liked||[]).includes(s.id);
  const body = pick(s.body, lang) || [];
  const isMine = (myStories||[]).some(m=>m.id===s.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <Detail title={t ? t("storyLabel") : "Story"} onBack={onBack} onSwipeBack={onBack}
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

        {isMine && onDelete && (
          confirmDelete ? (
            <div className="card" style={{display:"block", marginTop:18, borderColor:"var(--danger)"}}>
              <p style={{fontSize:"calc(13px * var(--fs))", margin:0}}>{t("deleteStoryConfirm")}</p>
              <div style={{display:"flex", gap:8, marginTop:12}}>
                <button className="cta" style={{flex:1, background:"var(--danger)"}} onClick={()=>onDelete(s)}>{t("deleteStoryYes")}</button>
                <button className="cta" style={{flex:1, background:"var(--cream-2)", color:"var(--navy)"}} onClick={()=>setConfirmDelete(false)}>{t("deleteStoryCancel")}</button>
              </div>
            </div>
          ) : (
            <button className="report-toggle" style={{marginTop:18, color:"var(--danger)"}} onClick={()=>setConfirmDelete(true)}>
              {t("deleteStoryBtn")}
            </button>
          )
        )}

        {t ? <ReportBox t={t} onSubmit={(r)=>onReport && onReport({ type:"story", id:s.id, ...r })}/> : null}
      </article>
    </Detail>
  );
}

function ResourceView({ id, onBack, saved, toggleSave, notify, t, lang, onReport, myVote, rating, onRate }){
  const r = LIBRARY.find(x=>x.id===id);
  const isSaved = saved.includes(r.id);
  const [showText, setShowText] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const title = pick(r.title, lang);
  const meta = pick(r.meta, lang);
  const description = pick(r.description, lang);
  const content = pick(r.content, lang) || [];
  const rHelpful = (rating && rating.helpful) || 0;
  const rNot = (rating && rating.notHelpful) || 0;

  const playAudio = ()=>{
    const body = content.length ? content.join(" ") : (description || meta || "");
    speakText(title + ". " + body);
  };

  return (
    <Detail title={r.format} onBack={onBack} onSwipeBack={onBack}>
      <div style={{display:"flex", gap:14, alignItems:"center", marginBottom:18}}>
        <div className="thumb" style={{width:64, height:64, fontSize:28, borderRadius:16, background:"var(--cream-2)", display:"grid", placeItems:"center"}}>{r.emoji}</div>
        <div>
          <h1 style={{fontSize:"calc(20px * var(--fs))", lineHeight:1.25}}>{title}</h1>
          <div className="muted" style={{fontSize:"calc(12px * var(--fs))", marginTop:4}}>{r.author} · {r.year}</div>
        </div>
      </div>
      <p className="muted" style={{fontSize:"calc(13px * var(--fs))", lineHeight:1.6}}>{meta}</p>
      <div className="card" style={{display:"block"}}>
        <b style={{marginBottom:8}}>{t("a11yLabel")}</b>
        {[t("a11yScreenReader"), t("a11yAltText"), t("a11yAdjustable"), r.format==="Audio" ? t("a11yTranscript") : t("a11yLargePrint")].map(x=>(
          <div key={x} style={{display:"flex", gap:9, alignItems:"center", padding:"5px 0", fontSize:"calc(12.5px * var(--fs))"}}>
            <span style={{color:"var(--green)"}}><I.check/></span> {x}
          </div>
        ))}
      </div>

      <div style={{display:"flex", gap:8, marginTop:6}}>
        {r.hasAudio && (
          <button className="lib-btn audio" style={{flex:1, justifyContent:"center", padding:"13px 14px"}} onClick={playAudio}>
            <I.play/> {t("libraryAudioBtn")}
          </button>
        )}
        {r.hasRead && content.length > 0 && (
          <button className="lib-btn read" style={{flex:1, justifyContent:"center", padding:"13px 14px"}} onClick={()=>setShowText(v=>!v)}>
            {t("libraryReadBtn")}
          </button>
        )}
      </div>

      {showText && content.length > 0 && (
        <div className="card" style={{display:"block", marginTop:14}}>
          {content.map((p,i)=>(
            <p key={i} style={{fontSize:"calc(14.5px * var(--fs))", lineHeight:1.75, margin:"9px 0", color:"var(--body-text)"}}>{p}</p>
          ))}
        </div>
      )}

      {onRate && (
        <div style={{display:"flex", gap:8, marginTop:14}}>
          <button className={"chip" + (myVote === "helpful" ? " on" : "")} style={{display:"flex", alignItems:"center", gap:6}} onClick={()=>onRate(r.id, "helpful")}>
            <I.thumbsUp/> {t("ratingHelpful")} · {rHelpful}
          </button>
          <button className={"chip" + (myVote === "not" ? " on" : "")} style={{display:"flex", alignItems:"center", gap:6}} onClick={()=>onRate(r.id, "not")}>
            <I.thumbsDown/> {t("ratingNotHelpful")} · {rNot}
          </button>
        </div>
      )}

      <button className="cta" style={{marginTop:14, background:"var(--cream-2)", color:"var(--navy)"}} onClick={()=>toggleSave(r.id)}>
        {isSaved ? t("removeSavedBtn") : t("saveForLaterBtn")}
      </button>

      {(r.transcript || r.altTexts) && (
        <div style={{marginTop:16}}>
          <button className="report-toggle" onClick={()=>setShowExtra(v=>!v)}>
            <I.doc/> {r.transcript ? t("showTranscriptBtn") : t("showAltTextBtn")}
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

function LessonView({ pathId, onBack, progress, setProgress, notify, t, lang }){
  const path = PATHS.find(p=>p.id===pathId);
  const total = path.lessons.length;
  const v = progress[pathId];
  const doneCount = Math.min(total, Math.round(v / 100 * total));
  const idx = Math.min(doneCount, total - 1);
  const lesson = path.lessons[idx];
  const isReviewing = v >= 100;

  return (
    <Detail title={pick(path.title, lang)} onBack={onBack} onSwipeBack={onBack}>
      <div className="eyebrow">{t("lessonWord")} {idx + 1} / {total}</div>
      <h1 style={{fontSize:"calc(21px * var(--fs))", marginTop:8, lineHeight:1.3}}>{pick(lesson.title, lang)}</h1>
      <p style={{fontSize:"calc(14.5px * var(--fs))", lineHeight:1.75, marginTop:14, color:"var(--body-text)"}}>{pick(lesson.body, lang)}</p>

      <div className="progress" style={{marginTop:22}}><i style={{width:v + "%"}}/></div>
      <div className="muted" style={{fontSize:"calc(11.5px * var(--fs))", marginTop:6}}>{v}% {t("completeWord")}</div>

      <button className="cta" style={{marginTop:16}} onClick={()=>{
        if(isReviewing){ onBack(); return; }
        const next = Math.min(100, v + Math.ceil(100 / total));
        setProgress(pathId, next);
        notify(next >= 100 ? t("pathwayDone") : t("lessonDone"));
        if(next >= 100) onBack();
      }}>
        {isReviewing ? t("continueCta") : t("markDoneBtn")} <I.arrow/>
      </button>
    </Detail>
  );
}

function QuizView({ pathId, onBack, t, lang }){
  const path = PATHS.find(p=>p.id===pathId);
  const quiz = path.quiz || [];
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [done, setDone] = useState(false);

  if(quiz.length === 0){
    return (
      <Detail title={t("quizTitle")} onBack={onBack} onSwipeBack={onBack}>
        <p className="muted">{t("libraryEmpty")}</p>
      </Detail>
    );
  }

  const q = quiz[idx];
  const options = pick(q.options, lang);
  const isLast = idx === quiz.length - 1;

  const choose = (i)=>{
    if(picked !== null) return;
    setPicked(i);
    if(i === q.correct) setCorrectCount(c=>c+1);
  };
  const next = ()=>{
    if(isLast){ setDone(true); return; }
    setIdx(idx+1);
    setPicked(null);
  };

  if(done){
    return (
      <Detail title={t("quizTitle")} onBack={onBack} onSwipeBack={onBack}>
        <div style={{textAlign:"center", marginTop:30}}>
          <div style={{fontSize:40}}>🎉</div>
          <h1 className="serif" style={{fontSize:"calc(20px * var(--fs))", marginTop:12}}>{t("quizDoneTitle")}</h1>
          <p className="muted" style={{fontSize:"calc(13.5px * var(--fs))", marginTop:8}}>
            {t("quizDoneBody").replace("{n}", correctCount).replace("{total}", quiz.length)}
          </p>
          <button className="cta" style={{marginTop:20}} onClick={onBack}>{t("continueCta")} <I.arrow/></button>
        </div>
      </Detail>
    );
  }

  return (
    <Detail title={t("quizTitle")} onBack={onBack} onSwipeBack={onBack}>
      <div className="eyebrow">{idx + 1} / {quiz.length}</div>
      <h1 style={{fontSize:"calc(18px * var(--fs))", marginTop:8, lineHeight:1.35}}>{pick(q.q, lang)}</h1>
      <div style={{marginTop:16}}>
        {options.map((opt,i)=>{
          const isCorrect = i === q.correct;
          const isPicked = i === picked;
          let cls = "format-card";
          if(picked !== null && isCorrect) cls += " on";
          return (
            <button key={i} className={cls} onClick={()=>choose(i)} disabled={picked !== null}
                    style={picked !== null && isPicked && !isCorrect ? { borderColor:"var(--danger)", background:"rgba(180,84,63,.08)" } : undefined}>
              <span style={{flex:1, textAlign:"left"}}>{opt}</span>
              {picked !== null && isCorrect ? <I.check style={{color:"var(--green)"}}/> : null}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <button className="cta" style={{marginTop:16}} onClick={next}>
          {isLast ? t("quizFinishBtn") : t("quizNextBtn")} <I.arrow/>
        </button>
      )}
    </Detail>
  );
}

function CertificateView({ pathId, onBack, accountName, t, lang }){
  const canvasRef = useRef(null);
  const path = PATHS.find(p=>p.id===pathId);
  const title = pick(path.title, lang);
  const dateStr = new Date().toLocaleDateString(lang === "ru" ? "ru-RU" : lang === "uz" ? "uz-UZ" : "en-US", { year:"numeric", month:"long", day:"numeric" });

  useEffect(()=>{
    const canvas = canvasRef.current;
    if(!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = 900, H = 640;
    canvas.width = W; canvas.height = H;

    const draw = ()=>{
      ctx.fillStyle = "#F7F4EA";
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = "#16243F";
      ctx.lineWidth = 3;
      ctx.strokeRect(28, 28, W - 56, H - 56);
      ctx.strokeStyle = "#D8A340";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(40, 40, W - 80, H - 80);

      ctx.fillStyle = "#16243F";
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(W/2 - 30, 68, 60, 60, 16) : ctx.rect(W/2 - 30, 68, 60, 60);
      ctx.fill();
      ctx.fillStyle = "#D8A340";
      ctx.font = "700 30px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("M", W/2, 108);

      ctx.fillStyle = "#16243F";
      ctx.font = "italic 700 40px Georgia, 'Times New Roman', serif";
      ctx.fillText(t("certificateHeading"), W/2, 195);

      ctx.strokeStyle = "#D8A340";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(W/2 - 90, 215); ctx.lineTo(W/2 + 90, 215); ctx.stroke();

      ctx.fillStyle = "#3A465E";
      ctx.font = "16px Georgia, serif";
      ctx.fillText(t("certificateTitle"), W/2, 250);

      ctx.fillStyle = "#16243F";
      ctx.font = "700 44px Georgia, serif";
      ctx.fillText(accountName || "—", W/2, 320);

      ctx.fillStyle = "#3A465E";
      ctx.font = "17px Georgia, serif";
      ctx.fillText(t("certificateCompletedText"), W/2, 360);

      ctx.fillStyle = "#16243F";
      ctx.font = "italic 600 26px Georgia, serif";
      wrapText(ctx, title, W/2, 410, W - 220, 32);

      ctx.fillStyle = "#8C8778";
      ctx.font = "14px Georgia, serif";
      ctx.fillText(t("certificateDatePrefix") + ": " + dateStr, W/2, 500);

      ctx.fillStyle = "#8C8778";
      ctx.font = "12px Georgia, serif";
      ctx.fillText(t("certificateFooter"), W/2, H - 60);
    };

    function wrapText(context, text, x, y, maxWidth, lineHeight){
      const words = text.split(" ");
      let line = "", lines = [];
      for(let i=0;i<words.length;i++){
        const test = line + words[i] + " ";
        if(context.measureText(test).width > maxWidth && i > 0){ lines.push(line); line = words[i] + " "; }
        else line = test;
      }
      lines.push(line);
      const startY = y - (lines.length - 1) * lineHeight / 2;
      lines.forEach((l, i)=> context.fillText(l.trim(), x, startY + i * lineHeight));
    }

    if(document.fonts && document.fonts.ready){ document.fonts.ready.then(draw); } else { draw(); }
    draw();
  }, [pathId, lang, accountName]);

  const download = ()=>{
    const canvas = canvasRef.current;
    if(!canvas) return;
    const url = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = url; link.download = "mwm-certificate.png";
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  return (
    <Detail title={t("certificateTitle")} onBack={onBack} onSwipeBack={onBack}>
      <div style={{borderRadius:16, overflow:"hidden", boxShadow:"0 8px 30px rgba(0,0,0,.15)"}}>
        <canvas ref={canvasRef} style={{width:"100%", display:"block"}}/>
      </div>
      <button className="cta" style={{marginTop:16}} onClick={download}>
        <I.download/> {t("certificateDownload")}
      </button>
    </Detail>
  );
}

function SwitchAccountView({ onBack, accounts, currentEmail, onSwitch, onAddNew, t }){
  const others = Object.values(accounts).filter(a=>a.email !== currentEmail);
  const current = accounts[currentEmail];
  return (
    <Detail title={t("switchAccountTitle")} onBack={onBack} onSwipeBack={onBack}>
      {current && (
        <div className="row-item" style={{background:"var(--cream-2)", borderRadius:14, marginBottom:14}}>
          <span className="avatar" style={{width:38, height:38, fontSize:15}}>{(current.name || "?").slice(0,1).toUpperCase()}</span>
          <span style={{flex:1}}><b>{current.name}</b><small>{current.email}</small></span>
          <span className="lib-tag">{t("switchAccountCurrent")}</span>
        </div>
      )}
      {others.length > 0 && <div className="eyebrow section-label">{t("switchAccountSub")}</div>}
      {others.map(a=>(
        <button key={a.email} className="row-item" onClick={()=>onSwitch(a.email)}>
          <span className="avatar" style={{width:38, height:38, fontSize:15}}>{(a.name || "?").slice(0,1).toUpperCase()}</span>
          <span style={{flex:1}}><b>{a.name}</b><small>{a.email}</small></span>
          <I.chevron style={{color:"var(--muted)"}}/>
        </button>
      ))}
      <button className="cta" style={{marginTop:16, background:"var(--cream-2)", color:"var(--navy)"}} onClick={onAddNew}>
        <I.plus/> {t("switchAccountAddNew")}
      </button>
    </Detail>
  );
}

function GlobalSearch({ onBack, go, sharedStories, t, lang }){
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const libResults = useMemo(()=>{
    if(!query) return [];
    return LIBRARY.filter(it=>{
      const title = pick(it.title, lang).toLowerCase();
      const desc = (pick(it.description, lang) || pick(it.meta, lang) || "").toLowerCase();
      const content = (pick(it.content, lang) || []).join(" ").toLowerCase();
      return title.includes(query) || desc.includes(query) || content.includes(query) || it.author.toLowerCase().includes(query);
    });
  }, [query, lang]);

  const storyResults = useMemo(()=>{
    if(!query) return [];
    return [...(sharedStories || []), ...STORIES].filter(s=>{
      const title = pick(s.title, lang).toLowerCase();
      const body = (pick(s.body, lang) || []).join(" ").toLowerCase();
      return title.includes(query) || body.includes(query) || s.author.toLowerCase().includes(query) || s.country.toLowerCase().includes(query);
    });
  }, [query, lang, sharedStories]);

  const articleResults = useMemo(()=>{
    if(!query) return [];
    return ARTICLES.filter(a=>{
      const title = pick(a.title, lang).toLowerCase();
      const body = (pick(a.body, lang) || []).join(" ").toLowerCase();
      return title.includes(query) || body.includes(query);
    });
  }, [query, lang]);

  const total = libResults.length + storyResults.length + articleResults.length;

  return (
    <Detail title={t("globalSearchTitle")} onBack={onBack} onSwipeBack={onBack}>
      <div className="search" style={{marginBottom:16}}>
        <I.search style={{color:"var(--muted)"}}/>
        <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder={t("globalSearchPlaceholder")} aria-label={t("globalSearchPlaceholder")}/>
      </div>

      {!query ? (
        <p className="muted" style={{fontSize:"calc(13px * var(--fs))", lineHeight:1.6}}>{t("globalSearchHint")}</p>
      ) : total === 0 ? (
        <div className="empty">
          <div className="emoji">🔍</div>
          <p className="muted" style={{fontSize:13}}>{t("libraryEmpty")}</p>
        </div>
      ) : (
        <React.Fragment>
          {libResults.length > 0 && (
            <React.Fragment>
              <div className="eyebrow section-label">{t("tileLibraryTitle")}</div>
              {libResults.map(it=>(
                <button key={it.id} className="row-item" onClick={()=>go({ view:{ type:"resource", id:it.id } }, pick(it.title, lang))}>
                  <span className="row-icon">{it.emoji}</span>
                  <span style={{flex:1}}><b>{pick(it.title, lang)}</b><small>{pick(it.description, lang) || pick(it.meta, lang)}</small></span>
                  <I.chevron style={{color:"var(--muted)"}}/>
                </button>
              ))}
            </React.Fragment>
          )}
          {storyResults.length > 0 && (
            <React.Fragment>
              <div className="eyebrow section-label">{t("navStories")}</div>
              {storyResults.map(s=>(
                <button key={s.id} className="row-item" onClick={()=>go({ view:{ type:"story", id:s.id } }, pick(s.title, lang))}>
                  <span className="row-icon"><I.stories/></span>
                  <span style={{flex:1}}><b>{pick(s.title, lang)}</b><small>{s.author} · {s.country}</small></span>
                  <I.chevron style={{color:"var(--muted)"}}/>
                </button>
              ))}
            </React.Fragment>
          )}
          {articleResults.length > 0 && (
            <React.Fragment>
              <div className="eyebrow section-label">{t("recentLabel")}</div>
              {articleResults.map(a=>(
                <button key={a.id} className="row-item" onClick={()=>go({ view:{ type:"article", id:a.id } }, pick(a.title, lang))}>
                  <span className="row-icon"><I.doc/></span>
                  <span style={{flex:1}}><b>{pick(a.title, lang)}</b><small>{t(KIND_KEYS[a.kind] || "kindResearch")}</small></span>
                  <I.chevron style={{color:"var(--muted)"}}/>
                </button>
              ))}
            </React.Fragment>
          )}
        </React.Fragment>
      )}
    </Detail>
  );
}

function OnboardTour({ t, onDone }){
  const [step, setStep] = useState(0);
  const steps = [
    { titleKey:"tour1Title", bodyKey:"tour1Body" },
    { titleKey:"tour2Title", bodyKey:"tour2Body" },
    { titleKey:"tour3Title", bodyKey:"tour3Body" },
    { titleKey:"tour4Title", bodyKey:"tour4Body" },
    { titleKey:"tour5Title", bodyKey:"tour5Body" }
  ];
  const s = steps[step];
  const isLast = step === steps.length - 1;
  return (
    <div className="tour-overlay">
      <div className="tour-card">
        <h2 className="serif" style={{fontSize:"calc(19px * var(--fs))", margin:0}}>{t(s.titleKey)}</h2>
        <p style={{fontSize:"calc(13.5px * var(--fs))", lineHeight:1.6, marginTop:10, color:"var(--body-text)"}}>{t(s.bodyKey)}</p>
        <div className="tour-dots">
          {steps.map((_,i)=><span key={i} className={"tour-dot" + (i===step ? " on" : "")}/>)}
        </div>
        <div style={{display:"flex", gap:10, marginTop:18}}>
          <button className="link-btn muted" onClick={onDone}>{t("tourSkip")}</button>
          <button className="cta" style={{flex:1}} onClick={()=>{ if(isLast) onDone(); else setStep(step+1); }}>
            {isLast ? t("tourDone") : t("tourNext")}
          </button>
        </div>
      </div>
    </div>
  );
}

function AppBugReportView({ onBack, notify, t }){
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const ok = text.trim().length > 5;
  const submit = ()=>{
    if(!ok) return;
    addAppBug({ source:"user", description:text.trim() });
    setSent(true);
    notify(t("appBugSentToast"));
  };
  return (
    <Detail title={t("appBugTitle")} onBack={onBack} onSwipeBack={onBack}>
      <p className="muted" style={{fontSize:"calc(13px * var(--fs))", marginTop:0, lineHeight:1.6}}>{t("appBugIntro")}</p>
      {sent ? (
        <div className="card" style={{display:"block", textAlign:"center", padding:24}}>
          <div style={{fontSize:30}}>✅</div>
          <p style={{marginTop:8, fontSize:"calc(13.5px * var(--fs))"}}>{t("appBugSentToast")}</p>
        </div>
      ) : (
        <React.Fragment>
          <div className="field">
            <label htmlFor="bug-desc">{t("appBugFieldLabel")}</label>
            <textarea id="bug-desc" rows={7} value={text} onChange={e=>setText(e.target.value)} placeholder={t("appBugPlaceholder")}/>
          </div>
          <button className="cta" style={{opacity: ok ? 1 : .45}} disabled={!ok} onClick={submit}>
            {t("appBugSubmitBtn")} <I.arrow/>
          </button>
        </React.Fragment>
      )}
    </Detail>
  );
}

function AboutView({ onBack, t }){
  const features = ["aboutFeatureVoice","aboutFeatureScan","aboutFeatureTranscript","aboutFeatureOffline","aboutFeatureLangs"];
  return (
    <Detail title={t("aboutTitle")} onBack={onBack} onSwipeBack={onBack}>
      <div style={{textAlign:"center", margin:"6px 0 20px"}}>
        <div className="logo-tile" style={{margin:"0 auto"}}>M</div>
        <div className="wordmark serif" style={{fontSize:30, marginTop:12}}>M<span className="g">W</span>M</div>
      </div>
      <p style={{fontSize:"calc(14px * var(--fs))", lineHeight:1.7, color:"var(--body-text)"}}>{t("aboutIntro")}</p>

      <div className="eyebrow section-label">{t("aboutFeaturesLabel")}</div>
      {features.map(k=>(
        <div key={k} style={{display:"flex", gap:9, alignItems:"flex-start", padding:"6px 0", fontSize:"calc(13px * var(--fs))"}}>
          <span style={{color:"var(--green)", marginTop:2}}><I.check/></span> {t(k)}
        </div>
      ))}

      <div className="eyebrow section-label">{t("aboutVersionLabel")}</div>
      <p className="muted" style={{fontSize:"calc(12.5px * var(--fs))"}}>MWM 1.0</p>

      <p className="muted" style={{fontSize:11, textAlign:"center", margin:"28px 0 6px", letterSpacing:".06em"}}>
        {t("aboutFooter")}
      </p>
    </Detail>
  );
}

function InsightsView({ onBack, accounts, reports, appBugs, t }){
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

      <div className="insight-card">
        <b>{t("insightsReportsList")}</b>
        {(reports||[]).length === 0 ? (
          <p className="muted" style={{fontSize:"calc(12px * var(--fs))"}}>{t("insightsNoReports")}</p>
        ) : (
          <React.Fragment>
            {reports.map(r=>(
              <div key={r.id} style={{padding:"9px 0", borderBottom:"1px solid var(--line)"}}>
                <div style={{display:"flex", justifyContent:"space-between", gap:8}}>
                  <b style={{fontSize:"calc(12px * var(--fs))"}}>{r.type} · {r.reason}</b>
                  <span className="muted" style={{fontSize:"calc(10.5px * var(--fs))", flex:"none"}}>{new Date(r.at).toLocaleDateString()}</span>
                </div>
                {r.note ? <p style={{fontSize:"calc(12px * var(--fs))", margin:"4px 0 0", color:"var(--body-text)"}}>{r.note}</p> : null}
              </div>
            ))}
            <button className="lib-btn read" style={{marginTop:12}} onClick={()=>{
              const rows = [["id","type","targetId","reason","note","lang","at"]].concat(
                reports.map(r=>[r.id, r.type, r.targetId, r.reason, (r.note||"").replace(/[\n,"]/g," "), r.lang, r.at])
              );
              const csv = rows.map(row=>row.map(cell=>`"${String(cell).replace(/"/g,'""')}"`).join(",")).join("\n");
              const blob = new Blob([csv], { type:"text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url; link.download = "mwm-reports.csv";
              document.body.appendChild(link); link.click(); document.body.removeChild(link);
              URL.revokeObjectURL(url);
            }}>
              <I.upload/> {t("insightsExportCsv")}
            </button>
          </React.Fragment>
        )}
      </div>
      <div className="insight-card">
        <b>{t("appBugsListLabel")}</b>
        {(appBugs || []).length === 0 ? (
          <p className="muted" style={{fontSize:"calc(12px * var(--fs))"}}>{t("insightsNoReports")}</p>
        ) : (
          [...appBugs].reverse().map(b=>(
            <div key={b.id} style={{padding:"9px 0", borderBottom:"1px solid var(--line)"}}>
              <div style={{display:"flex", justifyContent:"space-between", gap:8}}>
                <b style={{fontSize:"calc(12px * var(--fs))"}}>{b.source === "crash" ? t("appBugSourceCrash") : b.source === "sync" ? t("appBugSourceSync") : t("appBugSourceUser")}</b>
                <span className="muted" style={{fontSize:"calc(10.5px * var(--fs))", flex:"none"}}>{new Date(b.at).toLocaleDateString()}</span>
              </div>
              <p style={{fontSize:"calc(12px * var(--fs))", margin:"4px 0 0", color:"var(--body-text)"}}>{b.description || b.message}</p>
            </div>
          ))
        )}
      </div>
      <p className="muted" style={{fontSize:"calc(11.5px * var(--fs))", lineHeight:1.5}}>{t("insightsNote")}</p>
    </Detail>
  );
}

function PathsView({ onBack, progress, setProgress, notify, t, lang, onOpenLesson, onOpenCertificate, onOpenQuiz }){
  return (
    <Detail title={t("tileHubTitle")} onBack={onBack} onSwipeBack={onBack}>
      <p className="muted" style={{fontSize:"calc(13px * var(--fs))", marginTop:0, lineHeight:1.6}}>
        {t("pathHubSubtitle")}
      </p>
      {PATHS.map(p=>{
        const v = progress[p.id];
        const title = pick(p.title, lang);
        const level = pick(p.level, lang);
        const total = p.lessons.length;
        return (
          <div key={p.id} className="card" style={{display:"block"}}>
            <div style={{display:"flex", gap:12, alignItems:"flex-start"}}>
              <span className="thumb">{p.emoji}</span>
              <span style={{flex:1}}>
                <b>{title}</b>
                <div className="meta">{total} {t("lessonsWord")} · {p.mins} {t("minWord")} · {level}</div>
              </span>
            </div>
            <div className="progress"><i style={{width:v + "%"}}/></div>
            <div style={{display:"flex", alignItems:"center", gap:10, marginTop:10, flexWrap:"wrap"}}>
              <span className="muted" style={{fontSize:"calc(11.5px * var(--fs))"}}>{v}% {t("completeWord")}</span>
              {v>=100 && (
                <React.Fragment>
                  <button
                    style={{fontWeight:600, color:"var(--gold)", fontSize:"calc(12.5px * var(--fs))", display:"flex", alignItems:"center", gap:5}}
                    onClick={()=>onOpenCertificate(p.id)}>
                    <I.award/> {t("certificateBtn")}
                  </button>
                  <button
                    style={{fontWeight:600, color:"var(--navy)", fontSize:"calc(12.5px * var(--fs))", display:"flex", alignItems:"center", gap:5}}
                    onClick={()=>onOpenQuiz(p.id)}>
                    <I.check/> {t("quizBtn")}
                  </button>
                </React.Fragment>
              )}
              <button
                style={{marginLeft:"auto", fontWeight:600, color:"var(--green)", fontSize:"calc(12.5px * var(--fs))"}}
                onClick={()=>onOpenLesson(p.id)}>
                {v>=100 ? t("pathReview") : v===0 ? t("pathStart") : t("continueCta")}
              </button>
            </div>
          </div>
        );
      })}
    </Detail>
  );
}

/* ============ scan text (client-side OCR, no server) ============ */
const OCR_LANG_OPTIONS = [
  { code:"ru", tess:"rus", labelKey:"scanLangRu" },
  { code:"uk", tess:"ukr", labelKey:"scanLangUk" },
  { code:"uz", tess:"uzb", labelKey:"scanLangUz" },
  { code:"en", tess:"eng", labelKey:"scanLangEn" }
];
// Real camera photos have color noise, uneven lighting and JPEG artifacts that
// hurt OCR accuracy. Converting to high-contrast grayscale and upscaling small
// images before handing them to Tesseract is a standard technique that measurably
// improves real-world recognition accuracy.
function preprocessImageForOcr(url){
  return new Promise((resolve)=>{
    try{
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = ()=>{
        try{
          const MAX_DIM = 2000, MIN_DIM = 1200;
          let scale = 1;
          const longSide = Math.max(img.naturalWidth, img.naturalHeight);
          if(longSide > MAX_DIM) scale = MAX_DIM / longSide;
          else if(longSide < MIN_DIM) scale = MIN_DIM / longSide;
          const w = Math.round(img.naturalWidth * scale);
          const h = Math.round(img.naturalHeight * scale);

          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);

          const imgData = ctx.getImageData(0, 0, w, h);
          const d = imgData.data;
          const contrast = 1.35; // >1 sharpens the split between ink and background
          for(let i = 0; i < d.length; i += 4){
            const gray = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
            let v = (gray - 128) * contrast + 128;
            v = Math.max(0, Math.min(255, v));
            d[i] = d[i+1] = d[i+2] = v;
          }
          ctx.putImageData(imgData, 0, 0);
          canvas.toBlob(blob=>{
            if(blob) resolve(URL.createObjectURL(blob));
            else resolve(url);
          }, "image/png");
        }catch(e){ resolve(url); }
      };
      img.onerror = ()=>resolve(url);
      img.src = url;
    }catch(e){ resolve(url); }
  });
}
// Tesseract sometimes turns visual noise (edges, dust, JPEG artifacts) into stray
// punctuation-only "words" — a lone |, \, ', ", or similar with no letters or digits
// around it. Stripping those is safe: it only removes tokens that carry no actual
// content, never touches a real word, so it can't turn a correct letter into a wrong
// one.
function cleanupOcrNoise(raw){
  return raw
    .split("\n")
    .map(line=>
      line
        .split(/\s+/)
        .filter(tok=>tok.length === 0 || /[\p{L}\p{N}]/u.test(tok))
        .join(" ")
    )
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function ScanText({ onBack, t, lang, notify }){
  const [imgSrc, setImgSrc] = useState(null);
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState("idle"); // idle | processing | done | empty | lowConfidence
  const [confidence, setConfidence] = useState(null);
  const [ocrLang, setOcrLang] = useState(()=> OCR_LANG_OPTIONS.some(o=>o.code===lang) ? lang : "ru");
  const fileRef = useRef(null);

  const MIN_CONFIDENCE = 45; // Tesseract's own 0-100 confidence score for the result

  const runOcr = async (url, tessCode)=>{
    setStatus("processing");
    setText("");
    setConfidence(null);
    try{
      const preprocessedUrl = await preprocessImageForOcr(url);
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(tessCode);
      const { data } = await worker.recognize(preprocessedUrl);
      await worker.terminate();
      const cleaned = cleanupOcrNoise((data.text || "").trim());
      const conf = typeof data.confidence === "number" ? data.confidence : 100;
      setConfidence(conf);
      if(!cleaned){
        setStatus("empty");
      }else if(conf < MIN_CONFIDENCE){
        // Tesseract itself is not confident in this result — showing it as real text
        // would be misleading, so we surface an honest "couldn't read this reliably"
        // state instead of displaying garbled output.
        setText(cleaned);
        setStatus("lowConfidence");
      }else{
        setText(cleaned);
        setStatus("done");
      }
    }catch(e){
      setStatus("empty");
    }
  };
  const onPick = (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    const url = URL.createObjectURL(f);
    setFile(f);
    setImgSrc(url);
    const tessCode = (OCR_LANG_OPTIONS.find(o=>o.code===ocrLang) || {}).tess || "eng";
    runOcr(url, tessCode);
  };
  const changeLangAndRerun = (code)=>{
    setOcrLang(code);
    if(imgSrc){
      const tessCode = (OCR_LANG_OPTIONS.find(o=>o.code===code) || {}).tess || "eng";
      runOcr(imgSrc, tessCode);
    }
  };
  const copyText = ()=>{
    try{ navigator.clipboard.writeText(text); notify(t("scanCopied")); }catch(e){}
  };

  return (
    <Detail title={t("scanTitle")} onBack={onBack} onSwipeBack={onBack}>
      <p className="choice-quote" style={{fontSize:"calc(15px * var(--fs))"}}>{t("scanSub")}</p>

      <div className="eyebrow section-label">{t("scanLangLabel")}</div>
      <div className="chips" style={{paddingBottom:6}}>
        {OCR_LANG_OPTIONS.map(o=>(
          <button key={o.code} className={"chip" + (ocrLang === o.code ? " on" : "")} onClick={()=>changeLangAndRerun(o.code)}>
            {t(o.labelKey)}
          </button>
        ))}
      </div>
      <p className="muted" style={{fontSize:"calc(11px * var(--fs))", marginTop:0, marginBottom:10, lineHeight:1.5}}>{t("scanLangHint")}</p>

      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={onPick}/>

      {imgSrc && (
        <img src={imgSrc} alt="" style={{width:"100%", borderRadius:14, marginTop:6, maxHeight:180, objectFit:"cover"}}/>
      )}

      <button className="cta" style={{marginTop:14}} onClick={()=>fileRef.current && fileRef.current.click()}>
        <I.upload/> {imgSrc ? t("scanRetake") : t("scanTakePhoto")}
      </button>
      <p className="muted" style={{fontSize:"calc(11px * var(--fs))", marginTop:8, lineHeight:1.5}}>{t("scanScreenTip")}</p>

      {status === "processing" && (
        <div className="rec-box" style={{marginTop:16}}>
          <div className="rec-timer" style={{fontSize:"calc(16px * var(--fs))"}}><span className="rec-dot"/>{t("scanProcessing")}</div>
        </div>
      )}

      {status === "empty" && (
        <p className="muted" style={{marginTop:16, fontSize:"calc(13px * var(--fs))"}}>{t("scanEmpty")}</p>
      )}

      {status === "lowConfidence" && (
        <div className="card" style={{display:"block", marginTop:16, borderColor:"var(--danger)"}}>
          <div style={{display:"flex", gap:9, alignItems:"flex-start"}}>
            <span style={{fontSize:20}}>⚠️</span>
            <p style={{fontSize:"calc(13px * var(--fs))", lineHeight:1.6, margin:0}}>{t("scanLowConfidence")}</p>
          </div>
          <button className="report-toggle" style={{marginTop:12}} onClick={()=>setStatus("done")}>
            {t("scanShowAnyway")}
          </button>
        </div>
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
          <div className="hint">{body.trim().length} {t("charsMinWord")}</div>
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
        {t("publishStoryBtn")} <I.arrow/>
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
function AppInner(){
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
  const [sharedStories, setSharedStories] = useState([]);
  useEffect(()=>{
    let cancelled = false;
    fetchSharedStories().then(list=>{ if(!cancelled) setSharedStories(list); });
    return ()=>{ cancelled = true; };
  }, []);
  useEffect(()=>{
    if(tab !== "stories" || view) return;
    let cancelled = false;
    fetchSharedStories().then(list=>{ if(!cancelled) setSharedStories(list); });
    return ()=>{ cancelled = true; };
  }, [tab]);
  const [ratings, setRatings] = useState(loadRatings);
  const [systemDark, setSystemDark] = useState(()=> typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [tgUser, setTgUser] = useState(null);
  const scrollRef = useRef(null);
  const deviceScreenRef = useRef(null);
  const touchRef = useRef({ x:0, y:0 });
  const ds = useDeviceScale(deviceScreenRef);

  const account = session ? accounts[session.email] : null;

  useEffect(()=>{
    if(typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e)=>setSystemDark(e.matches);
    if(mq.addEventListener) mq.addEventListener("change", handler); else mq.addListener(handler);
    return ()=>{ if(mq.removeEventListener) mq.removeEventListener("change", handler); else mq.removeListener(handler); };
  }, []);
  useEffect(()=>{ saveRatings(ratings); }, [ratings]);
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
    try{ if(tg.initDataUnsafe && tg.initDataUnsafe.user){ setTgUser(tg.initDataUnsafe.user); logToTelegram(tg.initDataUnsafe.user, "open"); } }catch(e){}
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
    if(to.view){
      setView(to.view);
      const trackable = ["resource","story","article","lesson"];
      if(session && trackable.includes(to.view.type) && label){
        updateAccount(session.email, p=>({ ...p, lastViewed: { type: to.view.type, id: to.view.id, title: label, at: new Date().toISOString() } }));
      }
    }
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
  const rateResource = (resourceId, vote)=>{
    if(!session || !account) return;
    const prevVote = account.myRatings ? account.myRatings[resourceId] : undefined;
    setRatings(prev=>{
      const cur = prev[resourceId] || { helpful:0, notHelpful:0 };
      const next = { ...cur };
      if(prevVote === "helpful") next.helpful = Math.max(0, next.helpful - 1);
      if(prevVote === "not") next.notHelpful = Math.max(0, next.notHelpful - 1);
      if(prevVote !== vote){
        if(vote === "helpful") next.helpful += 1; else next.notHelpful += 1;
      }
      return { ...prev, [resourceId]: next };
    });
    updateAccount(session.email, p=>{
      const myRatings = { ...(p.myRatings || {}) };
      if(prevVote === vote) delete myRatings[resourceId]; else myRatings[resourceId] = vote;
      return { ...p, myRatings };
    });
    if(account.settings.haptics) vibrate(10);
  };
  const setProgress = (id, v)=>{
    if(session) updateAccount(session.email, p=>({
      ...p, progress:{ ...p.progress, [id]:v }, activityDates: logActivityDate(p.activityDates)
    }));
  };
  const publish = (f)=>{
    if(!session || !account) return;
    const ownerToken = (f.format === "write" && supabase) ? makeOwnerToken() : null;
    const story = {
      id:"my" + Date.now(), title:f.title.trim(), author: account.name || "You",
      country:f.country.trim() || "—", ago:"just now", likes:0,
      format: f.format || "write",
      body: f.format === "write" ? f.body.trim().split(/\n{1,}/).filter(Boolean) : [],
      audioUrl: f.audioUrl || null,
      videoUrl: f.videoUrl || null,
      ownerToken
    };
    updateAccount(session.email, p=>({ ...p, myStories:[story, ...p.myStories], activityDates: logActivityDate(p.activityDates) }));
    if(story.format === "write" && supabase){
      publishSharedStory(story, lang, ownerToken).then(result=>{
        if(result && result.ok){
          fetchSharedStories().then(list=>setSharedStories(list));
        }else{
          notify(t("storySyncFailedToast"));
        }
      });
    }
    setView(null); setTab("stories"); notify(t("storyPublished"));
  };
  const removeMyStory = (story)=>{
    if(!session) return;
    updateAccount(session.email, p=>({ ...p, myStories: p.myStories.filter(s=>s.id !== story.id) }));
    if(story.ownerToken && supabase){
      deleteSharedStory(story.id, story.ownerToken).then(()=>fetchSharedStories()).then(list=>setSharedStories(list));
    }
    notify(t("storyDeletedToast"));
    setView(null);
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
  const handleResetProgress = ()=>{
    if(!session || !account) return;
    const zeroed = {};
    PATHS.forEach(p=>{ zeroed[p.id] = 0; });
    updateAccount(session.email, p=>({ ...p, progress: zeroed }));
    notify(t("resetProgressDone"));
  };
  const logout = ()=>{
    setSession(null);
    setTab("home"); setView(null);
    setStage("auth");
  };
  const switchAccount = (email)=>{
    if(!accounts[email]) return;
    setSession({ email });
    setTab("home"); setView(null);
    notify(tFor(accounts[email].lang, "welcomeBack"));
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
      if(info.dark) acc.settings.darkMode = "on";
      setAccounts(prev=>({ ...prev, [info.email]: acc }));
      setSession({ email: info.email });
      setStage("setup");
      logToTelegram(tgUser, "register");
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
  const dmMode = normalizeDarkMode(s.darkMode);
  const isDark = dmMode === "system" ? systemDark : dmMode === "on";
  const screenStyle = {
    "--user-fs": s.textSize,
    "--ds": String(ds),
    letterSpacing: s.dyslexic ? ".02em" : "normal",
    lineHeight: s.dyslexic ? 1.75 : 1.5
  };
  const simplified = !!account && (account.profile === "low-vision" || account.profile === "blind");
  const tourVisible = stage === "app" && !!account && !account.tourSeen;
  const dismissTour = ()=>{
    if(!session) return;
    updateAccount(session.email, p=>({ ...p, tourSeen: true }));
  };

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

  const storyForVoice = view?.type === "story"
    ? [...(account.myStories || []), ...sharedStories, ...STORIES].find(s=>s.id===view.id)
    : (view?.type === "article" ? ARTICLES.find(a=>a.id===view.id) : null);
  const storyForVoiceIsRedirect = view?.type === "article" && storyForVoice && storyForVoice.storyId;
  const actualStory = storyForVoiceIsRedirect
    ? [...(account.myStories || []), ...sharedStories, ...STORIES].find(s=>s.id===storyForVoice.storyId)
    : (view?.type === "story" ? storyForVoice : null);

  const screenTitle =
    view?.type === "article" ? (storyForVoiceIsRedirect ? pick(actualStory?.title, lang) : pick(storyForVoice?.title, lang)) :
    view?.type === "story" ? (pick(actualStory?.title, lang) || t("storyLabel")) :
    view?.type === "resource" ? pick(LIBRARY.find(r=>r.id===view.id)?.title, lang) :
    view?.type === "paths" ? t("tileHubTitle") :
    view?.type === "lesson" ? pick(PATHS.find(p=>p.id===view.id)?.title, lang) :
    view?.type === "certificate" ? t("certificateTitle") :
    view?.type === "quiz" ? t("quizTitle") :
    view?.type === "switchAccount" ? t("switchAccountTitle") :
    view?.type === "learn" ? t("tileHubTitle") :
    view?.type === "scan" ? t("scanTitle") :
    view?.type === "transcript" ? t("transcriptTitle") :
    view?.type === "compose" ? t("tileShareTitle") :
    view?.type === "insights" ? t("insightsTitle") :
    view?.type === "about" ? t("aboutTitle") :
    view?.type === "appBugReport" ? t("appBugTitle") :
    view?.type === "search" ? t("globalSearchTitle") :
    tab === "home" ? t("welcomeTitle") : tab === "library" ? t("libraryTitle") :
    tab === "stories" ? t("storiesTitle") : t("profileTitle");

  const resourceForVoice = view?.type === "resource" ? LIBRARY.find(r=>r.id===view.id) : null;
  const lessonForVoice = (()=>{
    if(view?.type !== "lesson") return null;
    const path = PATHS.find(p=>p.id===view.id);
    if(!path) return null;
    const total = path.lessons.length;
    const v = account.progress[view.id] || 0;
    const idx = Math.min(total - 1, Math.round(v / 100 * total));
    return path.lessons[idx];
  })();

  const screenHint =
    !view && tab === "home" ? t("exploreLabel") + ": " + [t("tileLibraryTitle"), t("tileHubTitle"), t("tileShareTitle"), t("tileCommunityTitle")].join(", ") :
    !view && tab === "library" ? t("searchPlaceholder") :
    !view && tab === "stories" ? t("storiesSubtitle") :
    !view && tab === "profile" ? t("accessibilityLabel") :
    view?.type === "article" ? (storyForVoiceIsRedirect ? (pick(actualStory?.body, lang) || []).join(" ") : (pick(storyForVoice?.body, lang) || []).join(" ")) :
    view?.type === "story" ? (pick(actualStory?.body, lang) || []).join(" ") :
    view?.type === "resource" ? ((pick(resourceForVoice?.content, lang) || []).join(" ") || pick(resourceForVoice?.description, lang) || pick(resourceForVoice?.meta, lang) || "") :
    view?.type === "lesson" ? (lessonForVoice ? pick(lessonForVoice.title, lang) + ". " + pick(lessonForVoice.body, lang) : "") :
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
    else if(view.type==="story") body = <StoryView id={view.id} onBack={back} liked={account.liked} toggleLike={toggleLike} myStories={account.myStories} sharedStories={sharedStories} t={t} lang={lang} onReport={submitReport} onDelete={removeMyStory}/>;
    else if(view.type==="resource") body = <ResourceView id={view.id} onBack={back} saved={account.saved} toggleSave={toggleSave} notify={notify} t={t} lang={lang} onReport={submitReport}
                                                           rating={ratings[view.id]} myVote={account.myRatings ? account.myRatings[view.id] : undefined} onRate={rateResource}/>;
    else if(view.type==="paths") body = <PathsView onBack={back} progress={account.progress} setProgress={setProgress} notify={notify} t={t} lang={lang}
                                                     onOpenLesson={(pathId)=>setView({ type:"lesson", id:pathId })}
                                                     onOpenCertificate={(pathId)=>setView({ type:"certificate", id:pathId })}
                                                     onOpenQuiz={(pathId)=>setView({ type:"quiz", id:pathId })}/>;
    else if(view.type==="lesson") body = <LessonView pathId={view.id} onBack={()=>setView({ type:"paths" })} progress={account.progress} setProgress={setProgress} notify={notify} t={t} lang={lang}/>;
    else if(view.type==="certificate") body = <CertificateView pathId={view.id} onBack={()=>setView({ type:"paths" })} accountName={account.name} t={t} lang={lang}/>;
    else if(view.type==="quiz") body = <QuizView pathId={view.id} onBack={()=>setView({ type:"paths" })} t={t} lang={lang}/>;
    else if(view.type==="switchAccount") body = <SwitchAccountView onBack={back} accounts={accounts} currentEmail={session.email}
                                                                     onSwitch={switchAccount} onAddNew={logout} t={t}/>;
    else if(view.type==="learn") body = <LearnUpload onBack={back} onApply={handleLearnApply} onBrowsePaths={()=>setView({ type:"paths" })}
                                                       onOpenScan={()=>setView({ type:"scan" })} onOpenTranscript={()=>setView({ type:"transcript" })} t={t}/>;
    else if(view.type==="scan") body = <ScanText onBack={back} t={t} lang={lang} notify={notify}/>;
    else if(view.type==="transcript") body = <LiveTranscript onBack={back} t={t} lang={lang} notify={notify}/>;
    else if(view.type==="compose") body = <Compose onBack={back} onSubmit={publish} t={t}/>;
    else if(view.type==="insights") body = <InsightsView onBack={back} accounts={accounts} reports={reports} appBugs={loadAppBugs()} t={t}/>;
    else if(view.type==="about") body = <AboutView onBack={back} t={t}/>;
    else if(view.type==="appBugReport") body = <AppBugReportView onBack={back} notify={notify} t={t}/>;
    else if(view.type==="search") body = <GlobalSearch onBack={back} go={go} sharedStories={sharedStories} t={t} lang={lang}/>;
  } else if(tab==="home") body = <Home go={go} t={t} lang={lang} greeting={greeting} simplified={simplified} lastViewed={account.lastViewed}/>;
  else if(tab==="library") body = <Library go={go} saved={account.saved} toggleSave={toggleSave} t={t} lang={lang}/>;
  else if(tab==="stories") body = <Stories go={go} liked={account.liked} toggleLike={toggleLike} myStories={account.myStories} sharedStories={sharedStories} t={t} lang={lang}/>;
  else body = <Profile account={account} set={(u)=>updateAccount(session.email, u)} saved={account.saved} myStories={account.myStories} go={go} notify={notify}
                        onRerunSetup={()=>setStage("setup")} t={t} onLogout={logout}
                        onChangeLang={(code)=>updateAccount(session.email, p=>({ ...p, lang:code }))}
                        onReset={handleReset} onResetProgress={handleResetProgress} onOpenInsights={()=>go({ view:{ type:"insights" } })}/>;

  return (
    <React.Fragment>
      <svg width="0" height="0" style={{position:"absolute"}} aria-hidden="true">
        <defs>
          <filter id="mwm-protanopia"><feColorMatrix type="matrix" values="0.567,0.433,0,0,0 0.558,0.442,0,0,0 0,0.242,0.758,0,0 0,0,0,1,0"/></filter>
          <filter id="mwm-deuteranopia"><feColorMatrix type="matrix" values="0.625,0.375,0,0,0 0.7,0.3,0,0,0 0,0.3,0.7,0,0 0,0,0,1,0"/></filter>
          <filter id="mwm-tritanopia"><feColorMatrix type="matrix" values="0.95,0.05,0,0,0 0,0.433,0.567,0,0 0,0.475,0.525,0,0 0,0,0,1,0"/></filter>
        </defs>
      </svg>
      <div className="device">
      <div className="device-screen" ref={deviceScreenRef} style={{ "--ds": String(ds) }}>
        <div className="island"/>
        <div className="screen" style={screenStyle}
             data-contrast={s.contrast ? "on" : "off"}
             data-motion={s.motion ? "on" : "off"}
             data-dark={isDark ? "on" : "off"}
             data-readable={s.readableFont ? "on" : "off"}
             data-colorfilter={s.colorFilter || "none"}
             data-bold={s.boldText ? "on" : "off"}>
          <StatusBar dark={isDark}/>
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
      {tourVisible && <OnboardTour t={t} onDone={dismissTour}/>}
    </React.Fragment>
  );
}

function App(){
  return (
    <ErrorBoundary>
      <AppInner/>
    </ErrorBoundary>
  );
}

export default App;