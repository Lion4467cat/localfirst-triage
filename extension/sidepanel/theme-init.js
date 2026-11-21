(function () {
  var STORAGE_KEY = "localfirst-theme";
  var pref = "system";
  try {
    var stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      pref = stored;
    }
  } catch {
    pref = "system";
  }

  var systemDark = false;
  try {
    systemDark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    systemDark = false;
  }

  var resolved = pref === "system" ? (systemDark ? "dark" : "light") : pref;
  var root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-preference", pref);
  root.style.colorScheme = resolved;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
})();
