import React from "react";

const KINGSHOT_ICON="https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/ee/d2/22/eed22297-9313-d8b0-52c8-95f42a2795b2/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/0x0ss-85.png";
const services={
 "kingshot-manual":{label:"Manual Redeemer",summary:"Submit a gift code for an individual player."},
 "kingshot-auto":{label:"Auto Redeem",summary:"Register a player for scheduled gift-code processing."}
};
export default function LegalApp({type}){
 const key=new URLSearchParams(location.search).get("service"),service=services[key]||services["kingshot-manual"],privacy=type==="privacy",serviceKey=key||"kingshot-manual";
 return <div className="app legal-app">
  <header><a className="brand ks-brand" href="/"><span className="brand-mark ks-brand-mark"><img src={KINGSHOT_ICON} alt="Kingshot"/></span><span>{privacy?"Privacy":"Terms"} · {service.label}</span></a><div className="header-right"><a className="legal-back" href="/">← Back</a></div></header>
  <main>
   <section className="legal-hero"><div className="eyebrow"><span/>{privacy?"PRIVACY NOTICE":"TERMS OF USE"}</div><h1>{privacy?"Your data, explained.":"Use the service responsibly."}</h1><p className="hero-copy">{service.summary}</p><div className="legal-meta"><span>Updated October 15, 2026</span><span>Independent community project</span></div><div className="legal-tabs"><a className={!privacy?"active":""} href={"/terms?service="+serviceKey}>Terms</a><a className={privacy?"active":""} href={"/privacy?service="+serviceKey}>Privacy</a></div></section>
   <section className="legal-body">
   {privacy?<>
    <h2>Information used to provide the service</h2>
    <p>Depending on the features you use, we may process your Kingshot Player ID and kingdom, player details returned by the game service, gift codes you submit, redemption outcomes, Auto Redeem registration settings, and messages you send to support. If you create a profile or use developer features, the information needed to manage that account and its API keys is also processed. Do not send passwords, payment details, authentication codes, or other secrets through the site.</p>
    <h2>Service operation and security</h2>
    <p>We process limited technical information such as request timestamps, page visits, browser and device categories, and error or security records to operate the site, prevent abuse, troubleshoot problems, and understand general usage. Hosting and infrastructure providers may process standard connection information when you use the service. We do not use the site to collect precise GPS location or your Kingshot password.</p>
    <h2>Support messages and removal requests</h2>
    <p>Support chat messages are stored so you and the support team can read the conversation and reply. A Player ID is optional in general support chat. Registration-removal requests use a separate process and may require a Player ID and reason so the request can be reviewed. Please share only information relevant to your request.</p>
    <h2>Third-party services</h2>
    <p>The service relies on hosting, database, game-related and optional sign-in or notification providers. When you use features connected to those providers, the information needed for that feature may be processed by them under their own terms and privacy notices. External links are governed by the destination site's policies.</p>
    <h2>Retention and requests</h2>
    <p>We keep information for as long as reasonably needed to operate the features you use, maintain security, respond to support requests, and resolve technical or abuse issues. Removing an Auto Redeem registration stops future scheduled processing, but does not automatically erase every historical, security, support, or backup record. You can contact support to ask about information associated with your use of the service; we may need to verify the request and may retain limited records where appropriate.</p>
    <h2>Your choices</h2>
    <p>You can choose whether to use optional account, developer, and browser-notification features. You can manage notification permission through your browser or device settings. You can stop using the service and request removal of an Auto Redeem registration through its dedicated removal form.</p>
    <h2>Changes to this notice</h2>
    <p>This notice may be updated when the service or its data practices change. The date above identifies the latest revision. Questions can be sent through the site's support chat.</p>
   </>:<>
    <h2>Use the service only with authorization</h2>
    <p>You must be authorized to use the Player ID you submit and any account you connect. You are responsible for the information and codes you provide. Do not impersonate another person, submit someone else's information without permission, or use the service to harass others.</p>
    <h2>Gift-code redemption</h2>
    <p>Gift codes are controlled by the game and may expire, be limited, or be rejected. We cannot guarantee that a code will work, that an automated attempt will succeed, or that the service will always be available. Auto Redeem processes eligible codes on a scheduled basis; timing and results can vary.</p>
    <h2>Fair use and security</h2>
    <p>Do not bypass rate limits or access controls, overload the service, probe protected systems, interfere with other users, attempt unauthorized access, or use the service for fraud, phishing, malware, or other unlawful activity. We may limit or suspend access when reasonably necessary to protect the service, users, or connected systems.</p>
    <h2>Accounts and support</h2>
    <p>You are responsible for keeping your sign-in methods and API keys secure. Do not share API keys or put secrets into support messages. Support chat is for questions and troubleshooting; registration-removal requests must be submitted through the separate removal process. We may be unable to respond immediately.</p>
    <h2>Independent service</h2>
    <p>This is an independent community project and is not operated, sponsored, or endorsed by Century Games or the Kingshot game team. Third-party names and marks belong to their respective owners.</p>
    <h2>Changes and availability</h2>
    <p>Features may change, be interrupted, or be discontinued. These terms may be updated as the service evolves. Stop using the service if you do not agree with the current terms. Nothing in these terms removes rights that cannot be excluded under applicable law.</p>
   </>}
   <p className="legal-note">This page is a plain-language summary of the service's current practices and rules, not legal advice. Applicable legal rights and obligations depend on the circumstances and the laws that apply to you.</p>
   </section>
  </main>
  <footer><a className="brand ks-brand" href="/"><span className="brand-mark ks-brand-mark"><img src={KINGSHOT_ICON} alt="Kingshot"/></span><span>Kingshot Redeemer</span></a><span>Independent community service</span><span><a href={"/terms?service="+serviceKey}>Terms</a> · <a href={"/privacy?service="+serviceKey}>Privacy</a></span></footer>
 </div>
}
