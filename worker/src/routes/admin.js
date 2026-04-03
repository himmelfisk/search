import { Hono } from "hono";
import { requireAdmin } from "../middleware/auth.js";

export const adminRoutes = new Hono();

// All admin routes require authentication
adminRoutes.use("/*", requireAdmin());

/**
 * POST /searches - Create a new search operation
 * Body: { title, description? }
 */
adminRoutes.post("/searches", async (c) => {
  const db = c.env.DB;
  const admin = c.get("admin");
  const body = await c.req.json();

  if (!body.title) {
    return c.json({ error: "title is required" }, 400);
  }

  const id = crypto.randomUUID();

  await db
    .prepare(
      "INSERT INTO search_operations (id, title, description, created_by) VALUES (?, ?, ?, ?)"
    )
    .bind(id, body.title, body.description || null, admin.google_id)
    .run();

  return c.json({ id, title: body.title }, 201);
});

/**
 * PATCH /searches/:id - Update a search operation
 * Body: { title?, description?, status? }
 */
adminRoutes.patch("/searches/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");
  const body = await c.req.json();

  const search = await db
    .prepare("SELECT * FROM search_operations WHERE id = ?")
    .bind(id)
    .first();

  if (!search) {
    return c.json({ error: "Search not found" }, 404);
  }

  const title = body.title || search.title;
  const description = body.description !== undefined ? body.description : search.description;
  const status = body.status || search.status;

  await db
    .prepare(
      "UPDATE search_operations SET title = ?, description = ?, status = ? WHERE id = ?"
    )
    .bind(title, description, status, id)
    .run();

  return c.json({ id, title, description, status });
});

/**
 * DELETE /searches/:id - Delete a search operation
 */
adminRoutes.delete("/searches/:id", async (c) => {
  const db = c.env.DB;
  const id = c.req.param("id");

  await db.prepare("DELETE FROM gps_tracks WHERE search_id = ?").bind(id).run();
  await db.prepare("DELETE FROM participants WHERE search_id = ?").bind(id).run();
  await db.prepare("DELETE FROM search_operations WHERE id = ?").bind(id).run();

  return c.json({ deleted: true });
});

/**
 * GET /searches/:id/gps - Get all GPS data for a search (admin view)
 */
adminRoutes.get("/searches/:id/gps", async (c) => {
  const db = c.env.DB;
  const searchId = c.req.param("id");
  const since = c.req.query("since");

  let query =
    "SELECT gt.*, p.name as participant_name FROM gps_tracks gt LEFT JOIN participants p ON gt.device_uuid = p.device_uuid AND gt.search_id = p.search_id WHERE gt.search_id = ?";
  const params = [searchId];

  if (since) {
    query += " AND gt.recorded_at > ?";
    params.push(since);
  }

  query += " ORDER BY gt.recorded_at DESC LIMIT 10000";

  const tracks = await db.prepare(query).bind(...params).all();

  return c.json({ tracks: tracks.results });
});

/**
 * DELETE /gps/:searchId - Delete GPS data for a search (admin only)
 */
adminRoutes.delete("/gps/:searchId", async (c) => {
  const db = c.env.DB;
  const searchId = c.req.param("searchId");

  const result = await db
    .prepare("DELETE FROM gps_tracks WHERE search_id = ?")
    .bind(searchId)
    .run();

  return c.json({ deleted: true });
});

/**
 * GET /participants/:searchId - Get participants for a search with full details
 */
adminRoutes.get("/participants/:searchId", async (c) => {
  const db = c.env.DB;
  const searchId = c.req.param("searchId");

  const participants = await db
    .prepare(
      "SELECT * FROM participants WHERE search_id = ? ORDER BY joined_at DESC"
    )
    .bind(searchId)
    .all();

  return c.json({ participants: participants.results });
});
