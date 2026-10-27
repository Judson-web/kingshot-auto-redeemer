import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CheckCircle, Clock3, Copy, Gift, LoaderCircle, LogOut, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { copyToClipboard } from "./utils/clipboard-feedback";
import { useSiteLanguage } from "./shared/site-language.js";

const api = (body) => fetch("/api/custom-message", {
  method: "POST",
  credentials: "same-origin",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  cache: "no-store",
}).then(async (response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || "Request failed.");
  return data;
});
const formatDate = (value) => value ? new Date(value).toLocaleString() : "—";
const isExpired = (item) => Boolean(item.expires_at && Date.parse(item.expires_at) <= Date.now());
const isEffective = (item) => Boolean(item.active && !isExpired(item) && item.validation_status === "verified" && !item.suppressed);
const statusOf = (item) => {
  if (item.suppressed) return "blocked";
  if (item.validation_status === "pending") return "pending";
  if (item.validation_status === "invalid") return "invalid";
  if (item.validation_status === "usage_limit") return "usage_limit";
  if (item.validation_status === "indeterminate") return "indeterminate";
  if (item.validation_status === "expired" || isExpired(item)) return "expired";
  return isEffective(item) ? "active" : "inactive";
};
const statusLabelKeys = {
  active: ["giftCodes.statusActive", "Verified & active"], pending: ["giftCodes.statusPending", "Pending verification"],
  invalid: ["giftCodes.statusInvalid", "Invalid"], usage_limit: ["giftCodes.statusUsageLimit", "Usage limit"],
  indeterminate: ["giftCodes.statusRetry", "Needs retry"], expired: ["giftCodes.statusExpired", "Expired"],
  blocked: ["giftCodes.statusBlocked", "Blocked"], inactive: ["giftCodes.statusInactive", "Inactive"],
};
const statusColors = {
  active: { bg: "#163124", fg: "#a7e4bd", border: "#28563d" },
  pending: { bg: "#352b18", fg: "#f2d18c", border: "#65502a" },
  blocked: { bg: "#351f27", fg: "#f0aab5", border: "#633642" },
  invalid: { bg: "#351f27", fg: "#f0aab5", border: "#633642" },
  expired: { bg: "#2b2d34", fg: "#b8bdc9", border: "#424652" },
  inactive: { bg: "#252834", fg: "#c3c8d4", border: "#414655" },
  usage_limit: { bg: "#30271b", fg: "#e8c797", border: "#5a472c" },
  indeterminate: { bg: "#29243b", fg: "#d0c1ff", border: "#4d416e" },
};
const base = {
  color: "#e9edf5", fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif",
};
const button = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
  minHeight: 38, padding: "9px 12px", border: "1px solid #343b4b",
  borderRadius: 10, background: "#171c26", color: "#e4e8f0",
  fontSize: 12, fontWeight: 700, cursor: "pointer",
};
const input = {
  width: "100%", minWidth: 0, boxSizing: "border-box", padding: "11px 12px",
  border: "1px solid #343b4b", borderRadius: 10, background: "#0c1018",
  color: "#f1f4fa", fontSize: 13, outlineOffset: 2,
};
const panel = { background: "#11151e", border: "1px solid #252c39", borderRadius: 16 };

