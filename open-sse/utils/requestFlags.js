/**
 * Request flags — behaviour switches carried by internal/dashboard requests.
 *
 * These flags never grant extra access: they only relax health bookkeeping
 * (model cooldowns) for a single, explicitly user-triggered probe.
 */

/** Header set by the dashboard "test model" probes. */
export const FORCE_TEST_HEADER = "x-9r-force-test";

/**
 * True when the request is an explicit user-triggered connectivity probe
 * (dashboard "Test" / "Test all models" buttons).
 *
 * Such a probe always reaches the provider: a cooldown recorded by an earlier
 * failure must not be reported back as the probe result, otherwise every
 * provider whose last call failed shows a generic 503 ("all accounts locked")
 * instead of the real upstream answer.
 */
export function isForceTestRequest(request) {
  try {
    return String(request?.headers?.get?.(FORCE_TEST_HEADER) || "") === "1";
  } catch {
    return false;
  }
}
