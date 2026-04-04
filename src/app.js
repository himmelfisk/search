import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import L from "leaflet";
import { t, getLang, setLang, getAvailableLanguages } from "./i18n.js";

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
let lastKnownPosition = null; // for observation pings

// Owner dashboard state
let dashboardMap = null;
let dashboardLayers = [];
let dashboardRefreshTimer = null;
let dashboardLoadInFlight = false; // guard against overlapping dashboard requests
let ownedSearches = [];
let currentDashboardSearchId = null;
let currentDashboardSearch = null; // current search object from dashboard data
let dashboardMapUserInteracted = false; // true once user pans/zooms the map

const headerTitle = document.getElementById("header-title");
const headerBack = document.getElementById("header-back");
const views = {
  home: document.getElementById("view-home"),
  search: document.getElementById("view-search"),
  dashboard: document.getElementById("view-dashboard"),
};

// ---------------------------------------------------------------------------
// Language selector
// ---------------------------------------------------------------------------

// Single global listener to close the language dropdown on outside clicks
document.addEventListener("click", () => {
  const dd = document.querySelector(".lang-dropdown");
  if (dd) dd.classList.add("hidden");
});

function buildLanguageSelector() {
  const container = document.getElementById("lang-selector");
  if (!container) return;
  container.innerHTML = "";

  const current = getLang();
  const languages = getAvailableLanguages();

  const btn = document.createElement("button");
  btn.className = "lang-btn";
  btn.setAttribute("aria-label", "Language");
  btn.textContent = (languages.find((l) => l.code === current)?.name ?? current).slice(0, 3).toUpperCase();

  const dropdown = document.createElement("div");
  dropdown.className = "lang-dropdown hidden";

  languages.forEach((lang) => {
    const item = document.createElement("button");
    item.className = "lang-option" + (lang.code === current ? " active" : "");
    item.textContent = lang.name;
    item.addEventListener("click", () => {
      setLang(lang.code);
      applyTranslations();
      buildLanguageSelector();
      dropdown.classList.add("hidden");
    });
    dropdown.appendChild(item);
  });

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("hidden");
  });

  container.appendChild(btn);
  container.appendChild(dropdown);
}

