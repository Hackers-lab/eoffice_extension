// eOfficeGate — Background Service Worker (v1.4.0)
const DEFAULT_INTERVAL = 3; // minutes
const ALARM_NAME = "eofficeGateKeepAlive";
const UPDATE_ALARM_NAME = "eofficeGateUpdateCheck";
const MATCH_PATTERNS = [
  "https://eoffice.wbsedcl.in/*",
  "https://wbcrmap.wbsedcl.in:4443/*"
];
const DEFAULT_REPO = "Hackers-lab/eoffice_extension";
const MAX_LOGS = 50;

// In-memory tab status (tabId -> {visible, focused, portal, pageType, url, updatedAt})
const tabStatus = new Map();

// Helper: Auto-inject content.js into tabs that lost their connection after extension reload
async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
    return true;
  } catch (e) {
    return false;
  }
}

// -------------------------------------------------------------
// Logging Helper
// -------------------------------------------------------------
async function addLog(entry) {
  try {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const logItem = {
      id: "log_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4),
      time: timeStr,
      timestamp: Date.now(),
      status: entry.status ?? (entry.ok ? 200 : "ERR"),
      ok: !!entry.ok,
      source: entry.source || "Auto Alarm",
      message: entry.message || "",
      serverTime: entry.serverTime || "",
      latencyMs: entry.latencyMs || 0,
      endpoint: entry.endpoint || (entry.portal === "CRM" ? "/OA_HTML/RF.jsp" : "/efile-api/date"),
      portal: entry.portal || null,
      error: entry.error || null
    };

    const data = await chrome.storage.local.get(["pingLogs"]);
    const logs = Array.isArray(data.pingLogs) ? data.pingLogs : [];
    logs.unshift(logItem);
    if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;

    await chrome.storage.local.set({ pingLogs: logs });
  } catch (e) {
    console.error("[eOfficeGate] Failed to record log:", e);
  }
}

