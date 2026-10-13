import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownToLine, BarChart3, Globe2, LockKeyhole, LogOut, RefreshCw, ShieldCheck, Users, Eye, MonitorSmartphone, ExternalLink, LoaderCircle, AlertTriangle } from "lucide-react";

type Breakdown = { name: string; value: number };
type DayRow = { day: string; views: number; visitors: number };
type Visit = { occurredAt: string; ipAddress: string | null; country: string | null; region: string | null; city: string | null; path: string; referrerHost: string | null; browser: string | null; operatingSystem: string | null; deviceType: string | null; userAgent: string | null };
type Analytics = { periodDays: number; generatedAt: string; views: number; uniqueIps: number; countriesCount: number; pagesCount: number; daily: DayRow[]; countries: Breakdown[]; pages: Breakdown[]; referrers: Breakdown[]; devices: Breakdown[]; browsers: Breakdown[]; recent: Visit[] };

const empty: Analytics = { periodDays: 7, generatedAt: "", views: 0, uniqueIps: 0, countriesCount: 0, pagesCount: 0, daily: [], countries: [], pages: [], referrers: [], devices: [], browsers: [], recent: [] };
const shell: React.CSSProperties = { minHeight: "100vh", background: "var(--bg, #0b0d12)", color: "var(--text, #f4f6fb)", padding: "clamp(16px,3vw,32px)", boxSizing: "border-box", fontFamily: "inherit" };
const panel: React.CSSProperties = { border: "1px solid var(--border, #303642)", borderRadius: 16, background: "var(--panel, #151922)", padding: 18, minWidth: 0 };
const muted: React.CSSProperties = { color: "var(--muted, #9ba4b5)" };
const button: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, border: "1px solid var(--border, #303642)", borderRadius: 10, padding: "10px 13px", background: "var(--panel, #151922)", color: "inherit", font: "inherit", fontSize: 13, cursor: "pointer" };
const fmt = (n: number) => new Intl.NumberFormat().format(n || 0);
const time = (s: string) => s ? new Date(s).toLocaleString() : "—";

