const $app = document.getElementById("app");
const ROUND = 5;
const state = { player: null, progress: {}, lang: "id" };
let LEX = null; // konten bahasa aktif, dibangun dari data.js

/* ---------- util ---------- */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el[k] = v;
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}
const render = (...nodes) => { window.Fx?.cleanup(); $app.replaceChildren(...nodes.filter((n) => n != null)); window.scrollTo(0, 0); };
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sample = (a, n) => shuffle(a).slice(0, n);
const api = async (path, opts) => {
  const r = await fetch("/api" + path, opts && { ...opts, headers: { "Content-Type": "application/json" }, body: opts.body && JSON.stringify(opts.body) });
  return r.json();
};

/* ---------- suara ---------- */
// Utama: audio neural dari server (/api/tts, di-cache jadi mp3). Cadangan: suara browser.
const voices = {};
const NATURAL = /natural|neural|online|google|premium|enhanced/i;
function pickVoices() {
  const all = speechSynthesis.getVoices();
  for (const code of Object.keys(LANGS)) {
    const match = all.filter((v) => v.lang.toLowerCase().startsWith(code));
    voices[code] = match.find((v) => NATURAL.test(v.name)) || match[0] || null;
  }
}
if ("speechSynthesis" in window) { pickVoices(); speechSynthesis.onvoiceschanged = pickVoices; }

let speakToken = 0, currentAudio = null;
function browserSpeak(text, lang) {
  return new Promise((done) => {
    if (!("speechSynthesis" in window)) return done();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANGS[lang].tts; u.rate = 0.85;
    if (voices[lang]) u.voice = voices[lang];
    u.onend = u.onerror = () => done();
    speechSynthesis.speak(u);
  });
}
function playTts(text, lang, token) {
  return new Promise((done, fail) => {
    const a = new Audio(`/api/tts?lang=${lang}&text=${encodeURIComponent(text)}`);
    currentAudio = a;
    a.onended = () => done();
    a.onerror = () => fail(new Error("tts"));
    a.play().catch(fail);
    if (token !== speakToken) a.pause();
  });
}
// parts: [[teks, kodeBahasa], ...] diucapkan berurutan; instruksi pakai "id", isi pakai bahasa aktif
async function sayParts(parts) {
  const token = ++speakToken;
  currentAudio?.pause();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  for (const [text, lang] of parts) {
    if (token !== speakToken) return;
    try { await playTts(text, lang, token); }
    catch { if (token === speakToken) await browserSpeak(text, lang); }
  }
}
const say = (text, lang = "id") => sayParts([[text, lang]]);
const sayL = (text) => say(text, LEX.lang);

let audioCtx;
function beep(freqs, dur = 0.13) {
  try {
    audioCtx ||= new AudioContext();
    freqs.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "triangle"; o.frequency.value = f;
      g.gain.setValueAtTime(0.18, audioCtx.currentTime + i * dur);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + (i + 1) * dur);
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime + i * dur); o.stop(audioCtx.currentTime + (i + 1) * dur);
    });
  } catch {}
}
const good = () => beep([660, 880, 1100]);
const bad = () => beep([220, 180], 0.18);

function confetti() {
  if (window.Fx && window.PIXI) return Fx.confetti().catch(domConfetti);
  domConfetti();
}
function domConfetti() {
  const box = h("div", { class: "confetti" });
  for (let i = 0; i < 40; i++) {
    box.append(h("i", { textContent: sample(["⭐", "🎉", "✨", "🎈"], 1)[0],
      style: `left:${Math.random() * 100}%;animation-delay:${Math.random() * .8}s` }));
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 3500);
}

/* ---------- bahasa & konten (lihat lex.js) ---------- */
const isAr = () => LEX.lang === "ar";
const letterName = (l) => letterNameOf(l, LEX.lang);
const showLetter = (l) => (isAr() ? l : l + l.toLowerCase());
const keyOf = (it) => (typeof it === "string" ? it : it.key);

