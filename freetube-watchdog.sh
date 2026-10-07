#!/usr/bin/env bash
# Keep the FreeTube program service alive (mini-services/freetube-service).
# Started detached; checks every 30s; revives on port/health failure.
#
# 2026-10-07: RSS guard added — the long-running freetube service was
# observed leaking to 1.5GB+ after ~10h, which starved the 3.9GB box and
# cascaded into OOM kills (the "box randomly resets" symptom). Above the
# limit the service is restarted (it re-hydrates from its own cache; the
# browser tab just reconnects), with a cooldown so a leak spike can never
# become a restart storm.
cd /home/z/my-project/mini-services/freetube-service

RSS_LIMIT_KB=750000   # 750MB — healthy RSS is ~250-450MB; the leak grows
                      # ~100MB/hour, so the restart fires at most a few
                      # times a day even in the worst case
COOLDOWN_FILE=/home/z/veil-freetube-cooldown
COOLDOWN_S=900        # 15 min between RSS restarts

ft_pid() { ss -tlnp 2>/dev/null | rg ':3031 ' | rg -o 'pid=[0-9]+' | head -1 | cut -d= -f2; }

while true; do
  PID="$(ft_pid)"
  if [ -n "$PID" ]; then
    RSS=$(awk '/VmRSS/{print $2}' /proc/$PID/status 2>/dev/null)
    if [ -n "$RSS" ] && [ "$RSS" -gt "$RSS_LIMIT_KB" ]; then
      NOW=$(date +%s)
      LAST=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo 0)
      if [ $((NOW - LAST)) -ge $COOLDOWN_S ]; then
        echo "$(date -u +%FT%TZ) watchdog: RSS ${RSS}KB > ${RSS_LIMIT_KB}KB — restarting freetube-service" >> service.log
        echo "$NOW" > "$COOLDOWN_FILE"
        kill "$PID" 2>/dev/null
        sleep 3
        pkill -f "mini-services/freetube-service" 2>/dev/null
        sleep 2
        (setsid nohup bun run dev >> service.log 2>&1 < /dev/null &)
        sleep 20
      fi
    fi
  fi
  if ! curl -s -m 5 http://localhost:3031/healthz | rg -q '"ok":true'; then
    # port free = truly dead (not just slow) -> revive
    if ! ss -tln 2>/dev/null | rg -q ':3031 '; then
      echo "$(date -u +%FT%TZ) watchdog: starting freetube-service" >> service.log
      (setsid nohup bun run dev >> service.log 2>&1 < /dev/null &)
      sleep 20   # give the program time to boot before the next check
    fi
  fi
  sleep 30
done
