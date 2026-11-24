"use client";

import { useSyncExternalStore } from "react";
import { FiMoon, FiSun } from "react-icons/fi";
import { garageThemeEvent, garageThemeKey } from "./theme-preference";

function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

function subscribe(onChange: () => void) {
  function syncAcrossTabs(event: StorageEvent) {
    if (event.key === garageThemeKey || event.key === null) {
      document.documentElement.dataset.theme = event.newValue === "dark" ? "dark" : "light";
      onChange();
    }
  }

  window.addEventListener(garageThemeEvent, onChange);
  window.addEventListener("storage", syncAcrossTabs);
  return () => {
    window.removeEventListener(garageThemeEvent, onChange);
    window.removeEventListener("storage", syncAcrossTabs);
  };
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  function toggle() {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(garageThemeKey, next);
    } catch {
      // Theme changes still apply while storage is unavailable.
    }
    window.dispatchEvent(new Event(garageThemeEvent));
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label="Dark mode"
      aria-pressed={dark}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggle}
    >
      {dark ? <FiSun aria-hidden="true" /> : <FiMoon aria-hidden="true" />}
    </button>
  );
}
