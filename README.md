# CI/CD Next.js Project

Production-ready Next.js repository with a Jenkins pipeline that runs:

- checkout
- npm install (`npm ci`)
- lint
- test
- build
- Docker image build
- Docker image push on `main`

Beginner walkthrough:

- `BEGINNER_GUIDE.md`

## Local Setup

```bash
npm install
npm run lint
npm test
npm run build
```

Run app locally:

```bash
npm run dev
```

## Test Stack

- Jest
- `@testing-library/react`
- `@testing-library/jest-dom`

Test file:

- `app/page.test.tsx`

## Docker

Build image:

```bash
docker build -t cicd-nextjs:local .
```

Run image:

```bash
docker run -p 3000:3000 cicd-nextjs:local
```

## Jenkins Pipeline

Pipeline file:

- `Jenkinsfile`

### Jenkins Tools Required

- Git
- Node.js 20.x + npm
- Docker Toolbox (`docker-machine`, Docker CLI)

### Jenkins Plugins Required

- Pipeline
- Git
- Credentials
- Credentials Binding

### Jenkins Credentials Required

Create these credentials in Jenkins:

1. `github-token` (Secret text or Username/Password for GitHub access)
2. `dockerhub-creds` (Username/Password for Docker Hub)

### Jenkins Runtime Context (Docker Toolbox)

Docker commands in the pipeline run with Docker Toolbox context via:

```bat
for /f "tokens=*" %%i in ('docker-machine env --shell cmd default') do @%%i
```

This is required because Docker is not expected to work in a default terminal context.

### Jenkins In Container (No Local Jenkins Install)

For Docker Toolbox environments, this profile worked in validation:

```bash
docker run -d --name jenkins-cicd --security-opt seccomp=unconfined -u root -e JAVA_OPTS="-Xms256m -Xmx1024m" -e JENKINS_HOME=/tmp/jenkins_home -p 8080:8080 -p 50000:50000 jenkins/jenkins:lts-jdk11
```

Notes:

- `jenkins/jenkins:lts-jdk17` failed in this Toolbox VM due runtime thread/resource constraints.
- `lts-jdk11` with `seccomp=unconfined` is the compatible fallback used here.

## Security

Sensitive local files are ignored and must never be committed:

- `token`
- `token.txt`
- `docker.txt`
- `.env*`

Also protected by `.dockerignore` to avoid sending secrets in Docker build context.
