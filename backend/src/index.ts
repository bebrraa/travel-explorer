import http, { IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import crypto from "crypto";
import { db, initDb } from "./db";
import "dotenv/config";

// ======================
// Config
// ======================
const PORT = Number(process.env.PORT || 4000);
const OW_KEY = String(process.env.OPENWEATHER_API_KEY || "").trim();

// ======================
// DB init
// ======================
initDb();

// ======================
// Helpers: JSON, CORS, responses
// ======================
function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(res: ServerResponse, status: number, obj: any) {
  setCors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function notFound(res: ServerResponse) {
  sendJson(res, 404, { error: "Not found" });
}

function methodNotAllowed(res: ServerResponse) {
  sendJson(res, 405, { error: "Method not allowed" });
}

// ======================
// Password hashing (pbkdf2Sync)
// ======================
const PBKDF2_ITER = 120_000;
const KEYLEN = 32;
const DIGEST = "sha256";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITER, KEYLEN, DIGEST)
    .toString("hex");
  return `pbkdf2$${DIGEST}$${PBKDF2_ITER}$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 5) return false;

  const [, digest, iterStr, salt, hashHex] = parts;
  const iter = Number(iterStr);
  if (!digest || !salt || !hashHex || !Number.isFinite(iter)) return false;

  const calc = crypto.pbkdf2Sync(password, salt, iter, KEYLEN, digest as any);
  const storedBuf = Buffer.from(hashHex, "hex");
  if (storedBuf.length !== calc.length) return false;

  return crypto.timingSafeEqual(calc, storedBuf);
}

function makeToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}

// ======================
// Simple in-memory sessions
// ======================
const sessions = new Map<string, number>(); // token -> userId

function getAuthToken(req: IncomingMessage): string {
  const auth = String(req.headers.authorization || "");
  if (!auth.startsWith("Bearer ")) return "";
  return auth.slice(7).trim();
}

function requireAuth(req: IncomingMessage, res: ServerResponse): number | null {
  const token = getAuthToken(req);
  const userId = sessions.get(token);
  if (!token || !userId) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }
  return userId;
}

// ======================
// OpenWeather helpers
// ======================
function requireOwKey(res: ServerResponse): boolean {
  if (!OW_KEY) {
    sendJson(res, 500, {
      error:
        "OPENWEATHER_API_KEY missing. Set it in environment and restart backend. Example: OPENWEATHER_API_KEY=xxx npm run dev",
    });
    return false;
  }
  return true;
}

async function owGet(url: string) {
  const r = await fetch(url);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`OpenWeather error: ${r.status} ${text}`);
  }
  return r.json();
}

// ======================
// Types
// ======================
type ForecastDay = {
  date: string; // YYYY-MM-DD
  min: number;
  max: number;
  description: string;
  icon: string;
};

// ======================
// Router
// ======================
const server = http.createServer(async (req, res) => {
  try {
    setCors(res);

    // Preflight
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    // -------------- GET /
    if (path === "/" && req.method === "GET") {
      return sendJson(res, 200, { message: "Backend is working!" });
    }

    // -------------- AUTH REGISTER
    if (path === "/auth/register") {
      if (req.method !== "POST") return methodNotAllowed(res);
      const body = await readJsonBody(req);

      const email = String(body?.email || "").trim().toLowerCase();
      const name = String(body?.name || "").trim();
      const password = String(body?.password || "");

      if (!email || !name || !password) {
        return sendJson(res, 400, { error: "email, name, password are required" });
      }
      if (password.length < 6) {
        return sendJson(res, 400, { error: "password must be at least 6 characters" });
      }

      const exists = db.prepare("SELECT id FROM users WHERE email=?").get(email) as
        | { id: number }
        | undefined;

      if (exists) return sendJson(res, 409, { error: "user already exists" });

      const password_hash = hashPassword(password);
      const info = db
        .prepare("INSERT INTO users(email, name, password_hash) VALUES(?,?,?)")
        .run(email, name, password_hash);

      const userId = Number(info.lastInsertRowid);
      const token = makeToken();
      sessions.set(token, userId);

      return sendJson(res, 201, {
        token,
        user: { id: userId, email, name, theme: "system" },
      });
    }

    // -------------- AUTH LOGIN
    if (path === "/auth/login") {
      if (req.method !== "POST") return methodNotAllowed(res);
      const body = await readJsonBody(req);

      const email = String(body?.email || "").trim().toLowerCase();
      const password = String(body?.password || "");

      if (!email || !password) {
        return sendJson(res, 400, { error: "email and password required" });
      }

      const row = db
        .prepare("SELECT id, email, name, password_hash, theme FROM users WHERE email=?")
        .get(email) as
        | { id: number; email: string; name: string; password_hash: string; theme: string }
        | undefined;

      if (!row) return sendJson(res, 401, { error: "invalid credentials" });
      if (!verifyPassword(password, row.password_hash)) {
        return sendJson(res, 401, { error: "invalid credentials" });
      }

      const token = makeToken();
      sessions.set(token, row.id);

      return sendJson(res, 200, {
        token,
        user: { id: row.id, email: row.email, name: row.name, theme: row.theme },
      });
    }

    // -------------- AUTH LOGOUT
    if (path === "/auth/logout") {
      if (req.method !== "POST") return methodNotAllowed(res);
      const token = getAuthToken(req);
      if (token) sessions.delete(token);
      return sendJson(res, 200, { success: true });
    }

    // -------------- REQUEST RESET (email imitation)
    if (path === "/auth/request-reset") {
      if (req.method !== "POST") return methodNotAllowed(res);
      const body = await readJsonBody(req);

      const email = String(body?.email || "").trim().toLowerCase();
      if (!email) return sendJson(res, 400, { error: "email is required" });

      const user = db.prepare("SELECT id FROM users WHERE email=?").get(email) as
        | { id: number }
        | undefined;

      // не палим существует ли email
      if (!user) return sendJson(res, 200, { success: true });

      const resetToken = makeToken(16);
      const expires = Date.now() + 15 * 60 * 1000;

      db.prepare("UPDATE users SET reset_token=?, reset_expires=? WHERE id=?").run(
        resetToken,
        expires,
        user.id
      );

      console.log(
        `[RESET EMAIL IMITATION] email=${email} token=${resetToken} expires=${new Date(expires).toISOString()}`
      );

      return sendJson(res, 200, { success: true, resetToken, expires });
    }

    // -------------- RESET PASSWORD
    if (path === "/auth/reset") {
      if (req.method !== "POST") return methodNotAllowed(res);
      const body = await readJsonBody(req);

      const email = String(body?.email || "").trim().toLowerCase();
      const resetToken = String(body?.resetToken || "").trim();
      const newPassword = String(body?.newPassword || "");

      if (!email || !resetToken || !newPassword) {
        return sendJson(res, 400, { error: "email, resetToken, newPassword required" });
      }
      if (newPassword.length < 6) {
        return sendJson(res, 400, { error: "newPassword must be at least 6 characters" });
      }

      const row = db
        .prepare("SELECT id, reset_token, reset_expires FROM users WHERE email=?")
        .get(email) as
        | { id: number; reset_token: string | null; reset_expires: number | null }
        | undefined;

      if (!row || !row.reset_token || !row.reset_expires) {
        return sendJson(res, 400, { error: "reset not requested" });
      }
      if (row.reset_token !== resetToken) return sendJson(res, 400, { error: "invalid token" });
      if (Date.now() > row.reset_expires) return sendJson(res, 400, { error: "token expired" });

      const password_hash = hashPassword(newPassword);
      db.prepare(
        "UPDATE users SET password_hash=?, reset_token=NULL, reset_expires=NULL WHERE id=?"
      ).run(password_hash, row.id);

      return sendJson(res, 200, { success: true });
    }

    // -------------- ME
    if (path === "/me") {
      if (req.method !== "GET") return methodNotAllowed(res);
      const userId = requireAuth(req, res);
      if (!userId) return;

      const user = db
        .prepare("SELECT id, email, name, theme FROM users WHERE id=?")
        .get(userId) as { id: number; email: string; name: string; theme: string };

      return sendJson(res, 200, { user });
    }

    // -------------- ME THEME
    if (path === "/me/theme") {
      const userId = requireAuth(req, res);
      if (!userId) return;

      if (req.method !== "PUT") return methodNotAllowed(res);
      const body = await readJsonBody(req);
      const theme = String(body?.theme || "system");

      if (!["system", "light", "dark"].includes(theme)) {
        return sendJson(res, 400, { error: "theme must be system|light|dark" });
      }

      db.prepare("UPDATE users SET theme=? WHERE id=?").run(theme, userId);
      return sendJson(res, 200, { success: true, theme });
    }

    // -------------- HISTORY GET
    if (path === "/history" && req.method === "GET") {
      const userId = requireAuth(req, res);
      if (!userId) return;

      const rows = db
        .prepare(
          "SELECT city, lang, created_at FROM searches WHERE user_id=? ORDER BY created_at DESC LIMIT 50"
        )
        .all(userId) as Array<{ city: string; lang: string; created_at: number }>;

      return sendJson(res, 200, { history: rows });
    }

    // -------------- HISTORY POST
    if (path === "/history" && req.method === "POST") {
      const userId = requireAuth(req, res);
      if (!userId) return;

      const body = await readJsonBody(req);
      const city = String(body?.city || "").trim();
      const lang = String(body?.lang || "en").trim();

      if (!city) return sendJson(res, 400, { error: "city is required" });
      if (!["en", "ru"].includes(lang)) return sendJson(res, 400, { error: "lang must be en|ru" });

      db.prepare("INSERT INTO searches(user_id, city, lang, created_at) VALUES(?,?,?,?)").run(
        userId,
        city,
        lang,
        Date.now()
      );

      return sendJson(res, 200, { success: true });
    }

    // -------------- API WEATHER
    if (path === "/api/weather" && req.method === "GET") {
      if (!requireOwKey(res)) return;

      const city = String(url.searchParams.get("city") || "").trim();
      const lang = String(url.searchParams.get("lang") || "en").trim();

      if (!city) return sendJson(res, 400, { error: "city is required" });

      const owUrl =
        `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}` +
        `&appid=${OW_KEY}&units=metric&lang=${encodeURIComponent(lang)}`;

      try {
        const data: any = await owGet(owUrl);
        return sendJson(res, 200, {
          city: data.name,
          temp: data.main?.temp ?? null,
          feels_like: data.main?.feels_like ?? null,
          description: data.weather?.[0]?.description ?? "",
          icon: data.weather?.[0]?.icon ?? "",
        });
      } catch (e: any) {
        return sendJson(res, 500, { error: e?.message || "weather error" });
      }
    }

    // -------------- API FORECAST
    if (path === "/api/forecast" && req.method === "GET") {
      if (!requireOwKey(res)) return;

      const city = String(url.searchParams.get("city") || "").trim();
      const lang = String(url.searchParams.get("lang") || "en").trim();

      if (!city) return sendJson(res, 400, { error: "city is required" });

      const owUrl =
        `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(city)}` +
        `&appid=${OW_KEY}&units=metric&lang=${encodeURIComponent(lang)}`;

      try {
        const data: any = await owGet(owUrl);

        const byDay: Record<
          string,
          { min: number; max: number; descriptions: string[]; icons: string[] }
        > = {};

        for (const item of data.list || []) {
          const dtTxt: string = item.dt_txt || "";
          const dateKey = dtTxt.slice(0, 10);
          if (!dateKey) continue;

          const tmin = Number(item.main?.temp_min ?? item.main?.temp ?? 0);
          const tmax = Number(item.main?.temp_max ?? item.main?.temp ?? 0);
          const desc = String(item.weather?.[0]?.description || "");
          const icon = String(item.weather?.[0]?.icon || "");

          if (!byDay[dateKey]) {
            byDay[dateKey] = { min: tmin, max: tmax, descriptions: [], icons: [] };
          } else {
            byDay[dateKey].min = Math.min(byDay[dateKey].min, tmin);
            byDay[dateKey].max = Math.max(byDay[dateKey].max, tmax);
          }

          if (desc) byDay[dateKey].descriptions.push(desc);
          if (icon) byDay[dateKey].icons.push(icon);
        }

        const days = Object.keys(byDay).sort().slice(0, 6);

        const forecast: ForecastDay[] = [];
        for (const d of days) {
          const day = byDay[d];
          if (!day) continue; // ✅ FIX: TS видит что может быть undefined

          forecast.push({
            date: d,
            min: Math.round(day.min * 10) / 10,
            max: Math.round(day.max * 10) / 10,
            description: day.descriptions[0] || "",
            icon: day.icons[0] || "",
          });
        }

        return sendJson(res, 200, { city, forecast });
      } catch (e: any) {
        return sendJson(res, 500, { error: e?.message || "forecast error" });
      }
    }

    // fallback
    return notFound(res);
  } catch (err: any) {
    return sendJson(res, 500, { error: err?.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
