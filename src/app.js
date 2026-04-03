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
const userAvatarEl = document.getElementById("user-avatar");
const userNameEl = document.getElementById("user-name");
const signOutBtn = document.getElementById("sign-out-btn");

// ---------------------------------------------------------------------------
// View navigation state
// ---------------------------------------------------------------------------
let currentView = "home";
let currentSearch = null;
let watchId = null;
let activeSearchId = null;

const headerTitle = document.getElementById("header-title");
const headerBack = document.getElementById("header-back");
const views = {
  home: document.getElementById("view-home"),
  search: document.getElementById("view-search"),
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
}

function updateCreateButton() {
  // Button is always visible – no hiding logic needed.
  // The openCreateSearch function handles the sign-in prompt.
}

function signOut() {
  googleCredential = null;
  googleUser = null;
  isAdmin = false;
  localStorage.removeItem("google_credential");
  signedInEl.classList.add("hidden");
  signedOutEl.classList.remove("hidden");
  updateCreateButton();
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
    loadingEl.classList.add("hidden");

    if (!data.searches || data.searches.length === 0) {
      emptyEl.classList.remove("hidden");
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
      "/api/admin/searches",
      { title, description: description || undefined },
      true
    );
    closeCreateSearch();
    await loadSearches();
  } catch (err) {
    errorEl.textContent =
      err.status === 403
        ? "Your account does not have admin access to create searches."
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
