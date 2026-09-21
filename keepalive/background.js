const DEFAULT_INTERVAL = 5; // minutes
const ALARM_NAME = "eofficeActivityNudge";
const MATCH_PATTERNS = ["https://eoffice.wbsedcl.in/*"];

// In-memory tab status (tabId -> {visible, focused, updatedAt})
const tabStatus = new Map();

async function getSettings() {
  const data = await chrome.storage.local.get([
    "enabled", "interval", "serverPing", "subtleActivity",
    "lastPingAt", "lastPingStatus", "lastPingDetails"
  ]);
  return {
    enabled: data.enabled === true,
    interval: data.interval || DEFAULT_INTERVAL,
    serverPing: data.serverPing !== false,       // default ON
    subtleActivity: data.subtleActivity !== false, // default ON
    lastPingAt: data.lastPingAt || null,
    lastPingStatus: data.lastPingStatus || null,
    lastPingDetails: data.lastPingDetails || null
  };
}

async function ensureDefaults() {
  const data = await chrome.storage.local.get(["enabled", "interval", "serverPing", "subtleActivity"]);
  const patch = {};
  if (data.enabled === undefined) patch.enabled = false;
  if (!data.interval) patch.interval = DEFAULT_INTERVAL;
  if (data.serverPing === undefined) patch.serverPing = true;
  if (data.subtleActivity === undefined) patch.subtleActivity = true;
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
}

async function scheduleAlarm(minutes) {
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: Number(minutes),
    periodInMinutes: Number(minutes)
  });
}

async function applyEnabledState() {
  const settings = await getSettings();
  if (settings.enabled) {
    await scheduleAlarm(settings.interval);
  } else {
    await chrome.alarms.clear(ALARM_NAME);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await applyEnabledState();
});

chrome.runtime.onStartup.addListener(async () => {
  await applyEnabledState();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStatus.delete(tabId);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;

  const settings = await getSettings();
  if (!settings.enabled) return;

  const tabs = await chrome.tabs.query({ url: MATCH_PATTERNS });
  if (tabs.length === 0) return;

  let latestPingResult = null;

  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, {
        type: "nudge",
        serverPing: settings.serverPing,
        subtleActivity: settings.subtleActivity
      });
      if (resp?.pingResult) {
        latestPingResult = resp.pingResult;
      }
    } catch (e) {
      // Tab may be discarded or loading
    }
  }

  if (latestPingResult) {
    await chrome.storage.local.set({
      lastPingAt: Date.now(),
      lastPingStatus: latestPingResult.status,
      lastPingDetails: latestPingResult
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "status" && sender.tab?.id != null) {
    tabStatus.set(sender.tab.id, {
      visible: !!message.visible,
      focused: !!message.focused,
      updatedAt: Date.now()
    });
    return;
  }

  if (message?.type === "setSettings") {
    const interval = Math.max(1, Math.min(30, Number(message.interval) || DEFAULT_INTERVAL));
    const enabled = !!message.enabled;
    const serverPing = message.serverPing !== false;
    const subtleActivity = message.subtleActivity !== false;

    chrome.storage.local.set({ enabled, interval, serverPing, subtleActivity }).then(async () => {
      await applyEnabledState();
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "testPing") {
    (async () => {
      const tabs = await chrome.tabs.query({ url: MATCH_PATTERNS });
      if (tabs.length === 0) {
        sendResponse({ ok: false, error: "No eOffice tab detected. Open eOffice in a tab first." });
        return;
      }

      // Prefer the active/selected tab, or the first available one
      const targetTab = tabs.find((t) => t.active) || tabs[0];

      try {
        const resp = await chrome.tabs.sendMessage(targetTab.id, {
          type: "testPing",
          serverPing: true,
          subtleActivity: false
        });

        if (resp?.pingResult) {
          await chrome.storage.local.set({
            lastPingAt: Date.now(),
            lastPingStatus: resp.pingResult.status,
            lastPingDetails: resp.pingResult
          });
          sendResponse({ ok: true, pingResult: resp.pingResult });
        } else {
          sendResponse({ ok: false, error: "No response received from eOffice tab." });
        }
      } catch (err) {
        sendResponse({ ok: false, error: "Failed to communicate with tab. Try refreshing the eOffice page." });
      }
    })();
    return true;
  }

  if (message?.type === "getStatus") {
    (async () => {
      const settings = await getSettings();
      const tabs = await chrome.tabs.query({ url: MATCH_PATTERNS });
      const alarm = await chrome.alarms.get(ALARM_NAME);
      const tabInfo = tabs.map((t) => {
        const s = t.id != null ? tabStatus.get(t.id) : undefined;
        return {
          id: t.id,
          title: t.title,
          url: t.url,
          activeInWindow: !!t.active,
          discarded: !!t.discarded,
          visible: s ? s.visible : null,
          focused: s ? s.focused : null
        };
      });

      sendResponse({
        settings,
        tabs: tabInfo,
        nextAlarmAt: alarm ? alarm.scheduledTime : null
      });
    })();
    return true;
  }
});
