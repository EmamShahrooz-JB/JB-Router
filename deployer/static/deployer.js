/* UI layer of the JB-Router web deployer. All deploy logic lives in ./pipeline.js. */
import { runDeploy, STEPS } from "./pipeline.js";

const $ = (id) => document.getElementById(id);
const val = (id) => ($(id).value || "").trim();

const state = {
  controller: null,
  reason: null,
  steps: STEPS.map((s) => ({ ...s, state: "todo", note: "" })),
  logCount: 0
};

/* ------------------------------------------------------------------ ui bits */

function log(text) {
  const el = $("log");
  state.logCount++;
  el.textContent += (state.logCount === 1 ? "" : "\n") + "• " + text;
  el.scrollTop = el.scrollHeight;
}

function status(text, kind) {
  $("statusText").textContent = text;
  $("dot").className = "dot " + (kind || "");
}

function renderSteps() {
  const host = $("stepsStatus");
  host.innerHTML = "";
  for (const s of state.steps) {
    const row = document.createElement("div");
    row.className = "srow" + (s.state === "done" ? " done" : s.state === "active" ? " active" : "");
    const icon = s.state === "done" ? "✓" : s.state === "active" ? "◐" : s.state === "error" ? "✗" : "•";
    row.innerHTML = `<span class="ic">${icon}</span><span class="nm"></span>` +
      (s.note ? `<span class="tag"></span>` : "");
    row.querySelector(".nm").textContent = s.label;
    if (s.note) row.querySelector(".tag").textContent = s.note;
    host.appendChild(row);
  }
  const done = state.steps.filter((s) => s.state === "done").length;
  $("bar").style.width = Math.round((done / state.steps.length) * 100) + "%";
}

function setStep(id, st, note) {
  const step = state.steps.find((s) => s.id === id);
  if (step) { step.state = st; step.note = note || ""; }
  renderSteps();
}

function onEvent(event) {
  switch (event.type) {
    case "step": setStep(event.id, event.state, event.note); break;
    case "log": log(event.text); break;
    case "progress": {
      const step = state.steps.find((s) => s.id === event.id);
      if (step && event.total) setStep(event.id, "active", `${Math.round((event.received / event.total) * 100)}%`);
      break;
    }
    case "wait": status(`در انتظار فعال شدن آدرس عمومی… (تلاش ${event.attempt})`, "run"); break;
    case "result": showResult(event.result); break;
    default: break;
  }
}

function showResult(result) {
  const box = $("resultBox");
  box.className = "result";
  box.innerHTML = `
    <b>JB-Router با موفقیت نصب شد 🚀</b>
    <div class="kv">
      <b>داشبورد</b><span><a href="${result.loginUrl}" target="_blank" rel="noopener">${result.loginUrl}</a></span>
      <b>Endpoint سازگار با OpenAI</b><span><code>${result.apiBaseUrl}</code></span>
      <b>نام ورکر</b><span><code>${result.name}</code></span>
      <b>اکانت</b><span><code>${result.accountId}</code></span>
      <b>سلامت</b><span>${result.health} (HTTP ${result.status})</span>
    </div>
    <p class="hint">با رمز داشبوردی که بالاتر ساختید وارد شوید (کاربر پیش‌فرض <code>admin</code>). اگر به تازگی نصب شده و پاسخ ۱۰۴۲ گرفتید، یک دقیقه بعد دوباره امتحان کنید.</p>`;
  status("نصب با موفقیت تمام شد ✅", "ok");
  $("modePill").textContent = "نصب‌شده";
}

function failBox(message) {
  $("resultBox").className = "result err";
  $("resultBox").innerHTML = `<b>نصب انجام نشد.</b><div class="kv"><b>دلیل</b><span></span></div>
    <p class="hint">اغلب موارد: نبود دسترسی توکن (قالب Edit Cloudflare Workers را بسازید)، پلن رایگان Cloudflare (سقف ۳ مگابایت اسکریپت) یا نام ورکر تکراری/نامعتبر.</p>`;
  $("resultBox").querySelector(".kv span").textContent = message;
  status("متوقف شد", "err");
}

/* ------------------------------------------------------------------ helpers */

function toggleVis(id, btn) {
  const el = $(id);
  el.type = el.type === "password" ? "text" : "password";
  btn.textContent = el.type === "password" ? "نمایش" : "پنهان";
}
window.toggleVis = toggleVis;

function randomString(len = 32) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function regen(id) { $(id).value = randomString(32); }
window.regen = regen;

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
    throw new Error((data && data.error) || `HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return data;
}

function updatePreview() {
  const sub = val("subdomain") || "<subdomain>";
  const name = val("workerName") || "jb-router";
  $("urlPreview").textContent = `https://${name}.${sub}.workers.dev`;
}

/* ------------------------------------------------------------------ token check */

