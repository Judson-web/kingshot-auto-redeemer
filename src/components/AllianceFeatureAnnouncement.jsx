import React from "react";
import { ArrowRight, Users } from "lucide-react";
import { useSiteLanguage } from "../shared/site-language.js";

export default function AllianceFeatureAnnouncement() {
  const { t, isKorean } = useSiteLanguage();
  const message = isKorean ? "연맹 명단을 확인하고 신규 구성원을 최대 100명씩 등록하세요." : "Refresh your alliance roster and register newly found members in batches of up to 100.";
  return <section className="ks-alliance-feature-banner" aria-label={t("alliance.bannerLabel", "New feature: Alliance Registration")}>
    <span className="ks-alliance-feature-icon" aria-hidden="true"><Users size={17}/></span>
    <div className="ks-alliance-feature-marquee" aria-label={message}>
      <div className="ks-alliance-feature-track">
        <span>{message}</span>
        <span aria-hidden="true">{message}</span>
      </div>
    </div>
    <a className="ks-alliance-feature-link" href="/alliance-registration">{t("alliance.bannerCta", "Alliance Registration")}<ArrowRight size={14} aria-hidden="true"/></a>
    <style>{`
      .ks-alliance-feature-banner{display:flex;align-items:center;gap:12px;width:min(1040px,calc(100% - 40px));min-height:48px;margin:12px auto 0;padding:0 12px;border:1px solid #393326;border-radius:12px;background:linear-gradient(100deg,#1b1913,#131411 72%);color:#e7d6aa;box-sizing:border-box}
      .ks-alliance-feature-icon{display:grid;place-items:center;flex:0 0 30px;width:30px;height:30px;border:1px solid #49402e;border-radius:9px;background:#252117;color:#d4bd88}
      .ks-alliance-feature-marquee{min-width:0;flex:1;overflow:hidden;mask-image:linear-gradient(90deg,transparent,#000 3%,#000 97%,transparent)}
      .ks-alliance-feature-track{display:flex;width:max-content;align-items:center;gap:34px;animation:ks-alliance-feature-scroll 34s linear infinite;white-space:nowrap;font-size:12px}
      .ks-alliance-feature-track span{padding:12px 0}
      .ks-alliance-feature-banner:hover .ks-alliance-feature-track{animation-play-state:paused}
      .ks-alliance-feature-link{display:inline-flex;align-items:center;justify-content:center;gap:7px;flex:0 0 auto;padding:9px 11px;border:1px solid #6c5c3d;border-radius:8px;background:#d4bd88;color:#1c1911;text-decoration:none;font-size:11px;font-weight:750;white-space:nowrap}
      .ks-alliance-feature-link:hover{background:#e4d2a6}
      @keyframes ks-alliance-feature-scroll{to{transform:translateX(-50%)}}
      @media(prefers-reduced-motion:reduce){.ks-alliance-feature-track{animation:none;white-space:normal;width:auto}.ks-alliance-feature-track span:nth-child(2),.ks-alliance-feature-track span:nth-child(4){display:none}}
      @media(max-width:560px){.ks-alliance-feature-banner{gap:8px;padding:0 8px}.ks-alliance-feature-icon{display:none}.ks-alliance-feature-link{padding:8px;font-size:10px}.ks-alliance-feature-track{font-size:11px}}
    `}</style>
  </section>;
}
