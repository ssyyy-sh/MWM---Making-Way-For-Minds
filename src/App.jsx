import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import "./App.css";

/* ============ storage ============ */
const KEY = "mwm:state:v1";
const defaultState = {
  onboarded: false,
  profile: null, // "low-vision" | "blind" | "hearing" | "standard"
  saved: [],
  liked: [],
  myStories: [],
  progress: { p1: 60, p2: 25, p3: 0, p4: 100 },
  settings: { textSize: 1, contrast: false, motion: true, captions: true, dyslexic: false, voiceGuide: false }
};
function loadState(){
  try{
    const raw = localStorage.getItem(KEY);
    if(!raw) return defaultState;
    const p = JSON.parse(raw);
    return { ...defaultState, ...p, settings:{ ...defaultState.settings, ...(p.settings||{}) },
             progress:{ ...defaultState.progress, ...(p.progress||{}) } };
  }catch(e){ return defaultState; }
}
function saveState(s){ try{ localStorage.setItem(KEY, JSON.stringify(s)); }catch(e){} }

/* ============ speech (voice guide) ============ */
function speakText(text){
  if(typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try{
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ru-RU";
    u.rate = 0.98;
    window.speechSynthesis.speak(u);
  }catch(e){}
}

/* ============ content ============ */
const LIBRARY = [
  { id:"l1", title:"Teaching Every Reader", author:"R. Okonkwo", format:"Book", emoji:"📗", meta:"312 pages · EPUB, Braille-ready", year:2024 },
  { id:"l2", title:"Sound of a Classroom", author:"Narrated by M. Duarte", format:"Audio", emoji:"🎧", meta:"4 h 12 min · Transcript included", year:2025 },
  { id:"l3", title:"Colour Contrast Field Guide", author:"MWM Research", format:"Visual", emoji:"🎨", meta:"48 plates · Alt-text on every image", year:2025 },
  { id:"l4", title:"Dyslexia in Early Grades", author:"S. Lindqvist", format:"Book", emoji:"📘", meta:"186 pages · Large-print edition", year:2023 },
  { id:"l5", title:"Signed Stories, Vol. 2", author:"Deaf Learners Collective", format:"Visual", emoji:"🤟", meta:"22 films · Sign language + captions", year:2026 },
  { id:"l6", title:"Listening to Learners", author:"MWM Interviews", format:"Audio", emoji:"🎙️", meta:"18 episodes · 42 countries", year:2026 },
  { id:"l7", title:"Maths Without Sight", author:"A. Boateng", format:"Book", emoji:"📐", meta:"240 pages · Tactile diagrams", year:2024 },
  { id:"l8", title:"Rooms That Work", author:"MWM Research", format:"Visual", emoji:"🏫", meta:"Photo study · 60 classrooms", year:2025 }
];
const PATHS = [
  { id:"p1", title:"Foundations of Accessible Teaching", emoji:"🧭", lessons:8, mins:95, level:"Start here" },
  { id:"p2", title:"Designing Readable Materials", emoji:"📝", lessons:6, mins:70, level:"Practical" },
  { id:"p3", title:"Assistive Technology in Class", emoji:"🖥️", lessons:10, mins:140, level:"Deep dive" },
  { id:"p4", title:"Interviewing Learners with Care", emoji:"💬", lessons:5, mins:55, level:"For researchers" }
];
const STORIES = [
  { id:"s1", title:"My Journey with Dyslexia", author:"Amara O.", country:"Kenya", ago:"5h ago", likes:212,
    body:["I was eleven when a teacher stopped asking me to read aloud and started asking me to explain instead. That single change moved me from the back of the class to the front of my own learning.",
      "Letters still swim. What changed is the room around them: audio versions, extra time, a font that holds still long enough for me to catch it.",
      "I am studying to be a teacher now. The first thing I tell every student is that a slow reader is not a slow thinker."] },
  { id:"s2", title:"The Library That Came to Us", author:"Iker M.", country:"Peru", ago:"1d ago", likes:148,
    body:["Our village is four hours from the nearest library. Once a month, a van arrived with books, a projector and one very patient librarian.",
      "She left recordings behind so my grandmother, who never learned to read, could listen to the same stories we did.",
      "Access is not only about buildings. Sometimes it is about who is willing to drive."] },
  { id:"s3", title:"Learning to Hear Differently", author:"Wei C.", country:"Singapore", ago:"2d ago", likes:96,
    body:["I lost most of my hearing at seven. For two years I copied notes I could not follow.",
      "Live captions changed everything — not because they are perfect, but because they let me choose when to look away.",
      "My advice to teachers: face the class when you speak, and repeat the question before you answer it."] },
  { id:"s4", title:"A Ramp Is a Curriculum Decision", author:"Nadia H.", country:"Jordan", ago:"4d ago", likes:74,
    body:["The science lab was on the second floor. For three years my classes were held elsewhere, with a textbook instead of an experiment.",
      "When the school finally installed a lift, my grades did not change — my ambitions did.",
      "Accessibility is not charity. It is the difference between reading about chemistry and doing it."] },
  { id:"s5", title:"Teaching in Two Languages", author:"Diego R.", country:"Mexico", ago:"6d ago", likes:61,
    body:["Half my students think in an Indigenous language and are tested in Spanish. That gap is rarely called an accessibility issue, but it is one.",
      "We started recording lessons in both languages. Attendance rose before the test scores did.",
      "Belonging comes first. Comprehension follows it."] }
];
const ARTICLES = [
  { id:"a1", kind:"Research", title:"Visual Accessibility in Classrooms", ago:"2h ago", read:"6 min read", author:"MWM Research Team",
    body:["We measured lighting, contrast and seating in 60 classrooms across 12 countries. In two thirds of them, a student with low vision could not read the board from the back row — not because of eyesight, but because of glare.",
      "The cheapest fixes were the most effective: matte board surfaces, a 20-degree shift in blind angle, and printing handouts at 14pt instead of 11pt.",
      "Teachers reported the changes helped everyone. Students without a diagnosis asked fewer clarifying questions, and copying time fell by roughly a fifth."],
    quote:"When the room is designed for the hardest case, it works better for every case." },
  { id:"a2", kind:"Story", title:"My Journey with Dyslexia", ago:"5h ago", read:"4 min read", author:"Amara O.", storyId:"s1" },
  { id:"a3", kind:"Interview", title:"What 2,400 Learners Told Us", ago:"1d ago", read:"8 min read", author:"MWM Interviews",
    body:["Over three years we recorded 2,400 interviews in 18 countries. We asked one question first: what makes a good day of learning?",
      "Almost nobody answered with technology. They answered with people — a teacher who waited, a classmate who shared notes, a parent who did not treat a diagnosis as a verdict.",
      "Tools matter, but they arrive second. The first accessibility feature in any classroom is attention."],
    quote:"Nobody said the word software. They said the name of a teacher." }
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

/* ============ splash ============ */
function Splash({ onStart }){
  return (
    <div className="screen anim-fade">
      <StatusBar/>
      <div className="splash">
        <div className="logo-tile">M</div>
        <div className="wordmark serif">M<span className="g">W</span>M</div>
        <div className="tagline">MAKING WAY FOR MINDS</div>

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
        <p className="quote serif">“Every mind deserves access to learning.”</p>
        <div className="squiggle"><i/><span className="serif">∿</span><i/></div>
        <button className="cta" onClick={onStart}>Get Started <I.arrow/></button>
        <div className="foot-note">Research · Inclusion · Equity</div>
      </div>
    </div>
  );
}

/* ============ accessibility setup ============ */
const PROFILES = [
  { id:"low-vision", icon:I.eye, title:"Слабое зрение", sub:"Крупный текст и усиленный контраст" },
  { id:"blind", icon:I.eyeOff, title:"Незрячим", sub:"Одна большая кнопка озвучивает экран" },
  { id:"hearing", icon:I.ear, title:"Слабослышащим", sub:"Субтитры включены везде, где это возможно" },
  { id:"standard", icon:I.sparkle, title:"Продолжить как есть", sub:"Настроить это позже в профиле" }
];
function AccessibilitySetup({ onPick }){
  const [picked, setPicked] = useState(null);
  return (
    <div className="screen anim-fade">
      <StatusBar/>
      <div className="setup">
        <div className="eyebrow">Шаг 1 из 1</div>
        <h1 style={{fontSize:"calc(24px * var(--fs))", marginTop:8, lineHeight:1.2}}>
          Каким должен быть интерфейс для вас?
        </h1>
        <p className="muted" style={{fontSize:"calc(13px * var(--fs))", lineHeight:1.55, marginTop:8}}>
          Мы делаем приложение для людей с разными типами восприятия. Выберите вариант — всегда можно изменить его в профиле.
        </p>

        <div className="setup-list">
          {PROFILES.map(p=>{
            const Icon = p.icon;
            const on = picked === p.id;
            return (
              <button key={p.id} className={"setup-card" + (on ? " on" : "")}
                      onClick={()=>{ setPicked(p.id); speakText(p.title); }}
                      aria-pressed={on}>
                <span className="setup-icon"><Icon/></span>
                <span style={{flex:1}}>
                  <b>{p.title}</b>
                  <small>{p.sub}</small>
                </span>
                {on ? <span className="setup-check"><I.check/></span> : null}
              </button>
            );
          })}
        </div>

        <button className="cta" style={{marginTop:"auto", opacity: picked ? 1 : .5}}
                disabled={!picked}
                onClick={()=>onPick(picked)}>
          Продолжить <I.arrow/>
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
function Home({ go, greeting }){
  const tiles = [
    { emoji:"📚", title:"Accessible Library", sub:"Books, audio & visual resources", to:{ tab:"library" } },
    { emoji:"🎓", title:"Learning Hub", sub:"Curated educational pathways", to:{ view:{ type:"paths" } } },
    { emoji:"🎤", title:"Share Your Story", sub:"Your experience matters", to:{ view:{ type:"compose" } } },
    { emoji:"🌍", title:"Community Voices", sub:"Stories from around the world", to:{ tab:"stories" } }
  ];
  return (
    <div className="scroll with-tabs anim-fade">
      <div className="home-head">
        <div>
          <div className="eyebrow">{greeting}</div>
          <h1 style={{fontSize:"calc(27px * var(--fs))", marginTop:6}}>Welcome to MWM</h1>
        </div>
        <button className="avatar" onClick={()=>go({ tab:"profile" }, "Профиль")} aria-label="Open profile">M</button>
      </div>

      <section className="mission">
        <div className="row">
          <span className="badge"><I.check/></span>
          <span className="eyebrow">Our Mission</span>
        </div>
        <p>Researching educational accessibility through stories, interviews, and data.</p>
        <div className="stats">
          <div className="stat gold"><b>2,400+</b><span>Stories</span></div>
          <div className="stat"><b>18</b><span>Countries</span></div>
          <div className="stat green"><b>94%</b><span>Free Access</span></div>
        </div>
      </section>

      <div className="eyebrow section-label">Explore</div>
      <div className="grid">
        {tiles.map(t=>(
          <button key={t.title} className="tile" onClick={()=>go(t.to, t.title)}>
            <span className="emoji">{t.emoji}</span>
            <b>{t.title}</b>
            <span>{t.sub}</span>
          </button>
        ))}
      </div>

      <div className="eyebrow section-label">Recent</div>
      {ARTICLES.map(a=>(
        <button key={a.id} className="row-item" onClick={()=>go({ view:{ type:"article", id:a.id } }, a.title)}>
          <span className="row-icon"><I.doc/></span>
          <span style={{flex:1}}>
            <b>{a.title}</b>
            <small>{a.kind} · {a.ago}</small>
          </span>
          <I.chevron style={{color:"var(--muted)"}}/>
        </button>
      ))}
    </div>
  );
}

/* ============ library ============ */
function Library({ go, saved, toggleSave }){
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("All");
  const filters = ["All","Book","Audio","Visual","Saved"];
  const items = useMemo(()=>LIBRARY.filter(it=>{
    const okF = filter==="All" ? true : filter==="Saved" ? saved.includes(it.id) : it.format===filter;
    const okQ = (it.title + " " + it.author).toLowerCase().includes(q.trim().toLowerCase());
    return okF && okQ;
  }), [q, filter, saved]);

  return (
    <div className="scroll with-tabs anim-fade">
      <h1 style={{fontSize:"calc(26px * var(--fs))", marginBottom:14}}>Accessible Library</h1>
      <div className="search">
        <I.search style={{color:"var(--muted)"}}/>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search titles and authors" aria-label="Search the library"/>
      </div>
      <div className="chips">
        {filters.map(f=>(
          <button key={f} className={"chip" + (filter===f ? " on" : "")} onClick={()=>setFilter(f)}>
            {f}{f==="Saved" && saved.length ? " · " + saved.length : ""}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <div className="emoji">🔍</div>
          <p className="muted" style={{fontSize:13}}>No resources match that. Try another word or clear the filter.</p>
        </div>
      ) : items.map(it=>(
        <div key={it.id} className="card">
          <button className="thumb" onClick={()=>go({ view:{ type:"resource", id:it.id } }, it.title)} aria-label={"Open " + it.title}>{it.emoji}</button>
          <button style={{flex:1, textAlign:"left"}} onClick={()=>go({ view:{ type:"resource", id:it.id } }, it.title)}>
            <b>{it.title}</b>
            <div className="meta">{it.author} · {it.year}</div>
            <span className={"pill " + it.format.toLowerCase()}>{it.format}</span>
          </button>
          <button
            onClick={()=>toggleSave(it.id)}
            aria-label={saved.includes(it.id) ? "Remove from saved" : "Save for later"}
            style={{color: saved.includes(it.id) ? "var(--green)" : "var(--muted)"}}>
            <I.bookmark fill={saved.includes(it.id) ? "currentColor" : "none"}/>
          </button>
        </div>
      ))}
    </div>
  );
}

/* ============ stories ============ */
function Stories({ go, liked, toggleLike, myStories }){
  const all = [...myStories, ...STORIES];
  return (
    <div className="scroll with-tabs anim-fade">
      <div style={{display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14}}>
        <h1 style={{fontSize:"calc(26px * var(--fs))"}}>Community Voices</h1>
        <button className="icon-btn" onClick={()=>go({ view:{ type:"compose" } }, "Поделиться историей")} aria-label="Share your story"><I.plus/></button>
      </div>
      <p className="muted" style={{fontSize:"calc(12.5px * var(--fs))", marginTop:0, marginBottom:16, lineHeight:1.5}}>
        First-hand accounts from learners, teachers and families in 18 countries.
      </p>
      {all.map(s=>(
        <button key={s.id} className="story-card" onClick={()=>go({ view:{ type:"story", id:s.id } }, s.title)}>
          <h3>{s.title}</h3>
          <p>{s.body[0].slice(0,132)}…</p>
          <div className="story-foot">
            <span>{s.author} · {s.country}</span>
            <span>{s.ago}</span>
            <span
              className={"like" + (liked.includes(s.id) ? " on" : "")}
              onClick={(e)=>{ e.stopPropagation(); toggleLike(s.id); }}
              role="button" tabIndex={0}
              onKeyDown={(e)=>{ if(e.key==="Enter"){ e.stopPropagation(); toggleLike(s.id);} }}>
              <I.heart fill={liked.includes(s.id) ? "currentColor" : "none"}/>
              {s.likes + (liked.includes(s.id) ? 1 : 0)}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ============ profile ============ */
function Profile({ state, set, saved, myStories, go, notify, onRerunSetup }){
  const s = state.settings;
  const upd = (k,v)=> set(p=>({ ...p, settings:{ ...p.settings, [k]:v } }));
  const Row = ({ title, sub, on, onToggle }) => (
    <button className="setting" onClick={()=>{
      if(s.voiceGuide) speakText(title + (on ? " выключено" : " включено"));
      onToggle();
    }} aria-pressed={on}>
      <span style={{flex:1}}><b>{title}</b><small>{sub}</small></span>
      <span className={"switch" + (on ? " on" : "")}><i/></span>
    </button>
  );
  const profileLabel = { "low-vision":"Слабое зрение", "blind":"Незрячим", "hearing":"Слабослышащим", "standard":"Стандартный" }[state.profile] || "Не выбран";
  return (
    <div className="scroll with-tabs anim-fade">
      <h1 style={{fontSize:"calc(26px * var(--fs))", marginBottom:18}}>Profile</h1>
      <div style={{display:"flex", alignItems:"center", gap:14, marginBottom:20}}>
        <div className="avatar" style={{width:56, height:56, fontSize:21}}>M</div>
        <div>
          <b className="serif" style={{fontSize:"calc(17px * var(--fs))"}}>Maya Rivera</b>
          <div className="muted" style={{fontSize:"calc(12px * var(--fs))"}}>Researcher · Joined 2025</div>
        </div>
      </div>

      <div className="mission" style={{marginTop:0}}>
        <div className="stats" style={{borderTop:0, paddingTop:0, marginTop:0}}>
          <div className="stat gold"><b>{myStories.length}</b><span>Your stories</span></div>
          <div className="stat"><b>{saved.length}</b><span>Saved</span></div>
          <div className="stat green"><b>{Math.round(Object.values(state.progress).reduce((a,b)=>a+b,0)/4)}%</b><span>Learning done</span></div>
        </div>
      </div>

      <div className="eyebrow section-label">Reading comfort</div>
      <div className="seg" role="group" aria-label="Text size">
        {[["Standard",1],["Large",1.14],["Largest",1.3]].map(([label,val])=>(
          <button key={label} className={s.textSize===val ? "on" : ""} onClick={()=>upd("textSize", val)}>{label}</button>
        ))}
      </div>

      <div className="eyebrow section-label">Accessibility</div>
      <Row title="High contrast" sub="Stronger borders and darker text" on={s.contrast} onToggle={()=>upd("contrast", !s.contrast)}/>
      <Row title="Animation" sub="Screen transitions and motion" on={s.motion} onToggle={()=>upd("motion", !s.motion)}/>
      <Row title="Captions by default" sub="Turn on captions for every film" on={s.captions} onToggle={()=>upd("captions", !s.captions)}/>
      <Row title="Reading-friendly spacing" sub="Wider letter and line spacing" on={s.dyslexic} onToggle={()=>upd("dyslexic", !s.dyslexic)}/>
      <Row title="Голосовые подсказки" sub="Одна кнопка озвучивает экран и действия" on={s.voiceGuide} onToggle={()=>upd("voiceGuide", !s.voiceGuide)}/>

      <div className="eyebrow section-label">Accessibility profile</div>
      <button className="row-item" onClick={onRerunSetup}>
        <span className="row-icon"><I.sparkle/></span>
        <span style={{flex:1}}><b>{profileLabel}</b><small>Пройти настройку заново</small></span>
        <I.chevron style={{color:"var(--muted)"}}/>
      </button>

      <div className="eyebrow section-label">Your library</div>
      <button className="row-item" onClick={()=>go({ tab:"library" }, "Библиотека")}>
        <span className="row-icon"><I.bookmark/></span>
        <span style={{flex:1}}><b>Saved resources</b><small>{saved.length} item{saved.length===1?"":"s"}</small></span>
        <I.chevron style={{color:"var(--muted)"}}/>
      </button>
      <button className="row-item" onClick={()=>go({ view:{ type:"paths" } }, "Обучающие пути")}>
        <span className="row-icon">🎓</span>
        <span style={{flex:1}}><b>Learning pathways</b><small>Continue where you stopped</small></span>
        <I.chevron style={{color:"var(--muted)"}}/>
      </button>

      <div className="eyebrow section-label">App</div>
      <button className="row-item" onClick={()=>{
        set(()=>({ ...defaultState }));
        notify("Everything reset");
      }}>
        <span className="row-icon" style={{color:"var(--danger)"}}>↺</span>
        <span style={{flex:1}}><b>Reset app data</b><small>Clears saves, likes and your stories</small></span>
      </button>
      <p className="muted" style={{fontSize:11, textAlign:"center", margin:"22px 0 6px", letterSpacing:".06em"}}>
        Research · Inclusion · Equity
      </p>
    </div>
  );
}

/* ============ detail views ============ */
function Detail({ title, onBack, children, action }){
  return (
    <React.Fragment>
      <div className="topbar">
        <button className="icon-btn" onClick={onBack} aria-label="Back"><I.back/></button>
        <h2 style={{flex:1}}>{title}</h2>
        {action}
      </div>
      <div className="scroll detail-scroll anim-slide">{children}</div>
    </React.Fragment>
  );
}

function ArticleView({ id, onBack, go }){
  const a = ARTICLES.find(x=>x.id===id);
  if(a.storyId) return <StoryView id={a.storyId} onBack={onBack}/>;
  return (
    <Detail title={a.kind} onBack={onBack}>
      <article className="article">
        <div className="eyebrow kicker">{a.author} · {a.read}</div>
        <h1>{a.title}</h1>
        {a.body.map((p,i)=>(
          <React.Fragment key={i}>
            <p>{p}</p>
            {i===0 && a.quote ? <blockquote>{a.quote}</blockquote> : null}
          </React.Fragment>
        ))}
        <button className="cta" style={{marginTop:14}} onClick={()=>go({ tab:"library" }, "Библиотека")}>
          Read related resources <I.arrow/>
        </button>
      </article>
    </Detail>
  );
}

function StoryView({ id, onBack, liked, toggleLike, myStories }){
  const all = [...(myStories||[]), ...STORIES];
  const s = all.find(x=>x.id===id) || STORIES[0];
  const on = (liked||[]).includes(s.id);
  return (
    <Detail title="Story" onBack={onBack}
      action={toggleLike ? (
        <button className={"icon-btn like" + (on ? " on" : "")} onClick={()=>toggleLike(s.id)} aria-label="Like this story">
          <I.heart fill={on ? "currentColor" : "none"}/>
        </button>) : null}>
      <article className="article">
        <div className="eyebrow kicker">{s.author} · {s.country} · {s.ago}</div>
        <h1>{s.title}</h1>
        {s.body.map((p,i)=><p key={i}>{p}</p>)}
      </article>
    </Detail>
  );
}

function ResourceView({ id, onBack, saved, toggleSave, notify }){
  const r = LIBRARY.find(x=>x.id===id);
  const isSaved = saved.includes(r.id);
  return (
    <Detail title={r.format} onBack={onBack}>
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
      <button className="cta" style={{marginTop:6}} onClick={()=>notify(r.format==="Audio" ? "Playing sample" : "Opening reader")}>
        {r.format==="Audio" ? "Play sample" : r.format==="Visual" ? "View collection" : "Read now"} <I.arrow/>
      </button>
      <button className="cta" style={{marginTop:10, background:"var(--cream-2)", color:"var(--navy)"}} onClick={()=>toggleSave(r.id)}>
        {isSaved ? "Remove from saved" : "Save for later"}
      </button>
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

function Compose({ onBack, onSubmit }){
  const [f, setF] = useState({ title:"", country:"", body:"" });
  const ok = f.title.trim().length > 2 && f.body.trim().length > 30;
  return (
    <Detail title="Share Your Story" onBack={onBack}>
      <p className="muted" style={{fontSize:"calc(13px * var(--fs))", marginTop:0, lineHeight:1.6}}>
        Tell us what learning is like for you. Published stories are reviewed by the research team first.
      </p>
      <div className="field">
        <label htmlFor="t">Title</label>
        <input id="t" value={f.title} maxLength={70} onChange={e=>setF({...f, title:e.target.value})} placeholder="Give your story a name"/>
      </div>
      <div className="field">
        <label htmlFor="c">Country</label>
        <input id="c" value={f.country} onChange={e=>setF({...f, country:e.target.value})} placeholder="Where did this happen?"/>
      </div>
      <div className="field">
        <label htmlFor="b">Your story</label>
        <textarea id="b" rows={8} value={f.body} onChange={e=>setF({...f, body:e.target.value})} placeholder="Start anywhere — a moment, a teacher, a barrier you met."/>
        <div className="hint">{f.body.trim().length} characters · at least 30 to publish</div>
      </div>
      <button className="cta" disabled={!ok} style={{opacity: ok ? 1 : .45}}
        onClick={()=>{ if(!ok) return; onSubmit(f); }}>
        Publish story <I.arrow/>
      </button>
    </Detail>
  );
}

/* ============ app ============ */
function App(){
  const [state, setState] = useState(loadState);
  const [tab, setTab] = useState("home");
  const [view, setView] = useState(null);
  const [toast, setToast] = useState(null);
  const [stage, setStage] = useState(()=> loadState().onboarded ? "app" : "splash"); // splash -> setup -> app
  const scrollRef = useRef(null);

  useEffect(()=>{ saveState(state); }, [state]);
  useEffect(()=>{
    if(!toast) return;
    const t = setTimeout(()=>setToast(null), 2200);
    return ()=>clearTimeout(t);
  }, [toast]);
  useEffect(()=>()=>{ try{ window.speechSynthesis && window.speechSynthesis.cancel(); }catch(e){} }, []);

  const voiceGuide = state.settings.voiceGuide;
  const notify = useCallback((text)=>setToast(text), []);
  const go = (to, label)=>{
    if(voiceGuide && label) speakText(label);
    if(to.tab){ setTab(to.tab); setView(null); }
    if(to.view){ setView(to.view); }
  };
  const toggleSave = (id)=>{
    setState(p=>{
      const has = p.saved.includes(id);
      const msg = has ? "Removed from saved" : "Saved to your library";
      notify(msg);
      if(p.settings.voiceGuide) speakText(has ? "Убрано из сохранённого" : "Сохранено в библиотеке");
      return { ...p, saved: has ? p.saved.filter(x=>x!==id) : [id, ...p.saved] };
    });
  };
  const toggleLike = (id)=>setState(p=>{
    const has = p.liked.includes(id);
    if(p.settings.voiceGuide) speakText(has ? "Лайк убран" : "Понравилось");
    return { ...p, liked: has ? p.liked.filter(x=>x!==id) : [id, ...p.liked] };
  });
  const setProgress = (id, v)=>setState(p=>({ ...p, progress:{ ...p.progress, [id]:v } }));
  const publish = (f)=>{
    const story = {
      id:"my" + Date.now(), title:f.title.trim(), author:"Maya Rivera",
      country:f.country.trim() || "Not given", ago:"just now", likes:0,
      body:f.body.trim().split(/\n{1,}/).filter(Boolean)
    };
    setState(p=>({ ...p, myStories:[story, ...p.myStories] }));
    setView(null); setTab("stories"); notify("Story published");
  };

  const greeting = useMemo(()=>{
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }, []);

  const s = state.settings;
  const screenStyle = {
    "--fs": s.textSize,
    letterSpacing: s.dyslexic ? ".02em" : "normal",
    lineHeight: s.dyslexic ? 1.75 : 1.5
  };

  const applyProfile = (id)=>{
    setState(p=>{
      const next = { ...p.settings };
      if(id === "low-vision"){ next.textSize = 1.3; next.contrast = true; }
      if(id === "blind"){ next.textSize = 1.3; next.voiceGuide = true; }
      if(id === "hearing"){ next.captions = true; }
      return { ...p, onboarded:true, profile:id, settings:next };
    });
    setStage("app");
    notify(id === "standard" ? "Готово" : "Интерфейс подстроен под вас");
    if(id === "blind" || id === "low-vision"){
      setTimeout(()=>speakText("Интерфейс настроен. Главный экран."), 400);
    }
  };

  if(stage === "splash"){
    return (
      <div className="device"><div className="device-screen">
        <div className="island"/>
        <Splash onStart={()=>setStage("setup")}/>
      </div></div>
    );
  }
  if(stage === "setup"){
    return (
      <div className="device"><div className="device-screen">
        <div className="island"/>
        <AccessibilitySetup onPick={applyProfile}/>
      </div></div>
    );
  }

  const screenTitle =
    view?.type === "article" ? (ARTICLES.find(a=>a.id===view.id)?.title || "Статья") :
    view?.type === "story" ? "Story" :
    view?.type === "resource" ? (LIBRARY.find(r=>r.id===view.id)?.title || "Ресурс") :
    view?.type === "paths" ? "Learning Hub" :
    view?.type === "compose" ? "Share Your Story" :
    tab === "home" ? "Главный экран" : tab === "library" ? "Библиотека" :
    tab === "stories" ? "Голоса сообщества" : "Профиль";

  const screenHint =
    !view && tab === "home" ? "Доступно: библиотека, обучающие пути, поделиться историей, лента сообщества" :
    !view && tab === "library" ? "Есть поиск и фильтры: все, книги, аудио, визуальные, сохранённые" :
    !view && tab === "stories" ? "Можно читать истории и опубликовать свою через кнопку плюс наверху" :
    !view && tab === "profile" ? "Здесь размер текста, контраст, голосовые подсказки и сброс данных" :
    view?.type === "compose" ? "Заполните название, страну и текст истории, затем опубликуйте" :
    "Кнопка назад в левом верхнем углу возвращает на предыдущий экран";

  const announceScreen = ()=> speakText(screenTitle + ". " + screenHint);

  const tabs = [
    ["home","Home",I.home],["library","Library",I.library],
    ["stories","Stories",I.stories],["profile","Profile",I.profile]
  ];

  let body;
  if(view){
    const back = ()=>setView(null);
    if(view.type==="article") body = <ArticleView id={view.id} onBack={back} go={go}/>;
    else if(view.type==="story") body = <StoryView id={view.id} onBack={back} liked={state.liked} toggleLike={toggleLike} myStories={state.myStories}/>;
    else if(view.type==="resource") body = <ResourceView id={view.id} onBack={back} saved={state.saved} toggleSave={toggleSave} notify={notify}/>;
    else if(view.type==="paths") body = <PathsView onBack={back} progress={state.progress} setProgress={setProgress} notify={notify}/>;
    else if(view.type==="compose") body = <Compose onBack={back} onSubmit={publish}/>;
  } else if(tab==="home") body = <Home go={go} greeting={greeting}/>;
  else if(tab==="library") body = <Library go={go} saved={state.saved} toggleSave={toggleSave}/>;
  else if(tab==="stories") body = <Stories go={go} liked={state.liked} toggleLike={toggleLike} myStories={state.myStories}/>;
  else body = <Profile state={state} set={setState} saved={state.saved} myStories={state.myStories} go={go} notify={notify}
                        onRerunSetup={()=>setStage("setup")}/>;

  return (
    <div className="device">
      <div className="device-screen">
        <div className="island"/>
        <div className="screen" style={screenStyle}
             data-contrast={s.contrast ? "on" : "off"}
             data-motion={s.motion ? "on" : "off"}>
          <StatusBar/>
          <div ref={scrollRef} style={{flex:1, position:"relative", display:"flex", flexDirection:"column"}} key={view ? view.type + (view.id||"") : tab}>
            {body}
          </div>
          {toast ? <Toast text={toast}/> : null}
          {voiceGuide ? <VoiceFab onPress={announceScreen} hasTabbar={!view}/> : null}
          {!view && (
            <nav className="tabbar">
              {tabs.map(([id,label,Icon])=>(
                <button key={id} className={"tab" + (tab===id ? " active" : "")}
                        onClick={()=>{ if(voiceGuide) speakText(label); setTab(id); setView(null); }}
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