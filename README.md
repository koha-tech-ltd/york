# York

Open-source Loom-like screen recorder for **Windows** and **macOS**.

Floating control bar, rounded camera bubble, screen or window capture with mic, screenshots, and local MP4 / PNG save.

## Preview

![York recording preview — hold Left Alt to zoom toward the mouse](assets/preview.gif)

## Features (v1)

- Always-on-top control pill with camera, mic, and screen/window menus
- Rounded, borderless camera bubble (draggable; sizes S / M / L)
- Presentation recording: selected screen or window + camera composited into a rounded corner PiP
- **Alt zoom:** hold **Left Alt** while recording to smoothly zoom toward the mouse cursor (up to **200%**); release Alt to ease back to normal
- Microphone with live input meter
- Screenshots of the selected source
- Recordings as H.264 MP4
- Settings (cog): choose folders for videos and screenshots
- While recording, overlays hide so they do not appear as black boxes — **click the York tray icon** to stop
- Control UI uses content protection when visible

## Requirements

- Node.js 20+
- Windows 10/11 or macOS 12+
- On macOS: grant **Camera**, **Microphone**, and **Screen Recording** in System Settings → Privacy & Security

## Develop

```bash
npm install
npm run dev
```

Use the tray icon to show/hide the control bar or quit. During a recording, click the tray icon to stop.

**Tip:** Hold **Left Alt** to zoom on the cursor while you present.

## Build

```bash
# Current platform
npm run dist

# Explicit targets
npm run dist:win
npm run dist:mac
```

Installers land in `dist/` (Windows: `York Setup x.y.z.exe`, macOS: DMG).

On some Windows machines, electron-builder’s code-sign helper needs Developer Mode (symlink privilege). This project sets `signAndEditExecutable: false` so local unsigned builds still succeed.

### macOS notarization

v1 ships with camera/mic entitlements and usage strings. Notarization is not automated — sign and notarize with your Apple Developer account before distributing outside Gatekeeper.

## License

MIT — see [LICENSE](LICENSE).
