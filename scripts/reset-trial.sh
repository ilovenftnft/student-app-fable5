#!/usr/bin/env bash
# 重置试用库并重启试用服务（家长 2026-09-02：每次改完都重置）。
#   npm run trial:reset          清空会话类数据，保留内容与 content_start，重启 8788
# 环境：TRIAL_DIR（默认 ./data-trial）、TRIAL_PORT（默认 8788）
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="${TRIAL_DIR:-./data-trial}"; PORT="${TRIAL_PORT:-8788}"
RUN="$DIR/run"; mkdir -p "$RUN"; PIDFILE="$RUN/server.pid"; LOG="$RUN/server.log"
if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then kill "$(cat "$PIDFILE")"; for _ in $(seq 1 10); do kill -0 "$(cat "$PIDFILE")" 2>/dev/null || break; sleep 0.5; done; fi
rm -f "$PIDFILE"
sqlite3 "$DIR/app.db" "begin; delete from review; delete from card_state; delete from explanation; delete from reflection; delete from recall; delete from checkin; delete from session; delete from setting where key <> 'content_start'; commit; pragma wal_checkpoint(truncate);"
DATA_DIR="$DIR" PORT="$PORT" INBOX=off nohup node src/server/index.ts >> "$LOG" 2>&1 &
echo $! > "$PIDFILE"
for _ in $(seq 1 20); do
  if curl -s --noproxy '*' -m 2 "http://127.0.0.1:$PORT/api/health" | grep -q '"ok":true'; then echo "试用已重置并启动 pid $(cat "$PIDFILE")，http://127.0.0.1:$PORT"; exit 0; fi
  sleep 0.5
done
echo "探测失败，看日志：$LOG"; tail -20 "$LOG"; exit 1
