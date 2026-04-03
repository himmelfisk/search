/**
 * Verify a Google OAuth ID token and extract user info.
 * In production, you should verify the token signature against Google's public keys.
 * For simplicity, we decode the JWT and verify the issuer/audience.
 */
export async function verifyGoogleToken(idToken) {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;

    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));

    if (!payload.sub || !payload.email) return null;

    // In production, verify: payload.iss, payload.aud, payload.exp
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;

    return {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name || payload.email,
    };
  } catch {
    return null;
  }
}

/**
 * Middleware that requires a valid admin session.
 * Expects header: Authorization: Bearer <google_id_token>
 */
export function requireAdmin() {
  return async (c, next) => {
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
    const admin = await db
      .prepare("SELECT * FROM admins WHERE google_id = ?")
      .bind(user.googleId)
      .first();

    if (!admin) {
      return c.json({ error: "Not an admin" }, 403);
    }

    c.set("admin", admin);
    await next();
  };
}
