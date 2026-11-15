const enc = new TextEncoder();
const NAME_RE = /^[A-Za-z0-9_-]{3,16}$/;
const GUEST_RE = /^[A-Za-z0-9 _-]{1,20}$/;
const COOKIE = "rj_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const PBKDF2_ITERATIONS = 25000;
const OWNER_NAME = "pharmacist";
const RESERVED = ["owner", "admin", "administrator", "mod", "moderator", "staff", "official"];
const CATEGORIES = ["General", "Product Reviews", "Recipes", "Gaming", "Off Topic"];

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, name_lower TEXT NOT NULL UNIQUE, pass TEXT NOT NULL, created INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT NOT NULL, body TEXT NOT NULL, ip TEXT NOT NULL, created INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS threads (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, ip TEXT NOT NULL, created INTEGER NOT NULL, last_activity INTEGER NOT NULL, replies INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS replies (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id INTEGER NOT NULL, user_id INTEGER, name TEXT NOT NULL, body TEXT NOT NULL, ip TEXT NOT NULL, created INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_threads_activity ON threads (last_activity)",
  "CREATE INDEX IF NOT EXISTS idx_replies_thread ON replies (thread_id)",
  "CREATE TABLE IF NOT EXISTS visits (ip TEXT PRIMARY KEY, city TEXT, region TEXT, country TEXT, lat REAL, lon REAL, isp TEXT, ua TEXT, referrer TEXT, tz TEXT, lang TEXT, screen TEXT, viewport TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, hits INTEGER NOT NULL DEFAULT 1)",
  "CREATE INDEX IF NOT EXISTS idx_visits_last ON visits (last_seen)",
  "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, color TEXT NOT NULL, text_color TEXT NOT NULL, effect TEXT NOT NULL DEFAULT 'none', highlight INTEGER NOT NULL DEFAULT 0, can_pin INTEGER NOT NULL DEFAULT 0, can_highlight INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL)",
];

/* ---------- member tags ---------- */
const EFFECTS = ["none", "sparkle", "glow", "fire", "glitch", "shine", "rainbow", "drip"];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
// shown on the owner's posts until the owner gives themself a custom tag
const OWNER_TAG = { label: "★ SITE OWNER ★", color: "#a01010", text: "#ffd23b", effect: "none", highlight: true };
// columns pulled in alongside any post/user row: "LEFT JOIN users u ... LEFT JOIN tags g ON g.id = u.tag_id"
const TAG_COLS = "g.label AS tag_label, g.color AS tag_color, g.text_color AS tag_text, g.effect AS tag_effect, g.highlight AS tag_hl";
const TAG_JOIN = "LEFT JOIN tags g ON g.id = u.tag_id";

function tagOf(r, owner) {
  if (r.tag_label) {
    return { label: r.tag_label, color: r.tag_color, text: r.tag_text, effect: r.tag_effect, highlight: !!r.tag_hl };
  }
  return owner ? OWNER_TAG : null;
}

const VISIT_DAYS = 30; // visitor log entries are deleted after this many days

async function logVisit(request, db, extra) {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return;
  const cf = request.cf || {};
  const t = now();
  const lat = cf.latitude != null ? Number(cf.latitude) : null;
  const lon = cf.longitude != null ? Number(cf.longitude) : null;
  const ua = String(request.headers.get("user-agent") || "").slice(0, 300);
  const clip = (v, n) => (v == null ? "" : String(v).replace(/[\x00-\x1f]/g, " ").slice(0, n));
  const e = extra || {};
  const referrer = clip(e.referrer || request.headers.get("referer"), 300);
  const tz = clip(e.tz, 60);
  const lang = clip(e.lang || request.headers.get("accept-language"), 60);
  const screen = clip(e.screen, 20);
  const viewport = clip(e.viewport, 20);
  await ensureSchema(db);
  await db
    .prepare(
      "INSERT INTO visits (ip, city, region, country, lat, lon, isp, ua, referrer, tz, lang, screen, viewport, first_seen, last_seen, hits) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?10, ?11, ?12, ?13, ?14, ?9, ?9, 1) " +
        "ON CONFLICT(ip) DO UPDATE SET city = ?2, region = ?3, country = ?4, lat = ?5, lon = ?6, isp = ?7, ua = ?8, " +
        "referrer = ?10, tz = ?11, lang = ?12, screen = ?13, viewport = ?14, last_seen = ?9, hits = hits + 1"
    )
    .bind(ip, cf.city || "", cf.region || "", cf.country || "", lat, lon, String(cf.asOrganization || "").slice(0, 120), ua, t, referrer, tz, lang, screen, viewport)
    .run();
  if (Math.random() < 0.05) {
    await db.prepare("DELETE FROM visits WHERE last_seen < ?").bind(t - VISIT_DAYS * 86400).run();
  }
}

// columns added after the visits table first shipped; ALTER is a no-op if already present
const MIGRATIONS = ["referrer", "tz", "lang", "screen", "viewport"]
  .map((c) => `ALTER TABLE visits ADD COLUMN ${c} TEXT`)
  .concat([
    "ALTER TABLE users ADD COLUMN tag_id INTEGER",
    "ALTER TABLE threads ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE threads ADD COLUMN highlighted INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE tags ADD COLUMN can_music INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE tags ADD COLUMN no_popups INTEGER NOT NULL DEFAULT 0",
  ]);

let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db.batch(SCHEMA.map((s) => db.prepare(s)));
      for (const m of MIGRATIONS) {
        try { await db.prepare(m).run(); } catch (e) { /* column already exists */ }
      }
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

const now = () => Math.floor(Date.now() / 1000);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => Uint8Array.from(s.match(/../g), (h) => parseInt(h, 16));
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `${PBKDF2_ITERATIONS}:${hex(salt)}:${await pbkdf2(password, salt, PBKDF2_ITERATIONS)}`;
}

