/* JB-Router Wizard — UI layer.
 * Talks to the deployer Worker (same origin) and streams the install progress into the
 * terminal panel. All deploy logic lives in ./pipeline.js. */
import { runDeploy, listAccounts, getSubdomain, DeployError } from "./pipeline.js";

const UPSTREAM = "https://github.com/EmamShahrooz-JB/JB-Router";
const RELEASE = "v0.5.86";

const $ = (id) => document.getElementById(id);
const out = $("output");
const form = $("deployForm");
const installButton = $("installButton");

let running = false;
let quickLink = "";
let verifyLogged = false;

/* ------------------------------------------------------------------ terminal */

const GLYPH = {
  info: { icon: "•", cls: "terminal-info" },
  success: { icon: "✓", cls: "terminal-success" },
  error: { icon: "✗", cls: "terminal-error" }
};

function line(type, message) {
  const meta = GLYPH[type] || GLYPH.info;
  out.appendChild(document.createElement("br"));
  const label = document.createElement("span");
  label.className = meta.cls;
  label.textContent = meta.icon;
  const text = document.createElement("span");
  text.textContent = " " + message;
  out.append(label, text);
  out.scrollTop = out.scrollHeight;
  return text;
}

function appendLink(url, label) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.className = "terminal-url";
  link.textContent = label || url;
  out.appendChild(link);
  out.scrollTop = out.scrollHeight;
}

function appendCopy(buttonLabel, value) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "terminal-copy";
  button.textContent = " " + (buttonLabel || "copy");
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = " copied";
      setTimeout(() => { button.textContent = " " + (buttonLabel || "copy"); }, 1500);
    } catch {
      button.textContent = "copy failed";
    }
  });
  out.appendChild(button);
  out.scrollTop = out.scrollHeight;
}

function appendSecret(value) {
  const span = document.createElement("span");
  span.className = "terminal-secret";
  span.textContent = value;
  out.appendChild(span);
  out.scrollTop = out.scrollHeight;
}

/* One reusable "live" line for transfer progress: it is overwritten in place instead of
   appending a new row per update, so the terminal stays readable and never looks stuck. */
let statusLine = null;
let statusAt = 0;
let statusTracker = null;

const MB = (bytes) => (bytes / 1048576).toFixed(1);

function status(id, received, total) {
  const now = Date.now();
  if (!statusTracker || statusTracker.id !== id) {
    statusTracker = { id, started: now, lastAt: now, lastBytes: 0, lastChangeAt: now };
  }
  if (received !== statusTracker.lastBytes) statusTracker.lastChangeAt = now;
  statusTracker.lastAt = now;
  statusTracker.lastBytes = received;
  if (now - statusAt < 250 && total && received < total) return;
  statusAt = now;
  if (!statusLine || !statusLine.parentNode) {
    out.appendChild(document.createElement("br"));
    statusLine = document.createElement("span");
    statusLine.className = "terminal-info";
    out.appendChild(statusLine);
  }
  const seconds = Math.max(0.3, (now - statusTracker.started) / 1000);
  const speedMbps = received / seconds / 1048576;
  const idle = (now - statusTracker.lastChangeAt) / 1000;
  const percent = total ? ` (${Math.round((received / total) * 100)}%)` : "";
  const eta = total && speedMbps > 0 ? ` · ~${Math.round((total - received) / (received / seconds))}s left` : "";
  statusTracker.base = `▸ ${id === "bundle" ? "Downloading payload" : "Uploading assets"}: ${MB(received)} MB` +
    `${total ? " / " + MB(total) + " MB" : ""}${percent} · ${speedMbps.toFixed(2)} MB/s${eta}`;
  statusLine.textContent = statusTracker.base +
    (idle > 6 ? ` · waiting on Cloudflare (${Math.round(idle)}s without new bytes)…` : "");
  out.scrollTop = out.scrollHeight;
}

/* Keeps the live line honest: while a transfer is running the elapsed seconds tick up even
   if a progress event is late, so a slow connection never looks like a frozen page. */
function startHeartbeat() {
  setInterval(() => {
    if (!statusTracker || !statusLine) return;
    if (!statusTracker.base) return;
    const idle = (Date.now() - statusTracker.lastChangeAt) / 1000;
    const elapsed = (Date.now() - statusTracker.started) / 1000;
    statusLine.textContent = statusTracker.base +
      (idle > 6 ? ` · still working (${Math.round(elapsed)}s in this step)…` : "");
    out.scrollTop = out.scrollHeight;
  }, 3000);
}

