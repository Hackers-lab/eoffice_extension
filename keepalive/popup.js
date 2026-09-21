function fmtAgo(ts) {
  if (!ts) return "not yet";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

function fmtUntil(ts) {
  if (!ts) return "in a few minutes";
  const s = Math.round((ts - Date.now()) / 1000);
  if (s <= 0) return "imminent";
  if (s < 60) return `in ${s}s`;
  return `in ~${Math.round(s / 60)}m`;
}

async function getStatus() {
  return chrome.runtime.sendMessage({ type: "getStatus" });
}

async function refreshStatus() {
  const { settings, tabs, nextAlarmAt } = await getStatus();

  document.getElementById("interval").value = String(settings.interval);
  document.getElementById("serverPing").checked = settings.serverPing !== false;
  document.getElementById("subtleActivity").checked = settings.subtleActivity !== false;

  const btn = document.getElementById("toggle");
  btn.textContent = settings.enabled ? "Stop Keep-Alive" : "Start Keep-Alive";
  btn.className = settings.enabled ? "stop" : "start";

  const statusEl = document.getElementById("status");
  const testPingBtn = document.getElementById("testPing");

  if (!tabs || tabs.length === 0) {
    testPingBtn.disabled = true;
    statusEl.innerHTML = `
      <div class="status-line">
        <span class="dot warn"></span>
        <span><b>No eOffice tab detected.</b> Open eoffice.wbsedcl.in first.</span>
      </div>`;
    return;
  }

  testPingBtn.disabled = false;
  const activeTab = tabs.find((t) => t.activeInWindow) || tabs[0];
  const tabCountStr = `${tabs.length} eOffice tab${tabs.length > 1 ? "s" : ""} open`;

  let pingInfo = "No heartbeat sent yet.";
  let pingDot = "idle";

  if (settings.lastPingAt) {
    const details = settings.lastPingDetails || {};
    if (settings.lastPingStatus === 200) {
      pingDot = "ok";
      pingInfo = `Last heartbeat: <b>200 OK</b> (${details.latencyMs ? details.latencyMs + "ms, " : ""}${fmtAgo(settings.lastPingAt)})<br>` +
                 `Server time: <code>${details.serverTime || "OK"}</code>`;
    } else {
      pingDot = "err";
      pingInfo = `Last heartbeat failed (${settings.lastPingStatus || "Error"}, ${fmtAgo(settings.lastPingAt)})`;
    }
  }

  const nextPingInfo = settings.enabled
    ? `Next scheduled ping: <b>${fmtUntil(nextAlarmAt)}</b>`
    : `Status: <b>Paused</b> (Click Start to enable auto-ping)`;

  statusEl.innerHTML = `
    <div class="status-line">
      <span class="dot ok"></span>
      <span>${tabCountStr} (${activeTab.activeInWindow ? "Active" : "Background"})</span>
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
  const serverPing = document.getElementById("serverPing").checked;
  const subtleActivity = document.getElementById("subtleActivity").checked;

  await chrome.runtime.sendMessage({
    type: "setSettings",
    enabled,
    interval,
    serverPing,
    subtleActivity
  });
  await refreshStatus();
}

document.getElementById("toggle").addEventListener("click", async () => {
  const { settings } = await getStatus();
  await saveCurrentControls(!settings.enabled);
});

document.getElementById("interval").addEventListener("change", () => saveCurrentControls());
document.getElementById("serverPing").addEventListener("change", () => saveCurrentControls());
document.getElementById("subtleActivity").addEventListener("change", () => saveCurrentControls());

document.getElementById("testPing").addEventListener("click", async () => {
  const btn = document.getElementById("testPing");
  const testBox = document.getElementById("testStatus");
  btn.disabled = true;
  btn.textContent = "Pinging…";
  testBox.style.display = "block";
  testBox.className = "test-result";
  testBox.textContent = "Sending test heartbeat to eOffice…";

  try {
    const res = await chrome.runtime.sendMessage({ type: "testPing" });
    if (res?.ok && res?.pingResult?.ok) {
      const p = res.pingResult;
      testBox.className = "test-result success";
      testBox.innerHTML = `✓ Ping 200 OK (${p.latencyMs}ms)<br>Server: ${p.serverTime}`;
    } else {
      testBox.className = "test-result error";
      testBox.textContent = `✗ Ping failed: ${res?.pingResult?.status || res?.error || "Unknown error"}`;
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

