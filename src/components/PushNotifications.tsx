import React, { useEffect, useState } from "react";
import { Bell, BellRing, Check, CheckCircle2, ChevronDown, Gift, LoaderCircle, MessageSquareText, ShieldCheck, X } from "lucide-react";

type PushState = "checking" | "unsupported" | "denied" | "off" | "on" | "busy" | "error";
function encodeKey(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

const panelStyle: React.CSSProperties = {
  position: "fixed", zIndex: 30, right: 16, bottom: "max(16px, env(safe-area-inset-bottom))",
  width: "min(360px, calc(100vw - 32px))", overflow: "hidden",
  border: "1px solid var(--border, #303642)", borderRadius: 18,
  background: "var(--panel, #151922)", color: "var(--text, #f4f6fb)",
  boxShadow: "0 18px 50px #0007", fontSize: 14,
};
const quietButton: React.CSSProperties = { display: "grid", placeItems: "center", width: 32, height: 32, border: 0, borderRadius: 9, background: "transparent", color: "inherit", cursor: "pointer" };

export default function PushNotifications() {
  const [state, setState] = useState<PushState>("checking");
  const [hidden, setHidden] = useState(false);
  const [message, setMessage] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (alive) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (alive) setState("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (alive) setState(sub ? "on" : "off");
      } catch {
        if (alive) setState("off");
      }
    };
    void check();
    return () => { alive = false; };
  }, []);

  const toggle = async () => {
    setState("busy");
    setMessage("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        throw Error("This browser does not support web push notifications.");
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        const response = await fetch("/api/custom-message", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "PUSH_UNSUBSCRIBE", subscription: existing.toJSON() }), credentials: "same-origin",
        });
        if (!response.ok) throw Error((await response.json().catch(() => ({}))).error || "We couldn't turn notifications off. Please try again.");
        await existing.unsubscribe();
        setState("off");
        setMessage("Notifications are off on this device.");
        return;
      }

      const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        throw Error(permission === "denied"
          ? "Notifications are blocked in your browser. Allow them in site settings, then try again."
          : "Notification permission wasn't granted. You can try again whenever you're ready.");
      }

      const keyResponse = await fetch("/api/custom-message", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "PUSH_PUBLIC_KEY" }), credentials: "same-origin", cache: "no-store",
      });
      const keyData = await keyResponse.json().catch(() => ({}));
      if (!keyResponse.ok || !keyData.publicKey) throw Error(keyData.error || "Push notifications aren't configured yet.");

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: encodeKey(keyData.publicKey),
      });
      const saveResponse = await fetch("/api/custom-message", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "PUSH_SUBSCRIBE", subscription: subscription.toJSON() }), credentials: "same-origin",
      });
      if (!saveResponse.ok) {
        await subscription.unsubscribe().catch(() => {});
        throw Error((await saveResponse.json().catch(() => ({}))).error || "We couldn't save this device. Please try again.");
      }
      setState("on");
      setMessage("This device is subscribed. You'll be notified when verified gift codes become available or the developer sends a message.");
    } catch (error) {
      setState(current => current === "denied" ? "denied" : "error");
      setMessage(error instanceof Error ? error.message : "We couldn't update notification settings. Please try again.");
    }
  };

  if (["unsupported", "denied", "checking"].includes(state) || hidden) return null;
  const enabled = state === "on";
  const busy = state === "busy";

  return (
    <aside style={panelStyle} aria-label="Push notification settings">
      <div style={{ padding: "16px 16px 14px", background: enabled ? "linear-gradient(120deg, #153d32, #17251f)" : "linear-gradient(120deg, #242b46, #191e2e)", borderBottom: "1px solid #ffffff12" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ display: "grid", placeItems: "center", flex: "0 0 42px", width: 42, height: 42, borderRadius: 13, background: enabled ? "#2a8060" : "#5969c9", color: "white" }}>
            {enabled ? <BellRing size={21} /> : <Bell size={21} />}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 15, letterSpacing: "-.2px" }}>Stay in the loop</strong>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 7px", borderRadius: 999, background: enabled ? "#b6f2d51b" : "#ffffff12", color: enabled ? "#a9efcd" : "#c7caff", fontSize: 10, fontWeight: 750, letterSpacing: ".6px" }}>
                {enabled ? <Check size={11} /> : <span style={{ width: 5, height: 5, borderRadius: 99, background: "#aab4ff" }} />}
                {enabled ? "ENABLED" : "OPTIONAL"}
              </span>
            </div>
            <p style={{ margin: "5px 0 0", color: "var(--muted, #a8afbf)", lineHeight: 1.45, fontSize: 12 }}>
              {enabled ? "You're all set on this device." : "Get the important Kingshot updates without keeping the site open."}
            </p>
          </div>
          <button type="button" onClick={() => setHidden(true)} aria-label="Dismiss notification settings" style={quietButton}><X size={16} /></button>
        </div>
      </div>

      <div style={{ padding: 16 }}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{ display: "grid", placeItems: "center", width: 30, height: 30, flex: "0 0 30px", borderRadius: 9, background: "#6f7cff18", color: "#aeb7ff" }}><Gift size={16} /></span>
            <div><strong style={{ display: "block", fontSize: 13 }}>Verified gift codes</strong><span style={{ display: "block", marginTop: 3, color: "var(--muted, #a8afbf)", fontSize: 12, lineHeight: 1.45 }}>Get an alert when a newly available code is verified and ready to use.</span></div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{ display: "grid", placeItems: "center", width: 30, height: 30, flex: "0 0 30px", borderRadius: 9, background: "#6f7cff18", color: "#aeb7ff" }}><MessageSquareText size={16} /></span>
            <div><strong style={{ display: "block", fontSize: 13 }}>Developer messages</strong><span style={{ display: "block", marginTop: 3, color: "var(--muted, #a8afbf)", fontSize: 12, lineHeight: 1.45 }}>Receive custom announcements from the site developer.</span></div>
          </div>
        </div>

        <button type="button" onClick={() => setDetailsOpen(value => !value)} aria-expanded={detailsOpen} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14, padding: "5px 0", border: 0, background: "transparent", color: "var(--muted, #a8afbf)", fontSize: 11, cursor: "pointer" }}>
          <ShieldCheck size={13} /> Your choice, your device <ChevronDown size={13} style={{ transform: detailsOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
        </button>
        {detailsOpen && <p style={{ margin: "4px 0 0", padding: 10, borderRadius: 10, background: "#ffffff08", color: "var(--muted, #a8afbf)", fontSize: 11, lineHeight: 1.55 }}>
          Notifications are optional and can be turned off here at any time. We only send verified new gift-code alerts and custom developer messages—never redemption or account alerts.
        </p>}

        <button type="button" disabled={busy} onClick={() => void toggle()} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", marginTop: 14, padding: "12px 14px", borderRadius: 11, border: enabled ? "1px solid #ffffff20" : 0, background: enabled ? "#ffffff0b" : "#6679ff", color: "white", fontWeight: 750, fontSize: 13, cursor: busy ? "wait" : "pointer", opacity: busy ? .7 : 1 }}>
          {busy ? <LoaderCircle size={16} className="spin" /> : enabled ? <CheckCircle2 size={16} /> : <Bell size={16} />}
          {busy ? (enabled ? "Updating settings…" : "Enabling notifications…") : enabled ? "Turn notifications off" : "Enable notifications"}
        </button>

        {message && <div role={state === "error" ? "alert" : "status"} aria-live={state === "error" ? "assertive" : "polite"} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, padding: 11, borderRadius: 10, border: "1px solid " + (state === "error" ? "#ef646433" : enabled ? "#56d6a033" : "#ffffff14"), background: state === "error" ? "#ef646310" : enabled ? "#56d6a00d" : "#ffffff08", color: state === "error" ? "#ffb0b0" : enabled ? "#a9efcd" : "var(--muted, #a8afbf)", fontSize: 12, lineHeight: 1.5 }}>
          {state === "error" ? <X size={15} style={{ flex: "0 0 auto", marginTop: 1 }} /> : enabled ? <CheckCircle2 size={15} style={{ flex: "0 0 auto", marginTop: 1 }} /> : <Bell size={15} style={{ flex: "0 0 auto", marginTop: 1 }} />}
          <span>{message}</span>
        </div>}
      </div>
    </aside>
  );
}
