# eOfficeGate Chrome Extension

**eOfficeGate** is an all-in-one browser extension designed for WBSEDCL eOffice (`https://eoffice.wbsedcl.in`):
1. **Automatic Login CAPTCHA**: Detects login screen, extracts and auto-fills CAPTCHA text instantly.
2. **Session Keep-Alive**: Prevents inactivity timeout by periodically sending lightweight heartbeats in the background every 3 minutes.
3. **Live Logger & Status**: Real-time status badge and detailed log viewer in the extension popup.
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
