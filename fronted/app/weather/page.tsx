"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ThemePref = "system" | "light" | "dark";
type Lang = "en" | "ru";

type User = {
  id: number;
  email: string;
  name: string;
  theme: ThemePref;
};

type WeatherNow = {
  city: string;
  temp: number | null;
  feels_like: number | null;
  description: string;
  icon: string;
};

type ForecastDay = {
  date: string;
  min: number;
  max: number;
  description: string;
  icon: string;
};

type ForecastResp = {
  city: string;
  forecast: ForecastDay[];
};

type HistoryRow = {
  city: string;
  lang: string;
  created_at: number;
};

const API = "http://localhost:4000";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function applyTheme(pref: ThemePref) {
  const resolved = pref === "system" ? getSystemTheme() : pref;
  document.documentElement.setAttribute("data-theme", resolved);
  return resolved;
}

function loadSession(): { token: string; user: User } | null {
  try {
    const raw = localStorage.getItem("te_session");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSession(token: string, user: User) {
  localStorage.setItem("te_session", JSON.stringify({ token, user }));
}

function clearSession() {
  localStorage.removeItem("te_session");
}

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed: ${res.status}`);
  return data as T;
}

function formatDateShort(iso: string) {
  // iso YYYY-MM-DD -> MM.DD
  const [y, m, d] = iso.split("-");
  return `${m}.${d}`;
}

function owIconUrl(icon: string) {
  if (!icon) return "";
  return `https://openweathermap.org/img/wn/${icon}@2x.png`;
}

function SvgTrendChart({
  forecast,
  theme,
  title = "Max temperature trend",
}: {
  forecast: ForecastDay[];
  theme: "light" | "dark";
  title?: string;
}) {
  if (!forecast || forecast.length < 2) return null;

  const values = forecast.map((d) => d.max);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  const width = 860;
  const height = 260;
  const padX = 46;
  const padY = 40;

  const stepX = (width - padX * 2) / (forecast.length - 1);

  const points = forecast.map((d, i) => {
    const x = padX + stepX * i;
    const norm = (d.max - minV) / range;
    const y = height - padY - norm * (height - padY * 2);
    return { x, y, label: formatDateShort(d.date), value: d.max };
  });

  const line = points.map((p) => `${p.x},${p.y}`).join(" ");

  const grid = theme === "dark" ? "rgba(148,163,184,0.25)" : "rgba(148,163,184,0.45)";
  const text = theme === "dark" ? "#e5e7eb" : "#0f172a";
  const sub = theme === "dark" ? "rgba(229,231,235,0.7)" : "rgba(15,23,42,0.6)";
  const stroke = theme === "dark" ? "#38bdf8" : "#2563eb";
  const fill = theme === "dark" ? "rgba(56,189,248,0.12)" : "rgba(37,99,235,0.12)";

  // area fill under line
  const areaPath = `M ${points[0].x} ${height - padY} L ${line
    .split(" ")
    .map((xy) => `L ${xy}`)
    .join(" ")} L ${points[points.length - 1].x} ${height - padY} Z`;

  // y-axis ticks (nice)
  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }).map((_, i) => minV + (range * i) / ticks);

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ color: text, fontSize: 18, fontWeight: 800, marginBottom: 10 }}>{title}</div>

      <div
        style={{
          width: "100%",
          height,
          borderRadius: 18,
          border: `1px solid ${grid}`,
          background: theme === "dark" ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.75)",
          overflow: "hidden",
        }}
      >
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img">
          {/* grid */}
          {tickVals.map((v, i) => {
            const norm = (v - minV) / range;
            const y = height - padY - norm * (height - padY * 2);
            return (
              <g key={i}>
                <line x1={padX} x2={width - padX} y1={y} y2={y} stroke={grid} />
                <text x={10} y={y + 4} fill={sub} fontSize="12">
                  {Math.round(v * 10) / 10}°
                </text>
              </g>
            );
          })}

          {/* area */}
          <path d={areaPath} fill={fill} />

          {/* line */}
          <polyline fill="none" stroke={stroke} strokeWidth="3" strokeLinejoin="round" points={line} />

          {/* points + x labels */}
          {points.map((p, i) => (
            <g key={i}>
              <circle cx={p.x} cy={p.y} r="5.5" fill={stroke} />
              <text x={p.x} y={height - 14} textAnchor="middle" fill={sub} fontSize="12">
                {p.label}
              </text>
              <text x={p.x} y={p.y - 10} textAnchor="middle" fill={text} fontSize="12" fontWeight="700">
                {Math.round(p.value * 10) / 10}°
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

export default function WeatherPage() {
  const router = useRouter();

  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);

  const [themePref, setThemePref] = useState<ThemePref>("system");
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  const [lang, setLang] = useState<Lang>("en");
  const [city, setCity] = useState("Riga");

  const [now, setNow] = useState<WeatherNow | null>(null);
  const [forecast, setForecast] = useState<ForecastDay[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const favKey = useMemo(() => (user ? `te_favs_${user.id}` : "te_favs_guest"), [user]);
  const [favs, setFavs] = useState<string[]>([]);

  // init session + theme + load history
  useEffect(() => {
    const s = loadSession();
    if (!s?.token) {
      router.replace("/");
      return;
    }

    setToken(s.token);
    setUser(s.user);

    // theme pref: from user
    const pref = (s.user.theme || (localStorage.getItem("te_theme_pref") as ThemePref) || "system") as ThemePref;
    setThemePref(pref);
    setTheme(applyTheme(pref));

    // load favs
    try {
      const raw = localStorage.getItem(favKey);
      setFavs(raw ? JSON.parse(raw) : []);
    } catch {
      setFavs([]);
    }

    // load history from DB
    (async () => {
      try {
        const data = await api<{ history: HistoryRow[] }>("/history", {
          method: "GET",
          headers: { Authorization: `Bearer ${s.token}` },
        });
        setHistory(data.history || []);
      } catch {
        setHistory([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // listen system theme changes if pref=system
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (themePref === "system") setTheme(applyTheme("system"));
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [themePref]);

  const persistTheme = async (pref: ThemePref) => {
    setThemePref(pref);
    localStorage.setItem("te_theme_pref", pref);
    setTheme(applyTheme(pref));
    if (!token) return;

    try {
      await api<{ success: true; theme: ThemePref }>("/me/theme", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ theme: pref }),
      });
      if (user) {
        const updated = { ...user, theme: pref };
        setUser(updated);
        saveSession(token, updated);
      }
    } catch {
      // не критично
    }
  };

  const bg = theme === "dark" ? "#060b18" : "#f5f7ff";
  const panel = theme === "dark" ? "rgba(18, 28, 52, 0.78)" : "rgba(255,255,255,0.86)";
  const border = theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(15, 23, 42, 0.12)";
  const text = theme === "dark" ? "#e5e7eb" : "#0f172a";
  const sub = theme === "dark" ? "rgba(229,231,235,0.72)" : "rgba(15,23,42,0.62)";

  const favourites = useMemo(() => favs.slice(0, 6), [favs]);

  const addFavourite = () => {
    const c = city.trim();
    if (!c) return;
    const next = Array.from(new Set([c, ...favs])).slice(0, 10);
    setFavs(next);
    localStorage.setItem(favKey, JSON.stringify(next));
  };

  const fetchWeather = async (c?: string) => {
    const q = (c ?? city).trim();
    if (!q) return;

    setErr("");
    setLoading(true);
    try {
      const w = await api<WeatherNow>(`/api/weather?city=${encodeURIComponent(q)}&lang=${lang}`);
      const f = await api<ForecastResp>(`/api/forecast?city=${encodeURIComponent(q)}&lang=${lang}`);

      setNow(w);
      setForecast(f.forecast || []);
      setCity(q);

      // save history in DB (per-user)
      try {
        await api<{ success: true }>("/history", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ city: q, lang }),
        });

        const h = await api<{ history: HistoryRow[] }>("/history", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        setHistory(h.history || []);
      } catch {
        // ignore
      }
    } catch (e: any) {
      setErr(e?.message || "Error");
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try {
      if (token) {
        await api<{ success: true }>("/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    } catch {}
    clearSession();
    router.replace("/");
  };

  useEffect(() => {
    // auto fetch on first mount
    if (token) fetchWeather(city);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <main style={{ minHeight: "100vh", background: bg, padding: 24 }}>
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          borderRadius: 22,
          background: panel,
          border: `1px solid ${border}`,
          boxShadow: theme === "dark" ? "0 30px 90px rgba(0,0,0,0.45)" : "0 30px 90px rgba(15,23,42,0.12)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: text, fontSize: 34, fontWeight: 900 }}>
                Travel Explorer — Weather
              </div>
              <div style={{ color: sub, marginTop: 8 }}>
                Check weather conditions in any city and plan your journey.
              </div>
              {user && (
                <div style={{ color: sub, marginTop: 8, fontSize: 13 }}>
                  Logged in as <b style={{ color: text }}>{user.name}</b> ({user.email})
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                onClick={() => router.push("/")}
                style={{
                  height: 40,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: `1px solid ${border}`,
                  background: "transparent",
                  color: text,
                  cursor: "pointer",
                }}
                title="Back"
              >
                ← Back to login
              </button>

              <button
                onClick={() => {
                  const next = theme === "dark" ? "light" : "dark";
                  persistTheme(next);
                }}
                style={{
                  height: 40,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: `1px solid ${border}`,
                  background: theme === "dark" ? "#2563eb" : "#2563eb",
                  color: "#fff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
              </button>

              <button
                onClick={logout}
                style={{
                  height: 40,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: `1px solid ${border}`,
                  background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
                  color: text,
                  cursor: "pointer",
                }}
              >
                Logout
              </button>
            </div>
          </div>

          <div style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <div
              style={{
                display: "inline-flex",
                background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
                border: `1px solid ${border}`,
                borderRadius: 999,
                padding: 4,
                gap: 4,
              }}
            >
              <button
                onClick={() => setLang("en")}
                style={{
                  height: 34,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  background: lang === "en" ? "#2563eb" : "transparent",
                  color: lang === "en" ? "#fff" : text,
                }}
              >
                EN
              </button>
              <button
                onClick={() => setLang("ru")}
                style={{
                  height: 34,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  background: lang === "ru" ? "#2563eb" : "transparent",
                  color: lang === "ru" ? "#fff" : text,
                }}
              >
                RU
              </button>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ color: sub, fontSize: 13 }}>Theme:</span>
              <select
                value={themePref}
                onChange={(e) => persistTheme(e.target.value as ThemePref)}
                style={{
                  height: 36,
                  borderRadius: 10,
                  border: `1px solid ${border}`,
                  background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
                  color: text,
                  padding: "0 10px",
                  cursor: "pointer",
                }}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </div>
          </div>

          <div style={{ marginTop: 18, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
              style={{
                flex: 1,
                minWidth: 240,
                height: 46,
                borderRadius: 999,
                border: `1px solid ${border}`,
                outline: "none",
                padding: "0 16px",
                background: theme === "dark" ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.9)",
                color: text,
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") fetchWeather(city);
              }}
            />

            <button
              onClick={() => fetchWeather(city)}
              disabled={loading}
              style={{
                height: 46,
                padding: "0 16px",
                borderRadius: 999,
                border: "none",
                cursor: loading ? "not-allowed" : "pointer",
                background: "#2563eb",
                color: "#fff",
                fontWeight: 800,
                opacity: loading ? 0.8 : 1,
              }}
            >
              {loading ? "Loading..." : "Get Weather"}
            </button>

            <button
              onClick={addFavourite}
              style={{
                height: 46,
                padding: "0 16px",
                borderRadius: 999,
                border: `1px solid ${border}`,
                background: "transparent",
                color: text,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
              title="Add to favourites"
            >
              ⭐ Add current
            </button>
          </div>

          {err && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                borderRadius: 12,
                border: `1px solid ${border}`,
                background: theme === "dark" ? "rgba(255,0,0,0.08)" : "rgba(255,0,0,0.06)",
                color: text,
              }}
            >
              {err}
            </div>
          )}

          {/* FAVS */}
          <div style={{ marginTop: 18 }}>
            <div style={{ color: text, fontSize: 18, fontWeight: 800 }}>Favourite Cities</div>
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {favourites.length === 0 ? (
                <div style={{ color: sub }}>No favourites yet.</div>
              ) : (
                favourites.map((c) => (
                  <button
                    key={c}
                    onClick={() => fetchWeather(c)}
                    style={{
                      height: 34,
                      padding: "0 12px",
                      borderRadius: 999,
                      border: `1px solid ${border}`,
                      background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
                      color: text,
                      cursor: "pointer",
                    }}
                  >
                    {c}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* CURRENT */}
          <div style={{ marginTop: 20 }}>
            <div style={{ color: text, fontSize: 22, fontWeight: 900 }}>Current City</div>

            <div
              style={{
                marginTop: 12,
                borderRadius: 18,
                border: `1px solid ${border}`,
                padding: 18,
                background: theme === "dark" ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.75)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ color: text, fontSize: 18, fontWeight: 800 }}>{now?.city || city}</div>
                <div style={{ color: text, fontSize: 38, fontWeight: 900, marginTop: 4 }}>
                  {now?.temp ?? "—"}°C{" "}
                  <span style={{ fontSize: 14, color: sub, fontWeight: 600 }}>
                    (feels like {now?.feels_like ?? "—"}°C)
                  </span>
                </div>
                <div style={{ marginTop: 6, color: sub }}>{now?.description || ""}</div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {now?.icon ? (
                  <img
                    src={owIconUrl(now.icon)}
                    alt="Weather icon"
                    width={72}
                    height={72}
                    style={{
                      borderRadius: 16,
                      background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
                      border: `1px solid ${border}`,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 16,
                      border: `1px solid ${border}`,
                      display: "grid",
                      placeItems: "center",
                      color: sub,
                    }}
                  >
                    —
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* HISTORY + RECENT */}
          <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div
              style={{
                borderRadius: 18,
                border: `1px solid ${border}`,
                padding: 16,
                background: theme === "dark" ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.7)",
              }}
            >
              <div style={{ color: text, fontSize: 18, fontWeight: 800 }}>Search History</div>
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {history.length === 0 ? (
                  <div style={{ color: sub }}>No history yet.</div>
                ) : (
                  history.slice(0, 12).map((h, idx) => (
                    <button
                      key={`${h.city}-${h.created_at}-${idx}`}
                      onClick={() => fetchWeather(h.city)}
                      style={{
                        height: 34,
                        padding: "0 12px",
                        borderRadius: 999,
                        border: `1px solid ${border}`,
                        background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
                        color: text,
                        cursor: "pointer",
                      }}
                      title={new Date(h.created_at).toLocaleString()}
                    >
                      {h.city}
                    </button>
                  ))
                )}
              </div>
            </div>

            <div
              style={{
                borderRadius: 18,
                border: `1px solid ${border}`,
                padding: 16,
                background: theme === "dark" ? "rgba(0,0,0,0.14)" : "rgba(255,255,255,0.7)",
              }}
            >
              <div style={{ color: text, fontSize: 18, fontWeight: 800 }}>Recent Cities</div>
              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {forecast?.length ? (
                  <div
                    style={{
                      borderRadius: 16,
                      border: `1px solid ${border}`,
                      padding: 12,
                      background: theme === "dark" ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.75)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={{ color: text, fontWeight: 900 }}>{now?.city || city}</div>
                      <div style={{ color: sub, marginTop: 2 }}>
                        {now?.temp ?? "—"}°C • {now?.description || ""}
                      </div>
                    </div>
                    {now?.icon ? (
                      <img
                        src={owIconUrl(now.icon)}
                        alt="icon"
                        width={54}
                        height={54}
                        style={{
                          borderRadius: 14,
                          background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
                          border: `1px solid ${border}`,
                        }}
                      />
                    ) : null}
                  </div>
                ) : (
                  <div style={{ color: sub }}>Search something to see recent.</div>
                )}
              </div>
            </div>
          </div>

          {/* FORECAST */}
          <div style={{ marginTop: 20 }}>
            <div style={{ color: text, fontSize: 18, fontWeight: 800 }}>5–6 Day Forecast</div>
            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 10 }}>
              {forecast.slice(0, 6).map((d) => (
                <div
                  key={d.date}
                  style={{
                    borderRadius: 16,
                    border: `1px solid ${border}`,
                    padding: 12,
                    background: theme === "dark" ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.75)",
                    minHeight: 92,
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ color: text, fontWeight: 900 }}>{formatDateShort(d.date)}</div>
                  <div style={{ color: text, marginTop: 6, fontWeight: 800 }}>
                    {Math.round(d.min * 10) / 10}° — {Math.round(d.max * 10) / 10}°
                  </div>
                  <div style={{ color: sub, marginTop: 4, fontSize: 13 }}>{d.description}</div>

                  {d.icon ? (
                    <img
                      src={owIconUrl(d.icon)}
                      alt="icon"
                      width={52}
                      height={52}
                      style={{
                        position: "absolute",
                        right: 10,
                        top: 10,
                        borderRadius: 14,
                        background: theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
                        border: `1px solid ${border}`,
                      }}
                    />
                  ) : null}
                </div>
              ))}
            </div>

            <SvgTrendChart forecast={forecast.slice(0, 6)} theme={theme} />
          </div>
        </div>
      </div>

      <style jsx global>{`
        html[data-theme="dark"] {
          color-scheme: dark;
        }
        html[data-theme="light"] {
          color-scheme: light;
        }

        @media (max-width: 980px) {
          main :global(.grid2) {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}
