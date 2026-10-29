const enc = new TextEncoder();
const NAME_RE = /^[A-Za-z0-9_-]{3,16}$/;
const GUEST_RE = /^[A-Za-z0-9 _-]{1,20}$/;
const COOKIE = "rj_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const PBKDF2_ITERATIONS = 25000;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, name_lower TEXT NOT NULL UNIQUE, pass TEXT NOT NULL, created INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT NOT NULL, body TEXT NOT NULL, ip TEXT NOT NULL, created INTEGER NOT NULL)",
];

let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => {
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
    .prepare("SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?")
    .bind(await sha256(token), now())
    .first();
}

async function handleApi(request, env) {
  const route = new URL(request.url).pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const method = request.method;

  if (route === "whoami" && method === "GET") {
    const cf = request.cf || {};
    return json({
      ip: request.headers.get("cf-connecting-ip") || "",
      city: cf.city || "",
      region: cf.region || "",
      country: cf.country || "",
    });
  }

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
      return json({ user: user ? { name: user.name } : null });
    }

    if (route === "register" && method === "POST") {
      const name = String(body.username || "").trim();
      const password = String(body.password || "");
      if (!NAME_RE.test(name)) return json({ error: "Username must be 3-16 letters, numbers, _ or -." }, 400);
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
      return json({ user: { name } }, 201, await startSession(db, id));
    }

    if (route === "login" && method === "POST") {
      const name = String(body.username || "").trim();
      const password = String(body.password || "");
      const rec = await db
        .prepare("SELECT id, name, pass FROM users WHERE name_lower = ?")
        .bind(name.toLowerCase())
        .first();
      const ok = rec ? await checkPassword(password, rec.pass) : (await hashPassword(password), false);
      if (!ok) return json({ error: "Wrong username or password." }, 401);
      await db.prepare("DELETE FROM sessions WHERE expires < ?").bind(now()).run();
      return json({ user: { name: rec.name } }, 200, await startSession(db, rec.id));
    }

    if (route === "logout" && method === "POST") {
      const token = readToken(request);
      if (token) await db.prepare("DELETE FROM sessions WHERE token = ?").bind(await sha256(token)).run();
      return json({ ok: true }, 200, `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    }

    if (route === "comments" && method === "GET") {
      const [comments, count] = await db.batch([
        db.prepare(
          "SELECT id, name, body, created, (user_id IS NULL) AS guest FROM comments ORDER BY id DESC LIMIT 50"
        ),
        db.prepare("SELECT COUNT(*) AS n FROM users"),
      ]);
      return json({
        posts: comments.results.map((c) => ({ ...c, guest: !!c.guest })),
        members: count.results[0].n,
      });
    }

    if (route === "comments" && method === "POST") {
      const user = await currentUser(request, db);
      const text = String(body.message || "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 280) return json({ error: "Comments must be 1-280 characters." }, 400);
      if (/https?:\/\/|www\./i.test(text)) return json({ error: "No links please." }, 400);

      let name;
      if (user) {
        name = user.name;
      } else {
        name = String(body.name || "").replace(/\s+/g, " ").trim();
        if (!GUEST_RE.test(name)) return json({ error: "Pick a name: 1-20 letters, numbers, spaces, _ or -." }, 400);
        const taken = await db.prepare("SELECT 1 AS x FROM users WHERE name_lower = ?").bind(name.toLowerCase()).first();
        if (taken) return json({ error: "That name belongs to a member. Pick another." }, 409);
      }

      const ip = await sha256("rj:" + (request.headers.get("cf-connecting-ip") || "unknown"));
      const t = now();
      const last = await db.prepare("SELECT created FROM comments WHERE ip = ? ORDER BY id DESC LIMIT 1").bind(ip).first();
      if (last && t - last.created < 10) return json({ error: "Slow down! One comment every 10 seconds." }, 429);
      const hour = await db.prepare("SELECT COUNT(*) AS n FROM comments WHERE ip = ? AND created > ?").bind(ip, t - 3600).first();
      if (hour.n >= 20) return json({ error: "That's a lot of comments. Try again in a while." }, 429);

      await db
        .prepare("INSERT INTO comments (user_id, name, body, ip, created) VALUES (?, ?, ?, ?, ?)")
        .bind(user ? user.id : null, name, text, ip, t)
        .run();
      return json({ ok: true }, 201);
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
