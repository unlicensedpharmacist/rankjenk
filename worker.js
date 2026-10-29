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

function publicUser(u) {
  return { name: u.name, owner: u.name.toLowerCase() === OWNER_NAME };
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

const oneLine = (s, max) => {
  const v = String(s || "").replace(/\s+/g, " ").trim();
  return v.length >= 1 && v.length <= max ? v : null;
};
const multiLine = (s, max) => {
  const v = String(s || "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return v.length >= 1 && v.length <= max ? v : null;
};
const hasLink = (s) => /https?:\/\/|www\./i.test(s);
const flags = (r) => ({ ...r, guest: !!r.guest, owner: !!r.owner });

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

async function handleApi(request, env) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
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
      return json({ user: user ? publicUser(user) : null });
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
      return json({ user: publicUser({ name }) }, 201, await startSession(db, id));
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
      return json({ user: publicUser(rec) }, 200, await startSession(db, rec.id));
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
            "SELECT c.id, c.name, c.body, c.created, (c.user_id IS NULL) AS guest, (u.name_lower = ?) AS owner FROM comments c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.id DESC LIMIT 50"
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
        "SELECT t.id, t.title, t.category, t.name, t.created, t.last_activity, t.replies, (t.user_id IS NULL) AS guest, (u.name_lower = ?) AS owner FROM threads t LEFT JOIN users u ON u.id = t.user_id " +
          (filtered ? "WHERE t.category = ? " : "") +
          "ORDER BY t.last_activity DESC LIMIT 40"
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
            "SELECT t.id, t.title, t.category, t.name, t.body, t.created, (t.user_id IS NULL) AS guest, (u.name_lower = ?) AS owner FROM threads t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?"
          )
          .bind(OWNER_NAME, id),
        db
          .prepare(
            "SELECT r.id, r.name, r.body, r.created, (r.user_id IS NULL) AS guest, (u.name_lower = ?) AS owner FROM replies r LEFT JOIN users u ON u.id = r.user_id WHERE r.thread_id = ? ORDER BY r.id ASC LIMIT 300"
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
