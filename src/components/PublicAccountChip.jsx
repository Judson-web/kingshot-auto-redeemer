import React from "react";
import { UserRound } from "lucide-react";
import { useAccountState } from "../shared/account-state.js";

export default function PublicAccountChip() {
  const { account } = useAccountState();
  const avatar = account?.avatar_url || "https://cdn.discordapp.com/embed/avatars/0.png?size=64";
  if (!account) {
    return <div className="site-account-wrap"><a className="site-account-chip site-login-chip site-account-icon-only" href="/profile" aria-label="Sign in with Discord" title="Sign in with Discord"><UserRound size={17}/></a></div>;
  }
  const isAdmin = account.role === "admin" || account.kind === "admin";
  const isDeveloper = isAdmin || account.kind === "developer";
  const isDev = isDeveloper && !isAdmin;
  return <div className="site-account-wrap"><a className={"site-account-chip site-account-icon-only " + (isAdmin ? "site-account-admin" : isDev ? "site-account-developer" : "site-account-user")} href="/profile" aria-label={isAdmin ? "Admin profile" : isDev ? "Developer profile" : "User profile"} title={(account.username || account.email || "Profile") + " · " + (isAdmin ? "Admin" : isDev ? "Developer" : "User")}><span className="site-account-avatar-frame"><img src={avatar} alt="" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = "https://cdn.discordapp.com/embed/avatars/0.png?size=64"; }}/><span className="site-account-role-mark" aria-hidden="true">{isAdmin ? "★" : isDev ? "⌘" : "•"}</span></span></a></div>;
}