function endStatus() {
  if (statusLine && statusLine.parentNode && typeof statusLine.remove === "function") statusLine.remove();
  statusLine = null;
  statusTracker = null;
}

function standby() {
  const span = document.createElement("span");
  span.textContent = "●●● Standby";
  out.appendChild(document.createElement("br"));
  out.appendChild(span);
  out.scrollTop = out.scrollHeight;
}

function resetTerminal() {
  out.textContent = "●●● Standby";
}

/* ------------------------------------------------------------------ helpers */

function randomString(length = 32) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let value = "";
  for (let i = 0; i < length; i++) value += alphabet[bytes[i] % alphabet.length];
  return value;
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok || !data || data.ok !== true) {
    throw new Error((data && data.error) || `HTTP ${res.status}${text ? " " + text.slice(0, 160) : ""}`);
  }
  return data;
}

const mb = (bytes) => (bytes / 1048576).toFixed(1) + " MB";

/* step id → messages shown in the terminal */
const MESSAGES = {
  verify: "Validating your Cloudflare API token…",
  bundle: "Reading the bundled asset index…",
  hash: "Hashing the static assets with blake3…",
  session: "Creating the asset upload session…",
  assets: "Publishing the static assets…",
  script: "Installing the Worker module and the Durable Object…",
  secrets: "Storing the JWT_SECRET and INITIAL_PASSWORD secrets…",
  enable: "Publishing the workers.dev URL…",
  health: "Waiting for the deployment to go live (usually a few seconds, up to 3 minutes)…"
};

/* ------------------------------------------------------------------ wizard */

function buildTokenTemplateUrl() {
  const permissions = [
    { key: "workers_scripts", type: "edit" },
    { key: "workers_kv_storage", type: "edit" },
    { key: "account_settings", type: "read" },
    { key: "user_details", type: "read" }
  ];
  const url = new URL("https://dash.cloudflare.com/profile/api-tokens");
  url.searchParams.set("permissionGroupKeys", JSON.stringify(permissions));
  url.searchParams.set("accountId", "*");
  url.searchParams.set("zoneId", "all");
  url.searchParams.set("name", "JB-Router-Wizard");
  return url.href;
}

function applyQueryParams() {
  const params = new URLSearchParams(location.search);
  if (params.get("name")) $("workerName").value = params.get("name");
  if (params.get("sub")) $("subdomain").value = params.get("sub");
  if (params.get("type") === "dryrun") $("deployType").value = "dryrun";
  if (params.get("account")) sessionStorage.setItem("jb_account", params.get("account"));
}

/** Resolves the account to deploy into; asks for a choice only when the token sees several. */
async function resolveAccount(token) {
  const { accounts } = await listAccounts({ cfToken: token });
  if (!accounts.length) throw new Error("This token cannot access any Cloudflare account.");

  const forced = new URLSearchParams(location.search).get("account") || sessionStorage.getItem("jb_account");
  if (accounts.length === 1) return accounts[0];

  const group = $("accountGroup");
  const select = $("accountId");
  if (!select.options.length) {
    select.innerHTML = "";
    for (const account of accounts) {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = `${account.name} — ${account.id}`;
      select.appendChild(option);
    }
  }
  group.classList.remove("hidden");
  const forcedAccount = forced && accounts.find((a) => a.id === forced);
  if (forcedAccount) select.value = forcedAccount.id;
  line("info", `This token can access ${accounts.length} accounts — the selected one is used (change it in the list above).`);
  return accounts.find((a) => a.id === select.value) || accounts[0];
}

async function resolveSubdomain(token, accountId) {
  let { subdomain } = await getSubdomain({ cfToken: token, accountId });
  if (subdomain) return subdomain;

  const group = $("subdomainGroup");
  group.classList.remove("hidden");
  const typed = $("subdomain").value.trim().toLowerCase();
  if (!typed) {
    line("info", "This account has no workers.dev subdomain yet — type one in the field above (for example your nickname) and press Install again.");
    standby();
    return null;
  }
  const created = await getSubdomain({ cfToken: token, accountId, set: typed });
  subdomain = created.subdomain;
  if (!subdomain) throw new Error("Cloudflare did not accept that workers.dev subdomain — try another one.");
  line("success", `Registered the workers.dev subdomain "${subdomain}".`);
  return subdomain;
}

