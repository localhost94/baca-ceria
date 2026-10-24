const $app = document.getElementById("app");
const ROUND = 5;
const state = { player: null, progress: {}, lang: "id", mode: "baca" }; // mode menu: baca | hitung
try { if (localStorage.getItem("mode") === "hitung") state.mode = "hitung"; } catch {}
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const later = (ms, fn) => wait(ms).then(fn);
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
    a.onended = a.onpause = () => done(); // dipotong suara lain juga dianggap selesai
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
function tone(type, f0, f1, dur, vol) {
  try {
    audioCtx ||= new AudioContext();
    const t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + dur);
  } catch {}
}
const tok = () => tone("square", 220, 70, 0.09, 0.12);                                        // balok minecraft ditaruh
const klik = () => { tone("triangle", 2400, 1800, 0.03, 0.15); setTimeout(() => tone("triangle", 1600, 1200, 0.04, 0.12), 45); }; // bata lego menempel
// tap salah di dalam soal: bunyi + bintang ronde berkurang (diatur runRound)
let onMiss = null;
const miss = () => { bad(); onMiss?.(); };

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
  if (GAME_INFO[game]?.math) return mathPool(game); // kategori berhitung hanya mengganti tema benda
  const inGroup = (x) => !group || x.group === group;
  const words = LEX.words.filter(inGroup);
  switch (game) {
    case "huruf": case "tangkap": return [...new Set(words.map((w) => w.initial))];
    case "suku": return words.filter((w) => w.syl.length >= 2);
    case "tebak": return words;
    case "susun": return words.filter((w) => w.letters.length >= 2 && w.letters.length <= 6);
    case "dua": return LEX.phrases.filter(inGroup);
    case "kalimat": return LEX.sentences.filter(inGroup);
    case "minecraft": return poolFor("susun", group);
    case "lego": return [...LEX.phrases, ...LEX.sentences].filter(inGroup);
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
    h("p", { class: "sub" }, list.length ? "Siapa yang mau main?" : "Belum ada pemain. Minta orang tua menambahkan."),
    h("div", { class: "players" },
      list.map((p) => h("button", { class: "player", onclick: () => { state.player = p; menuScreen(); } },
        h("div", { class: "avatar" }, p.avatar), p.name, h("div", {}, `⭐ ${p.stars}`)))),
    h("button", { class: "btn small c-yellow", onclick: () => parentGate(adminScreen, playersScreen) }, "⚙️ Kelola pemain"));
  if (list.length) say("Siapa yang mau main?");
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
    h("h1", {}, "Pemain baru"), row, input,
    h("p", {}, h("button", { class: "btn c-green", onclick: async () => {
      if (!input.value.trim()) return input.focus();
      await api("/players", { method: "POST", body: { name: input.value, avatar } });
      adminScreen();
    } }, "Simpan ✔")),
    h("button", { class: "btn small c-red", onclick: adminScreen }, "Kembali")));
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
      h("button", { class: "btn small c-yellow", onclick: () => parentGate(parentScreen, menuScreen) }, "📊")),
    h("div", { class: "langs" }, Object.entries(LANGS).map(([code, l]) =>
      h("button", { class: "lang" + (code === state.lang ? " sel" : ""), onclick: () => setLang(code) }, l.label))),
    noVoice ? h("p", { class: "warn" }, `Suara ${LANGS[state.lang].label} belum tersedia. Teks tetap tampil.`) : null,
    h("div", { class: "langs" }, [["baca", "📖 Membaca"], ["hitung", "🔢 Berhitung"]].map(([m, label]) =>
      h("button", { class: "lang mode" + (m === state.mode ? " sel" : ""), onclick: () => {
        state.mode = m;
        try { localStorage.setItem("mode", m); } catch {}
        menuScreen();
      } }, label))),
    h("h1", {}, state.mode === "hitung" ? "Ayo berhitung!" : "Mau main apa?"),
    h("div", { class: "grid" }, Object.entries(GAME_INFO).filter(([, info]) => !info.math === (state.mode === "baca")).map(([g, info]) =>
      h("button", { class: `btn big ${info.color}`, onclick: () => groupScreen(g) },
        h("span", { class: "ico" }, info.ico), info.title))));
  say(state.mode === "hitung" ? `Halo ${me.name}! Ayo berhitung!` : `Halo ${me.name}! Mau main apa?`);
}

