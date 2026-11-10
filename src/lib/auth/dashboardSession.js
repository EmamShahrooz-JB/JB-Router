import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/localDb";

const DEFAULT_PASSWORD = "123456";
const SESSION_MAX_AGE_SEC = 24 * 60 * 60;

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers") {
    throw new Error("JWT_SECRET must be configured as a Cloudflare secret");
  }
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

const SECRET_STRING = loadJwtSecret();
const SECRET = new TextEncoder().encode(SECRET_STRING);

/** The raw deployment secret (env, or the persisted per-install file). */
export function getDashboardSecretString() {
  return SECRET_STRING;
}

/**
 * Constant-time comparison for two secrets. Hashing both sides first makes the
 * comparison length-independent, so timingSafeEqual never throws on a length
 * mismatch (which would itself leak the expected length).
 */
export function timingSafeEqualString(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Sign an opaque cookie value (HMAC-SHA256 over the value, base64url).
 * Used by the mimo account-login session cookie, which travels through the
 * browser and must not be forgeable: an unsigned payload would let any client
 * point `upstreamBase` at an arbitrary host (open proxy / SSRF).
 */
export function signCookieValue(value) {
  return crypto.createHmac("sha256", SECRET).update(String(value), "utf8").digest("base64url");
}

export function verifyCookieSignature(value, signature) {
  if (typeof signature !== "string" || !signature) return false;
  const expected = signCookieValue(value);
  const got = Buffer.from(signature, "utf8");
  const want = Buffer.from(expected, "utf8");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export function shouldUseSecureCookie(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

export async function createDashboardAuthToken(claims = {}) {
  return new SignJWT({ authenticated: true, ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(SECRET);
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function getDashboardAuthSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  const token = await createDashboardAuthToken(claims);
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.delete("auth_token");
}

// Verify the current dashboard password (re-auth for sensitive actions).
export async function verifyDashboardPassword(password) {
  if (typeof password !== "string" || !password) return false;
  const settings = await getSettings();
  const storedHash = settings?.password;
  if (storedHash) return bcrypt.compare(password, storedHash);
  const initialPassword = process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD;
  return timingSafeEqualString(password, initialPassword);
}