// ---------------------------------------------------------------------------
// Apply translations to static DOM elements
// ---------------------------------------------------------------------------
function applyTranslations() {
  // Update html lang attribute
  document.documentElement.lang = getLang();

  // Page title
  document.title = t("appTitle");

  // Header title (only when on home view)
  if (currentView === "home") {
    headerTitle.textContent = t("appTitle");
  }

  // Auth buttons
  document.getElementById("google-signin-btn").textContent = t("signIn");
  document.getElementById("sign-out-btn").textContent = t("signOut");

  // Header action buttons
  const mySearchesBtn = document.getElementById("my-searches-btn");
  if (mySearchesBtn) mySearchesBtn.textContent = t("mySearches");
  const createSearchBtn = document.getElementById("create-search-btn");
  if (createSearchBtn) createSearchBtn.textContent = t("newSearch");

  // Home view empty state
  const emptyP = document.querySelectorAll("#search-list-empty p");
  if (emptyP.length >= 1) emptyP[0].textContent = t("noActiveSearches");
  if (emptyP.length >= 2) emptyP[1].textContent = t("pullToRefresh");

  // Join section
  const joinTitle = document.querySelector("#join-section .section-title");
  if (joinTitle) joinTitle.textContent = t("joinThisSearch");
  const joinDesc = document.querySelector("#join-section .text-muted-sm");
  if (joinDesc) joinDesc.textContent = t("joinDescription");
  const nameLabel = document.querySelector('label[for="join-name"]');
  if (nameLabel) nameLabel.textContent = t("name");
  const nameInput = document.getElementById("join-name");
  if (nameInput) nameInput.placeholder = t("namePlaceholder");
  const phoneLabel = document.querySelector('label[for="join-phone"]');
  if (phoneLabel) phoneLabel.textContent = t("phoneNumber");
  const phoneInput = document.getElementById("join-phone");
  if (phoneInput) phoneInput.placeholder = t("phonePlaceholder");
  const joinBtn = document.getElementById("join-btn");
  if (joinBtn && !joinBtn.disabled) joinBtn.textContent = t("joinSearch");

  // Tracking section
  const trackingLabels = document.querySelectorAll("#tracking-section .coord-card .label");
  if (trackingLabels.length >= 4) {
    trackingLabels[0].textContent = t("latitude");
    trackingLabels[1].textContent = t("longitude");
    trackingLabels[2].textContent = t("accuracy");
    trackingLabels[3].textContent = t("lastUpdate");
  }
  const leaveBtn = document.getElementById("leave-btn");
  if (leaveBtn) leaveBtn.textContent = t("leaveSearch");

  // Participants section title in search view
  const searchParticipantsTitle = document.querySelector("#view-search > .section-title");
  if (searchParticipantsTitle) searchParticipantsTitle.textContent = t("participants");

  // Dashboard stat labels
  const statLabels = document.querySelectorAll("#dashboard-stats .stat-label");
  if (statLabels.length >= 3) {
    statLabels[0].textContent = t("statParticipants");
    statLabels[1].textContent = t("distanceCovered");
    statLabels[2].textContent = t("gpsPoints");
  }
  const teamMembersTitle = document.querySelector("#view-dashboard > .section-title");
  if (teamMembersTitle) teamMembersTitle.textContent = t("teamMembers");
  const switcherLabel = document.querySelector(".dashboard-switcher-label");
  if (switcherLabel) switcherLabel.textContent = t("switchSearch");

  // Create search modal
  const modalTitle = document.querySelector("#create-search-modal .modal-title");
  if (modalTitle) modalTitle.textContent = t("newSearchOperation");
  const titleLabel = document.querySelector('label[for="create-title"]');
  if (titleLabel) titleLabel.textContent = t("title");
  const titleInput = document.getElementById("create-title");
  if (titleInput) titleInput.placeholder = t("titlePlaceholder");
  const descLabel = document.querySelector('label[for="create-description"]');
  if (descLabel) descLabel.textContent = t("descriptionOptional");
  const descInput = document.getElementById("create-description");
  if (descInput) descInput.placeholder = t("descriptionPlaceholder");
  const coverageLabel = document.querySelector('label[for="create-coverage"]');
  if (coverageLabel) coverageLabel.textContent = t("coverageRadius");
  const coverageInput = document.getElementById("create-coverage");
  if (coverageInput) coverageInput.placeholder = t("coverageRadiusPlaceholder");
  const cancelBtn = document.getElementById("create-cancel-btn");
  if (cancelBtn) cancelBtn.textContent = t("cancel");
  const submitBtn = document.getElementById("create-submit-btn");
  if (submitBtn && !submitBtn.disabled) submitBtn.textContent = t("create");

  // Ping button
  const pingBtn = document.getElementById("ping-btn");
  if (pingBtn && !pingBtn.disabled) pingBtn.textContent = t("pingObservation");

  // Edit search modal
  const editModalTitle = document.querySelector("#edit-search-modal .modal-title");
  if (editModalTitle) editModalTitle.textContent = t("editSearch");
  const editCoverageLabel = document.querySelector('label[for="edit-coverage"]');
  if (editCoverageLabel) editCoverageLabel.textContent = t("coverageRadius");
  const editCoverageInput = document.getElementById("edit-coverage");
  if (editCoverageInput) editCoverageInput.placeholder = t("coverageRadiusPlaceholder");
  const editCancelBtn = document.getElementById("edit-cancel-btn");
  if (editCancelBtn) editCancelBtn.textContent = t("cancel");
  const editSubmitBtn = document.getElementById("edit-submit-btn");
  if (editSubmitBtn && !editSubmitBtn.disabled) editSubmitBtn.textContent = t("save");

  // Dashboard edit button
  const dashboardEditBtn = document.getElementById("dashboard-edit-btn");
  if (dashboardEditBtn) dashboardEditBtn.title = t("editSearch");
}

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
    countEl.textContent = t("pointsQueuedOffline", queue.length);
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

