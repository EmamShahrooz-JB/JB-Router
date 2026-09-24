import { UPDATER_CONFIG } from "@/shared/constants/config";
import { getWorkerDatabaseState } from "@/lib/db/workerContext.js";

// Only application-owned internal routes are allowed. Never accept arbitrary
// URLs or forward internal credentials to user-controlled hosts on Workers.
const INFERENCE_PATHS = new Set([
  "/api/v1/chat/completions",
  "/api/v1/embeddings",
  "/api/v1/images/generations",
  "/api/v1/audio/transcriptions",
  "/api/v1/systemone",
]);
function isAllowedPath(path) {
  return INFERENCE_PATHS.has(path) || /^\/api\/providers\/[a-zA-Z0-9_-]+\/models$/.test(path);
}

export async function fetchInternalApi(path, init = {}, baseUrl) {
  if (!isAllowedPath(path)) throw new Error("Unsupported internal API route");
  init.signal?.throwIfAborted();
  const isWorker = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
  if (!isWorker) {
    const origin = baseUrl || `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;
    return fetch(`${origin}${path}`, init);
  }

  // This callback belongs to the CURRENT Durable Object incarnation. It enters
  // the normal OpenNext middleware and route handler, preserving authentication,
  // AsyncLocalStorage, database ownership and response/stream validation.
  // Do not fetch localhost or the public Workers URL (self-fetch/DO re-entry).
  const { internalFetch } = getWorkerDatabaseState();
  if (typeof internalFetch !== "function") throw new Error("Internal Worker request transport is unavailable");
  const request = new Request(`https://jb-router.internal${path}`, init);
  if (!init.signal) return internalFetch(request);

  // Unlike network fetch, a plain function invocation doesn't automatically
  // reject on abort. Retain the probe deadline and forward the same signal.
  return new Promise((resolve, reject) => {
    const abort = () => reject(init.signal.reason || new DOMException("Aborted", "AbortError"));
    init.signal.addEventListener("abort", abort, { once: true });
    if (init.signal.aborted) {
      init.signal.removeEventListener("abort", abort);
      abort();
      return;
    }
    Promise.resolve().then(() => internalFetch(request)).then(
      (response) => {
        init.signal.removeEventListener("abort", abort);
        if (init.signal.aborted) {
          response.body?.cancel().catch(() => {});
          abort();
        } else resolve(response);
      },
      (error) => {
        init.signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
