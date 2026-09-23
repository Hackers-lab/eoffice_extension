// eOfficeGate — Content Script (v1.5.0)
// 1. Automatic login CAPTCHA detection and auto-fill on eOffice SSO login gate
// 2. Background session keep-alive heartbeats:
//    - eOffice (eoffice.wbsedcl.in): /efile-api/date
//    - CRM (wbcrmap.wbsedcl.in:4443): Oracle EBS /OA_HTML/RF.jsp REST heartbeat
// 3. Active Window Timer & Session Stopwatch:
//    - Tracks real in-window focused active time (pauses when minimized / blurred)
//    - Persists across page transitions within the tab via sessionStorage
//    - Optional floating on-screen timer pill
// 4. In-page fallback timer & synthetic user activity to prevent idle logouts

(function () {
  function isAlive() {
    return typeof chrome !== "undefined" && !!chrome.runtime?.id;
  }

  const isOracleCRM = window.location.hostname.includes("wbcrmap.wbsedcl.in");
  const isEOffice = window.location.hostname.includes("eoffice.wbsedcl.in");

  // -------------------------------------------------------------
  // Part 1: Active Window Time & Session Stopwatch
  // -------------------------------------------------------------
  const SS_KEY_START = "eofficegate_session_start";
  const SS_KEY_ACTIVE = "eofficegate_active_ms";

  let sessionStartTime = Number(sessionStorage.getItem(SS_KEY_START));
  if (!sessionStartTime || isNaN(sessionStartTime)) {
    sessionStartTime = Date.now();
    try { sessionStorage.setItem(SS_KEY_START, String(sessionStartTime)); } catch (e) {}
  }

  let accumulatedActiveMs = Number(sessionStorage.getItem(SS_KEY_ACTIVE)) || 0;
  let lastFocusStart = (document.hasFocus() && document.visibilityState === "visible") ? Date.now() : null;

  function isWindowFocused() {
    return document.hasFocus() && document.visibilityState === "visible";
  }

  function getActiveWindowTimeMs() {
    let total = accumulatedActiveMs;
    if (lastFocusStart && isWindowFocused()) {
      total += (Date.now() - lastFocusStart);
    }
    return total;
  }

  function handleFocusGain() {
    if (!lastFocusStart) {
      lastFocusStart = Date.now();
    }
    updateFloatingBadge();
    reportStatus();
  }

  function handleFocusLoss() {
    if (lastFocusStart) {
      accumulatedActiveMs += (Date.now() - lastFocusStart);
      lastFocusStart = null;
      try { sessionStorage.setItem(SS_KEY_ACTIVE, String(accumulatedActiveMs)); } catch (e) {}
    }
    updateFloatingBadge();
    reportStatus();
  }

  function formatHms(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
  }

  // Floating On-Screen Badge Widget
  let floatingBadgeEl = null;

  function createFloatingBadge() {
    if (floatingBadgeEl || !document.body) return;
    const badge = document.createElement("div");
    badge.id = "eofficegate-floating-timer";
    badge.style.cssText = `
      position: fixed;
      bottom: 12px;
      right: 12px;
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.90);
      color: #f8fafc;
      padding: 5px 11px;
      border-radius: 20px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
      font-weight: 600;
      box-shadow: 0 4px 14px rgba(0,0,0,0.30);
      border: 1px solid rgba(255,255,255,0.18);
      backdrop-filter: blur(6px);
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      transition: opacity 0.2s ease, transform 0.2s ease;
    `;
    badge.title = "eOfficeGate — Active Window Time (Click to collapse/expand)";
    badge.innerHTML = `
      <span style="font-size: 12px;">⏱️</span>
      <span id="eofficegate-timer-text">Active: 00:00</span>
      <span id="eofficegate-status-dot" style="width:7px;height:7px;border-radius:50%;background:#22c55e;display:inline-block;"></span>
    `;

    badge.addEventListener("click", () => {
      const textEl = badge.querySelector("#eofficegate-timer-text");
      if (textEl.style.display === "none") {
        textEl.style.display = "inline";
      } else {
        textEl.style.display = "none";
      }
    });

    document.body.appendChild(badge);
    floatingBadgeEl = badge;
    updateFloatingBadge();
  }

  function updateFloatingBadge() {
    if (!floatingBadgeEl) return;
    const textEl = floatingBadgeEl.querySelector("#eofficegate-timer-text");
    const dotEl = floatingBadgeEl.querySelector("#eofficegate-status-dot");
    if (!textEl) return;

    const activeMs = getActiveWindowTimeMs();
    textEl.textContent = `Active: ${formatHms(activeMs)}`;
    const focused = isWindowFocused();
    if (dotEl) {
      dotEl.style.background = focused ? "#22c55e" : "#f59e0b";
      dotEl.title = focused ? "Window is focused & active" : "Window is in background";
    }
  }

  function syncFloatingBadgeVisibility() {
    if (!isAlive()) return;
    chrome.storage.local.get(["showFloatingBadge"], (data) => {
      const show = data?.showFloatingBadge !== false; // default ON
      if (show) {
        if (!floatingBadgeEl) createFloatingBadge();
        if (floatingBadgeEl) floatingBadgeEl.style.display = "flex";
      } else if (floatingBadgeEl) {
        floatingBadgeEl.style.display = "none";
      }
    });
  }

  // -------------------------------------------------------------
  // Part 2: CAPTCHA Auto-Fill (eOffice SSO gate only)
  // -------------------------------------------------------------
  let captchaObserver = null;
  let captchaInterval = null;

  function fillCaptcha() {
    if (!isAlive() || !isEOffice) return;
    const captcha = document.getElementById("captcha");
    const input = document.getElementById("textBox");

    if (!captcha || !input) return;

    const value = captcha.textContent.trim();
    if (!value) return;

    if (input.value !== value) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      console.log("%c[eOfficeGate] 🔒 CAPTCHA auto-filled:", "color: #0284c7; font-weight: bold;", value);
    }
  }

  function initCaptchaFiller() {
    if (!isAlive() || !isEOffice) return;
    chrome.storage.local.get(["autoCaptcha"], (data) => {
      if (!isAlive() || chrome.runtime.lastError) return;
      const isEnabled = data?.autoCaptcha !== false; // default ON
      if (!isEnabled) return;

      const captcha = document.getElementById("captcha");
      const input = document.getElementById("textBox");

      if (captcha && input) {
        fillCaptcha();

        if (!captchaObserver) {
          captchaObserver = new MutationObserver(() => fillCaptcha());
          captchaObserver.observe(captcha, {
            childList: true,
            characterData: true,
            subtree: true
          });
        }

        if (!captchaInterval) {
          captchaInterval = setInterval(fillCaptcha, 500);
        }
      }
    });
  }

  // -------------------------------------------------------------
  // Part 3: Session Keep-Alive & Activity Simulation
  // -------------------------------------------------------------
  function simulateUserActivity() {
    try {
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
      document.dispatchEvent(new Event("scroll", { bubbles: true }));
    } catch (e) {}
  }

  function getPageStatus() {
    if (isOracleCRM) {
      const isLogin = window.location.pathname.includes("AppsLocalLogin") ||
                      window.location.pathname.includes("AppsLogin");
      return {
        portal: "CRM",
        pageType: isLogin ? "crm_login" : "crm_portal"
      };
    }
    const isLogin = !!(document.getElementById("captcha") && document.getElementById("textBox")) ||
                    window.location.pathname.includes("gate.php");
    return {
      portal: "eOffice",
      pageType: isLogin ? "login" : "portal"
    };
  }

  function reportStatus() {
    if (!isAlive()) return;
    const { portal, pageType } = getPageStatus();
    try {
      chrome.runtime.sendMessage({
        type: "status",
        visible: document.visibilityState === "visible",
        focused: document.hasFocus(),
        isFocused: isWindowFocused(),
        portal,
        pageType,
        url: window.location.pathname,
        sessionStartTime,
        activeTimeMs: getActiveWindowTimeMs()
      }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {}
  }

  async function pingServer() {
    // ---------------- CRM / Oracle EBS Keep-Alive ----------------
    if (isOracleCRM) {
      const isLogin = window.location.pathname.includes("AppsLocalLogin") ||
                      window.location.pathname.includes("AppsLogin");
      if (isLogin) {
        return {
          ok: true,
          status: 200,
          serverTime: "CRM Login Screen (No Session Needed)",
          latencyMs: 0,
          endpoint: "AppsLocalLogin.jsp",
          portal: "CRM"
        };
      }

      const t0 = performance.now();
      try {
        const res = await fetch("/OA_HTML/RF.jsp?function_id=MAINMENUREST&security_group_id=0", {
          method: "POST",
          cache: "no-store",
          credentials: "include",
          headers: {
            "Content-Type": "application/xml",
            "Accept": "*/*"
          },
          body: "<params><param>RESPLIST</param><param>HOMEPAGE</param></params>"
        });

        const latencyMs = Math.round(performance.now() - t0);
        const text = await res.text().catch(() => "");
        const isSessionOk = res.ok && text.includes('status="200"');

        simulateUserActivity();

        const result = {
          ok: isSessionOk,
          status: res.status,
          serverTime: isSessionOk ? "Oracle Session Active" : (text.includes("error") ? "Session Expired" : `HTTP ${res.status}`),
          latencyMs,
          endpoint: "/OA_HTML/RF.jsp",
          portal: "CRM",
          error: isSessionOk ? null : (res.status === 500 ? "Session expired on server (FND_SESSION_ICX_EXPIRED)" : `HTTP ${res.status}`)
        };

        if (isSessionOk) {
          console.log("%c[eOfficeGate] 🟢 CRM Heartbeat Success:", "color: #16a34a; font-weight: bold;",
            `${res.status} OK (${latencyMs}ms) | Oracle EBS Session Refreshed`);
        } else {
          console.warn("%c[eOfficeGate] 🔴 CRM Heartbeat Returned Failure:", "color: #dc2626; font-weight: bold;",
            `HTTP ${res.status} | ${result.error}`);
        }

        return result;
      } catch (err) {
        try {
          const fbRes = await fetch(window.location.href, {
            method: "HEAD",
            cache: "no-store",
            credentials: "include"
          });
          const latencyMs = Math.round(performance.now() - t0);
          simulateUserActivity();
          return {
            ok: fbRes.ok,
            status: fbRes.status,
            serverTime: new Date().toLocaleTimeString(),
            latencyMs,
            endpoint: window.location.pathname,
            portal: "CRM"
          };
        } catch (fbErr) {
          const latencyMs = Math.round(performance.now() - t0);
          return {
            ok: false,
            status: 0,
            error: err.message || "Network request failed",
            latencyMs,
            portal: "CRM"
          };
        }
      }
    }

    // ---------------- eOffice Keep-Alive ----------------
    const isLogin = window.location.pathname.includes("gate.php") || document.getElementById("captcha");
    if (isLogin) {
      return {
        ok: true,
        status: 200,
        serverTime: "eOffice Login Screen (No Session Needed)",
        latencyMs: 0,
        endpoint: "gate.php",
        portal: "eOffice"
      };
    }

    const t0 = performance.now();
    try {
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
      const cleanText = text.replace(/"/g, "").trim();

      simulateUserActivity();

      const result = {
        ok: res.ok,
        status: res.status,
        serverTime: cleanText || (res.ok ? "200 OK" : `HTTP ${res.status}`),
        latencyMs,
        endpoint: "/efile-api/date",
        portal: "eOffice"
      };

      if (res.ok) {
        console.log("%c[eOfficeGate] 🟢 eOffice Heartbeat Success:", "color: #16a34a; font-weight: bold;",
          `${res.status} OK (${latencyMs}ms) | Server Time: ${cleanText}`);
      } else {
        console.warn("%c[eOfficeGate] 🔴 eOffice Heartbeat Returned Non-200:", "color: #dc2626; font-weight: bold;",
          `HTTP ${res.status} | Response: ${cleanText}`);
      }

      return result;
    } catch (err) {
      try {
        const fbRes = await fetch(window.location.href, {
          method: "HEAD",
          cache: "no-store",
          credentials: "include"
        });
        const latencyMs = Math.round(performance.now() - t0);
        simulateUserActivity();
        const result = {
          ok: fbRes.ok,
          status: fbRes.status,
          serverTime: new Date().toLocaleTimeString(),
          latencyMs,
          endpoint: window.location.pathname,
          portal: "eOffice"
        };
        return result;
      } catch (fbErr) {
        const latencyMs = Math.round(performance.now() - t0);
        const result = {
          ok: false,
          status: 0,
          error: err.message || "Network request failed",
          latencyMs,
          portal: "eOffice"
        };
        return result;
      }
    }
  }

  // -------------------------------------------------------------
  // Part 4: In-Page Fallback Keep-Alive Interval
  // -------------------------------------------------------------
  let inPageTimer = null;

  function setupInPageTimer() {
    if (inPageTimer) clearInterval(inPageTimer);
    inPageTimer = setInterval(async () => {
      const { pageType, portal } = getPageStatus();
      if (pageType === "login" || pageType === "crm_login") return;

      if (isAlive()) {
        chrome.storage.local.get(["enabled", "serverPing"], async (data) => {
          if (data.enabled === false || data.serverPing === false) return;
          const pingResult = await pingServer();
          chrome.runtime.sendMessage({
            type: "logPingResult",
            source: `${portal} Timer`,
            pingResult
          }, () => { void chrome.runtime.lastError; });
        });
      }
    }, 3 * 60 * 1000);
  }

  // -------------------------------------------------------------
  // Part 5: Message Handling
  // -------------------------------------------------------------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isAlive()) return false;

    if (message?.type === "nudge" || message?.type === "testPing") {
      (async () => {
        let pingResult = null;
        if (message.serverPing !== false) {
          pingResult = await pingServer();
        }
        sendResponse({ ok: true, pingResult });
      })();
      return true;
    }

    if (message?.type === "requestStatus") {
      reportStatus();
      sendResponse({
        ok: true,
        sessionStartTime,
        activeTimeMs: getActiveWindowTimeMs(),
        isFocused: isWindowFocused()
      });
      return false;
    }

    if (message?.type === "applySettings") {
      if (isEOffice && message.autoCaptcha !== undefined) {
        if (message.autoCaptcha) {
          initCaptchaFiller();
        } else {
          if (captchaObserver) { captchaObserver.disconnect(); captchaObserver = null; }
          if (captchaInterval) { clearInterval(captchaInterval); captchaInterval = null; }
        }
      }
      if (message.showFloatingBadge !== undefined) {
        syncFloatingBadgeVisibility();
      }
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  // Focus & Visibility Listeners for precise Active Window time
  window.addEventListener("focus", handleFocusGain);
  window.addEventListener("blur", handleFocusLoss);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      handleFocusGain();
    } else {
      handleFocusLoss();
    }
  });

  // 1-second active timer ticker
  setInterval(() => {
    updateFloatingBadge();
    // Persist to sessionStorage every 5 seconds
    if (Math.floor(Date.now() / 1000) % 5 === 0) {
      try {
        sessionStorage.setItem(SS_KEY_ACTIVE, String(getActiveWindowTimeMs()));
      } catch (e) {}
    }
  }, 1000);

  if (isEOffice) {
    initCaptchaFiller();
  }
  syncFloatingBadgeVisibility();
  reportStatus();
  setupInPageTimer();
})();
