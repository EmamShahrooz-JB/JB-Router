import pkg from "../../../../package.json" with { type: "json" };

/**
 * Update check for a deployed JB-Router Worker.
 *
 * The instance asks the public GitHub repository for its latest release (no token needed, the
 * repository is public) and the deployer for the release it serves, and reports the newer of the
 * two. Installing an update is a click in the panel: Cloudflare only accepts a script upload
 * with an authenticated API call, so the installer page is opened with this Worker's name
 * prefilled and the visitor authorises that single call with their own token there.
 */
const GITHUB_REPO = "EmamShahrooz-JB/JB-Router";
const DEPLOYER_ORIGIN = "https://jb-deployer.jb-router.workers.dev";
const CHECK_TTL_MS = 60 * 60 * 1000; // hourly
const FETCH_TIMEOUT_MS = 6000;

// Per-isolate cache (the app runs inside its Durable Object, so this survives between requests
// and the hourly cron refreshes it even while nobody has the panel open).
const updateState = (globalThis.__jbUpdateState ??= { value: null, fetchedAt: 0 });

export function parseVersion(value) {
  return String(value || "").replace(/^v/i, "").trim();
}

export function compareVersions(a, b) {
  const pa = parseVersion(a).split(".").map((part) => parseInt(part, 10) || 0);
  const pb = parseVersion(b).split(".").map((part) => parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i += 1) {
    const left = pa[i] || 0;
    const right = pb[i] || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Latest release published on GitHub (tag, page and notes). */
async function latestFromGithub() {
  const data = await fetchJson(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    accept: "application/vnd.github+json",
    "user-agent": "JB-Router-Update-Check",
  });
  if (!data || !data.tag_name) return null;
  return {
    version: parseVersion(data.tag_name),
    url: data.html_url || null,
    notes: typeof data.body === "string" ? data.body.slice(0, 2000) : null,
    publishedAt: data.published_at || null,
    source: "github",
  };
}

/** Release the web deployer currently serves — that is what an install would put on this account. */
async function latestFromDeployer() {
  const data = await fetchJson(`${DEPLOYER_ORIGIN}/api/meta`);
  if (!data || !data.release) return null;
  return {
    version: parseVersion(data.release),
    url: `${DEPLOYER_ORIGIN}/`,
    notes: null,
    publishedAt: null,
    source: "deployer",
  };
}

async function checkLatest() {
  const [github, deployer] = await Promise.all([latestFromGithub(), latestFromDeployer()]);
  if (!github && !deployer) return null;
  if (!github) return deployer;
  if (!deployer) return github;
  return compareVersions(deployer.version, github.version) > 0 ? deployer : github;
}

export async function GET(request) {
  const current = parseVersion(pkg.version);

  if (!updateState.value || Date.now() - updateState.fetchedAt > CHECK_TTL_MS) {
    const fresh = await checkLatest();
    if (fresh) {
      updateState.value = fresh;
      updateState.fetchedAt = Date.now();
    }
  }

  const info = updateState.value || { version: null, url: null, notes: null, source: null, publishedAt: null };
  const hasUpdate = info.version ? compareVersions(info.version, current) > 0 : false;

  // The installer wants the Worker name; it is the first label of this host when the instance
  // runs on a workers.dev subdomain.
  const host = request?.headers?.get("host") || "";
  const name = host.endsWith(".workers.dev") ? host.split(".")[0] : null;
  const updateUrl = `${DEPLOYER_ORIGIN}/${name ? `?name=${encodeURIComponent(name)}` : ""}${hasUpdate ? `${name ? "&" : "?"}update=${encodeURIComponent(info.version)}` : ""}`;

  return Response.json({
    currentVersion: current,
    latestVersion: info.version,
    hasUpdate,
    releaseUrl: info.url,
    releaseNotes: info.notes,
    releasePublishedAt: info.publishedAt,
    source: info.source,
    checkedAt: updateState.fetchedAt || null,
    updateUrl,
    deployerUrl: DEPLOYER_ORIGIN,
  });
}
