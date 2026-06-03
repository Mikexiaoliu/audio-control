# Audio Control

A Windows-focused desktop audio playback console for playing prerecorded audio files from a playlist.

## Features

- Add individual audio files or import all supported files from a folder.
- Click a playlist item to play it immediately.
- Select a specific audio output device instead of always using the system default.
- Adjust global playback speed from 0.5x to 2.0x.
- Organize clips into groups such as opening, prompts, background, and backup.
- Automatically restores playlist, groups, selected device, and speed settings.

## Development

```powershell
npm install
npm start
```

If Electron binary download is slow or blocked on Windows, use:

```powershell
cmd /c "set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/&& npm.cmd install"
```

Run a syntax check:

```powershell
npm run check
```
