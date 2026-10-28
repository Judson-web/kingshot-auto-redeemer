import React from "react";
import { ArrowRight, Clock3, Sparkles, Users } from "lucide-react";
import { useSiteLanguage } from "../shared/site-language.js";

export default function AllianceFeatureAnnouncement() {
  const { t, isKorean } = useSiteLanguage();
  const message = isKorean
    ? "로그인 없이 연맹 정보와 전체 명단을 확인하세요. 자동 동기화를 기다리지 않고 미등록 구성원을 직접 등록할 수 있습니다."
    : "Preview alliance details and the full roster without signing in. Register unregistered members manually while automatic sync catches up.";
  return (
    <aside className="ks-alliance-feature-banner" aria-label={t("alliance.bannerLabel", "New feature: Alliance Registration")}>
      <span className="ks-alliance-feature-icon" aria-hidden="true"><Sparkles size={17} /></span>
      <div className="ks-alliance-feature-copy">
        <span className="ks-alliance-feature-kicker">{isKorean ? "새로운 기능" : "NEW FEATURE"}</span>
        <span className="ks-alliance-feature-message">{message}</span>
      </div>
      <span className="ks-alliance-feature-divider" aria-hidden="true" />
      <span className="ks-alliance-feature-schedule" title={isKorean ? "자동 동기화는 24시간마다 실행됩니다" : "Automatic sync runs every 24 hours"}><Clock3 size={13} aria-hidden="true" />24h</span>
      <a className="ks-alliance-feature-link" href="/alliance-registration">
        <Users size={15} aria-hidden="true" />
        <span>{isKorean ? "연맹 등록" : t("alliance.bannerCta", "Alliance Registration")}</span>
        <ArrowRight size={14} aria-hidden="true" />
      </a>
    </aside>
  );
}