/* ---------- game engine ---------- */
const MAKERS = { huruf: qLetter, suku: qSyllable, tebak: qWord, susun: qBuild, dua: qTokens, kalimat: qTokens, tangkap: qCatch,
  minecraft: qMinecraft, lego: qLego,
  hitung: qCount, kenal: qNumeral, banding: qCompare, urut: qOrder, hilang: qMissing, tambah: qAdd, kurang: qSub, tangkapangka: qCatchNum };
const groupsOf = (game) => (GAME_INFO[game].math ? MATH_GROUPS : GROUPS);
const COLORS = ["c-pink", "c-blue", "c-green", "c-yellow", "c-purple", "c-red"];
const MIN_ITEMS = 3;

function groupScreen(game) {
  const info = GAME_INFO[game];
  const groups = info.math ? Object.entries(MATH_GROUPS) : Object.entries(GROUPS).filter(([g]) => poolFor(game, g).length >= MIN_ITEMS);
  const tiles = [["", { title: "Campur", ico: "🎲" }], ...groups];
  render(
    h("div", { class: "bar" }, h("button", { class: "btn small c-red", onclick: menuScreen }, "⬅"),
      h("div", { class: "stars" }, LANGS[state.lang].label)),
    h("h1", {}, `${info.ico} ${info.title}`),
    h("p", { class: "sub" }, "Pilih kategori"),
    h("div", { class: "grid" }, tiles.map(([g, t], i) =>
      h("button", { class: `btn big ${COLORS[i % COLORS.length]}`, onclick: () => startGame(game, g) },
        h("span", { class: "ico" }, t.ico), t.title, g && !info.math ? h("small", { class: "count" }, `${poolFor(game, g).length} item`) : null))));
  say("Pilih kategori");
}

function startGame(game, group = "") {
  const items = pickItems(game, poolFor(game, group), ROUND);
  runRound(game, items, 0, { stars: 0, right: 0 }, { group });
}

// score: stars = bintang bersih ronde (benar langsung +1, tap salah -1, min 0); right = jumlah benar langsung
function runRound(game, items, idx, score, ctx) {
  onMiss = null;
  if (idx >= items.length) return resultScreen(game, score, items, ctx);
  const info = GAME_INFO[game];
  const item = items[idx];
  const group = item.group || ctx.group;
  const dots = items.map((_, i) => h("div", { class: "dot" + (i < idx ? " done" : i === idx ? " now" : "") }));
  const body = h("div", { class: "card" + (isAr() ? " ar" : ""), dir: LANGS[state.lang].dir });
  let stars = score.stars;
  const starsEl = h("div", { class: "stars" }, `⭐ ${stars}`);
  onMiss = () => {
    if (!body.isConnected || !stars) return;
    starsEl.textContent = `⭐ ${--stars}`;
    starsEl.classList.remove("drop"); void starsEl.offsetWidth; starsEl.classList.add("drop");
  };
  render(
    h("div", { class: "bar" },
      h("button", { class: "btn small c-red", onclick: menuScreen }, "⬅"),
      h("div", { class: "progress" }, dots),
      starsEl),
    group ? h("div", { class: "chip" }, `${groupsOf(game)[group].ico} ${groupsOf(game)[group].title}`) : null,
    body);
  // speech: promise ucapan jawaban benar; lalu pujian, soal berikutnya baru muncul setelah semuanya selesai
  const finish = async (tries, speech) => {
    onMiss = null;
    good(); confetti();
    const talk = Promise.resolve(speech).then(() => body.isConnected && say(sample(PRAISE, 1)[0]));
    await Promise.all([saveAnswer(game, keyOf(item), tries), wait(1700), Promise.race([talk, wait(10000)])]);
    await wait(500);
    if (!body.isConnected) return; // sudah keluar ke menu
    const first = tries === 1 ? 1 : 0;
    runRound(game, items, idx + 1, { stars: stars + first, right: score.right + first }, ctx);
  };
  ctx.step = idx; ctx.total = items.length; // dipakai mode bangun (minecraft/lego)
  MAKERS[game](item, body, finish, info, ctx);
}

