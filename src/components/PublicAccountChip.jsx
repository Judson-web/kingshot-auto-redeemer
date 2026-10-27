import React from "react";
import { useAccountState } from "../shared/account-state.js";
import { useSiteLanguage } from "../shared/site-language.js";
export default function PublicAccountChip(){
 const {account}=useAccountState();const {isKorean}=useSiteLanguage();if(!account)return null;
 const admin=account.role==="admin"||account.kind==="admin",dev=account.role==="developer"||account.kind==="developer";
 const avatar=account.avatar_url||"https://cdn.discordapp.com/embed/avatars/0.png?size=64";
 const role=admin?(isKorean?"관리자":"Admin"):dev?(isKorean?"개발자":"Developer"):(isKorean?"계정":"Account");
 const name=account.display_name||account.username||account.email||(isKorean?"내 프로필":"My profile");
 return <div className="site-account-wrap"><a className={"site-account-chip site-account-icon-only "+(admin?"site-account-admin":dev?"site-account-developer":"site-account-user")} href="/profile" aria-label={isKorean?"프로필 열기":"Open profile"} title={name+" · "+role}><span className="site-account-avatar-frame"><img src={avatar} alt="" onError={event=>{event.currentTarget.onerror=null;event.currentTarget.src="https://cdn.discordapp.com/embed/avatars/0.png?size=64"}}/><span className="site-account-role-mark" aria-hidden="true">{admin?"★":dev?"⌘":"•"}</span></span></a></div>
}
