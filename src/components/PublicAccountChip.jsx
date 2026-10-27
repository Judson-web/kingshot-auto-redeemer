import React from "react";
import { useAccountState } from "../shared/account-state.js";
import { useSiteLanguage } from "../shared/site-language.js";
export default function PublicAccountChip(){
 const {account}=useAccountState();const {t}=useSiteLanguage();if(!account)return null;
 const admin=account.role==="admin"||account.kind==="admin",dev=account.role==="developer"||account.kind==="developer";
 const avatar=account.avatar_url||"https://cdn.discordapp.com/embed/avatars/0.png?size=64";
 const role=admin?t("profile.admin","Admin"):dev?t("profile.developer","Developer"):t("profile.account","Account");
 const name=account.display_name||account.username||account.email||t("profile.myProfile","My profile");
 return <div className="site-account-wrap"><a className={"site-account-chip site-account-icon-only "+(admin?"site-account-admin":dev?"site-account-developer":"site-account-user")} href="/profile" aria-label={t("profile.open","Open profile")} title={name+" · "+role}><span className="site-account-avatar-frame"><img src={avatar} alt="" onError={event=>{event.currentTarget.onerror=null;event.currentTarget.src="https://cdn.discordapp.com/embed/avatars/0.png?size=64"}}/><span className="site-account-role-mark" aria-hidden="true">{admin?"★":dev?"⌘":"•"}</span></span></a></div>
}
