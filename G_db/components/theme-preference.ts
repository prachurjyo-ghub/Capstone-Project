export const garageThemeKey = "partsarc:garage-theme";
export const garageThemeEvent = "partsarc:garage-theme-change";

export const initializeGarageTheme = `try {
  if (localStorage.getItem(${JSON.stringify(garageThemeKey)}) === "dark") {
    document.documentElement.dataset.theme = "dark";
  }
} catch {}`;
