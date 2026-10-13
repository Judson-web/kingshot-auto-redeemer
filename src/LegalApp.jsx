import React from "react";

const KINGSHOT_ICON="https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/ee/d2/22/eed22297-9313-d8b0-52c8-95f42a2795b2/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/0x0ss-85.png";

const services={
  "kingshot-manual":{label:"Kingshot Manual Redeemer",summary:"Manual gift-code redemption for a Kingshot Player ID."},
  "kingshot-auto":{label:"Kingshot Auto Redeem",summary:"Registration and automatic processing of eligible Kingshot gift codes."},
};

export default function LegalApp({type}){
  const key=new URLSearchParams(location.search).get("service");
  const service=services[key]||services["kingshot-manual"];
  const privacy=type==="privacy";
  const serviceKey=services[key]?key:"kingshot-manual";
  const effective="October 14, 2026";
  return <div className="app legal-app">
    <header><a className="brand ks-brand" href="/"><span className="brand-mark ks-brand-mark"><img src={KINGSHOT_ICON} alt="Kingshot"/></span><span>{privacy?"Privacy":"Terms"} · {service.label}</span></a><div className="header-right"><a className="legal-back" href="/">← Back</a></div></header>
    <main>
      <section className="legal-hero">
        <div className="eyebrow"><span/>{privacy?"PRIVACY NOTICE":"TERMS OF SERVICE"}</div>
        <h1>{privacy?"Your data. Clearly explained.":"Simple rules for using the service."}</h1>
        <p className="hero-copy">{service.summary}</p>
        <div className="legal-meta"><span>Effective {effective}</span><span>Independent community service</span></div>
        <div className="legal-tabs"><a className={!privacy?"active":""} href={"/terms?service="+serviceKey}>Terms</a><a className={privacy?"active":""} href={"/privacy?service="+serviceKey}>Privacy</a></div>
      </section>
      <section className="legal-body">
        {privacy?<>
          <h2>1. Who operates this service</h2>
          <p>This independent community project is operated by Judson. It is not operated, sponsored, or endorsed by Century Games, Kingshot, Discord, or any other referenced platform. These notices explain the service’s current practices; they are not legal advice or a promise that one law applies worldwide.</p>
          <h2>2. Information we use</h2>
          <p>Depending on the feature you use, we may process a Player ID, kingdom ID, player name or avatar URL, submitted gift codes, redemption outcomes, registration state, timestamps, and support or removal requests. Auto Redeem uses registration and processing records to run scheduled attempts, prevent duplicate work, and troubleshoot the service. We do not ask for your game password, payment details, or authentication codes.</p>
          <p>For site security and basic usage measurement, hosting systems may process request metadata. Our first-party page-view tracker may record an IP address, approximate location inferred from hosting headers, page path without query parameters, referrer hostname, browser/operating-system/device category, language, approximate screen-size class, and timestamp. It is not designed to collect form values, precise GPS location, or cross-site fingerprints.</p>
          <h2>3. Why we use it</h2>
          <p>We use information to provide redemption features, maintain registrations, show redemption results, respond to requests, secure and troubleshoot the service, prevent abuse, and understand aggregate site usage. We do not sell Player IDs or redemption records. We do not use the tracker to identify individual visitors publicly.</p>
          <h2>4. Storage and retention</h2>
          <p>Operational registration and redemption data are stored in private application infrastructure. Raw first-party visitor-event records are private and scheduled for deletion after 30 days. Some security, support, redemption, or audit records may be retained longer when reasonably needed for service integrity, dispute handling, abuse prevention, or legal obligations.</p>
          <p>Private operational archives and disaster-recovery copies may retain scraper history or limited registration-recovery data. These are not public analytics datasets. The public archive README displays aggregate page-view counts and grouped trends from our first-party tracker—not Vercel Analytics. Small groups are suppressed. Published counts represent page-view events, not unique visitors or sessions. Updates are scheduled approximately every five minutes on a best-effort basis and are not real-time. Public summaries do not include raw IP addresses, precise locations, full user-agent strings, or individual event records.</p>
          <h2>5. Service providers and external links</h2>
          <p>We rely on hosting, database, delivery, and other infrastructure providers and may communicate with game-related endpoints or Discord for service operations and support notifications. Those providers process information under their own terms and privacy notices. External links may lead to services we do not control. Optional browser push notifications, if offered and enabled, use a browser push subscription and may display messages on your device; you can revoke browser permission at any time.</p>
          <h2>6. Your privacy choices</h2>
          <p>You may request access to, correction of, or deletion of personal information associated with your registration, subject to applicable law and legitimate retention needs. Use the service’s support or registration-removal form and provide only the Player ID and details needed to locate the record. We may take reasonable steps to verify a request. Removing a registration stops future scheduled processing but does not automatically erase every historical, security, backup, or legally required record.</p>
          <h2>7. Texas and other privacy laws</h2>
          <p>Where applicable, we aim to handle personal data consistently with the Texas Data Privacy and Security Act (Texas Business & Commerce Code, Chapter 541), including applicable rights to access, correct, or delete personal data and to opt out of certain processing. The Act has scope rules, thresholds, and exemptions; this notice does not claim that it applies to every operator, user, or activity. Other federal, state, and non-U.S. laws may also apply depending on the circumstances. Where a law grants you rights, those rights are not limited by this notice.</p>
          <h2>8. Security and changes</h2>
          <p>We use reasonable measures intended to protect information, but no internet service or storage system can be guaranteed completely secure. We may update this notice when the service or its data practices change. The effective date above identifies the current revision; material changes may also be communicated through the service where reasonably practicable.</p>
          <h2>Contact and requests</h2>
          <p>Use the support or registration-removal form on the service for privacy requests or concerns. Do not send passwords, authentication codes, payment details, or other secrets.</p>
        </>:<>
          <h2>1. Using the service</h2>
          <p>This independent community service provides manual or automated processing of eligible Kingshot gift codes, depending on the page you use. Use it only for lawful purposes and only with a Player ID you own or are authorized to manage. You are responsible for the information you submit.</p>
          <h2>2. Redemption and automation</h2>
          <p>Gift codes, eligibility, and redemption systems are controlled by the underlying game service. Codes may expire, reach limits, be restricted, or fail. We do not guarantee that a code will work or that any attempt will succeed. For Auto Redeem, you authorize periodic processing of eligible codes for the Player ID you register.</p>
          <h2>3. Acceptable use</h2>
          <p>Do not register another person’s Player ID without authorization; bypass rate limits or cooldowns; evade restrictions; flood or disrupt systems; probe protected endpoints; harvest private data; attempt unauthorized access; or use the service for fraud, credential theft, phishing, malware, harassment, or unlawful activity. Normal, authorized redemption of eligible public gift codes is permitted.</p>
          <h2>4. Registration removal and notifications</h2>
          <p>You may request removal through the service’s support or removal form. Removal stops future scheduled processing but may not immediately erase historical redemption, support, security, audit, or backup records that are reasonably needed. If you enable browser push notifications, delivery depends on your browser, device, network, and push provider; messages may appear on a lock screen. You can revoke notification permission in your browser or device settings.</p>
          <h2>5. Availability and third parties</h2>
          <p>The service is provided on an “as available” basis. Features, integrations, data sources, and APIs may change or become unavailable. To the extent permitted by applicable law, we do not guarantee uninterrupted access, third-party data accuracy, or successful redemption. Kingshot, Century Games, Discord, and other names and marks belong to their respective owners. This project is independent and is not an official or endorsed service.</p>
          <h2>6. Suspension and changes</h2>
          <p>We may limit, suspend, or block access when reasonably necessary to protect the service, prevent abuse, respond to security issues, or enforce these terms. We may revise these terms as the service changes. The effective date above identifies the current version. If you do not agree, stop using the service and request registration removal where applicable.</p>
          <h2>7. Applicable law and mandatory rights</h2>
          <p>Applicable law depends on the circumstances and cannot be determined solely from this notice. These terms do not remove any consumer rights that cannot lawfully be waived. Mandatory laws that apply to you or the operator continue to apply.</p>
          <h2>Contact</h2>
          <p>For service questions or registration-removal requests, use the support or removal form on the service. Do not include passwords, authentication codes, payment details, or private credentials.</p>
        </>}
        <p className="legal-note">Effective {effective}. This is a plain-language summary of current service practices, not a legal opinion or certification of compliance. Legal requirements depend on the operator, processing activities, users, and applicable jurisdiction.</p>
      </section>
    </main>
    <footer><a className="brand ks-brand" href="/"><span className="brand-mark ks-brand-mark"><img src={KINGSHOT_ICON} alt="Kingshot"/></span><span>Kingshot Redeemer</span></a><span>© 2026 Judson · Independent community service</span><span><a href={"/terms?service="+serviceKey}>Terms</a> · <a href={"/privacy?service="+serviceKey}>Privacy</a></span></footer>
  </div>
}
