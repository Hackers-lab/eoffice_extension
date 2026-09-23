function fmtAgo(ts) {
  if (!ts) return "not yet";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

function fmtUntil(ts) {
  if (!ts) return "in a moment";
  const s = Math.round((ts - Date.now()) / 1000);
  if (s <= 0) return "imminent";
  if (s < 60) return `in ${s}s`;
  return `in ~${Math.round(s / 60)}m`;
}

async function getStatus() {
  return chrome.runtime.sendMessage({ type: "getStatus" });
}

function renderLogs(logs) {
  const container = document.getElementById("logsContainer");
  const title = document.getElementById("logsTitle");

  if (!logs || logs.length === 0) {
    title.textContent = "Activity Logs (0)";
    container.innerHTML = '<div style="color: #64748b; font-style: italic; padding: 4px 0;">No logs yet. Waiting for heartbeat…</div>';
    return;
  }

  title.textContent = `Activity Logs (${logs.length})`;
  let html = "";

  for (const item of logs) {
    const isOk = item.ok;
    const tagClass = isOk ? "ok" : (item.status === "NO_TAB" ? "warn" : "err");
    const statusText = item.status === 200 ? "200 OK" : String(item.status || "ERR");
    const portalPrefix = item.portal ? `<span style="color:#38bdf8;font-weight:600;">[${item.portal}]</span> ` : "";

    let detail = "";
    if (item.serverTime) detail += ` • ${item.serverTime}`;
    if (item.latencyMs) detail += ` (${item.latencyMs}ms)`;
    if (item.error) detail += ` • <span style="color:#f87171">${item.error}</span>`;
    if (item.message) detail += ` • ${item.message}`;

    html += `
      <div class="log-row">
        <span class="log-time">${item.time}</span>
        <span class="log-tag ${tagClass}">[${statusText}]</span>
        <span class="log-src">(${item.source})</span>
        <span>${portalPrefix}${detail}</span>
      </div>`;
  }

  container.innerHTML = html;
}

function renderUpdateBanner(updateInfo) {
  const banner = document.getElementById("updateBanner");
  const badge = document.getElementById("updateVersionBadge");
  const changelogLink = document.getElementById("btnChangelog");
  const statusText = document.getElementById("updateStatusText");

  if (!updateInfo) {
    banner.style.display = "none";
    return;
  }

  if (updateInfo.hasUpdate) {
    banner.style.display = "block";
    badge.textContent = "v" + updateInfo.latestVersion;
    changelogLink.href = updateInfo.releaseUrl || `https://github.com/${updateInfo.repo || "Hackers-lab/eoffice_extension"}`;
    statusText.textContent = `Update available: v${updateInfo.latestVersion}`;
  } else {
    banner.style.display = "none";
    if (updateInfo.checkedAt) {
      statusText.textContent = `Up to date (checked ${fmtAgo(updateInfo.checkedAt)})`;
    }
  }
}

async function refreshStatus() {
  const manifest = chrome.runtime.getManifest();
  if (manifest?.version) {
    const vEl = document.getElementById("versionBadge");
    if (vEl) vEl.textContent = "v" + manifest.version;
  }

  const { settings, tabs, nextAlarmAt, logs, updateInfo } = await getStatus();

  document.getElementById("interval").value = String(settings.interval);
  document.getElementById("autoCaptcha").checked = settings.autoCaptcha !== false;
  document.getElementById("serverPing").checked = settings.serverPing !== false;

  const btn = document.getElementById("toggle");
  btn.textContent = settings.enabled ? "Stop Keep-Alive" : "Start Keep-Alive";
  btn.className = settings.enabled ? "stop" : "start";

  const statusEl = document.getElementById("status");
  const testPingBtn = document.getElementById("testPing");

  renderLogs(logs);
  renderUpdateBanner(updateInfo);

  if (!tabs || tabs.length === 0) {
    testPingBtn.disabled = true;
    statusEl.innerHTML = `
      <div class="status-line">
        <span class="dot warn"></span>
        <span><b>No active tab open.</b> Open eoffice.wbsedcl.in or wbcrmap.wbsedcl.in:4443.</span>
      </div>`;
    return;
  }

  testPingBtn.disabled = false;
  const activeTab = tabs.find((t) => t.activeInWindow) || tabs[0];
  const eofficeCount = tabs.filter(t => t.portal === "eOffice").length;
  const crmCount = tabs.filter(t => t.portal === "CRM").length;
  const parts = [];
  if (eofficeCount > 0) parts.push(`${eofficeCount} eOffice`);
  if (crmCount > 0) parts.push(`${crmCount} CRM`);
  const tabSummary = parts.length > 0 ? parts.join(", ") : `${tabs.length} tab(s)`;

  let pageKind = "Portal";
  if (activeTab.portal === "CRM") {
    pageKind = activeTab.pageType === "crm_login" ? "CRM Login" : "CRM Portal";
  } else {
    pageKind = activeTab.pageType === "login" ? "eOffice Login" : "eFile Portal";
  }

  let pingInfo = "No heartbeat sent yet.";
  let pingDot = "idle";

  if (settings.lastPingAt) {
    const details = settings.lastPingDetails || {};
    const portalTag = details.portal ? `[${details.portal}] ` : "";
    if (settings.lastPingStatus === 200) {
      pingDot = "ok";
      pingInfo = `Heartbeat: ${portalTag}<b>200 OK</b> (${details.latencyMs ? details.latencyMs + "ms, " : ""}${fmtAgo(settings.lastPingAt)})<br>` +
                 `Server: <code>${details.serverTime || "OK"}</code>`;
    } else {
      pingDot = "err";
      pingInfo = `Heartbeat error: ${portalTag}(${settings.lastPingStatus || "Error"}, ${fmtAgo(settings.lastPingAt)})`;
    }
  }

  const nextPingInfo = settings.enabled
    ? `Next scheduled ping: <b>${fmtUntil(nextAlarmAt)}</b>`
    : `Keep-alive is <b>Stopped</b> (Click Start to resume)`;

  statusEl.innerHTML = `
    <div class="status-line">
      <span class="dot ok"></span>
      <span><b>${tabSummary} detected</b> (Active: ${pageKind})</span>
    </div>
    <div class="status-line">
      <span class="dot ${pingDot}"></span>
      <span>${pingInfo}</span>
    </div>
    <div class="status-line">
      <span class="dot ${settings.enabled ? "ok" : "idle"}"></span>
      <span>${nextPingInfo}</span>
    </div>
  `;
}

async function saveCurrentControls(overrideEnabled) {
  const { settings } = await getStatus();
  const enabled = overrideEnabled !== undefined ? overrideEnabled : settings.enabled;
  const interval = Number(document.getElementById("interval").value);
  const autoCaptcha = document.getElementById("autoCaptcha").checked;
  const serverPing = document.getElementById("serverPing").checked;

  await chrome.runtime.sendMessage({
    type: "setSettings",
    enabled,
    interval,
    autoCaptcha,
    serverPing
  });
  await refreshStatus();
}

document.getElementById("toggle").addEventListener("click", async () => {
  const { settings } = await getStatus();
  await saveCurrentControls(!settings.enabled);
});

document.getElementById("interval").addEventListener("change", () => saveCurrentControls());
document.getElementById("autoCaptcha").addEventListener("change", () => saveCurrentControls());
document.getElementById("serverPing").addEventListener("change", () => saveCurrentControls());

document.getElementById("clearLogs").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clearLogs" });
  await refreshStatus();
});

