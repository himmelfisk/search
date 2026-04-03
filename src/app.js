import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import L from "leaflet";

// ─── Configuration ───────────────────────────────────────────────────────────
const API_BASE = ""; // Set to your Worker URL, e.g. "https://search-api.your-subdomain.workers.dev"

// ─── Device UUID ─────────────────────────────────────────────────────────────
function getDeviceUUID() {
  let uuid = localStorage.getItem("device_uuid");
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem("device_uuid", uuid);
  }
  return uuid;
}

const deviceUUID = getDeviceUUID();

// ─── Offline GPS Queue ──────────────────────────────────────────────────────
const GPS_QUEUE_KEY = "gps_queue";
// ---------------------------------------------------------------------------
// Configuration – replace these with your own values before deploying.
// See the "Google OAuth Setup" section in readme.md for instructions.
// ---------------------------------------------------------------------------
const API_URL = ""; // e.g. "https://search-api.example.workers.dev"
const GOOGLE_CLIENT_ID = ""; // Your Google OAuth 2.0 client ID

if (!API_URL) {
  console.warn(
    "API_URL is not configured in src/app.js – API calls will fail. " +
      "Set it to your Cloudflare Worker URL (see readme.md)."
  );
}
if (!GOOGLE_CLIENT_ID) {
  console.warn(
    "GOOGLE_CLIENT_ID is not configured in src/app.js – Google Sign-In will not work. " +
      "See the Google OAuth Setup section in readme.md."
  );
}

// ---------------------------------------------------------------------------
// Leaflet marker icon fix
// ---------------------------------------------------------------------------
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ---------------------------------------------------------------------------
// DOM elements
// ---------------------------------------------------------------------------
const statusEl = document.getElementById("status");
const coordsEl = document.getElementById("coordinates");
const latEl = document.getElementById("lat");
const lngEl = document.getElementById("lng");
const accuracyEl = document.getElementById("accuracy");
const timestampEl = document.getElementById("timestamp");
const distanceEl = document.getElementById("distance");
const pointCountEl = document.getElementById("point-count");
const routeStatsEl = document.getElementById("route-stats");

// Mode control elements
const homeControls = document.getElementById("home-controls");
const ownerControls = document.getElementById("owner-controls");
const participantControls = document.getElementById("participant-controls");
const nearbySection = document.getElementById("nearby-section");
const nearbyList = document.getElementById("nearby-list");
const startSearchBtn = document.getElementById("start-search-btn");
const endSearchBtn = document.getElementById("end-search-btn");
const leaveSearchBtn = document.getElementById("leave-search-btn");
const ownerOpTitle = document.getElementById("owner-op-title");
const participantOpTitle = document.getElementById("participant-op-title");
const participantCountEl = document.getElementById("participant-count");

// Auth elements
const signedOutEl = document.getElementById("signed-out");
const signedInEl = document.getElementById("signed-in");
const userAvatarEl = document.getElementById("user-avatar");
const userNameEl = document.getElementById("user-name");
const signOutBtn = document.getElementById("sign-out-btn");

// ---------------------------------------------------------------------------
// Map setup
// ---------------------------------------------------------------------------
const map = L.map("map").setView([62.0, 15.0], 5);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(map);

let userMarker = null;
let accuracyCircle = null;
let isFirstPosition = true;

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
let currentMode = "home"; // "home" | "owner" | "participant"
let currentOperation = null;
let googleCredential = null; // raw JWT token
let googleUser = null; // decoded { sub, name, email, picture, ... }
let currentPosition = null; // latest { latitude, longitude, accuracy }

// Route tracking state (for participant mode)
let routeTracking = false;
let routePoints = [];
let routeLine = null;
let totalDistance = 0;

// Track upload timer (participant mode)
let trackUploadInterval = null;
let pendingTrackPoints = [];

// Live polling timer (owner mode)
let fetchTracksInterval = null;

// Participant route layers on the map (owner mode)
let participantLayers = {}; // { device_uuid: L.polyline }

// Nearby search markers on the map
let nearbyMarkers = [];

