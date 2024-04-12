ARG UBUNTU_RELEASE=20.04
ARG GSTREAMER_BASE_IMAGE=ghcr.io/selkies-project/selkies-gstreamer/gstreamer
ARG GSTREAMER_BASE_IMAGE_RELEASE=v1.5.2
FROM ${GSTREAMER_BASE_IMAGE}:${GSTREAMER_BASE_IMAGE_RELEASE}-ubuntu${UBUNTU_RELEASE} as selkies-gstreamer
FROM ubuntu:${UBUNTU_RELEASE}

RUN \
    apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y \ 
        libgdk-pixbuf2.0-0 \
        pulseaudio \
        libpulse0 \
        libjpeg-dev \
        libvpx-dev \
        zlib1g-dev \
        x264 \
        software-properties-common \
        gnupg \
        build-essential \
        python3-pip \
        python3-dev \
        python3-gi \
        python3-setuptools \
        python3-wheel \
        libwebrtc-audio-processing1 \
        libcairo-gobject2 \
        libgirepository1.0-dev \
        gdebi-core \
        libopus0 \
        libsrtp2-1 \
        libpangocairo-1.0-0 \
        zlib1g-dev \
        gdebi-core && \
    rm -rf /var/lib/apt/lists/*

RUN pip install websockets 
RUN pip install basicauth

WORKDIR /opt

# Setup global bashrc to configure GStreamer environment
RUN echo 'export DISPLAY=:0' \
        >> /etc/bash.bashrc && \
    echo 'export GST_DEBUG=*:2' \
        >> /etc/bash.bashrc && \
    echo 'export GSTREAMER_PATH=/opt/gstreamer' \
        >> /etc/bash.bashrc && \
    echo 'source /opt/gstreamer/gst-env' \
        >> /etc/bash.bashrc

# Install gstreamer distribution
COPY --from=selkies-gstreamer /opt/gstreamer ./gstreamer

RUN apt-get update && apt-get install -y ffmpeg

RUN mkdir -p /app
COPY server/* /app

RUN echo "#!/bin/bash \n\
export GST_DEBUG=*:2,webrtcbin:5,*fakesink:5\n\
export GSTREAMER_PATH=/opt/gstreamer\n\
source /opt/gstreamer/gst-env \n\
python3 /app/main.py \n \ 
" > /entryscript.sh && chmod +x /entryscript.sh


CMD ["/entryscript.sh"]
