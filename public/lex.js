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
  return { lang, words, phrases: rows(PHRASES), sentences: rows(SENTENCES) };
}

// semua teks yang mungkin diucapkan dalam satu bahasa (untuk menyiapkan audio)
function speechTexts(lang) {
  const L = buildLex(lang), out = new Set();
  for (const w of L.words) { out.add(w.word); w.syl.forEach((s) => out.add(s)); w.letters.forEach((s) => out.add(s)); }
  for (const p of [...L.phrases, ...L.sentences]) { out.add(p.text); p.text.split(" ").forEach((t) => out.add(t)); }
  for (const l of ALPHABETS[lang]) out.add(letterNameOf(l, lang));
  if (lang === "id") { [...PROMPTS, ...PRAISE].forEach((p) => out.add(p)); Object.values(GAME_INFO).forEach((g) => out.add(g.hint)); }
  return [...out];
}