async function checkPassword(password, stored) {
  const [iterations, salt, expected] = stored.split(":");
  const got = await pbkdf2(password, unhex(salt), Number(iterations));
  let diff = got.length ^ expected.length;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function json(data, status = 200, cookie) {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (cookie) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

const isOwner = (u) => !!u && u.name.toLowerCase() === OWNER_NAME;
const canPin = (u) => isOwner(u) || !!(u && u.tag_pin);
const canHighlight = (u) => isOwner(u) || !!(u && u.tag_hlt);

/* "everyone else" rules: apply to guests and to members without a tag */
const SETTING_DEFAULTS = { everyone_music: "1", everyone_nopopups: "0" };
async function getSettings(db) {
  const out = { ...SETTING_DEFAULTS };
  const { results } = await db.prepare("SELECT key, value FROM settings").all();
  for (const r of results) if (r.key in out) out[r.key] = r.value;
  return { can_music: out.everyone_music === "1", no_popups: out.everyone_nopopups === "1" };
}
// music + popup powers: owner gets everything, tagged members get their tag's rules, everyone else the site default
function perks(u, everyone) {
  if (isOwner(u)) return { can_music: true, no_popups: true };
  if (u && u.tag_label) return { can_music: !!u.tag_music, no_popups: !!u.tag_nopop };
  return { ...everyone };
}

function publicUser(u, everyone) {
  const owner = isOwner(u);
  return { name: u.name, owner, tag: tagOf(u, owner), can_pin: canPin(u), can_highlight: canHighlight(u), ...perks(u, everyone) };
}

const USER_COLS = "u.id, u.name, " + TAG_COLS + ", g.can_pin AS tag_pin, g.can_highlight AS tag_hlt, g.can_music AS tag_music, g.no_popups AS tag_nopop";

function readToken(request) {
  const m = (request.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([a-f0-9]+)"));
  return m ? m[1] : null;
}

async function startSession(db, userId) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db
    .prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)")
    .bind(await sha256(token), userId, now() + SESSION_SECONDS)
    .run();
  return `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

async function currentUser(request, db) {
  const token = readToken(request);
  if (!token) return null;
  return db
    .prepare(`SELECT ${USER_COLS} FROM sessions s JOIN users u ON u.id = s.user_id ${TAG_JOIN} WHERE s.token = ? AND s.expires > ?`)
    .bind(await sha256(token), now())
    .first();
}

const oneLine = (s, max) => {
  const v = String(s || "").replace(/\s+/g, " ").trim();
  return v.length >= 1 && v.length <= max ? v : null;
};
const multiLine = (s, max) => {
  const v = String(s || "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return v.length >= 1 && v.length <= max ? v : null;
};
const hasLink = (s) => /https?:\/\/|www\./i.test(s);
function flags(r) {
  const { tag_label, tag_color, tag_text, tag_effect, tag_hl, ...rest } = r;
  const out = { ...rest, guest: !!r.guest, owner: !!r.owner };
  out.tag = tagOf(r, out.owner);
  if (r.pinned != null) out.pinned = !!r.pinned;
  if (r.highlighted != null) out.highlighted = !!r.highlighted;
  return out;
}

const asTag = (b) => {
  const label = oneLine(b.label, 24);
  if (!label) return { error: "Tag text must be 1-24 characters." };
  if (!HEX_RE.test(b.color || "") || !HEX_RE.test(b.text_color || "")) return { error: "Pick the tag colors." };
  if (!EFFECTS.includes(b.effect)) return { error: "Pick an effect." };
  return { label, color: b.color, text_color: b.text_color, effect: b.effect, highlight: b.highlight ? 1 : 0, can_pin: b.can_pin ? 1 : 0, can_highlight: b.can_highlight ? 1 : 0, can_music: b.can_music ? 1 : 0, no_popups: b.no_popups ? 1 : 0 };
};

async function resolveAuthor(request, db, body) {
  const user = await currentUser(request, db);
  if (user) return { user, name: user.name };
  const name = oneLine(body.name, 20);
  if (!name || !GUEST_RE.test(name)) {
    return { error: json({ error: "Pick a name: 1-20 letters, numbers, spaces, _ or -." }, 400) };
  }
  const lower = name.toLowerCase();
  if (RESERVED.includes(lower) || lower === OWNER_NAME) {
    return { error: json({ error: "That name is reserved. Pick another." }, 409) };
  }
  const taken = await db.prepare("SELECT 1 AS x FROM users WHERE name_lower = ?").bind(lower).first();
  if (taken) return { error: json({ error: "That name belongs to a member. Pick another." }, 409) };
  return { user: null, name };
}

const ipHash = (request) => sha256("rj:" + (request.headers.get("cf-connecting-ip") || "unknown"));

async function rateLimited(db, ip, t) {
  const all = "SELECT created, ip FROM comments UNION ALL SELECT created, ip FROM threads UNION ALL SELECT created, ip FROM replies";
  const row = await db
    .prepare(`SELECT MAX(created) AS last, SUM(created > ?2) AS hour FROM (${all}) WHERE ip = ?1`)
    .bind(ip, t - 3600)
    .first();
  if (row && row.last && t - row.last < 10) return json({ error: "Slow down! One post every 10 seconds." }, 429);
  if (row && row.hour >= 30) return json({ error: "That's a lot of posts. Try again in a while." }, 429);
  return null;
}

/* ---------- is the YouTube channel live? ----------
   /@handle/live turns into the live video's watch page while streaming; that page has "isLiveNow":true.
   No API key needed. Result is cached for a couple of minutes so YouTube isn't hit on every page load. */
const LIVE_CHANNEL = "Blinddudesgame";
const LIVE_TTL = 120; // seconds
let liveCache = { at: 0, data: null };

async function youtubeLive() {
  const t = now();
  if (liveCache.data && t - liveCache.at < LIVE_TTL) return liveCache.data;
  const channelUrl = `https://www.youtube.com/@${LIVE_CHANNEL}`;
  let data = { live: false, channel: LIVE_CHANNEL, url: channelUrl + "/live" };
  try {
    const res = await fetch(channelUrl + "/live", {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
        // skip YouTube's cookie-consent page in some regions
        cookie: "SOCS=CAI; CONSENT=YES+1",
      },
      cf: { cacheTtl: LIVE_TTL },
    });
    const html = await res.text();
    if (/"isLiveNow"\s*:\s*true/.test(html)) {
      const id = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/) || [])[1];
      const title = (html.match(/<meta name="title" content="([^"]{1,200})"/) || [])[1] || "";
      data = {
        live: true,
        channel: LIVE_CHANNEL,
        url: id ? `https://www.youtube.com/watch?v=${id}` : channelUrl + "/live",
        title: title.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
      };
    }
  } catch (e) {
    // YouTube unreachable: report not live
  }
  liveCache = { at: t, data };
  return data;
}

