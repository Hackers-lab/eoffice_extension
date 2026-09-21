// eOfficeGate — Content Script (v1.3.0)
// 1. Automatic login CAPTCHA detection and auto-fill on SSO login gate
// 2. Background session keep-alive heartbeats (/efile-api/date) with live logging
// 3. In-page fallback timer & synthetic user activity to reset client-side idle watchers

(function () {
  function isAlive() {
    return typeof chrome !== "undefined" && !!chrome.runtime?.id;
  }

  // -------------------------------------------------------------
  // Part 1: CAPTCHA Auto-Fill
  // -------------------------------------------------------------
  let captchaObserver = null;
  let captchaInterval = null;

  function fillCaptcha() {
    if (!isAlive()) return;
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
    if (!isAlive()) return;
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
  // Part 2: Session Keep-Alive & Activity Simulation
  // -------------------------------------------------------------
  function simulateUserActivity() {
    try {
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
      document.dispatchEvent(new Event("scroll", { bubbles: true }));
    } catch (e) {}
  }

  function reportStatus() {
    if (!isAlive()) return;
    const isLogin = !!(document.getElementById("captcha") && document.getElementById("textBox"));
    try {
      chrome.runtime.sendMessage({
        type: "status",
        visible: document.visibilityState === "visible",
        focused: document.hasFocus(),
        pageType: isLogin ? "login" : "portal",
        url: window.location.pathname
      }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {}
  }

  async function pingServer() {
    const isLogin = window.location.pathname.includes("gate.php") || document.getElementById("captcha");
    if (isLogin) {
      return {
        ok: true,
        status: 200,
        serverTime: "Login Screen (No Session Needed)",
        latencyMs: 0,
        endpoint: "gate.php"
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
        endpoint: "/efile-api/date"
      };

      if (res.ok) {
        console.log("%c[eOfficeGate] 🟢 Heartbeat Success:", "color: #16a34a; font-weight: bold;",
          `${res.status} OK (${latencyMs}ms) | Server Time: ${cleanText}`);
      } else {
        console.warn("%c[eOfficeGate] 🔴 Heartbeat Returned Non-200:", "color: #dc2626; font-weight: bold;",
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
          endpoint: window.location.pathname
        };
        return result;
      } catch (fbErr) {
        const latencyMs = Math.round(performance.now() - t0);
        const result = {
          ok: false,
          status: 0,
          error: err.message || "Network request failed",
          latencyMs
        };
        return result;
      }
    }
  }

  // -------------------------------------------------------------
  // Part 3: In-Page Fallback Keep-Alive Interval
  // -------------------------------------------------------------
  let inPageTimer = null;

  function setupInPageTimer() {
    if (inPageTimer) clearInterval(inPageTimer);
    inPageTimer = setInterval(async () => {
      const isLogin = window.location.pathname.includes("gate.php") || document.getElementById("captcha");
      if (isLogin) return;

      if (isAlive()) {
        chrome.storage.local.get(["enabled", "serverPing"], async (data) => {
          if (data.enabled === false || data.serverPing === false) return;
          const pingResult = await pingServer();
          chrome.runtime.sendMessage({
            type: "logPingResult",
            source: "In-Page Auto Timer",
            pingResult
          }, () => { void chrome.runtime.lastError; });
        });
      }
    }, 3 * 60 * 1000);
  }

  // -------------------------------------------------------------
  // Part 4: Message Handling
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
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "applyCaptchaSetting") {
      if (message.autoCaptcha) {
        initCaptchaFiller();
      } else {
        if (captchaObserver) {
          captchaObserver.disconnect();
          captchaObserver = null;
        }
        if (captchaInterval) {
          clearInterval(captchaInterval);
          captchaInterval = null;
        }
      }
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  document.addEventListener("visibilitychange", reportStatus);
  window.addEventListener("focus", reportStatus);
  window.addEventListener("blur", reportStatus);

  initCaptchaFiller();
  reportStatus();
  setupInPageTimer();
})();
