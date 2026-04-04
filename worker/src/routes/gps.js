import { Hono } from "hono";

export const gpsRoutes = new Hono();

/**
 * POST / - Submit GPS coordinates (append-only, public)
 * Body: { search_id, device_uuid, latitude, longitude, accuracy?, recorded_at }
 * Supports single point or batch: { points: [...] }
 */
gpsRoutes.post("/", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();

  // Support batch upload (for offline queue sync)
  const points = body.points || [body];

  if (points.length === 0) {
    return c.json({ error: "No GPS points provided" }, 400);
  }

  if (points.length > 1000) {
    return c.json({ error: "Maximum 1000 points per request" }, 400);
  }

  const errors = [];
  let inserted = 0;

  for (const point of points) {
    if (!point.search_id || !point.device_uuid || point.latitude == null || point.longitude == null) {
      errors.push({ point, error: "Missing required fields" });
      continue;
    }

    if (typeof point.latitude !== "number" || typeof point.longitude !== "number") {
      errors.push({ point, error: "latitude and longitude must be numbers" });
      continue;
    }

    if (point.latitude < -90 || point.latitude > 90 || point.longitude < -180 || point.longitude > 180) {
      errors.push({ point, error: "Coordinates out of range" });
      continue;
    }

    try {
      await db
        .prepare(
          "INSERT INTO gps_tracks (search_id, device_uuid, latitude, longitude, accuracy, recorded_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(
          point.search_id,
          point.device_uuid,
          point.latitude,
          point.longitude,
          point.accuracy || null,
          point.recorded_at || new Date().toISOString()
        )
        .run();
      inserted++;
    } catch (err) {
      errors.push({ point, error: err.message });
    }
  }

  return c.json({ inserted, errors: errors.length > 0 ? errors : undefined });
});

/**
 * GET /:searchId - Get GPS tracks for a search (own device only)
 * Requires device_uuid query param so participants can only see their own tracks.
 * Admins can see all tracks via the /api/admin/searches/:id/gps endpoint.
 */
gpsRoutes.get("/:searchId", async (c) => {
  const db = c.env.DB;
  const searchId = c.req.param("searchId");
  const deviceUuid = c.req.query("device_uuid");
  const since = c.req.query("since");
  const limit = Math.min(parseInt(c.req.query("limit") || "1000", 10), 10000);

  if (!deviceUuid) {
    return c.json({ error: "device_uuid query parameter is required" }, 400);
  }

  let query =
    "SELECT id, latitude, longitude, accuracy, recorded_at FROM gps_tracks WHERE search_id = ? AND device_uuid = ?";
  const params = [searchId, deviceUuid];

  if (since) {
    query += " AND recorded_at > ?";
    params.push(since);
  }

  query += " ORDER BY recorded_at DESC LIMIT ?";
  params.push(limit);

  const stmt = db.prepare(query);
  const tracks = await stmt.bind(...params).all();

  return c.json({ tracks: tracks.results });
});

/**
 * POST /ping - Submit an observation ping
 * Body: { search_id, device_uuid, latitude, longitude }
 */
gpsRoutes.post("/ping", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();

  if (!body.search_id || !body.device_uuid || body.latitude == null || body.longitude == null) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  if (typeof body.latitude !== "number" || typeof body.longitude !== "number") {
    return c.json({ error: "latitude and longitude must be numbers" }, 400);
  }

  if (body.latitude < -90 || body.latitude > 90 || body.longitude < -180 || body.longitude > 180) {
    return c.json({ error: "Coordinates out of range" }, 400);
  }

  try {
    await db
      .prepare(
        "INSERT INTO observation_pings (search_id, device_uuid, latitude, longitude, recorded_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(
        body.search_id,
        body.device_uuid,
        body.latitude,
        body.longitude,
        new Date().toISOString()
      )
      .run();

    return c.json({ ok: true }, 201);
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});
