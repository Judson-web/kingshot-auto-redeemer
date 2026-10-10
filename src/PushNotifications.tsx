import React, { useEffect, useState } from "react";
import { Bell, BellOff, CheckCircle2, LoaderCircle, X } from "lucide-react";

type PushState = "checking" | "unsupported" | "disabled" | "enabled" | "unconfigured";
type ApiReply = { publicKey?: string; error?: string; ok?: boolean };

function decodeVapidKey(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - value.length % 4) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

async function post(body: Record<string, unknown>): Promise<ApiReply> {
  const response = await fetch("/api/push", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({})) as ApiReply;
  if (!response.ok) throw new Error(data.error || "Notification request failed.");
  return data;
}

export default function PushNotifications() {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (["/message", "/terms", "/privacy"].includes(window.location.pathname)) {
      setState("unsupported");
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    let live = true;
    navigator.serviceWorker.ready.then(async registration => {
      const subscription = await registration.pushManager.getSubscription();
      if (!live) return;
      setState(subscription ? "enabled" : Notification.permission === "denied" ? "disabled" : "disabled");
    }).catch(() => { if (live) setState("disabled"); });
    return () => { live = false; };
  }, []);

  if (state === "unsupported") return null;

  const enable = async () => {
    setBusy(true); setMessage("");
    try {
      if (!("Notification" in window) || !("PushManager" in window) || !("serviceWorker" in navigator)) {
        throw new Error("This browser does not support web push notifications.");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notification permission was not granted. You can change it in your browser settings.");
      const config = await post({ action: "PUBLIC_KEY" });
      if (!config.publicKey) throw new Error(config.error || "Push notifications are not configured yet.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(config.publicKey) as BufferSource,
      });
      const saved = await post({ action: "SUBSCRIBE", subscription: subscription.toJSON() });
      if (!saved.ok) throw new Error(saved.error || "Could not save your subscription.");
      setState("enabled");
      setMessage("You're subscribed to developer announcements and new gift-code alerts.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not enable notifications.");
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true); setMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await post({ action: "UNSUBSCRIBE", endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setState("disabled");
      setMessage("Browser notifications are turned off.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disable notifications.");
    } finally { setBusy(false); }
  };

  return <div className="ks-push-widget">
    {open && <section className="ks-push-panel" aria-label="Browser notification settings">
      <div className="ks-push-panel-head">
        <span className="ks-push-icon"><Bell size={17}/></span>
        <div><b>Stay in the loop</b><small>Only two kinds of alerts</small></div>
        <button type="button" aria-label="Close notification settings" onClick={() => setOpen(false)}><X size={16}/></button>
      </div>
      <ul><li>Custom developer announcements</li><li>New Kingshot gift-code discoveries</li></ul>
      {state === "enabled" ? <div className="ks-push-enabled"><CheckCircle2 size={15}/> Notifications enabled</div> :
        <button type="button" className="ks-push-action" onClick={enable} disabled={busy || state === "checking"}>
          {busy ? <LoaderCircle className="ks-push-spin" size={15}/> : <Bell size={15}/>} Enable notifications
        </button>}
      {state === "enabled" && <button type="button" className="ks-push-secondary" onClick={disable} disabled={busy}>
        {busy ? <LoaderCircle className="ks-push-spin" size={14}/> : <BellOff size={14}/>} Turn off notifications
      </button>}
      {message && <p className="ks-push-message" role="status">{message}</p>}
      {state === "disabled" && "Notification" in window && Notification.permission === "denied" && <p className="ks-push-message">Permission is blocked by your browser. Enable it in site settings first.</p>}
    </section>}
    <button type="button" className="ks-push-trigger" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-label="Notification settings">
      {state === "enabled" ? <CheckCircle2 size={17}/> : <Bell size={17}/>}<span>{state === "enabled" ? "Notifications on" : "Get updates"}</span>
    </button>
  </div>;
}
