import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import L from "leaflet";

// Fix Leaflet default marker icon paths when bundled
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const statusEl = document.getElementById("status");
const coordsEl = document.getElementById("coordinates");
const latEl = document.getElementById("lat");
const lngEl = document.getElementById("lng");
const accuracyEl = document.getElementById("accuracy");
const timestampEl = document.getElementById("timestamp");

// Map setup – start with a world view; will zoom to user position once acquired
const map = L.map("map").setView([62.0, 15.0], 5);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 19,
}).addTo(map);

let userMarker = null;
let accuracyCircle = null;
let isFirstPosition = true;

// Route tracking state
let routeTracking = false;
let routePoints = [];
let routeLine = null;
let totalDistance = 0;

const trackBtn = document.getElementById("track-btn");
const distanceEl = document.getElementById("distance");
const pointCountEl = document.getElementById("point-count");
const routeStatsEl = document.getElementById("route-stats");

function haversineDistance([lat1, lon1], [lat2, lon2]) {
  const R = 6371000; // Earth radius in metres
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

function startRoute() {
  routeTracking = true;
  routePoints = [];
  totalDistance = 0;
  if (routeLine) {
    map.removeLayer(routeLine);
  }
  routeLine = L.polyline([], {
    color: "#f97316",
    weight: 4,
    opacity: 0.85,
  }).addTo(map);
  trackBtn.textContent = "Stop route";
  trackBtn.classList.add("active");
  routeStatsEl.classList.remove("hidden");
  distanceEl.textContent = "0 m";
  pointCountEl.textContent = "0";
}

function stopRoute() {
  routeTracking = false;
  trackBtn.textContent = "Start route";
  trackBtn.classList.remove("active");
}

trackBtn.addEventListener("click", () => {
  if (routeTracking) {
    stopRoute();
  } else {
    startRoute();
  }
});

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
}

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

  latEl.textContent = latitude.toFixed(6);
  lngEl.textContent = longitude.toFixed(6);
  accuracyEl.textContent = `\u00B1${Math.round(accuracy)} m`;
  timestampEl.textContent = time.toLocaleTimeString();

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

  // Record point on the route polyline
  recordRoutePoint(latlng);
}

async function checkLocationPermission() {
  if (Capacitor.isNativePlatform()) {
    const permStatus = await Geolocation.requestPermissions();
    return permStatus.location;
  }

  // On web, requestPermissions() is not supported. Use checkPermissions()
  // when the Permissions API is available; otherwise let getCurrentPosition()
  // trigger the browser's own permission prompt.
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

    statusEl.textContent = "Acquiring position\u2026";

    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
    });
    updatePosition(pos);

    await Geolocation.watchPosition(
      { enableHighAccuracy: true },
      (position, err) => {
        if (err) {
          showError(`GPS error: ${err.message}`);
          return;
        }
        if (position) {
          updatePosition(position);
        }
      }
    );
  } catch (err) {
    showError(`Unable to access GPS: ${err.message}`);
  }
}

startTracking();