// -------------------------------------------------------------
// Version Comparison & GitHub Update Checker
// -------------------------------------------------------------
function compareVersions(v1, v2) {
  const p1 = (v1 || "0").replace(/^v/, "").split(".").map(Number);
  const p2 = (v2 || "0").replace(/^v/, "").split(".").map(Number);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

async function checkForUpdates(manual = false) {
  try {
    const data = await chrome.storage.local.get(["githubRepo"]);
    const repo = data.githubRepo || DEFAULT_REPO;
    const currentVersion = chrome.runtime.getManifest().version;

    let remoteVersion = null;
    let releaseUrl = `https://github.com/${repo}`;
    let changelog = "";

    // 1. Try raw manifest on GitHub main branch
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${repo}/main/eofficegate/manifest.json?_t=${Date.now()}`);
      if (res.ok) {
        const remoteManifest = await res.json();
        remoteVersion = remoteManifest.version;
      }
    } catch (e) {}

    // 2. Fallback to GitHub Releases API if needed
    if (!remoteVersion) {
      try {
        const relRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
          headers: { "Accept": "application/vnd.github.v3+json" }
        });
        if (relRes.ok) {
          const relData = await relRes.json();
          remoteVersion = (relData.tag_name || "").replace(/^v/, "");
          releaseUrl = relData.html_url || releaseUrl;
          changelog = relData.body || "";
        }
      } catch (e) {}
    }

    const hasUpdate = !!(remoteVersion && compareVersions(remoteVersion, currentVersion) > 0);

    const updateInfo = {
      hasUpdate,
      latestVersion: remoteVersion || currentVersion,
      currentVersion,
      repo,
      releaseUrl,
      changelog,
      checkedAt: Date.now(),
      error: remoteVersion ? null : "Could not fetch version from GitHub repository"
    };

    if (hasUpdate) {
      chrome.action.setBadgeText({ text: "NEW" });
      chrome.action.setBadgeBackgroundColor({ color: "#0284c7" });
      if (manual) {
        await addLog({
          ok: true,
          source: "Update",
          message: `🚀 Update available: v${remoteVersion} (current: v${currentVersion})`
        });
      }
    } else {
      chrome.action.setBadgeText({ text: "" });
      if (manual) {
        await addLog({
          ok: true,
          source: "Update",
          message: `✓ eOfficeGate is up to date (v${currentVersion})`
        });
      }
    }

    await chrome.storage.local.set({ updateInfo });
    return updateInfo;
  } catch (err) {
    const info = {
      hasUpdate: false,
      currentVersion: chrome.runtime.getManifest().version,
      checkedAt: Date.now(),
      error: err.message
    };
    await chrome.storage.local.set({ updateInfo: info });
    return info;
  }
}

// -------------------------------------------------------------
// Settings Management
// -------------------------------------------------------------
async function getSettings() {
  const data = await chrome.storage.local.get([
    "enabled", "interval", "autoCaptcha", "serverPing", "githubRepo",
    "lastPingAt", "lastPingStatus", "lastPingDetails"
  ]);
  return {
    enabled: data.enabled !== false,
    interval: data.interval || DEFAULT_INTERVAL,
    autoCaptcha: data.autoCaptcha !== false,
    serverPing: data.serverPing !== false,
    githubRepo: data.githubRepo || DEFAULT_REPO,
    lastPingAt: data.lastPingAt || null,
    lastPingStatus: data.lastPingStatus || null,
    lastPingDetails: data.lastPingDetails || null
  };
}

async function ensureDefaults() {
  const data = await chrome.storage.local.get(["enabled", "interval", "autoCaptcha", "serverPing", "githubRepo", "pingLogs"]);
  const patch = {};
  if (data.enabled === undefined) patch.enabled = true;
  if (!data.interval) patch.interval = DEFAULT_INTERVAL;
  if (data.autoCaptcha === undefined) patch.autoCaptcha = true;
  if (data.serverPing === undefined) patch.serverPing = true;
  if (!data.githubRepo) patch.githubRepo = DEFAULT_REPO;
  if (!Array.isArray(data.pingLogs)) patch.pingLogs = [];
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
}

async function scheduleAlarms(intervalMinutes) {
  // 1. Keep-alive heartbeat alarm
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: Number(intervalMinutes),
    periodInMinutes: Number(intervalMinutes)
  });

  // 2. Background GitHub update check alarm (every 12 hours)
  await chrome.alarms.clear(UPDATE_ALARM_NAME);
  chrome.alarms.create(UPDATE_ALARM_NAME, {
    delayInMinutes: 5,
    periodInMinutes: 720
  });
}

async function applyEnabledState() {
  const settings = await getSettings();
  if (settings.enabled) {
    await scheduleAlarms(settings.interval);
  } else {
    await chrome.alarms.clear(ALARM_NAME);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await applyEnabledState();

  const tabs = await chrome.tabs.query({ url: MATCH_PATTERNS });
  let injected = 0;
  for (const t of tabs) {
    if (t.id && await ensureContentScriptInjected(t.id)) injected++;
  }
  await addLog({ ok: true, source: "System", message: `Extension ready. Auto-connected to ${injected}/${tabs.length} open tab(s).` });
  checkForUpdates(false);
});

chrome.runtime.onStartup.addListener(async () => {
  await applyEnabledState();
  await addLog({ ok: true, source: "System", message: "Browser launched. Keep-alive resumed." });
  checkForUpdates(false);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStatus.delete(tabId);
});

// -------------------------------------------------------------
// Alarm Handler
// -------------------------------------------------------------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === UPDATE_ALARM_NAME) {
    await checkForUpdates(false);
    return;
  }

  if (alarm.name !== ALARM_NAME) return;

  const settings = await getSettings();
  if (!settings.enabled) return;

  const tabs = await chrome.tabs.query({ url: MATCH_PATTERNS });
  if (tabs.length === 0) {
    await addLog({
      ok: false,
      status: "NO_TAB",
      source: "Auto Alarm",
      error: "No active WBSEDCL tab open. Open eOffice or CRM in a tab."
    });
    return;
  }

  let pingCount = 0;

  for (const tab of tabs) {
    if (!tab.id) continue;
    const portalName = tab.url?.includes("wbcrmap.wbsedcl.in") ? "CRM" : "eOffice";

    try {
      let resp = null;
      try {
        resp = await chrome.tabs.sendMessage(tab.id, {
          type: "nudge",
          serverPing: settings.serverPing
        });
      } catch (sendErr) {
        // Tab was disconnected / not yet injected: auto-inject and retry!
        const injected = await ensureContentScriptInjected(tab.id);
        if (injected) {
          resp = await chrome.tabs.sendMessage(tab.id, {
            type: "nudge",
            serverPing: settings.serverPing
          });
        } else {
          throw sendErr;
        }
      }

      if (resp?.pingResult) {
        pingCount++;
        const p = resp.pingResult;
        await chrome.storage.local.set({
          lastPingAt: Date.now(),
          lastPingStatus: p.status,
          lastPingDetails: p
        });

        await addLog({
          ok: p.ok,
          status: p.status,
          source: `${portalName} Tab #${tab.id}`,
          portal: portalName,
          serverTime: p.serverTime,
          latencyMs: p.latencyMs,
          endpoint: p.endpoint,
          error: p.error
        });
      }
    } catch (e) {
      await addLog({
        ok: false,
        status: "DISCONNECTED",
        source: `${portalName} Tab #${tab.id}`,
        portal: portalName,
        error: `${portalName} tab is sleeping or disconnected. Please refresh the page.`
      });
    }
  }

  if (pingCount === 0 && tabs.length > 0) {
    await addLog({
      ok: false,
      status: "NO_REPLY",
      source: "Auto Alarm",
      error: "Tabs did not respond to keep-alive. Please refresh your WBSEDCL tabs."
    });
  }
});

