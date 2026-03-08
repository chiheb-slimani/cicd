pipeline {
  agent any

  environment {
    GIT_REPO_URL = 'https://github.com/chiheb-slimani/cicd.git'
    GITHUB_CREDENTIALS_ID = 'github-token'
    DOCKERHUB_CREDENTIALS_ID = 'dockerhub-creds'
    DOCKER_IMAGE = 'cicd-nextjs'
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
  }

  post {
    always {
      deleteDir()
    }
  }
}
