"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ThemePref = "system" | "light" | "dark";

type User = {
  id: number;
  email: string;
  name: string;
  theme: ThemePref;
};

type AuthResponse = {
  token: string;
  user: User;
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

function loadLocalSession(): { token: string; user: User } | null {
  try {
    const raw = localStorage.getItem("te_session");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveLocalSession(token: string, user: User) {
  localStorage.setItem("te_session", JSON.stringify({ token, user }));
}

function clearLocalSession() {
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
  if (!res.ok) {
    throw new Error(data?.error || `Request failed: ${res.status}`);
  }
  return data as T;
}

export default function Page() {
  const router = useRouter();

  const [mode, setMode] = useState<"login" | "register">("login");

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const [themePref, setThemePref] = useState<ThemePref>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("dark");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");

  // Apply theme on mount + react to system theme change if pref=system
  useEffect(() => {
    const session = loadLocalSession();
    const savedPref = (session?.user?.theme ||
      (localStorage.getItem("te_theme_pref") as ThemePref) ||
      "system") as ThemePref;

    setThemePref(savedPref);
    setResolvedTheme(applyTheme(savedPref));

    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      if (savedPref === "system") setResolvedTheme(applyTheme("system"));
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // If already logged in, go to /weather
  useEffect(() => {
    const session = loadLocalSession();
    if (session?.token) {
      router.replace("/weather");
    }
  }, [router]);

  const themeLabel = useMemo(() => {
    if (themePref === "system") return resolvedTheme === "light" ? "System (Light)" : "System (Dark)";
    return themePref === "light" ? "Light" : "Dark";
  }, [themePref, resolvedTheme]);

  const setTheme = async (pref: ThemePref) => {
    setThemePref(pref);
    localStorage.setItem("te_theme_pref", pref);
    setResolvedTheme(applyTheme(pref));

    // если уже залогинена — сохраним в БД
    const session = loadLocalSession();
    if (session?.token) {
      try {
        await api<{ success: true; theme: ThemePref }>("/me/theme", {
          method: "PUT",
          headers: { Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({ theme: pref }),
        });
        // обновим локальную сессию
        saveLocalSession(session.token, { ...session.user, theme: pref });
      } catch {
        // не критично
      }
    }
  };

  const onSubmit = async () => {
    setMsg("");
    setLoading(true);
    try {
      if (mode === "login") {
        const data = await api<AuthResponse>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        // применяем тему пользователя (из БД)
        saveLocalSession(data.token, data.user);
        localStorage.setItem("te_theme_pref", data.user.theme);
        setThemePref(data.user.theme);
        setResolvedTheme(applyTheme(data.user.theme));
        router.push("/weather");
      } else {
        const data = await api<AuthResponse>("/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, name, password }),
        });
        saveLocalSession(data.token, data.user);
        // для нового юзера сохраняем выбранную тему (pref) в БД
        try {
          await api<{ success: true; theme: ThemePref }>("/me/theme", {
            method: "PUT",
            headers: { Authorization: `Bearer ${data.token}` },
            body: JSON.stringify({ theme: themePref }),
          });
          const updatedUser = { ...data.user, theme: themePref };
          saveLocalSession(data.token, updatedUser);
          localStorage.setItem("te_theme_pref", themePref);
          setResolvedTheme(applyTheme(themePref));
        } catch {}
        router.push("/weather");
      }
    } catch (e: any) {
      setMsg(e?.message || "Error");
    } finally {
      setLoading(false);
    }
  };

  const bg = resolvedTheme === "dark" ? "#060b18" : "#f5f7ff";
  const card = resolvedTheme === "dark" ? "rgba(18, 28, 52, 0.78)" : "rgba(255,255,255,0.85)";
  const border = resolvedTheme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(15, 23, 42, 0.12)";
  const text = resolvedTheme === "dark" ? "#e5e7eb" : "#0f172a";
  const subtext = resolvedTheme === "dark" ? "rgba(229,231,235,0.75)" : "rgba(15,23,42,0.65)";

  return (
    <main
      style={{
        minHeight: "100vh",
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          borderRadius: 22,
          background: card,
          border: `1px solid ${border}`,
          boxShadow: resolvedTheme === "dark"
            ? "0 30px 90px rgba(0,0,0,0.45)"
            : "0 30px 90px rgba(15,23,42,0.12)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: 26 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <h1 style={{ margin: 0, color: text, fontSize: 34, lineHeight: 1.1 }}>
                Welcome to Travel Explorer
              </h1>
              <p style={{ marginTop: 10, marginBottom: 0, color: subtext }}>
                Login or create an account to continue.
              </p>
            </div>

            <button
              onClick={() => {
                const next = themePref === "dark" ? "light" : "dark";
                setTheme(next);
              }}
              style={{
                height: 40,
                padding: "0 14px",
                borderRadius: 999,
                border: `1px solid ${border}`,
                background: resolvedTheme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
                color: text,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              title="Toggle theme"
            >
              {resolvedTheme === "dark" ? "🌙 Dark" : "☀️ Light"}
            </button>
          </div>

          <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ color: subtext, fontSize: 13 }}>Theme:</span>
            <select
              value={themePref}
              onChange={(e) => setTheme(e.target.value as ThemePref)}
              style={{
                height: 36,
                borderRadius: 10,
                border: `1px solid ${border}`,
                background: resolvedTheme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
                color: text,
                padding: "0 10px",
                cursor: "pointer",
              }}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
            <span style={{ color: subtext, fontSize: 13 }}>{themeLabel}</span>
          </div>

          <div style={{ marginTop: 18 }}>
            <div
              style={{
                display: "inline-flex",
                background: resolvedTheme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.06)",
                border: `1px solid ${border}`,
                borderRadius: 999,
                padding: 4,
                gap: 4,
              }}
            >
              <button
                onClick={() => setMode("login")}
                style={{
                  height: 34,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  background: mode === "login" ? "#2563eb" : "transparent",
                  color: mode === "login" ? "#fff" : text,
                }}
              >
                Login
              </button>
              <button
                onClick={() => setMode("register")}
                style={{
                  height: 34,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  background: mode === "register" ? "#2563eb" : "transparent",
                  color: mode === "register" ? "#fff" : text,
                }}
              >
                Register
              </button>
            </div>
          </div>

          <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
            <div>
              <label style={{ display: "block", color: subtext, fontSize: 13, marginBottom: 6 }}>
                Email
              </label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                style={{
                  width: "100%",
                  height: 46,
                  borderRadius: 14,
                  border: `1px solid ${border}`,
                  outline: "none",
                  padding: "0 14px",
                  background: resolvedTheme === "dark" ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.9)",
                  color: text,
                }}
              />
            </div>

            {mode === "register" && (
              <div>
                <label style={{ display: "block", color: subtext, fontSize: 13, marginBottom: 6 }}>
                  Your name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  style={{
                    width: "100%",
                    height: 46,
                    borderRadius: 14,
                    border: `1px solid ${border}`,
                    outline: "none",
                    padding: "0 14px",
                    background: resolvedTheme === "dark" ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.9)",
                    color: text,
                  }}
                />
              </div>
            )}

            <div>
              <label style={{ display: "block", color: subtext, fontSize: 13, marginBottom: 6 }}>
                Password
              </label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="••••••••"
                style={{
                  width: "100%",
                  height: 46,
                  borderRadius: 14,
                  border: `1px solid ${border}`,
                  outline: "none",
                  padding: "0 14px",
                  background: resolvedTheme === "dark" ? "rgba(0,0,0,0.22)" : "rgba(255,255,255,0.9)",
                  color: text,
                }}
              />
              <div style={{ marginTop: 6, color: subtext, fontSize: 12 }}>
                минимум 6 символов
              </div>
            </div>

            {msg && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: `1px solid ${border}`,
                  background: resolvedTheme === "dark" ? "rgba(255,0,0,0.08)" : "rgba(255,0,0,0.06)",
                  color: text,
                }}
              >
                {msg}
              </div>
            )}

            <button
              disabled={loading}
              onClick={onSubmit}
              style={{
                height: 50,
                borderRadius: 16,
                border: "none",
                cursor: loading ? "not-allowed" : "pointer",
                background: "#22c55e",
                color: "#06250f",
                fontWeight: 800,
                fontSize: 16,
                opacity: loading ? 0.75 : 1,
              }}
            >
              {loading ? "Please wait..." : mode === "login" ? "Login" : "Register"}
            </button>

            <button
              onClick={() => {
                // простая кнопка “забыли пароль” — покажем как делать reset
                setMsg(
                  "Password reset: backend has /auth/request-reset and /auth/reset. I can add UI for it next."
                );
              }}
              style={{
                height: 44,
                borderRadius: 14,
                border: `1px solid ${border}`,
                background: "transparent",
                color: subtext,
                cursor: "pointer",
              }}
            >
              Forgot password?
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
