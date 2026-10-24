// Siapkan semua audio lebih dulu supaya game tidak menunggu dan bisa jalan offline.
// Pakai: bun tools/prewarm-audio.ts   (server harus sudah jalan)
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:8765";
const pub = join(import.meta.dir, "..", "public");
const src = (await Bun.file(join(pub, "data.js")).text()) + "\n" + (await Bun.file(join(pub, "lex.js")).text());
const { speechTexts } = new Function(src + "\nreturn { speechTexts };")();

const jobs: [string, string][] = [];
for (const lang of ["id", "en", "ar"]) for (const t of speechTexts(lang)) jobs.push([lang, t]);
console.log(`${jobs.length} teks`);

let done = 0, failed: string[] = [];
async function worker() {
  while (jobs.length) {
    const [lang, text] = jobs.shift()!;
    const r = await fetch(`${BASE}/api/tts?lang=${lang}&text=${encodeURIComponent(text)}`).catch(() => null);
    if (!r?.ok) failed.push(`${lang}: ${text}`);
    else await r.arrayBuffer();
    if (++done % 200 === 0) console.log(`${done} selesai`);
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`selesai: ${done}, gagal: ${failed.length}`);
if (failed.length) console.log(failed.slice(0, 30).join("\n"));
