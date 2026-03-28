#!/usr/bin/env bash
set -euo pipefail

ROOT="/data/白域/StarT"
APP_DIR="$ROOT/mobile/tauri"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "MiniStar iOS 打包必须在 macOS 上执行。"
  echo "当前系统: $(uname -s)"
  exit 1
fi

cd "$APP_DIR"

if [[ ! -d node_modules ]]; then
  npm install
fi

if [[ ! -d src-tauri/gen/apple ]]; then
  cargo tauri ios init
fi

echo "MiniStar iOS shell 已准备好。"
echo "下一步："
echo "1. 先启动 StarT 后端和前端"
echo "2. 运行: npm run tauri:ios:dev"
echo "3. 如需真机安装，请在 Xcode 中选择你的 Apple Team 后运行"
