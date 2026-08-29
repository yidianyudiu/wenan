#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "未检测到 Node.js 20 或更高版本。"; read -r; exit 1; fi
mkdir -p logs
export WORKBENCH_HOST=127.0.0.1 WORKBENCH_PORT=4310 OPEN_BROWSER=1
node server.mjs >>logs/workbench.log 2>&1
