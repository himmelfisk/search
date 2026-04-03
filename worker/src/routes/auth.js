import { Hono } from "hono";
import { verifyGoogleToken } from "../middleware/auth.js";

export const authRoutes = new Hono();

/**
 * POST /google - Authenticate with Google OAuth ID token
 * Body: { id_token }
 * Returns admin status and user info.
 */
authRoutes.post("/google", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();

  if (!body.id_token) {
    return c.json({ error: "id_token is required" }, 400);
  }

  const user = await verifyGoogleToken(body.id_token);
  if (!user) {
    return c.json({ error: "Invalid token" }, 401);
  }

  // Check if user is an admin
  let admin = await db
    .prepare("SELECT * FROM admins WHERE google_id = ?")
    .bind(user.googleId)
    .first();

  return c.json({
    user: {
      google_id: user.googleId,
      email: user.email,
      name: user.name,
    },
    is_admin: !!admin,
  });
});
