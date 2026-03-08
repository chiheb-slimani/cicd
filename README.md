# CI/CD Next.js Project

Production-ready Next.js repository with an extended Jenkins CI/CD pipeline.

Beginner walkthrough:

- `BEGINNER_GUIDE.md`

## What The Pipeline Runs

Core stages (always):

1. Checkout
2. Install (`npm ci`)
3. Lint
4. Test
5. Build
6. Docker Build
7. Docker Push (optional on `main` when `ENABLE_DOCKER_PUSH=true`)

Extended stages (parameter-driven, containerized):

1. Trivy image scan
2. SonarQube server up + code analysis
3. Package artifact (`npm pack`)
4. Optional Nexus upload
5. Local deploy container
6. Monitoring stack up (Prometheus + Grafana + cAdvisor)
7. Monitoring health checks

No Ansible is used.

## Local Setup

```bash
npm install
npm run lint
npm test
npm run build
```

Run app:

```bash
npm run dev
```

Prometheus endpoint (app metrics):

```text
/api/metrics
```

## Docker

Build app image:

```bash
docker build -t cicd-nextjs:local .
```

Run app image:

```bash
docker run -p 3000:3000 cicd-nextjs:local
```

## Monitoring Stack

Monitoring assets:

- `monitoring/prometheus/*`
- `monitoring/grafana/*`
- `scripts/monitoring-up.sh`
- `scripts/monitoring-health.sh`

Default scrape targets in Prometheus:

- Prometheus itself
- cAdvisor (container metrics)
- Next.js app (`/api/metrics`)

Jenkins metrics scrape can be enabled later with authenticated Prometheus config if you want to include `/prometheus`.

Bring up stack manually (Docker host / Docker Toolbox VM):

```bash
sh scripts/monitoring-up.sh
sh scripts/monitoring-health.sh
```

Default ports:

- Grafana: `3000`
- Prometheus: `9090`
- cAdvisor: `8081`
- deployed app container: `3002` (container port `3000`)

Default Grafana credentials (change in Jenkins/env for production):

- user: `admin`
- password: `admin123`

## Nexus + SonarQube Bootstrap

Automatic local setup script:

```bash
node scripts/setup-nexus-sonar.js
```

What it does:

- starts `nexus-cicd` container on port `8082`
- starts `sonarqube-cicd` container on port `9000`
- creates Nexus raw repo `cicd-artifacts`
- syncs Jenkins credentials:
  - `nexus-creds`
  - `sonarqube-token`
- generates local secret file `nexus.txt` (ignored by git)

## Jenkins Pipeline

Pipeline file:

- `Jenkinsfile`

### Jenkins Tools Required

- Git
- Node.js 20.x + npm
- Docker CLI (inside Jenkins container with mounted Docker socket)
- Docker Toolbox machine `default` on host

### Jenkins Plugins Required

- Pipeline
- Git
- Credentials
- Credentials Binding
- Pipeline Stage View
- Pipeline Graph View
- Prometheus (for `/prometheus` endpoint)

Install helper script:

- `node scripts/install-jenkins-plugins.js`

### Jenkins Credentials Required

1. `github-token` (GitHub token or username/password credential)
2. `dockerhub-creds` (Docker Hub username/password)
3. `nexus-creds` (optional; only if Nexus upload is enabled)
4. `sonarqube-token` (optional; used by SonarQube analysis stage)

### Jenkins Runtime Context (Docker Toolbox)

Docker must run through Docker Toolbox VM (`default`) on this laptop.
For Docker Toolbox engine `19.x`, SonarQube requires `--security-opt seccomp=unconfined` (already handled by project scripts).

### Jenkins In Container (No Local Jenkins Install)

```bash
docker run -d --name jenkins-cicd --restart unless-stopped --security-opt seccomp=unconfined -u root -e JAVA_OPTS="-Xms256m -Xmx1024m" -v jenkins_home:/var/jenkins_home -v /var/run/docker.sock:/var/run/docker.sock -p 8080:8080 -p 50000:50000 jenkins/jenkins:lts-jdk17
```

## Security

Sensitive local files are ignored and must never be committed:

- `token`
- `token.txt`
- `docker.txt`
- `jenkins.txt`
- `nexus.txt`
- `sonar.txt`
- `.env*`

Also protected by `.dockerignore` so secrets are not sent to Docker build context.
