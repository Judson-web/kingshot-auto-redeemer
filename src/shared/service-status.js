import { useCallback, useSyncExternalStore } from "react";

const MAINTENANCE_URL = "/api/kingshot-admin-data?public=maintenance";
const HEALTH_URL = "/api/kingshot-health";
const MAINTENANCE_CRITICAL_INTERVAL = 5000;
const STANDARD_INTERVAL = 30000;
const HEALTH_INTERVAL = 30000;

const initialState = () => ({
  maintenance: {
    verified: false,
    loading: false,
    error: false,
    maintenanceEnabled: false,
    message: "",
    endsAt: null,
    updatedAt: null,
    checkedAt: null
  },
  health: {
    kind: "checking",
    healthy: null,
    status: null,
    lastCompletedAt: null,
    locked: false,
    checkedAt: null,
    error: false
  }
});

let snapshot = initialState();
const subscribers = new Map();
let maintenanceInFlight = null;
let healthInFlight = null;
let maintenanceTimer = null;
let maintenanceTimerMs = 0;
let healthTimer = null;
let focusListenerAttached = false;

function emit() {
  for (const listener of subscribers.keys()) {
    try { listener(); } catch { /* A consumer must not stop other subscribers updating. */ }
  }
}

function update(patch) {
  snapshot = { ...snapshot, ...patch };
  emit();
}

export function getServiceStatusSnapshot() {
  return snapshot;
}

async function readJson(response) {
  return response.json().catch(() => null);
}

export function refreshMaintenanceStatus(fetchImpl = globalThis.fetch) {
  if (maintenanceInFlight) return maintenanceInFlight;
  let pending;
  pending = Promise.resolve().then(async () => {
    try {
      const response = await fetchImpl(MAINTENANCE_URL, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { "cache-control": "no-cache" }
      });
      const data = await readJson(response);
      if (!response.ok || !data || typeof data.maintenanceEnabled !== "boolean") {
        throw new Error("Maintenance status could not be verified.");
      }
      update({
        maintenance: {
          verified: true,
          loading: false,
          error: false,
          maintenanceEnabled: data.maintenanceEnabled,
          message: typeof data.message === "string" ? data.message : "",
          endsAt: data.endsAt || null,
          updatedAt: data.updatedAt || null,
          checkedAt: Date.now()
        }
      });
      return snapshot.maintenance;
    } catch (error) {
      update({
        maintenance: {
          ...snapshot.maintenance,
          loading: false,
          error: true,
          lastError: error instanceof Error ? error.message : "Maintenance status could not be verified."
        }
      });
      throw error;
    } finally {
      if (maintenanceInFlight === pending) maintenanceInFlight = null;
    }
  });
  maintenanceInFlight = pending;
  if (!snapshot.maintenance.verified || snapshot.maintenance.error) {
    update({ maintenance: { ...snapshot.maintenance, loading: true, error: false } });
  }
  return pending;
}

export function refreshHealthStatus(fetchImpl = globalThis.fetch) {
  if (healthInFlight) return healthInFlight;
  let pending;
  pending = Promise.resolve().then(async () => {
    try {
      const response = await fetchImpl(HEALTH_URL, {
        credentials: "same-origin",
        cache: "no-store"
      });
      const data = await readJson(response);
      const healthy = Boolean(response.ok && data?.healthy === true);
      update({
        health: {
          kind: healthy ? "online" : "offline",
          healthy,
          status: data?.status || null,
          lastCompletedAt: data?.lastCompletedAt || null,
          locked: Boolean(data?.locked),
          checkedAt: Date.now(),
          loading: false,
          error: !healthy
        }
      });
      return snapshot.health;
    } catch (error) {
      update({
        health: {
          ...snapshot.health,
          kind: "offline",
          healthy: false,
          loading: false,
          error: true,
          checkedAt: Date.now(),
          lastError: error instanceof Error ? error.message : "The health check could not be reached."
        }
      });
      throw error;
    } finally {
      if (healthInFlight === pending) healthInFlight = null;
    }
  });
  healthInFlight = pending;
  if (snapshot.health.kind === "checking" || snapshot.health.error) {
    update({ health: { ...snapshot.health, loading: true, error: false } });
  }
  return pending;
}