async function apiPut(path, body) {
  const headers = { "Content-Type": "application/json" };
  if (googleCredential) {
    headers["Authorization"] = `Bearer ${googleCredential}`;
  }
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
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
    headerTitle.textContent = t("appTitle");
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
            ${isOwned ? `<span class="badge badge-owner">${escapeHtml(t("owner"))}</span>` : ""}
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
    listEl.innerHTML = `<div class="status-bar error">${escapeHtml(t("unableToLoadSearches"))}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Search detail view
// ---------------------------------------------------------------------------
async function openSearch(searchId) {
  showView("search");
  headerTitle.textContent = t("loading");

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
      `${t("created")} ${formatDate(data.search.created_at)}`;
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
    headerTitle.textContent = t("error");
    document.getElementById("search-title").textContent =
      t("failedToLoadSearch");
  }
}

function renderParticipants(participants) {
  const list = document.getElementById("participant-list");
  list.innerHTML = "";

  if (participants.length === 0) {
    list.innerHTML =
      `<li class="text-muted-sm" style="padding:0.5rem 0;">${escapeHtml(t("noParticipantsJoin"))}</li>`;
    return;
  }

  participants.forEach((p) => {
    const name = p.name || t("anonymous");
    const initial = name.charAt(0).toUpperCase();
    const li = document.createElement("li");
    li.className = "participant-item";
    li.innerHTML = `
      <div class="participant-avatar">${escapeHtml(initial)}</div>
      <div class="participant-info">
        <div class="participant-name">${escapeHtml(name)}</div>
        <div class="participant-meta">${t("joined")} ${formatDate(p.joined_at)}</div>
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
  btn.textContent = t("joining");

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
    btn.textContent = t("joinSearch");
    alert(t("failedToJoin"));
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
// Observation Ping
// ---------------------------------------------------------------------------
document.getElementById("ping-btn").addEventListener("click", async () => {
  const btn = document.getElementById("ping-btn");
  if (!lastKnownPosition || !activeSearchId) {
    alert(t("pingNoPosition"));
    return;
  }

  btn.disabled = true;

  try {
    await apiPost("/api/gps/ping", {
      search_id: activeSearchId,
      device_uuid: deviceUUID,
      latitude: lastKnownPosition.latitude,
      longitude: lastKnownPosition.longitude,
    });

    btn.textContent = "✅ " + t("pingSent");
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = t("pingObservation");
    }, 2000);
  } catch {
    btn.disabled = false;
    btn.textContent = t("pingObservation");
    alert(t("pingFailed"));
  }
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
          escapeHtml(t("gpsPermissionDeniedDevice"));
        return;
      }
    } else {
      const perm = await Geolocation.checkPermissions();
      if (perm.location === "denied") {
        statusEl.className = "status-bar error";
        statusEl.innerHTML =
          escapeHtml(t("gpsPermissionDeniedBrowser"));
        return;
      }
    }

    statusEl.className = "status-bar tracking";
    statusEl.innerHTML =
      `<span class="pulse"></span><span>${escapeHtml(t("gpsTrackingActive"))}</span>`;

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
          statusEl.innerHTML = escapeHtml(t("gpsError", err.message));
          return;
        }
        if (position) {
          statusEl.className = "status-bar tracking";
          statusEl.innerHTML =
            `<span class="pulse"></span><span>${escapeHtml(t("gpsTrackingActive"))}</span>`;
          handlePosition(position, searchId);
        }
      }
    );
  } catch (err) {
    statusEl.className = "status-bar error";
    statusEl.innerHTML = escapeHtml(t("unableToAccessGps", err.message));
  }
}

function handlePosition(position, searchId) {
  const { latitude, longitude, accuracy } = position.coords;
  const time = new Date(position.timestamp);

  // Store for observation pings
  lastKnownPosition = { latitude, longitude };

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
  lastKnownPosition = null;
}

