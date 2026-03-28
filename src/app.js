import { Geolocation } from "@capacitor/geolocation";

const statusEl = document.getElementById("status");
const coordsEl = document.getElementById("coordinates");
const latEl = document.getElementById("lat");
const lngEl = document.getElementById("lng");
const accuracyEl = document.getElementById("accuracy");
const timestampEl = document.getElementById("timestamp");

function showError(message) {
  statusEl.textContent = message;
  statusEl.classList.add("error");
  statusEl.classList.remove("success");
  coordsEl.classList.add("hidden");
}

function updatePosition(position) {
  const { latitude, longitude, accuracy } = position.coords;
  const time = new Date(position.timestamp);

  latEl.textContent = latitude.toFixed(6);
  lngEl.textContent = longitude.toFixed(6);
  accuracyEl.textContent = `\u00B1${Math.round(accuracy)} m`;
  timestampEl.textContent = time.toLocaleTimeString();

  statusEl.textContent = "Tracking GPS";
  statusEl.classList.add("success");
  statusEl.classList.remove("error");
  coordsEl.classList.remove("hidden");
}

async function startTracking() {
  try {
    const permStatus = await Geolocation.requestPermissions();

    if (permStatus.location === "denied") {
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
