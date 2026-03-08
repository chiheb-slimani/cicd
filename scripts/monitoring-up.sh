#!/bin/sh
set -eu

MONITORING_NETWORK="${MONITORING_NETWORK:-cicd-monitoring}"
PROMETHEUS_IMAGE="${PROMETHEUS_IMAGE:-cicd/prometheus-cicd:latest}"
GRAFANA_IMAGE="${GRAFANA_IMAGE:-cicd/grafana-cicd:latest}"
CADVISOR_IMAGE="${CADVISOR_IMAGE:-gcr.io/cadvisor/cadvisor:v0.49.1}"

APP_CONTAINER_NAME="${APP_CONTAINER_NAME:-cicd-nextjs-live}"
APP_IMAGE="${APP_IMAGE:-cicd-nextjs:local}"
APP_PORT="${APP_PORT:-3002}"

GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-admin123}"

echo "[monitoring] ensuring network and volumes"
docker network inspect "$MONITORING_NETWORK" >/dev/null 2>&1 || docker network create "$MONITORING_NETWORK" >/dev/null
docker volume create prometheus_data >/dev/null
docker volume create grafana_data >/dev/null

echo "[monitoring] building prometheus and grafana images"
docker build -t "$PROMETHEUS_IMAGE" -f monitoring/prometheus/Dockerfile monitoring/prometheus
docker build -t "$GRAFANA_IMAGE" -f monitoring/grafana/Dockerfile monitoring/grafana

echo "[monitoring] replacing monitoring containers"
docker rm -f cadvisor-cicd >/dev/null 2>&1 || true
docker rm -f prometheus-cicd >/dev/null 2>&1 || true
docker rm -f grafana-cicd >/dev/null 2>&1 || true

echo "[monitoring] replacing application container if image exists"
if docker image inspect "$APP_IMAGE" >/dev/null 2>&1; then
  docker rm -f "$APP_CONTAINER_NAME" >/dev/null 2>&1 || true
  docker run -d \
    --name "$APP_CONTAINER_NAME" \
    --restart unless-stopped \
    --network "$MONITORING_NETWORK" \
    -p "${APP_PORT}:3000" \
    "$APP_IMAGE" >/dev/null
else
  echo "[monitoring] WARN: app image '$APP_IMAGE' not found; skipping app container deploy"
fi

docker run -d \
  --name cadvisor-cicd \
  --restart unless-stopped \
  --network "$MONITORING_NETWORK" \
  -p 8081:8080 \
  --privileged \
  -v /:/rootfs:ro \
  -v /var/run:/var/run:rw \
  -v /sys:/sys:ro \
  -v /var/lib/docker:/var/lib/docker:ro \
  "$CADVISOR_IMAGE" >/dev/null

docker run -d \
  --name prometheus-cicd \
  --restart unless-stopped \
  --network "$MONITORING_NETWORK" \
  -p 9090:9090 \
  -v prometheus_data:/prometheus \
  "$PROMETHEUS_IMAGE" >/dev/null

docker run -d \
  --name grafana-cicd \
  --restart unless-stopped \
  --network "$MONITORING_NETWORK" \
  -p 3000:3000 \
  -v grafana_data:/var/lib/grafana \
  -e "GF_SECURITY_ADMIN_USER=$GRAFANA_ADMIN_USER" \
  -e "GF_SECURITY_ADMIN_PASSWORD=$GRAFANA_ADMIN_PASSWORD" \
  "$GRAFANA_IMAGE" >/dev/null

echo "[monitoring] stack is up"
docker ps --filter "name=cicd-nextjs-live" --filter "name=prometheus-cicd" --filter "name=grafana-cicd" --filter "name=cadvisor-cicd"
