# Search Operations App

## Overview

This app is used for coordinating search operations. It supports **Android**, **iOS**, and **Web** platforms.

## Features

### Create Search Operations
- Administrators can create search operations either **in the app** or **via the web**.

### Search & Volunteer
- People participating should be able to search for active operations and **volunteer / sign up** to join them.

### GPS Tracking
- The app continuously sends **GPS information** so that administrators can see which areas have been searched.
- If possible, the app should **identify which user** is sending the GPS information, even when they don't have cell reception (e.g. by queuing location data locally and uploading it once connectivity is restored, tagged with a user or device identifier).

### Push Notifications
- Administrators should be able to send **push notifications** to all participants of an operation.
- A notification icon could be placed in the **top right corner** of the app for easy access.

---

## GPS Device Identifiers

> *Do GPS on phones and other devices send a unique ID? So that I don't need to track the user itself?*

GPS hardware itself does **not** transmit a unique ID — it is a receive-only system that calculates a position from satellite signals. However, every phone and device does have identifiers that can be used:

| Identifier | Description |
|---|---|
| **Android ID / SSAID** | A per-app, per-device identifier on Android. |
| **IDFV (Identifier for Vendor)** | A per-vendor device identifier on iOS. |
| **App-generated UUID** | A UUID generated and stored by the app on first launch. Works on all platforms and does not depend on OS-level identifiers. |

The recommended approach is to generate a **random UUID on first install** and persist it locally. This avoids privacy concerns with hardware IDs and works consistently across Android, iOS, and web. GPS coordinates can then be tagged with this UUID and queued locally when offline, so that even without cell reception the data can be uploaded later and attributed to the correct device/user.

---

## Feasibility Analysis

| Feature | Feasible? | Notes |
|---|---|---|
| **Cross-platform (Android, iOS, Web)** | ✅ Yes | Frameworks such as Flutter, React Native, or Kotlin Multiplatform make this straightforward. A shared backend (e.g. Firebase, Supabase, or a custom API) can serve all three platforms. |
| **Create search operations (app & web)** | ✅ Yes | Standard CRUD functionality backed by a REST or GraphQL API. Both mobile and web clients can call the same endpoints. |
| **Search for operations & sign up** | ✅ Yes | A searchable list/map of operations with a sign-up action is standard app functionality. |
| **Continuous GPS tracking** | ✅ Yes | Android and iOS both support background location services. On the web, the Geolocation API can be used while the page is open. Background tracking on mobile requires appropriate permissions and battery-conscious design. |
| **Identify user when offline** | ✅ Yes | GPS data can be stored locally (SQLite, shared preferences, or IndexedDB on web) with a device UUID. When connectivity is restored, the queued data is uploaded to the server with the identifier attached. |
| **Push notifications to all participants** | ✅ Yes | Firebase Cloud Messaging (FCM) supports Android, iOS, and web push. Administrators can trigger a notification via the backend to a topic or user segment. |
| **Notification icon in top right corner** | ✅ Yes | This is a UI design choice and can be implemented on all platforms with a bell/badge icon that shows recent notifications. |

### Summary

All listed features are **feasible to implement** with current technologies. The main areas that require extra attention are:

1. **Background GPS on mobile** — both Android and iOS impose restrictions on background location access. Proper permissions, battery optimization handling, and user consent flows are required.
2. **Offline GPS queuing** — a reliable local storage and sync mechanism is needed so no location data is lost when the device is offline.
3. **Privacy & consent** — continuous location tracking and device identification must comply with platform guidelines (Google Play, App Store) and regulations (GDPR, etc.). Users must give explicit consent.
