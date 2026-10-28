import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, CircleAlert, Clock3, LoaderCircle, Search, ShieldCheck, Users, UserRound, RotateCcw, X } from "lucide-react";
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
  const [allianceSyncCapacity, setAllianceSyncCapacity] = useState<{registeredCount:number;limit:number;isRegistered:boolean;managedByCurrentUser:boolean;enabled:boolean;status:string|null;canRegister:boolean}|null>(null);
  const [syncHistory, setSyncHistory] = useState<{runs:Array<{id:string;status:string;created_at:string;finished_at:string|null;roster_count:number|null;added_count:number|null;skipped_count:number|null;departed_count:number|null;error_code:string|null;error_message:string|null}>;departedCount:number}>({runs:[],departedCount:0});
  const [loadingSyncHistory, setLoadingSyncHistory] = useState(false);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [rosterError, setRosterError] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [registeredIds, setRegisteredIds] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [processedIds, setProcessedIds] = useState<string[]>([]);
  const [registering, setRegistering] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const cancelRequestedRef = useRef(false);
  const registrationBusyRef = useRef(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, currentId: "", note: "" });
  const [allianceServerProgress, setAllianceServerProgress] = useState<{active:boolean;processedCount:number;totalCount:number;currentPlayerId:string;allianceTag:string;allianceName:string;kingdomId:string}|null>(null);
  const searchRequestRef = useRef(0);
  const rosterRequestRef = useRef(0);
  const restoredAllianceRef = useRef(false);
  const updateAllianceLocation = (kingdom?: string, tag?: string) => {
    const params = new URLSearchParams(window.location.search);
    if (kingdom && tag) { params.set("kingdomId", kingdom); params.set("allianceTag", tag); }
    else { params.delete("kingdomId"); params.delete("allianceTag"); }
    const queryString = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (queryString ? "?" + queryString : "") + window.location.hash);
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
    const remainingCount = (roster?.members || []).filter(member => !registeredIds.includes(member.playerId) && !processedIds.includes(member.playerId)).length;
  const unregisteredRosterCount = (roster?.members || []).filter(member => !registeredIds.includes(member.playerId) && !outcomes.some(item => item.id === member.playerId && item.kind === "existing")).length;

  const discover = async (event: React.FormEvent) => {
    event.preventDefault();
    const requestId = ++searchRequestRef.current;
    rosterRequestRef.current++;
    setSearchError("");
    setRosterError("");
    setLoadingRoster(false);
    setRoster(null);
    setActiveAlliance(null); updateAllianceLocation();
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

  const loadRoster = async (alliance: AllianceEntry, forceRefresh = false) => {
    updateAllianceLocation(alliance.kingdomId || kingdomId.trim(), alliance.tag);
    const requestId = ++rosterRequestRef.current;
    const sameAlliance = Boolean(
      roster &&
      roster.alliance.kingdomId === (alliance.kingdomId || kingdomId.trim()) &&
      roster.alliance.tag === alliance.tag
    );
    setActiveAlliance(alliance);
    const switchingAlliance = !activeAlliance || activeAlliance.tag.toLocaleLowerCase() !== alliance.tag.toLocaleLowerCase() || String(activeAlliance.kingdomId || kingdomId.trim()) !== String(alliance.kingdomId || kingdomId.trim());
    if (switchingAlliance) setAllianceSyncCapacity(null);
    if (!forceRefresh && roster && roster.alliance.kingdomId === (alliance.kingdomId || kingdomId.trim()) && roster.alliance.tag === alliance.tag) { setLoadingRoster(false); return; }
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
      // The cap applies only to alliance-sync configurations, never to player registration.
      try {
        const capacityResponse = await fetch("/api/kingshot-alliance-sync", { method:"POST", credentials:"same-origin", cache:"no-store", headers:{"content-type":"application/json"}, body:JSON.stringify({action:"capacity",kingdomId:alliance.kingdomId || kingdomId.trim(),allianceTag:alliance.tag}), signal:AbortSignal.timeout(10000) });
        const capacityData = await capacityResponse.json().catch(() => ({}));
        if (capacityResponse.ok && Number.isFinite(Number(capacityData.registeredCount)) && capacityData.limit === 3) setAllianceSyncCapacity({registeredCount:Number(capacityData.registeredCount),limit:3,isRegistered:Boolean(capacityData.isRegistered),managedByCurrentUser:Boolean(capacityData.managedByCurrentUser),enabled:Boolean(capacityData.enabled),status:typeof capacityData.status==="string"?capacityData.status:null,canRegister:Boolean(capacityData.canRegister)});
      } catch { setAllianceSyncCapacity(null); }
      setLoadingSyncHistory(true);
      try {
        const historyResponse = await fetch("/api/kingshot-alliance-sync", { method:"POST", credentials:"same-origin", cache:"no-store", headers:{"content-type":"application/json"}, body:JSON.stringify({action:"history",kingdomId:alliance.kingdomId || kingdomId.trim(),allianceTag:alliance.tag}), signal:AbortSignal.timeout(10000) });
        const historyData = await historyResponse.json().catch(() => ({}));
        if (requestId === rosterRequestRef.current && historyResponse.ok && Array.isArray(historyData.runs)) {
          setSyncHistory({runs:historyData.runs,departedCount:Math.max(0,Number(historyData.departedCount)||0)});
        } else if (requestId === rosterRequestRef.current) setSyncHistory({runs:[],departedCount:0});
      } catch {
        if (requestId === rosterRequestRef.current) setSyncHistory({runs:[],departedCount:0});
      } finally {
        if (requestId === rosterRequestRef.current) setLoadingSyncHistory(false);
      }
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


  useEffect(() => {
    if (restoredAllianceRef.current || accountState.status !== "authenticated" || !accountState.account) return;
    restoredAllianceRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const savedKingdom = String(params.get("kingdomId") || "").trim();
    const savedTag = String(params.get("allianceTag") || "").trim();
    if (!/^\d{1,10}$/.test(savedKingdom) || !/^[A-Za-z0-9_-]{1,20}$/.test(savedTag)) return;
    setKingdomId(savedKingdom);
    void loadRoster({ kingdomId: savedKingdom, tag: savedTag, name: savedTag, power: null, memberCount: null, leaderName: "", flagUrl: "", rank: null });
  }, [accountState.status, accountState.account]);
  
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

  useEffect(() => {
    const handlePageHide = () => { if (registrationBusyRef.current) cancelRequestedRef.current = true; };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, []);

  const registerSelected = async (requestedIds?: string[]) => {
    if (!roster || registering) return;
    const requested = requestedIds ? new Set(requestedIds) : new Set(selected);
    const batch = roster.members.filter(member => requested.has(member.playerId) && !registeredIds.includes(member.playerId)).slice(0, BATCH_LIMIT);
    if (!batch.length) return;
    if (batch.length > BATCH_LIMIT) {
      setRosterError(t("alliance.batchLimit", "A batch can contain at most 100 unique Player IDs."));
      return;
    }
    cancelRequestedRef.current = false;
    setCancelRequested(false);
    registrationBusyRef.current = true;
    setRegistering(true);
    setRosterError("");
    setProgress({ done: 0, total: batch.length, currentId: batch[0].playerId, note: "" });
    const processed = new Set(processedIds);
    let completedInBatch = 0;
    try {
      for (let index = 0; index < batch.length; index++) {
        if (cancelRequestedRef.current) break;
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
            for (let waited = 0; waited < (seconds + 1) * 1000 && !cancelRequestedRef.current; waited += 250) await delay(Math.min(250, (seconds + 1) * 1000 - waited));
            if (cancelRequestedRef.current) break;
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
        completedInBatch++;
        setProcessedIds(current => current.includes(id) ? current : [...current, id]);
        setOutcomes(current => [...current.filter(item => item.id !== id), outcome as Outcome]);
        if (outcome && ["registered", "existing", "reactivated"].includes(outcome.kind)) setRegisteredIds(current => current.includes(id) ? current : [...current, id]);
        setProgress({ done: index + 1, total: batch.length, currentId: index + 1 < batch.length ? batch[index + 1].playerId : "", note: "" });
      }
      if (cancelRequestedRef.current && completedInBatch < batch.length) setRosterError(t("alliance.cancelled", "Registration stopped after the current player. Remaining selected players were not submitted."));
    } finally {
      registrationBusyRef.current = false;
      setRegistering(false);
      setCancelRequested(false);
      setProgress(current => ({ ...current, currentId: "", note: "" }));
    }
    // The first explicit batch registration enables the fixed 24-hour alliance schedule.
    // A conflict means this alliance already has a single scheduler owner, so never create a duplicate.
    if (activeAlliance && batch.length) {
      try {
        const syncResponse = await fetch("/api/kingshot-alliance-sync", {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "create", kingdomId: activeAlliance.kingdomId || kingdomId.trim(), allianceTag: activeAlliance.tag, allianceName: activeAlliance.name })
        });
        const syncData = await syncResponse.json().catch(() => ({}));
        if (!syncResponse.ok && !(syncResponse.status === 409 && ["alliance_already_managed", "alliance_already_registered"].includes(String(syncData.code || "")))) {
          setRosterError(t("alliance.autoSyncSetupFailed", "Members were processed, but automatic 24-hour sync could not be enabled. Please try registering again later."));
        }
      } catch { /* Registration succeeds independently; the server scheduler can be retried later. */ }
    }
  };

  useEffect(() => {
    if (!activeAlliance || !roster || accountState.status !== "authenticated" || !accountState.account) {
      setAllianceServerProgress(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch("/api/kingshot-alliance-sync", {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "progress", kingdomId: activeAlliance.kingdomId || kingdomId.trim(), allianceTag: activeAlliance.tag }),
          signal: AbortSignal.timeout(10000)
        });
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (response.ok && data.active === true &&
            String(data.kingdomId) === String(activeAlliance.kingdomId || kingdomId.trim()) &&
            String(data.allianceTag).toLocaleLowerCase() === activeAlliance.tag.toLocaleLowerCase() &&
            Number.isFinite(Number(data.totalCount)) && Number(data.totalCount) >= 0) {
          setAllianceServerProgress({
            active: true,
            processedCount: Math.max(0, Number(data.processedCount) || 0),
            totalCount: Math.max(0, Number(data.totalCount) || 0),
            currentPlayerId: /^\d{5,20}$/.test(String(data.currentPlayerId || "")) ? String(data.currentPlayerId) : "",
            allianceTag: String(data.allianceTag),
            allianceName: String(data.allianceName || data.allianceTag),
            kingdomId: String(data.kingdomId)
          });
        } else if (response.ok || response.status === 401 || response.status === 403) {
          // When the durable server job finishes, refresh player statuses from the source of truth.
          const completed = Boolean(allianceServerProgress?.active);
          setAllianceServerProgress(null);
          if (completed && !cancelled) void loadRoster(activeAlliance, true);
        }
        // Keep the last confirmed progress through transient 429/5xx responses.
      } catch {
        // A temporary status-read failure must not affect or cancel server-side registration.
      }
      if (!cancelled && (registering || allianceServerProgress?.active)) timer = setTimeout(poll, 4000);
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [activeAlliance?.kingdomId, activeAlliance?.tag, roster?.alliance?.tag, accountState.status, accountState.account, kingdomId, registering, allianceServerProgress?.active]);
  const canRegister = accountState.status === "authenticated" && Boolean(accountState.account);

  const registerEntireAlliance = async () => {
    if (!roster || !activeAlliance || registering || !canRegister) return;
    cancelRequestedRef.current = false;
    setCancelRequested(false);
    setRegistering(true);
    registrationBusyRef.current = true;
    setRosterError("");
    setProgress({ done: 0, total: roster.members.length, currentId: "", note: t("alliance.registeringProgress", "The server is registering eligible members. Already-registered players are skipped.") });
    try {
      const response = await fetch("/api/kingshot-alliance-sync", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "register-alliance", kingdomId: activeAlliance.kingdomId || kingdomId.trim(), allianceTag: activeAlliance.tag, allianceName: activeAlliance.name })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (String(data.code || "") === "kingdom_alliance_limit") {
          setAllianceSyncCapacity(current => ({ registeredCount: Math.max(3, current?.registeredCount ?? 3), limit: 3, isRegistered: false, managedByCurrentUser: false, enabled: false, status: null, canRegister: false }));
          throw new Error(t("alliance.kingdomAllianceCapReached", "This kingdom already has 3 registered alliances (3/3). No more alliances can be registered here."));
        }
        throw new Error(String(data.error || t("alliance.allianceRegistrationFailed", "Could not register this alliance.")));
      }
      // Reflect the accepted registration immediately while the server continues processing the roster.
      setAllianceSyncCapacity(current => ({ registeredCount: current?.registeredCount ?? 0, limit: 3, isRegistered: true, managedByCurrentUser: current?.managedByCurrentUser ?? true, enabled: true, status: "active", canRegister: false }));
      setProgress({ done: roster.members.length, total: roster.members.length, currentId: "", note: t("alliance.serverContinues", "Registration continues on the server. You can leave this page.") });
      await loadRoster(activeAlliance, true);
    } catch (cause) {
      setRosterError(cause instanceof Error ? cause.message : t("alliance.allianceRegistrationFailed", "Could not register this alliance."));
    } finally {
      registrationBusyRef.current = false;
      setRegistering(false);
      setCancelRequested(false);
      setProgress(current => ({ ...current, currentId: "", note: "" }));
    }
  };
  const selectableVisibleMembers = visibleMembers.filter(member => !registeredIds.includes(member.playerId) && !outcomes.some(item => item.id === member.playerId && item.kind === "existing"));
  const allVisibleSelected = selectableVisibleMembers.length > 0 && selectableVisibleMembers.every(member => selected.includes(member.playerId));
  return <div className="app ks-app ks-alliance-app">
    <a className="skip-link" href="#alliance-main">{t("common.skip", "Skip to main content")}</a>
    <PublicSiteHeader current="alliance-registration" />
    <main id="alliance-main">
      {accountState.status !== "authenticated" || !accountState.account ? <section className="ks-alliance-login-gate" aria-labelledby="alliance-login-heading">
        <span className="ks-alliance-login-icon" aria-hidden="true"><ShieldCheck size={24}/></span>
        <div className="ks-alliance-eyebrow"><span aria-hidden="true"/>ALLIANCE REGISTRATION</div>
        <h1 id="alliance-login-heading">{t("alliance.loginTitle", "Alliance Registration")}</h1>
        <p>Sign in with Discord to register an alliance.</p>
        {accountState.status === "checking" || accountState.status === "cached"
          ? <button type="button" className="ks-alliance-primary ks-alliance-login-button" disabled><LoaderCircle size={16} className="ks-alliance-spin"/>{t("alliance.checkingAccount", "Checking sign-in…")}</button>
          : <a className="ks-alliance-primary ks-alliance-login-button" href={"/profile?returnTo=" + encodeURIComponent("/alliance-registration")}><ShieldCheck size={16}/>{t("alliance.loginButton", "Continue with Discord")}</a>}
        
      </section> : <>
      <div className="ks-alliance-page-head"><h1>{t("alliance.pageTitle", "Alliance Registration")}</h1></div>

      <section className="ks-alliance-panel ks-alliance-discovery" aria-labelledby="alliance-find-heading">
        <div className="ks-alliance-panel-head">
          <div className="ks-alliance-step">01</div>
          <div><h2 id="alliance-find-heading">Find an alliance</h2></div>
        </div>
        <form className="ks-alliance-discover-form" onSubmit={discover}>
          <label className="ks-alliance-field"><span>{t("alliance.kingdom", "Kingdom ID")}</span><input value={kingdomId} onChange={event => { setKingdomId(event.target.value.replace(/\D/g, "").slice(0, 10)); searchRequestRef.current++; rosterRequestRef.current++; setDiscovering(false); setLoadingRoster(false); setAlliances([]); setActiveAlliance(null); updateAllianceLocation(); setRoster(null); setSelected([]); setRegisteredIds([]); setOutcomes([]); setProcessedIds([]); setSearchError(""); setRosterError(""); }} inputMode="numeric" pattern="[0-9]*" maxLength={10} autoComplete="off" required aria-describedby="alliance-kingdom-help" placeholder={t("alliance.kingdomPlaceholder", "e.g. 1125")} disabled={discovering || registering}/><small className="ks-alliance-field-help" id="alliance-kingdom-help">{t("alliance.kingdomHelp", "Digits only. Use the kingdom where the alliance currently plays.")}</small></label>
          {alliances.length > 0 && !activeAlliance && <div className="ks-alliance-optional-filter"><button type="button" className="ks-alliance-text-toggle" aria-expanded={filterOpen} onClick={() => setFilterOpen(value => !value)}><span>{t("alliance.filterOptional", "Filter alliances (optional)")}</span><ChevronDown size={15} aria-hidden="true"/></button>{filterOpen && <label className="ks-alliance-field"><span>{t("alliance.searchLabel", "Alliance name or tag")}</span><div className="ks-alliance-search-input"><Search size={16} aria-hidden="true"/><input value={query} onChange={event => { setQuery(event.target.value); setSearchError(""); }} autoComplete="off" aria-label={t("alliance.searchLabel", "Alliance name or tag")} placeholder={t("alliance.searchPlaceholder", "Search by name or tag")} disabled={discovering || registering}/>{query && <button type="button" className="ks-alliance-input-clear" aria-label={t("alliance.clearSearch", "Clear alliance search")} onClick={() => { setQuery(""); setSearchError(""); }} disabled={discovering || registering}><X size={14}/></button>}</div></label>}</div>}
          <button className="ks-alliance-primary" type="submit" disabled={discovering || registering || !kingdomId.trim()}>{discovering ? <LoaderCircle size={16} className="ks-alliance-spin"/> : <Search size={16}/>}<span>{discovering ? t("alliance.searching", "Searching…") : t("alliance.searchButton", "Search alliances")}</span></button>
        </form>
        {searchError && <p className="ks-alliance-alert" role="status"><CircleAlert size={16}/><span>{searchError}</span></p>}
        {activeAlliance && loadingRoster && <div className="ks-alliance-loading ks-alliance-loading-inline" role="status"><LoaderCircle size={19} className="ks-alliance-spin"/><span>{t("alliance.loadingAllianceInfo", "Loading")} <strong>[{activeAlliance.tag}] {activeAlliance.name}</strong> {t("alliance.infoSuffix", "info")}…</span></div>}
        {activeAlliance && !roster && <button type="button" className="ks-alliance-link-button ks-alliance-back-to-list" onClick={() => { rosterRequestRef.current++; setLoadingRoster(false); setActiveAlliance(null); updateAllianceLocation(); setRosterError(""); }} disabled={registering}><ChevronDown size={14} aria-hidden="true"/>{t("alliance.backToList", "Back to alliance list")}</button>}
        {!activeAlliance && alliances.length > 0 && <div className="ks-alliance-results">
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

      {rosterError && <p className="ks-alliance-alert" role="alert"><CircleAlert size={16}/><span>{rosterError}</span></p>}

      {activeAlliance && roster && <section className="ks-alliance-panel ks-alliance-roster" aria-labelledby="alliance-roster-heading">
        <div className="ks-alliance-panel-head">
          <div className="ks-alliance-step">02</div>
          <div><h2 id="alliance-roster-heading">{t("alliance.rosterHeading", "Alliance members")}</h2><button type="button" className="ks-alliance-link-button ks-alliance-back-to-list" onClick={() => { if (!registering) setActiveAlliance(null); updateAllianceLocation(); }} disabled={registering}><ChevronDown size={14} aria-hidden="true"/>{t("alliance.backToList", "Back to alliance list")}</button></div>
        </div>
        <div className="ks-alliance-roster-summary">
          <div className="ks-alliance-roster-identity"><span className="ks-alliance-tag ks-alliance-roster-flag"><Users size={18} aria-hidden="true"/>{(roster.alliance.flagUrl || activeAlliance.flagUrl) && <img src={roster.alliance.flagUrl || activeAlliance.flagUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = "none"; }}/>}</span><div><strong>[{roster.alliance.tag}] {roster.alliance.name}</strong><small>{t("alliance.kingdomLabel", "Kingdom")} {roster.alliance.kingdomId} · {roster.members.length} {t("alliance.members", "members")}</small></div></div>
          <div className="ks-alliance-roster-actions">
            {allianceSyncCapacity?.isRegistered ? <span className="ks-alliance-status-pill is-existing" role="status"><CheckCircle2 size={14}/>{t("alliance.allianceAlreadyRegistered", "Registered")}</span> : (allianceSyncCapacity?.canRegister || (!allianceSyncCapacity && !loadingRoster)) ? <button type="button" className="ks-alliance-primary ks-alliance-register-all-button ks-alliance-register-near-info" onClick={() => void registerEntireAlliance()} disabled={registering || !unregisteredRosterCount}>{registering ? <LoaderCircle size={16} className="ks-alliance-spin"/> : <Users size={16}/>}<span>{registering ? t("alliance.registering", "Registering…") : t("alliance.registerButton", "Register")} <b>{unregisteredRosterCount}</b></span></button> : null}{(registering || allianceSyncCapacity?.isRegistered) && <small className="ks-alliance-server-note">{t("alliance.serverContinues", "Registration continues on the server. You can leave this page.")}</small>}
            <button type="button" className="ks-alliance-refresh" onClick={() => activeAlliance && void loadRoster(activeAlliance, true)} disabled={loadingRoster || registering}>{loadingRoster ? <LoaderCircle size={14} className="ks-alliance-spin"/> : <RotateCcw size={14}/>}<span>{t("alliance.refreshRoster", "Refresh")}</span></button>
          </div>
          <div className={"ks-alliance-freshness " + (roster.stale ? "is-stale" : "is-fresh")} role="status" aria-live="polite">
            <span className="ks-alliance-freshness-dot" aria-hidden="true"/>
            <span><strong>{roster.stale ? t("alliance.rosterStaleTitle", "Roster may be outdated") : t("alliance.rosterFreshTitle", "Roster loaded")}</strong><small>{roster.fetchedAt ? t("alliance.lastFetched", "Last fetched") + " " + new Date(roster.fetchedAt).toLocaleString() : t("alliance.fetchTimeUnknown", "Fetch time unavailable")}{typeof roster.ageSeconds === "number" ? " · " + t("alliance.dataAge", "Data age") + ": " + (roster.ageSeconds < 60 ? Math.max(0,Math.floor(roster.ageSeconds)) + "s" : Math.floor(roster.ageSeconds / 60) + "m") : ""}</small></span>
          </div>
          <div className="ks-alliance-roster-stats"><span><b>{formatNumber(roster.alliance.power)}</b><small>{t("alliance.power", "Power")}</small></span><span><b>{roster.members.length}</b><small>{t("alliance.members", "Members")}</small></span></div>
        </div>
        {allianceSyncCapacity && <p className="ks-alliance-capacity-note" role="status">{allianceSyncCapacity.registeredCount < allianceSyncCapacity.limit ? t("alliance.capacityRemaining", "Alliance sync registrations in this kingdom:") + " " + allianceSyncCapacity.registeredCount + "/" + allianceSyncCapacity.limit + " · " + (allianceSyncCapacity.limit-allianceSyncCapacity.registeredCount) + " " + t("alliance.slotsRemaining", "slot(s) remaining") : t("alliance.capacityFullNote", "The kingdom's three alliance-sync slots are full. Individual player registration through Auto Redeem is unaffected.")}</p>}
        <section className="ks-alliance-history" aria-labelledby="alliance-history-heading">
          <div className="ks-alliance-history-heading"><div><h3 id="alliance-history-heading">{t("alliance.syncHistoryTitle", "Recent sync history")}</h3><p>{t("alliance.syncHistoryIntro", "A short record of automatic alliance sync runs. This does not change any player's Auto Redeem registration.")}</p></div><button type="button" className="ks-alliance-refresh" onClick={() => activeAlliance && void loadRoster(activeAlliance, true)} disabled={loadingRoster || registering || loadingSyncHistory}>{loadingSyncHistory ? <LoaderCircle size={14} className="ks-alliance-spin" aria-hidden="true"/> : <RotateCcw size={14} aria-hidden="true"/>}<span>{t("alliance.refreshHistory", "Refresh history")}</span></button></div>
          {syncHistory.departedCount > 0 && <p className="ks-alliance-departed-note">{syncHistory.departedCount} {t("alliance.departedMembersCurrent", "former member(s) are retained in sync history and excluded from the live roster. Their normal Auto Redeem registration is unchanged.")}</p>}
          {loadingSyncHistory ? <p className="ks-alliance-history-empty" role="status">{t("alliance.historyLoading", "Loading sync history…")}</p> : syncHistory.runs.length ? <ol className="ks-alliance-history-list">
            {syncHistory.runs.map(run => <li key={run.id} className={"ks-alliance-history-item is-" + String(run.status || "unknown")}>
              <div className="ks-alliance-history-item-top"><strong>{t("alliance.syncRunStatus", "Sync")}: {t("alliance.runStatus." + run.status, run.status || t("alliance.unknownStatus", "Unknown"))}</strong><time dateTime={run.created_at}>{new Date(run.created_at).toLocaleString()}</time></div>
              <p>{t("alliance.historyRoster", "Roster")}: {run.roster_count ?? "—"} · {t("alliance.historyAdded", "New registrations")}: {run.added_count ?? 0} · {t("alliance.historySkipped", "Already registered / skipped")}: {run.skipped_count ?? 0} · {t("alliance.historyDeparted", "Departed this run")}: {run.departed_count ?? 0}</p>
              {run.error_message && <p className="ks-alliance-history-error"><strong>{t("alliance.historyNeedsAttention", "Needs attention")}:</strong> {run.error_message} {t("alliance.historyRetryHint", "Refresh the roster and retry registration only after checking the affected Player IDs.")}</p>}
            </li>)}
          </ol> : <p className="ks-alliance-history-empty">{t("alliance.historyEmpty", "No completed sync runs are recorded yet. Registering this alliance will start its sync history.")}</p>}
        </section>
        {allianceSyncCapacity && !allianceSyncCapacity.isRegistered && allianceSyncCapacity.registeredCount >= allianceSyncCapacity.limit && <div className="ks-alliance-cap-alert" role="status"><CircleAlert size={17} aria-hidden="true"/><span><strong>{t("alliance.kingdomAllianceCapTitle", "Kingdom registration limit reached")}</strong><small>{t("alliance.kingdomAllianceCapReached", "This kingdom already has 3 registered alliances (3/3). No more alliances can be registered here.")}</small></span><b>{allianceSyncCapacity.registeredCount}/{allianceSyncCapacity.limit}</b></div>}
        {allianceServerProgress?.active && allianceServerProgress.allianceTag.toLocaleLowerCase() === activeAlliance.tag.toLocaleLowerCase() && allianceServerProgress.kingdomId === String(activeAlliance.kingdomId || kingdomId.trim()) && <div className="ks-alliance-server-progress" role="status" aria-live="polite" aria-atomic="true">
          <div className="ks-alliance-server-progress-top"><span><LoaderCircle size={13} className="ks-alliance-spin" aria-hidden="true"/><strong>{t("alliance.serverProgressTitle", "Registering alliance")} · [{allianceServerProgress.allianceTag}] {allianceServerProgress.allianceName}</strong></span><b>{allianceServerProgress.processedCount} / {allianceServerProgress.totalCount || "—"}</b></div>
          <progress max={allianceServerProgress.totalCount || 1} value={Math.min(allianceServerProgress.processedCount, allianceServerProgress.totalCount || 0)} aria-label={t("alliance.progressLabel", "Alliance registration progress")}/>
          <small>{allianceServerProgress.currentPlayerId ? t("alliance.serverProgressCurrent", "Processing Player ID") + " " + allianceServerProgress.currentPlayerId : t("alliance.serverProgressChecking", "Checking and registering eligible members on the server…")}</small>
        </div>}
        <label className="ks-alliance-member-filter"><Search size={15} aria-hidden="true"/><input value={memberFilter} onChange={event => setMemberFilter(event.target.value)} placeholder={t("alliance.memberFilterPlaceholder", "Filter by name, Player ID or rank")} aria-label={t("alliance.memberFilterLabel", "Filter alliance members")} disabled={registering}/></label>
        <div className="ks-alliance-member-list" role="list" aria-label={t("alliance.memberListLabel", "Alliance members")}>
          {visibleMembers.map(member => <article className="ks-alliance-member" key={member.playerId} role="listitem">
            {member.avatarUrl ? <img className="ks-alliance-member-avatar" src={member.avatarUrl} alt="" loading="lazy"/> : <span className="ks-alliance-member-avatar ks-alliance-avatar-fallback"><UserRound size={16}/></span>}
            <span className="ks-alliance-member-copy"><strong>{member.name || t("alliance.unknownPlayer", "Kingshot Player")}</strong><small><span>ID {member.playerId}</span><i>·</i><span>{formatNumber(member.power)} power</span>{member.allianceRank && <><i>·</i><span>{member.allianceRank}</span></>}</small></span>
            <span className={"ks-alliance-status-pill " + (registeredIds.includes(member.playerId) ? "is-existing" : "is-unregistered")}>{registeredIds.includes(member.playerId) ? t("alliance.alreadyRegistered", "Registered") : t("alliance.notRegistered", "Not registered")}</span>
          </article>)}
          {!visibleMembers.length && <div className="ks-alliance-empty-state"><strong>No players found</strong></div>}
        </div>
      </section>}
      </>}
    </main>

    <footer className="ks-alliance-page-footer"><span>{t("common.footer", "Independent Kingshot community service. Not affiliated with Century Games.")}</span><span><a href="/info">{t("info.title", "How it works")}</a> · <a href="/terms?service=kingshot-auto">{t("legal.termsTab", "Terms")}</a> · <a href="/privacy?service=kingshot-auto">{t("legal.privacyTab", "Privacy")}</a></span></footer>
  </div>;
}
