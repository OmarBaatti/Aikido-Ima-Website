import "dotenv/config";
import express from "express";
import cors from "cors";
import pg from "pg";

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT ?? 3001);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173" }));
app.use(express.json());

const allowedReasons = [
  "followers",
  "avg views",
  "bad engagement rate",
  "woman",
  "bad content",
  "unrelated",
  "other"
] as const;

app.get("/api/channels", async (req, res) => {
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

app.patch("/api/channels/:channelId/status", async (req, res) => {
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
  console.log(`API listening on http://localhost:${port}`);
});