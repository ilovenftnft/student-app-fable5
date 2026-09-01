#!/usr/bin/env bash
# 部署：停 → build → 起 → 探测。唯一允许的上线方式（AGENTS.md）；不要单独 npm run build 换掉运行中的产物。
#   npm run deploy          正常部署
#   npm run deploy stop     只停
# 环境：PORT（默认 8787）、DATA_DIR（默认 ./data）。日志与 pid 在 $DATA_DIR/run/。
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-8787}"
DATA_DIR="${DATA_DIR:-./data}"
RUN="$DATA_DIR/run"; mkdir -p "$RUN"
PIDFILE="$RUN/server.pid"; LOG="$RUN/server.log"

stop() {
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill "$(cat "$PIDFILE")"; for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$(cat "$PIDFILE")" 2>/dev/null || break; sleep 0.5; done
    echo "已停止 $(cat "$PIDFILE")"
  fi
  rm -f "$PIDFILE"
}

if [[ "${1:-}" == "stop" ]]; then stop; exit 0; fi

stop
npm run build --silent
DATA_DIR="$DATA_DIR" PORT="$PORT" nohup node src/server/index.ts >> "$LOG" 2>&1 &
echo $! > "$PIDFILE"
for _ in $(seq 1 20); do
  if curl -s --noproxy '*' -m 2 "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":true'; then
    echo "已启动 pid $(cat "$PIDFILE")，http://127.0.0.1:$PORT  日志 $LOG"; exit 0
  fi
  sleep 0.5
done
echo "探测失败，看日志：$LOG"; tail -20 "$LOG"; exit 1
