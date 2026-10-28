import React, { useState } from "react";
import { ArrowRight, Clock3, Sparkles, Users, X } from "lucide-react";
import { useSiteLanguage } from "../shared/site-language.js";

export default function AllianceFeatureAnnouncement() {
  const { t, isKorean } = useSiteLanguage();
  const [dismissed, setDismissed] = useState(() => { try { return typeof window !== "undefined" && window.localStorage.getItem("ks-alliance-feature-dismissed") === "1"; } catch { return false; } });
  const dismiss = () => { setDismissed(true); try { window.localStorage.setItem("ks-alliance-feature-dismissed", "1"); } catch { /* Keep dismissed for this session if storage is unavailable. */ } };
  if (dismissed) return null;
  const message = isKorean
    ? "연맹 명단을 자동으로 불러와 전체 또는 원하는 구성원만 등록하세요."
    : "Load your alliance roster automatically, register everyone, or choose individual members.";
  return (
    <aside className="ks-alliance-feature-banner" aria-label={t("alliance.bannerLabel", "New feature: Alliance Registration")}>
      <span className="ks-alliance-feature-icon" aria-hidden="true"><Sparkles size={17} /></span>
      <div className="ks-alliance-feature-copy">
        <span className="ks-alliance-feature-kicker">{isKorean ? "새로운 기능" : "NEW FEATURE"} <b className="ks-beta-tag">BETA</b></span>
        <strong className="ks-alliance-feature-title">{isKorean ? "연맹 구성원 등록" : "Alliance Member Registration"}</strong>
        <span className="ks-alliance-feature-message">{message}</span>
      </div>
      <span className="ks-alliance-feature-divider" aria-hidden="true" />
      <span className="ks-alliance-feature-schedule" title={isKorean ? "자동 동기화는 24시간마다 실행됩니다" : "Automatic sync runs every 24 hours"}><Clock3 size={13} aria-hidden="true" />24h</span>
      <a className="ks-alliance-feature-link" href="/alliance-registration">
        <Users size={15} aria-hidden="true" />
        <span>{isKorean ? "사용해 보기" : "Try it"}</span>
        <ArrowRight className="ks-alliance-feature-arrow" size={14} aria-hidden="true" />
      </a>
      <button type="button" className="ks-alliance-feature-dismiss" onClick={dismiss} aria-label={isKorean ? "공지 닫기" : "Dismiss announcement"} title={isKorean ? "공지 닫기" : "Dismiss announcement"}><X size={13} aria-hidden="true" /></button>
    </aside>
  );
}
