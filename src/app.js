import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import L from "leaflet";

// ---------------------------------------------------------------------------
// Configuration
// API_BASE is injected at build time via the API_BASE env var (see build.mjs).
// When empty the app calls the same origin – works when the frontend is served
// from the worker or when Cloudflare Pages _redirects proxy /api/* to the
// worker.  GOOGLE_CLIENT_ID can be left empty if the worker has it configured
// – it will be fetched automatically from /api/config.
// ---------------------------------------------------------------------------
const API_BASE = (typeof __API_BASE__ !== "undefined" ? __API_BASE__ : "").replace(/\/+$/, ""); // eslint-disable-line no-undef
let GOOGLE_CLIENT_ID = ""; // Your Google OAuth 2.0 client ID (or fetched from API)

// ---------------------------------------------------------------------------
// Leaflet marker icon fix (CDN paths)
// ---------------------------------------------------------------------------
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ---------------------------------------------------------------------------
// Device UUID (persistent per device)
// ---------------------------------------------------------------------------
function getDeviceUUID() {
  let uuid = localStorage.getItem("device_uuid");
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem("device_uuid", uuid);
  }
  return uuid;
}

const deviceUUID = getDeviceUUID();

// ---------------------------------------------------------------------------
// Google Sign-In state
// ---------------------------------------------------------------------------
let googleCredential = null; // raw JWT token
let googleUser = null; // decoded { sub, name, email, picture, … }
let isAdmin = false; // true after /api/auth/google confirms admin

// Auth DOM elements
const signedOutEl = document.getElementById("signed-out");
const signedInEl = document.getElementById("signed-in");
const userNameEl = document.getElementById("user-name");
const signOutBtn = document.getElementById("sign-out-btn");

// ---------------------------------------------------------------------------
// View navigation state
// ---------------------------------------------------------------------------
let currentView = "home";
let currentSearch = null;
let watchId = null;
let activeSearchId = null;

// Owner dashboard state
let dashboardMap = null;
let dashboardLayers = [];
let dashboardRefreshTimer = null;
let ownedSearches = [];
let currentDashboardSearchId = null;

const headerTitle = document.getElementById("header-title");
const headerBack = document.getElementById("header-back");
const views = {
  home: document.getElementById("view-home"),
  search: document.getElementById("view-search"),
  dashboard: document.getElementById("view-dashboard"),
};

// ---------------------------------------------------------------------------
// Offline GPS queue
// ---------------------------------------------------------------------------
const GPS_QUEUE_KEY = "gps_queue";

function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(GPS_QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  localStorage.setItem(GPS_QUEUE_KEY, JSON.stringify(queue));
}

function enqueueGPSPoint(point) {
  const queue = getQueue();
  queue.push(point);
  saveQueue(queue);
  updateQueueUI();
}