// Colours for participant routes
const ROUTE_COLOURS = [
  "#f97316",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#eab308",
  "#06b6d4",
  "#f43f5e",
  "#84cc16",
];

// ---------------------------------------------------------------------------
// Device UUID (persistent per device)
// ---------------------------------------------------------------------------
function getDeviceUuid() {
  let uuid = localStorage.getItem("device_uuid");
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem("device_uuid", uuid);
  }
  return uuid;
}

const deviceUuid = getDeviceUuid();

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
function haversineDistance([lat1, lon1], [lat2, lon2]) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(metres) {
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(2)} km`;
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
function initGoogleSignIn() {
  if (!GOOGLE_CLIENT_ID) {
    console.warn(
      "GOOGLE_CLIENT_ID is not set – Google sign-in will not work."
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

  google.accounts.id.renderButton(
    document.getElementById("google-signin-btn"),
    { theme: "filled_black", size: "medium", shape: "pill" }
  );

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
  if (payload.picture) {
    userAvatarEl.src = payload.picture;
    userAvatarEl.style.display = "";
  } else {
    userAvatarEl.style.display = "none";
  }
}

function signOut() {
  googleCredential = null;
  googleUser = null;
  localStorage.removeItem("google_credential");
  signedInEl.classList.add("hidden");
  signedOutEl.classList.remove("hidden");
  if (typeof google !== "undefined" && google.accounts) {
    google.accounts.id.disableAutoSelect();
  }
}

signOutBtn.addEventListener("click", () => {
  signOut();
  if (currentMode !== "home") {
    setMode("home");
  }
});

// ---------------------------------------------------------------------------
// Mode management
// ---------------------------------------------------------------------------
function setMode(mode) {
  currentMode = mode;

  // Clean up previous mode
  clearInterval(trackUploadInterval);
  clearInterval(fetchTracksInterval);
  trackUploadInterval = null;
  fetchTracksInterval = null;

  // Remove participant layers from previous owner session
  Object.values(participantLayers).forEach((layer) => map.removeLayer(layer));
  participantLayers = {};

  // Stop route tracking if active
  if (routeTracking) {
    stopRoute();
  }

  // Toggle visibility
  homeControls.classList.toggle("hidden", mode !== "home");
  ownerControls.classList.toggle("hidden", mode !== "owner");
  participantControls.classList.toggle("hidden", mode !== "participant");
  nearbySection.classList.toggle("hidden", mode !== "home");
  routeStatsEl.classList.toggle("hidden", mode === "home");

  if (mode === "owner") {
    enterOwnerMode();
  } else if (mode === "participant") {
    enterParticipantMode();
  } else {
    // Returned to home – refresh nearby
    loadNearbySearches();
  }
}

// ---------------------------------------------------------------------------
// Owner mode – monitors all participant routes
// ---------------------------------------------------------------------------
function enterOwnerMode() {
  if (!currentOperation) return;
  ownerOpTitle.textContent = currentOperation.title;
  routeStatsEl.classList.add("hidden");

  // Poll for participant tracks every 5 seconds
  fetchAllTracks();
  fetchTracksInterval = setInterval(fetchAllTracks, 5000);
}

async function fetchAllTracks() {
  if (!currentOperation) return;
  try {
    const tracks = await apiGet(
      `/operations/${currentOperation.id}/tracks`
    );
    const participants = await apiGet(
      `/operations/${currentOperation.id}/participants`
    );
    participantCountEl.textContent = `${participants.length} participant${participants.length !== 1 ? "s" : ""}`;
    renderParticipantRoutes(tracks);
  } catch (err) {
    console.error("Failed to fetch tracks:", err);
  }
}

function renderParticipantRoutes(tracks) {
  // Group tracks by device_uuid
  const grouped = {};
  for (const t of tracks) {
    if (!grouped[t.device_uuid]) grouped[t.device_uuid] = [];
    grouped[t.device_uuid].push([t.latitude, t.longitude]);
  }

  const uuids = Object.keys(grouped);
  for (let i = 0; i < uuids.length; i++) {
    const uuid = uuids[i];
    const colour = ROUTE_COLOURS[i % ROUTE_COLOURS.length];
    const latlngs = grouped[uuid];

    if (participantLayers[uuid]) {
      participantLayers[uuid].setLatLngs(latlngs);
    } else {
      participantLayers[uuid] = L.polyline(latlngs, {
        color: colour,
        weight: 4,
        opacity: 0.85,
      }).addTo(map);
    }
  }

  // Remove layers for participants that no longer have tracks
  for (const uuid of Object.keys(participantLayers)) {
    if (!grouped[uuid]) {
      map.removeLayer(participantLayers[uuid]);
      delete participantLayers[uuid];
    }
  }
}

// ---------------------------------------------------------------------------
// Participant mode – tracks route and uploads GPS points
// ---------------------------------------------------------------------------
function enterParticipantMode() {
  if (!currentOperation) return;
  participantOpTitle.textContent = currentOperation.title;
  startRoute();

  // Upload pending track points every 10 seconds
  trackUploadInterval = setInterval(uploadPendingPoints, 10000);
}

function startRoute() {
  routeTracking = true;
  routePoints = [];
  totalDistance = 0;
  pendingTrackPoints = [];
  if (routeLine) map.removeLayer(routeLine);
  routeLine = L.polyline([], {
    color: "#f97316",
    weight: 4,
    opacity: 0.85,
  }).addTo(map);
  routeStatsEl.classList.remove("hidden");
  distanceEl.textContent = "0 m";
  pointCountEl.textContent = "0";
}

function stopRoute() {
  routeTracking = false;
  // Upload any remaining points
  uploadPendingPoints();
}

function recordRoutePoint(latlng) {
  if (!routeTracking) return;
  if (routePoints.length > 0) {
    totalDistance += haversineDistance(
      routePoints[routePoints.length - 1],
      latlng
    );
  }
  routePoints.push(latlng);
  routeLine.addLatLng(latlng);
  distanceEl.textContent = formatDistance(totalDistance);
  pointCountEl.textContent = String(routePoints.length);

  // Queue point for upload
  if (currentMode === "participant" && currentOperation) {
    pendingTrackPoints.push({
      device_uuid: deviceUuid,
      latitude: latlng[0],
      longitude: latlng[1],
      accuracy: currentPosition ? currentPosition.accuracy : null,
      recorded_at: new Date().toISOString(),
    });
  }
}

async function uploadPendingPoints() {
  if (!currentOperation || pendingTrackPoints.length === 0) return;
  const batch = pendingTrackPoints.splice(0, pendingTrackPoints.length);
  try {
    await apiPost(`/operations/${currentOperation.id}/tracks`, batch);
  } catch (err) {
    // Re-queue on failure so we don't lose points
    pendingTrackPoints = batch.concat(pendingTrackPoints);
    console.error("Track upload failed:", err);
  }
}

// ---------------------------------------------------------------------------
// GPS position handling
// ---------------------------------------------------------------------------
function showError(message) {
  statusEl.textContent = message;
  statusEl.classList.add("error");
  statusEl.classList.remove("success");
  coordsEl.classList.add("hidden");
}

function updatePosition(position) {
  const { latitude, longitude, accuracy } = position.coords;
  const time = new Date(position.timestamp);
  const latlng = [latitude, longitude];

  currentPosition = { latitude, longitude, accuracy };

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
  if (queue.length > 0) {
    indicator.classList.remove("hidden");
    countEl.textContent = `${queue.length} point${queue.length !== 1 ? "s" : ""} queued offline`;
  } else {
    indicator.classList.add("hidden");
  }
}

// Flush queue periodically and on reconnect
setInterval(flushQueue, 30000);
window.addEventListener("online", flushQueue);

// ─── API helpers ─────────────────────────────────────────────────────────────
async function apiGet(path) {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

async function apiPost(path, body) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return resp.json();
}

// ─── State ───────────────────────────────────────────────────────────────────
let currentView = "home";
let currentSearch = null;
let watchId = null;
let activeSearchId = null; // The search we've joined and are tracking

// Persist active search across page reloads
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

// ─── DOM references ──────────────────────────────────────────────────────────
const headerTitle = document.getElementById("header-title");
const headerBack = document.getElementById("header-back");
const views = {
  home: document.getElementById("view-home"),
  search: document.getElementById("view-search"),
};

// ─── Navigation ──────────────────────────────────────────────────────────────
function showView(name) {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[name].classList.add("active");
  currentView = name;

  if (name === "home") {
    headerTitle.textContent = "Search Operations";
    headerBack.classList.add("hidden");
  } else {
    headerBack.classList.remove("hidden");
  }
}

headerBack.addEventListener("click", () => {
  if (currentView === "search") {
    showView("home");
    stopTracking();
  }
});

// ─── Home view: list searches ────────────────────────────────────────────────
async function loadSearches() {
  const listEl = document.getElementById("search-list");
  const emptyEl = document.getElementById("search-list-empty");
  const loadingEl = document.getElementById("search-list-loading");

  loadingEl.classList.remove("hidden");
  emptyEl.classList.add("hidden");
  listEl.innerHTML = "";

  try {
    const data = await apiGet("/api/searches");
    loadingEl.classList.add("hidden");

    if (!data.searches || data.searches.length === 0) {
      emptyEl.classList.remove("hidden");
  statusEl.textContent = "Tracking GPS";
  statusEl.classList.add("success");
  statusEl.classList.remove("error");
  coordsEl.classList.remove("hidden");

  // Update map marker and accuracy circle
  if (userMarker) {
    userMarker.setLatLng(latlng);
  } else {
    userMarker = L.circleMarker(latlng, {
      radius: 8,
      fillColor: "#38bdf8",
      fillOpacity: 1,
      color: "#fff",
      weight: 2,
    }).addTo(map);
  }

  if (accuracyCircle) {
    accuracyCircle.setLatLng(latlng).setRadius(accuracy);
  } else {
    accuracyCircle = L.circle(latlng, {
      radius: accuracy,
      fillColor: "#38bdf8",
      fillOpacity: 0.1,
      color: "#38bdf8",
      weight: 1,
    }).addTo(map);
  }

  // Zoom to user location on first fix
  if (isFirstPosition) {
    map.setView(latlng, 16);
    isFirstPosition = false;
  }

  // Record point on the route polyline (participant mode)
  recordRoutePoint(latlng);
}

async function checkLocationPermission() {
  if (Capacitor.isNativePlatform()) {
    const permStatus = await Geolocation.requestPermissions();
    return permStatus.location;
  }
  try {
    const permStatus = await Geolocation.checkPermissions();
    return permStatus.location;
  } catch (err) {
    console.warn("Could not check location permissions:", err);
    return "prompt";
  }
}

async function startTracking() {
  try {
    const locationState = await checkLocationPermission();
    if (locationState === "denied") {
      showError(
        "GPS permission denied. Please enable location access in your device settings."
      );
      return;
    }

    data.searches.forEach((search) => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="card-title">${escapeHtml(search.title)}</span>
          <span class="badge badge-${search.status === "active" ? "active" : "closed"}">${escapeHtml(search.status)}</span>
        </div>
        ${search.description ? `<p class="card-description">${escapeHtml(search.description)}</p>` : ""}
        <div class="card-meta mt-1">${formatDate(search.created_at)}</div>
      `;
      card.addEventListener("click", () => openSearch(search.id));
      listEl.appendChild(card);
    });
  } catch (err) {
    loadingEl.classList.add("hidden");
    listEl.innerHTML = `<div class="status-bar error">Unable to load searches. Check your connection.</div>`;
  }
}

