import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();

// Enable CORS for the frontend
app.use("*", cors());

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/", (c) => {
  return c.json({ status: "ok", service: "search-api" });
});

// ---------------------------------------------------------------------------
// Search Operations
// ---------------------------------------------------------------------------

// List all operations (optionally filter by status)
app.get("/operations", async (c) => {
  const status = c.req.query("status");
  let result;
  if (status) {
    result = await c.env.DB.prepare(
      "SELECT * FROM search_operations WHERE status = ? ORDER BY created_at DESC"
    )
      .bind(status)
      .all();
  } else {
    result = await c.env.DB.prepare(
      "SELECT * FROM search_operations ORDER BY created_at DESC"
    ).all();
  }
  return c.json(result.results);
});

// Get a single operation
app.get("/operations/:id", async (c) => {
  const id = c.req.param("id");
  const result = await c.env.DB.prepare(
    "SELECT * FROM search_operations WHERE id = ?"
  )
    .bind(id)
    .first();
  if (!result) {
    return c.json({ error: "Operation not found" }, 404);
  }
  return c.json(result);
});

// Create an operation
app.post("/operations", async (c) => {
  const body = await c.req.json();
  const { title, description, latitude, longitude } = body;
  if (!title) {
    return c.json({ error: "title is required" }, 400);
  }
  const result = await c.env.DB.prepare(
    "INSERT INTO search_operations (title, description, latitude, longitude) VALUES (?, ?, ?, ?) RETURNING *"
  )
    .bind(title, description || null, latitude || null, longitude || null)
    .first();
  return c.json(result, 201);
});

// Update an operation
app.put("/operations/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const { title, description, status, latitude, longitude } = body;
  const result = await c.env.DB.prepare(
    `UPDATE search_operations
       SET title = COALESCE(?, title),
           description = COALESCE(?, description),
           status = COALESCE(?, status),
           latitude = COALESCE(?, latitude),
           longitude = COALESCE(?, longitude),
           updated_at = datetime('now')
     WHERE id = ? RETURNING *`
  )
    .bind(
      title || null,
      description || null,
      status || null,
      latitude || null,
      longitude || null,
      id
    )
    .first();
  if (!result) {
    return c.json({ error: "Operation not found" }, 404);
  }
  return c.json(result);
});

// Delete an operation
app.delete("/operations/:id", async (c) => {
  const id = c.req.param("id");
  const meta = await c.env.DB.prepare(
    "DELETE FROM search_operations WHERE id = ?"
  )
    .bind(id)
    .run();
  if (meta.meta.changes === 0) {
    return c.json({ error: "Operation not found" }, 404);
  }
  return c.json({ deleted: true });
});

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

// List participants for an operation
app.get("/operations/:id/participants", async (c) => {
  const operationId = c.req.param("id");
  const result = await c.env.DB.prepare(
    "SELECT * FROM participants WHERE operation_id = ? ORDER BY joined_at DESC"
  )
    .bind(operationId)
    .all();
  return c.json(result.results);
});

// Join an operation
app.post("/operations/:id/join", async (c) => {
  const operationId = c.req.param("id");
  const body = await c.req.json();
  const { device_uuid, name } = body;
  if (!device_uuid) {
    return c.json({ error: "device_uuid is required" }, 400);
  }
  try {
    const result = await c.env.DB.prepare(
      "INSERT INTO participants (operation_id, device_uuid, name) VALUES (?, ?, ?) RETURNING *"
    )
      .bind(operationId, device_uuid, name || null)
      .first();
    return c.json(result, 201);
  } catch (err) {
    if (err.message.includes("UNIQUE constraint")) {
      return c.json({ error: "Already joined this operation" }, 409);
    }
    throw err;
  }
});

// Leave an operation
app.delete("/operations/:id/leave", async (c) => {
  const operationId = c.req.param("id");
  const deviceUuid = c.req.query("device_uuid");
  if (!deviceUuid) {
    return c.json({ error: "device_uuid query parameter is required" }, 400);
  }
  const meta = await c.env.DB.prepare(
    "DELETE FROM participants WHERE operation_id = ? AND device_uuid = ?"
  )
    .bind(operationId, deviceUuid)
    .run();
  if (meta.meta.changes === 0) {
    return c.json({ error: "Participant not found" }, 404);
  }
  return c.json({ left: true });
});

// ---------------------------------------------------------------------------
// GPS Tracks
// ---------------------------------------------------------------------------

// Get GPS tracks for an operation (optionally filter by device)
app.get("/operations/:id/tracks", async (c) => {
  const operationId = c.req.param("id");
  const deviceUuid = c.req.query("device_uuid");
  let result;
  if (deviceUuid) {
    result = await c.env.DB.prepare(
      "SELECT * FROM gps_tracks WHERE operation_id = ? AND device_uuid = ? ORDER BY recorded_at ASC"
    )
      .bind(operationId, deviceUuid)
      .all();
  } else {
    result = await c.env.DB.prepare(
      "SELECT * FROM gps_tracks WHERE operation_id = ? ORDER BY recorded_at ASC"
    )
      .bind(operationId)
      .all();
  }
  return c.json(result.results);
});

// Submit GPS track points (supports batch upload for offline queuing)
app.post("/operations/:id/tracks", async (c) => {
  const operationId = c.req.param("id");
  const body = await c.req.json();

  // Accept a single point or an array of points
  const points = Array.isArray(body) ? body : [body];

  if (points.length === 0) {
    return c.json({ error: "At least one track point is required" }, 400);
  }

  const stmt = c.env.DB.prepare(
    "INSERT INTO gps_tracks (operation_id, device_uuid, latitude, longitude, accuracy, recorded_at) VALUES (?, ?, ?, ?, ?, ?)"
  );

  const batch = points.map((p) => {
    if (!p.device_uuid || p.latitude == null || p.longitude == null) {
      throw new Error("device_uuid, latitude, and longitude are required");
    }
    return stmt.bind(
      operationId,
      p.device_uuid,
      p.latitude,
      p.longitude,
      p.accuracy || null,
      p.recorded_at || new Date().toISOString()
    );
  });

  await c.env.DB.batch(batch);
  return c.json({ inserted: points.length }, 201);
});

export default app;