function choiceButtons(options, isRight, onRight, { emoji = false } = {}) {
  let tries = 1, locked = false;
  const box = h("div", { class: "choices" });
  options.forEach((o) => {
    const b = h("button", { class: "choice" + (emoji ? " emoji" : "") + (o.node ? " grp" : ""), onclick: () => {
      if (locked) return;
      if (o.say) sayL(o.say);
      if (isRight(o)) { locked = true; b.classList.add("right"); onRight(tries); }
      else { tries++; miss(); b.classList.remove("wrong"); void b.offsetWidth; b.classList.add("wrong"); }
    } }, o.node ?? o.label);
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
      body.append(h("div", { class: "word" }, `${letter} · ${target.word}`));
      finish(tries, sayParts([[letterName(letter), LEX.lang], [target.word, LEX.lang]]));
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
      finish(tries, later(400, () => sayL(w.word)));
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
    choiceButtons(opts, (o) => o.key === w.word, (tries) => finish(tries, later(400, () => sayL(w.word)))));
  setTimeout(() => say("Gambar apa ini? Pilih katanya"), 300);
}

// susun token (huruf atau kata) sesuai urutan; arah kanan-ke-kiri ikut atribut dir kartu
// skin (opsional, mode bangun): { theme, tile(i) -> class, place(), side: elemen bangunan, done() }
//   intro (opsional): ucapan pembuka pengganti, mis. supaya jawaban tidak ikut dibacakan
function buildTokens(tokens, full, pic, body, finish, info, wide, skin = null) {
  let next = 0, tries = 1;
  const slots = tokens.map(() => h("div", { class: "slot" + (wide ? " wide" : "") }));
  let order = shuffle(tokens);
  for (let i = 0; i < 10 && order.join("|") === tokens.join("|") && new Set(tokens).size > 1; i++) order = shuffle(order);
  const tiles = order.map((tok, i) => {
    const look = skin?.tile ? skin.tile(i) : "";
    const t = h("button", { class: "tile" + (wide ? " wide" : "") + (look ? " " + look : ""), textContent: tok, onclick: () => {
      if (t.classList.contains("used")) return;
      if (tok === tokens[next]) {
        skin?.place();
        sayL(tok); slots[next].textContent = tok; slots[next].classList.add("filled");
        if (look) slots[next].classList.add(...look.split(" "), "placed");
        t.classList.add("used"); next++;
        if (next === tokens.length) { skin?.done(); finish(tries, later(600, () => sayL(full))); }
      } else { tries++; miss(); t.classList.remove("wrong"); void t.offsetWidth; t.classList.add("wrong"); }
    } });
    return t;
  });
  const picture = h("div", { class: "picture", onclick: () => sayL(full) }, pic);
  const slotRow = h("div", { class: "slots" }, slots), tileRow = h("div", { class: "tiles" }, tiles);
  if (skin?.side) {
    body.classList.add(skin.theme);
    body.append(promptEl(info.hint), h("div", { class: "bgame" }, h("div", { class: "bplay" }, picture, slotRow, tileRow), skin.side));
  } else body.append(promptEl(info.hint), picture, slotRow, tileRow);
  setTimeout(() => sayParts(skin?.intro ?? [[info.hint, "id"], [full, LEX.lang]]), 300);
}
function qBuild(w, body, finish, info) { buildTokens(w.letters, w.word, w.pic, body, finish, info, false); }
function qTokens(p, body, finish, info) { buildTokens(p.text.split(" "), p.text, p.pic, body, finish, info, true); }

/* ---------- mode bangun: Minecraft (huruf -> kata) & Lego (kata -> kalimat) ---------- */
// tiap soal benar menambah 1 bagian; 5 bagian = bangunan selesai. Baris disusun dari bawah ke atas.
const BUILDS = {
  // rumah kayu 7 balok: s batu, l batang kayu, p papan, d pintu, g kaca, b atap bata, . kosong
  minecraft: ["sssssss", "lppdppl", "lpgdgpl", ".bbbbb.", "..bbb.."],
  // mobil: [lebar dari 10, warna]; "." = celah kosong
  lego: [
    [[10, "k"]],
    [[2, "y"], [6, "r"], [2, "r"]],
    [[1, "."], [4, "r"], [4, "r"], [1, "."]],
    [[2, "."], [2, "w"], [2, "w"], [2, "w"], [2, "."]],
    [[2, "."], [6, "b"], [2, "."]],
  ],
};
const PARTS = 5;
const partsDone = (done, total) => Math.round(done * PARTS / Math.max(1, total));

function buildView(game, done, fresh = false) {
  const rows = BUILDS[game].map((row, i) => {
    const on = i < done ? (fresh && i === done - 1 ? " on new" : " on") : "";
    const cells = game === "minecraft"
      ? [...row].map((c) => h("div", { class: "px" + (c === "." ? " empty" : " mc-" + c) }))
      : row.map(([w, c]) => h("div", { class: "lb" + (c === "." ? " empty" : " lg-" + c), style: `flex:${w}` }));
    return h("div", { class: "brow" + on }, cells, game === "lego" && i === 0 ? h("div", { class: "wheels" }, h("i"), h("i")) : null);
  });
  return h("div", { class: "build " + (game === "minecraft" ? "mc-build" : "lg-build") },
    h("div", { class: "build-label" }, `${game === "minecraft" ? "🏠 Rumah" : "🚗 Mobil"} · ${done}/${PARTS}`),
    h("div", { class: "build-stack" }, rows.reverse()));
}

function buildSkin(game, ctx, theme, looks, place) {
  const skin = {
    theme, place, tile: (i) => looks[i % looks.length],
    side: buildView(game, partsDone(ctx.step, ctx.total)),
    done: () => { const v = buildView(game, partsDone(ctx.step + 1, ctx.total), true); skin.side.replaceWith(v); skin.side = v; },
  };
  return skin;
}
function qMinecraft(w, body, finish, info, ctx) {
  const skin = buildSkin("minecraft", ctx, "mc", ["blk mc-grass", "blk mc-s", "blk mc-dirt", "blk mc-p"], tok);
  buildTokens(w.letters, w.word, w.pic, body, finish, info, false, skin);
}
function qLego(p, body, finish, info, ctx) {
  const skin = buildSkin("lego", ctx, "lg", ["brick lg-r", "brick lg-b", "brick lg-y", "brick lg-g", "brick lg-o"], klik);
  buildTokens(p.text.split(" "), p.text, p.pic, body, finish, info, true, skin);
}

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
    onWrong: () => { tries++; miss(); },
    onCatch: () => finish(tries, later(300, () => sayL(letterName(letter)))),
  }).catch((e) => console.error("pixi", e));
}

