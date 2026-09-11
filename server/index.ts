import "dotenv/config";
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT ?? 3001);

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!process.env.APP_USERNAME || !process.env.APP_PASSWORD) throw new Error("APP_USERNAME and APP_PASSWORD are required");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
app.use(cors({ origin: process.env.CORS_ORIGIN ?? true, credentials: true }));
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
    safeEqual(username, process.env.APP_USERNAME!) && safeEqual(password, process.env.APP_PASSWORD!);
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
app.get("/api/auth/me", (req, res) => res.json({ authenticated: Boolean(getSession(req)) }));

const allowedReasons = ["followers", "avg views", "bad engagement rate", "woman", "bad content", "unrelated", "other"] as const;

app.get("/api/channels", requireAuth, async (req, res) => {
  try {
    const status = String(req.query.status ?? "pending");
    const search = String(req.query.search ?? "").trim();
    const minSubs = Number(req.query.minSubs ?? 0);
    const maxSubs = Number(req.query.maxSubs ?? Number.MAX_SAFE_INTEGER);
    const minViews = Number(req.query.minViews ?? 0);
    // UI expresses engagement as a percentage: 1 means 1%. DB stores ratios: 0.01 means 1%.
    const minEngagementPercent = Number(req.query.minEngagementPercent ?? 0);
    const minEngagement = minEngagementPercent / 100;

    if (!["pending", "validated", "invalidated"].includes(status)) return res.status(400).json({ error: "Invalid status" });

    const conditions = ["c.avg_views IS NOT NULL", "c.avg_engagement_rate IS NOT NULL"];
    const params: unknown[] = [];
    if (status === "pending") conditions.push("c.valid IS NULL");
    if (status === "validated") conditions.push("c.valid = TRUE");
    if (status === "invalidated") conditions.push("c.valid = FALSE");
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(c.channel_name ILIKE $${params.length} OR COALESCE(c.channel_handle, '') ILIKE $${params.length})`);
    }
    params.push(minSubs); conditions.push(`c.subscriber_count >= $${params.length}`);
    params.push(maxSubs); conditions.push(`c.subscriber_count <= $${params.length}`);
    params.push(minViews); conditions.push(`c.avg_views >= $${params.length}`);
    params.push(minEngagement); conditions.push(`c.avg_engagement_rate >= $${params.length}`);

    const sql = `
      SELECT c.channel_id, c.channel_handle, c.channel_name, c.profile_photo_url, c.banner_photo_url,
             c.subscriber_count, c.avg_views, c.avg_engagement_rate, c.videos_last_month,
             c.valid, c.rejection_reason
      FROM yt_channels c
      WHERE ${conditions.join(" AND ")}
      ORDER BY c.subscriber_count DESC NULLS LAST, c.channel_name ASC
      LIMIT 500`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    console.error(error); res.status(500).json({ error: "Failed to load channels" });
  }
});

app.get("/api/channels/:channelId/videos", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT video_id, channel_id, title, thumbnail_url, published_at, view_count, like_count, comment_count, selected
       FROM yt_videos
       WHERE channel_id = $1 AND view_count IS NOT NULL AND like_count IS NOT NULL
       ORDER BY published_at DESC NULLS LAST, created_at DESC
       LIMIT 15`,
      [req.params.channelId]
    );
    res.json(rows);
  } catch (error) {
    console.error(error); res.status(500).json({ error: "Failed to load videos" });
  }
});

app.patch("/api/channels/:channelId/status", requireAuth, async (req, res) => {
  const { channelId } = req.params;
  const { valid, rejectionReason, selectedVideoId } = req.body ?? {};
  if (valid !== true && valid !== false) return res.status(400).json({ error: "valid must be true or false" });
  if (valid === false && !allowedReasons.includes(rejectionReason)) return res.status(400).json({ error: "A valid rejection reason is required" });
  if (valid === true && typeof selectedVideoId !== "string") return res.status(400).json({ error: "Select one video before validating" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (valid === true) {
      const selected = await client.query(
        `SELECT video_id FROM yt_videos
         WHERE video_id = $1 AND channel_id = $2 AND view_count IS NOT NULL AND like_count IS NOT NULL`,
        [selectedVideoId, channelId]
      );
      if (!selected.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Selected video is not valid for this channel" });
      }
      await client.query(`UPDATE yt_videos SET selected = FALSE WHERE channel_id = $1`, [channelId]);
      await client.query(`UPDATE yt_videos SET selected = TRUE WHERE video_id = $1`, [selectedVideoId]);
    }

    const { rows } = await client.query(
      `UPDATE yt_channels SET valid = $1,
         rejection_reason = CASE WHEN $1 = FALSE THEN $2::channel_rejection_reason ELSE NULL END
       WHERE channel_id = $3
       RETURNING channel_id, valid, rejection_reason`,
      [valid, valid ? null : rejectionReason, channelId]
    );
    if (!rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Channel not found" }); }
    await client.query("COMMIT");
    res.json(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error); res.status(500).json({ error: "Failed to update channel" });
  } finally { client.release(); }
});

app.get("/api/health", async (_req, res) => {
  await pool.query("SELECT 1"); res.json({ ok: true });
});

app.listen(port, "0.0.0.0", () => console.log(`API listening on port ${port}`));
