#!/bin/sh
set -eu

MONITORING_NETWORK="${MONITORING_NETWORK:-cicd-monitoring}"
APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-cicd-nextjs-live}"

for c in cadvisor-cicd prometheus-cicd grafana-cicd; do
  running="$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null || true)"
  if [ "$running" != "true" ]; then
    echo "[monitoring] ERROR: container '$c' is not running"
    exit 1
  fi
done

echo "[monitoring] checking endpoint health through monitoring network"
docker run --rm --network "$MONITORING_NETWORK" curlimages/curl:8.12.1 -fsS http://prometheus-cicd:9090/-/healthy >/dev/null
docker run --rm --network "$MONITORING_NETWORK" curlimages/curl:8.12.1 -fsS http://grafana-cicd:3000/api/health >/dev/null
docker run --rm --network "$MONITORING_NETWORK" curlimages/curl:8.12.1 -fsS http://cadvisor-cicd:8080/metrics >/dev/null

if docker inspect "$APP_CONTAINER_NAME" >/dev/null 2>&1; then
  docker run --rm --network "$MONITORING_NETWORK" curlimages/curl:8.12.1 -fsS http://"$APP_CONTAINER_NAME":3000/api/metrics >/dev/null
fi

echo "[monitoring] health checks passed"