// ---------------------------------------------------------------------------
// Owner Dashboard
// ---------------------------------------------------------------------------
const ROUTE_COLORS = [
  "#38bdf8", "#4ade80", "#f97316", "#a78bfa", "#fb7185",
  "#facc15", "#2dd4bf", "#e879f9", "#60a5fa", "#f472b6",
];

// GPS jitter filtering thresholds
const MIN_MOVEMENT_METERS = 2;   // ignore movements smaller than this (GPS noise)
const MAX_MOVEMENT_METERS = 10000; // ignore jumps larger than this (GPS glitch)

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
  headerTitle.textContent = t("dashboard");
  currentDashboardSearchId = searchId;

  // Reset interaction flag so fitBounds runs on first load for this search
  // (loadDashboardMapState inside renderDashboardMap will re-enable it if saved state exists)
  dashboardMapUserInteracted = false;

  // Restore saved view for this search if the map already exists
  if (dashboardMap) {
    const saved = loadDashboardMapState();
    if (saved) {
      dashboardMap.setView([saved.lat, saved.lng], saved.zoom);
      dashboardMapUserInteracted = true;
    }
  }

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

  // Auto-refresh every 5 seconds for near real-time updates
  stopDashboardRefresh();
  dashboardRefreshTimer = setInterval(() => {
    if (currentView === "dashboard" && currentDashboardSearchId) {
      loadDashboardData(currentDashboardSearchId);
    }
  }, 5000);
}

function stopDashboardRefresh() {
  if (dashboardRefreshTimer) {
    clearInterval(dashboardRefreshTimer);
    dashboardRefreshTimer = null;
  }
  dashboardLoadInFlight = false;
}

async function loadDashboardData(searchId) {
  if (dashboardLoadInFlight) return; // skip if a previous request is still pending
  dashboardLoadInFlight = true;
  try {
    const data = await apiGetAuth(`/api/searches/${searchId}/dashboard`);
    renderDashboard(data);
  } catch (err) {
    // Stop polling on auth / ownership errors – no point retrying automatically
    if (err.status === 401 || err.status === 403) {
      stopDashboardRefresh();
    }
    document.getElementById("dashboard-title").textContent = t("errorLoadingDashboard");
    document.getElementById("dashboard-meta").textContent = err.message;
  } finally {
    dashboardLoadInFlight = false;
  }
}

