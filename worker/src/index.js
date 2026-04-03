import { Hono } from "hono";
import { cors } from "hono/cors";
import { searchRoutes } from "./routes/searches.js";
import { gpsRoutes } from "./routes/gps.js";
import { authRoutes } from "./routes/auth.js";
import { adminRoutes } from "./routes/admin.js";

const app = new Hono();

app.use("/*", cors());

// Config – exposes the Google Client ID so the frontend can initialise sign-in
app.get("/api/config", (c) => {
  return c.json({ googleClientId: c.env.GOOGLE_CLIENT_ID || "" });
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api/searches", searchRoutes);
app.route("/api/gps", gpsRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/admin", adminRoutes);

export default app;
