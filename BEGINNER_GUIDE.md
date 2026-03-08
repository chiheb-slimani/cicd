# Beginner Guide: What Was Done

This file explains, in simple steps, what was changed in this project.

## 1) Project was converted to a real Next.js repo

The repository now has a real Next.js app at the root (not a nested git/submodule setup).

Main app files:

- `app/page.tsx`
- `app/layout.tsx`
- `package.json`
- `next.config.ts`

## 2) CI scripts now really work

The project scripts are configured so these commands work:

- `npm install`
- `npm run lint`
- `npm test`
- `npm run build`

## 3) Real test setup was added

Jest + Testing Library were configured:

- `jest.config.js`
- `jest.setup.ts`
- `app/page.test.tsx`

This means the pipeline has a real test stage, not a placeholder.

## 4) Docker support was implemented

Files:

- `Dockerfile` (multi-stage production build)
- `.dockerignore`

The app image builds and can run as a container.

## 5) Jenkins pipeline was added

File:

- `Jenkinsfile`

Pipeline stages:

1. Checkout
2. Install
3. Lint
4. Test
5. Build
6. Docker Build
7. Docker Push (on `main`)

## 6) Secrets were protected

The following are ignored by git and docker build context:

- `token`, `token.txt`
- `docker.txt`
- `.env*`

No secret files were committed.

## 7) What was validated

Validated successfully:

- `npm install`
- `npm run lint`
- `npm test`
- `npm run build`
- Docker image build in Docker Toolbox VM
- Running app container and checking HTTP response
- Running Jenkins in container (Docker Toolbox VM)

## 8) Container-only runtime (no local Jenkins install)

Jenkins can run in Docker Toolbox with:

```bash
docker run -d --name jenkins-cicd --restart unless-stopped --security-opt seccomp=unconfined -u root -e JAVA_OPTS="-Xms256m -Xmx1024m" -v jenkins_home:/var/jenkins_home -p 8080:8080 -p 50000:50000 jenkins/jenkins:lts-jdk17
```

Why this profile:

- Your plugins require Jenkins core `>= 2.479.3`.
- `lts-jdk17` gives a compatible core (validated on `2.541.2`).
- `seccomp=unconfined` helps compatibility with Docker Toolbox constraints.

## 9) If you want to rerun everything quickly

Use Docker Toolbox shell / VM context and run:

```bash
docker-machine ssh default sh -lc "rm -rf /tmp/cicd-ci && mkdir -p /tmp/cicd-ci && tar -C /c/Users/lenovo/Desktop/bootcamp/cicd -cf - . | tar -C /tmp/cicd-ci -xf - && docker run --rm -v /tmp/cicd-ci:/workspace -w /workspace node:20-alpine sh -lc 'npm ci && npm run lint && npm test && npm run build'"
```

## 10) Disk space safety (`D:` instead of `C:`)

To avoid filling `C:`, Docker Toolbox machine storage was configured on `D:`:

- `MACHINE_STORAGE_PATH` user env var set to `D:\docker-machine`
- `C:\Users\lenovo\.docker\machine` linked to `D:\docker-machine`

This keeps Docker machine files (including `disk.vmdk`, Jenkins data) on `D:` while keeping the same machine name (`default`) so the pipeline still works.

## 11) Pipeline was extended (inspired by enterprise flow, no Ansible)

The core working pipeline was kept, then extra stages were added safely:

- Trivy image security scan (containerized)
- Package artifact (`npm pack`)
- Optional Nexus upload
- Local deploy container stage
- Monitoring stack bring-up and health checks

Important: existing core stages were not removed.

## 12) Real monitoring was added (Prometheus + Grafana + cAdvisor)

Monitoring files added:

- `monitoring/prometheus/Dockerfile`
- `monitoring/prometheus/prometheus.yml`
- `monitoring/grafana/Dockerfile`
- `monitoring/grafana/provisioning/datasources/datasource.yml`
- `monitoring/grafana/provisioning/dashboards/dashboard.yml`
- `monitoring/grafana/dashboards/cicd-overview.json`
- `scripts/monitoring-up.sh`
- `scripts/monitoring-health.sh`

The app now exposes metrics at:

- `/api/metrics`

This is implemented with:

- `lib/metrics.ts`
- `app/api/metrics/route.ts`

## 13) How to run monitoring manually

From Docker host context (Docker Toolbox VM):

```bash
sh scripts/monitoring-up.sh
sh scripts/monitoring-health.sh
```

Default ports:

- Grafana: `3000`
- Prometheus: `9090`
- cAdvisor: `8081`
- App container (local deploy): `3002`

Default Grafana login:

- user: `admin`
- password: `admin123`

## 14) Jenkins parameters you can control per build

- `ENABLE_TRIVY_SCAN`
- `TRIVY_FAIL_ON_FINDINGS`
- `ENABLE_PACKAGE_ARTIFACT`
- `ENABLE_NEXUS_UPLOAD`
- `ENABLE_LOCAL_DEPLOY`
- `ENABLE_MONITORING`

This lets you enable/disable advanced stages without breaking the base CI flow.