async function start(event) {
  event.preventDefault();
  if (running) return;

  const token = $("apiToken").value.trim();
  const name = ($("workerName").value.trim() || "jb-router").toLowerCase();
  const type = $("deployType").value;
  if (!token) { line("error", "Paste your Cloudflare API token first."); return; }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) {
    line("error", "Worker name must use lowercase letters, digits and dashes only.");
    return;
  }

  running = true;
  installButton.disabled = true;
  $("deploymentToast").classList.add("hidden");
  $("privateUrlToast").classList.add("hidden");
  resetTerminal();
  verifyLogged = false;

  const password = randomString(24);
  const jwtSecret = randomString(48);
  const started = Date.now();

  try {
    line("info", "Validating your Cloudflare API token…");
    verifyLogged = true;
    const account = await resolveAccount(token);
    const subdomain = await resolveSubdomain(token, account.id);
    if (!subdomain) return;

    line("info", `Installing into the account "${account.name}" as worker "${name}"…`);
    line("info", "Everything heavy is streamed between the deployer and Cloudflare — this browser only sends the token and small JSON requests.");
    line("info", `Dashboard password for this install: ${password}`);

    const result = await runDeploy({
      cfToken: token,
      accountId: account.id,
      name,
      subdomain,
      password,
      jwtSecret,
      release: RELEASE,
      dryRun: type === "dryrun",
      foregroundMs: 40000,
      onEvent: (e) => handleEvent(e, { password })
    });

    if (result.dryRun) {
      line("success", "Dry run finished — the token, account and URL are valid. Nothing was installed.");
      line("info", `Planned URL: ${result.url}`);
      standby();
      return;
    }

    const { url } = result;
    line("success", result.health === "ok" ? "JB-Router successfully installed!" : "JB-Router installed — waiting for the URL to activate.");
    line("info", `Dashboard: ${url}/login `);
    appendLink(`${url}/login`, "open dashboard");
    line("info", `API endpoint (OpenAI compatible): `);
    appendLink(`${url}/v1`, `${url}/v1`);
    line("info", `Dashboard password: `);
    appendSecret(password);
    appendCopy("copy", password);
    line("info", `Log in as "admin" with that password · finished in ${Math.round((Date.now() - started) / 1000)}s.`);
    standby();

    $("liveUrl").href = `${url}/login`;
    $("deploymentToast").classList.remove("hidden");

    quickLink = `${location.origin}${location.pathname}?name=${encodeURIComponent(name)}&sub=${encodeURIComponent(subdomain)}&type=${type}&account=${account.id}`;
    $("privateUrlToast").classList.remove("hidden");
  } catch (err) {
    const message = err instanceof DeployError
      ? `Cloudflare rejected the request: ${err.message}`
      : (err && err.message) || String(err);
    line("error", message);
    line("info", "Nothing was left half-installed: re-run the wizard once the issue is fixed.");
    standby();
  } finally {
    running = false;
    installButton.disabled = false;
  }
}

function handleEvent(event, context) {
  switch (event.type) {
    case "step": {
      if (event.state !== "active") { endStatus(); break; }
      // The token check already happened while resolving the account.
      if (event.id === "verify" && verifyLogged) break;
      line("info", MESSAGES[event.id] || event.id);
      break;
    }
    case "event":
      return handleMilestone(event, context);
    case "progress": {
      if (event.id === "bundle" || event.id === "assets") {
        status(event.id, event.received, event.total);
        if (event.id === "assets" && statusTracker && !statusTracker.warned &&
            Date.now() - statusTracker.started > 45000) {
          statusTracker.warned = true;
          line("info", "This stage moves ~10 MB from your browser to Cloudflare — it is bounded by your upload speed, not by the installer.");
        }
      }
      break;
    }
    default:
      break;
  }
}

