pipeline {
  agent any

  parameters {
    booleanParam(
      name: 'ENABLE_TRIVY_SCAN',
      defaultValue: true,
      description: 'Run containerized Trivy scan on the built Docker image.'
    )
    booleanParam(
      name: 'TRIVY_FAIL_ON_FINDINGS',
      defaultValue: false,
      description: 'Fail build when Trivy reports HIGH/CRITICAL findings.'
    )
    booleanParam(
      name: 'ENABLE_PACKAGE_ARTIFACT',
      defaultValue: true,
      description: 'Create npm package artifact (.tgz) and archive it in Jenkins.'
    )
    booleanParam(
      name: 'ENABLE_NEXUS_UPLOAD',
      defaultValue: false,
      description: 'Upload packaged artifact to Nexus (requires NEXUS_* env + nexus-creds).'
    )
    booleanParam(
      name: 'ENABLE_LOCAL_DEPLOY',
      defaultValue: true,
      description: 'Deploy built app image as local container (cicd-nextjs-live).'
    )
    booleanParam(
      name: 'ENABLE_MONITORING',
      defaultValue: true,
      description: 'Bring up Prometheus + Grafana + cAdvisor monitoring stack.'
    )
  }

  environment {
    GIT_REPO_URL = 'https://github.com/chiheb-slimani/cicd.git'
    GITHUB_CREDENTIALS_ID = 'github-token'
    DOCKERHUB_CREDENTIALS_ID = 'dockerhub-creds'
    NEXUS_CREDENTIALS_ID = 'nexus-creds'
    DOCKER_IMAGE = 'cicd-nextjs'
    TRIVY_IMAGE = 'aquasec/trivy:0.57.1'
    TRIVY_SEVERITY = 'HIGH,CRITICAL'
    APP_CONTAINER_NAME = 'cicd-nextjs-live'
    APP_DEPLOY_PORT = '3002'
    MONITORING_NETWORK = 'cicd-monitoring'
    PROMETHEUS_IMAGE = 'cicd/prometheus-cicd:latest'
    GRAFANA_IMAGE = 'cicd/grafana-cicd:latest'
    NEXUS_URL = ''
    NEXUS_REPOSITORY = ''
    GRAFANA_ADMIN_USER = 'admin'
    GRAFANA_ADMIN_PASSWORD = 'admin123'
  }

  options {
    timestamps()
  }

  stages {
    stage('Checkout') {
      steps {
        script {
          def branchesToTry = ['*/main', '*/master']
          def checkedOut = false

          for (branchSpec in branchesToTry) {
            if (checkedOut) {
              break
            }

            try {
              checkout([
                $class: 'GitSCM',
                branches: [[name: branchSpec]],
                userRemoteConfigs: [[
                  url: "${env.GIT_REPO_URL}",
                  credentialsId: "${env.GITHUB_CREDENTIALS_ID}"
                ]]
              ])
              checkedOut = true
            } catch (Exception ignored) {
              try {
                checkout([
                  $class: 'GitSCM',
                  branches: [[name: branchSpec]],
                  userRemoteConfigs: [[url: "${env.GIT_REPO_URL}"]]
                ])
                checkedOut = true
              } catch (Exception ignoredAgain) {
                // Continue trying next branch.
              }
            }
          }

          if (!checkedOut) {
            error('Checkout failed for both main and master branches.')
          }
        }
      }
    }

    stage('Install') {
      steps {
        script {
          if (isUnix()) {
            sh 'npm ci'
          } else {
            bat 'npm ci'
          }
        }
      }
    }

    stage('Lint') {
      steps {
        script {
          if (isUnix()) {
            sh 'npm run lint'
          } else {
            bat 'npm run lint'
          }
        }
      }
    }

    stage('Test') {
      steps {
        script {
          if (isUnix()) {
            sh 'npm test'
          } else {
            bat 'npm test'
          }
        }
      }
    }

    stage('Build') {
      steps {
        script {
          if (isUnix()) {
            sh 'npm run build'
          } else {
            bat 'npm run build'
          }
        }
      }
    }

    stage('Docker Build') {
      steps {
        script {
          if (isUnix()) {
            sh '''
docker version
docker build -t ${DOCKER_IMAGE}:${BUILD_NUMBER} .
'''
          } else {
            bat '''
@echo off
where docker-machine >NUL 2>&1 || (echo docker-machine is required for Docker Toolbox && exit /b 1)
for /f "tokens=*" %%i in ('docker-machine env --shell cmd default') do @%%i
docker version
docker build -t %DOCKER_IMAGE%:%BUILD_NUMBER% .
'''
          }
        }
      }
    }

    stage('Trivy Image Scan') {
      when {
        expression {
          return params.ENABLE_TRIVY_SCAN
        }
      }
      steps {
        script {
          if (isUnix()) {
            withEnv(["TRIVY_FAIL_ON_FINDINGS=${params.TRIVY_FAIL_ON_FINDINGS}"]) {
              sh '''
set +e
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ${TRIVY_IMAGE} image \
  --no-progress \
  --severity ${TRIVY_SEVERITY} \
  --ignore-unfixed \
  --exit-code 1 \
  ${DOCKER_IMAGE}:${BUILD_NUMBER}
TRIVY_EXIT=$?
set -e

if [ "$TRIVY_EXIT" -ne 0 ]; then
  if [ "$TRIVY_FAIL_ON_FINDINGS" = "true" ]; then
    echo "Trivy found vulnerabilities and TRIVY_FAIL_ON_FINDINGS=true."
    exit "$TRIVY_EXIT"
  fi
  echo "Trivy found vulnerabilities but build continues (TRIVY_FAIL_ON_FINDINGS=false)."
fi
'''
            }
          } else {
            echo 'Trivy scan stage is configured for Unix Jenkins agents and was skipped on Windows.'
          }
        }
      }
    }

    stage('Package Artifact') {
      when {
        expression {
          return params.ENABLE_PACKAGE_ARTIFACT
        }
      }
      steps {
        script {
          if (isUnix()) {
            sh '''
rm -rf dist-artifacts
mkdir -p dist-artifacts
npm pack --pack-destination dist-artifacts
'''
          } else {
            bat '''
@echo off
if exist dist-artifacts rmdir /s /q dist-artifacts
mkdir dist-artifacts
npm pack --pack-destination dist-artifacts
'''
          }
        }
        archiveArtifacts artifacts: 'dist-artifacts/*.tgz', fingerprint: true
      }
    }

    stage('Nexus Upload (Optional)') {
      when {
        allOf {
          expression {
            return params.ENABLE_NEXUS_UPLOAD
          }
          branch 'main'
        }
      }
      steps {
        catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
          withCredentials([
            usernamePassword(
              credentialsId: "${env.NEXUS_CREDENTIALS_ID}",
              usernameVariable: 'NEXUS_USER',
              passwordVariable: 'NEXUS_PASS'
            )
          ]) {
            script {
              if (isUnix()) {
                sh '''
set -eu
if [ -z "${NEXUS_URL}" ] || [ -z "${NEXUS_REPOSITORY}" ]; then
  echo "NEXUS_URL and NEXUS_REPOSITORY must be configured in Jenkins environment."
  exit 1
fi

ARTIFACT_PATH="$(ls -1 dist-artifacts/*.tgz | head -n 1)"
ARTIFACT_NAME="$(basename "$ARTIFACT_PATH")"
UPLOAD_URL="${NEXUS_URL%/}/repository/${NEXUS_REPOSITORY}/${ARTIFACT_NAME}"

curl -fsS -u "${NEXUS_USER}:${NEXUS_PASS}" --upload-file "$ARTIFACT_PATH" "$UPLOAD_URL"
echo "Uploaded $ARTIFACT_NAME to $UPLOAD_URL"
'''
              } else {
                echo 'Nexus upload stage is configured for Unix Jenkins agents and was skipped on Windows.'
              }
            }
          }
        }
      }
    }

    stage('Docker Push') {
      when {
        allOf {
          branch 'main'
          expression {
            return env.ENABLE_DOCKER_PUSH == 'true'
          }
        }
      }
      steps {
        withCredentials([
          usernamePassword(
            credentialsId: "${env.DOCKERHUB_CREDENTIALS_ID}",
            usernameVariable: 'DOCKER_USER',
            passwordVariable: 'DOCKER_PASS'
          )
        ]) {
          script {
            if (isUnix()) {
              sh '''
IMAGE=${DOCKER_USER}/${DOCKER_IMAGE}
echo "${DOCKER_PASS}" | docker login -u "${DOCKER_USER}" --password-stdin
docker tag ${DOCKER_IMAGE}:${BUILD_NUMBER} ${IMAGE}:${BUILD_NUMBER}
docker tag ${DOCKER_IMAGE}:${BUILD_NUMBER} ${IMAGE}:latest
docker push ${IMAGE}:${BUILD_NUMBER}
docker push ${IMAGE}:latest
docker logout
'''
            } else {
              bat '''
@echo off
for /f "tokens=*" %%i in ('docker-machine env --shell cmd default') do @%%i
set IMAGE=%DOCKER_USER%/%DOCKER_IMAGE%
echo %DOCKER_PASS%| docker login -u %DOCKER_USER% --password-stdin
docker tag %DOCKER_IMAGE%:%BUILD_NUMBER% %IMAGE%:%BUILD_NUMBER%
docker tag %DOCKER_IMAGE%:%BUILD_NUMBER% %IMAGE%:latest
docker push %IMAGE%:%BUILD_NUMBER%
docker push %IMAGE%:latest
docker logout
'''
            }
          }
        }
      }
    }

    stage('Deploy Local Container') {
      when {
        expression {
          return params.ENABLE_LOCAL_DEPLOY
        }
      }
      steps {
        catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
          script {
            if (isUnix()) {
              sh '''
set -eu
docker rm -f ${APP_CONTAINER_NAME} >/dev/null 2>&1 || true
if docker network inspect ${MONITORING_NETWORK} >/dev/null 2>&1; then
  NET_ARGS="--network ${MONITORING_NETWORK}"
else
  NET_ARGS=""
fi

docker run -d \
  --name ${APP_CONTAINER_NAME} \
  --restart unless-stopped \
  ${NET_ARGS} \
  -p ${APP_DEPLOY_PORT}:3000 \
  ${DOCKER_IMAGE}:${BUILD_NUMBER}
'''
            } else {
              echo 'Deploy local container stage is configured for Unix Jenkins agents and was skipped on Windows.'
            }
          }
        }
      }
    }

    stage('Monitoring Stack Up') {
      when {
        expression {
          return params.ENABLE_MONITORING
        }
      }
      steps {
        catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
          script {
            if (isUnix()) {
              withEnv(["APP_IMAGE=${DOCKER_IMAGE}:${BUILD_NUMBER}"]) {
                sh 'sh scripts/monitoring-up.sh'
              }
            } else {
              echo 'Monitoring stack stage is configured for Unix Jenkins agents and was skipped on Windows.'
            }
          }
        }
      }
    }

    stage('Monitoring Health Check') {
      when {
        expression {
          return params.ENABLE_MONITORING
        }
      }
      steps {
        catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
          script {
            if (isUnix()) {
              sh 'sh scripts/monitoring-health.sh'
            } else {
              echo 'Monitoring health check stage is configured for Unix Jenkins agents and was skipped on Windows.'
            }
          }
        }
      }
    }
  }

  post {
    always {
      deleteDir()
    }
  }
}
