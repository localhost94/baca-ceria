import { Database } from "bun:sqlite";
import { join, normalize } from "node:path";
import { mkdir, rename, rm } from "node:fs/promises";

const PORT = Number(process.env.PORT ?? 8765);
const PUBLIC = join(import.meta.dir, "public");

const db = new Database(join(import.meta.dir, "baca.sqlite"), { create: true });
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    avatar TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    item TEXT NOT NULL,
    correct INTEGER NOT NULL,
    tries INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
// migrasi: kolom bahasa (data lama dianggap bahasa Indonesia)
const hasColumn = (table: string, col: string) =>
  (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
if (!hasColumn("players", "lang")) db.exec("ALTER TABLE players ADD COLUMN lang TEXT NOT NULL DEFAULT 'id'");
if (!hasColumn("answers", "lang")) db.exec("ALTER TABLE answers ADD COLUMN lang TEXT NOT NULL DEFAULT 'id'");
// migrasi: saldo bintang (bisa turun saat salah); awalnya = jumlah jawaban benar langsung
if (!hasColumn("players", "stars")) db.exec(`
  ALTER TABLE players ADD COLUMN stars INTEGER NOT NULL DEFAULT 0;
  UPDATE players SET stars = (SELECT COALESCE(SUM(correct), 0) FROM answers WHERE player_id = players.id);
`);
db.exec(`
  DROP INDEX IF EXISTS idx_answers_player;
  CREATE INDEX IF NOT EXISTS idx_answers_player_lang ON answers(player_id, lang, game, item);
  PRAGMA foreign_keys = ON;
`);

const json = (data: unknown, status = 200) => Response.json(data, { status });

/* ---------- rate limit per IP (fixed window, in-memory) ---------- */
const LIMITS = {
  api: { max: 300, windowMs: 60_000 },          // semua /api/*
  ttsGen: { max: 30, windowMs: 60_000 },        // tts yang belum ada di cache (spawn edge-tts)
  ttsGenAll: { max: 200, windowMs: 60_000 },    // total spawn edge-tts semua IP
  newPlayer: { max: 20, windowMs: 3_600_000 },  // POST /api/players
};
const hits = new Map<string, { count: number; reset: number }>();
function limited(kind: keyof typeof LIMITS, key: string): number {
  const { max, windowMs } = LIMITS[kind];
  const now = Date.now();
  const k = kind + ":" + key;
  let h = hits.get(k);
  if (!h || h.reset <= now) hits.set(k, h = { count: 0, reset: now + windowMs });
  return ++h.count > max ? Math.ceil((h.reset - now) / 1000) : 0;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, h] of hits) if (h.reset <= now) hits.delete(k);
}, 60_000).unref();
const tooMany = (retry: number) =>
  Response.json({ error: "terlalu banyak permintaan, coba lagi sebentar" }, { status: 429, headers: { "Retry-After": String(retry) } });
const GAMES = new Set(["huruf", "suku", "tebak", "susun", "dua", "kalimat", "tangkap", "minecraft", "lego",
  "hitung", "kenal", "banding", "urut", "hilang", "tambah", "kurang", "tangkapangka"]);
const LANGS = new Set(["id", "en", "ar"]);

const listPlayers = db.query("SELECT id, name, avatar, lang, stars FROM players ORDER BY id");
const insertPlayer = db.query("INSERT INTO players (name, avatar) VALUES (?, ?) RETURNING id, name, avatar, lang");
const updateLang = db.query("UPDATE players SET lang = ? WHERE id = ?");
const deletePlayer = db.query("DELETE FROM players WHERE id = ?");
const progress = db.query(`
  SELECT game, item, SUM(correct) AS right, COUNT(*) - SUM(correct) AS wrong
  FROM answers WHERE player_id = ? AND lang = ? GROUP BY game, item
`);
const insertAnswer = db.query("INSERT INTO answers (player_id, lang, game, item, correct, tries) VALUES (?, ?, ?, ?, ?, ?)");
// benar langsung +1, tiap tap salah -1, saldo tidak pernah di bawah 0
const addStars = db.query("UPDATE players SET stars = MAX(0, stars + ?) WHERE id = ?");
const summary = db.query(`
  SELECT lang, game, COUNT(*) AS total, SUM(correct) AS right, COUNT(DISTINCT item) AS items
  FROM answers WHERE player_id = ? GROUP BY lang, game ORDER BY lang, game
`);
const hardest = db.query(`
  SELECT lang, game, item, COUNT(*) - SUM(correct) AS wrong
  FROM answers WHERE player_id = ? GROUP BY lang, game, item
  HAVING wrong > 0 ORDER BY wrong DESC LIMIT 8
`);

/* ---------- suara neural (edge-tts), di-cache jadi mp3 ---------- */
const VOICES: Record<string, string> = { id: "id-ID-GadisNeural", en: "en-US-AvaNeural", ar: "ar-SA-ZariyahNeural" };
const AUDIO_DIR = join(import.meta.dir, "audio-cache");
const EDGE_TTS = process.env.EDGE_TTS ?? Bun.which("edge-tts") ?? join(process.env.HOME ?? "", ".local/bin/edge-tts");
const inflight = new Map<string, Promise<boolean>>();