export default function GiftCodesApp() {
  const { t } = useSiteLanguage();
  const statusLabels = Object.fromEntries(Object.entries(statusLabelKeys).map(([key, [translationKey, fallback]]) => [key, t(translationKey, fallback)]));
  const [confirmManual, setConfirmManual] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [codes, setCodes] = useState([]);
  const [code, setCode] = useState("");
  const [expires, setExpires] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [refreshedAt, setRefreshedAt] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const data = await api({ action: "GIFT_CODE_LIST" });
      setCodes(Array.isArray(data.codes) ? data.codes : []);
      setRefreshedAt(new Date());
    } catch (err) {
      setError(err.message || t("giftCodes.loadFailed","Could not load the gift-code inventory."));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    api({ action: "CHECK" })
      .then(() => { if (live) { setAuthed(true); return load(); } })
      .catch(() => {})
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [load]);

  const run = async (action, extra = {}) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await api({ action, ...extra });
      if (action === "LOGOUT") {
        setAuthed(false); setCodes([]);
      } else if (action === "GIFT_CODE_ADD") {
        setCode(""); setExpires(""); setConfirmManual(false);
        setNotice(t("giftCodes.addSuccess","Code manually approved and marked verified. Canary verification was skipped; Kingshot may still reject an expired or invalid code."));
        await load();
      } else if (action === "GIFT_CODE_UPDATE") {
        setNotice(extra.active === false ? t("giftCodes.deactivated","Code removed from the active pool.") : t("giftCodes.reverifyQueued","Code queued for player re-verification."));
        await load();
      } else if (action === "GIFT_CODE_DELETE") {
        setNotice(t("giftCodes.blockedSuccess","Code blocked. Scraper updates will not reactivate it."));
        await load();
      } else if (action === "GIFT_CODE_LIST") {
        setCodes(Array.isArray(data.codes) ? data.codes : []);
        setRefreshedAt(new Date());
        setNotice(t("giftCodes.refreshed","Gift-code inventory refreshed."));
      }
    } catch (err) {
      setError(err.message || t("giftCodes.actionFailed","The action could not be completed."));
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(() => ({
    total: codes.length,
    active: codes.filter(isEffective).length,
    pending: codes.filter((item) => item.validation_status === "pending").length,
    attention: codes.filter((item) => item.suppressed || ["invalid", "expired", "usage_limit"].includes(statusOf(item))).length,
  }), [codes]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return codes.filter((item) => {
      const status = statusOf(item);
      const matchesFilter = filter === "all" || filter === status ||
        (filter === "inactive" && status === "inactive");
      const matchesQuery = !query ||
        String(item.code || "").toLowerCase().includes(query) ||
        String(item.validation_message || "").toLowerCase().includes(query);
      return matchesFilter && matchesQuery;
    });
  }, [codes, filter, search]);

  const shell = {
    ...base, minHeight: "100vh", boxSizing: "border-box", padding: "clamp(16px, 4vw, 36px)",
    background: "radial-gradient(ellipse at 15% -15%, #252044 0, transparent 42%), #090c12",
  };

  if (checking) return <main style={{ ...shell, display: "grid", placeItems: "center" }}><p style={{ color: "#9aa4b6" }}>{t("giftCodes.checking","Checking admin session…")}</p></main>;

  if (!authed) return (
    <main style={{ ...shell, display: "grid", placeItems: "center" }}>
      <section style={{ ...panel, width: "min(100%, 390px)", padding: 24, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <span style={{ display: "grid", placeItems: "center", width: 44, height: 44, borderRadius: 13, background: "#292442", color: "#c8b8ff" }}><ShieldCheck size={22}/></span>
          <div><div style={{ color: "#a99be0", fontSize: 10, fontWeight: 800, letterSpacing: ".14em" }}>{t("giftCodes.brand","KINGSHOT OPERATIONS")}</div><h1 style={{ margin: "4px 0 0", fontSize: 23 }}>{t("giftCodes.title","Gift codes")}</h1></div>
        </div>
        <p style={{ color: "#9aa4b6", fontSize: 13, lineHeight: 1.6 }}>{t("giftCodes.access","Use your existing administrator account to manage the trusted gift-code inventory. No separate passkey is required.")}</p>
        <a href="/profile?returnTo=/gift-codes" style={{ ...button, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", marginTop: 14, background: "#d8c49a", borderColor: "#d8c49a", color: "#17140e", textDecoration: "none", boxSizing: "border-box" }}><ShieldCheck size={15}/> {t("giftCodes.signIn","Sign in with admin account")}</a>
        {error && <p role="alert" style={{ color: "#f0aab5", fontSize: 12 }}>{error}</p>}
      </section>
    </main>
  );

  return (
    <main style={shell}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 26 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <span style={{ display: "grid", placeItems: "center", width: 46, height: 46, borderRadius: 14, background: "#292442", color: "#c8b8ff" }}><Gift size={23}/></span>
            <div><div style={{ color: "#a99be0", fontSize: 10, fontWeight: 850, letterSpacing: ".15em" }}>{t("giftCodes.brand","KINGSHOT OPERATIONS")}</div><h1 style={{ fontSize: "clamp(24px, 4vw, 32px)", letterSpacing: "-.04em", margin: "4px 0" }}>{t("giftCodes.title","Gift codes")}</h1><p style={{ margin: 0, color: "#8b95a7", fontSize: 12 }}>{t("giftCodes.description","Manage codes, review status, and keep the active pool clean.")}</p></div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {refreshedAt && <span style={{ color: "#818b9e", fontSize: 11 }}>Updated {refreshedAt.toLocaleTimeString()}</span>}
            <button type="button" style={button} disabled={busy} onClick={() => run("GIFT_CODE_LIST")}><RefreshCw size={14}/> {t("giftCodes.refresh","Refresh")}</button>
            <button type="button" style={button} disabled={busy} onClick={() => run("LOGOUT")}><LogOut size={14}/> {t("giftCodes.signOut","Sign out")}</button>
          </div>
        </header>

        {error && <div role="alert" style={{ ...panel, display: "flex", alignItems: "flex-start", gap: 10, padding: 14, marginBottom: 14, borderColor: "#633642", color: "#f0aab5" }}><AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }}/><div style={{ flex: 1, fontSize: 12, lineHeight: 1.5 }}><b>{t("giftCodes.attention","Something needs attention")}</b><div>{error}</div></div><button type="button" aria-label={t("giftCodes.dismissError","Dismiss error")} style={{ ...button, minHeight: 28, padding: 5 }} onClick={() => setError("")}><X size={14}/></button></div>}
        {notice && <div role="status" style={{ ...panel, display: "flex", alignItems: "center", gap: 10, padding: 14, marginBottom: 14, borderColor: "#28563d", color: "#a7e4bd" }}><CheckCircle size={17} style={{ flexShrink: 0 }}/><span style={{ flex: 1, fontSize: 12, lineHeight: 1.5 }}>{notice}</span><button type="button" aria-label={t("giftCodes.dismissNotice","Dismiss notification")} style={{ ...button, minHeight: 28, padding: 5 }} onClick={() => setNotice("")}><X size={14}/></button></div>}

        <section aria-label={t("giftCodes.summary","Inventory summary")} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
          {[
            { label: t("giftCodes.total","TOTAL CODES"), value: counts.total, color: "#eef1f8" },
            { label: t("giftCodes.activeCount","VERIFIED & ACTIVE"), value: counts.active, color: "#a7e4bd" },
            { label: t("giftCodes.pendingCount","PENDING REVIEW"), value: counts.pending, color: "#f2d18c" },
            { label: t("giftCodes.blockedCount","BLOCKED / REJECTED"), value: counts.attention, color: "#f0aab5" },
          ].map((item) => <div key={item.label} style={{ ...panel, padding: "16px 18px" }}><div style={{ color: "#8b95a7", fontSize: 10, fontWeight: 800, letterSpacing: ".07em" }}>{item.label}</div><div style={{ color: item.color, fontSize: 29, fontWeight: 850, letterSpacing: "-.04em", marginTop: 7 }}>{item.value}</div></div>)}
        </section>

        <section aria-labelledby="add-code-heading" style={{ ...panel, padding: "clamp(16px, 3vw, 22px)", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><span style={{ display: "grid", placeItems: "center", width: 34, height: 34, borderRadius: 10, background: "#292442", color: "#c8b8ff" }}><Plus size={18}/></span><div><h2 id="add-code-heading" style={{ fontSize: 16, margin: 0 }}>{t("giftCodes.addTitle","Add a gift code")}</h2><p style={{ fontSize: 12, color: "#8b95a7", margin: "4px 0 0" }}>{t("giftCodes.addDescription","Manually add or restore a code from a trusted source. Confirmed manual codes are immediately marked verified.")}</p></div></div>
          <form onSubmit={(event) => { event.preventDefault(); run("GIFT_CODE_ADD", { code, expiresAt: expires ? new Date(expires).toISOString() : null, confirmManual }); }} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 12, alignItems: "end" }}>
            <label style={{ color: "#c4cad6", fontSize: 12, fontWeight: 700 }}>{t("giftCodes.code","Gift code")}<input required minLength={6} maxLength={32} pattern="[A-Za-z0-9_-]{6,32}" value={code} onChange={(event) => setCode(event.target.value.trim())} placeholder="e.g. Hangul2026" autoCapitalize="none" autoComplete="off" style={{ ...input, display: "block", marginTop: 7 }}/></label>
            <label style={{ color: "#c4cad6", fontSize: 12, fontWeight: 700 }}>{t("giftCodes.expiry","Expiry date")} <span style={{ color: "#818b9e", fontWeight: 400 }}>({t("giftCodes.optional","optional")})</span><input type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} style={{ ...input, display: "block", marginTop: 7 }}/></label>
            <button type="submit" disabled={busy || !confirmManual} style={{ ...button, minHeight: 42, background: "#d8c49a", borderColor: "#d8c49a", color: "#17140e", opacity: busy || !confirmManual ? .55 : 1 }}><Plus size={15}/> {t("giftCodes.add","Add code")}</button>
            <label style={{ gridColumn: "1 / -1", display: "flex", alignItems: "flex-start", gap: 9, padding: 12, borderRadius: 10, background: "#0c1018", color: "#9da7b8", fontSize: 11, lineHeight: 1.5 }}><input type="checkbox" required checked={confirmManual} onChange={(event) => setConfirmManual(event.target.checked)} style={{ marginTop: 2, accentColor: "#b7a3f0" }}/><span><b style={{ color: "#d9deea" }}>{t("giftCodes.trusted","Trusted-source confirmation")}</b><br/>{t("giftCodes.trustedText","I checked this code against a trusted Kingshot source and approve it for immediate redemption without canary verification. Kingshot may still reject an expired or invalid code.")}</span></label>
          </form>
        </section>

        <section aria-labelledby="inventory-heading" style={{ ...panel, padding: "clamp(16px, 3vw, 22px)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <div><h2 id="inventory-heading" style={{ fontSize: 17, margin: 0 }}>{t("giftCodes.inventory","Code inventory")}</h2><p style={{ color: "#8b95a7", fontSize: 12, lineHeight: 1.5, margin: "5px 0 0" }}>{t("giftCodes.inventoryDescription","Only verified, active, unexpired codes enter the worker pool.")}</p></div>
            <span style={{ color: "#aeb7c7", fontSize: 11, padding: "6px 9px", borderRadius: 8, background: "#0c1018" }}>{visible.length} of {codes.length}</span>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 12px", marginBottom: 12, border: "1px solid #343b4b", borderRadius: 11, background: "#0c1018", color: "#8b95a7" }}><Search size={16}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("giftCodes.searchPlaceholder","Search by code or validation message…")} aria-label={t("giftCodes.search","Search gift codes")} style={{ ...input, border: 0, background: "transparent", padding: "12px 0" }}/>{search && <button type="button" aria-label={t("giftCodes.clear","Clear search")} onClick={() => setSearch("")} style={{ ...button, minHeight: 28, padding: 5 }}><X size={13}/></button>}</label>
          <div role="group" aria-label={t("giftCodes.filter","Filter codes by status")} style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 14 }}>
            {[["all", t("giftCodes.all","All codes")], ["active", t("giftCodes.active","Active")], ["pending", t("giftCodes.pending","Pending")], ["invalid", t("giftCodes.invalid","Invalid")], ["usage_limit", t("giftCodes.usageLimit","Usage limit")], ["indeterminate", t("giftCodes.retry","Needs retry")], ["expired", t("giftCodes.expired","Expired")], ["blocked", t("giftCodes.blocked","Blocked")], ["inactive", t("giftCodes.inactive","Inactive")]].map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} style={{ ...button, minHeight: 32, padding: "6px 10px", fontSize: 11, background: filter === value ? "#292442" : "#0c1018", borderColor: filter === value ? "#7563a6" : "#303747", color: filter === value ? "#e3d9ff" : "#aeb7c7" }}>{label}{value === "pending" && counts.pending ? ` · ${counts.pending}` : ""}</button>)}
          </div>

          {busy && !codes.length ? <p style={{ color: "#9aa4b6", fontSize: 13 }}>{t("giftCodes.loading","Loading inventory…")}</p> : !visible.length ? <div style={{ padding: "34px 14px", textAlign: "center", border: "1px dashed #343b4b", borderRadius: 12 }}><Gift size={24} style={{ color: "#6f7890", marginBottom: 8 }}/><p style={{ color: "#c5ccda", fontSize: 13, margin: 0 }}>{codes.length ? t("giftCodes.noMatches","No codes match these filters.") : t("giftCodes.empty","Your inventory is empty.")}</p><p style={{ color: "#818b9e", fontSize: 11, margin: "6px 0 0" }}>{codes.length ? t("giftCodes.tryAgain","Try another status or clear the search.") : t("giftCodes.getStarted","Add a trusted code above to get started.")}</p></div> : <div style={{ display: "grid", gap: 9 }}>
            {visible.map((item) => {
              const status = statusOf(item);
              const effective = isEffective(item);
              const colors = statusColors[status] || statusColors.inactive;
              return <article key={item.id || item.code} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "center", padding: "14px", border: "1px solid #292f3c", borderRadius: 12, background: "#0d1119" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <b style={{ fontSize: 14, overflowWrap: "anywhere", letterSpacing: ".01em" }}>{item.code}</b>
                    <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 7px", borderRadius: 7, border: `1px solid ${colors.border}`, background: colors.bg, color: colors.fg, fontSize: 10, fontWeight: 800 }}>{statusLabels[status] || status}</span>
                    {item.admin_added && <span style={{ color: "#bba9f4", fontSize: 10, fontWeight: 700 }}>{t("giftCodes.manual","MANUAL")}</span>}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8, color: "#818b9e", fontSize: 10, lineHeight: 1.5 }}>
                    <span>{t("giftCodes.expires","Expires:")} {formatDate(item.expires_at)}</span><span>{t("giftCodes.lastSeen","Last seen:")} {formatDate(item.last_seen_at || item.first_seen_at)}</span>
                    {item.validated_at && <span>{t("giftCodes.checked","Checked:")} {formatDate(item.validated_at)}</span>}
                    {item.validation_player_id && <span>{t("giftCodes.player","Player:")} {item.validation_player_id}</span>}
                  </div>
                  {item.validation_message && <p style={{ color: "#9aa4b6", fontSize: 11, lineHeight: 1.45, margin: "7px 0 0", overflowWrap: "anywhere" }}>{item.validation_message}</p>}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" title={`${t("giftCodes.copy","Copy gift code")} ${item.code}`} aria-label={`${t("giftCodes.copy","Copy gift code")} ${item.code}`} style={{ ...button, minHeight: 34, padding: "8px 10px" }} disabled={busy} onClick={async () => { try { await copyToClipboard(item.code, t("giftCodes.code","Gift code")); setNotice(""); setError(""); } catch { setError(t("giftCodes.clipboardError","Clipboard access was unavailable.")); } }}><Copy size={14}/></button>
                  <button type="button" title={effective ? t("giftCodes.removeActive","Remove from active pool") : t("giftCodes.verify","Queue player verification")} aria-label={effective ? t("giftCodes.markInactive","Mark inactive") : t("giftCodes.verify","Queue player verification")} style={{ ...button, minHeight: 34, padding: "8px 10px", opacity: item.suppressed || isExpired(item) || item.validation_status === "pending" ? .5 : 1 }} disabled={busy || item.suppressed || isExpired(item) || item.validation_status === "pending"} onClick={() => run("GIFT_CODE_UPDATE", { code: item.code, active: !effective, expiresAt: effective ? new Date().toISOString() : item.expires_at || null })}>{effective ? <Clock3 size={14}/> : <Check size={14}/>}<span>{effective ? t("giftCodes.deactivate","Deactivate") : t("giftCodes.reverify","Re-verify")}</span></button>
                  <button type="button" title={t("giftCodes.blockHelp","Block this code until manually restored")} aria-label={`${t("giftCodes.blocked","Block")} ${item.code}`} style={{ ...button, minHeight: 34, padding: "8px 10px", color: "#f0aab5", borderColor: "#56303a" }} disabled={busy || item.suppressed} onClick={() => { if (window.confirm(t("giftCodes.confirmBlock","Block {code} from the active pool and prevent scraper reactivation?").replace("{code}", item.code))) run("GIFT_CODE_DELETE", { code: item.code }); }}><Trash2 size={14}/></button>
                </div>
              </article>;
            })}
          </div>}
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#818b9e", fontSize: 10, lineHeight: 1.5, marginTop: 15 }}><ShieldCheck size={14}/><span>{t("giftCodes.securityNote","Changes are server-authenticated. Blocked codes stay blocked until explicitly restored.")}</span></div>
        </section>
        <footer style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginTop: 18, color: "#667084", fontSize: 11 }}><span>{t("giftCodes.footer","Gift-code inventory · Admin tools")}</span><a href="/message" style={{ color: "#a99be0", textDecoration: "none" }}>{t("giftCodes.customMessage","Discord custom message")} ↗</a></footer>
      </div>
    </main>
  );
}
