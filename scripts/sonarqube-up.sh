#!/bin/sh
set -eu

MONITORING_NETWORK="${MONITORING_NETWORK:-cicd-monitoring}"
SONAR_CONTAINER_NAME="${SONAR_CONTAINER_NAME:-sonarqube-cicd}"
SONAR_IMAGE="${SONAR_IMAGE:-sonarqube:lts-community}"
SONAR_WAIT_SECONDS="${SONAR_WAIT_SECONDS:-180}"
POLL_SECONDS="${POLL_SECONDS:-5}"

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
    --security-opt seccomp=unconfined \
    -p 9000:9000 \
    -e SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true \
    -v sonarqube_data:/opt/sonarqube/data \
    -v sonarqube_logs:/opt/sonarqube/logs \
    -v sonarqube_extensions:/opt/sonarqube/extensions \
    "$SONAR_IMAGE" >/dev/null
fi

echo "[sonarqube] waiting for API readiness"
max_tries=$((SONAR_WAIT_SECONDS / POLL_SECONDS))
if [ "$max_tries" -lt 1 ]; then
  max_tries=1
fi

i=0
while [ "$i" -lt "$max_tries" ]; do
  if ! docker ps --format '{{.Names}}' | grep -qx "$SONAR_CONTAINER_NAME"; then
    echo "[sonarqube] ERROR: container is not running"
    docker logs --tail 40 "$SONAR_CONTAINER_NAME" 2>/dev/null || true
    exit 1
  fi

  if docker run --rm --network "$MONITORING_NETWORK" curlimages/curl:8.12.1 -fsS "http://${SONAR_CONTAINER_NAME}:9000/api/system/status" | grep -q '"status":"UP"'; then
    echo "[sonarqube] ready"
    exit 0
  fi
  i=$((i + 1))
  sleep "$POLL_SECONDS"
done

echo "[sonarqube] ERROR: SonarQube did not become ready in ${SONAR_WAIT_SECONDS}s"
exit 1
