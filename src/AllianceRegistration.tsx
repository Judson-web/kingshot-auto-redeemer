import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, CheckCheck, CheckCircle2, ChevronDown, CircleAlert, Clock3, Info, LoaderCircle, Search, ShieldCheck, Users, UserRound, RotateCcw, X } from "lucide-react";
import { makeFailureOutcome, makeSuccessOutcome, summarizeRegistrationOutcomes } from "./registration-outcomes.js";
import { useSiteLanguage } from "./shared/site-language.js";
import PublicSiteHeader from "./components/PublicSiteHeader.jsx";
import { useAccountState, refreshAccount } from "./shared/account-state.js";
import "./alliance-registration.css";

type AllianceEntry = {
  name: string; tag: string; kingdomId: string; power: number | null;
  memberCount: number | null; leaderName: string; flagUrl: string; rank: number | null;
};
type AllianceMember = {
  playerId: string; name: string; power: number | null; townCenterLevel: number | null;
  avatarUrl: string; allianceRank: string; kingdomId: string;
};
type AllianceResult = {
  alliance: AllianceEntry & { count: number };
  members: AllianceMember[]; stale?: boolean; fetchedAt?: string | null; ageSeconds?: number | null;
};
type Outcome = ReturnType<typeof makeSuccessOutcome>;
const BATCH_LIMIT = 100;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const formatNumber = (value: number | null | undefined) => value == null || !Number.isFinite(Number(value))
  ? "—"
  : new Intl.NumberFormat(undefined, { notation: Number(value) >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Number(value));

function safePlayer(member: AllianceMember, alliance: AllianceResult["alliance"]) {
  return {
    nick_name: member.name,
    kid: member.kingdomId || alliance.kingdomId,
    power: member.power,
    town_center_level: member.townCenterLevel,
    avatar_url: member.avatarUrl,
    alliance: { name: alliance.name, abbr: alliance.tag }
  };
}

export default function AllianceRegistration() {
  const { t } = useSiteLanguage();
  const accountState = useAccountState();
  useEffect(() => { void refreshAccount(); }, []);
  const [kingdomId, setKingdomId] = useState("");
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [alliances, setAlliances] = useState<AllianceEntry[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [activeAlliance, setActiveAlliance] = useState<AllianceEntry | null>(null);
  const [roster, setRoster] = useState<AllianceResult | null>(null);
  const [rosterChanges, setRosterChanges] = useState<{added: AllianceMember[]} | null>(null);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [registeredIds, setRegisteredIds] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [processedIds, setProcessedIds] = useState<string[]>([]);
  const [registering, setRegistering] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, currentId: "", note: "" });
  const [syncConfig, setSyncConfig] = useState<any>(null);
  const [syncInterval, setSyncInterval] = useState(24);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");
  const [syncResult, setSyncResult] = useState<any>(null);

  const searchRequestRef = useRef(0);
  const rosterRequestRef = useRef(0);


  const refreshSyncConfig = async (alliance: AllianceEntry | null = activeAlliance) => {
    if (!alliance) { setSyncConfig(null); return; }
    try {
      const response = await fetch("/api/kingshot-alliance-sync", { credentials: "same-origin", cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load auto-sync settings.");
      const config = (Array.isArray(data.configs) ? data.configs : []).find((item: any) =>
        String(item.kingdom_id) === String(alliance.kingdomId || kingdomId.trim()) &&
        String(item.alliance_tag).toLowerCase() === String(alliance.tag).toLowerCase()
      );
      setSyncConfig(config || null);
      setSyncInterval(24);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Could not load auto-sync settings.");
    }
  };

  useEffect(() => {
    if (accountState.status === "authenticated" && activeAlliance) {
      setSyncError("");
      void refreshSyncConfig(activeAlliance);
    } else {
      setSyncConfig(null);
    }
  }, [activeAlliance?.tag, activeAlliance?.kingdomId, accountState.status]);

  const setupAutoSync = async () => {
    if (!activeAlliance || syncBusy) return;
    setSyncBusy(true); setSyncError(""); setSyncMessage(""); setSyncResult(null);
    try {
      const response = await fetch("/api/kingshot-alliance-sync", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", kingdomId: activeAlliance.kingdomId || kingdomId.trim(), allianceTag: activeAlliance.tag, allianceName: activeAlliance.name, intervalHours: 24 })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not enable auto sync.");
      setSyncConfig(data.config || null);
      setSyncMessage("Auto sync is registered. Its settings are fixed; you can pause or resume the schedule.");
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Could not enable auto sync.");
    } finally { setSyncBusy(false); }
  };

  const updateAutoSync = async (action: "sync" | "pause" | "resume") => {
    if (!syncConfig || syncBusy) return;
    setSyncBusy(true); setSyncError(""); setSyncMessage(""); setSyncResult(null);
    try {
      const response = await fetch("/api/kingshot-alliance-sync", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id: syncConfig.id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update auto-sync settings.");
      if (action === "sync") {
        setSyncResult(data);
        setSyncMessage("Sync completed successfully.");
      } else {
        setSyncConfig((current: any) => current ? { ...current, ...(data.config || {}) } : current);
        setSyncMessage(action === "pause" ? "Auto sync is paused." : "Auto sync has resumed.");
      }
      await refreshSyncConfig(activeAlliance);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Could not update auto-sync settings.");
    } finally { setSyncBusy(false); }
  };

  const filteredAlliances = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return alliances;
    return alliances.filter(item => (item.name + " " + item.tag).toLocaleLowerCase().includes(needle));
  }, [alliances, query]);
  const visibleMembers = useMemo(() => {
    const needle = memberFilter.trim().toLocaleLowerCase();
    return (roster?.members || []).filter(member =>
      !needle || (member.name + " " + member.playerId + " " + member.allianceRank).toLocaleLowerCase().includes(needle)
    );
  }, [roster, memberFilter]);
  const summary = useMemo(() => summarizeRegistrationOutcomes(outcomes), [outcomes]);
  const remainingCount = (roster?.members || []).filter(member => !registeredIds.includes(member.playerId) && !processedIds.includes(member.playerId)).length;
  const completedCount = processedIds.length;
  const selectedVisibleCount = visibleMembers.filter(member => selected.includes(member.playerId)).length;

  const discover = async (event: React.FormEvent) => {
    event.preventDefault();
    const requestId = ++searchRequestRef.current;
    rosterRequestRef.current++;
    setSearchError("");
    setRosterError("");
    setLoadingRoster(false);
    setRoster(null);
    setActiveAlliance(null);
    setAlliances([]);
    setSelected([]);
    setRegisteredIds([]);
    setOutcomes([]);
    setProcessedIds([]);
    if (!/^\d{1,10}$/.test(kingdomId.trim())) {
      setSearchError(t("alliance.invalidKingdom", "Enter a kingdom ID containing digits only."));
      return;
    }
    setDiscovering(true);
    try {
      const params = new URLSearchParams({ developer: "alliance-lookup", mode: "search", kingdomId: kingdomId.trim(), ...(query.trim() ? { q: query.trim() } : {}) });
      const response = await fetch("/api/kingshot-player?" + params.toString(), { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      const data = await response.json().catch(() => ({}));
      if (requestId !== searchRequestRef.current) return;
      if (!response.ok) throw new Error(data.error || t("alliance.searchFailed", "Could not load alliances for this kingdom."));
      const list = Array.isArray(data.alliances) ? data.alliances as AllianceEntry[] : [];
      setAlliances(list);
      if (!list.length) setSearchError(t("alliance.noneFound", "No alliance list was returned for this kingdom. Try again shortly."));
      else if (query.trim() && !list.some(item => (item.name + " " + item.tag).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))) {
        setSearchError(t("alliance.noMatches", "No alliances match that filter. Try another name or tag."));
      }
    } catch (cause) {
      if (requestId === searchRequestRef.current) setSearchError(cause instanceof Error ? cause.message : t("alliance.searchFailed", "Could not load alliances for this kingdom."));
    } finally {
      if (requestId === searchRequestRef.current) setDiscovering(false);
    }
  };

  const loadRoster = async (alliance: AllianceEntry) => {
    const requestId = ++rosterRequestRef.current;
    const sameAlliance = Boolean(
      roster &&
      roster.alliance.kingdomId === (alliance.kingdomId || kingdomId.trim()) &&
      roster.alliance.tag === alliance.tag
    );
    setActiveAlliance(alliance);
    setLoadingRoster(true);
    setRosterError("");
    // Keep the current roster visible during a refresh and never erase completed work
    // just because the user asks for newer upstream data.
    if (!sameAlliance) {
      setRoster(null);
      setRosterChanges(null);
      setOutcomes([]);
      setProcessedIds([]);
      setSelected([]);
      setMemberFilter("");
    }
    try {
      const params = new URLSearchParams({
        developer: "alliance-lookup",
        kingdomId: alliance.kingdomId || kingdomId.trim(),
        tag: alliance.tag
      });
      const response = await fetch("/api/kingshot-player?" + params.toString(), { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      const data = await response.json().catch(() => ({}));
      if (requestId !== rosterRequestRef.current) return;
      if (!response.ok) throw new Error(data.error || t("alliance.lookupFailed", "Could not retrieve this alliance roster."));
      const normalized = data as AllianceResult;
      const members = Array.isArray(normalized.members) ? normalized.members : [];
      if (!normalized.alliance || !normalized.alliance.tag) throw new Error(t("alliance.malformedRoster", "The roster response was incomplete. Please try again."));
      const unique = new Map<string, AllianceMember>();
      for (const member of members) {
        const id = String(member.playerId || "").trim();
        if (/^\d{5,20}$/.test(id) && !unique.has(id)) unique.set(id, { ...member, playerId: id });
      }
      const clean = {
        ...normalized,
        stale: Boolean(normalized.stale || (typeof normalized.ageSeconds === "number" && normalized.ageSeconds > 3600)),
        members: [...unique.values()]
      };
      // Supabase is authoritative. Do not show selectable members until every roster ID has been checked.
      const registered = new Set<string>();
      for (let offset = 0; offset < clean.members.length; offset += 150) {
        const ids = clean.members.slice(offset, offset + 150).map(member => member.playerId);
        const statusParams = new URLSearchParams({ developer: "alliance-lookup", mode: "registration-status", kingdomId: clean.alliance.kingdomId || kingdomId.trim(), ids: ids.join(",") });
        const statusResponse = await fetch("/api/kingshot-player?" + statusParams.toString(), { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15_000) });
        const statusData = await statusResponse.json().catch(() => ({}));
        if (!statusResponse.ok || !Array.isArray(statusData.registeredIds)) throw new Error(statusData.error || t("alliance.registrationStatusFailed", "Could not verify existing registrations. Refresh the roster before selecting members."));
        for (const id of statusData.registeredIds) if (typeof id === "string") registered.add(id);
      }
      setRegisteredIds([...registered]);
      if (sameAlliance && roster) {
        const previousById = new Map(roster.members.map(member => [member.playerId, member]));
        const currentById = new Map(clean.members.map(member => [member.playerId, member]));
        const added = clean.members.filter(member => !previousById.has(member.playerId));
        // Additions-only refresh: a member missing from the latest upstream roster
        // is not a removal request and must never affect their existing registration.
        setRosterChanges({ added });
      } else setRosterChanges(null);
      setRoster(clean);
      const validIds = new Set(clean.members.map(member => member.playerId));
      if (sameAlliance) {
        // Keep the session's attempt history even if a member has since left the roster.
        // Only the current selection must be reconciled against the refreshed member list.
        setSelected(current => current.filter(id => validIds.has(id) && !registered.has(id)));
      } else {
        setProcessedIds([]);
        setOutcomes([]);
        setSelected([]);
      }
    } catch (cause) {
      if (requestId === rosterRequestRef.current) setRosterError(cause instanceof Error ? cause.message : t("alliance.lookupFailed", "Could not retrieve this alliance roster."));
    } finally {
      if (requestId === rosterRequestRef.current) setLoadingRoster(false);
    }
  };


  const toggleMember = (id: string) => {
    if (registeredIds.includes(id)) return;
    setSelected(current => {
      if (current.includes(id)) return current.filter(value => value !== id);
      if (current.length >= BATCH_LIMIT) {
        setRosterError(t("alliance.batchLimit", "A batch can contain at most 100 unique Player IDs."));
        return current;
      }
      setRosterError("");
      return [...current, id];
    });
  };

  const selectVisible = () => {
    const visible = visibleMembers.filter(member => !registeredIds.includes(member.playerId) && !outcomes.some(item => item.id === member.playerId && item.kind === "existing")).map(member => member.playerId);
    const unselected = visible.filter(id => !selected.includes(id));
    if (selected.length + unselected.length > BATCH_LIMIT) {
      setSelected(current => [...new Set([...current, ...unselected])].slice(0, BATCH_LIMIT));
      setRosterError(t("alliance.selectionCapped", "Selection stopped at the 100-ID batch limit."));
    } else {
      setSelected(current => [...new Set([...current, ...unselected])]);
      setRosterError("");
    }
  };

  const selectNewMembers = () => {
    if (!roster || !rosterChanges?.added.length) return;
    const eligible = rosterChanges.added.filter(member => !registeredIds.includes(member.playerId) && !processedIds.includes(member.playerId));
    setSelected(eligible.slice(0, BATCH_LIMIT).map(member => member.playerId));
    setRosterError(eligible.length > BATCH_LIMIT ? t("alliance.newMembersCapped", "Selected the first 100 new members. Register the rest in another batch.") : "");
  };

  const selectNextBatch = () => {
    if (!roster) return;
    const next = roster.members.filter(member => !registeredIds.includes(member.playerId) && !processedIds.includes(member.playerId))
      .slice(0, BATCH_LIMIT).map(member => member.playerId);
    setSelected(next);
    setRosterError(next.length ? "" : t("alliance.noUnprocessed", "No unprocessed members remain. Select individual members to retry them."));
  };

  const registerSelected = async () => {
    if (!roster || registering) return;
    const batch = roster.members.filter(member => selected.includes(member.playerId) && !registeredIds.includes(member.playerId)).slice(0, BATCH_LIMIT);
    if (!batch.length) return;
    if (batch.length > BATCH_LIMIT) {
      setRosterError(t("alliance.batchLimit", "A batch can contain at most 100 unique Player IDs."));
      return;
    }
    setRegistering(true);
    setRosterError("");
    setProgress({ done: 0, total: batch.length, currentId: batch[0].playerId, note: "" });
    const processed = new Set(processedIds);
    try {
      for (let index = 0; index < batch.length; index++) {
        const member = batch[index];
        const id = member.playerId;
        setProgress({ done: index, total: batch.length, currentId: id, note: "" });
        let outcome: Outcome | null = null;
        try {
          let response: Response | null = null;
          let data: Record<string, any> = {};
          for (let attempt = 0; attempt < 3; attempt++) {
            response = await fetch("/api/kingshot-register", {
              method: "POST",
              headers: { "content-type": "application/json", "x-alliance-registration": "1" },
              credentials: "same-origin",
              body: JSON.stringify({
                playerId: id,
                kingdomId: String(member.kingdomId || roster.alliance.kingdomId || kingdomId.trim()),
                playerName: member.name || "Kingshot Player",
                avatarUrl: member.avatarUrl || ""
              }),
              signal: AbortSignal.timeout(45_000)
            });
            data = await response.json().catch(() => ({}));
            if (response.status !== 429) break;
            const seconds = Math.max(1, Math.min(120, Number(response.headers.get("Retry-After")) || 60));
            setProgress({ done: index, total: batch.length, currentId: id, note: t("alliance.rateLimitWait", "Registration is rate limited. Resuming in") + " " + seconds + "s." });
            await delay((seconds + 1) * 1000);
          }
          if (response?.ok) outcome = makeSuccessOutcome(id, safePlayer(member, roster.alliance), data) as Outcome;
          else outcome = makeFailureOutcome({
            id,
            message: String(data.error || (response?.status === 429 ? t("alliance.rateLimitExhausted", "The registration rate limit did not clear. Retry this member shortly.") : t("alliance.registrationFailed", "Registration could not be confirmed. Check the result before retrying."))),
            code: String(data.code || (response?.status === 429 ? "rate_limit_exceeded" : "registration_failed")),
            banned: Boolean(data.banned), disabled: Boolean(data.disabled), alreadyRegistered: Boolean(data.alreadyRegistered),
            ban: data.ban, reason: data.reason, player: safePlayer(member, roster.alliance)
          }) as Outcome;
        } catch (cause) {
          outcome = makeFailureOutcome({
            id,
            message: cause instanceof Error && /timeout|abort/i.test(cause.name + " " + cause.message)
              ? t("alliance.requestTimeout", "The request timed out. Confirm this Player ID's status before retrying.")
              : t("alliance.connectionInterrupted", "The connection was interrupted. Confirm this Player ID's status before retrying."),
            code: "registration_confirmation_unavailable",
            player: safePlayer(member, roster.alliance)
          }) as Outcome;
        }
        processed.add(id);
        setProcessedIds([...processed]);
        setOutcomes(current => [...current.filter(item => item.id !== id), outcome as Outcome]);
        if (outcome && ["registered", "existing", "reactivated"].includes(outcome.kind)) setRegisteredIds(current => current.includes(id) ? current : [...current, id]);
        setProgress({ done: index + 1, total: batch.length, currentId: index + 1 < batch.length ? batch[index + 1].playerId : "", note: "" });
      }
    } finally {
      setRegistering(false);
      setProgress(current => ({ ...current, currentId: "", note: "" }));
    }
  };

  const canRegister = accountState.status === "authenticated" && Boolean(accountState.account);
  const selectableVisibleMembers = visibleMembers.filter(member => !registeredIds.includes(member.playerId) && !outcomes.some(item => item.id === member.playerId && item.kind === "existing"));
  const allVisibleSelected = selectableVisibleMembers.length > 0 && selectableVisibleMembers.every(member => selected.includes(member.playerId));
  return <div className="app ks-app ks-alliance-app">
    <a className="skip-link" href="#alliance-main">{t("common.skip", "Skip to main content")}</a>
    <PublicSiteHeader current="alliance-registration" />
    <main id="alliance-main">
      <div className="ks-alliance-page-head">
        <div className="ks-alliance-eyebrow"><span aria-hidden="true"/>{t("alliance.eyebrow", "BULK REGISTRATION")}</div>
        <h1>{t("alliance.pageTitle", "Alliance Registration")} <span className="ks-beta-tag ks-beta-tag-page">BETA</span></h1>
        <p>{t("alliance.pageIntro", "Browse alliance details and the full member roster without signing in. Sign in only when you are ready to register members who are not in the registry yet.")}</p>
        <div className="ks-alliance-flow" aria-label={t("alliance.flowLabel", "Registration steps")}>
          <span className="is-current"><b>1</b>{t("alliance.flowFind", "Find alliance")}</span><i aria-hidden="true"/><span className={roster ? "is-current" : ""}><b>2</b>{t("alliance.flowReview", "Review members")}</span><i aria-hidden="true"/><span className={outcomes.length ? "is-current" : ""}><b>3</b>{t("alliance.flowRegister", "Register")}</span>
        </div>
      </div>

      <section className="ks-alliance-panel ks-alliance-discovery" aria-labelledby="alliance-find-heading">
        <div className="ks-alliance-panel-head">
          <div className="ks-alliance-step">01</div>
          <div><h2 id="alliance-find-heading">{t("alliance.findHeading", "Find your alliance")}</h2><p>{t("alliance.findDescription", "Search the alliance rankings for your kingdom, then choose the matching alliance.")}</p></div>
        </div>
        <form className="ks-alliance-discover-form" onSubmit={discover}>
          <label className="ks-alliance-field"><span>{t("alliance.kingdom", "Kingdom ID")}</span><input value={kingdomId} onChange={event => { setKingdomId(event.target.value.replace(/\D/g, "").slice(0, 10)); searchRequestRef.current++; rosterRequestRef.current++; setDiscovering(false); setLoadingRoster(false); setAlliances([]); setActiveAlliance(null); setRoster(null); setSelected([]); setRegisteredIds([]); setOutcomes([]); setProcessedIds([]); setSearchError(""); setRosterError(""); }} inputMode="numeric" pattern="[0-9]*" maxLength={10} autoComplete="off" required aria-describedby="alliance-kingdom-help" placeholder={t("alliance.kingdomPlaceholder", "e.g. 1125")} disabled={discovering || registering}/><small className="ks-alliance-field-help" id="alliance-kingdom-help">{t("alliance.kingdomHelp", "Digits only. Use the kingdom where the alliance currently plays.")}</small></label>
          <div className="ks-alliance-optional-filter"><button type="button" className="ks-alliance-text-toggle" aria-expanded={filterOpen} onClick={() => setFilterOpen(value => !value)}><span>{t("alliance.filterOptional", "Filter by alliance name or tag (optional)")}</span><ChevronDown size={15} aria-hidden="true"/></button>{filterOpen && <label className="ks-alliance-field"><span>{t("alliance.searchLabel", "Alliance name or tag")}</span><div className="ks-alliance-search-input"><Search size={16} aria-hidden="true"/><input value={query} onChange={event => { setQuery(event.target.value); setSearchError(""); }} autoComplete="off" aria-label={t("alliance.searchLabel", "Alliance name or tag")} placeholder={t("alliance.searchPlaceholder", "Search by name or tag")} disabled={discovering || registering}/>{query && <button type="button" className="ks-alliance-input-clear" aria-label={t("alliance.clearSearch", "Clear alliance search")} onClick={() => { setQuery(""); setSearchError(""); }} disabled={discovering || registering}><X size={14}/></button>}</div></label>}</div>
          <button className="ks-alliance-primary" type="submit" disabled={discovering || registering || !kingdomId.trim()}>{discovering ? <LoaderCircle size={16} className="ks-alliance-spin"/> : <Search size={16}/>}<span>{discovering ? t("alliance.searching", "Searching…") : t("alliance.searchButton", "Search alliances")}</span></button>
        </form>
        <p className="ks-alliance-provider-note">{t("alliance.providerNote", "Alliance and roster data may not include every alliance and can be up to 60 minutes old. Review the member list before registering.")}</p>
        {searchError && <p className="ks-alliance-alert" role="status"><CircleAlert size={16}/><span>{searchError}</span></p>}
        {alliances.length > 0 && <div className="ks-alliance-results">
          <div className="ks-alliance-results-head"><div><strong>{t("alliance.resultsHeading", "Matching alliances")}</strong><small>{t("alliance.resultsHint", "Choose an alliance to preview its roster.")}</small></div><span>{filteredAlliances.length} found</span></div>
          {filteredAlliances.length === 0 ? <p className="ks-alliance-empty">{t("alliance.noMatches", "No matches in the returned ranking. You can try the exact alliance tag below.")}</p> : <div className="ks-alliance-cards">
            {filteredAlliances.map(item => <button type="button" key={item.kingdomId + ":" + item.tag} className={"ks-alliance-card" + (activeAlliance?.tag === item.tag && activeAlliance?.kingdomId === item.kingdomId ? " is-active" : "")} onClick={() => { void loadRoster(item); }} disabled={loadingRoster || registering}>
              <span className="ks-alliance-flag"><Users size={18} aria-hidden="true"/>{item.flagUrl && <img src={item.flagUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }}/>}</span>
              <span className="ks-alliance-card-copy"><strong>[{item.tag}] {item.name || item.tag}</strong><small>{t("alliance.kingdomLabel", "Kingdom")} {item.kingdomId}</small><small>{t("alliance.rankLabel", "Power rank")} {item.rank ?? "—"} · {item.memberCount ?? "—"} {t("alliance.members", "members")}</small></span>
              <ArrowRight size={17} aria-hidden="true"/>
            </button>)}
          </div>}
        </div>}

      </section>

      {loadingRoster && <div className="ks-alliance-loading" role="status"><LoaderCircle size={19} className="ks-alliance-spin"/><span>{t("alliance.loadingRoster", "Loading the alliance roster…")}</span></div>}
      {rosterError && <p className="ks-alliance-alert" role="alert"><CircleAlert size={16}/><span>{rosterError}</span></p>}

      {roster && <section className="ks-alliance-panel ks-alliance-roster" aria-labelledby="alliance-roster-heading">
        <div className="ks-alliance-panel-head">
          <div className="ks-alliance-step">02</div>
          <div><h2 id="alliance-roster-heading">{t("alliance.rosterHeading", "Review the roster")}</h2><p>{t("alliance.rosterDescription", "Choose the members to register. Selection is capped at 100 IDs per batch.")}</p></div>
        </div>
        <div className="ks-alliance-roster-summary">
          <div className="ks-alliance-roster-identity"><span className="ks-alliance-tag">[{roster.alliance.tag}]</span><div><strong>[{roster.alliance.tag}] {roster.alliance.name}</strong><small>{t("alliance.kingdomLabel", "Kingdom")} {roster.alliance.kingdomId} · {roster.members.length} {t("alliance.members", "members")}</small></div></div>
          <div className="ks-alliance-roster-stats"><span><b>{formatNumber(roster.alliance.power)}</b><small>{t("alliance.power", "Power")}</small></span><span><b>{roster.members.length}</b><small>{t("alliance.rosterMembers", "Valid IDs")}</small></span><span><b>{completedCount}</b><small>{t("alliance.attempted", "attempted")}</small></span><button type="button" className="ks-alliance-refresh" onClick={() => activeAlliance && void loadRoster(activeAlliance)} disabled={loadingRoster || registering}>{loadingRoster ? <LoaderCircle size={14} className="ks-alliance-spin"/> : <RotateCcw size={14}/>}<span>{t("alliance.refreshRoster", "Refresh roster")}</span></button></div>
        </div>
        <div className={"ks-alliance-data-note" + (roster.stale ? " is-stale" : "")} role="status"><Info size={15}/><span>{roster.stale ? t("alliance.staleRoster", "This roster may be outdated. Review names and IDs carefully before registering.") : t("alliance.freshRoster", "Roster loaded. Review the members below before registering.")}{typeof roster.ageSeconds === "number" && <small><Clock3 size={12}/>{t("alliance.dataAge", "Data age")}: {roster.ageSeconds < 60 ? Math.max(0, Math.round(roster.ageSeconds)) + "s" : Math.round(roster.ageSeconds / 60) + "m"}</small>}</span></div>
        {rosterChanges && <section className="ks-alliance-roster-diff" aria-label={t("alliance.rosterChangesTitle", "Refresh summary")}>
          <div className="ks-alliance-roster-diff-head"><strong>{t("alliance.rosterChangesTitle", "New members found")}</strong><span>{t("alliance.diffReviewOnly", "Only newly appearing members are listed. Existing registrations are left unchanged.")}</span></div>
          <div className="ks-alliance-roster-diff-stats"><span className="is-added"><b>{rosterChanges.added.length}</b><small>{t("alliance.newMembers", "New members")}</small></span></div>
          {rosterChanges.added.length > 0 && <div className="ks-alliance-diff-list"><strong>{t("alliance.newMembersHeading", "Newly found members")}</strong>{rosterChanges.added.slice(0, 12).map(member => <span key={member.playerId}>{member.name} <small>({member.playerId})</small></span>)}{rosterChanges.added.length > 12 && <small>{t("alliance.moreMembers", "and")} {rosterChanges.added.length - 12} {t("alliance.more", "more")}</small>}<button type="button" className="ks-alliance-secondary" onClick={selectNewMembers} disabled={registering}>{t("alliance.selectNewMembers", "Select new members")}</button></div>}
          {rosterChanges.added.length === 0 && <p>{t("alliance.noRosterChanges", "No new members were found since the previous refresh. Existing registrations remain unchanged.")}</p>}
        </section>}
        <div className="ks-alliance-selection-bar">
          <div className="ks-alliance-selection-count"><strong>{selected.length}<span> / {BATCH_LIMIT}</span></strong><span>{t("alliance.selectedThisBatch", "selected for this batch")}</span><small>{selectedVisibleCount} {t("alliance.selectedVisible", "of visible members selected")}</small></div>
          <div className="ks-alliance-selection-actions">
            <button type="button" className="ks-alliance-link-button" onClick={() => allVisibleSelected ? setSelected(current => current.filter(id => !visibleMembers.some(member => member.playerId === id))) : selectVisible()} disabled={!canRegister || registering || !visibleMembers.length}>{allVisibleSelected ? t("alliance.clearVisible", "Clear visible") : t("alliance.selectVisible", "Select visible")} <CheckCheck size={13}/></button>
            <button type="button" className="ks-alliance-link-button" onClick={() => setSelected([])} disabled={!canRegister || registering || !selected.length}>{t("alliance.clearSelection", "Clear selection")} <X size={13}/></button>
            <button type="button" className="ks-alliance-link-button" onClick={selectNextBatch} disabled={registering || remainingCount === 0}>{t("alliance.selectNext", "Select next batch")} <ArrowRight size={13}/></button>
          </div>
        </div>
        <label className="ks-alliance-member-filter"><Search size={15} aria-hidden="true"/><input value={memberFilter} onChange={event => setMemberFilter(event.target.value)} placeholder={t("alliance.memberFilterPlaceholder", "Filter by name, Player ID or rank")} aria-label={t("alliance.memberFilterLabel", "Filter alliance members")} disabled={registering}/></label>
        <div className="ks-alliance-member-list" role="group" aria-label={t("alliance.memberListLabel", "Alliance member selection")}>
          {visibleMembers.map(member => <label className={"ks-alliance-member" + (selected.includes(member.playerId) ? " is-selected" : "")} key={member.playerId}>
            <input type="checkbox" checked={selected.includes(member.playerId)} onChange={() => toggleMember(member.playerId)} disabled={!canRegister || registering || registeredIds.includes(member.playerId) || outcomes.some(item => item.id === member.playerId && item.kind === "existing") || (!selected.includes(member.playerId) && selected.length >= BATCH_LIMIT)}/>
            {member.avatarUrl ? <img className="ks-alliance-member-avatar" src={member.avatarUrl} alt="" loading="lazy"/> : <span className="ks-alliance-member-avatar ks-alliance-avatar-fallback"><UserRound size={16}/></span>}
            <span className="ks-alliance-member-copy"><strong>{member.name || t("alliance.unknownPlayer", "Kingshot Player")}</strong><small><span>ID {member.playerId}</span><i>·</i><span>{formatNumber(member.power)} {t("alliance.power", "power")}</span>{member.allianceRank && <><i>·</i><span>{member.allianceRank}</span></>}</small></span>
            {(registeredIds.includes(member.playerId) || outcomes.some(item => item.id === member.playerId && item.kind === "existing")) && <span className="ks-alliance-status-pill is-existing">{t("alliance.alreadyRegistered", "Already registered")}</span>}{selected.includes(member.playerId) && <Check size={16} className="ks-alliance-selected-check" aria-hidden="true"/>}
          </label>)}
          {!visibleMembers.length && <div className="ks-alliance-empty-state"><span><Search size={19}/></span><strong>{roster.members.length ? t("alliance.noMembersMatch", "No members match this filter.") : t("alliance.emptyRosterTitle", "No valid player IDs found")}</strong><p>{roster.members.length ? t("alliance.clearFilterHint", "Try a shorter name or clear the filter to see more members.") : t("alliance.emptyRosterBody", "This provider response did not include registerable player IDs. Try refreshing the roster or use the exact-tag lookup again later.")}</p>{memberFilter && <button type="button" className="ks-alliance-secondary" onClick={() => setMemberFilter("")}>{t("alliance.clearFilter", "Clear filter")}</button>}</div>}
        </div>
        <div className="ks-alliance-submit-row">
          <div className="ks-alliance-submit-note"><ShieldCheck size={16}/><span>{t("alliance.submitNote", "Already-registered players remain visible but cannot be registered twice. If automatic sync has not caught up, select any unregistered members here and submit them manually. Your game password is never requested.")}<small>{t("alliance.batchNote", "Only selected members are processed. You can review results before choosing another batch.")}</small></span></div>
          {canRegister ? <button type="button" className="ks-alliance-primary ks-alliance-register-button" onClick={() => canRegister ? void registerSelected() : window.location.href = "/profile?returnTo=" + encodeURIComponent("/alliance-registration")} disabled={registering || !selected.length}>{registering ? <LoaderCircle size={16} className="ks-alliance-spin"/> : <CheckCircle2 size={16}/>}<span>{registering ? t("alliance.registering", "Registering…") : t("alliance.registerBatch", "Register selected")} <b>{selected.length}</b></span></button> : <a className="ks-alliance-primary ks-alliance-register-button" href={"/profile?returnTo=" + encodeURIComponent("/alliance-registration")}><ShieldCheck size={16}/><span>{t("alliance.loginButton", "Sign in with Discord to register")}</span></a>}
        </div>
        {registering && <div className="ks-alliance-progress" role="status" aria-live="polite" aria-atomic="true"><div className="ks-alliance-progress-top"><strong>{t("alliance.registeringBatch", "Registering batch")}</strong><span>{progress.done} / {progress.total}</span></div><progress max={progress.total || 1} value={progress.done} aria-label={t("alliance.progressLabel", "Alliance registration progress")}/><small>{progress.currentId ? t("alliance.processingId", "Processing Player ID") + " " + progress.currentId : t("alliance.finalizing", "Finishing this batch…")}</small>{progress.note && <small className="ks-alliance-progress-note">{progress.note}</small>}</div>}
        {outcomes.length > 0 && <div className="ks-alliance-outcomes">
          <div className="ks-alliance-outcomes-head"><div><span className="ks-alliance-step">03</span><div><h2>{t("alliance.outcomesHeading", "Registration results")}</h2><p>{summary.registered + summary.existing + summary.reactivated} {t("alliance.activeResults", "active")} · {summary.disabled} {t("alliance.disabledResults", "disabled")} · {summary.failed} {t("alliance.failedResults", "need attention")}</p></div></div><button type="button" className="ks-alliance-link-button" onClick={() => { setSelected(outcomes.filter(item => item.kind === "failed" || item.kind === "disabled").map(item => item.id).slice(0, BATCH_LIMIT)); setRosterError(""); }} disabled={registering || !outcomes.some(item => item.kind === "failed" || item.kind === "disabled")}><RotateCcw size={14}/>{t("alliance.retryAttention", "Select issues to retry")}</button></div>
          <div className="ks-alliance-outcome-list" role="list" aria-label={t("alliance.outcomesHeading", "Registration results")}>{outcomes.map(item => <article className={"ks-alliance-outcome is-" + item.kind} key={item.id} role="listitem"><span className="ks-alliance-outcome-mark">{["registered", "existing", "reactivated"].includes(item.kind) ? <CheckCircle2 size={15}/> : <CircleAlert size={15}/>}</span><div><strong>{item.name || t("alliance.unknownPlayer", "Kingshot Player")}</strong><small>ID {item.id} · {item.label}</small>{item.kind === "existing" && <span className="ks-alliance-status-pill is-existing">{t("alliance.alreadyRegistered", "Already registered")}</span>}{["registered", "reactivated"].includes(item.kind) && <span className="ks-alliance-status-pill">{t("alliance.registeredThisSession", "Registered in this batch")}</span>}<p>{item.summary}</p></div></article>)}</div>
        </div>}
      </section>}
    </main>

    {activeAlliance && canRegister && <section className="ks-alliance-panel ks-alliance-sync-panel" aria-labelledby="ks-alliance-sync-title">
      <div className="ks-alliance-panel-head">
        <div className="ks-alliance-step">↻</div>
        <div><h2 id="ks-alliance-sync-title">{t("alliance.autoSyncTitle", "Automatic alliance sync")}</h2>
          <p>{t("alliance.autoSyncDescription", "Automatic sync runs every 24 hours. This schedule is fixed and cannot be changed. Only newly discovered, unregistered members are added; existing registrations are never removed.")}</p></div>
      </div>
      {!syncConfig ? <div className="ks-alliance-sync-body">
        <div className="ks-alliance-sync-fixed"><span className="ks-alliance-sync-fixed-icon"><Clock3 size={16}/></span><div><strong>{t("alliance.syncEvery24", "Every 24 hours")}</strong><small>{t("alliance.syncFixed", "Fixed schedule · cannot be changed")}</small></div></div>
        <button type="button" className="ks-alliance-primary" onClick={() => void setupAutoSync()} disabled={syncBusy}>
          {syncBusy ? <LoaderCircle size={15} className="ks-alliance-spin"/> : <Clock3 size={15}/>}
          {t("alliance.enableAutoSync", "Enable automatic sync")}
        </button>
      </div> : <div className="ks-alliance-sync-body">
        <div className="ks-alliance-sync-status"><span className={"ks-alliance-sync-dot " + (syncConfig.enabled ? "is-on" : "is-off")}></span>
          <div><strong>{syncConfig.enabled ? t("alliance.syncEnabled", "Automatic sync enabled") : t("alliance.syncPaused", "Automatic sync paused")}</strong>
            <small>{t("alliance.syncInterval", "Sync interval")}: 24h · {t("alliance.syncLastStatus", "Last status")}: {syncConfig.last_status || "pending"}</small>
            <small>{t("alliance.syncLastSuccess", "Last successful sync")}: {syncConfig.last_success_at ? new Date(syncConfig.last_success_at).toLocaleString() : t("alliance.syncNotYet", "Not yet")}</small>
            <small>{t("alliance.syncNextRun", "Next scheduled check")}: {syncConfig.next_run_at ? new Date(syncConfig.next_run_at).toLocaleString() : t("alliance.syncPending", "Pending")}</small>
            {syncConfig.last_error_message && <small className="ks-alliance-sync-error">{syncConfig.last_error_message}</small>}
          </div>
        </div>
        <div className="ks-alliance-sync-actions">
          <button type="button" className="ks-alliance-primary" onClick={() => void updateAutoSync("sync")} disabled={syncBusy}>{syncBusy ? <LoaderCircle size={14} className="ks-alliance-spin"/> : <RotateCcw size={14}/>} {t("alliance.syncNow", "Sync now")}</button>
          <button type="button" className="ks-alliance-secondary" onClick={() => void updateAutoSync(syncConfig.enabled ? "pause" : "resume")} disabled={syncBusy}>{syncConfig.enabled ? t("alliance.pauseSync", "Pause") : t("alliance.resumeSync", "Resume")}</button>
        </div>
        {syncResult && <small className="ks-alliance-sync-result">{syncResult.rosterCount ?? 0} {t("alliance.syncMembersChecked", "members checked")} · {syncResult.addedCount ?? 0} {t("alliance.syncRegistered", "registered or confirmed")} · {syncResult.skippedCount ?? 0} {t("alliance.syncUnchanged", "already tracked")}</small>}
      </div>}
      {syncMessage && <p className="ks-alliance-sync-message" role="status">{syncMessage}</p>}
      {syncError && <p className="ks-alliance-sync-error" role="alert">{syncError}</p>}
      <p className="ks-alliance-sync-footnote">{t("alliance.syncSafetyNote", "A provider outage or incomplete roster will not advance the schedule. Departed members are never deregistered. Automatic runs are handled server-side, not by an open browser tab.")}</p>
    </section>}
    <footer className="ks-alliance-page-footer"><span>{t("common.footer", "Independent Kingshot community service. Not affiliated with Century Games.")}</span><span><a href="/info">{t("info.title", "How it works")}</a> · <a href="/terms?service=kingshot-auto">{t("legal.termsTab", "Terms")}</a> · <a href="/privacy?service=kingshot-auto">{t("legal.privacyTab", "Privacy")}</a></span></footer>
  </div>;
}
