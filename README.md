# eOfficeGate Chrome Extension

**eOfficeGate** is an all-in-one browser extension designed for WBSEDCL portals (**eOffice** and **CRM / Oracle EBS**):
1. **Automatic Login CAPTCHA**: Detects eOffice SSO login screen, extracts and auto-fills CAPTCHA text instantly.
2. **Session Keep-Alive (Multi-Portal)**: Prevents inactivity timeout by periodically sending lightweight background heartbeats:
   - **eOffice** (`https://eoffice.wbsedcl.in`): `/efile-api/date` heartbeat.
   - **CRM** (`https://wbcrmap.wbsedcl.in:4443`): Oracle EBS `/OA_HTML/RF.jsp` REST heartbeat without reloading or navigating away from your active work.
3. **Live Logger & Status**: Real-time multi-portal tab detector and detailed log viewer in the extension popup.
4. **GitHub Auto-Update Checker & 1-Click Updater**: Automatically checks for new versions on GitHub and lets you update the unpacked extension directly from the browser or via `update.bat`.

---

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** toggle in the top right corner.
4. Click **Load unpacked** and select the `eofficegate` directory.

---

## Updating

- **In-Browser (1-Click)**: When a new version is released, click the extension icon and select **"Update Now (1-Click)"**. Select the `eofficegate` folder to automatically fetch and overwrite the files.
- **Desktop**: Run `update.bat` from the root folder.
