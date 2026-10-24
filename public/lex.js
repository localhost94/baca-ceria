// Bangun kosakata per bahasa dari data.js. Dipakai browser (app.js) dan tools/prewarm-audio.ts.
const AR_MARK = /[ً-ْٰ]/;
const AR_MARKS = /[ً-ْٰ]/g;
const AR_VOWEL = /[ً-ِ]/; // tanwin, fathah, dammah, kasrah
// huruf Arab beserta harakatnya: "قَلَم" -> ["قَ", "لَ", "م"]
function arLetters(word) {
  const out = [];
  for (const ch of word) {
    if (AR_MARK.test(ch) && out.length) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}
// suku kata: huruf berharakat membuka suku baru; huruf mati/mad/tanpa harakat menempel ke suku sebelumnya
function arSyllables(word) {
  const syl = [];
  for (const c of arLetters(word)) {
    const opens = AR_VOWEL.test(c) || c[0] === "آ";
    if (syl.length && !opens) syl[syl.length - 1] += c;
    else syl.push(c);
  }
  return syl;
}
function initialOf(word, lang) {
  if (lang !== "ar") return word[0].toUpperCase();
  const c = word.replace(AR_MARKS, "")[0];
  return "أإآ".includes(c) ? "ا" : c;
}
const letterNameOf = (l, lang) => (lang === "ar" ? AR_NAMES[l] || l : lang === "id" ? l.toLowerCase() : l);

const COL = { id: 2, en: 3, ar: 4 };
function buildLex(lang) {
  const col = COL[lang], ar = lang === "ar";
  const words = CONCEPTS.filter((c) => c[col]).map((c) => {
    const raw = c[col], word = ar ? raw : raw.replace(/-/g, "");
    return { key: word, word, pic: c[0], group: c[1], initial: initialOf(word, lang),
      syl: ar ? arSyllables(raw) : raw.split("-"), letters: ar ? arLetters(raw) : [...word] };
  });
  const rows = (list) => list.filter((r) => r[col]).map((r) => ({ key: r[col], text: r[col], pic: r[0], group: r[1] }));
  // pilihan jawaban cerita = emoji CONCEPTS; kata dalam bahasa ini ditampilkan & diucapkan (kosong = emoji saja)
  const wordOf = new Map(words.map((w) => [w.pic, w.word]));
  const stories = STORIES.filter((s) => s[lang]).map((s) => {
    const [title, text, ...asks] = s[lang];
    const story = { key: title, title, pic: s.pic, group: s.group, tier: s.tier, sentences: sentencesOf(text) };
    story.qs = s.qs.map((opts, n) => ({ key: `${title} #${n + 1}`, n, text: asks[n], story, group: s.group,
      opts: opts.map((pic) => ({ pic, word: wordOf.get(pic) || "" })) }));
    return story;
  });
  return { lang, words, phrases: rows(PHRASES), sentences: rows(SENTENCES), stories };
}
// cerita dipecah per kalimat: diucapkan satu-satu (batas teks tts 200 huruf) dan disorot saat dibacakan
const sentencesOf = (text) => text.match(/[^.!?؟]+[.!?؟]*/g).map((s) => s.trim()).filter(Boolean);

// semua teks yang mungkin diucapkan dalam satu bahasa (untuk menyiapkan audio)
function speechTexts(lang) {
  const L = buildLex(lang), out = new Set();
  for (const w of L.words) { out.add(w.word); w.syl.forEach((s) => out.add(s)); w.letters.forEach((s) => out.add(s)); }
  for (const p of [...L.phrases, ...L.sentences]) { out.add(p.text); p.text.split(" ").forEach((t) => out.add(t)); }
  for (const s of L.stories) { out.add(s.title); s.sentences.forEach((t) => out.add(t)); s.qs.forEach((q) => out.add(q.text)); }
  for (const l of ALPHABETS[lang]) out.add(letterNameOf(l, lang));
  for (let n = 0; n <= 20; n++) out.add(String(n));
  if (lang === "id") { [...PROMPTS, ...PRAISE, ...MATH_PROMPTS].forEach((p) => out.add(p)); Object.values(GAME_INFO).forEach((g) => out.add(g.hint)); }
  return [...out];
}