function handleMilestone(event, context) {
  const d = event.data || {};
  switch (event.key) {
    case "verify.ok":
      line("success", `Token is active (id ${String(d.tokenId).slice(0, 8)}…).`);
      break;
    case "bundle.ok":
      line("success", d.streamed
        ? `Bundle ready: ${d.files} files${d.release ? ` (${d.release})` : ""} — served from the deployer, so nothing large is downloaded here.`
        : `Payload ready: ${d.files} files, ${mb(d.bytes)}${d.release ? ` (${d.release})` : ""}.`);
      break;
    case "hash.ok":
      line("success", `Manifest built for ${d.files} files.`);
      break;
    case "session.ok":
      if (!d.pending) { line("success", "Upload session ready — every asset file is already on this account."); break; }
      line("success", d.streamed
        ? `Upload session ready — ${d.pending} files will be streamed to Cloudflare from the deployer (${d.buckets} chunks, ${mb(d.pendingBytes || 0)}), not from your browser.`
        : `Upload session ready — ${d.pending} files need uploading (${d.buckets} buckets).`);
      break;
    case "assets.ok":
      line("success", `Static assets ready: ${d.total} files${d.streamed ? " (streamed inside Cloudflare)" : ""}.`);
      break;
    case "script.ok":
      line("success", `Worker "${d.name}" deployed (deployment ${String(d.deploymentId).slice(0, 8)}…, assets: ${d.hasAssets}).`);
      break;
    case "secrets.ok":
      line("success", `Secrets stored: ${(d.stored || []).join(", ")}.`);
      break;
    case "enable.ok":
      line("success", `Public URL: `);
      appendLink(d.url, d.url);
      break;
    case "health.waiting":
      line("info", "The workers.dev route is still propagating — retrying every 2.5 seconds…");
      break;
    case "health.ok":
      line("success", `Health check passed in ${(d.ms / 1000).toFixed(1)}s.`);
      break;
    case "health.slow":
      line("info", "The deployment is finished — only the workers.dev route is still warming up. The wizard is done; the check keeps running in the background.");
      break;
    case "health.late":
      line("success", `Health check passed after ${Math.round(d.ms / 1000)}s — the panel is live.`);
      break;
    case "health.giveup":
      line("info", "The URL did not answer yet; open the dashboard link below and refresh if needed.");
      break;
    case "health.timeout":
      line("error", "The Worker did not answer the health check in time. It usually comes up shortly — try the dashboard URL below.");
      break;
    case "dryrun.ok":
      break;
    case "failure":
      line("error", d.message || "Deployment failed.");
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ theme */

/* Mirrors the dashboard's theme store: same localStorage key ("theme", zustand-persist
   shape) and the same `dark` class on <html> that the app's applyTheme() sets. */
function currentTheme() {
  if (document.documentElement.classList.contains("dark")) return "dark";
  return "light";
}

function storedTheme() {
  try {
    const stored = JSON.parse(localStorage.getItem("theme") || "{}");
    return (stored.state || {}).theme || "system";
  } catch {
    return "system";
  }
}

/* The dashboard re-applies the theme when the OS preference changes (useTheme hook) —
   same behaviour here while no explicit choice is stored in the wizard. */
function watchSystemTheme() {
  if (typeof window.matchMedia !== "function") return;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const sync = () => {
    if (storedTheme() !== "system") return;
    const theme = media.matches ? "dark" : "light";
    document.documentElement.classList.toggle("dark", theme === "dark");
    $("themeIconDark").classList.toggle("hidden", theme === "dark");
    $("themeIconLight").classList.toggle("hidden", theme !== "dark");
  };
  if (media.addEventListener) media.addEventListener("change", sync);
  else if (media.addListener) media.addListener(sync);
}

function applyTheme(theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  $("themeIconDark").classList.toggle("hidden", theme === "dark");
  $("themeIconLight").classList.toggle("hidden", theme !== "dark");
  try {
    const stored = JSON.parse(localStorage.getItem("theme") || "{}");
    stored.state = { ...(stored.state || {}), theme };
    localStorage.setItem("theme", JSON.stringify(stored));
  } catch {
    /* private mode — ignore */
  }
}

/* ------------------------------------------------------------------ boot */

function boot() {
  $("tokenTemplate").href = buildTokenTemplateUrl();
  $("themeToggle").addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "light" : "dark"));
  $("themeIconDark").classList.toggle("hidden", currentTheme() === "dark");
  $("themeIconLight").classList.toggle("hidden", currentTheme() !== "dark");
  watchSystemTheme();
  applyQueryParams();

  $("togglePassword").addEventListener("click", () => {
    const input = $("apiToken");
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    $("eyeIcon").classList.toggle("hidden", isPassword);
    $("eyeOffIcon").classList.toggle("hidden", !isPassword);
  });

  $("closeDeploymentToast").addEventListener("click", () => $("deploymentToast").classList.add("hidden"));
  $("closePrivateUrlToast").addEventListener("click", () => $("privateUrlToast").classList.add("hidden"));

  $("copyURL").addEventListener("click", async () => {
    const button = $("copyURL");
    try {
      await navigator.clipboard.writeText(quickLink || location.href);
      button.title = "Copied!";
    } catch {
      button.title = "Copy failed";
    }
  });

  form.addEventListener("submit", start);
  startHeartbeat();

  line("info", "Ready. Paste a Cloudflare API token and press Install.");
}

boot();