async function flushQueue() {
  const queue = getQueue();
  if (queue.length === 0) return;

  try {
    const resp = await fetch(`${API_BASE}/api/gps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: queue }),
    });

    if (resp.ok) {
      saveQueue([]);
      updateQueueUI();
    }
  } catch {
    // Stay queued; will retry later
  }
}

function updateQueueUI() {
  const queue = getQueue();
  const indicator = document.getElementById("queue-indicator");
  const countEl = document.getElementById("queue-count");
  if (!indicator || !countEl) return;
  if (queue.length > 0) {
    indicator.classList.remove("hidden");
    countEl.textContent = `${queue.length} point${queue.length !== 1 ? "s" : ""} queued offline`;
  } else {
    indicator.classList.add("hidden");
  }
}

// Flush queue periodically and when coming back online
setInterval(flushQueue, 30000);
window.addEventListener("online", flushQueue);

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function assertJsonResponse(resp) {
  const ct = resp.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new ApiError(
      "API returned a non-JSON response – check that API_BASE is configured correctly.",
      resp.status
    );
  }
}

async function apiGet(path) {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new ApiError(body.error || `API error: ${resp.status}`, resp.status);
  }
  assertJsonResponse(resp);
  return resp.json();
}

async function apiPost(path, body, auth = false) {
  const headers = { "Content-Type": "application/json" };
  if (auth && googleCredential) {
    headers["Authorization"] = `Bearer ${googleCredential}`;
  }
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new ApiError(data.error || `HTTP ${resp.status}`, resp.status);
  }
  assertJsonResponse(resp);
  return resp.json();
}

async function apiGetAuth(path) {
  const headers = {};
  if (googleCredential) {
    headers["Authorization"] = `Bearer ${googleCredential}`;
  }
  const resp = await fetch(`${API_BASE}${path}`, { headers });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new ApiError(body.error || `API error: ${resp.status}`, resp.status);
  }
  assertJsonResponse(resp);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function decodeJwtPayload(token) {
  const base64 = token
    .split(".")[1]
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return JSON.parse(atob(base64));
}

// ---------------------------------------------------------------------------
// Google Sign-In
// ---------------------------------------------------------------------------
async function initGoogleSignIn() {
  // If the client ID is not hardcoded, try to fetch it from the API
  if (!GOOGLE_CLIENT_ID) {
    try {
      const config = await apiGet("/api/config");
      if (config.googleClientId) {
        GOOGLE_CLIENT_ID = config.googleClientId;
      }
    } catch (err) {
      console.warn("Could not fetch Google Client ID from API:", err);
    }
  }

  if (!GOOGLE_CLIENT_ID) {
    console.warn(
      "GOOGLE_CLIENT_ID is not set – Google sign-in will not work. " +
        "Configure it in src/app.js or set GOOGLE_CLIENT_ID in the worker environment."
    );
    return;
  }

  /* global google */
  if (typeof google === "undefined" || !google.accounts) {
    // GIS script hasn't loaded yet – retry shortly
    setTimeout(initGoogleSignIn, 300);
    return;
  }

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
  });

  document.getElementById("google-signin-btn").addEventListener("click", () => {
    google.accounts.id.prompt();
  });

  // Restore session from localStorage if the token is still valid
  const stored = localStorage.getItem("google_credential");
  if (stored) {
    try {
      const payload = decodeJwtPayload(stored);
      if (payload.exp > Date.now() / 1000 + 60) {
        setGoogleUser(stored, payload);
      } else {
        localStorage.removeItem("google_credential");
      }
    } catch {
      localStorage.removeItem("google_credential");
    }
  }
}

function handleGoogleCredential(response) {
  const payload = decodeJwtPayload(response.credential);
  localStorage.setItem("google_credential", response.credential);
  setGoogleUser(response.credential, payload);
}

function setGoogleUser(credential, payload) {
  googleCredential = credential;
  googleUser = payload;
  signedOutEl.classList.add("hidden");
  signedInEl.classList.remove("hidden");
  userNameEl.textContent = payload.name || payload.email;
  checkAdminStatus(credential);
}

async function checkAdminStatus(credential) {
  try {
    const data = await apiPost("/api/auth/google", { id_token: credential });
    isAdmin = !!data.is_admin;
  } catch {
    isAdmin = false;
  }
  updateCreateButton();

  // Also check for owned searches
  try {
    const ownedData = await apiGetAuth("/api/searches/owned?status=active");
    ownedSearches = ownedData.searches || [];
  } catch {
    ownedSearches = [];
  }
  updateMySearchesButton();
}

function updateCreateButton() {
  // Button is always visible – no hiding logic needed.
  // The openCreateSearch function handles the sign-in prompt.
}

function signOut() {
  googleCredential = null;
  googleUser = null;
  isAdmin = false;
  ownedSearches = [];
  localStorage.removeItem("google_credential");
  signedInEl.classList.add("hidden");
  signedOutEl.classList.remove("hidden");
  updateCreateButton();
  updateMySearchesButton();
  if (typeof google !== "undefined" && google.accounts) {
    google.accounts.id.disableAutoSelect();
  }
}

signOutBtn.addEventListener("click", () => signOut());

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function showView(name) {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[name].classList.add("active");
  currentView = name;

  if (name === "home") {
    headerTitle.textContent = "Search Operations";
    headerBack.classList.add("hidden");
    stopDashboardRefresh();
  } else if (name === "dashboard") {
    headerBack.classList.remove("hidden");
  } else {
    headerBack.classList.remove("hidden");
  }
}

headerBack.addEventListener("click", () => {
  if (currentView === "search") {
    showView("home");
    stopTracking();
  } else if (currentView === "dashboard") {
    showView("home");
    stopDashboardRefresh();
  }
});

// ---------------------------------------------------------------------------
// Session persistence (survives page reloads)
// ---------------------------------------------------------------------------
function getActiveSession() {
  try {
    return JSON.parse(localStorage.getItem("active_session"));
  } catch {
    return null;
  }
}

function setActiveSession(searchId, participantId) {
  localStorage.setItem(
    "active_session",
    JSON.stringify({ searchId, participantId })
  );
  activeSearchId = searchId;
}

function clearActiveSession() {
  localStorage.removeItem("active_session");
  activeSearchId = null;
}

// ---------------------------------------------------------------------------
// Home view: list active searches
// ---------------------------------------------------------------------------
async function loadSearches() {
  const listEl = document.getElementById("search-list");
  const emptyEl = document.getElementById("search-list-empty");
  const loadingEl = document.getElementById("search-list-loading");

  loadingEl.classList.remove("hidden");
  emptyEl.classList.add("hidden");
  listEl.innerHTML = "";

  try {
    const data = await apiGet("/api/searches");

    // Also fetch owned searches if signed in
    let ownedIds = new Set();
    if (googleCredential) {
      try {
        const ownedData = await apiGetAuth("/api/searches/owned?status=active");
        ownedSearches = ownedData.searches || [];
        ownedIds = new Set(ownedSearches.map((s) => s.id));
        updateMySearchesButton();
      } catch {
        ownedSearches = [];
      }
    }

    loadingEl.classList.add("hidden");

    if (!data.searches || data.searches.length === 0) {
      emptyEl.classList.remove("hidden");
      return;
    }

    data.searches.forEach((search) => {
      const isOwned = ownedIds.has(search.id);
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="card-title">${escapeHtml(search.title)}</span>
          <span style="display:flex;align-items:center;gap:0.35rem;">
            ${isOwned ? '<span class="badge" style="background:var(--orange);font-size:0.65rem;">Owner</span>' : ""}
            <span class="badge badge-${search.status === "active" ? "active" : "closed"}">${escapeHtml(search.status)}</span>
          </span>
        </div>
        ${search.description ? `<p class="card-description">${escapeHtml(search.description)}</p>` : ""}
        <div class="card-meta mt-1">${formatDate(search.created_at)}</div>
      `;
      card.addEventListener("click", () => {
        if (isOwned) {
          openDashboard(search.id);
        } else {
          openSearch(search.id);
        }
      });
      listEl.appendChild(card);
    });
  } catch (err) {
    loadingEl.classList.add("hidden");
    listEl.innerHTML = `<div class="status-bar error">Unable to load searches. Check your connection.</div>`;
  }
}