function renderDashboard(data) {
  const { search, participants, tracks, pings } = data;

  currentDashboardSearch = search;

  headerTitle.textContent = escapeHtml(search.title);
  document.getElementById("dashboard-title").textContent = search.title;
  document.getElementById("dashboard-meta").textContent =
    `${t("created")} ${formatDate(search.created_at)} · ${t("status")}: ${search.status}`;

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
      if (d > MIN_MOVEMENT_METERS && d < MAX_MOVEMENT_METERS) {
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

  // Coverage radius from search settings (in meters)
  const coverageRadius = search.coverage_radius || 10;

  // Render map
  renderDashboardMap(tracksByDevice, participantMap, coverageRadius, pings || []);

  // Render legend
  renderDashboardLegend(tracksByDevice, participantMap);

  // Render participant list with details
  renderDashboardParticipants(participants, deviceDistances);
}

function saveDashboardMapState() {
  if (!dashboardMap || !currentDashboardSearchId) return;
  const center = dashboardMap.getCenter();
  sessionStorage.setItem(
    `map_state_${currentDashboardSearchId}`,
    JSON.stringify({ lat: center.lat, lng: center.lng, zoom: dashboardMap.getZoom() })
  );
}

function loadDashboardMapState() {
  if (!currentDashboardSearchId) return null;
  try {
    return JSON.parse(sessionStorage.getItem(`map_state_${currentDashboardSearchId}`));
  } catch {
    return null;
  }
}

function renderDashboardMap(tracksByDevice, participantMap, coverageRadius, pings) {
  const mapEl = document.getElementById("dashboard-map");

  if (!dashboardMap) {
    const saved = loadDashboardMapState();
    const initCenter = saved ? [saved.lat, saved.lng] : [59.91, 10.75];
    const initZoom = saved ? saved.zoom : 13;
    if (saved) dashboardMapUserInteracted = true;

    dashboardMap = L.map(mapEl, {
      zoomControl: true,
      attributionControl: false,
    }).setView(initCenter, initZoom);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
    }).addTo(dashboardMap);

    // Attribution in corner
    L.control.attribution({ prefix: false, position: "bottomright" })
      .addAttribution('© <a href="https://www.openstreetmap.org/copyright">OSM</a>')
      .addTo(dashboardMap);

    // Track user interactions to avoid overriding manual zoom/pan
    dashboardMap.on("zoomend moveend", () => {
      dashboardMapUserInteracted = true;
      saveDashboardMapState();
    });
  }

  // Clear existing layers
  dashboardLayers.forEach((layer) => dashboardMap.removeLayer(layer));
  dashboardLayers = [];

  const allBounds = [];
  let colorIdx = 0;

  // Convert coverage radius in meters to pixel weight at current zoom.
  // 156543.03392 = Earth's equatorial circumference (m) / 256 pixels (tile size at zoom 0).
  // We use the map center latitude for the cosine correction.
  // The line weight represents the diameter (2 * radius).
  const MIN_LINE_WEIGHT = 4;
  const MAX_LINE_WEIGHT = 200;

  function getLineWeight() {
    const zoom = dashboardMap.getZoom();
    const lat = dashboardMap.getCenter().lat;
    const metersPerPixel = 156543.03392 * Math.cos((lat * Math.PI) / 180) / Math.pow(2, zoom);
    const diameterPixels = (coverageRadius * 2) / metersPerPixel;
    return Math.max(MIN_LINE_WEIGHT, Math.min(diameterPixels, MAX_LINE_WEIGHT));
  }

  const lineWeight = getLineWeight();

  Object.entries(tracksByDevice).forEach(([uuid, points]) => {
    if (points.length === 0) return;

    const color = ROUTE_COLORS[colorIdx % ROUTE_COLORS.length];
    colorIdx++;

    const participant = participantMap[uuid];
    const name = (participant && participant.name) || t("anonymous");

    // Draw polyline – yellow at 60% transparency to show "covered" area
    const latlngs = points.map((p) => [p.latitude, p.longitude]);
    const polyline = L.polyline(latlngs, {
      color: "#facc15",
      weight: lineWeight,
      opacity: 0.6,
      lineCap: "round",
      lineJoin: "round",
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

    marker.bindPopup(`<strong>${escapeHtml(name)}</strong><br/>${t("lastUpdate")}: ${formatDate(latest.recorded_at)}`);
    dashboardLayers.push(marker);

    allBounds.push(...latlngs);
  });

  // Render observation pings as red markers
  if (pings && pings.length > 0) {
    const pingIcon = L.divIcon({
      className: "ping-marker",
      html: '<div class="ping-marker-inner">📍</div>',
      iconSize: [28, 28],
      iconAnchor: [14, 28],
      popupAnchor: [0, -28],
    });

    pings.forEach((ping) => {
      const pingName = ping.participant_name || t("anonymous");
      const pingMarker = L.marker([ping.latitude, ping.longitude], { icon: pingIcon }).addTo(dashboardMap);
      pingMarker.bindPopup(
        `<strong>${escapeHtml(t("observation"))}</strong><br/>` +
        `${escapeHtml(pingName)}<br/>` +
        `${ping.latitude.toFixed(6)}, ${ping.longitude.toFixed(6)}<br/>` +
        `${formatDate(ping.recorded_at)}`
      );
      dashboardLayers.push(pingMarker);
      allBounds.push([ping.latitude, ping.longitude]);
    });
  }

  // Fit bounds only on initial load; preserve user's zoom/pan on refreshes
  if (allBounds.length > 0 && !dashboardMapUserInteracted) {
    dashboardMap.fitBounds(allBounds, { padding: [30, 30], maxZoom: 16 });
  }

  // Force Leaflet to recalculate size (needed when container was hidden)
  setTimeout(() => dashboardMap.invalidateSize(), 100);

  // Update line weight when zoom changes
  dashboardMap.off("zoomend.coverage");
  dashboardMap.on("zoomend.coverage", () => {
    const newWeight = getLineWeight();
    dashboardLayers.forEach((layer) => {
      if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
        layer.setStyle({ weight: newWeight });
      }
    });
  });
}