/* ---------- berhitung ---------- */
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
// soal per level; key dipakai progress (soal yang sering salah lebih sering muncul)
function mathPool(game) {
  const nums = (a, b) => range(a, b).map((n) => ({ key: String(n), n }));
  switch (game) {
    case "hitung": case "kenal": return nums(1, 10);
    case "tangkapangka": return nums(1, 9);
    case "banding": return range(1, 10).flatMap((a) => range(1, 10).filter((b) => b !== a)
      .flatMap((b) => ["lebih", "kurang"].map((ask) => ({ key: `${ask} ${a}|${b}`, a, b, ask }))));
    case "urut": return Array.from({ length: 40 }, () => {
      const top = sample([10, 15, 20], 1)[0];
      const ns = sample(range(1, top), 4).sort((x, y) => x - y);
      return { key: ns.join(","), ns };
    });
    case "hilang": return range(1, 16).flatMap((start) => range(0, 4).map((pos) => ({ key: `${start}..${start + 4} #${pos}`, start, pos })));
    case "tambah": return range(1, 9).flatMap((a) => range(1, 10 - a).map((b) => ({ key: `${a}+${b}`, a, b })));
    case "kurang": return range(2, 10).flatMap((a) => range(1, a - 1).map((b) => ({ key: `${a}-${b}`, a, b })));
  }
  return [];
}
// benda tema kategori (Campur = tema acak tiap soal)
function themeEmo(ctx, n = 1) {
  const g = ctx.group || sample(Object.keys(MATH_GROUPS), 1)[0];
  return sample(MATH_GROUPS[g].emo, n);
}
// angka pengecoh di sekitar jawaban
function nearNums(n, lo, hi, k = 2) {
  const near = shuffle(range(Math.max(lo, n - 3), Math.min(hi, n + 3)).filter((x) => x !== n));
  return near.length >= k ? near.slice(0, k) : [...near, ...sample(range(lo, hi).filter((x) => x !== n && !near.includes(x)), k - near.length)];
}
const sayN = (n) => sayL(String(n));
const numChoices = (n, lo, hi) => shuffle([n, ...nearNums(n, lo, hi)]).map((x) => ({ key: x, label: String(x), say: String(x) }));
// sekelompok benda (baris isi 5); countable: ketuk benda untuk menghitung keras-keras
function objs(n, emo, { countable = false, gone = 0 } = {}) {
  let counted = 0;
  return h("div", { class: "objs" + (n > 5 ? " ten" : "") }, range(1, n).map((i) => {
    const o = h("span", { class: "obj" + (i > n - gone ? " gone" : ""), textContent: emo });
    if (countable) o.onclick = (e) => {
      e.stopPropagation();
      if (o.dataset.n) return sayN(o.dataset.n);
      o.dataset.n = ++counted; o.classList.add("counted"); sayN(counted);
    };
    return o;
  }));
}
const mathCard = (body) => { body.dir = "ltr"; body.classList.add("math"); };
const sentence = (a, op, b, c) => { const w = MATH_WORDS[LEX.lang]; return `${a} ${w[op]} ${b} ${w.eq} ${c}`; };

