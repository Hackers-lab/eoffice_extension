// eOffice Activity Helper — Content Script
// Sends a lightweight background heartbeat to /efile-api/date to refresh
// the server session idle timer, preventing session expiration without
// reloading or navigating the page.

(function () {
  function reportStatus() {
    chrome.runtime.sendMessage({
      type: "status",
      visible: document.visibilityState === "visible",
      focused: document.hasFocus()
    }).catch(() => {
      // Background may not be ready yet, or extension was reloaded
    });
  }

  function subtleNudge() {
    try {
      document.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true,
        cancelable: true,
        clientX: 0,
        clientY: 0
      }));
      document.dispatchEvent(new Event("scroll", { bubbles: true }));
    } catch (e) {
      console.debug("[eOffice Activity Helper] Nudge skipped:", e);
    }
  }

  async function pingServer() {
    const t0 = performance.now();
    try {
      // Primary keep-alive endpoint verified for eFile 7.x
      const res = await fetch("/efile-api/date", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Accept": "application/json, text/plain, */*"
        }
      });

      const latencyMs = Math.round(performance.now() - t0);
      const text = await res.text().catch(() => "");

      return {
        ok: res.ok,
        status: res.status,
        serverTime: text.replace(/"/g, "").trim(),
        latencyMs,
        endpoint: "/efile-api/date"
      };
    } catch (err) {
      // Fallback: HEAD request to current page if /efile-api is unreachable
      try {
        const fbRes = await fetch(window.location.href, {
          method: "HEAD",
          cache: "no-store",
          credentials: "include"
        });
        const latencyMs = Math.round(performance.now() - t0);
        return {
          ok: fbRes.ok,
          status: fbRes.status,
          serverTime: new Date().toLocaleTimeString(),
          latencyMs,
          endpoint: window.location.pathname
        };
      } catch (fbErr) {
        return {
          ok: false,
          status: 0,
          error: err.message || "Network error",
          latencyMs: Math.round(performance.now() - t0)
        };
      }
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "nudge" || message?.type === "testPing") {
      (async () => {
        let pingResult = null;

        if (message.serverPing !== false) {
          pingResult = await pingServer();
        }

        if (message.subtleActivity !== false) {
          subtleNudge();
        }

        sendResponse({ ok: true, pingResult });
      })();
      return true; // async sendResponse
    }

    if (message?.type === "requestStatus") {
      reportStatus();
      sendResponse({ ok: true });
    }
  });

  document.addEventListener("visibilitychange", reportStatus);
  window.addEventListener("focus", reportStatus);
  window.addEventListener("blur", reportStatus);

  reportStatus();
})();
