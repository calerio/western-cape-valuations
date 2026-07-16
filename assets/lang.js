/* Language preference for the STATIC (generated) pages — /m/, /d/, /guide/ and their
 * /af/ mirrors. The Atlas SPA (index.html) and map.html switch language client-side in
 * their own modules; this file only (a) persists the EN|AF toggle choice and (b) lands
 * first-time visitors on the language their device asks for.
 *
 * Preference order: localStorage 'wcv-lang' (the sticky toggle) → navigator.language
 * (af* → Afrikaans) → English. If the resolved language differs from the page's
 * <html lang>, redirect to the alternate URL declared by the page's own hreflang link —
 * a lookup, never string surgery, so it can't invent a URL that doesn't exist. */
(function () {
  var KEY = "wcv-lang";
  function stored() {
    try { var v = localStorage.getItem(KEY); if (v === "af" || v === "en") return v; } catch (_) {}
    return null;
  }
  function pref() {
    return stored() ||
      (((navigator.language || "").toLowerCase().indexOf("af") === 0) ? "af" : "en");
  }
  // The EN|AF toggle: persist the choice before the link navigates (capture phase so it
  // also fires when the user opens the alternate in a new tab via modified clicks — harmless).
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("[data-lang]") : null;
    if (!a) return;
    try { localStorage.setItem(KEY, a.getAttribute("data-lang")); } catch (_) {}
  }, true);
  var page = document.documentElement.lang === "af" ? "af" : "en";
  var want = pref();
  if (want !== page) {
    // Prefer the toggle anchor (relative URL — works on localhost dev too);
    // fall back to the absolute hreflang link.
    var alt = document.querySelector('a[data-lang="' + want + '"]') ||
              document.querySelector('link[rel="alternate"][hreflang="' + want + '"]');
    if (alt && alt.href && alt.href !== location.href) location.replace(alt.href);
  }
})();