function poolFor(game, group) {
  const inGroup = (x) => !group || x.group === group;
  const words = LEX.words.filter(inGroup);
  switch (game) {
    case "huruf": case "tangkap": return [...new Set(words.map((w) => w.initial))];
    case "suku": return words.filter((w) => w.syl.length >= 2);
    case "tebak": return words;
    case "susun": return words.filter((w) => w.letters.length >= 2 && w.letters.length <= 6);
    case "dua": return LEX.phrases.filter(inGroup);
    case "kalimat": return LEX.sentences.filter(inGroup);
  }
  return [];
}

/* ---------- progress ---------- */
async function loadProgress() {
  const rows = await api(`/players/${state.player.id}/progress?lang=${state.lang}`);
  state.progress = {};
  for (const r of rows) state.progress[r.game + ":" + r.item] = r;
}
// item yang sering salah / belum dicoba lebih sering muncul
function weight(game, item) {
  const p = state.progress[game + ":" + item];
  return p ? Math.max(1, 3 + p.wrong - p.right) : 4;
}
function pickItems(game, items, n) {
  const pool = [...items], out = [];
  while (out.length < n && pool.length) {
    const ws = pool.map((it) => weight(game, keyOf(it)));
    let r = Math.random() * ws.reduce((a, b) => a + b, 0), i = 0;
    while ((r -= ws[i]) > 0) i++;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
const saveAnswer = (game, item, tries) => {
  const correct = tries === 1;
  const p = (state.progress[game + ":" + item] ||= { game, item, right: 0, wrong: 0 });
  correct ? p.right++ : p.wrong++;
  return api(`/players/${state.player.id}/answers`, { method: "POST", body: { lang: state.lang, game, item, correct, tries } }).catch(() => {});
};

/* ---------- screens ---------- */
async function playersScreen() {
  const list = await api("/players");
  render(
    h("h1", {}, "📚 Baca Ceria"),
    h("p", { class: "sub" }, "Siapa yang mau main?"),
    h("div", { class: "players" },
      list.map((p) => h("button", { class: "player", onclick: () => { state.player = p; menuScreen(); } },
        h("div", { class: "avatar" }, p.avatar), p.name, h("div", {}, `⭐ ${p.stars}`))),
      h("button", { class: "player", onclick: newPlayerScreen }, h("div", { class: "avatar" }, "➕"), "Baru")));
  say("Siapa yang mau main?");
}

function newPlayerScreen() {
  let avatar = AVATARS[0];
  const input = h("input", { type: "text", placeholder: "Nama", maxLength: 20 });
  const row = h("div", { class: "avatars" }, AVATARS.map((a) => {
    const b = h("button", { class: a === avatar ? "sel" : "", textContent: a, onclick: () => {
      avatar = a; row.querySelectorAll("button").forEach((x) => x.classList.toggle("sel", x === b));
    } });
    return b;
  }));
  render(h("div", { class: "card" },
    h("h1", {}, "Halo! 👋"), row, input,
    h("p", {}, h("button", { class: "btn c-green", onclick: async () => {
      if (!input.value.trim()) return input.focus();
      state.player = await api("/players", { method: "POST", body: { name: input.value, avatar } });
      menuScreen();
    } }, "Mulai ▶")),
    h("button", { class: "btn small c-red", onclick: playersScreen }, "Kembali")));
}

async function setLang(lang) {
  await api(`/players/${state.player.id}`, { method: "PATCH", body: { lang } });
  state.player.lang = lang;
  return menuScreen();
}

async function menuScreen() {
  const list = await api("/players");
  const me = list.find((p) => p.id === state.player.id);
  if (!me) return playersScreen();
  state.player = me;
  state.lang = LANGS[me.lang] ? me.lang : "id";
  LEX = buildLex(state.lang);
  await loadProgress();
  const tts = await api("/tts/status").catch(() => ({ ok: false }));
  const noVoice = !tts.ok && !voices[state.lang];
  render(
    h("div", { class: "bar" },
      h("button", { class: "btn small c-red", onclick: playersScreen }, "🏠"),
      h("div", { class: "stars" }, `${me.avatar} ${me.name}  ⭐ ${me.stars}`),
      h("button", { class: "btn small c-yellow", onclick: parentGate }, "📊")),
    h("div", { class: "langs" }, Object.entries(LANGS).map(([code, l]) =>
      h("button", { class: "lang" + (code === state.lang ? " sel" : ""), onclick: () => setLang(code) }, l.label))),
    noVoice ? h("p", { class: "warn" }, `Suara ${LANGS[state.lang].label} belum tersedia. Teks tetap tampil.`) : null,
    h("h1", {}, "Mau main apa?"),
    h("div", { class: "grid" }, Object.entries(GAME_INFO).map(([g, info]) =>
      h("button", { class: `btn big ${info.color}`, onclick: () => groupScreen(g) },
        h("span", { class: "ico" }, info.ico), info.title))));
  say(`Halo ${me.name}! Mau main apa?`);
}

/* ---------- game engine ---------- */
const MAKERS = { huruf: qLetter, suku: qSyllable, tebak: qWord, susun: qBuild, dua: qTokens, kalimat: qTokens, tangkap: qCatch };
const COLORS = ["c-pink", "c-blue", "c-green", "c-yellow", "c-purple", "c-red"];
const MIN_ITEMS = 3;

function groupScreen(game) {
  const info = GAME_INFO[game];
  const groups = Object.entries(GROUPS).filter(([g]) => poolFor(game, g).length >= MIN_ITEMS);
  const tiles = [["", { title: "Campur", ico: "🎲" }], ...groups];
  render(
    h("div", { class: "bar" }, h("button", { class: "btn small c-red", onclick: menuScreen }, "⬅"),
      h("div", { class: "stars" }, LANGS[state.lang].label)),
    h("h1", {}, `${info.ico} ${info.title}`),
    h("p", { class: "sub" }, "Pilih kategori"),
    h("div", { class: "grid" }, tiles.map(([g, t], i) =>
      h("button", { class: `btn big ${COLORS[i % COLORS.length]}`, onclick: () => startGame(game, g) },
        h("span", { class: "ico" }, t.ico), t.title, g ? h("small", { class: "count" }, `${poolFor(game, g).length} item`) : null))));
  say("Pilih kategori");
}

function startGame(game, group = "") {
  const items = pickItems(game, poolFor(game, group), ROUND);
  runRound(game, items, 0, 0, { group });
}

function runRound(game, items, idx, stars, ctx) {
  if (idx >= items.length) return resultScreen(game, stars, items, ctx);
  const info = GAME_INFO[game];
  const item = items[idx];
  const group = item.group || ctx.group;
  const dots = items.map((_, i) => h("div", { class: "dot" + (i < idx ? " done" : i === idx ? " now" : "") }));
  const body = h("div", { class: "card" + (isAr() ? " ar" : ""), dir: LANGS[state.lang].dir });
  render(
    h("div", { class: "bar" },
      h("button", { class: "btn small c-red", onclick: menuScreen }, "⬅"),
      h("div", { class: "progress" }, dots),
      h("div", { class: "stars" }, `⭐ ${stars}`)),
    group ? h("div", { class: "chip" }, `${GROUPS[group].ico} ${GROUPS[group].title}`) : null,
    body);
  const finish = async (tries) => {
    await saveAnswer(game, keyOf(item), tries);
    good(); confetti();
    setTimeout(() => runRound(game, items, idx + 1, stars + (tries === 1 ? 1 : 0), ctx), 1700);
  };
  MAKERS[game](item, body, finish, info, ctx);
}

function choiceButtons(options, isRight, onRight, { emoji = false } = {}) {
  let tries = 1, locked = false;
  const box = h("div", { class: "choices" });
  options.forEach((o) => {
    const b = h("button", { class: "choice" + (emoji ? " emoji" : ""), textContent: o.label, onclick: () => {
      if (locked) return;
      if (o.say) sayL(o.say);
      if (isRight(o)) { locked = true; b.classList.add("right"); onRight(tries); }
      else { tries++; bad(); b.classList.remove("wrong"); void b.offsetWidth; b.classList.add("wrong"); }
    } });
    box.append(b);
  });
  return box;
}
const promptEl = (text) => h("p", { class: "prompt", dir: "ltr" }, text);

function qLetter(letter, body, finish, info, ctx) {
  const target = sample(LEX.words.filter((w) => w.initial === letter && (!ctx.group || w.group === ctx.group)), 1)[0];
  const wrong = sample(LEX.words.filter((w) => w.initial !== letter), 2);
  const opts = shuffle([target, ...wrong]).map((w) => ({ key: w.word, label: w.pic, say: w.word }));
  body.append(
    promptEl(info.hint),
    h("div", { class: "letter", onclick: () => sayL(letterName(letter)) }, showLetter(letter)),
    choiceButtons(opts, (o) => o.key === target.word, (tries) => {
      sayParts([[letterName(letter), LEX.lang], [target.word, LEX.lang]]);
      body.append(h("div", { class: "word" }, `${letter} · ${target.word}`)); finish(tries);
    }, { emoji: true }));
  setTimeout(() => sayParts([["Huruf", "id"], [letterName(letter), LEX.lang], [info.hint, "id"]]), 300);
}

function qSyllable(w, body, finish, info) {
  const pos = Math.random() * w.syl.length | 0;
  const pool = [...new Set(LEX.words.flatMap((x) => x.syl))].filter((s) => s !== w.syl[pos]);
  const opts = shuffle([w.syl[pos], ...sample(pool, 2)]).map((s) => ({ key: s, label: s, say: s }));
  const shown = h("div", { class: "word" }, w.syl.map((s, i) => (i === pos ? h("span", { class: "gap" }, "?") : s)).flatMap((x, i) => (i ? [" - ", x] : [x])));
  body.append(
    promptEl(info.hint),
    h("div", { class: "picture", onclick: () => sayL(w.word) }, w.pic), shown,
    choiceButtons(opts, (o) => o.key === w.syl[pos], (tries) => {
      const gap = shown.querySelector(".gap"); gap.textContent = w.syl[pos]; gap.style.borderBottomStyle = "solid";
      setTimeout(() => sayL(w.word), 400); finish(tries);
    }));
  setTimeout(() => say("Suku kata apa yang hilang?"), 300);
}

function qWord(w, body, finish, info) {
  const near = LEX.words.filter((x) => x.word !== w.word && x.group === w.group);
  const src = near.length >= 2 ? near : LEX.words.filter((x) => x.word !== w.word);
  const opts = shuffle([w, ...sample(src, 2)]).map((x) => ({ key: x.word, label: x.word, say: x.word }));
  body.append(
    promptEl(info.hint),
    h("div", { class: "picture", onclick: () => sayL(w.word) }, w.pic),
    choiceButtons(opts, (o) => o.key === w.word, (tries) => { setTimeout(() => sayParts([[w.word, LEX.lang], ["Bagus!", "id"]]), 400); finish(tries); }));
  setTimeout(() => say("Gambar apa ini? Pilih katanya"), 300);
}

// susun token (huruf atau kata) sesuai urutan; arah kanan-ke-kiri ikut atribut dir kartu
function buildTokens(tokens, full, pic, body, finish, info, wide) {
  let next = 0, tries = 1;
  const slots = tokens.map(() => h("div", { class: "slot" + (wide ? " wide" : "") }));
  let order = shuffle(tokens);
  for (let i = 0; i < 10 && order.join("|") === tokens.join("|") && new Set(tokens).size > 1; i++) order = shuffle(order);
  const tiles = order.map((tok) => {
    const t = h("button", { class: "tile" + (wide ? " wide" : ""), textContent: tok, onclick: () => {
      if (t.classList.contains("used")) return;
      if (tok === tokens[next]) {
        sayL(tok); slots[next].textContent = tok; slots[next].classList.add("filled");
        t.classList.add("used"); next++;
        if (next === tokens.length) { setTimeout(() => sayL(full), 600); finish(tries); }
      } else { tries++; bad(); t.classList.remove("wrong"); void t.offsetWidth; t.classList.add("wrong"); }
    } });
    return t;
  });
  body.append(
    promptEl(info.hint),
    h("div", { class: "picture", onclick: () => sayL(full) }, pic),
    h("div", { class: "slots" }, slots), h("div", { class: "tiles" }, tiles));
  setTimeout(() => sayParts([[info.hint, "id"], [full, LEX.lang]]), 300);
}
function qBuild(w, body, finish, info) { buildTokens(w.letters, w.word, w.pic, body, finish, info, false); }
function qTokens(p, body, finish, info) { buildTokens(p.text.split(" "), p.text, p.pic, body, finish, info, true); }

function qCatch(letter, body, finish, info) {
  let tries = 1;
  const host = h("div", { class: "pixi-host" });
  body.append(promptEl(info.hint),
    h("div", { class: "letter small", onclick: () => sayL(letterName(letter)) }, showLetter(letter)), host);
  setTimeout(() => sayParts([["Tangkap huruf", "id"], [letterName(letter), LEX.lang]]), 300);
  Fx.bubbles(host, letter, {
    alphabet: ALPHABETS[LEX.lang],
    display: isAr() ? (l) => l : (l) => (Math.random() < 0.5 ? l : l.toLowerCase()),
    say: (l) => sayL(letterName(l)),
    onWrong: () => { tries++; bad(); },
    onCatch: () => { good(); setTimeout(() => sayParts([[letterName(letter), LEX.lang], ["Bagus!", "id"]]), 300); finish(tries); },
  }).catch((e) => console.error("pixi", e));
}

/* ---------- result + parent ---------- */
function resultScreen(game, stars, items, ctx) {
  const msg = stars === items.length ? "Hebat sekali! 🏆" : stars >= 3 ? "Bagus! 👏" : "Ayo coba lagi! 💪";
  confetti(); good(); say(msg.replace(/[^\p{L}\s!]/gu, ""));
  render(h("div", { class: "card" },
    h("h1", {}, msg),
    h("div", { class: "star-row" }, stars ? Array.from({ length: stars }, () => h("span", {}, "⭐")) : h("span", {}, "🌱")),
    h("p", { class: "sub" }, `${stars} dari ${items.length} benar langsung`),
    h("p", {},
      h("button", { class: "btn c-green", onclick: () => startGame(game, ctx.group) }, "Main lagi ▶"), " ",
      h("button", { class: "btn c-blue", onclick: menuScreen }, "Menu"))));
}

function parentGate() {
  const a = 3 + (Math.random() * 6 | 0), b = 3 + (Math.random() * 6 | 0);
  const input = h("input", { type: "number", inputMode: "numeric" });
  render(h("div", { class: "card" },
    h("h1", {}, "Khusus orang tua"),
    h("p", { class: "sub" }, `Berapa ${a} + ${b}?`), input,
    h("p", {},
      h("button", { class: "btn c-green", onclick: () => Number(input.value) === a + b ? parentScreen() : (input.value = "", input.focus()) }, "Buka"), " ",
      h("button", { class: "btn c-red", onclick: menuScreen }, "Batal"))));
}

async function parentScreen() {
  const s = await api(`/players/${state.player.id}/summary`);
  const langName = (c) => LANGS[c]?.label ?? c;
  render(h("div", { class: "card" },
    h("h1", {}, `${state.player.avatar} ${state.player.name}`),
    s.games.length
      ? h("table", {}, h("tr", {}, ["Bahasa", "Permainan", "Jawaban", "Benar langsung", "Item"].map((t) => h("th", {}, t))),
          s.games.map((g) => h("tr", {}, [langName(g.lang), GAME_INFO[g.game]?.title ?? g.game, g.total, `${Math.round(g.right / g.total * 100)}%`, g.items].map((t) => h("td", {}, String(t))))))
      : h("p", {}, "Belum ada data."),
    s.hardest.length ? h("p", {}, "Sering salah: " + s.hardest.map((x) => `${x.item} (${langName(x.lang)}, ${x.wrong}×)`).join(", ")) : null,
    h("p", {},
      h("button", { class: "btn c-blue", onclick: menuScreen }, "Kembali"), " ",
      h("button", { class: "btn small c-red", onclick: async () => {
        if (confirm(`Hapus ${state.player.name} dan semua datanya?`)) { await api(`/players/${state.player.id}`, { method: "DELETE" }); playersScreen(); }
      } }, "Hapus pemain"))));
}

playersScreen();