document.getElementById("copyLogs").addEventListener("click", async () => {
  const { logs } = await getStatus();
  if (!logs || logs.length === 0) return;
  const text = logs.map(l => `[${l.time}] [${l.status}] (${l.source}) ${l.serverTime || l.error || l.message} (${l.latencyMs}ms)`).join("\n");
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copyLogs");
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy"; }, 1500);
  });
});

document.getElementById("btnCheckUpdate").addEventListener("click", async () => {
  const btn = document.getElementById("btnCheckUpdate");
  const statusText = document.getElementById("updateStatusText");
  btn.textContent = "Checking…";
  statusText.textContent = "Connecting to GitHub…";

  const res = await chrome.runtime.sendMessage({ type: "checkForUpdates" });
  if (res?.updateInfo) {
    renderUpdateBanner(res.updateInfo);
  }
  btn.textContent = "Check for updates";
  await refreshStatus();
});

// -------------------------------------------------------------
// 1-Click Browser Updater via File System Access API
// -------------------------------------------------------------
document.getElementById("btn1ClickUpdate").addEventListener("click", async () => {
  const btn = document.getElementById("btn1ClickUpdate");
  const progress = document.getElementById("updateProgress");
  progress.style.display = "block";
  progress.textContent = "Select your 'eofficegate' directory to allow updating...";
  btn.disabled = true;

  try {
    if (!window.showDirectoryPicker) {
      alert("Your browser does not support the File System Access API. Please use update.bat or git pull.");
      btn.disabled = false;
      return;
    }

    const dirHandle = await window.showDirectoryPicker({
      id: "eofficegate_updater",
      mode: "readwrite"
    });

    const { settings, updateInfo } = await getStatus();
    const repo = settings.githubRepo || "Hackers-lab/eoffice_extension";
    const branch = "main";

    const filesToUpdate = [
      "manifest.json",
      "content.js",
      "background.js",
      "popup.html",
      "popup.js",
      "options.html",
      "icon.svg",
      "icon-16.png",
      "icon-32.png",
      "icon-48.png",
      "icon-128.png"
    ];

    let updatedCount = 0;
    for (const fname of filesToUpdate) {
      progress.textContent = `Downloading ${fname}...`;
      try {
        const url = `https://raw.githubusercontent.com/${repo}/${branch}/eofficegate/${fname}?_t=${Date.now()}`;
        const res = await fetch(url);
        if (!res.ok) {
          if (fname.startsWith("icon")) continue;
          throw new Error(`Failed to download ${fname} (HTTP ${res.status})`);
        }

        const blob = await res.blob();
        progress.textContent = `Writing ${fname}...`;
        const fileHandle = await dirHandle.getFileHandle(fname, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        updatedCount++;
      } catch (fileErr) {
        console.warn("[eOfficeGate Update] Skipped file:", fname, fileErr);
      }
    }

    progress.textContent = `✓ ${updatedCount} files updated! Reloading extension...`;
    setTimeout(() => {
      chrome.runtime.reload();
    }, 1200);
  } catch (err) {
    if (err.name === "AbortError") {
      progress.textContent = "Update cancelled by user.";
    } else {
      progress.textContent = "Update error: " + err.message;
    }
    btn.disabled = false;
  }
});

document.getElementById("testPing").addEventListener("click", async () => {
  const btn = document.getElementById("testPing");
  const testBox = document.getElementById("testStatus");
  btn.disabled = true;
  btn.textContent = "Pinging…";
  testBox.style.display = "block";
  testBox.className = "test-result";
  testBox.textContent = "Sending test heartbeat…";

  try {
    const res = await chrome.runtime.sendMessage({ type: "testPing" });
    if (res?.ok && res?.pingResult?.ok) {
      const p = res.pingResult;
      const portalPrefix = p.portal ? `[${p.portal}] ` : "";
      testBox.className = "test-result success";
      testBox.innerHTML = `✓ ${portalPrefix}200 OK (${p.latencyMs}ms) • ${p.serverTime}`;
    } else {
      testBox.className = "test-result error";
      const portalPrefix = res?.pingResult?.portal ? `[${res.pingResult.portal}] ` : "";
      testBox.textContent = `✗ ${portalPrefix}Ping failed: ${res?.pingResult?.status || res?.error || "Unknown error"}`;
    }
  } catch (e) {
    testBox.className = "test-result error";
    testBox.textContent = `✗ Test error: ${e.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Test Ping Now";
    await refreshStatus();
  }
});

refreshStatus();
const pollTimer = setInterval(refreshStatus, 3000);
window.addEventListener("unload", () => clearInterval(pollTimer));
