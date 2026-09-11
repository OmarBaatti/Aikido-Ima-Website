import { useCallback, useEffect, useMemo, useState } from "react";

type Status = "pending" | "validated" | "invalidated";
type Reason =
  | "followers"
  | "avg views"
  | "bad engagement rate"
  | "woman"
  | "bad content"
  | "unrelated"
  | "other";

type Channel = {
  channel_id: string;
  channel_handle: string | null;
  channel_name: string;
  profile_photo_url: string | null;
  banner_photo_url: string | null;
  subscriber_count: number | null;
  avg_views: number | null;
  avg_engagement_rate: number | null;
  videos_last_month: number | null;
  valid: boolean | null;
  rejection_reason: Reason | null;
};

const reasons: Reason[] = [
  "followers",
  "avg views",
  "bad engagement rate",
  "woman",
  "bad content",
  "unrelated",
  "other"
];

const reasonLabel: Record<Reason, string> = {
  followers: "Too many / too few followers",
  "avg views": "Average views",
  "bad engagement rate": "Bad engagement rate",
  woman: "Woman",
  "bad content": "Bad content",
  unrelated: "Unrelated",
  other: "Other"
};

function formatNumber(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatEngagement(value: number | null) {
  if (value == null) return "—";
  // DB example values are expected to be ratios (0.034 = 3.4%).
  return `${(value * 100).toFixed(1)}%`;
}

function channelUrl(handle: string | null) {
  return handle ? `https://www.youtube.com/@${handle.replace(/^@/, "")}` : null;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password })
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Login failed");
      onLogin();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="brand large">CR</div>
        <p className="eyebrow">CHANNEL REVIEW</p>
        <h1>Sign in</h1>
        <p className="login-subtitle">Use your review account credentials.</p>
        <label className="login-field">
          <span>Username</span>
          <input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required />
        </label>
        <label className="login-field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="login-button" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}

