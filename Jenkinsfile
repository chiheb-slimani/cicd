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
          try {
            checkout([
              $class: 'GitSCM',
              branches: [[name: '*/main']],
              userRemoteConfigs: [[
                url: "${env.GIT_REPO_URL}",
                credentialsId: "${env.GITHUB_CREDENTIALS_ID}"
              ]]
            ])
          } catch (Exception ignored) {
            checkout([
              $class: 'GitSCM',
              branches: [[name: '*/main']],
              userRemoteConfigs: [[url: "${env.GIT_REPO_URL}"]]
            ])
          }
        }
      }
    }

    stage('Install') {
      steps {
        bat 'npm ci'
      }
    }

    stage('Lint') {
      steps {
        bat 'npm run lint'
      }
    }

    stage('Test') {
      steps {
        bat 'npm test'
      }
    }

    stage('Build') {
      steps {
        bat 'npm run build'
      }
    }

    stage('Docker Build') {
      steps {
        bat '''
@echo off
where docker-machine >NUL 2>&1 || (echo docker-machine is required for Docker Toolbox && exit /b 1)
for /f "tokens=*" %%i in ('docker-machine env --shell cmd default') do @%%i
docker version
docker build -t %DOCKER_IMAGE%:%BUILD_NUMBER% .
'''
      }
    }

    stage('Docker Push') {
      when {
        branch 'main'
      }
      steps {
        withCredentials([
          usernamePassword(
            credentialsId: "${env.DOCKERHUB_CREDENTIALS_ID}",
            usernameVariable: 'DOCKER_USER',
            passwordVariable: 'DOCKER_PASS'
          )
        ]) {
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

  post {
    always {
      deleteDir()
    }
  }
}