function renderDashboardLegend(tracksByDevice, participantMap) {
  const legendEl = document.getElementById("dashboard-legend");
  legendEl.innerHTML = "";

  let colorIdx = 0;
  Object.entries(tracksByDevice).forEach(([uuid]) => {
    const color = ROUTE_COLORS[colorIdx % ROUTE_COLORS.length];
    colorIdx++;

    const participant = participantMap[uuid];
    const name = (participant && participant.name) || t("anonymous");

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
      `<li class="text-muted-sm" style="padding:0.5rem 0;">${escapeHtml(t("noParticipants"))}</li>`;
    return;
  }

  participants.forEach((p) => {
    const name = p.name || t("anonymous");
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
        <div class="participant-meta">${t("joined")} ${formatDate(p.joined_at)} · ${formatDistance(dist)}</div>
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
    document.getElementById("create-coverage").value = "10";
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
  const coverageStr = document.getElementById("create-coverage").value.trim();
  const coverageRadius = Math.max(1, Math.min(500, parseInt(coverageStr, 10) || 10));
  const errorEl = document.getElementById("create-error");
  const btn = document.getElementById("create-submit-btn");

  if (!title) {
    errorEl.textContent = t("titleRequired");
    errorEl.classList.remove("hidden");
    return;
  }

  btn.disabled = true;
  btn.textContent = t("creating");
  errorEl.classList.add("hidden");

  try {
    await apiPost(
      "/api/searches",
      { title, description: description || undefined, coverage_radius: coverageRadius },
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
        ? t("mustBeSignedIn")
        : t("failedToCreateSearch", err.message);
    errorEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = t("create");
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
// Edit Search
// ---------------------------------------------------------------------------
function openEditSearch() {
  if (!currentDashboardSearch) return;
  const modal = document.getElementById("edit-search-modal");
  if (modal) {
    modal.classList.remove("hidden");
    document.getElementById("edit-coverage").value = currentDashboardSearch.coverage_radius || 10;
    document.getElementById("edit-error").classList.add("hidden");
  }
}

function closeEditSearch() {
  const modal = document.getElementById("edit-search-modal");
  if (modal) modal.classList.add("hidden");
}

async function submitEditSearch() {
  if (!currentDashboardSearchId) return;
  const coverageStr = document.getElementById("edit-coverage").value.trim();
  const coverageRadius = Math.max(1, Math.min(500, parseInt(coverageStr, 10) || 10));
  const errorEl = document.getElementById("edit-error");
  const btn = document.getElementById("edit-submit-btn");

  btn.disabled = true;
  btn.textContent = t("saving");
  errorEl.classList.add("hidden");

  try {
    await apiPut(`/api/searches/${currentDashboardSearchId}`, { coverage_radius: coverageRadius });
    closeEditSearch();
    // Reload dashboard data to reflect changes
    await loadDashboardData(currentDashboardSearchId);
  } catch (err) {
    errorEl.textContent = t("failedToUpdateSearch", err.message);
    errorEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = t("save");
  }
}

// Wire up edit-search UI
document.getElementById("dashboard-edit-btn")?.addEventListener("click", openEditSearch);
document.getElementById("edit-cancel-btn")?.addEventListener("click", closeEditSearch);
document.getElementById("edit-submit-btn")?.addEventListener("click", submitEditSearch);

// Close modal on backdrop click
document.getElementById("edit-search-modal")?.addEventListener("click", (e) => {
  if (e.target.id === "edit-search-modal") closeEditSearch();
});

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------
async function init() {
  // Set up language selector & apply translations
  buildLanguageSelector();
  applyTranslations();

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
