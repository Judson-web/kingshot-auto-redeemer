import React, { useEffect, useState } from "react";
import { BellRing, CheckCircle2, LogOut, Send, ShieldCheck, LoaderCircle, AlertTriangle, Eye, EyeOff, Gift, MessageSquareText } from "lucide-react";

export default function PushConsoleApp() {
  const [passkey, setPasskey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("/gift-codes");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/custom-message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "CHECK" }), credentials: "same-origin", cache: "no-store" })
      .then(response => { if (alive) setAuthed(response.ok); })
      .catch(() => {})
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);

  const login = async event => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/custom-message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "LOGIN", passkey }), credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || "Could not authenticate.");
      setAuthed(true); setPasskey("");
    } catch (e) { setError(e instanceof Error ? e.message : "Authentication failed."); }
    finally { setBusy(false); }
  };

  const send = async event => {
    event.preventDefault(); setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/custom-message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "PUSH_SEND", title, message, url }), credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { setAuthed(false); throw Error("Your session expired. Sign in again."); }
      if (!response.ok) throw Error(data.error || "Could not send notification.");
      setResult(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send notification."); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    await fetch("/api/custom-message", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "LOGOUT" }), credentials: "same-origin" }).catch(() => {});
    setAuthed(false);
  };

  const shell = { minHeight: "100vh", padding: "32px 16px", boxSizing: "border-box", background: "var(--bg, #0b0d12)", color: "var(--text, #f4f6fb)", fontFamily: "inherit" };
  const card = { width: "min(100%, 640px)", margin: "0 auto", border: "1px solid var(--border, #303642)", borderRadius: 18, background: "var(--panel, #151922)", padding: "clamp(18px, 4vw, 28px)", boxSizing: "border-box" };
  const input = { display: "block", width: "100%", boxSizing: "border-box", marginTop: 8, padding: "12px 13px", borderRadius: 10, border: "1px solid var(--border, #303642)", background: "var(--bg, #0b0d12)", color: "inherit", font: "inherit", outlineOffset: 2 };
  const label = { display: "block", marginTop: 18, fontSize: 11, fontWeight: 750, letterSpacing: ".08em", color: "var(--muted, #a8afbf)" };
  const button = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", marginTop: 20, padding: "13px 15px", border: 0, borderRadius: 11, background: "#6679ff", color: "white", font: "inherit", fontWeight: 750, cursor: busy ? "wait" : "pointer", opacity: busy ? .7 : 1 };
  if (checking) return <main style={shell}><section style={{ ...card, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}><LoaderCircle className="spin" size={20}/> Checking secure session…</section></main>;

  return <main style={shell}>
    <section style={card}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <span style={{ display: "grid", placeItems: "center", width: 46, height: 46, borderRadius: 14, background: "#6679ff22", color: "#aeb7ff" }}><BellRing size={23}/></span>
        <div style={{ flex: 1 }}><div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".12em", color: "#aeb7ff" }}>PRIVATE DEVELOPER TOOL</div><h1 style={{ margin: "5px 0 0", fontSize: "clamp(23px, 5vw, 30px)", letterSpacing: "-.04em" }}>Push notification console</h1></div>
        {authed && <button type="button" onClick={logout} title="Sign out" aria-label="Sign out" style={{ ...button, width: "auto", margin: 0, padding: 10, background: "#ffffff10" }}><LogOut size={16}/></button>}
      </header>
      {!authed ? <><p style={{ color: "var(--muted, #a8afbf)", lineHeight: 1.6 }}>Sign in with the dedicated private console passkey. This page uses the existing server-side session and does not expose push credentials.</p>
        <form onSubmit={login}><label style={label}>ACCESS PASSKEY<div style={{ position: "relative" }}><input style={{ ...input, paddingRight: 48 }} type={showPass ? "text" : "password"} value={passkey} onChange={e => setPasskey(e.target.value)} autoComplete="off" autoFocus placeholder="Enter your passkey" required/><button type="button" onClick={() => setShowPass(v => !v)} aria-label={showPass ? "Hide passkey" : "Show passkey"} style={{ position: "absolute", right: 8, top: 12, border: 0, background: "transparent", color: "inherit", padding: 7 }}>{showPass ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></label><button style={button} disabled={busy || !passkey}>{busy ? <LoaderCircle className="spin" size={17}/> : <ShieldCheck size={17}/>} Unlock console</button></form>
      </> : <><p style={{ color: "var(--muted, #a8afbf)", lineHeight: 1.6, marginTop: 0 }}>Send a push notification to all subscribed devices. This does not post to Discord.</p>
        <div style={{ display: "grid", gap: 10, padding: 14, borderRadius: 12, background: "#ffffff07", border: "1px solid #ffffff12", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}><Gift size={17} color="#aeb7ff"/><span style={{ fontSize: 12, lineHeight: 1.5 }}>Gift-code alerts are sent automatically after a code is verified.</span></div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}><MessageSquareText size={17} color="#aeb7ff"/><span style={{ fontSize: 12, lineHeight: 1.5 }}>Use this page for manual developer announcements and important updates.</span></div>
        </div>
        <form onSubmit={send}>
          <label style={label}>NOTIFICATION TITLE <span style={{ float: "right", fontWeight: 500 }}>{title.length}/100</span><input style={input} value={title} onChange={e => { setTitle(e.target.value.slice(0, 100)); setResult(null); }} maxLength={100} required placeholder="e.g. Important site update"/></label>
          <label style={label}>MESSAGE <span style={{ float: "right", fontWeight: 500 }}>{message.length}/220</span><textarea style={{ ...input, resize: "vertical", minHeight: 105, lineHeight: 1.5 }} value={message} onChange={e => { setMessage(e.target.value.slice(0, 220)); setResult(null); }} maxLength={220} required placeholder="Write a short message users will see on their device…"/></label>
          <label style={label}>OPEN THIS PAGE WHEN TAPPED<select style={input} value={url} onChange={e => setUrl(e.target.value)}><option value="/gift-codes">Gift codes</option><option value="/">Auto redeem home</option><option value="/manual">Manual redeem</option><option value="/info">Information</option></select></label>
          <div style={{ marginTop: 14, padding: 14, borderRadius: 12, background: "#ffffff07", border: "1px solid #ffffff12" }}><div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em", color: "#aeb7ff", marginBottom: 10 }}>PREVIEW</div><strong style={{ display: "block", fontSize: 15 }}>{title || "Your notification title"}</strong><p style={{ margin: "5px 0 0", lineHeight: 1.5, color: "var(--muted, #a8afbf)", overflowWrap: "anywhere" }}>{message || "Your notification message will appear here."}</p><small style={{ display: "block", marginTop: 10, color: "var(--muted, #a8afbf)" }}>Kingshot Redeemer · just now</small></div>
          <button style={button} disabled={busy || !title.trim() || !message.trim()}>{busy ? <LoaderCircle className="spin" size={17}/> : <Send size={17}/>} Send push notification</button>
        </form>
        {result && <div role="status" style={{ display: "flex", gap: 9, marginTop: 16, padding: 13, borderRadius: 11, background: "#56d6a00d", border: "1px solid #56d6a033", color: "#a9efcd", lineHeight: 1.5 }}><CheckCircle2 size={18} style={{ flexShrink: 0 }}/><span>Push sent. Accepted by {result.sent || 0} subscription(s). {result.failed ? result.failed + " failed." : ""} {result.removed ? result.removed + " expired subscription(s) removed." : ""}</span></div>}
      </>}
      {error && <div role="alert" style={{ display: "flex", gap: 9, marginTop: 16, padding: 13, borderRadius: 11, background: "#ef646310", border: "1px solid #ef646433", color: "#ffb0b0", lineHeight: 1.5 }}><AlertTriangle size={17} style={{ flexShrink: 0 }}/><span>{error}</span></div>}
      <footer style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid #ffffff12", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", color: "var(--muted, #a8afbf)", fontSize: 11 }}><span>Private access · Authorized use only</span><a href="/message" style={{ color: "inherit" }}>Open Discord message console ↗</a></footer>
    </section>
  </main>;
}
