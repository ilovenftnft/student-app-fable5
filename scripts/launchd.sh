#!/usr/bin/env bash
# 孩子电脑：开机自启（launchd）。在仓库目录里跑：
#   bash scripts/launchd.sh          安装或更新：停旧的 → build → 按本机路径生成 plist → 加载 → 探测
#   bash scripts/launchd.sh stop     卸载（不再开机自启）
# 路径不用手改：仓库路径取脚本所在位置，node 取 `command -v node`。以后 git pull 之后再跑一次本脚本即可。
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
NODE="$(command -v node)"
PORT="${PORT:-8787}"
PLIST="$HOME/Library/LaunchAgents/com.studyapp.server.plist"
LABEL="com.studyapp.server"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
bash scripts/deploy.sh stop 2>/dev/null || true          # 手动 npm run deploy 起的那份也停掉，端口只留一份
if [[ "${1:-}" == "stop" ]]; then rm -f "$PLIST"; echo "已卸载开机自启"; exit 0; fi

npm run build --silent
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/data/run"
sed -e "s#/PATH/TO/student-app#$ROOT#g" -e "s#/usr/local/bin/node#$NODE#g" scripts/com.studyapp.server.plist.example > "$PLIST"
launchctl bootstrap "gui/$(id -u)" "$PLIST"
for _ in $(seq 1 20); do
  if curl -s --noproxy '*' -m 2 "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":true'; then
    echo "已加载开机自启：$PLIST"; echo "node $NODE"; echo "http://127.0.0.1:$PORT  日志 $ROOT/data/run/server.log"; exit 0
  fi
  sleep 0.5
done
echo "探测失败，看日志：$ROOT/data/run/server.log"; tail -20 "$ROOT/data/run/server.log"; exit 1