function qCount(it, body, finish, info, ctx) {
  mathCard(body);
  const [emo] = themeEmo(ctx);
  body.append(promptEl(info.hint), objs(it.n, emo, { countable: true }),
    choiceButtons(numChoices(it.n, 1, 10), (o) => o.key === it.n, (tries) => finish(tries, later(300, () => sayN(it.n)))));
  setTimeout(() => say(info.hint), 300);
}

function qNumeral(it, body, finish, info, ctx) {
  mathCard(body);
  const [emo] = themeEmo(ctx);
  const opts = shuffle([it.n, ...nearNums(it.n, 1, 10)]).map((x) => ({ key: x, node: objs(x, emo), say: String(x) }));
  body.append(promptEl(info.hint), h("div", { class: "letter", onclick: () => sayN(it.n) }, String(it.n)),
    choiceButtons(opts, (o) => o.key === it.n, (tries) => finish(tries, later(300, () => sayN(it.n)))));
  setTimeout(() => sayParts([["Angka", "id"], [String(it.n), LEX.lang], [info.hint, "id"]]), 300);
}

function qCompare(it, body, finish, info, ctx) {
  mathCard(body);
  const emos = themeEmo(ctx, 2);
  const q = it.ask === "lebih" ? "Mana yang lebih banyak?" : "Mana yang lebih sedikit?";
  const right = it.ask === "lebih" ? Math.max(it.a, it.b) : Math.min(it.a, it.b);
  const opts = [it.a, it.b].map((x, i) => ({ key: x, node: objs(x, emos[i]), say: String(x) }));
  const box = choiceButtons(opts, (o) => o.key === right, (tries) => {
    box.querySelectorAll(".choice").forEach((b, i) => b.append(h("div", { class: "num" }, String(opts[i].key))));
    finish(tries, later(300, () => sayN(right)));
  });
  box.classList.add("two");
  body.append(promptEl(q), box);
  setTimeout(() => say(q), 300);
}

function qOrder(it, body, finish, info, ctx) {
  mathCard(body);
  const toks = it.ns.map(String);
  buildTokens(toks, toks.join(", "), themeEmo(ctx, 3).join(" "), body, finish, info, true, { intro: [[info.hint, "id"]] });
}

function qMissing(it, body, finish, info, ctx) {
  mathCard(body);
  const seq = range(it.start, it.start + 4), ans = seq[it.pos];
  const cells = seq.map((n, i) => h("div", { class: "slot wide" + (i === it.pos ? "" : " filled") }, i === it.pos ? "?" : String(n)));
  body.append(promptEl(info.hint), h("div", { class: "picture" }, themeEmo(ctx)[0]), h("div", { class: "slots" }, cells),
    choiceButtons(numChoices(ans, 1, 20), (o) => o.key === ans, (tries) => {
      cells[it.pos].textContent = String(ans); cells[it.pos].classList.add("filled", "placed");
      finish(tries, later(300, () => sayL(seq.join(", "))));
    }));
  setTimeout(() => say(info.hint), 300);
}