async function ttsFile(lang: string, text: string, ip: string): Promise<string | number | null> {
  const hash = new Bun.CryptoHasher("sha1").update(lang + "\n" + text).digest("hex").slice(0, 16);
  const path = join(AUDIO_DIR, lang, hash + ".mp3");
  if (await Bun.file(path).exists()) return path;
  if (!inflight.has(path)) {
    const retry = limited("ttsGen", ip) || limited("ttsGenAll", "*");
    if (retry) return retry;
    inflight.set(path, (async () => {
      await mkdir(join(AUDIO_DIR, lang), { recursive: true });
      const tmp = path + ".tmp.mp3";
      const proc = Bun.spawn([EDGE_TTS, "--voice", VOICES[lang], "--rate=-10%", `--text=${text}`, "--write-media", tmp],
        { stdout: "ignore", stderr: "pipe" });
      const code = await proc.exited;
      if (code !== 0 || !(await Bun.file(tmp).exists()) || Bun.file(tmp).size === 0) {
        console.error("edge-tts gagal:", lang, text, await new Response(proc.stderr).text());
        await rm(tmp, { force: true });
        return false;
      }
      await rename(tmp, path);
      return true;
    })().finally(() => inflight.delete(path)));
  }
  return (await inflight.get(path)) ? path : null;
}

async function api(req: Request, url: URL, ip: string): Promise<Response> {
  const retry = limited("api", ip);
  if (retry) return tooMany(retry);
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "players", id, ...]
  if (parts[1] === "tts") {
    if (parts[2] === "status") return json({ ok: await Bun.file(EDGE_TTS).exists() });
    const lang = url.searchParams.get("lang") ?? "";
    const text = (url.searchParams.get("text") ?? "").trim();
    if (!VOICES[lang] || !text || text.length > 200) return json({ error: "bad tts request" }, 400);
    const path = await ttsFile(lang, text, ip);
    if (typeof path === "number") return tooMany(path);
    if (!path) return json({ error: "tts unavailable" }, 503);
    return new Response(Bun.file(path), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
  }
  if (parts[1] !== "players") return json({ error: "not found" }, 404);

  if (parts.length === 2) {
    if (req.method === "GET") return json(listPlayers.all());
    if (req.method === "POST") {
      const retry = limited("newPlayer", ip);
      if (retry) return tooMany(retry);
      const body = await req.json().catch(() => null) as { name?: string; avatar?: string } | null;
      const name = body?.name?.trim().slice(0, 20);
      if (!name) return json({ error: "name required" }, 400);
      return json(insertPlayer.get(name, body?.avatar || "🐻"), 201);
    }
  }

  const id = Number(parts[2]);
  if (!Number.isInteger(id)) return json({ error: "bad id" }, 400);

  if (parts.length === 3 && req.method === "DELETE") {
    deletePlayer.run(id);
    return json({ ok: true });
  }
  if (parts.length === 3 && req.method === "PATCH") {
    const b = await req.json().catch(() => null) as { lang?: string } | null;
    if (!b?.lang || !LANGS.has(b.lang)) return json({ error: "bad lang" }, 400);
    updateLang.run(b.lang, id);
    return json({ ok: true });
  }
  if (parts[3] === "progress" && req.method === "GET") {
    const lang = url.searchParams.get("lang") ?? "id";
    return json(progress.all(id, LANGS.has(lang) ? lang : "id"));
  }
  if (parts[3] === "summary" && req.method === "GET") {
    return json({ games: summary.all(id), hardest: hardest.all(id) });
  }
  if (parts[3] === "answers" && req.method === "POST") {
    const b = await req.json().catch(() => null) as
      { lang?: string; game?: string; item?: string; correct?: boolean; tries?: number } | null;
    if (!b?.game || !GAMES.has(b.game) || !b.item) return json({ error: "bad answer" }, 400);
    const lang = b.lang && LANGS.has(b.lang) ? b.lang : "id";
    const tries = Math.min(50, Math.max(1, Math.floor(Number(b.tries) || 1)));
    const correct = tries === 1 ? 1 : 0;
    db.transaction(() => {
      insertAnswer.run(id, lang, b.game, String(b.item).slice(0, 80), correct, tries);
      addStars.run(correct - (tries - 1), id);
    })();
    return json({ ok: true }, 201);
  }
  return json({ error: "not found" }, 404);
}

// IP asli klien: di belakang reverse proxy lokal (Caddy) pakai X-Forwarded-For entri terakhir
function clientIp(req: Request, server: Bun.Server): string {
  const remote = server.requestIP(req)?.address ?? "?";
  const isLocal = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const xff = req.headers.get("x-forwarded-for");
  return isLocal && xff ? xff.split(",").pop()!.trim() : remote;
}

Bun.serve({
  port: PORT,
  hostname: process.env.HOST ?? "0.0.0.0",
  maxRequestBodySize: 16 * 1024,
  async fetch(req, server) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith("/api/")) return await api(req, url, clientIp(req, server));
      const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
      if (rel.includes("..")) return new Response("Forbidden", { status: 403 });
      const file = Bun.file(join(PUBLIC, rel));
      return (await file.exists())
        ? new Response(file, { headers: { "Cache-Control": "no-cache" } })
        : new Response("Not found", { status: 404 });
    } catch (e) {
      console.error(e);
      return json({ error: "server error" }, 500);
    }
  },
});
console.log(`Baca Ceria jalan di http://localhost:${PORT}`);
