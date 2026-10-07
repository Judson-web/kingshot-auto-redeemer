import React from "react";

const services={
  "kingshot-manual":{label:"Kingshot Manual Redeemer",summary:"Manual gift-code redemption for a Kingshot Player ID."},
  "kingshot-auto":{label:"Kingshot Auto Redeem",summary:"Registration and automatic processing of active Kingshot gift codes."},
};

export default function LegalApp({type}){
  const key=new URLSearchParams(location.search).get("service");
  const service=services[key]||services["kingshot-manual"];
  const privacy=type==="privacy";
  const serviceKey=key||"kingshot-manual";
  return <div className="app legal-app">
    <header><a className="brand" href="/"><span className="brand-mark">K</span><span>{privacy?"Privacy":"Terms"} · {service.label}</span></a><div className="header-right"><a className="legal-back" href="/">← Back</a></div></header>
    <main>
      <section className="legal-hero">
        <div className="eyebrow"><span/>{privacy?"PRIVACY NOTICE":"TERMS OF USE"}</div>
        <h1>{privacy?"Privacy, made clear.":"Terms, without the clutter."}</h1>
        <p className="hero-copy">{service.summary}</p>
        <div className="legal-tabs"><a className={!privacy?"active":""} href={"/terms?service="+serviceKey}>Terms</a><a className={privacy?"active":""} href={"/privacy?service="+serviceKey}>Privacy</a></div>
      </section>
      <section className="legal-body">
        <h2>Accessibility</h2>
        <p>We aim to make this site usable with keyboard navigation, readable text, clear labels, responsive layouts, and reduced-motion preferences where practical. Some features depend on third-party services or browser capabilities. If you encounter an accessibility barrier, contact the site operator with the page and feature involved so it can be reviewed.</p>
        <h2>About this service</h2>
        <p>This is an independent community project created and operated by Judson. It is not operated, sponsored, endorsed, or affiliated with Century Games, Kingshot, Discord, or any other platform referenced by the service.</p>
        {privacy?<>
          <h2>What we handle</h2>
          <p>The service processes the information needed to provide the feature you use. This can include Player ID, kingdom ID, player name, avatar URL, submitted gift codes, redemption results, timestamps, and support requests. Auto Redeem stores registration state and processing history so scheduled runs can operate after you leave the site, prevent duplicate redemption attempts, and maintain operational records. Player IDs and related registration data are not used to request or store your Kingshot password. Input fields use client-side checks for convenience, while the server performs its own validation.</p>
          <h2>Data and archive boundary</h2>
          <p>Player registration and redemption data remain in the live application database and are separate from the scraper archive. The scraper archive contains only scraper telemetry and discovered-code history from <code>kingshot_scraper_runs</code>, including source, timestamps, HTTP/parse results, code counts, discovered codes, and error information. It does not contain Player IDs, Discord IDs, account IDs, or registration IDs. The archive is kept private because it is operational and historical information, not because it is a user-identity database.</p>
          <p>Verified scraper history may be retained in private infrastructure, including private Supabase Storage and an independent private GitHub cold backup. Registered-player recovery snapshots may also be retained in the private GitHub archive for disaster recovery. These archive systems are downstream of the live application and are not used by the Auto Redeem worker to select players or perform redemptions.</p>
          <h2>Support requests</h2>
          <p>If you submit a request to remove an Auto Redeem registration, the Player ID and reason you provide are processed so an administrator can review the request. Do not include passwords, payment details, authentication codes, or other sensitive information.</p>
          <h2>Advertising</h2>
          <p>The public service does not require advertising to provide its redemption features. If sponsored content or third-party promotional links are introduced later, they may have their own privacy practices and those practices will be identified or linked from the relevant experience.</p>
          <h2>Technical information</h2>
          <p>Requests may be processed by hosting, database, security, content-delivery, and other infrastructure providers needed to operate the service. Technical information such as IP address, request metadata, device or browser information, and timestamps may be available to those systems for security, reliability, rate limiting, and abuse prevention.</p>
          <h2>Retention and removal</h2>
          <p>Information is retained for as long as reasonably needed to operate the feature, prevent duplicate work, maintain security, resolve support issues, troubleshoot failures, or preserve necessary service records. Removing an Auto Redeem registration stops future scheduled processing for that registration. It does not automatically mean that every related redemption, support, security, or operational record is immediately erased; some records may remain where needed for service integrity, abuse prevention, auditing, troubleshooting, or legal obligations. Verified scraper history is maintained separately as operational archive data and does not contain Player IDs or registration identifiers. Private registered-player recovery snapshots are a separate disaster-recovery copy and may contain the minimal Player ID and registration-state fields described above. Use the removal request form on the Auto Redeem page to request registration removal.</p>
          <h2>Third-party services</h2>
          <p>The service may interact with third-party services and APIs, including Kingshot-related game endpoints, hosting infrastructure, databases, content delivery networks, Discord-related services, and external links. For example, support requests may be forwarded to an operational Discord notification channel so they can be reviewed. Information sent to a third party is handled under that provider’s own terms and privacy notice. We do not control third-party data practices.</p>
          <h2>What we do not do</h2>
          <p>We do not ask for your Kingshot password, payment details, authentication codes, or private game credentials. We do not need those credentials for normal redemption. We do not sell Player IDs or redemption records to third parties. Do not place sensitive information in a Player ID, gift-code field, or support request.</p>
          <h2>Changes</h2>
          <p>This notice may be updated when the service, data handling, or legal requirements change. Material changes will be reflected in the published notice. The effective date below indicates the latest revision.</p>
        </>:<>
          <h2>Use of the service</h2>
          <p>Use the service only for lawful and legitimate personal or community purposes. You are responsible for the Player IDs, codes, URLs, and other information you submit. Do not submit passwords, payment information, authentication codes, or private credentials.</p>
          <h2>Kingshot redemption</h2>
          <p>Gift codes are controlled by the underlying game service. Codes can expire, reach usage limits, be region or account restricted, or be rejected without notice. We do not guarantee that a submitted code will work or that an automatic redemption attempt will succeed.</p>
          <h2>Auto Redeem</h2>
          <p>When you register a Player ID, you authorize the service to periodically process eligible gift codes for that registered player using the information required by the redemption workflow. Automation is intended for ordinary, authorized redemption and does not bypass the game’s normal redemption rules.</p>
          <h2>Auto Redeem rules</h2>
          <p>You may use Auto Redeem for a Player ID you are authorized to operate. Do not register another person’s Player ID without permission, bypass rate limits or cooldowns, rotate identities or keys to evade restrictions, flood the redemption system, manipulate results, probe protected endpoints, harvest private data, or interfere with the service or upstream systems.</p>
          <p>Do not use the service for malware, credential theft, phishing, fraud, harassment, denial-of-service activity, unauthorized account automation, or attempts to obtain rewards outside the normal redemption process. Kingshot and third-party eligibility, availability, and technical restrictions continue to apply.</p>
          <p>We may throttle, suspend, revoke, or block registrations or access when reasonably necessary to prevent abuse, protect users, respond to security incidents, or enforce these rules. A normal personal or community integration that periodically redeems eligible public gift codes for an authorized Player ID is permitted.</p>
          <h2>Removal</h2>
          <p>You can request removal of an Auto Redeem registration through the support form. You are responsible for ensuring that you have the right to use the Player ID you submit. Removing a registration stops future scheduled processing. It does not promise immediate or universal deletion of historical redemption, support, security, audit, or other operational records that the service may need to retain.</p>
          <h2>Availability and changes</h2>
          <p>The service is provided on an as-available basis. Features, APIs, gift-code sources, and integrations may change, be interrupted, or be removed without notice. We do not guarantee uninterrupted access, accuracy of third-party data, or successful redemption.</p>
          <h2>Third-party platforms</h2>
          <p>Kingshot, Century Games, Discord, and other referenced platforms remain the property of their respective owners. This project does not claim official status or authorization from those owners.</p>
          <h2>Acceptable use</h2>
          <p>Do not abuse, overload, probe, bypass security controls, interfere with other users, attempt unauthorized access, or use the service to distribute malicious or unlawful content.</p>
          <h2>Changes to these terms</h2>
          <p>These terms may be updated as the service changes. Continued use after an updated version is published means you are using the service under the revised terms.</p>
        </>}
        <h2>No affiliation</h2>
        <p>This project is independent and should not be represented as an official Century Games, Kingshot, or Discord service. Product names, logos, and trademarks remain the property of their respective owners.</p>
        <p className="legal-note">This notice describes the current operation of this independent community service and is not legal advice. Effective: October 6, 2026.</p>
      </section>
    </main>
    <footer><span>© 2026 Judson · Independent community service</span><span><a href={"/terms?service="+serviceKey}>Terms</a> · <a href={"/privacy?service="+serviceKey}>Privacy</a></span></footer>
  </div>
}
