import { useCallback, useSyncExternalStore } from "react";

const API = "/api/kingshot-player?developer=account-auth";
const CACHE_KEY = "ks-profile-chip-v1";
const REFRESH_INTERVAL = 30000;

function readCache() {
  try {
    const value = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    return value && typeof value === "object" &&
      (typeof value.username === "string" || typeof value.display_name === "string" || typeof value.email === "string")
      ? value : null;
  } catch {
    return null;
  }
}

function writeCache(account) {
  try {
    if (account) sessionStorage.setItem(CACHE_KEY, JSON.stringify(account));
    else sessionStorage.removeItem(CACHE_KEY);
  } catch { /* Storage may be unavailable in private browsing. */ }
}

function normalizeAccount(user, response = {}, fallbackKind) {
  if (!user || typeof user !== "object") return null;
  const role = response.role || user.role || (response.kind === "admin" ? "admin" : "user");
  const kind = response.kind || user.kind || fallbackKind || (role === "admin" ? "admin" : role === "developer" ? "developer" : "user");
  return { ...user, role, kind };
}

let cached = readCache();
let snapshot = {
  account: cached ? normalizeAccount(cached) : null,
  status: cached ? "cached" : "checking",
  checkedAt: null,
  lastAttemptAt: null,
  error: null
};
const listeners = new Set();
let requestInFlight = null;
let accountGeneration = 0;
let refreshTimer = null;
let listenersAttached = false;

function emit() {
  for (const listener of listeners) {
    try { listener(); } catch { /* Keep other account consumers in sync. */ }
  }
}

function publish(next) {
  snapshot = next;
  emit();
}

export function getAccountStateSnapshot() {
  return snapshot;
}

export function setAccountState(account, options = {}) {
  accountGeneration += 1;
  const nextAccount = account ? normalizeAccount(account, account, account.kind) : null;
  writeCache(nextAccount);
  publish({
    account: nextAccount,
    status: nextAccount ? "authenticated" : "anonymous",
    checkedAt: Date.now(),
    lastAttemptAt: Date.now(),
    error: options.error || null
  });
  return snapshot;
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data?.error || "Could not verify your account."), { status: response.status });
  }
  return data;
}

export function refreshAccount(options = {}) {
  if (requestInFlight) return requestInFlight;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const startGeneration = accountGeneration;
  publish({ ...snapshot, lastAttemptAt: Date.now(), error: null });
  requestInFlight = (async () => {
    try {
      const profileResponse = await fetchImpl(API, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "profile-check" })
      });
      const profileData = await parseResponse(profileResponse);
      if (accountGeneration !== startGeneration) return snapshot.account;
      if (profileData?.authenticated === true && profileData.user) {
        const account = normalizeAccount(profileData.user, profileData);
        writeCache(account);
        publish({ account, status: "authenticated", checkedAt: Date.now(), lastAttemptAt: Date.now(), error: null });
        return account;
      }

      const developerResponse = await fetchImpl(API, {
        credentials: "same-origin",
        cache: "no-store"
      });
      const developerData = await parseResponse(developerResponse);
      if (accountGeneration !== startGeneration) return snapshot.account;
      if (developerData?.authenticated === true && developerData.user) {
        const role = developerData.role || developerData.user.role || "developer";
        const account = normalizeAccount(developerData.user, developerData, role === "admin" ? "admin" : "developer");
        writeCache(account);
        publish({ account, status: "authenticated", checkedAt: Date.now(), lastAttemptAt: Date.now(), error: null });
        return account;
      }

      writeCache(null);
      publish({ account: null, status: "anonymous", checkedAt: Date.now(), lastAttemptAt: Date.now(), error: null });
      return null;
    } catch (error) {
      if (accountGeneration !== startGeneration) return snapshot.account;
      publish({
        ...snapshot,
        status: snapshot.account ? "cached" : "error",
        lastAttemptAt: Date.now(),
        error: error instanceof Error ? error.message : "Could not verify your account."
      });
      return snapshot.account;
    } finally {
      requestInFlight = null;
    }
  })();
  return requestInFlight;
}

function resumeRefresh() {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  const lastAttempt = snapshot.lastAttemptAt || 0;
  if (Date.now() - lastAttempt >= 10000) void refreshAccount();
}

function onLegacyProfileUpdate() {
  void refreshAccount();
}

function attachListeners() {
  if (listenersAttached || typeof window === "undefined") return;
  listenersAttached = true;
  window.addEventListener("focus", resumeRefresh);
  window.addEventListener("pageshow", resumeRefresh);
  window.addEventListener("ks-profile-updated", onLegacyProfileUpdate);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", resumeRefresh);
  refreshTimer = setInterval(() => {
    void refreshAccount();
  }, REFRESH_INTERVAL);
}

function detachListeners() {
  if (!listenersAttached || typeof window === "undefined") return;
  listenersAttached = false;
  window.removeEventListener("focus", resumeRefresh);
  window.removeEventListener("pageshow", resumeRefresh);
  window.removeEventListener("ks-profile-updated", onLegacyProfileUpdate);
  if (typeof document !== "undefined") document.removeEventListener("visibilitychange", resumeRefresh);
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

export function subscribeAccountState(listener) {
  const wasEmpty = listeners.size === 0;
  listeners.add(listener);
  if (wasEmpty) attachListeners();
  if (wasEmpty || snapshot.status === "checking" || Date.now() - (snapshot.lastAttemptAt || 0) >= REFRESH_INTERVAL) {
    // OAuth redirects carry a one-time access token in the fragment. Let the
    // callback establish its server session before attempting profile-check.
    const oauthPending = typeof window !== "undefined" &&
      new URLSearchParams(window.location.hash.slice(1)).has("access_token");
    if (!oauthPending) void refreshAccount();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) detachListeners();
  };
}

export function useAccountState() {
  const subscribe = useCallback(listener => subscribeAccountState(listener), []);
  return useSyncExternalStore(subscribe, getAccountStateSnapshot, getAccountStateSnapshot);
}
