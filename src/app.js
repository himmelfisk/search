import { Geolocation } from "@capacitor/geolocation";

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