export async function refreshServiceStatus() {
  const results = await Promise.allSettled([
    refreshMaintenanceStatus(),
    refreshHealthStatus()
  ]);
  return { ...snapshot, refreshResults: results.map(result => result.status) };
}

function resumeRefresh() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  const now = Date.now();
  const hasCriticalMaintenance = [...subscribers.values()].some(options => options.criticalMaintenance);
  const maintenanceAge = now - (snapshot.maintenance.checkedAt || 0);
  const healthAge = now - (snapshot.health.checkedAt || 0);
  if (maintenanceAge > (hasCriticalMaintenance ? 2500 : 15000)) {
    void refreshMaintenanceStatus().catch(() => {});
  }
  if ([...subscribers.values()].some(options => options.includeHealth) && healthAge > 15000) {
    void refreshHealthStatus().catch(() => {});
  }
}

function attachResumeListeners() {
  if (focusListenerAttached || typeof window === "undefined") return;
  focusListenerAttached = true;
  window.addEventListener("focus", resumeRefresh);
  window.addEventListener("pageshow", resumeRefresh);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", resumeRefresh);
}

function detachResumeListeners() {
  if (!focusListenerAttached || typeof window === "undefined") return;
  focusListenerAttached = false;
  window.removeEventListener("focus", resumeRefresh);
  window.removeEventListener("pageshow", resumeRefresh);
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", resumeRefresh);
}

function syncTimers() {
  const hasSubscribers = subscribers.size > 0;
  const critical = [...subscribers.values()].some(options => options.criticalMaintenance);
  const wantedMaintenanceInterval = critical ? MAINTENANCE_CRITICAL_INTERVAL : STANDARD_INTERVAL;
  if (!hasSubscribers) {
    if (maintenanceTimer) clearInterval(maintenanceTimer);
    if (healthTimer) clearInterval(healthTimer);
    maintenanceTimer = null;
    maintenanceTimerMs = 0;
    healthTimer = null;
    detachResumeListeners();
    return;
  }
  attachResumeListeners();
  if (!maintenanceTimer || maintenanceTimerMs !== wantedMaintenanceInterval) {
    if (maintenanceTimer) clearInterval(maintenanceTimer);
    maintenanceTimerMs = wantedMaintenanceInterval;
    maintenanceTimer = setInterval(() => {
      void refreshMaintenanceStatus().catch(() => {});
    }, wantedMaintenanceInterval);
  }
  const needsHealth = [...subscribers.values()].some(options => options.includeHealth);
  if (needsHealth && !healthTimer) {
    healthTimer = setInterval(() => {
      void refreshHealthStatus().catch(() => {});
    }, HEALTH_INTERVAL);
  } else if (!needsHealth && healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}

export function subscribeServiceStatus(listener, options = {}) {
  const wasEmpty = subscribers.size === 0;
  subscribers.set(listener, {
    criticalMaintenance: options.criticalMaintenance === true,
    includeHealth: options.includeHealth === true
  });
  syncTimers();
  if (wasEmpty || !snapshot.maintenance.verified) {
    void refreshMaintenanceStatus().catch(() => {});
  }
  if (options.includeHealth && (wasEmpty || !snapshot.health.checkedAt)) {
    void refreshHealthStatus().catch(() => {});
  }
  return () => {
    subscribers.delete(listener);
    syncTimers();
  };
}

export function useServiceStatus(options = {}) {
  const criticalMaintenance = options.criticalMaintenance === true;
  const includeHealth = options.includeHealth === true;
  const subscribe = useCallback(
    listener => subscribeServiceStatus(listener, { criticalMaintenance, includeHealth }),
    [criticalMaintenance, includeHealth]
  );
  return useSyncExternalStore(subscribe, getServiceStatusSnapshot, getServiceStatusSnapshot);
}
