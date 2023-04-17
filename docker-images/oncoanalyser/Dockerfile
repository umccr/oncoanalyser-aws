FROM docker.io/continuumio/miniconda3:22.11.1

# SOFTWARE VERSIONS
ARG NEXTFLOW_VERSION="22.10.6"
ARG DEBIAN_PLATFORM_VERSION="debian.11~bullseye_amd64"
ARG CONTAINERD_IO_VERSION="1.6.18-1"
ARG DOCKER_CE_VERSION="23.0.1-1"
ARG DOCKER_CE_CLI_VERSION="23.0.1-1"
ARG DOCKER_BUILDX_VERSION="0.10.2-1"
ARG DOCKER_COMPOSE_VERSION="2.16.0-1"

# ONCOANALYSER SOFTWARE PATH
ARG ONCOANALYSER_GITHUB_REPO_URL="https://github.com/scwatts/oncoanalyser.git"
ARG ONCOANALYSER_GITHUB_BRANCH_NAME="umccr"

# Run apt updates
RUN \
  apt update -y -q

# Set conda settings
RUN \
  conda install conda-libmamba-solver && \
  echo > ~/.condarc '\
solver: libmamba\n\
channels:\n\
  - conda-forge\n\
  - bioconda\n\
  - defaults\n\
'

# Install conda deps
RUN \
  conda install \
    jq \
    nextflow=="$NEXTFLOW_VERSION" \
    parallel \
    rclone \
    unzip

# Install aws cli
RUN \
  wget --quiet 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip' \
    --output-document "awscli.zip" && \
    unzip -qq "awscli.zip" && \
    ./aws/install && \
    rm -rf aws/ "awscli.zip"

# Install docker-through-docker
RUN \
  mkdir -p docker_install_temp/ && \
  ( \
    cd "docker_install_temp/" && \
    parallel -j0 'wget -q -P docker_install_temp/ 'https://download.docker.com/linux/debian/dists/bullseye/pool/stable/amd64/{}'' ::: \
      "containerd.io_$CONTAINERD_IO_VERSION_amd64.deb" \
      "docker-ce_$DOCKER_CE_VERSION~$DEBIAN_PLATFORM_VERSION.deb" \
      "docker-ce-cli_$DOCKER_CE_CLI_VERSION~$DEBIAN_PLATFORM_VERSION.deb" \
      "docker-buildx-plugin_$DOCKER_BUILDX_VERSION~$DEBIAN_PLATFORM_VERSION.deb" \
      "docker-compose-plugin_$DOCKER_COMPOSE_VERSION~$DEBIAN_PLATFORM_VERSION.deb" && \
    apt install -y -q *.deb \
  ) && \
  rm -rf "docker_install_temp/"


RUN \
  mkdir -p "/root/oncoanalyser/software/" && \
  mkdir -p "/root/oncoanalyser/assets/" && \
  ( \
    cd "/root/oncoanalyser/software/" && \
    git clone --branch "$ONCOANALYSER_GITHUB_BRANCH_NAME" "$ONCOANALYSER_GITHUB_REPO_URL" \
  )

COPY assets/nextflow_aws.template.config /root/oncoanalyser/assets/
COPY assets/run.sh /root/oncoanalyser/assets/

RUN \
  chmod +x "/root/oncoanalyser/assets/run.sh"

WORKDIR /root/oncoanalyser/

# Required for non-interactive shell execution i.e. docker run <image>:<tag> nextflow
ENV JAVA_HOME="/opt/conda/"
