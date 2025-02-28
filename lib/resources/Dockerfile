FROM docker.io/continuumio/miniconda3:25.1.1-2

ARG NEXTFLOW_PLUGINS
ARG SOFTWARE_GIT_REPO
ARG SOFTWARE_GIT_BRANCH

# Configure Conda
RUN \
  echo '\
solver: libmamba\n\
channels:\n\
  - conda-forge\n\
  - bioconda\n\
  - defaults\n\
' > ~/.condarc

# Install dependencies
RUN \
  conda install -y \
    'awscli=2.24.12' \
    'jq=1.7.1' \
    'nextflow=24.10.4' \
    'openjdk=17.0.10' && \
  conda clean -yaf

# Install plugins for offline usage
RUN nextflow plugin install ${NEXTFLOW_PLUGINS}

# Install oncoanalyser and config template
RUN \
  git clone -b ${SOFTWARE_GIT_BRANCH} ${SOFTWARE_GIT_REPO} /root/pipeline/software/oncoanalyser/

COPY nextflow_aws.template.config /root/pipeline/other/

COPY run.sh /root/pipeline/other/

WORKDIR /root/pipeline/
