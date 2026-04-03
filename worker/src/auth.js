/**
 * Google ID token verification for Cloudflare Workers using Web Crypto API.
 */

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/**
 * Decode a base64url-encoded string to a Uint8Array.
 */
function base64urlToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decode a base64url-encoded string to a UTF-8 string.
 */
function base64urlToString(str) {
  return new TextDecoder().decode(base64urlToBytes(str));
}

/**
 * Verify a Google ID token (JWT) and return the decoded payload.
 *
 * - Fetches Google's public JWKS keys
 * - Verifies the RSA-SHA256 signature
 * - Validates issuer, audience, and expiration
 *
 * @param {string} idToken - The raw JWT string
 * @param {string} clientId - Expected Google OAuth client ID
 * @returns {Promise<object>} The decoded JWT payload
 */
export async function verifyGoogleToken(idToken, clientId) {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }

  const header = JSON.parse(base64urlToString(parts[0]));
  const payload = JSON.parse(base64urlToString(parts[1]));

  // Validate issuer
  if (
    payload.iss !== "accounts.google.com" &&
    payload.iss !== "https://accounts.google.com"
  ) {
    throw new Error("Invalid issuer");
  }

  // Validate audience
  if (payload.aud !== clientId) {
    throw new Error("Invalid audience");
  }

  // Validate expiration
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }

  // Fetch Google's public keys
  const resp = await fetch(GOOGLE_CERTS_URL);
  if (!resp.ok) {
    throw new Error("Failed to fetch Google public keys");
  }
  const { keys } = await resp.json();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    throw new Error("Signing key not found");
  }

  // Import key and verify signature
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64urlToBytes(parts[2]);

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature,
    signedData
  );
  if (!valid) {
    throw new Error("Invalid token signature");
  }

  return payload;
}