/* ---------- the owner's YouTube videos (for the full-screen video ads) ----------
   Reads youtube.com/roostercs/videos (newest ~30) plus the channel's RSS feed (newest 15), no API key.
   Cached for an hour. */
const VIDEO_CHANNEL = "https://www.youtube.com/roostercs";
const VIDEOS_TTL = 3600;
let videosCache = { at: 0, data: null };
const YT_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
  cookie: "SOCS=CAI; CONSENT=YES+1",
};
const jsonStr = (raw) => { try { return JSON.parse('"' + raw + '"'); } catch (e) { return raw; } };
const xmlText = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

async function channelVideos() {
  const t = now();
  if (videosCache.data && t - videosCache.at < VIDEOS_TTL) return videosCache.data;
  const found = new Map(); // id -> title
  const add = (id, title) => { if (id && !found.has(id)) found.set(id, (title || "").slice(0, 200)); else if (id && title && !found.get(id)) found.set(id, title.slice(0, 200)); };
  let channelId = "";
  try {
    const html = await (await fetch(VIDEO_CHANNEL + "/videos", { headers: YT_HEADERS })).text();
    channelId = (html.match(/"(?:externalId|channelId)":"(UC[\w-]{22})"/) || [])[1] || "";
    // classic layout: "videoRenderer":{"videoId":"...", ... "title":{"runs":[{"text":"..."}
    for (const m of html.matchAll(/"videoRenderer":\{"videoId":"([\w-]{11})"[\s\S]{0,1500}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g)) add(m[1], jsonStr(m[2]));
    // newer layout: lockupViewModel with contentId + metadata title
    for (const m of html.matchAll(/"lockupViewModel":\{[\s\S]{0,4000}?"title":\{"content":"((?:[^"\\]|\\.)*)"[\s\S]{0,4000}?"contentId":"([\w-]{11})"/g)) add(m[2], jsonStr(m[1]));
  } catch (e) {}
  try {
    if (channelId) {
      const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: YT_HEADERS })).text();
      for (const m of xml.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>[\s\S]*?<title>([^<]*)<\/title>/g)) add(m[1], xmlText(m[2]));
    }
  } catch (e) {}
  const data = { videos: [...found].map(([id, title]) => ({ id, title })) };
  // only cache a good result for the full hour; retry sooner if YouTube gave us nothing
  videosCache = { at: data.videos.length ? t : t - VIDEOS_TTL + 300, data };
  return data;
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const method = request.method;

  if (route === "whoami" && (method === "GET" || method === "POST")) {
    const cf = request.cf || {};
    let extra = {};
    if (method === "POST") {
      try { extra = (await request.json()) || {}; } catch (e) { extra = {}; }
    }
    if (env.DB) {
      try { await logVisit(request, env.DB, extra); } catch (e) {}
    }
    return json({
      ip: request.headers.get("cf-connecting-ip") || "",
      city: cf.city || "",
      region: cf.region || "",
      country: cf.country || "",
    });
  }

  if (route === "live" && method === "GET") return json(await youtubeLive());
  if (route === "videos" && method === "GET") return json(await channelVideos());

  const db = env.DB;
  if (!db) return json({ error: "The database is not connected yet." }, 503);

  let body = {};
  if (method === "POST") {
    if (!(request.headers.get("content-type") || "").includes("application/json")) {
      return json({ error: "Bad request." }, 400);
    }
    try {
      body = await request.json();
    } catch {
      return json({ error: "Bad request." }, 400);
    }
    if (!body || typeof body !== "object") return json({ error: "Bad request." }, 400);
  }

  try {
    await ensureSchema(db);

    if (route === "me" && method === "GET") {
      const user = await currentUser(request, db);
      const everyone = await getSettings(db);
      return json({ user: user ? publicUser(user, everyone) : null, everyone });
    }

    if (route === "register" && method === "POST") {
      const name = String(body.username || "").trim();
      const password = String(body.password || "");
      if (!NAME_RE.test(name)) return json({ error: "Username must be 3-16 letters, numbers, _ or -." }, 400);
      if (RESERVED.includes(name.toLowerCase())) return json({ error: "That username is reserved." }, 400);
      if (password.length < 6 || password.length > 100) return json({ error: "Password must be 6-100 characters." }, 400);
      let id;
      try {
        const result = await db
          .prepare("INSERT INTO users (name, name_lower, pass, created) VALUES (?, ?, ?, ?)")
          .bind(name, name.toLowerCase(), await hashPassword(password), now())
          .run();
        id = result.meta.last_row_id;
      } catch (e) {
        if (/UNIQUE/i.test(String(e.message) + String(e.cause && e.cause.message))) {
          return json({ error: "That username is taken. Pick another." }, 409);
        }
        throw e;
      }
      return json({ user: publicUser({ name }, await getSettings(db)) }, 201, await startSession(db, id));
    }

    if (route === "login" && method === "POST") {
      const name = String(body.username || "").trim();
      const password = String(body.password || "");
      const rec = await db
        .prepare(`SELECT ${USER_COLS}, u.pass FROM users u ${TAG_JOIN} WHERE u.name_lower = ?`)
        .bind(name.toLowerCase())
        .first();
      const ok = rec ? await checkPassword(password, rec.pass) : (await hashPassword(password), false);
      if (!ok) return json({ error: "Wrong username or password." }, 401);
      await db.prepare("DELETE FROM sessions WHERE expires < ?").bind(now()).run();
      return json({ user: publicUser(rec, await getSettings(db)) }, 200, await startSession(db, rec.id));
    }

    if (route === "logout" && method === "POST") {
      const token = readToken(request);
      if (token) await db.prepare("DELETE FROM sessions WHERE token = ?").bind(await sha256(token)).run();
      return json({ ok: true }, 200, `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    }

    if (route === "comments" && method === "GET") {
      const [comments, count] = await db.batch([
        db
          .prepare(
            `SELECT c.id, c.name, c.body, c.created, (c.user_id IS NULL) AS guest, (u.name_lower = ?) AS owner, ${TAG_COLS} FROM comments c LEFT JOIN users u ON u.id = c.user_id ${TAG_JOIN} ORDER BY c.id DESC LIMIT 50`
          )
          .bind(OWNER_NAME),
        db.prepare("SELECT COUNT(*) AS n FROM users"),
      ]);
      return json({ posts: comments.results.map(flags), members: count.results[0].n });
    }

    if (route === "comments" && method === "POST") {
      const text = oneLine(body.message, 280);
      if (!text) return json({ error: "Comments must be 1-280 characters." }, 400);
      if (hasLink(text)) return json({ error: "No links please." }, 400);
      const author = await resolveAuthor(request, db, body);
      if (author.error) return author.error;
      const ip = await ipHash(request);
      const t = now();
      const limited = await rateLimited(db, ip, t);
      if (limited) return limited;
      await db
        .prepare("INSERT INTO comments (user_id, name, body, ip, created) VALUES (?, ?, ?, ?, ?)")
        .bind(author.user ? author.user.id : null, author.name, text, ip, t)
        .run();
      return json({ ok: true }, 201);
    }

    if (route === "threads" && method === "GET") {
      const cat = url.searchParams.get("cat");
      const filtered = CATEGORIES.includes(cat);
      const stmt = db.prepare(
        `SELECT t.id, t.title, t.category, t.name, t.created, t.last_activity, t.replies, t.pinned, t.highlighted, (t.user_id IS NULL) AS guest, (u.name_lower = ?) AS owner, ${TAG_COLS} FROM threads t LEFT JOIN users u ON u.id = t.user_id ${TAG_JOIN} ` +
          (filtered ? "WHERE t.category = ? " : "") +
          "ORDER BY t.pinned DESC, t.last_activity DESC LIMIT 40"
      );
      const res = await (filtered ? stmt.bind(OWNER_NAME, cat) : stmt.bind(OWNER_NAME)).all();
      return json({ threads: res.results.map(flags) });
    }

    if (route === "thread" && method === "GET") {
      const id = Number(url.searchParams.get("id"));
      if (!Number.isInteger(id)) return json({ error: "Not found." }, 404);
      const [t, r] = await db.batch([
        db
          .prepare(
            `SELECT t.id, t.title, t.category, t.name, t.body, t.created, t.pinned, t.highlighted, (t.user_id IS NULL) AS guest, (u.name_lower = ?) AS owner, ${TAG_COLS} FROM threads t LEFT JOIN users u ON u.id = t.user_id ${TAG_JOIN} WHERE t.id = ?`
          )
          .bind(OWNER_NAME, id),
        db
          .prepare(
            `SELECT r.id, r.name, r.body, r.created, (r.user_id IS NULL) AS guest, (u.name_lower = ?) AS owner, ${TAG_COLS} FROM replies r LEFT JOIN users u ON u.id = r.user_id ${TAG_JOIN} WHERE r.thread_id = ? ORDER BY r.id ASC LIMIT 300`
          )
          .bind(OWNER_NAME, id),
      ]);
      if (!t.results.length) return json({ error: "That thread does not exist." }, 404);
      return json({ thread: flags(t.results[0]), replies: r.results.map(flags) });
    }

    if (route === "threads" && method === "POST") {
      const title = oneLine(body.title, 80);
      const text = multiLine(body.message, 1000);
      if (!title || title.length < 3) return json({ error: "Title must be 3-80 characters." }, 400);
      if (!text) return json({ error: "Message must be 1-1000 characters." }, 400);
      if (!CATEGORIES.includes(body.category)) return json({ error: "Pick a category." }, 400);
      if (hasLink(title) || hasLink(text)) return json({ error: "No links please." }, 400);
      const author = await resolveAuthor(request, db, body);
      if (author.error) return author.error;
      const ip = await ipHash(request);
      const t = now();
      const limited = await rateLimited(db, ip, t);
      if (limited) return limited;
      const result = await db
        .prepare(
          "INSERT INTO threads (user_id, name, category, title, body, ip, created, last_activity) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(author.user ? author.user.id : null, author.name, body.category, title, text, ip, t, t)
        .run();
      return json({ ok: true, id: result.meta.last_row_id }, 201);
    }

    if (route === "replies" && method === "POST") {
      const threadId = Number(body.thread_id);
      const text = multiLine(body.message, 1000);
      if (!Number.isInteger(threadId) || !text) return json({ error: "Replies must be 1-1000 characters." }, 400);
      if (hasLink(text)) return json({ error: "No links please." }, 400);
      const thread = await db.prepare("SELECT id FROM threads WHERE id = ?").bind(threadId).first();
      if (!thread) return json({ error: "That thread does not exist." }, 404);
      const author = await resolveAuthor(request, db, body);
      if (author.error) return author.error;
      const ip = await ipHash(request);
      const t = now();
      const limited = await rateLimited(db, ip, t);
      if (limited) return limited;
      await db.batch([
        db
          .prepare("INSERT INTO replies (thread_id, user_id, name, body, ip, created) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(threadId, author.user ? author.user.id : null, author.name, text, ip, t),
        db.prepare("UPDATE threads SET replies = replies + 1, last_activity = ? WHERE id = ?").bind(t, threadId),
      ]);
      return json({ ok: true }, 201);
    }

    if (route === "visits" && method === "GET") {
      const user = await currentUser(request, db);
      if (!user || user.name.toLowerCase() !== OWNER_NAME) return json({ error: "Owner only." }, 403);
      const { results } = await db
        .prepare("SELECT ip, city, region, country, lat, lon, isp, ua, referrer, tz, lang, screen, viewport, first_seen, last_seen, hits FROM visits ORDER BY last_seen DESC LIMIT 2000")
        .all();
      const totals = await db.prepare("SELECT COUNT(*) AS visitors, COALESCE(SUM(hits), 0) AS hits, SUM(last_seen > ?) AS today FROM visits").bind(now() - 86400).first();
      return json({ visits: results, totals, days: VISIT_DAYS });
    }

    if (route === "users" && method === "GET") {
      const user = await currentUser(request, db);
      if (!user || user.name.toLowerCase() !== OWNER_NAME) return json({ error: "Owner only." }, 403);
      const { results } = await db
        .prepare(
          "SELECT u.id, u.name, u.created, u.tag_id, " +
            "(SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id) + " +
            "(SELECT COUNT(*) FROM threads t WHERE t.user_id = u.id) + " +
            "(SELECT COUNT(*) FROM replies r WHERE r.user_id = u.id) AS posts " +
            "FROM users u ORDER BY u.id ASC LIMIT 2000"
        )
        .all();
      const users = results.map((u) => ({ id: u.id, name: u.name, created: u.created, posts: u.posts, tag_id: u.tag_id, owner: u.name.toLowerCase() === OWNER_NAME }));
      return json({ users });
    }

    if (route === "threadflag" && method === "POST") {
      const user = await currentUser(request, db);
      const id = Number(body.id);
      const flag = body.flag;
      if (!Number.isInteger(id) || (flag !== "pinned" && flag !== "highlighted")) return json({ error: "Bad request." }, 400);
      const allowed = flag === "pinned" ? canPin(user) : canHighlight(user);
      if (!allowed) return json({ error: "Your tag can't do that." }, 403);
      const res = await db.prepare(`UPDATE threads SET ${flag} = ? WHERE id = ?`).bind(body.on ? 1 : 0, id).run();
      if (!res.meta.changes) return json({ error: "That thread does not exist." }, 404);
      return json({ ok: true });
    }

    if (route === "tags" && method === "GET") {
      const user = await currentUser(request, db);
      if (!isOwner(user)) return json({ error: "Owner only." }, 403);
      const { results } = await db
        .prepare("SELECT g.*, (SELECT COUNT(*) FROM users u WHERE u.tag_id = g.id) AS members FROM tags g ORDER BY g.id ASC")
        .all();
      return json({ tags: results, effects: EFFECTS, everyone: await getSettings(db) });
    }

    if (route === "tags" && method === "POST") {
      const user = await currentUser(request, db);
      if (!isOwner(user)) return json({ error: "Owner only." }, 403);
      const t = asTag(body);
      if (t.error) return json({ error: t.error }, 400);
      const vals = [t.label, t.color, t.text_color, t.effect, t.highlight, t.can_pin, t.can_highlight, t.can_music, t.no_popups];
      if (body.id != null) {
        const id = Number(body.id);
        if (!Number.isInteger(id)) return json({ error: "Bad request." }, 400);
        const res = await db
          .prepare("UPDATE tags SET label = ?, color = ?, text_color = ?, effect = ?, highlight = ?, can_pin = ?, can_highlight = ?, can_music = ?, no_popups = ? WHERE id = ?")
          .bind(...vals, id)
          .run();
        if (!res.meta.changes) return json({ error: "No such tag." }, 404);
        return json({ ok: true, id });
      }
      const res = await db
        .prepare("INSERT INTO tags (label, color, text_color, effect, highlight, can_pin, can_highlight, can_music, no_popups, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(...vals, now())
        .run();
      return json({ ok: true, id: res.meta.last_row_id }, 201);
    }

    if (route === "settings" && method === "POST") {
      const user = await currentUser(request, db);
      if (!isOwner(user)) return json({ error: "Owner only." }, 403);
      const put = (k, v) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v ? "1" : "0");
      await db.batch([put("everyone_music", body.can_music), put("everyone_nopopups", body.no_popups)]);
      return json({ ok: true, everyone: await getSettings(db) });
    }

    if (route === "tagdelete" && method === "POST") {
      const user = await currentUser(request, db);
      if (!isOwner(user)) return json({ error: "Owner only." }, 403);
      const id = Number(body.id);
      if (!Number.isInteger(id)) return json({ error: "Bad request." }, 400);
      await db.batch([
        db.prepare("UPDATE users SET tag_id = NULL WHERE tag_id = ?").bind(id),
        db.prepare("DELETE FROM tags WHERE id = ?").bind(id),
      ]);
      return json({ ok: true });
    }

    if (route === "usertag" && method === "POST") {
      const user = await currentUser(request, db);
      if (!isOwner(user)) return json({ error: "Owner only." }, 403);
      const id = Number(body.id);
      const tagId = body.tag_id == null || body.tag_id === "" ? null : Number(body.tag_id);
      if (!Number.isInteger(id) || (tagId !== null && !Number.isInteger(tagId))) return json({ error: "Bad request." }, 400);
      if (tagId !== null && !(await db.prepare("SELECT 1 AS x FROM tags WHERE id = ?").bind(tagId).first())) {
        return json({ error: "No such tag." }, 404);
      }
      const res = await db.prepare("UPDATE users SET tag_id = ? WHERE id = ?").bind(tagId, id).run();
      if (!res.meta.changes) return json({ error: "No such user." }, 404);
      return json({ ok: true });
    }

    if (route === "setpassword" && method === "POST") {
      const user = await currentUser(request, db);
      if (!user || user.name.toLowerCase() !== OWNER_NAME) return json({ error: "Owner only." }, 403);
      const id = Number(body.id);
      const password = String(body.password || "");
      if (!Number.isInteger(id)) return json({ error: "Bad request." }, 400);
      if (password.length < 6 || password.length > 100) return json({ error: "Password must be 6-100 characters." }, 400);
      const target = await db.prepare("SELECT id, name FROM users WHERE id = ?").bind(id).first();
      if (!target) return json({ error: "No such user." }, 404);
      await db.prepare("UPDATE users SET pass = ? WHERE id = ?").bind(await hashPassword(password), id).run();
      // sign the user out everywhere so the old password can't keep a session alive
      await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id).run();
      return json({ ok: true, name: target.name });
    }

    if (route === "delete" && method === "POST") {
      const user = await currentUser(request, db);
      if (!user || user.name.toLowerCase() !== OWNER_NAME) return json({ error: "Owner only." }, 403);
      const id = Number(body.id);
      if (!Number.isInteger(id)) return json({ error: "Bad request." }, 400);
      if (body.kind === "comment") {
        await db.prepare("DELETE FROM comments WHERE id = ?").bind(id).run();
      } else if (body.kind === "thread") {
        await db.batch([
          db.prepare("DELETE FROM replies WHERE thread_id = ?").bind(id),
          db.prepare("DELETE FROM threads WHERE id = ?").bind(id),
        ]);
      } else if (body.kind === "reply") {
        const reply = await db.prepare("SELECT thread_id FROM replies WHERE id = ?").bind(id).first();
        if (reply) {
          await db.batch([
            db.prepare("DELETE FROM replies WHERE id = ?").bind(id),
            db.prepare("UPDATE threads SET replies = replies - 1 WHERE id = ? AND replies > 0").bind(reply.thread_id),
          ]);
        }
      } else {
        return json({ error: "Bad request." }, 400);
      }
      return json({ ok: true });
    }
  } catch (e) {
    return json({ error: "Server hiccup. Try again in a minute." }, 500);
  }

  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
