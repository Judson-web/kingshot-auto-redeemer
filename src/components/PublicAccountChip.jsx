import React from "react";
import { useAccountState } from "../shared/account-state.js";

export default function PublicAccountChip() {
  const { account } = useAccountState();
  const isAdmin = account?.role === "admin" || account?.kind === "admin";
  const isDeveloper = account?.role === "developer" || account?.kind === "developer";

  // The public header must not advertise a generic Discord/profile entry point.
  // The shared account state is classified server-side: developer requires an
  // active API key, while the administrator role is independently verified.
  if (!account || (!isAdmin && !isDeveloper)) return null;

  const avatar = account.avatar_url || "https://cdn.discordapp.com/embed/avatars/0.png?size=64";
  const isDev = isDeveloper && !isAdmin;

  return <div className="site-account-wrap">
    <a
      className={"site-account-chip site-account-icon-only " + (isAdmin ? "site-account-admin" : "site-account-developer")}
      href="/profile"
      aria-label={isAdmin ? "Admin profile" : "Developer profile"}
      title={(account.username || account.email || "Profile") + " · " + (isAdmin ? "Admin" : "Developer")}
    >
      <span className="site-account-avatar-frame">
        <img src={avatar} alt="" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = "https://cdn.discordapp.com/embed/avatars/0.png?size=64"; }} />
        <span className="site-account-role-mark" aria-hidden="true">{isAdmin ? "★" : isDev ? "⌘" : "•"}</span>
      </span>
    </a>
  </div>;
}