// ─── Search detail view ──────────────────────────────────────────────────────
async function openSearch(searchId) {
  showView("search");
  headerTitle.textContent = "Loading…";

  const joinSection = document.getElementById("join-section");
  const trackingSection = document.getElementById("tracking-section");
  const participantList = document.getElementById("participant-list");

  joinSection.classList.remove("hidden");
  trackingSection.classList.add("hidden");
  participantList.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

  try {
    const data = await apiGet(`/api/searches/${searchId}`);
    currentSearch = data.search;

    headerTitle.textContent = escapeHtml(data.search.title);
    document.getElementById("search-title").textContent = data.search.title;
    document.getElementById("search-meta").textContent = `Created ${formatDate(data.search.created_at)}`;
    document.getElementById("search-description").textContent = data.search.description || "";

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
    document.getElementById("search-title").textContent = "Failed to load search";
  }
}

function renderParticipants(participants) {
  const list = document.getElementById("participant-list");
  list.innerHTML = "";

  if (participants.length === 0) {
    list.innerHTML = '<li class="text-muted-sm" style="padding:0.5rem 0;">No participants yet. Be the first to join!</li>';
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

// ─── Join search ─────────────────────────────────────────────────────────────
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

// ─── Leave search ────────────────────────────────────────────────────────────
document.getElementById("leave-btn").addEventListener("click", () => {
  stopTracking();
  clearActiveSession();

  document.getElementById("join-section").classList.remove("hidden");
  document.getElementById("tracking-section").classList.add("hidden");
});

// ─── GPS Tracking ────────────────────────────────────────────────────────────
async function startTracking(searchId) {
  const statusEl = document.getElementById("tracking-status");

  try {
    const perm = await Geolocation.requestPermissions();
    if (perm.location === "denied") {
      statusEl.className = "status-bar error";
      statusEl.innerHTML = "GPS permission denied. Enable location in your device settings.";
      return;
    }

    statusEl.className = "status-bar tracking";
    statusEl.innerHTML = '<span class="pulse"></span><span>GPS tracking active</span>';

    // Get initial position
    try {
      const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
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
          statusEl.innerHTML = '<span class="pulse"></span><span>GPS tracking active</span>';
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

  // Update UI
  document.getElementById("track-lat").textContent = latitude.toFixed(6);
  document.getElementById("track-lng").textContent = longitude.toFixed(6);
  document.getElementById("track-accuracy").textContent = `\u00B1${Math.round(accuracy)} m`;
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

// ─── Utilities ───────────────────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Init ────────────────────────────────────────────────────────────────────
async function init() {
  // Check if we have an active session
  const session = getActiveSession();
  if (session) {
    activeSearchId = session.searchId;
  }

  // Load search list
  await loadSearches();

  // If we were tracking a search, reopen it
  if (session) {
    openSearch(session.searchId);
  }
}

init();
// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function apiGet(path) {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiPost(path, body, auth = false) {
  const headers = { "Content-Type": "application/json" };
  if (auth && googleCredential) {
    headers["Authorization"] = `Bearer ${googleCredential}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiPut(path, body) {
  const headers = { "Content-Type": "application/json" };
  if (googleCredential) {
    headers["Authorization"] = `Bearer ${googleCredential}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiDelete(path) {
  const headers = {};
  if (googleCredential) {
    headers["Authorization"] = `Bearer ${googleCredential}`;
  }
  const res = await fetch(`${API_URL}${path}`, { method: "DELETE", headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Nearby searches
// ---------------------------------------------------------------------------
async function loadNearbySearches() {
  if (!API_URL) {
    nearbyList.innerHTML =
      '<p class="text-muted">API not configured.</p>';
    return;
  }
  try {
    const ops = await apiGet("/operations?status=active");
    renderNearbySearches(ops);
  } catch (err) {
    nearbyList.innerHTML =
      '<p class="text-muted">Could not load searches.</p>';
    console.error(err);
  }
}

function renderNearbySearches(operations) {
  // Clear existing markers
  nearbyMarkers.forEach((m) => map.removeLayer(m));
  nearbyMarkers = [];

  if (!operations || operations.length === 0) {
    nearbyList.innerHTML =
      '<p class="text-muted">No active searches found.</p>';
    return;
  }

  // Sort by distance if we have a position
  if (currentPosition) {
    operations.sort((a, b) => {
      const dA =
        a.latitude != null
          ? haversineDistance(
              [currentPosition.latitude, currentPosition.longitude],
              [a.latitude, a.longitude]
            )
          : Infinity;
      const dB =
        b.latitude != null
          ? haversineDistance(
              [currentPosition.latitude, currentPosition.longitude],
              [b.latitude, b.longitude]
            )
          : Infinity;
      return dA - dB;
    });
  }

  nearbyList.innerHTML = "";
  for (const op of operations) {
    const card = document.createElement("div");
    card.className = "search-card";

    let distText = "";
    if (currentPosition && op.latitude != null) {
      const d = haversineDistance(
        [currentPosition.latitude, currentPosition.longitude],
        [op.latitude, op.longitude]
      );
      distText = ` · ${formatDistance(d)} away`;
    }

    const ownerText = op.owner_name ? ` · by ${op.owner_name}` : "";

    card.innerHTML = `
      <div class="search-card-info">
        <span class="search-card-title">${escapeHtml(op.title)}</span>
        <span class="search-card-meta">${new Date(op.created_at).toLocaleString()}${ownerText}${distText}</span>
      </div>
      <button class="btn-join" data-id="${op.id}">Join</button>
    `;
    nearbyList.appendChild(card);

    // Add marker on map
    if (op.latitude != null && op.longitude != null) {
      const marker = L.marker([op.latitude, op.longitude])
        .addTo(map)
        .bindPopup(`<b>${escapeHtml(op.title)}</b>`);
      nearbyMarkers.push(marker);
    }
  }

  // Attach join handlers
  nearbyList.querySelectorAll(".btn-join").forEach((btn) => {
    btn.addEventListener("click", () => joinSearch(Number(btn.dataset.id)));
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Start search (owner flow)
// ---------------------------------------------------------------------------
startSearchBtn.addEventListener("click", async () => {
  // Require Google sign-in
  if (!googleCredential) {
    // Scroll the sign-in button into view and highlight it so the user knows where to log in
    const authBar = document.getElementById("auth-bar");
    authBar.scrollIntoView({ behavior: "smooth", block: "start" });
    signedOutEl.classList.add("highlight-signin");
    setTimeout(() => signedOutEl.classList.remove("highlight-signin"), 2000);

    if (
      typeof google !== "undefined" &&
      google.accounts &&
      google.accounts.id
    ) {
      google.accounts.id.prompt();
    }
    return;
  }

  // Need current position
  if (!currentPosition) {
    alert("Waiting for GPS position. Please try again in a moment.");
    return;
  }

  const title = prompt("Enter a name for the search operation:");
  if (!title) return;

  try {
    const op = await apiPost(
      "/operations",
      {
        title,
        latitude: currentPosition.latitude,
        longitude: currentPosition.longitude,
      },
      true
    );
    currentOperation = op;
    setMode("owner");
  } catch (err) {
    alert(`Failed to create search: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// End search (owner)
// ---------------------------------------------------------------------------
endSearchBtn.addEventListener("click", async () => {
  if (!currentOperation) return;
  try {
    await apiPut(`/operations/${currentOperation.id}`, {
      status: "completed",
    });
    currentOperation = null;
    setMode("home");
  } catch (err) {
    alert(`Failed to end search: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// Join search (participant flow)
// ---------------------------------------------------------------------------
async function joinSearch(operationId) {
  try {
    const op = await apiGet(`/operations/${operationId}`);
    await apiPost(`/operations/${operationId}/join`, {
      device_uuid: deviceUuid,
      name: googleUser ? googleUser.name : null,
    });
    currentOperation = op;
    setMode("participant");
  } catch (err) {
    if (err.message.includes("Already joined")) {
      // Already joined – just enter participant mode
      const op = await apiGet(`/operations/${operationId}`);
      currentOperation = op;
      setMode("participant");
    } else {
      alert(`Failed to join search: ${err.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Leave search (participant)
// ---------------------------------------------------------------------------
leaveSearchBtn.addEventListener("click", async () => {
  if (!currentOperation) return;
  try {
    await apiDelete(
      `/operations/${currentOperation.id}/leave?device_uuid=${encodeURIComponent(deviceUuid)}`
    );
  } catch (err) {
    console.error("Leave failed:", err);
  }
  currentOperation = null;
  setMode("home");
});

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------
startTracking();
initGoogleSignIn();

// Load nearby searches once we have a position (or after a short delay)
setTimeout(loadNearbySearches, 2000);
// Refresh nearby searches periodically while in home mode
setInterval(() => {
  if (currentMode === "home") loadNearbySearches();
}, 30000);