function qAdd(it, body, finish, info, ctx) {
  mathCard(body);
  const [emo] = themeEmo(ctx), sum = it.a + it.b;
  const ans = h("span", { class: "gap" }, "?");
  body.append(promptEl(info.hint),
    h("div", { class: "sum" }, objs(it.a, emo, { countable: true }), h("span", { class: "op" }, "+"), objs(it.b, emo, { countable: true })),
    h("div", { class: "word" }, `${it.a} + ${it.b} = `, ans),
    choiceButtons(numChoices(sum, 1, 10), (o) => o.key === sum, (tries) => {
      ans.textContent = String(sum); ans.style.borderBottomStyle = "solid";
      finish(tries, later(300, () => sayL(sentence(it.a, "plus", it.b, sum))));
    }));
  setTimeout(() => say(info.hint), 300);
}

function qSub(it, body, finish, info, ctx) {
  mathCard(body);
  const [emo] = themeEmo(ctx), rest = it.a - it.b;
  const ans = h("span", { class: "gap" }, "?");
  body.append(promptEl(info.hint), objs(it.a, emo, { gone: it.b }),
    h("div", { class: "word" }, `${it.a} − ${it.b} = `, ans),
    choiceButtons(numChoices(rest, 0, 10), (o) => o.key === rest, (tries) => {
      ans.textContent = String(rest); ans.style.borderBottomStyle = "solid";
      finish(tries, later(300, () => sayL(sentence(it.a, "minus", it.b, rest))));
    }));
  setTimeout(() => say(info.hint), 300);
}

function qCatchNum(it, body, finish, info, ctx) {
  mathCard(body);
  let tries = 1;
  const host = h("div", { class: "pixi-host" });
  body.append(promptEl(info.hint), objs(it.n, themeEmo(ctx)[0], { countable: true }), host);
  setTimeout(() => say(info.hint), 300);
  Fx.bubbles(host, String(it.n), {
    alphabet: "123456789",
    display: (l) => l,
    say: (l) => sayL(l),
    onWrong: () => { tries++; miss(); },
    onCatch: () => finish(tries, later(300, () => sayN(it.n))),
  }).catch((e) => console.error("pixi", e));
}

/* ---------- result + parent ---------- */
function resultScreen(game, { stars, right }, items, ctx) {
  const msg = right === items.length ? "Hebat sekali! 🏆" : right >= 3 ? "Bagus! 👏" : "Ayo coba lagi! 💪";
  confetti(); good(); say(msg.replace(/[^\p{L}\s!]/gu, ""));
  render(h("div", { class: "card" },
    h("h1", {}, msg),
    BUILDS[game] ? buildView(game, PARTS) : null,
    h("div", { class: "star-row" }, stars ? Array.from({ length: stars }, () => h("span", {}, "⭐")) : h("span", {}, "🌱")),
    h("p", { class: "sub" }, `${right} dari ${items.length} benar langsung · dapat ⭐ ${stars}`),
    h("p", {},
      h("button", { class: "btn c-green", onclick: () => startGame(game, ctx.group) }, "Main lagi ▶"), " ",
      h("button", { class: "btn c-blue", onclick: menuScreen }, "Menu"))));
}

function parentGate(onPass, onCancel) {
  const a = 3 + (Math.random() * 6 | 0), b = 3 + (Math.random() * 6 | 0);
  const input = h("input", { type: "number", inputMode: "numeric" });
  render(h("div", { class: "card" },
    h("h1", {}, "Khusus orang tua"),
    h("p", { class: "sub" }, `Berapa ${a} + ${b}?`), input,
    h("p", {},
      h("button", { class: "btn c-green", onclick: () => Number(input.value) === a + b ? onPass() : (input.value = "", input.focus()) }, "Buka"), " ",
      h("button", { class: "btn c-red", onclick: onCancel }, "Batal"))));
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

async function adminScreen() {
  const list = await api("/players");
  render(h("div", { class: "card" },
    h("h1", {}, "Kelola pemain"),
    list.length
      ? h("table", {}, list.map((p) => h("tr", {},
          h("td", {}, `${p.avatar} ${p.name}`), h("td", {}, `⭐ ${p.stars}`),
          h("td", {}, h("button", { class: "btn small c-red", onclick: async () => {
            if (confirm(`Hapus ${p.name} dan semua datanya?`)) { await api(`/players/${p.id}`, { method: "DELETE" }); adminScreen(); }
          } }, "Hapus")))))
      : h("p", {}, "Belum ada pemain."),
    h("p", {},
      h("button", { class: "btn c-green", onclick: newPlayerScreen }, "➕ Tambah pemain"), " ",
      h("button", { class: "btn c-blue", onclick: playersScreen }, "Kembali"))));
}

playersScreen();
