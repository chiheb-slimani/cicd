#!/bin/sh
set -eu

MONITORING_NETWORK="${MONITORING_NETWORK:-cicd-monitoring}"
SONAR_CONTAINER_NAME="${SONAR_CONTAINER_NAME:-sonarqube-cicd}"
SONAR_IMAGE="${SONAR_IMAGE:-sonarqube:lts-community}"

echo "[sonarqube] ensuring network and volumes"
docker network inspect "$MONITORING_NETWORK" >/dev/null 2>&1 || docker network create "$MONITORING_NETWORK" >/dev/null
docker volume create sonarqube_data >/dev/null
docker volume create sonarqube_logs >/dev/null
docker volume create sonarqube_extensions >/dev/null

if docker inspect "$SONAR_CONTAINER_NAME" >/dev/null 2>&1; then
  docker start "$SONAR_CONTAINER_NAME" >/dev/null 2>&1 || true
  docker network connect "$MONITORING_NETWORK" "$SONAR_CONTAINER_NAME" >/dev/null 2>&1 || true
else
  docker run -d \
    --name "$SONAR_CONTAINER_NAME" \
    --restart unless-stopped \
    --network "$MONITORING_NETWORK" \
    -p 9000:9000 \
    -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true \
    -v sonarqube_data:/opt/sonarqube/data \
    -v sonarqube_logs:/opt/sonarqube/logs \
    -v sonarqube_extensions:/opt/sonarqube/extensions \
    "$SONAR_IMAGE" >/dev/null
fi

echo "[sonarqube] waiting for API readiness"
i=0
while [ "$i" -lt 180 ]; do
  if docker run --rm --network "$MONITORING_NETWORK" curlimages/curl:8.12.1 -fsS "http://${SONAR_CONTAINER_NAME}:9000/api/system/status" | grep -q '"status":"UP"'; then
    echo "[sonarqube] ready"
    exit 0
  fi
  i=$((i + 1))
  sleep 5
done

echo "[sonarqube] ERROR: SonarQube did not become ready in time"
exit 1