async function checkToken() {
  const token = val("cfToken");
  if (!token) { status("اول توکن Cloudflare را وارد کنید", "warn"); return; }
  status("در حال بررسی توکن…", "run");
  try {
    const verified = await api("/api/verify", { token });
    if (verified.status !== "active") throw new Error(`وضعیت توکن: ${verified.status}`);
    log("توکن Cloudflare معتبر است.");
    const accounts = await api("/api/accounts", { token });
    const select = $("accountId");
    select.innerHTML = "";
    for (const account of accounts.accounts) {
      const option = document.createElement("option");
      option.value = account.id;
      option.textContent = `${account.name} (${account.id})`;
      select.appendChild(option);
    }
    if (!accounts.accounts.length) throw new Error("این توکن به هیچ اکانتی دسترسی ندارد");
    log(`${accounts.accounts.length} اکانت در دسترس توکن.`);
    const sub = await api("/api/subdomain", { token, accountId: select.value });
    if (sub.subdomain) {
      $("subdomain").value = sub.subdomain;
      $("subdomain").readOnly = true;
      log(`subdomain اکانت: ${sub.subdomain}`);
    } else {
      $("subdomain").readOnly = false;
      $("subdomain").placeholder = "اکانت شما subdomain ندارد — یک نام بنویسید";
      log("این اکانت هنوز workers.dev subdomain ندارد؛ یک نام در فیلد بنویسید.", "warn");
    }
    updatePreview();
    status("توکن و اکانت آماده است ✅", "ok");
    $("modePill").textContent = "آمادهٔ نصب";
  } catch (err) {
    status("بررسی توکن ناموفق بود", "err");
    log("خطا: " + err.message);
    failBox(err.message);
  }
}

/* ------------------------------------------------------------------ run */

async function start() {
  const token = val("cfToken");
  const accountId = val("accountId");
  const name = val("workerName");
  const subdomain = val("subdomain");
  const password = val("password");
  const jwtSecret = val("jwtSecret");

  if (!token) return status("توکن Cloudflare را وارد کنید", "warn");
  if (!accountId) return status("دکمهٔ «بررسی توکن» را بزنید تا اکانت انتخاب شود", "warn");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) return status("نام ورکر فقط حروف کوچک/عدد/خط تیره", "warn");
  if (!password || !jwtSecret) return status("رمز داشبورد و JWT_SECRET را خالی نگذارید", "warn");
  if (!subdomain || subdomain.includes("<")) return status("subdomain اکانت را مشخص کنید (فیلد سوم)", "warn");

  state.steps.forEach((s) => { s.state = "todo"; s.note = ""; });
  renderSteps();
  $("log").textContent = "";
  state.logCount = 0;
  $("logWrap").classList.remove("hidden");
  $("resultBox").className = "result hidden";
  $("startBtn").disabled = true;
  $("stopBtn").disabled = false;
  $("modePill").textContent = "در حال نصب…";
  status("شروع شد…", "run");

  state.controller = new AbortController();
  try {
    await runDeploy({
      cfToken: token,
      accountId,
      name,
      subdomain,
      jwtSecret,
      password,
      onEvent,
      signal: state.controller.signal
    });
  } catch (err) {
    const message = err && err.name === "AbortError" ? "نصب توسط شما متوقف شد." : (err.message || String(err));
    log("خطا: " + message);
    failBox(message);
  } finally {
    $("startBtn").disabled = false;
    $("stopBtn").disabled = true;
    const failed = state.steps.some((s) => s.state === "error");
    if (!failed && state.steps.every((s) => s.state === "done")) status("نصب کامل شد ✅", "ok");
  }
}

/* ------------------------------------------------------------------ boot */

(async function boot() {
  regen("password");
  regen("jwtSecret");
  renderSteps();
  $("checkToken").addEventListener("click", checkToken);
  $("startBtn").addEventListener("click", start);
  $("stopBtn").addEventListener("click", () => {
    if (state.controller) state.controller.abort();
    $("stopBtn").disabled = true;
  });
  for (const id of ["workerName", "subdomain"]) $(id).addEventListener("input", updatePreview);
  $("accountId").addEventListener("change", async () => {
    const token = val("cfToken");
    if (!token) return;
    try {
      const sub = await api("/api/subdomain", { token, accountId: val("accountId") });
      if (sub.subdomain) { $("subdomain").value = sub.subdomain; $("subdomain").readOnly = true; updatePreview(); }
    } catch { /* ignore */ }
  });
  updatePreview();
  try {
    const meta = await (await fetch("/api/meta")).json();
    $("releaseLabel").textContent = `${meta.release} (${(meta.assetsZipBytes / 1048576).toFixed(1)} MB assets · ${meta.assetFiles} files)`;
  } catch { $("releaseLabel").textContent = "نامشخص"; }
})();