// -------------------------------------------------------------
// Runtime Message Listener
// -------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "status") {
    if (sender.tab?.id != null) {
      tabStatus.set(sender.tab.id, {
        visible: !!message.visible,
        focused: !!message.focused,
        portal: message.portal || (sender.tab.url?.includes("wbcrmap") ? "CRM" : "eOffice"),
        pageType: message.pageType || "portal",
        url: message.url || "",
        updatedAt: Date.now()
      });
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "logPingResult" && message.pingResult) {
    const p = message.pingResult;
    addLog({
      ok: p.ok,
      status: p.status,
      source: message.source || "Tab Timer",
      portal: p.portal || null,
      serverTime: p.serverTime,
      latencyMs: p.latencyMs,
      endpoint: p.endpoint,
      error: p.error
    });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "clearLogs") {
    chrome.storage.local.set({ pingLogs: [] }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "checkForUpdates") {
    checkForUpdates(true).then((info) => {
      sendResponse({ ok: true, updateInfo: info });
    });
    return true;
  }

  if (message?.type === "reloadExtension") {
    chrome.runtime.reload();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "setSettings") {
    const interval = Math.max(1, Math.min(30, Number(message.interval) || DEFAULT_INTERVAL));
    const enabled = message.enabled !== false;
    const autoCaptcha = message.autoCaptcha !== false;
    const serverPing = message.serverPing !== false;
    const githubRepo = (message.githubRepo || DEFAULT_REPO).trim();

    chrome.storage.local.set({ enabled, interval, autoCaptcha, serverPing, githubRepo }).then(async () => {
      await applyEnabledState();
      await addLog({
        ok: true,
        source: "User",
        message: `Settings updated: KeepAlive=${enabled ? "ON" : "OFF"}, Interval=${interval}m, Repo=${githubRepo}`
      });

      const tabs = await chrome.tabs.query({ url: MATCH_PATTERNS });
      for (const t of tabs) {
        if (t.id) chrome.tabs.sendMessage(t.id, { type: "applyCaptchaSetting", autoCaptcha }).catch(() => {});
      }

      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "testPing") {
    (async () => {
      const tabs = await chrome.tabs.query({ url: MATCH_PATTERNS });
      if (tabs.length === 0) {
        await addLog({ ok: false, status: "NO_TAB", source: "Manual Test", error: "No eOffice or CRM tab open." });
        sendResponse({ ok: false, error: "No eOffice or CRM tab detected. Open eoffice.wbsedcl.in or wbcrmap.wbsedcl.in:4443 first." });
        return;
      }

      const targetTab = tabs.find((t) => t.active) || tabs[0];
      const portalName = targetTab.url?.includes("wbcrmap.wbsedcl.in") ? "CRM" : "eOffice";

      try {
        let resp = null;
        try {
          resp = await chrome.tabs.sendMessage(targetTab.id, {
            type: "testPing",
            serverPing: true
          });
        } catch (err) {
          const injected = await ensureContentScriptInjected(targetTab.id);
          if (injected) {
            resp = await chrome.tabs.sendMessage(targetTab.id, {
              type: "testPing",
              serverPing: true
            });
          } else {
            throw err;
          }
        }

        if (resp?.pingResult) {
          const p = resp.pingResult;
          await chrome.storage.local.set({
            lastPingAt: Date.now(),
            lastPingStatus: p.status,
            lastPingDetails: p
          });

          await addLog({
            ok: p.ok,
            status: p.status,
            source: `${portalName} Test`,
            portal: portalName,
            serverTime: p.serverTime,
            latencyMs: p.latencyMs,
            endpoint: p.endpoint,
            error: p.error
          });

          sendResponse({ ok: true, pingResult: p });
        } else {
          await addLog({ ok: false, status: "NO_REPLY", source: `${portalName} Test`, error: "No response from tab." });
          sendResponse({ ok: false, error: "No response from tab." });
        }
      } catch (err) {
        await addLog({ ok: false, status: "ERR", source: `${portalName} Test`, error: err.message });
        sendResponse({ ok: false, error: `Failed to communicate with ${portalName} tab. Refresh the page.` });
      }
    })();
    return true;
  }

  if (message?.type === "getStatus") {
    (async () => {
      const settings = await getSettings();
      const tabs = await chrome.tabs.query({ url: MATCH_PATTERNS });
      const alarm = await chrome.alarms.get(ALARM_NAME);
      const data = await chrome.storage.local.get(["pingLogs", "updateInfo"]);
      const logs = Array.isArray(data.pingLogs) ? data.pingLogs : [];
      const updateInfo = data.updateInfo || null;

      const tabInfo = tabs.map((t) => {
        const s = t.id != null ? tabStatus.get(t.id) : undefined;
        const isCrm = t.url?.includes("wbcrmap.wbsedcl.in");
        return {
          id: t.id,
          title: t.title,
          url: t.url,
          portal: isCrm ? "CRM" : "eOffice",
          activeInWindow: !!t.active,
          discarded: !!t.discarded,
          visible: s ? s.visible : null,
          focused: s ? s.focused : null,
          pageType: s ? s.pageType : (isCrm ? "crm_portal" : "portal")
        };
      });

      sendResponse({
        settings,
        tabs: tabInfo,
        nextAlarmAt: alarm ? alarm.scheduledTime : null,
        logs,
        updateInfo
      });
    })();
    return true;
  }
});
