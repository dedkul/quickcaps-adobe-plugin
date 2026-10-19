/*
 * QCUpdates — tells people when a newer QuickCaps is out. Asks GitHub for
 * the latest release at most once a day; nothing else is sent, and any
 * failure (offline, rate limit) is silent: the panel works the same.
 */
window.QCUpdates = (function () {
  const LATEST_URL = "https://api.github.com/repos/dedkul/quickcaps-adobe-plugin/releases/latest";
  const RELEASES_PAGE = "https://github.com/dedkul/quickcaps-adobe-plugin/releases/latest";
  const DAY_MS = 24 * 60 * 60 * 1000;
  const SNOOZE_MS = 7 * DAY_MS; // "Later" hides a release for a week

  // "v0.10.0" -> [0, 10, 0]
  function parts(v) {
    return String(v || "").replace(/^v/i, "").split(/[.-]/).slice(0, 3).map(function (n) {
      return parseInt(n, 10) || 0;
    });
  }

  // True when version `a` is newer than `b` (numeric, so 0.10 > 0.9).
  function isNewer(a, b) {
    const x = parts(a);
    const y = parts(b);
    for (let i = 0; i < 3; i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    }
    return false;
  }

  function due(lastCheckedAt, now) {
    return !lastCheckedAt || now - lastCheckedAt >= DAY_MS || now < lastCheckedAt;
  }

  // fetchFn: fetch-compatible. -> { version, url } of the latest release.
  async function fetchLatest(fetchFn) {
    const res = await fetchFn(LATEST_URL, {
      method: "GET",
      // GitHub refuses API calls without a User-Agent (Node sends none).
      headers: { Accept: "application/vnd.github+json", "User-Agent": "QuickCaps" },
    });
    if (!res.ok) throw new Error("GitHub said " + res.status);
    const json = await res.json();
    if (!json || !json.tag_name) throw new Error("No release found");
    return { version: String(json.tag_name).replace(/^v/i, ""), url: json.html_url || RELEASES_PAGE };
  }

  /*
   * state: { checkedAt, latest, url, dismissed, dismissedAt } — persisted
   * by the caller.
   * Refreshes it when a day has passed, then returns the release to
   * announce ({ version, url }) or null.
   */
  async function check(current, state, fetchFn, now) {
    const t = now || Date.now();
    if (due(state.checkedAt, t)) {
      try {
        const r = await fetchLatest(fetchFn);
        state.latest = r.version;
        state.url = r.url;
      } catch (e) {
        /* offline or rate-limited: try again tomorrow */
      }
      state.checkedAt = t;
    }
    return pending(current, state, t);
  }

  // What to show from what's already known, without asking GitHub.
  function pending(current, state, now) {
    if (!current || !state.latest) return null;
    if (!isNewer(state.latest, current)) return null;
    const t = now || Date.now();
    if (state.dismissed === state.latest && t - (state.dismissedAt || 0) < SNOOZE_MS) return null;
    return { version: state.latest, url: state.url || RELEASES_PAGE };
  }

  function dismiss(state, now) {
    state.dismissed = state.latest;
    state.dismissedAt = now || Date.now();
  }

  return {
    isNewer: isNewer,
    due: due,
    check: check,
    pending: pending,
    dismiss: dismiss,
    RELEASES_PAGE: RELEASES_PAGE,
  };
})();
