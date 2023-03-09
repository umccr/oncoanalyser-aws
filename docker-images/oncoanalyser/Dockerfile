FROM docker.io/continuumio/miniconda3:22.11.1

RUN \
  conda install conda-libmamba-solver

RUN \
  echo > ~/.condarc '\
solver: libmamba\n\
channels:\n\
  - conda-forge\n\
  - bioconda\n\
  - defaults'

RUN \
  conda install \
    jq \
    'nextflow == 22.10.6' \
    parallel \
    rclone \
    unzip

RUN \
  wget -q 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip' && \
    unzip awscli-exe-linux-x86_64.zip && \
    ./aws/install && \
    rm -r aws/ awscli-exe-linux-x86_64.zip

RUN \
  wget -q -P /usr/bin/ 'https://stratus-documentation-us-east-1-public.s3.amazonaws.com/cli/1.2.0/linux/ica' && \
  chmod 755 /usr/bin/ica
COPY assets/ica_config.yaml /root/.ica/config.yaml

RUN \
  mkdir -p docker_install_temp/ && \
  parallel -j0 'wget -q -P docker_install_temp/ 'https://download.docker.com/linux/debian/dists/bullseye/pool/stable/amd64/{}'' ::: \
    containerd.io_1.6.18-1_amd64.deb \
    docker-ce_23.0.1-1~debian.11~bullseye_amd64.deb \
    docker-ce-cli_23.0.1-1~debian.11~bullseye_amd64.deb \
    docker-buildx-plugin_0.10.2-1~debian.11~bullseye_amd64.deb \
    docker-compose-plugin_2.16.0-1~debian.11~bullseye_amd64.deb

RUN \
  apt-get update && \
  apt-get install -y ./docker_install_temp/*deb && \
  rm -rf docker_install_temp/

RUN \
  mkdir -p /root/oncoanalyser/

RUN \
  git clone github.com/scwatts/oncoanalyser /root/oncoanalyser/software/oncoanalyser/ -b umccr

COPY assets/nextflow_aws.config /root/oncoanalyser/assets/
COPY assets/run.sh /root/oncoanalyser/assets/

WORKDIR /root/oncoanalyser/

# Required for non-interactive shell execution i.e. docker run <image>:<tag> nextflow
ENV JAVA_HOME="/opt/conda/"
