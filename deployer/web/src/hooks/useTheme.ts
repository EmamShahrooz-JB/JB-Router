import { useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const stored = JSON.parse(localStorage.getItem("theme") || "{}");
    return stored.state?.theme || "system";
  } catch {
    return "system";
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme());
  const [resolved, setResolved] = useState<"dark" | "light">(
    getInitialTheme() === "system"
      ? getSystemTheme()
      : getInitialTheme() === "dark"
        ? "dark"
        : "light",
  );

  useEffect(() => {
    const resolvedTheme = theme === "system" ? getSystemTheme() : theme;
    setResolved(resolvedTheme);
    document.documentElement.classList.toggle(
      "light",
      resolvedTheme === "light",
    );
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
    try {
      const stored = JSON.parse(localStorage.getItem("theme") || "{}");
      stored.state = { ...(stored.state || {}), theme };
      localStorage.setItem("theme", JSON.stringify(stored));
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") {
        const resolvedTheme = getSystemTheme();
        setResolved(resolvedTheme);
        document.documentElement.classList.toggle(
          "light",
          resolvedTheme === "light",
        );
        document.documentElement.classList.toggle(
          "dark",
          resolvedTheme === "dark",
        );
      }
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [theme]);

  const toggle = () => {
    setTheme((t) => {
      if (t === "dark") return "light";
      if (t === "light") return "system";
      return "dark";
    });
  };

  const set = (t: Theme) => setTheme(t);

  return { theme, resolved, toggle, set };
}