// ---------------------------------------------------------------------------
// Search detail view
// ---------------------------------------------------------------------------
async function openSearch(searchId) {
  showView("search");
  headerTitle.textContent = "Loading…";

  const joinSection = document.getElementById("join-section");
  const trackingSection = document.getElementById("tracking-section");
  const participantList = document.getElementById("participant-list");

  joinSection.classList.remove("hidden");
  trackingSection.classList.add("hidden");
  participantList.innerHTML =
    '<div class="loading-center"><div class="spinner"></div></div>';

  try {
    const data = await apiGet(`/api/searches/${searchId}`);
    currentSearch = data.search;

    headerTitle.textContent = escapeHtml(data.search.title);
    document.getElementById("search-title").textContent = data.search.title;
    document.getElementById("search-meta").textContent =
      `Created ${formatDate(data.search.created_at)}`;
    document.getElementById("search-description").textContent =
      data.search.description || "";

    // Render participants
    renderParticipants(data.participants || []);

    // Check if we already joined this search
    const session = getActiveSession();
    if (session && session.searchId === searchId) {
      joinSection.classList.add("hidden");
      trackingSection.classList.remove("hidden");
      startTracking(searchId);
    }
  } catch (err) {
    headerTitle.textContent = "Error";
    document.getElementById("search-title").textContent =
      "Failed to load search";
  }
}

