import React, { useEffect, useState } from "react";
import { Bell, BellRing, CheckCircle2, LoaderCircle, X } from "lucide-react";
import {useSiteLanguage} from "../shared/site-language.js";

type PushState = "checking" | "unsupported" | "denied" | "off" | "on" | "busy" | "error";

function encodeKey(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

const panelStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: 30,
  right: 16,
  bottom: "calc(84px + env(safe-area-inset-bottom, 0px))",
  width: "min(420px, calc(100vw - 32px))",
  boxSizing: "border-box",
  border: "1px solid var(--border, #303642)",
  borderRadius: 16,
  background: "var(--panel, #151922)",
  color: "var(--text, #f4f6fb)",
  boxShadow: "0 14px 40px #0006",
  fontSize: 14,
};

const buttonStyle: React.CSSProperties = {
  minHeight: 42,
  padding: "10px 14px",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

export default function PushNotifications() {
  const {t}=useSiteLanguage();
  const [state, setState] = useState<PushState>("checking");
  const [hidden, setHidden] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
          if (alive) { setState("unsupported"); setHidden(true); }
          return;
        }
        const permission = Notification.permission;
        let sub: PushSubscription | null = null;
        let currentKey: ArrayBuffer | null = null;
        try {
          const reg = await navigator.serviceWorker.ready;
          sub = await reg.pushManager.getSubscription();
          const keyResponse = await fetch("/api/custom-message", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "PUSH_PUBLIC_KEY" }),
            credentials: "same-origin",
            cache: "no-store",
          });
          const keyData = await keyResponse.json().catch(() => ({}));
          if (keyResponse.ok && keyData.publicKey) currentKey = encodeKey(keyData.publicKey);
        } catch {}
        if (!alive) return;

        // Browser push subscriptions are bound to the VAPID public key used
        // when they were created. A rotated key makes the old subscription
        // unusable, so retire it and show the opt-in panel again.
        let staleSubscription = false;
        if (permission === "granted" && sub && currentKey) {
          const existingKey = sub.options.applicationServerKey;
          const existingBytes = existingKey ? new Uint8Array(existingKey) : null;
          const currentBytes = new Uint8Array(currentKey);
          staleSubscription = !existingBytes || existingBytes.length !== currentBytes.length ||
            existingBytes.some((value, index) => value !== currentBytes[index]);
          if (staleSubscription) {
            await fetch("/api/custom-message", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ action: "PUSH_UNSUBSCRIBE", subscription: sub.toJSON() }),
              credentials: "same-origin",
            }).catch(() => {});
            await sub.unsubscribe().catch(() => {});
            sub = null;
          }
        }

        let dismissed = false;
        try {
          // Start a fresh dismissal generation so everyone sees the updated
          // VAPID opt-in prompt once, including people who dismissed v3.
          dismissed = localStorage.getItem("ks-push-panel-dismissed-v4") === "1";
          if (staleSubscription) {
            dismissed = false;
            localStorage.removeItem("ks-push-panel-dismissed-v4");
          }
        } catch {}
        setHidden(dismissed);
        if (permission === "denied") setState("denied");
        else if (permission === "granted" && sub && currentKey) setState("on");
        else setState("off");
      } finally { checking = false; }
    };
    void check();
    const onResume = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", onResume);
    window.addEventListener("pageshow", onResume);
    document.addEventListener("visibilitychange", onResume);
    const timer = window.setInterval(onResume, 30000);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("focus", onResume); window.removeEventListener("pageshow", onResume); document.removeEventListener("visibilitychange", onResume); };
  }, []);

  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem("ks-push-panel-dismissed-v4", "1"); } catch {}
  };

  const toggle = async () => {
    setState("busy");
    setMessage("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        throw Error(t("pushNotifications.unsupported","This browser does not support web push notifications."));
      }
      const reg = await navigator.serviceWorker.ready;
      let existing = await reg.pushManager.getSubscription();
      const keyResponse = await fetch("/api/custom-message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "PUSH_PUBLIC_KEY" }),
        credentials: "same-origin",
        cache: "no-store",
      });
      const keyData = await keyResponse.json().catch(() => ({}));
      if (!keyResponse.ok || !keyData.publicKey) throw Error(keyData.error || t("pushNotifications.notConfigured","Push notifications aren't configured yet."));
      const applicationServerKey = encodeKey(keyData.publicKey);
      if (existing && Notification.permission === "granted") {
        const oldKey = existing.options.applicationServerKey;
        const oldBytes = oldKey ? new Uint8Array(oldKey) : null;
        const newBytes = new Uint8Array(applicationServerKey);
        const keyChanged = !oldBytes || oldBytes.length !== newBytes.length ||
          oldBytes.some((value, index) => value !== newBytes[index]);
        if (keyChanged) {
          await fetch("/api/custom-message", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "PUSH_UNSUBSCRIBE", subscription: existing.toJSON() }),
            credentials: "same-origin",
          }).catch(() => {});
          await existing.unsubscribe().catch(() => {});
          existing = null;
          try { localStorage.removeItem("ks-push-panel-dismissed-v4"); } catch {}
        }
      }
      if (existing && Notification.permission === "granted") {
        const response = await fetch("/api/custom-message", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "PUSH_UNSUBSCRIBE", subscription: existing.toJSON() }),
          credentials: "same-origin",
        });
        if (!response.ok) throw Error((await response.json().catch(() => ({}))).error || t("pushNotifications.turnOffFailed","We couldn't turn notifications off. Please try again."));
        await existing.unsubscribe();
        setState("off");
        setMessage(t("pushNotifications.offMessage","Notifications are off on this device."));
        return;
      }

      // A subscription can outlive a browser permission reset. Remove that stale
      // subscription before asking for permission and creating a fresh one.
      if (existing && Notification.permission !== "granted") {
        await fetch("/api/custom-message", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "PUSH_UNSUBSCRIBE", subscription: existing.toJSON() }),
          credentials: "same-origin",
        }).catch(() => {});
        await existing.unsubscribe().catch(() => {});
      }

      const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        throw Error(permission === "denied"
          ? t("pushNotifications.permissionBlocked","Notifications are blocked in your browser. Allow them in site settings, then try again.")
          : t("pushNotifications.permissionNotGranted","Notification permission wasn't granted. You can try again whenever you're ready."));
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
      const saveResponse = await fetch("/api/custom-message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "PUSH_SUBSCRIBE", subscription: subscription.toJSON() }),
        credentials: "same-origin",
      });
      if (!saveResponse.ok) {
        await subscription.unsubscribe().catch(() => {});
        throw Error((await saveResponse.json().catch(() => ({}))).error || t("pushNotifications.saveFailed","We couldn't save this device. Please try again."));
      }
      setState("on");
      setMessage(t("pushNotifications.enabledMessage","Notifications are enabled on this device."));
    } catch (error) {
      setState(current => current === "denied" ? "denied" : "error");
      setMessage(error instanceof Error ? error.message : t("pushNotifications.updateFailed","We couldn't update notification settings. Please try again."));
    }
  };

  if (["unsupported", "checking"].includes(state) || hidden) return null;
  const enabled = state === "on";
  const busy = state === "busy";

  return (
    <aside style={panelStyle} aria-label={t("pushNotifications.panelLabel","Notification opt-in")}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 16px 12px" }}>
        <div style={{
          display: "grid", placeItems: "center", flex: "0 0 42px", width: 42, height: 42,
          borderRadius: 12, background: enabled ? "#176b50" : "#167fc0", color: "#fff",
        }}>
          {enabled ? <BellRing size={21} /> : <Bell size={21} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ display: "block", fontSize: 15, lineHeight: 1.35 }}>
            {enabled ? t("pushNotifications.titleOn","Notifications are on") : state === "denied" ? t("pushNotifications.titleBlocked","Notifications are blocked") : t("pushNotifications.titleOff","Never miss a new gift code")}
          </strong>
          <p style={{ margin: "5px 0 0", color: "var(--muted, #a8afbf)", fontSize: 12, lineHeight: 1.5 }}>
            {enabled
              ? t("pushNotifications.descriptionOn","Get alerts for new gift codes and important site updates.")
              : state === "denied" ? t("pushNotifications.descriptionBlocked","Allow notifications in your browser’s site settings, then retry here.") : t("pushNotifications.descriptionOff","Get alerts for new Kingshot gift codes and important site updates.")}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("pushNotifications.dismiss","Not now; dismiss notification prompt")}
          style={{ display: "grid", placeItems: "center", flex: "0 0 30px", width: 30, height: 30, padding: 0, border: 0, borderRadius: 8, background: "transparent", color: "var(--muted, #a8afbf)", cursor: "pointer" }}
        >
          <X size={17} />
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, padding: "0 16px 16px" }}>
        {!enabled && state !== "denied" && (
          <button
            type="button"
            onClick={dismiss}
            style={{ ...buttonStyle, flex: "1 1 0", border: "1px solid var(--border, #303642)", background: "transparent", color: "var(--text, #f4f6fb)" }}
          >
            {t("pushNotifications.notNow","Not now")}
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void toggle()}
          style={{
            ...buttonStyle,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            flex: "1 1 0",
            border: 0,
            background: enabled ? "#ffffff12" : "#168bd2",
            color: "#fff",
            opacity: busy ? 0.7 : 1,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : enabled ? <CheckCircle2 size={16} /> : <Bell size={16} />}
          {busy ? t("pushNotifications.pleaseWait","Please wait…") : enabled ? t("pushNotifications.turnOff","Turn off") : state === "denied" ? t("pushNotifications.retry","Retry after allowing") : t("pushNotifications.enable","Enable notifications")}
        </button>
      </div>

      {message && (
        <div
          role={state === "error" ? "alert" : "status"}
          aria-live={state === "error" ? "assertive" : "polite"}
          style={{
            margin: "0 16px 16px",
            padding: 10,
            borderRadius: 9,
            background: state === "error" ? "#ef646310" : "#56d6a00d",
            color: state === "error" ? "#ffb0b0" : "#a9efcd",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          {message}
        </div>
      )}
    </aside>
  );
}
