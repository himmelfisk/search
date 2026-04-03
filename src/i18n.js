// ---------------------------------------------------------------------------
// Internationalisation (i18n) module
// ---------------------------------------------------------------------------
// Add new languages by adding a new key to the `translations` object below.
// Each language must provide values for every key used in the app.
// ---------------------------------------------------------------------------

const translations = {
  no: {
    // -- General --
    appTitle: "Søkeoperasjoner",
    loading: "Laster…",
    error: "Feil",
    cancel: "Avbryt",
    create: "Opprett",
    anonymous: "Anonym",

    // -- Auth --
    signIn: "Logg inn",
    signOut: "Logg ut",

    // -- Header buttons --
    mySearches: "📡 Mine søk",
    newSearch: "＋ Nytt søk",

    // -- Home view --
    noActiveSearches: "Ingen aktive søkeoperasjoner akkurat nå.",
    pullToRefresh: "Dra ned for å oppdatere, eller sjekk igjen senere.",
    unableToLoadSearches: "Kunne ikke laste søk. Sjekk tilkoblingen din.",

    // -- Search detail --
    joinThisSearch: "Bli med i dette søket",
    joinDescription: "Ingen konto nødvendig. Del gjerne navn og telefonnummer slik at teamet kan nå deg.",
    name: "Navn",
    namePlaceholder: "Ditt navn (valgfritt)",
    phoneNumber: "Telefonnummer",
    phonePlaceholder: "Telefon (valgfritt)",
    joinSearch: "Bli med i søk",
    joining: "Blir med…",
    failedToJoin: "Kunne ikke bli med. Vennligst prøv igjen.",
    leaveSearch: "Forlat søk",
    participants: "Deltakere",
    noParticipantsJoin: "Ingen deltakere ennå. Bli den første!",
    noParticipants: "Ingen deltakere ennå.",
    joined: "Ble med",
    created: "Opprettet",
    failedToLoadSearch: "Kunne ikke laste søk",

    // -- GPS / Tracking --
    gpsTrackingActive: "GPS-sporing aktiv",
    latitude: "Breddegrad",
    longitude: "Lengdegrad",
    accuracy: "Nøyaktighet",
    lastUpdate: "Sist oppdatert",
    pointsQueuedOffline: (n) => `${n} punkt${n !== 1 ? "er" : ""} i kø offline`,
    gpsPermissionDeniedDevice: "GPS-tillatelse avvist. Aktiver posisjon i enhetsinnstillingene.",
    gpsPermissionDeniedBrowser: "GPS-tillatelse avvist. Aktiver posisjon i nettleserinnstillingene.",
    gpsError: (msg) => `GPS-feil: ${msg}`,
    unableToAccessGps: (msg) => `Kan ikke nå GPS: ${msg}`,

    // -- Dashboard --
    dashboard: "Dashbord",
    switchSearch: "Bytt søk:",
    statParticipants: "Deltakere",
    distanceCovered: "Tilbakelagt avstand",
    gpsPoints: "GPS-punkter",
    teamMembers: "Teammedlemmer",
    errorLoadingDashboard: "Feil ved lasting av dashbord",
    status: "Status",
    owner: "Eier",

    // -- Create search modal --
    newSearchOperation: "Ny søkeoperasjon",
    title: "Tittel",
    titlePlaceholder: "f.eks. Savnet person – Nordmarka",
    descriptionOptional: "Beskrivelse (valgfritt)",
    descriptionPlaceholder: "Tilleggsdetaljer…",
    titleRequired: "Tittel er påkrevd.",
    creating: "Oppretter…",
    mustBeSignedIn: "Du må være logget inn for å opprette søk.",
    failedToCreateSearch: (msg) => `Kunne ikke opprette søk: ${msg}`,
  },

  sv: {
    appTitle: "Sökoperationer",
    loading: "Laddar…",
    error: "Fel",
    cancel: "Avbryt",
    create: "Skapa",
    anonymous: "Anonym",

    signIn: "Logga in",
    signOut: "Logga ut",

    mySearches: "📡 Mina sökningar",
    newSearch: "＋ Ny sökning",

    noActiveSearches: "Inga aktiva sökoperationer just nu.",
    pullToRefresh: "Dra ned för att uppdatera eller kolla igen senare.",
    unableToLoadSearches: "Kunde inte ladda sökningar. Kontrollera din anslutning.",

    joinThisSearch: "Gå med i denna sökning",
    joinDescription: "Inget konto behövs. Dela gärna ditt namn och telefonnummer så att teamet kan nå dig.",
    name: "Namn",
    namePlaceholder: "Ditt namn (valfritt)",
    phoneNumber: "Telefonnummer",
    phonePlaceholder: "Telefon (valfritt)",
    joinSearch: "Gå med i sökning",
    joining: "Går med…",
    failedToJoin: "Kunde inte gå med. Försök igen.",
    leaveSearch: "Lämna sökning",
    participants: "Deltagare",
    noParticipantsJoin: "Inga deltagare ännu. Bli den första!",
    noParticipants: "Inga deltagare ännu.",
    joined: "Gick med",
    created: "Skapad",
    failedToLoadSearch: "Kunde inte ladda sökning",

    gpsTrackingActive: "GPS-spårning aktiv",
    latitude: "Latitud",
    longitude: "Longitud",
    accuracy: "Noggrannhet",
    lastUpdate: "Senast uppdaterad",
    pointsQueuedOffline: (n) => `${n} punkt${n !== 1 ? "er" : ""} köade offline`,
    gpsPermissionDeniedDevice: "GPS-behörighet nekad. Aktivera plats i enhetsinställningarna.",
    gpsPermissionDeniedBrowser: "GPS-behörighet nekad. Aktivera plats i webbläsarinställningarna.",
    gpsError: (msg) => `GPS-fel: ${msg}`,
    unableToAccessGps: (msg) => `Kan inte nå GPS: ${msg}`,

    dashboard: "Kontrollpanel",
    switchSearch: "Byt sökning:",
    statParticipants: "Deltagare",
    distanceCovered: "Tillryggalagd sträcka",
    gpsPoints: "GPS-punkter",
    teamMembers: "Teammedlemmar",
    errorLoadingDashboard: "Fel vid laddning av kontrollpanel",
    status: "Status",
    owner: "Ägare",

    newSearchOperation: "Ny sökoperation",
    title: "Titel",
    titlePlaceholder: "t.ex. Försvunnen person – Nordmarka",
    descriptionOptional: "Beskrivning (valfritt)",
    descriptionPlaceholder: "Ytterligare detaljer…",
    titleRequired: "Titel krävs.",
    creating: "Skapar…",
    mustBeSignedIn: "Du måste vara inloggad för att skapa sökningar.",
    failedToCreateSearch: (msg) => `Kunde inte skapa sökning: ${msg}`,
  },

  da: {
    appTitle: "Søgeoperationer",
    loading: "Indlæser…",
    error: "Fejl",
    cancel: "Annuller",
    create: "Opret",
    anonymous: "Anonym",

    signIn: "Log ind",
    signOut: "Log ud",

    mySearches: "📡 Mine søgninger",
    newSearch: "＋ Ny søgning",

    noActiveSearches: "Ingen aktive søgeoperationer lige nu.",
    pullToRefresh: "Træk ned for at opdatere, eller tjek igen senere.",
    unableToLoadSearches: "Kunne ikke indlæse søgninger. Tjek din forbindelse.",

    joinThisSearch: "Deltag i denne søgning",
    joinDescription: "Ingen konto nødvendig. Del gerne dit navn og telefonnummer, så teamet kan kontakte dig.",
    name: "Navn",
    namePlaceholder: "Dit navn (valgfrit)",
    phoneNumber: "Telefonnummer",
    phonePlaceholder: "Telefon (valgfrit)",
    joinSearch: "Deltag i søgning",
    joining: "Deltager…",
    failedToJoin: "Kunne ikke deltage. Prøv venligst igen.",
    leaveSearch: "Forlad søgning",
    participants: "Deltagere",
    noParticipantsJoin: "Ingen deltagere endnu. Vær den første!",
    noParticipants: "Ingen deltagere endnu.",
    joined: "Deltog",
    created: "Oprettet",
    failedToLoadSearch: "Kunne ikke indlæse søgning",

    gpsTrackingActive: "GPS-sporing aktiv",
    latitude: "Breddegrad",
    longitude: "Længdegrad",
    accuracy: "Nøjagtighed",
    lastUpdate: "Sidst opdateret",
    pointsQueuedOffline: (n) => `${n} punkt${n !== 1 ? "er" : ""} i kø offline`,
    gpsPermissionDeniedDevice: "GPS-tilladelse nægtet. Aktivér placering i enhedsindstillingerne.",
    gpsPermissionDeniedBrowser: "GPS-tilladelse nægtet. Aktivér placering i browserindstillingerne.",
    gpsError: (msg) => `GPS-fejl: ${msg}`,
    unableToAccessGps: (msg) => `Kan ikke tilgå GPS: ${msg}`,

    dashboard: "Dashboard",
    switchSearch: "Skift søgning:",
    statParticipants: "Deltagere",
    distanceCovered: "Tilbagelagt afstand",
    gpsPoints: "GPS-punkter",
    teamMembers: "Teammedlemmer",
    errorLoadingDashboard: "Fejl ved indlæsning af dashboard",
    status: "Status",
    owner: "Ejer",

    newSearchOperation: "Ny søgeoperation",
    title: "Titel",
    titlePlaceholder: "f.eks. Savnet person – Nordmarka",
    descriptionOptional: "Beskrivelse (valgfrit)",
    descriptionPlaceholder: "Yderligere detaljer…",
    titleRequired: "Titel er påkrævet.",
    creating: "Opretter…",
    mustBeSignedIn: "Du skal være logget ind for at oprette søgninger.",
    failedToCreateSearch: (msg) => `Kunne ikke oprette søgning: ${msg}`,
  },

  en: {
    appTitle: "Search Operations",
    loading: "Loading…",
    error: "Error",
    cancel: "Cancel",
    create: "Create",
    anonymous: "Anonymous",

    signIn: "Sign in",
    signOut: "Sign out",

    mySearches: "📡 My Searches",
    newSearch: "＋ New search",

    noActiveSearches: "No active search operations right now.",
    pullToRefresh: "Pull down to refresh or check back later.",
    unableToLoadSearches: "Unable to load searches. Check your connection.",

    joinThisSearch: "Join this search",
    joinDescription: "No account needed. Optionally share your name and phone number so the team can reach you.",
    name: "Name",
    namePlaceholder: "Your name (optional)",
    phoneNumber: "Phone number",
    phonePlaceholder: "Phone (optional)",
    joinSearch: "Join Search",
    joining: "Joining…",
    failedToJoin: "Failed to join. Please try again.",
    leaveSearch: "Leave Search",
    participants: "Participants",
    noParticipantsJoin: "No participants yet. Be the first to join!",
    noParticipants: "No participants yet.",
    joined: "Joined",
    created: "Created",
    failedToLoadSearch: "Failed to load search",

    gpsTrackingActive: "GPS tracking active",
    latitude: "Latitude",
    longitude: "Longitude",
    accuracy: "Accuracy",
    lastUpdate: "Last update",
    pointsQueuedOffline: (n) => `${n} point${n !== 1 ? "s" : ""} queued offline`,
    gpsPermissionDeniedDevice: "GPS permission denied. Enable location in your device settings.",
    gpsPermissionDeniedBrowser: "GPS permission denied. Enable location in your browser settings.",
    gpsError: (msg) => `GPS error: ${msg}`,
    unableToAccessGps: (msg) => `Unable to access GPS: ${msg}`,

    dashboard: "Dashboard",
    switchSearch: "Switch search:",
    statParticipants: "Participants",
    distanceCovered: "Distance covered",
    gpsPoints: "GPS points",
    teamMembers: "Team Members",
    errorLoadingDashboard: "Error loading dashboard",
    status: "Status",
    owner: "Owner",

    newSearchOperation: "New Search Operation",
    title: "Title",
    titlePlaceholder: "e.g. Missing person – Nordmarka",
    descriptionOptional: "Description (optional)",
    descriptionPlaceholder: "Additional details…",
    titleRequired: "Title is required.",
    creating: "Creating…",
    mustBeSignedIn: "You must be signed in to create searches.",
    failedToCreateSearch: (msg) => `Failed to create search: ${msg}`,
  },
};

// Language metadata for the selector UI
const languageNames = {
  no: "Norsk",
  sv: "Svenska",
  da: "Dansk",
  en: "English",
};

const LANG_KEY = "app_language";
const DEFAULT_LANG = "no";

let currentLang = localStorage.getItem(LANG_KEY) || DEFAULT_LANG;

/**
 * Get a translated string by key.
 * If the key maps to a function, pass `...args` to it.
 */
export function t(key, ...args) {
  const dict = translations[currentLang] || translations[DEFAULT_LANG];
  const val = dict[key];
  if (typeof val === "function") return val(...args);
  return val ?? key;
}

/** Return the current language code. */
export function getLang() {
  return currentLang;
}

/** Switch language and persist the choice. */
export function setLang(lang) {
  if (!translations[lang]) return;
  currentLang = lang;
  localStorage.setItem(LANG_KEY, lang);
}

/** Return { code, name } for every available language. */
export function getAvailableLanguages() {
  return Object.keys(translations).map((code) => ({
    code,
    name: languageNames[code] || code,
  }));
}
