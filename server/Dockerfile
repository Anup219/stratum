# Stratum Slicer Backend with OrcaSlicer Headless CLI
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# Install base dependencies and Node.js
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    ca-certificates \
    xvfb \
    libglu1-mesa \
    libgl1-mesa-glx \
    libgomp1 \
    libwebkit2gtk-4.0-37 \
    libgtk-3-0 \
    fuse \
    file \
    locales \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install OrcaSlicer AppImage / Binary
WORKDIR /opt/orcaslicer
RUN wget https://github.com/SoftFever/OrcaSlicer/releases/download/v2.1.1/OrcaSlicer_Linux_V2.1.1.AppImage -O orcaslicer.AppImage || true \
    && chmod +x orcaslicer.AppImage || true \
    && (./orcaslicer.AppImage --appimage-extract || true) \
    && ln -sf /opt/orcaslicer/squashfs-root/AppRun /usr/local/bin/orca-slicer || true

WORKDIR /app
COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3001

# Run with xvfb for headless OpenGL context required by slicer
CMD ["xvfb-run", "-a", "node", "server.js"]