function renderParticipants(participants) {
  const list = document.getElementById("participant-list");
  list.innerHTML = "";

  if (participants.length === 0) {
    list.innerHTML =
      '<li class="text-muted-sm" style="padding:0.5rem 0;">No participants yet. Be the first to join!</li>';
    return;
  }

  participants.forEach((p) => {
    const name = p.name || "Anonymous";
    const initial = name.charAt(0).toUpperCase();
    const li = document.createElement("li");
    li.className = "participant-item";
    li.innerHTML = `
      <div class="participant-avatar">${escapeHtml(initial)}</div>
      <div class="participant-info">
        <div class="participant-name">${escapeHtml(name)}</div>
        <div class="participant-meta">Joined ${formatDate(p.joined_at)}</div>
      </div>
    `;
    list.appendChild(li);
  });
}

// ---------------------------------------------------------------------------
// Join search
// ---------------------------------------------------------------------------
document.getElementById("join-btn").addEventListener("click", async () => {
  if (!currentSearch) return;

  const btn = document.getElementById("join-btn");
  const name = document.getElementById("join-name").value.trim();
  const phone = document.getElementById("join-phone").value.trim();

  btn.disabled = true;
  btn.textContent = "Joining…";

  try {
    const result = await apiPost(`/api/searches/${currentSearch.id}/join`, {
      device_uuid: deviceUUID,
      name: name || undefined,
      phone: phone || undefined,
    });

    setActiveSession(currentSearch.id, result.participant_id);

    document.getElementById("join-section").classList.add("hidden");
    document.getElementById("tracking-section").classList.remove("hidden");

    startTracking(currentSearch.id);

    // Refresh participant list
    const data = await apiGet(`/api/searches/${currentSearch.id}`);
    renderParticipants(data.participants || []);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Join Search";
    alert("Failed to join. Please try again.");
  }
});

// ---------------------------------------------------------------------------
// Leave search
// ---------------------------------------------------------------------------
document.getElementById("leave-btn").addEventListener("click", () => {
  stopTracking();
  clearActiveSession();

  document.getElementById("join-section").classList.remove("hidden");
  document.getElementById("tracking-section").classList.add("hidden");
});

// ---------------------------------------------------------------------------
// GPS Tracking
// ---------------------------------------------------------------------------
async function startTracking(searchId) {
  const statusEl = document.getElementById("tracking-status");

  try {
    // requestPermissions() is not implemented on web – guard with platform check
    if (Capacitor.isNativePlatform()) {
      const perm = await Geolocation.requestPermissions();
      if (perm.location === "denied") {
        statusEl.className = "status-bar error";
        statusEl.innerHTML =
          "GPS permission denied. Enable location in your device settings.";
        return;
      }
    } else {
      const perm = await Geolocation.checkPermissions();
      if (perm.location === "denied") {
        statusEl.className = "status-bar error";
        statusEl.innerHTML =
          "GPS permission denied. Enable location in your browser settings.";
        return;
      }
    }

    statusEl.className = "status-bar tracking";
    statusEl.innerHTML =
      '<span class="pulse"></span><span>GPS tracking active</span>';

    // Get initial position
    try {
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
      });
      handlePosition(pos, searchId);
    } catch {
      // Will get position from watch
    }

    // Watch position continuously
    watchId = await Geolocation.watchPosition(
      { enableHighAccuracy: true },
      (position, err) => {
        if (err) {
          statusEl.className = "status-bar error";
          statusEl.innerHTML = `GPS error: ${err.message}`;
          return;
        }
        if (position) {
          statusEl.className = "status-bar tracking";
          statusEl.innerHTML =
            '<span class="pulse"></span><span>GPS tracking active</span>';
          handlePosition(position, searchId);
        }
      }
    );
  } catch (err) {
    statusEl.className = "status-bar error";
    statusEl.innerHTML = `Unable to access GPS: ${err.message}`;
  }
}