function ChannelReview({ onLogout }: { onLogout: () => void }) {

  const [status, setStatus] = useState<Status>("pending");
  const [search, setSearch] = useState("");
  const [filtersEnabled, setFiltersEnabled] = useState(true);
  const [minSubs, setMinSubs] = useState("");
  const [maxSubs, setMaxSubs] = useState("");
  const [minViews, setMinViews] = useState("");
  const [minEngagement, setMinEngagement] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams({
      status,
      search,
      minSubs: filtersEnabled ? minSubs || "0" : "0",
      maxSubs: filtersEnabled ? maxSubs || String(Number.MAX_SAFE_INTEGER) : String(Number.MAX_SAFE_INTEGER),
      minViews: filtersEnabled ? minViews || "0" : "0",
      minEngagement: filtersEnabled ? minEngagement || "0" : "0"
    });

    try {
      const response = await fetch(`/api/channels?${params}`);
      if (!response.ok) throw new Error("Could not load channels");
      setChannels(await response.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load channels");
    } finally {
      setLoading(false);
    }
  }, [status, search, minSubs, maxSubs, minViews, minEngagement, filtersEnabled]);

  useEffect(() => {
    const timer = window.setTimeout(loadChannels, 250);
    return () => window.clearTimeout(timer);
  }, [loadChannels]);

  const countsText = useMemo(
    () => `${channels.length}${channels.length === 500 ? "+" : ""} shown`,
    [channels.length]
  );

  function switchStatus(next: Status) {
    setStatus(next);
    setFiltersEnabled(next !== "pending");
  }

  async function updateStatus(channelId: string, valid: boolean, rejectionReason?: Reason) {
    const response = await fetch(`/api/channels/${channelId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ valid, rejectionReason })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? "Update failed");
    }

    setChannels(current => current.filter(channel => channel.channel_id !== channelId));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">CR</div>
        <nav>
          <button className="nav-item active" title="Channel selection">⌘</button>
          <button className="nav-item" title="Influencer emails">✉</button>
          <button className="nav-item" title="Statistics">▥</button>
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="search-wrap">
            <span>⌕</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search channels or handles..."
            />
          </div>
          <button
            className={`filter-toggle ${filtersEnabled ? "on" : ""}`}
            onClick={() => setFiltersEnabled(v => !v)}
          >
            {filtersEnabled ? "Filters on" : "Filters off"}
          </button>
          <button className="logout-button" onClick={onLogout}>Sign out</button>
        </header>

        <section className="filters">
          <Filter label="Subscribers min" value={minSubs} onChange={setMinSubs} />
          <Filter label="Subscribers max" value={maxSubs} onChange={setMaxSubs} />
          <Filter label="Avg views min" value={minViews} onChange={setMinViews} />
          <Filter label="Engagement min %" value={minEngagement} onChange={v => setMinEngagement(v)} />
          <div className="filter-note">
            <span className="dot" />
            Only channels with calculated averages are shown
          </div>
        </section>

        <section className="page-heading">
          <div>
            <p className="eyebrow">CHANNEL REVIEW</p>
            <h1>Channel selection</h1>
          </div>
          <span className="count">{countsText}</span>
        </section>

        <section className="tabs">
          <Tab active={status === "pending"} onClick={() => switchStatus("pending")} label="To handle" />
          <Tab active={status === "validated"} onClick={() => switchStatus("validated")} label="Validated" />
          <Tab active={status === "invalidated"} onClick={() => switchStatus("invalidated")} label="Invalidated" />
        </section>

        {error && <div className="error">{error}</div>}

        <section className="channel-list">
          {loading && <div className="empty">Loading channels…</div>}
          {!loading && channels.length === 0 && <div className="empty">No channels match the current view.</div>}

          {!loading && channels.map(channel => (
            <ChannelCard
              key={channel.channel_id}
              channel={channel}
              status={status}
              onOpenImage={(src, alt) => setLightbox({ src, alt })}
              onValidate={() => updateStatus(channel.channel_id, true)}
              onInvalidate={(reason) => updateStatus(channel.channel_id, false, reason)}
            />
          ))}
        </section>
      </main>

      {lightbox && (
        <div className="modal-backdrop" onClick={() => setLightbox(null)}>
          <div className="lightbox" onClick={e => e.stopPropagation()}>
            <button className="close" onClick={() => setLightbox(null)}>×</button>
            <img src={lightbox.src} alt={lightbox.alt} />
          </div>
        </div>
      )}
    </div>
  );
}

function Filter({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="filter">
      <span>{label}</span>
      <input inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} placeholder="Any" />
    </label>
  );
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button className={`tab ${active ? "selected" : ""}`} onClick={onClick}>
      <span>{label}</span>
    </button>
  );
}

function ChannelCard({
  channel,
  status,
  onOpenImage,
  onValidate,
  onInvalidate
}: {
  channel: Channel;
  status: Status;
  onOpenImage: (src: string, alt: string) => void;
  onValidate: () => Promise<void>;
  onInvalidate: (reason: Reason) => Promise<void>;
}) {
  const [reason, setReason] = useState<Reason>("followers");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  }

  return (
    <article className="channel-card">
      <div
        className="banner"
        style={{ backgroundImage: channel.banner_photo_url ? `url("${channel.banner_photo_url}")` : undefined }}
        onClick={() => channel.banner_photo_url && onOpenImage(channel.banner_photo_url, `${channel.channel_name} banner`)}
      >
        <div className="banner-fade" />
      </div>

      <div className="card-body">
        <div className="identity">
          {channel.profile_photo_url ? (
            <img
              className="avatar"
              src={channel.profile_photo_url}
              alt={`${channel.channel_name} profile`}
              onClick={() => onOpenImage(channel.profile_photo_url!, `${channel.channel_name} profile`)}
            />
          ) : <div className="avatar placeholder">?</div>}

          <div className="name-block">
            {channelUrl(channel.channel_handle) ? (
              <a href={channelUrl(channel.channel_handle)!} target="_blank" rel="noreferrer">
                {channel.channel_name}
              </a>
            ) : <strong>{channel.channel_name}</strong>}
            <small>{channel.channel_handle ? `@${channel.channel_handle.replace(/^@/, "")}` : "No handle"}</small>
          </div>
        </div>

        <div className="metrics">
          <Metric label="Subscribers" value={formatNumber(channel.subscriber_count)} />
          <Metric label="Avg views" value={formatNumber(channel.avg_views)} />
          <Metric label="Engagement" value={formatEngagement(channel.avg_engagement_rate)} />
          <Metric label="Videos / 30d" value={formatNumber(channel.videos_last_month)} compact />
        </div>

        <div className="card-footer">
          <code>{channel.channel_id}</code>

          {status === "pending" && (
            <div className="actions">
              <button className="validate" disabled={busy} onClick={() => run(onValidate)}>
                ✓ Validate
              </button>
              <select
                value={reason}
                disabled={busy}
                onChange={e => setReason(e.target.value as Reason)}
                aria-label="Invalidation reason"
              >
                {reasons.map(item => <option key={item} value={item}>{reasonLabel[item]}</option>)}
              </select>
              <button className="invalidate" disabled={busy} onClick={() => run(() => onInvalidate(reason))}>
                Invalidate
              </button>
            </div>
          )}

          {status === "invalidated" && channel.rejection_reason && (
            <span className="reason">Reason: {reasonLabel[channel.rejection_reason]}</span>
          )}
        </div>
      </div>
    </article>
  );
}

function Metric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`metric ${compact ? "compact" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then(response => response.json())
      .then(data => setAuthenticated(Boolean(data.authenticated)))
      .catch(() => setAuthenticated(false));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setAuthenticated(false);
  }

  if (authenticated === null) return <div className="login-shell"><div className="login-loading">Loading…</div></div>;
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  return <ChannelReview onLogout={logout} />;
}
