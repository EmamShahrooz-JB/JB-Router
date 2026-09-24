/**
 * Router ↔ upstream status translation.
 *
 * When every account for a model is in cooldown the router answers 503 and
 * embeds the original upstream error in the message:
 *   "[api-airforce/gpt-oss-120b] [402]: {...} (reset after 2m)"
 * Reporting that 503 verbatim makes blocked-but-reachable providers look like an
 * outage, so callers (dashboard probes, CLI test buttons) use this helper to
 * recover the real status code, message and cooldown.
 */

// Router errors that mean "every account for this model is in cooldown" are
// answered with 503 + the original upstream error embedded in the message
// ("[provider/model] [402]: {...} (reset after 2m)"). Showing that raw 503 makes
// healthy-but-blocked providers look like an outage, so surface the real code.
const UPSTREAM_DETAIL_RE = /^\[(?<target>[^\]]+)\]\s*\[(?<code>\d{3})\]\s*:?\s*(?<body>[\s\S]*?)(?:\s*\((?<cooldown>reset after [^)]+)\))?$/i;

const LEADING_STATUS_RE = /^\[\d{3}\]\s*:?\s*/;

/** Pull the human-readable wording out of an upstream error body. */
function humanizeUpstreamBody(body) {
  const text = String(body || "").trim();
  if (!text) return "";
  const withoutPrefix = text.replace(LEADING_STATUS_RE, "").trim();
  try {
    const json = JSON.parse(withoutPrefix);
    const message = json?.error?.message || json?.message || json?.msg || json?.error;
    if (typeof message === "string" && message.trim()) return message.trim();
  } catch { /* not JSON: use the raw text */ }
  return withoutPrefix || text;
}

export function describeUpstreamFailure(status, parsed, rawText) {
  const routerStatus = Number(status) || 0;
  const rawDetail = parsed?.error?.message || parsed?.msg || parsed?.message || parsed?.error || rawText;
  const detail = typeof rawDetail === "string" ? rawDetail : (rawDetail ? JSON.stringify(rawDetail) : "");

  const match = detail ? UPSTREAM_DETAIL_RE.exec(detail.trim()) : null;
  const upstreamStatus = match ? Number(match.groups.code) : null;

  if (match && upstreamStatus && (routerStatus === 503 || upstreamStatus !== routerStatus)) {
    const message = humanizeUpstreamBody(match.groups.body) || detail;
    const cooldown = match.groups.cooldown || null;
    const suffix = cooldown ? `, model in cooldown (${cooldown})` : "";
    return {
      ok: false,
      status: upstreamStatus,
      upstreamStatus,
      routerStatus,
      locked: Boolean(cooldown),
      cooldown,
      error: `HTTP ${upstreamStatus}${suffix}: ${String(message).slice(0, 400)}`,
    };
  }

  const message = humanizeUpstreamBody(detail) || detail;
  return {
    ok: false,
    status: routerStatus,
    upstreamStatus: null,
    routerStatus,
    locked: routerStatus === 503,
    cooldown: null,
    error: `HTTP ${routerStatus}${message ? `: ${String(message).slice(0, 500)}` : ""}`,
  };
}



export default describeUpstreamFailure;
