// eOfficeGate — Content Script (v1.4.0)
// 1. Automatic login CAPTCHA detection and auto-fill on eOffice SSO login gate
// 2. Background session keep-alive heartbeats:
//    - eOffice (eoffice.wbsedcl.in): /efile-api/date
//    - CRM (wbcrmap.wbsedcl.in:4443): Oracle EBS /OA_HTML/RF.jsp REST heartbeat
// 3. In-page fallback timer & synthetic user activity to prevent idle logouts without page reloads

(function () {
  function isAlive() {
    return typeof chrome !== "undefined" && !!chrome.runtime?.id;
  }

  const isOracleCRM = window.location.hostname.includes("wbcrmap.wbsedcl.in");
  const isEOffice = window.location.hostname.includes("eoffice.wbsedcl.in");

  // -------------------------------------------------------------
  // Part 1: CAPTCHA Auto-Fill (eOffice SSO gate only)
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
  // Part 2: Session Keep-Alive & Activity Simulation
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
        portal,
        pageType,
        url: window.location.pathname
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
        // Oracle EBS OAF REST heartbeat (stateless menu REST service that touches ICX_SESSIONS)
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
        // Fallback: HEAD request to current page if RF.jsp fails
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
  // Part 3: In-Page Fallback Keep-Alive Interval
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
      if (isEOffice) {
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
      }
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  document.addEventListener("visibilitychange", reportStatus);
  window.addEventListener("focus", reportStatus);
  window.addEventListener("blur", reportStatus);

  if (isEOffice) {
    initCaptchaFiller();
  }
  reportStatus();
  setupInPageTimer();
})();