export default function VisitorAnalyticsApp() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Analytics>(empty);
  const [accessKey, setAccessKey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastLoaded, setLastLoaded] = useState("");

  const load = useCallback(async (period = days) => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/kingshot-visitor-analytics?days=" + period, { credentials: "same-origin", cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 401) { setAuthed(false); throw new Error("Sign in with your existing admin access key to view private analytics."); }
      if (!response.ok) throw new Error(payload.error || "Could not load analytics.");
      setData({ ...empty, ...payload }); setLastLoaded(new Date().toISOString()); setAuthed(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Analytics request failed."); }
    finally { setBusy(false); setChecking(false); }
  }, [days]);

  useEffect(() => { void load(days); }, [days]);

  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/kingshot-admin-login", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ accessKey }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Admin sign-in failed.");
      setAccessKey(""); setAuthed(true); await load(days);
    } catch (e) { setError(e instanceof Error ? e.message : "Admin sign-in failed."); }
    finally { setBusy(false); setChecking(false); }
  };
  const logout = async () => {
    await fetch("/api/kingshot-admin-login", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
    setAuthed(false); setData(empty);
  };
  const exportCsv = () => {
    const rows = [["timestamp","ip_address","country","region","city","path","referrer_host","browser","operating_system","device_type","user_agent"], ...data.recent.map(v => [v.occurredAt,v.ipAddress,v.country,v.region,v.city,v.path,v.referrerHost,v.browser,v.operatingSystem,v.deviceType,v.userAgent])];
    const csv = rows.map(row => row.map(cell => { const s = String(cell ?? ""); return '"' + s.replace(/"/g, '""') + '"'; }).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "visitor-events-" + days + "d.csv"; a.click(); URL.revokeObjectURL(url);
  };

  const maxViews = useMemo(() => Math.max(1, ...data.daily.map(d => d.views)), [data.daily]);
  const maxBar = (items: Breakdown[]) => Math.max(1, ...items.map(x => x.value));
  const BreakdownPanel = ({ title, icon, items }: { title: string; icon: React.ReactNode; items: Breakdown[] }) => (
    <section style={panel}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 18 }}>{icon}<h2 style={{ fontSize: 15, margin: 0 }}>{title}</h2></div>
      {items.length ? <div style={{ display: "grid", gap: 13 }}>{items.map((item, i) => <div key={item.name}>
        <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "baseline", fontSize: 12, marginBottom: 6 }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span><b style={{ flexShrink: 0 }}>{fmt(item.value)}</b></div>
        <div style={{ height: 5, background: "var(--border, #303642)", borderRadius: 8, overflow: "hidden" }}><div style={{ height: "100%", width: (item.value / maxBar(items) * 100) + "%", background: i === 0 ? "#8b9cfb" : "#5f6f95", borderRadius: 8 }} /></div>
      </div>)}</div> : <p style={{ ...muted, fontSize: 12 }}>No visits recorded for this period yet.</p>}
    </section>
  );

  if (checking && !lastLoaded && !error) return <main style={shell}><div style={{ maxWidth: 760, margin: "10vh auto", ...panel, textAlign: "center" }}><LoaderCircle size={24} /><p style={muted}>Checking private analytics access…</p></div></main>;
  if (!authed) return <main style={shell}><div style={{ maxWidth: 430, margin: "8vh auto", ...panel }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}><span style={{ display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 12, background: "#252d46" }}><LockKeyhole size={20} /></span><div><h1 style={{ margin: 0, fontSize: 23 }}>Private analytics</h1><p style={{ ...muted, margin: "5px 0 0", fontSize: 13 }}>Kingshot Auto Redeemer · Admin access</p></div></div>
    <p style={{ ...muted, fontSize: 13, lineHeight: 1.6 }}>Sign in with the existing admin access key. Visitor records and IP addresses are restricted to authorized operators.</p>
    <form onSubmit={login}><label htmlFor="analytics-key" style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 7 }}>Admin access key</label><input id="analytics-key" type="password" autoComplete="current-password" required value={accessKey} onChange={e => setAccessKey(e.target.value)} style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--border, #303642)", borderRadius: 10, padding: 12, background: "var(--bg, #0b0d12)", color: "inherit", font: "inherit", marginBottom: 12 }} /><button style={{ ...button, width: "100%", background: "#566bdc", borderColor: "#566bdc" }} disabled={busy}>{busy ? <LoaderCircle size={15} /> : <ShieldCheck size={15} />} Sign in securely</button></form>
    {error && <p role="alert" style={{ color: "#ff9d9d", fontSize: 13 }}>{error}</p>}<p style={{ ...muted, fontSize: 11, marginTop: 18 }}><a href="/" style={{ color: "inherit" }}>← Back to the website</a></p>
  </div></main>;

  return <main style={shell}>
    <div style={{ maxWidth: 1400, margin: "0 auto", display: "grid", gap: 18 }}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
        <div><div style={{ ...muted, display: "flex", alignItems: "center", gap: 7, fontSize: 11, fontWeight: 800, letterSpacing: 1.4, marginBottom: 8 }}><Activity size={14} /> FIRST-PARTY ANALYTICS</div><h1 style={{ fontSize: "clamp(25px,4vw,36px)", margin: 0, letterSpacing: -1 }}>Website overview</h1><p style={{ ...muted, fontSize: 13, marginBottom: 0 }}>Private visitor intelligence · IP retention: 30 days</p></div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <select aria-label="Analytics period" value={days} onChange={e => setDays(Number(e.target.value))} style={{ ...button, paddingRight: 30 }}><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option></select>
          <button style={button} onClick={() => void load(days)} disabled={busy}><RefreshCw size={14} /> Refresh</button>
          <button style={button} onClick={exportCsv} disabled={!data.recent.length}><ArrowDownToLine size={14} /> Export recent CSV</button>
          <button style={button} onClick={logout}><LogOut size={14} /> Sign out</button>
        </div>
      </header>
      {error && <div role="alert" style={{ ...panel, borderColor: "#8a4a4a", color: "#ffb0b0", display: "flex", gap: 9, alignItems: "center" }}><AlertTriangle size={17} />{error}</div>}
      <div style={{ ...muted, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 11 }}><span>{busy ? "Updating data…" : "Live database aggregates"}</span><span>Updated {time(lastLoaded || data.generatedAt)}</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,190px),1fr))", gap: 12 }}>
        {[
          {label:"Page views",value:data.views,icon:<Eye size={17}/>,desc:"Recorded page visits"},
          {label:"Unique IPs",value:data.uniqueIps,icon:<Users size={17}/>,desc:"Approximate unique visitors"},
          {label:"Countries",value:data.countriesCount,icon:<Globe2 size={17}/>,desc:"Countries represented"},
          {label:"Pages",value:data.pagesCount,icon:<MonitorSmartphone size={17}/>,desc:"Distinct paths visited"}
        ].map(k => <section key={k.label} style={panel}><div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", ...muted, fontSize:12 }}><span>{k.label}</span>{k.icon}</div><div style={{ fontSize:32, fontWeight:800, letterSpacing:-1, marginTop:14 }}>{fmt(k.value)}</div><div style={{ ...muted, fontSize:11, marginTop:5 }}>{k.desc}</div></section>)}
      </div>
      <section style={panel}>
        <div style={{ display:"flex", alignItems:"center", gap:9, marginBottom:20 }}><BarChart3 size={17}/><h2 style={{ fontSize:15, margin:0 }}>Traffic over time</h2></div>
        {data.daily.length ? <><div style={{ height:190, display:"flex", alignItems:"end", gap:5, paddingTop:10 }}>
          {data.daily.map(d => <div key={d.day} title={d.day + ": " + d.views + " views, " + d.visitors + " unique IPs"} style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", justifyContent:"end", alignItems:"center", height:"100%", gap:6 }}>
            <span style={{ fontSize:10, ...muted }}>{d.views}</span><div style={{ width:"min(100%,34px)", height: Math.max(3,d.views/maxViews*140)+"px", background:"#7888ec", borderRadius:"5px 5px 1px 1px" }} /><span style={{ fontSize:9, ...muted, transform:"rotate(-35deg)", whiteSpace:"nowrap", transformOrigin:"top center", marginTop:5 }}>{d.day.slice(5)}</span>
          </div>)}
        </div><div style={{ ...muted, fontSize:11, marginTop:16 }}>Unique IP counts are an approximation, not guaranteed person-level unique visitors.</div></> : <p style={{ ...muted, fontSize:13 }}>No first-party events yet. Once the collector is deployed and visits arrive, this chart will populate.</p>}
      </section>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,290px),1fr))", gap:12 }}>
        <BreakdownPanel title="Top pages" icon={<MonitorSmartphone size={16}/>} items={data.pages}/>
        <BreakdownPanel title="Countries" icon={<Globe2 size={16}/>} items={data.countries}/>
        <BreakdownPanel title="Referrers" icon={<ExternalLink size={16}/>} items={data.referrers}/>
        <BreakdownPanel title="Devices" icon={<Activity size={16}/>} items={data.devices}/>
        <BreakdownPanel title="Browsers" icon={<Globe2 size={16}/>} items={data.browsers}/>
      </div>
      <section style={panel}>
        <div style={{ display:"flex", flexWrap:"wrap", alignItems:"center", justifyContent:"space-between", gap:10, marginBottom:15 }}><div><h2 style={{ fontSize:15, margin:"0 0 5px" }}>Recent visits</h2><p style={{ ...muted, fontSize:11, margin:0 }}>Up to 100 latest events in the selected period. IPs and user-agent strings are sensitive.</p></div><span style={{ ...muted, fontSize:11 }}>{data.recent.length} records</span></div>
        <div style={{ overflowX:"auto" }}><table style={{ width:"100%", minWidth:900, borderCollapse:"collapse", fontSize:12, textAlign:"left" }}><thead><tr>{["Time","IP address","Location","Page","Referrer","Browser / OS","Device"].map(h=><th key={h} style={{ padding:"10px 9px", borderBottom:"1px solid var(--border, #303642)", ...muted, fontWeight:700, whiteSpace:"nowrap" }}>{h}</th>)}</tr></thead><tbody>
          {data.recent.map((v,i)=><tr key={v.occurredAt+"-"+i}>{[
            time(v.occurredAt),v.ipAddress||"Unavailable",[v.city,v.region,v.country].filter(Boolean).join(", ")||"Unknown",v.path,v.referrerHost||"Direct / unknown",[v.browser,v.operatingSystem].filter(Boolean).join(" · ")||"Unknown",v.deviceType||"Unknown"
          ].map((cell,j)=><td key={j} style={{ padding:"11px 9px", borderBottom:"1px solid var(--border, #303642)", maxWidth:j===3?220:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={cell}>{cell}</td>)}</tr>)}
        </tbody></table></div>
        {!data.recent.length&&<p style={{ ...muted, fontSize:13 }}>No visitor events recorded yet.</p>}
      </section>
      <footer style={{ ...muted, fontSize:11, display:"flex", flexWrap:"wrap", justifyContent:"space-between", gap:8 }}><span><ShieldCheck size={12} style={{ verticalAlign:"middle", marginRight:5 }}/>Private admin view · Raw visit data is never placed in Git archives.</span><a href="/privacy?service=kingshot-auto" style={{ color:"inherit" }}>Privacy notice</a></footer>
    </div>
  </main>;
}
