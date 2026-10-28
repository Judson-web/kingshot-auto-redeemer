import React, { useMemo, useState } from "react";
import { Search, Users, Check, ChevronDown, ChevronUp, LoaderCircle, Plus } from "lucide-react";
import { useSiteLanguage } from "./shared/site-language.js";
import "./alliance-registration.css";

type AllianceMember = {
 playerId: string; name: string; power: number | null; townCenterLevel: number | null;
 avatarUrl: string; allianceRank: string; kingdomId: string;
};
type AllianceResult = {
 alliance: { name: string; tag: string; kingdomId: string; power: number | null; count: number; leaderName: string };
 members: AllianceMember[]; stale?: boolean; fetchedAt?: string | null;
};
const number = (value: number | null) => value == null ? "—" : new Intl.NumberFormat(undefined, { notation: value >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);

export default function AllianceRegistration({ onAddPlayers, disabled = false }: {
 onAddPlayers: (members: AllianceMember[]) => void; disabled?: boolean;
}) {
 const { t } = useSiteLanguage();
 const [open, setOpen] = useState(false);
 const [kingdomId, setKingdomId] = useState("");
 const [tag, setTag] = useState("");
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState("");
 const [result, setResult] = useState<AllianceResult | null>(null);
 const [selected, setSelected] = useState<string[]>([]);
 const [filter, setFilter] = useState("");
 const visible = useMemo(() => (result?.members || []).filter(member =>
  (member.name + " " + member.playerId).toLowerCase().includes(filter.trim().toLowerCase())
 ), [result, filter]);
 const search = async (event: React.FormEvent) => {
  event.preventDefault();
  setLoading(true); setError(""); setResult(null); setSelected([]);
  try {
   const response = await fetch("/api/kingshot-alliance?kingdomId=" + encodeURIComponent(kingdomId.trim()) + "&tag=" + encodeURIComponent(tag.trim()), { cache: "no-store", signal: AbortSignal.timeout(25_000) });
   const data = await response.json().catch(() => ({}));
   if (!response.ok) throw new Error(data.error || t("alliance.lookupFailed", "Could not find that alliance."));
   setResult(data);
   setSelected((data.members || []).slice(0, 10).map((member: AllianceMember) => member.playerId));
  } catch (cause) {
   setError(cause instanceof Error ? cause.message : t("alliance.lookupFailed", "Could not find that alliance."));
  } finally { setLoading(false); }
 };
 const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : current.length >= 10 ? current : [...current, id]);
 const allVisibleSelected = visible.length > 0 && visible.every(member => selected.includes(member.playerId));
 const add = () => {
  if (!result) return;
  const chosen = result.members.filter(member => selected.includes(member.playerId));
  if (chosen.length) onAddPlayers(chosen);
  setOpen(false);
 };
 return <section className="ks-alliance-picker">
  <button type="button" className="ks-alliance-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)} disabled={disabled}>
   <span className="ks-alliance-toggle-icon"><Users size={18}/></span>
   <span className="ks-alliance-toggle-copy"><strong>{t("alliance.title", "Register an entire alliance")}</strong><small>{t("alliance.description", "Find your alliance and choose members to add by Player ID.")}</small></span>
   {open ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
  </button>
  {open && <div className="ks-alliance-body">
   <form className="ks-alliance-search" onSubmit={search}>
    <label><span>{t("alliance.kingdom", "Kingdom ID")}</span><input inputMode="numeric" pattern="[0-9]*" value={kingdomId} onChange={event => setKingdomId(event.target.value.replace(/[^0-9]/g, "").slice(0, 10))} placeholder="e.g. 1125" required disabled={loading}/></label>
    <label><span>{t("alliance.tag", "Alliance tag")}</span><input value={tag} onChange={event => setTag(event.target.value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 20))} placeholder="e.g. APX" required disabled={loading}/></label>
    <button type="submit" disabled={loading || disabled || !kingdomId.trim() || !tag.trim()}>{loading ? <LoaderCircle size={16} className="ks-alliance-spin"/> : <Search size={16}/>} {t("alliance.find", "Find alliance")}</button>
   </form>
   <p className="ks-alliance-hint">{t("alliance.searchHint", "Alliance tags can repeat across kingdoms, so both fields are required.")}</p>
   {error && <p className="ks-alliance-error" role="alert">{error}</p>}
   {result && <div className="ks-alliance-results">
    <div className="ks-alliance-summary"><div><span className="ks-alliance-tag">[{result.alliance.tag}]</span><strong>{result.alliance.name}</strong><small>{t("alliance.kingdomLabel", "Kingdom")} {result.alliance.kingdomId} · {result.members.length} {t("alliance.members", "members")}</small></div><span className="ks-alliance-power">{number(result.alliance.power)} {t("alliance.power", "power")}</span></div>
    {result.stale && <p className="ks-alliance-hint">{t("alliance.stale", "The provider returned its latest cached roster. Confirm members in-game before registering.")}</p>}
    {!result.members.length ? <p className="ks-alliance-hint">{t("alliance.empty", "No valid player IDs were returned for this roster.")}</p> : <>
     <div className="ks-alliance-list-head"><strong>{t("alliance.chooseMembers", "Choose up to 10 members")}</strong><button type="button" onClick={() => setSelected(current => allVisibleSelected ? current.filter(id => !visible.some(member => member.playerId === id)) : [...new Set([...current, ...visible.map(member => member.playerId)])].slice(0, 10))}>{allVisibleSelected ? t("alliance.clearVisible", "Clear visible") : t("alliance.selectVisible", "Select visible")}</button></div>
     <input className="ks-alliance-filter" aria-label={t("alliance.filter", "Filter members")} value={filter} onChange={event => setFilter(event.target.value)} placeholder={t("alliance.filterPlaceholder", "Filter by name or Player ID")}/>
     <div className="ks-alliance-member-list">{visible.map(member => <label className="ks-alliance-member" key={member.playerId}><input type="checkbox" checked={selected.includes(member.playerId)} onChange={() => toggle(member.playerId)}/>{member.avatarUrl ? <img src={member.avatarUrl} alt="" loading="lazy"/> : <span className="ks-alliance-avatar"><Users size={15}/></span>}<span className="ks-alliance-member-copy"><strong>{member.name}</strong><small>ID {member.playerId} · {number(member.power)} {t("alliance.power", "power")}</small></span>{selected.includes(member.playerId) && <Check size={16} className="ks-alliance-check"/>}</label>)}</div>
     <div className="ks-alliance-footer"><span>{selected.length} / {result.members.length} {t("alliance.selected", "selected")}</span><button type="button" onClick={add} disabled={!selected.length}><Plus size={16}/>{t("alliance.addSelected", "Add selected IDs")}</button></div>
    </>}
   </div>}
  </div>}
 </section>;
}
