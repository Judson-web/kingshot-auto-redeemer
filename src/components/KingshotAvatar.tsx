import React, { useEffect, useRef, useState } from "react";

type Frame = { assetId: string; name: string } | null;
type CacheEntry = { frame: Frame; expiresAt: number };
type Props = {
  playerId?: string | number | null;
  avatarUrl?: string | null;
  size?: number;
  initials?: string;
  alt?: string;
  className?: string;
  avatarClassName?: string;
  fallback?: React.ReactNode;
  lazy?: boolean;
};

const frameCache = new Map<string, CacheEntry>();
const frameRequests = new Map<string, Promise<Frame>>();
const PLAYER_ID = /^\d{5,20}$/;
const FRAME_ID = /^\d{6,12}$/;

async function loadAvatarFrame(playerId: string): Promise<Frame> {
  const cached = frameCache.get(playerId);
  if (cached && cached.expiresAt > Date.now()) return cached.frame;
  const active = frameRequests.get(playerId);
  if (active) return active;

  const request = (async (): Promise<Frame> => {
    let frame: Frame = null;
    let ttl = 90_000;
    try {
      const response = await fetch(
        "/api/kingshot-player?frame=profile&id=" + encodeURIComponent(playerId),
        { credentials: "same-origin", cache: "no-store" }
      );
      if (response.ok) {
        const data = await response.json();
        const item = data?.frame;
        if (item && FRAME_ID.test(String(item.assetId || ""))) {
          frame = {
            assetId: String(item.assetId),
            name: String(item.name || "Avatar Frame").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || "Avatar Frame"
          };
          ttl = 20 * 60_000;
        }
      }
    } catch {
      // Frames are decorative; keep the ordinary avatar usable on any lookup failure.
      ttl = 45_000;
    } finally {
      frameCache.set(playerId, { frame, expiresAt: Date.now() + ttl });
      frameRequests.delete(playerId);
    }
    return frame;
  })();

  frameRequests.set(playerId, request);
  return request;
}

export default function KingshotAvatar({
  playerId,
  avatarUrl,
  size = 42,
  initials = "K",
  alt = "",
  className = "",
  avatarClassName = "ks-avatar",
  fallback,
  lazy = true,
}: Props) {
  const shellRef = useRef<HTMLSpanElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(!lazy);
  const [frame, setFrame] = useState<Frame>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [frameFailed, setFrameFailed] = useState(false);
  const id = String(playerId ?? "").trim();
  const avatar = String(avatarUrl ?? "").trim();
  const safeSize = Number.isFinite(size) ? Math.max(24, Math.min(128, size)) : 42;

  useEffect(() => {
    if (!lazy) {
      setShouldLoad(true);
      return;
    }
    const node = shellRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: "140px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [lazy]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [avatar]);

  useEffect(() => {
    setFrame(null);
    setFrameFailed(false);
    if (!shouldLoad || !PLAYER_ID.test(id)) return;
    let active = true;
    void loadAvatarFrame(id).then((value) => {
      if (active) setFrame(value);
    });
    return () => {
      active = false;
    };
  }, [id, shouldLoad]);

  return (
    <span
      ref={shellRef}
      className={["ks-player-portrait", "ks-avatar-frame-shell", className].filter(Boolean).join(" ")}
      style={{ width: safeSize, height: safeSize, flex: "0 0 " + safeSize + "px" }}
      title={frame?.name || undefined}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
    >
      <span className={["ks-player-avatar-base", avatarClassName].filter(Boolean).join(" ")} aria-hidden="true">
        {avatar && !avatarFailed ? (
          <img
            className="ks-player-avatar-image"
            src={avatar}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          <span className="ks-player-avatar-fallback">{fallback ?? String(initials || "K").slice(0, 1)}</span>
        )}
      </span>
      {frame && !frameFailed && (
        <img
          className="ks-avatar-frame-img"
          src={"/api/kingshot-player?frame=asset&asset=" + encodeURIComponent(frame.assetId)}
          alt=""
          aria-hidden="true"
          decoding="async"
          loading="lazy"
          onError={() => setFrameFailed(true)}
        />
      )}
    </span>
  );
}
