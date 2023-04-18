FROM docker.io/continuumio/miniconda3:22.11.1

# Set nextflow version
ARG NEXTFLOW_VERSION="22.10.6"
ARG NEXTFLOW_PATH="/opt/nextflow"

# Set jq version
ARG JQ_VERSION="1.6"
ARG RCLONE_VERSION="1.62.2"
ARG PARALLEL_VERSION="20230322"
ARG OPEN_JDK_VERSION="17.0.6"

# Set container versions
ARG DEBIAN_PLATFORM_VERSION="debian.11~bullseye_amd64"
ARG CONTAINERD_IO_VERSION="1.6.18-1"
ARG DOCKER_CE_VERSION="23.0.1-1"
ARG DOCKER_CE_CLI_VERSION="23.0.1-1"
ARG DOCKER_BUILDX_VERSION="0.10.2-1"
ARG DOCKER_COMPOSE_VERSION="2.16.0-1"

# ONCOANALYSER SOFTWARE PATH
ARG ONCOANALYSER_GITHUB_REPO_URL="https://github.com/scwatts/oncoanalyser.git"
# SOFTWARE VERSIONS
ARG ONCOANALYSER_GITHUB_BRANCH_NAME="umccr"

# Run apt updates
# Install unversioned software
RUN \
   apt update -y -q && \
   apt install -y -q \
     unzip \
     wget

# Run apt updates
RUN \
  apt update -y -q && \
  apt install -y \
    jq="${JQ_VERSION}*" \
    openjdk-17-jre="${OPEN_JDK_VERSION}*" && \
  apt clean -y -q

RUN \
  conda install --yes \
    conda-libmamba-solver && \
  echo '\
solver: libmamba\n\
channels:\n\
  - conda-forge\n\
  - bioconda\n\
  - defaults\n\
' > ~/.condarc

# Install nextflow
RUN \
  mkdir "${NEXTFLOW_PATH}" && \
  ( \
    cd "${NEXTFLOW_PATH}" && \
    wget --quiet --output-document - get.nextflow.io | \
    NXF_VER="${NEXTFLOW_VERSION}" bash \
  )

# Export path for nextflow cli
ENV PATH "${NEXTFLOW_PATH}:$PATH"

# Install aws cli
RUN \
  wget --quiet 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip' \
    --output-document "awscli.zip" && \
    unzip -qq "awscli.zip" && \
    ./aws/install && \
    rm -rf aws/ "awscli.zip"

# Install rclone and parallel via conda
# Need a later version of parallel to prevent escape of tilda characters in chunk below
# Debian rclone version is also quite old
RUN \
  conda install --yes \
    rclone="${RCLONE_VERSION}" \
    parallel="${PARALLEL_VERSION}"

# Install docker-through-docker
RUN \
  mkdir -p "docker_install_temp/" && \
  ( \
    cd "docker_install_temp/" && \
    parallel -j0 " \
        wget \
          --quiet \
          'https://download.docker.com/linux/debian/dists/bullseye/pool/stable/amd64/{}' \
      " ::: \
      "containerd.io_${CONTAINERD_IO_VERSION}_amd64.deb" \
      "docker-ce_${DOCKER_CE_VERSION}~${DEBIAN_PLATFORM_VERSION}.deb" \
      "docker-ce-cli_${DOCKER_CE_CLI_VERSION}~${DEBIAN_PLATFORM_VERSION}.deb" \
      "docker-buildx-plugin_${DOCKER_BUILDX_VERSION}~${DEBIAN_PLATFORM_VERSION}.deb" \
      "docker-compose-plugin_${DOCKER_COMPOSE_VERSION}~${DEBIAN_PLATFORM_VERSION}.deb" && \
    apt install -y -q $PWD/*.deb \
  ) && \
  rm -rf "docker_install_temp/" && \
  apt clean -y -q


RUN \
  mkdir -p "/root/oncoanalyser/software/" && \
  mkdir -p "/root/oncoanalyser/assets/" && \
  ( \
    cd "/root/oncoanalyser/software/" && \
    git clone --branch "${ONCOANALYSER_GITHUB_BRANCH_NAME}" "${ONCOANALYSER_GITHUB_REPO_URL}" \
  )

COPY assets/nextflow_aws.template.config /root/oncoanalyser/assets/
COPY assets/run.sh /root/oncoanalyser/assets/

RUN \
  chmod +x "/root/oncoanalyser/assets/run.sh"

WORKDIR /root/oncoanalyser/