function handlePosition(position, searchId) {
  const { latitude, longitude, accuracy } = position.coords;
  const time = new Date(position.timestamp);

  // Update coordinate cards
  document.getElementById("track-lat").textContent = latitude.toFixed(6);
  document.getElementById("track-lng").textContent = longitude.toFixed(6);
  document.getElementById("track-accuracy").textContent =
    `±${Math.round(accuracy)} m`;
  document.getElementById("track-time").textContent = time.toLocaleTimeString();

  // Build GPS point
  const point = {
    search_id: searchId,
    device_uuid: deviceUUID,
    latitude,
    longitude,
    accuracy,
    recorded_at: time.toISOString(),
  };

  // Try to send immediately; queue if offline
  sendGPSPoint(point);
}

async function sendGPSPoint(point) {
  if (!navigator.onLine) {
    enqueueGPSPoint(point);
    return;
  }

  try {
    const resp = await fetch(`${API_BASE}/api/gps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(point),
    });

    if (!resp.ok) {
      enqueueGPSPoint(point);
    }
  } catch {
    enqueueGPSPoint(point);
  }
}

function stopTracking() {
  if (watchId !== null) {
    Geolocation.clearWatch({ id: watchId });
    watchId = null;
  }
}

// ---------------------------------------------------------------------------
// Owner Dashboard
// ---------------------------------------------------------------------------
const ROUTE_COLORS = [
  "#38bdf8", "#4ade80", "#f97316", "#a78bfa", "#fb7185",
  "#facc15", "#2dd4bf", "#e879f9", "#60a5fa", "#f472b6",
];

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

function updateMySearchesButton() {
  const btn = document.getElementById("my-searches-btn");
  if (!btn) return;
  if (ownedSearches.length > 0) {
    btn.classList.remove("hidden");
  } else {
    btn.classList.add("hidden");
  }
}

async function openDashboard(searchId) {
  showView("dashboard");
  headerTitle.textContent = "Dashboard";
  currentDashboardSearchId = searchId;

  // Show switcher if multiple owned searches
  const switcherEl = document.getElementById("dashboard-switcher");
  const selectEl = document.getElementById("dashboard-select");
  if (ownedSearches.length > 1) {
    switcherEl.classList.remove("hidden");
    selectEl.innerHTML = "";
    ownedSearches.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.title;
      if (s.id === searchId) opt.selected = true;
      selectEl.appendChild(opt);
    });
  } else {
    switcherEl.classList.add("hidden");
  }

  await loadDashboardData(searchId);

  // Auto-refresh every 15 seconds
  stopDashboardRefresh();
  dashboardRefreshTimer = setInterval(() => {
    if (currentView === "dashboard" && currentDashboardSearchId) {
      loadDashboardData(currentDashboardSearchId);
    }
  }, 15000);
}

function stopDashboardRefresh() {
  if (dashboardRefreshTimer) {
    clearInterval(dashboardRefreshTimer);
    dashboardRefreshTimer = null;
  }
}

async function loadDashboardData(searchId) {
  try {
    const data = await apiGetAuth(`/api/searches/${searchId}/dashboard`);
    renderDashboard(data);
  } catch (err) {
    document.getElementById("dashboard-title").textContent = "Error loading dashboard";
    document.getElementById("dashboard-meta").textContent = err.message;
  }
}

function renderDashboard(data) {
  const { search, participants, tracks } = data;

  headerTitle.textContent = escapeHtml(search.title);
  document.getElementById("dashboard-title").textContent = search.title;
  document.getElementById("dashboard-meta").textContent =
    `Created ${formatDate(search.created_at)} · Status: ${search.status}`;

  // Group tracks by device_uuid
  const tracksByDevice = {};
  tracks.forEach((t) => {
    if (!tracksByDevice[t.device_uuid]) {
      tracksByDevice[t.device_uuid] = [];
    }
    tracksByDevice[t.device_uuid].push(t);
  });

  // Build participant map for names
  const participantMap = {};
  participants.forEach((p) => {
    participantMap[p.device_uuid] = p;
  });

  // Calculate total distance
  let totalDistance = 0;
  const deviceDistances = {};
  Object.entries(tracksByDevice).forEach(([uuid, points]) => {
    let deviceDist = 0;
    for (let i = 1; i < points.length; i++) {
      const d = haversineDistance(
        points[i - 1].latitude, points[i - 1].longitude,
        points[i].latitude, points[i].longitude
      );
      // Only count movements > 2m (filter GPS jitter)
      if (d > 2 && d < 10000) {
        deviceDist += d;
      }
    }
    deviceDistances[uuid] = deviceDist;
    totalDistance += deviceDist;
  });

  // Update stats
  document.getElementById("stat-participants").textContent = participants.length;
  document.getElementById("stat-distance").textContent = formatDistance(totalDistance);
  document.getElementById("stat-points").textContent = tracks.length;

  // Render map
  renderDashboardMap(tracksByDevice, participantMap);

  // Render legend
  renderDashboardLegend(tracksByDevice, participantMap);

  // Render participant list with details
  renderDashboardParticipants(participants, deviceDistances);
}

function renderDashboardMap(tracksByDevice, participantMap) {
  const mapEl = document.getElementById("dashboard-map");

  if (!dashboardMap) {
    dashboardMap = L.map(mapEl, {
      zoomControl: true,
      attributionControl: false,
    }).setView([59.91, 10.75], 13);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(dashboardMap);

    // Attribution in corner
    L.control.attribution({ prefix: false, position: "bottomright" })
      .addAttribution('© <a href="https://www.openstreetmap.org/copyright">OSM</a>')
      .addTo(dashboardMap);
  }

  // Clear existing layers
  dashboardLayers.forEach((layer) => dashboardMap.removeLayer(layer));
  dashboardLayers = [];

  const allBounds = [];
  let colorIdx = 0;

  Object.entries(tracksByDevice).forEach(([uuid, points]) => {
    if (points.length === 0) return;

    const color = ROUTE_COLORS[colorIdx % ROUTE_COLORS.length];
    colorIdx++;

    const participant = participantMap[uuid];
    const name = (participant && participant.name) || "Anonymous";

    // Draw polyline
    const latlngs = points.map((p) => [p.latitude, p.longitude]);
    const polyline = L.polyline(latlngs, {
      color,
      weight: 3,
      opacity: 0.8,
    }).addTo(dashboardMap);
    dashboardLayers.push(polyline);

    // Add latest position marker
    const latest = points[points.length - 1];
    const marker = L.circleMarker([latest.latitude, latest.longitude], {
      radius: 7,
      fillColor: color,
      color: "#fff",
      weight: 2,
      fillOpacity: 1,
    }).addTo(dashboardMap);

    marker.bindPopup(`<strong>${escapeHtml(name)}</strong><br/>Last update: ${formatDate(latest.recorded_at)}`);
    dashboardLayers.push(marker);

    allBounds.push(...latlngs);
  });

  // Fit bounds
  if (allBounds.length > 0) {
    dashboardMap.fitBounds(allBounds, { padding: [30, 30], maxZoom: 16 });
  }

  // Force Leaflet to recalculate size (needed when container was hidden)
  setTimeout(() => dashboardMap.invalidateSize(), 100);
}

function renderDashboardLegend(tracksByDevice, participantMap) {
  const legendEl = document.getElementById("dashboard-legend");
  legendEl.innerHTML = "";

  let colorIdx = 0;
  Object.entries(tracksByDevice).forEach(([uuid]) => {
    const color = ROUTE_COLORS[colorIdx % ROUTE_COLORS.length];
    colorIdx++;

    const participant = participantMap[uuid];
    const name = (participant && participant.name) || "Anonymous";

    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `<span class="legend-color" style="background:${color}"></span><span class="legend-name">${escapeHtml(name)}</span>`;
    legendEl.appendChild(item);
  });
}

function renderDashboardParticipants(participants, deviceDistances) {
  const list = document.getElementById("dashboard-participant-list");
  list.innerHTML = "";

  if (participants.length === 0) {
    list.innerHTML =
      '<li class="text-muted-sm" style="padding:0.5rem 0;">No participants yet.</li>';
    return;
  }

  participants.forEach((p) => {
    const name = p.name || "Anonymous";
    const initial = name.charAt(0).toUpperCase();
    const dist = deviceDistances[p.device_uuid] || 0;
    const li = document.createElement("li");
    li.className = "participant-item";

    let phoneHtml = "";
    if (p.phone) {
      phoneHtml = `<div class="participant-phone"><a href="tel:${escapeHtml(p.phone)}">${escapeHtml(p.phone)}</a></div>`;
    }

    li.innerHTML = `
      <div class="participant-avatar">${escapeHtml(initial)}</div>
      <div class="participant-info">
        <div class="participant-name">${escapeHtml(name)}</div>
        ${phoneHtml}
        <div class="participant-meta">Joined ${formatDate(p.joined_at)} · ${formatDistance(dist)}</div>
      </div>
    `;
    list.appendChild(li);
  });
}

// Dashboard switcher
document.getElementById("dashboard-select")?.addEventListener("change", (e) => {
  const searchId = e.target.value;
  if (searchId && searchId !== currentDashboardSearchId) {
    openDashboard(searchId);
  }
});

// My Searches button
document.getElementById("my-searches-btn")?.addEventListener("click", () => {
  if (ownedSearches.length === 1) {
    openDashboard(ownedSearches[0].id);
  } else if (ownedSearches.length > 1) {
    // Open the first one; user can switch via dropdown
    openDashboard(ownedSearches[0].id);
  }
});

// ---------------------------------------------------------------------------
// Create Search
// ---------------------------------------------------------------------------
function highlightSignIn() {
  const signInEl = document.getElementById("signed-out");
  if (!signInEl) return;
  signInEl.classList.add("highlight-signin");
  setTimeout(() => signInEl.classList.remove("highlight-signin"), 2000);
}

function openCreateSearch() {
  if (!googleCredential) {
    // User is not signed in – trigger Google sign-in prompt
    if (typeof google !== "undefined" && google.accounts && GOOGLE_CLIENT_ID) {
      google.accounts.id.prompt((notification) => {
        // If the prompt was dismissed or skipped, scroll to the sign-in button
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          highlightSignIn();
        }
      });
    } else {
      highlightSignIn();
    }
    return;
  }
  const modal = document.getElementById("create-search-modal");
  if (modal) {
    modal.classList.remove("hidden");
    document.getElementById("create-title").value = "";
    document.getElementById("create-description").value = "";
    document.getElementById("create-error").classList.add("hidden");
  }
}

function closeCreateSearch() {
  const modal = document.getElementById("create-search-modal");
  if (modal) modal.classList.add("hidden");
}

async function submitCreateSearch() {
  const title = document.getElementById("create-title").value.trim();
  const description = document.getElementById("create-description").value.trim();
  const errorEl = document.getElementById("create-error");
  const btn = document.getElementById("create-submit-btn");

  if (!title) {
    errorEl.textContent = "Title is required.";
    errorEl.classList.remove("hidden");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Creating…";
  errorEl.classList.add("hidden");

  try {
    await apiPost(
      "/api/searches",
      { title, description: description || undefined },
      true
    );
    closeCreateSearch();
    // Refresh owned searches
    try {
      const ownedData = await apiGetAuth("/api/searches/owned?status=active");
      ownedSearches = ownedData.searches || [];
      updateMySearchesButton();
    } catch { /* ignore */ }
    await loadSearches();
  } catch (err) {
    errorEl.textContent =
      err.status === 401
        ? "You must be signed in to create searches."
        : `Failed to create search: ${err.message}`;
    errorEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Create";
  }
}

// Wire up create-search UI
document.getElementById("create-search-btn")?.addEventListener("click", openCreateSearch);
document.getElementById("create-cancel-btn")?.addEventListener("click", closeCreateSearch);
document.getElementById("create-submit-btn")?.addEventListener("click", submitCreateSearch);

// Close modal on backdrop click
document.getElementById("create-search-modal")?.addEventListener("click", (e) => {
  if (e.target.id === "create-search-modal") closeCreateSearch();
});

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------
async function init() {
  // Check if we have an active session from a previous page load
  const session = getActiveSession();
  if (session) {
    activeSearchId = session.searchId;
  }

  // Load the search list on the home view
  await loadSearches();

  // If we were tracking a search, reopen it
  if (session) {
    openSearch(session.searchId);
  }
}

initGoogleSignIn();
init();
