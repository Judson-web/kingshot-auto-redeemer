import React,{useEffect,useState}from"react";
const KINGSHOT_ICON="https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/ee/d2/22/eed22297-9313-d8b0-52c8-95f42a2795b2/AppIcon-0-0-1x_U007emarketing-0-8-0-85-220.png/0x0ss-85.png";
const imageUrl=(user,size=1024,format=user.format)=>"/api/discord-avatar?id="+encodeURIComponent(user.id)+"&hash="+encodeURIComponent(user.avatar)+"&format="+encodeURIComponent(format)+"&size="+encodeURIComponent(size);

export function KsLogo(){return <a className="brand ks-brand" href="/"><span className="brand-mark ks-brand-mark"><img src={KINGSHOT_ICON} alt="Kingshot"/></span><span>Kingshot Redeemer</span></a>}
export function DiscordChip(){const [user,setUser]=useState(null);useEffect(()=>{let live=true;const load=()=>fetch("/api/discord-user?id=871756466900598815",{credentials:"same-origin",cache:"no-store",headers:{"cache-control":"no-cache"}}).then(r=>r.ok?r.json():null).then(d=>{if(live&&d?.id)setUser(d)}).catch(()=>{});load();const timer=setInterval(load,60000);return()=>{live=false;clearInterval(timer)}},[]);const avatar=user?.avatar?(user.avatarUrl||imageUrl(user,64,user.animated?"gif":"png")):"https://cdn.discordapp.com/embed/avatars/0.png?size=64";return <a className="site-discord-credit" href="https://discord.com/channels/@me/871756466900598815" target="_blank" rel="noreferrer" aria-label="Message Judson on Discord"><img key={user?.avatar||"default"} src={avatar} alt="Judson" loading="eager" onError={e=>{e.currentTarget.src="https://cdn.discordapp.com/embed/avatars/0.png?size=64"}}/><span>Judson</span></a>}

export function BannerAd({site="all",placement="top"}){const [ad,setAd]=useState(null);const [hidden,setHidden]=useState(false);
 useEffect(()=>{let live=true;setAd(null);setHidden(false);fetch("/api/banner-ads?site="+encodeURIComponent(site)+"&placement="+encodeURIComponent(placement),{credentials:"same-origin",cache:"no-store"}).then(r=>r.ok?r.json():null).then(d=>{if(live)setAd(d?.ad||null)}).catch(()=>{if(live)setAd(null)});return()=>{live=false}},[site,placement]);
 if(!ad||hidden)return null;
 const advertiser=ad.advertiser||"Sponsored";const headline=ad.headline||ad.alt_text||"Featured promotion";const cta=ad.cta_label||"Learn more";
 return <aside className={"banner-ad banner-ad-"+placement} aria-label="Advertisement">
  <div className="banner-ad-label"><span className="banner-ad-label-dot"/><Megaphone size={10}/><span>ADVERTISEMENT</span><span className="banner-ad-sponsored">Sponsored</span></div>
  <a className="banner-ad-card" href={"/api/banner-ad-click?id="+encodeURIComponent(ad.id)} target="_blank" rel="sponsored noopener" style={{"--ad-bg":ad.background||"#11131a"}}>
   <div className={"banner-ad-creative "+(!ad.image_url?"banner-ad-no-image":"")}>{ad.image_url?<img src={ad.image_url} alt={ad.alt_text||"Advertisement"}/>:<div className="banner-ad-copy"><span>{advertiser}</span><b>{headline}</b></div>}</div>
   <div className="banner-ad-body"><div className="banner-ad-meta"><span>{advertiser}</span><span className="banner-ad-dot">•</span><span>Sponsored</span></div><b className="banner-ad-headline">{headline}</b><span className="banner-ad-cta">{cta}<ExternalLink size={11}/></span></div>
   <button type="button" className="banner-ad-close" onClick={e=>{e.preventDefault();e.stopPropagation();setHidden(true)}} aria-label="Hide advertisement">×</button>
  </a>
 </aside>}
