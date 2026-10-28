import React from "react";
import { ArrowRight, Sparkles, Users } from "lucide-react";
import { useSiteLanguage } from "../shared/site-language.js";

export default function AllianceFeatureAnnouncement() {
  const { t, isKorean } = useSiteLanguage();
  const message = isKorean
    ? "연맹 명단을 확인하고 아직 등록되지 않은 신규 구성원을 간편하게 등록하세요."
    : "Discover new alliance members and register only players who aren't registered yet.";
  return (
    <aside className="ks-alliance-feature-banner" aria-label={t("alliance.bannerLabel", "New feature: Alliance Registration")}>
      <span className="ks-alliance-feature-icon" aria-hidden="true"><Sparkles size={17} /></span>
      <div className="ks-alliance-feature-copy">
        <span className="ks-alliance-feature-kicker">{isKorean ? "새로운 기능" : "NEW FEATURE"}</span>
        <span className="ks-alliance-feature-message">{message}</span>
      </div>
      <span className="ks-alliance-feature-divider" aria-hidden="true" />
      <a className="ks-alliance-feature-link" href="/alliance-registration">
        <Users size={15} aria-hidden="true" />
        <span>{isKorean ? "연맹 등록" : t("alliance.bannerCta", "Alliance Registration")}</span>
        <ArrowRight size={14} aria-hidden="true" />
      </a>
    </aside>
  );
}
