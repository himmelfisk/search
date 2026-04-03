import { Hono } from "hono";
import { requireAuth } from "../middleware/auth.js";

export const searchRoutes = new Hono();

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

  const id = crypto.randomUUID();

  await db
    .prepare(
      "INSERT INTO search_operations (id, title, description, created_by, owner_google_id, owner_name, owner_email) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, body.title, body.description || null, user.googleId, user.googleId, user.name, user.email)
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
