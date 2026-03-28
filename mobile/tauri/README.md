# MiniStar iOS Shell

`MiniStar` is the mobile shell for the StarT chat-only experience.

This project is meant to package [mobile.html](/data/白域/StarT/chat/mobile.html) as a Tauri iOS app.

## What this directory does

- uses the existing StarT frontend in `/data/白域/StarT/chat`
- opens `mobile.html`
- keeps desktop and mobile shells separated

## Important limit

You cannot build an iPhone `.ipa` on this Linux machine.

To actually install on iPhone, move this repository to a Mac with:

- Xcode
- iOS Simulator or a signed physical iPhone
- Rust + Node
- Tauri CLI

## Minimal flow on Mac

```bash
cd /data/白域/StarT/mobile/tauri
npm install
cargo tauri ios init
START_DATA_DIR=/data/白域/heois bash /data/白域/StarT/launchers/start.sh
npm run tauri:ios:dev
```

For a physical iPhone, open the generated Xcode project after `cargo tauri ios init`, pick your Apple Team, then run on device.
