import "dotenv/config";
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT ?? 3001);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}
if (!process.env.APP_USERNAME || !process.env.APP_PASSWORD) {
  throw new Error("APP_USERNAME and APP_PASSWORD are required");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors({
  origin: process.env.CORS_ORIGIN ?? true,
  credentials: true
}));
app.use(express.json());

type Session = { expiresAt: number };
const sessions = new Map<string, Session>();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const isProduction = process.env.NODE_ENV === "production";

function parseCookies(req: Request) {
  const header = req.headers.cookie ?? "";
  return Object.fromEntries(header.split(";").filter(Boolean).map(part => {
    const index = part.indexOf("=");
    const key = part.slice(0, index).trim();
    const value = decodeURIComponent(part.slice(index + 1).trim());
    return [key, value];
  }));
}

function getSession(req: Request) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (session) sessions.delete(token);
    return null;
  }
  return { token, session };
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!getSession(req)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

function setSessionCookie(res: Response, token: string) {
  const secure = isProduction ? "; Secure" : "";
  res.setHeader("Set-Cookie", `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}

function clearSessionCookie(res: Response) {
  res.setHeader("Set-Cookie", "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  const safeEqual = (a: string, b: string) => crypto.timingSafeEqual(
    crypto.createHash("sha256").update(a).digest(),
    crypto.createHash("sha256").update(b).digest()
  );
  const valid = typeof username === "string" && typeof password === "string" &&
    safeEqual(username, process.env.APP_USERNAME!) &&
    safeEqual(password, process.env.APP_PASSWORD!);

  if (!valid) return res.status(401).json({ error: "Invalid username or password" });

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
  setSessionCookie(res, token);
  res.json({ authenticated: true });
});

app.post("/api/auth/logout", (req, res) => {
  const current = getSession(req);
  if (current) sessions.delete(current.token);
  clearSessionCookie(res);
  res.json({ authenticated: false });
});

app.get("/api/auth/me", (req, res) => {
  res.json({ authenticated: Boolean(getSession(req)) });
});

const allowedReasons = [
  "followers",
  "avg views",
  "bad engagement rate",
  "woman",
  "bad content",
  "unrelated",
  "other"
] as const;

app.get("/api/channels", requireAuth, async (req, res) => {
  try {
    const status = String(req.query.status ?? "pending");
    const search = String(req.query.search ?? "").trim();
    const minSubs = Number(req.query.minSubs ?? 0);
    const maxSubs = Number(req.query.maxSubs ?? Number.MAX_SAFE_INTEGER);
    const minViews = Number(req.query.minViews ?? 0);
    const minEngagement = Number(req.query.minEngagement ?? 0);

    if (!["pending", "validated", "invalidated"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const conditions = [
      "avg_views IS NOT NULL",
      "avg_engagement_rate IS NOT NULL"
    ];
    const params: unknown[] = [];

    if (status === "pending") conditions.push("valid IS NULL");
    if (status === "validated") conditions.push("valid = TRUE");
    if (status === "invalidated") conditions.push("valid = FALSE");

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(channel_name ILIKE $${params.length} OR COALESCE(channel_handle, '') ILIKE $${params.length})`);
    }

    params.push(minSubs);
    conditions.push(`subscriber_count >= $${params.length}`);
    params.push(maxSubs);
    conditions.push(`subscriber_count <= $${params.length}`);
    params.push(minViews);
    conditions.push(`avg_views >= $${params.length}`);
    params.push(minEngagement);
    conditions.push(`avg_engagement_rate >= $${params.length}`);

    const sql = `
      SELECT
        channel_id,
        channel_handle,
        channel_name,
        profile_photo_url,
        banner_photo_url,
        subscriber_count,
        avg_views,
        avg_engagement_rate,
        videos_last_month,
        valid,
        rejection_reason
      FROM yt_channels
      WHERE ${conditions.join(" AND ")}
      ORDER BY subscriber_count DESC NULLS LAST, channel_name ASC
      LIMIT 500
    `;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load channels" });
  }
});

app.patch("/api/channels/:channelId/status", requireAuth, async (req, res) => {
  const { channelId } = req.params;
  const { valid, rejectionReason } = req.body;

  if (valid !== true && valid !== false) {
    return res.status(400).json({ error: "valid must be true or false" });
  }

  if (valid === false && !allowedReasons.includes(rejectionReason)) {
    return res.status(400).json({ error: "A valid rejection reason is required" });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE yt_channels
       SET valid = $1,
           rejection_reason = CASE WHEN $1 = FALSE THEN $2::channel_rejection_reason ELSE NULL END
       WHERE channel_id = $3
       RETURNING channel_id, valid, rejection_reason`,
      [valid, valid ? null : rejectionReason, channelId]
    );

    if (!rows[0]) return res.status(404).json({ error: "Channel not found" });
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update channel" });
  }
});

app.get("/api/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});