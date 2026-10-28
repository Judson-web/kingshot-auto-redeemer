import React from "react";
import { ArrowRight, Clock3, Sparkles, Users } from "lucide-react";
import { useSiteLanguage } from "../shared/site-language.js";

export default function AllianceFeatureAnnouncement() {
  const { t, isKorean } = useSiteLanguage();
  const message = isKorean
    ? "연맹 명단을 한눈에 확인하고, 새로운 구성원을 더 빠르게 등록하세요."
    : "Your alliance, at a glance. Find your roster and register new members in a few clicks.";
  return (
    <aside className="ks-alliance-feature-banner" aria-label={t("alliance.bannerLabel", "New feature: Alliance Registration")}>
      <span className="ks-alliance-feature-icon" aria-hidden="true"><Sparkles size={17} /></span>
      <div className="ks-alliance-feature-copy">
        <span className="ks-alliance-feature-kicker">{isKorean ? "새로운 기능" : "NEW FEATURE"} <b className="ks-beta-tag">BETA</b></span>
        <strong className="ks-alliance-feature-title">{isKorean ? "연맹 등록" : "Alliance Registration"}</strong>
        <span className="ks-alliance-feature-message">{message}</span>
      </div>
      <span className="ks-alliance-feature-divider" aria-hidden="true" />
      <span className="ks-alliance-feature-schedule" title={isKorean ? "자동 동기화는 24시간마다 실행됩니다" : "Automatic sync runs every 24 hours"}><Clock3 size={13} aria-hidden="true" />24h</span>
      <a className="ks-alliance-feature-link" href="/alliance-registration">
        <Users size={15} aria-hidden="true" />
        <span>{isKorean ? "사용해 보기" : "Try it"}</span>
        <ArrowRight size={14} aria-hidden="true" />
      </a>
    </aside>
  );
}
