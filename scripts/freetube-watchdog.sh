#!/usr/bin/env bash
# Keep the FreeTube program service alive (mini-services/freetube-service).
# Started detached; checks every 30s; revives on port/health failure.
cd /home/z/my-project/mini-services/freetube-service
while true; do
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
