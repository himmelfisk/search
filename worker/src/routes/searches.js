import { Hono } from "hono";
import { requireAuth, verifyGoogleToken } from "../middleware/auth.js";

export const searchRoutes = new Hono();

/**
 * GET /owned - List search operations owned by the authenticated user
 */
searchRoutes.get("/owned", async (c) => {
  // Optional auth – verify token from Authorization header
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Authorization required" }, 401);
  }

  const token = authHeader.slice(7);
  const user = await verifyGoogleToken(token);
  if (!user) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  const db = c.env.DB;
  const status = c.req.query("status"); // optional filter

  let query = "SELECT id, title, description, status, created_at FROM search_operations WHERE owner_google_id = ?";
  const params = [user.googleId];

  if (status) {
    query += " AND status = ?";
    params.push(status);
  }

  query += " ORDER BY created_at DESC";

  const searches = await db.prepare(query).bind(...params).all();

  return c.json({ searches: searches.results });
});

/**
 * GET /:id/dashboard - Dashboard data for search owner
 * Returns participants (with names/phones), all GPS tracks, and summary stats.
 */
searchRoutes.get("/:id/dashboard", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Authorization required" }, 401);
  }

  const token = authHeader.slice(7);
  const user = await verifyGoogleToken(token);
  if (!user) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }

  const db = c.env.DB;
  const id = c.req.param("id");

  const search = await db
    .prepare("SELECT * FROM search_operations WHERE id = ?")
    .bind(id)
    .first();

  if (!search) {
    return c.json({ error: "Search not found" }, 404);
  }

  if (search.owner_google_id !== user.googleId) {
    return c.json({ error: "Not the owner of this search" }, 403);
  }

  const since = c.req.query("since");

  // Participants with full details (name, phone)
  const participants = await db
    .prepare(
      "SELECT id, name, phone, device_uuid, joined_at FROM participants WHERE search_id = ? ORDER BY joined_at ASC"
    )
    .bind(id)
    .all();

  // GPS tracks for all participants
  let gpsQuery =
    "SELECT gt.device_uuid, gt.latitude, gt.longitude, gt.accuracy, gt.recorded_at, p.name as participant_name FROM gps_tracks gt LEFT JOIN participants p ON gt.device_uuid = p.device_uuid AND gt.search_id = p.search_id WHERE gt.search_id = ?";
  const gpsParams = [id];

  if (since) {
    gpsQuery += " AND gt.recorded_at > ?";
    gpsParams.push(since);
  }

  gpsQuery += " ORDER BY gt.recorded_at ASC LIMIT 50000";

  const tracks = await db.prepare(gpsQuery).bind(...gpsParams).all();

  // Observation pings
  const pings = await db
    .prepare(
      "SELECT op.id, op.device_uuid, op.latitude, op.longitude, op.recorded_at, p.name as participant_name FROM observation_pings op LEFT JOIN participants p ON op.device_uuid = p.device_uuid AND op.search_id = p.search_id WHERE op.search_id = ? ORDER BY op.recorded_at ASC"
    )
    .bind(id)
    .all();

  return c.json({
    search,
    participants: participants.results,
    tracks: tracks.results,
    pings: pings.results,
  });
});

/**
 * POST / - Create a new search operation (any authenticated user)
 * Body: { title, description? }
 */
searchRoutes.post("/", requireAuth(), async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const body = await c.req.json();

  if (!body.title) {
    return c.json({ error: "title is required" }, 400);
  }

  const coverageRadius = Math.max(1, Math.min(500, parseInt(body.coverage_radius, 10) || 10));
  const id = crypto.randomUUID();

  await db
    .prepare(
      "INSERT INTO search_operations (id, title, description, created_by, owner_google_id, owner_name, owner_email, coverage_radius) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, body.title, body.description || null, user.googleId, user.googleId, user.name, user.email, coverageRadius)
    .run();

  return c.json({ id, title: body.title }, 201);
});

/**
 * GET / - List active search operations (public)
 */
searchRoutes.get("/", async (c) => {
  const db = c.env.DB;
  const status = c.req.query("status") || "active";

  const searches = await db
    .prepare(
      "SELECT id, title, description, status, created_at FROM search_operations WHERE status = ? ORDER BY created_at DESC"
    )
    .bind(status)
    .all();

  return c.json({ searches: searches.results });
});

/**
 * GET /:id - Get a single search operation (public)
 */
searchRoutes.get("/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  const search = await db
    .prepare("SELECT * FROM search_operations WHERE id = ?")
    .bind(id)
    .first();

  if (!search) {
    return c.json({ error: "Search not found" }, 404);
  }

  const participants = await db
    .prepare(
      "SELECT id, name, device_uuid, joined_at FROM participants WHERE search_id = ? ORDER BY joined_at DESC"
    )
    .bind(id)
    .all();

  return c.json({ search, participants: participants.results });
});

/**
 * POST /:id/join - Join a search operation (public, no login required)
 * Body: { device_uuid, name?, phone? }
 */
searchRoutes.post("/:id/join", async (c) => {
  const db = c.env.DB;
  const searchId = c.req.param("id");
  const body = await c.req.json();

  if (!body.device_uuid) {
    return c.json({ error: "device_uuid is required" }, 400);
  }

  const search = await db
    .prepare("SELECT id, status FROM search_operations WHERE id = ?")
    .bind(searchId)
    .first();

  if (!search) {
    return c.json({ error: "Search not found" }, 404);
  }

  if (search.status !== "active") {
    return c.json({ error: "Search is not active" }, 400);
  }

  // Check if already joined
  const existing = await db
    .prepare(
      "SELECT id FROM participants WHERE search_id = ? AND device_uuid = ?"
    )
    .bind(searchId, body.device_uuid)
    .first();

  if (existing) {
    // Update name/phone if provided
    if (body.name || body.phone) {
      await db
        .prepare(
          "UPDATE participants SET name = COALESCE(?, name), phone = COALESCE(?, phone) WHERE id = ?"
        )
        .bind(body.name || null, body.phone || null, existing.id)
        .run();
    }
    return c.json({ participant_id: existing.id, already_joined: true });
  }

  const participantId = crypto.randomUUID();

  await db
    .prepare(
      "INSERT INTO participants (id, search_id, device_uuid, name, phone) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(participantId, searchId, body.device_uuid, body.name || null, body.phone || null)
    .run();

  return c.json({ participant_id: participantId }, 201);
});
