import { ANTIGRAVITY_IDE_BASE_URL, ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION } from "../providers/shared.js";
import { fetchWithTimeout, normalizeCloudCodeProjectId } from "./usage/shared.js";

// Use the same live catalog endpoint as Antigravity's quota client, not the
// obsolete sandbox /v1internal:models endpoint. Never substitute a static list.
export function parseAntigravityModels(data) {
  const catalog = data?.models;
  const entries = Array.isArray(catalog)
    ? catalog.map((model) => [model?.id || model?.model || model?.name, model])
    : catalog && typeof catalog === "object" ? Object.entries(catalog) : [];
  const seen = new Set();
  return entries.flatMap(([id, info]) => {
    if (typeof id !== "string" || !id || !info || typeof info !== "object" || info.isInternal || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name: info.displayName || info.name || id }];
  });
}

export async function resolveAntigravityModels(connection, {
  proxyOptions = null,
  refreshCredentials,
  persistCredentials,
  fetchModels = fetchWithTimeout,
} = {}) {
  let token = connection.accessToken;
  const project = normalizeCloudCodeProjectId(connection.projectId)
    || normalizeCloudCodeProjectId(connection.providerSpecificData?.projectId);
  const request = (accessToken) => fetchModels(
    `${ANTIGRAVITY_IDE_BASE_URL}/v1internal:fetchAvailableModels`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
        "X-Client-Name": "antigravity",
        "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
      },
      body: JSON.stringify(project ? { project } : {}),
    },
    15000,
    proxyOptions,
  );

  try {
    let response = token ? await request(token) : null;
    // Only authentication expiry merits one refresh. 403 is a permissions error.
    if ((!response || response.status === 401) && connection.refreshToken && refreshCredentials) {
      if (response) await response.arrayBuffer();
      const refreshed = await refreshCredentials(connection);
      if (!refreshed?.accessToken) return { error: "Antigravity session expired. Reconnect the account.", status: 401 };
      await persistCredentials(connection.id, {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken || connection.refreshToken,
        expiresIn: refreshed.expiresIn,
      });
      token = refreshed.accessToken;
      response = await request(token);
    }
    if (!response) return { error: "No Antigravity access token found. Reconnect the account.", status: 401 };
    if (!response.ok) {
      await response.arrayBuffer();
      return { error: `Failed to fetch Antigravity models (HTTP ${response.status}).`, status: response.status };
    }
    const models = parseAntigravityModels(await response.json());
    return {
      models,
      ...(models.length ? {} : { warning: "Antigravity returned no public models for this account." }),
    };
  } catch {
    // Never return credentials or raw upstream payloads to the browser/logs.
    return { error: "Unable to fetch Antigravity models. Try again shortly.", status: 502 };
  }
}
