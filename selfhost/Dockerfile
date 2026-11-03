# SPDX-License-Identifier: GPL-3.0-or-later
# spur self-hosted. No npm packages are installed: the server uses only
# Node.js built-ins (HTTP, crypto, SQLite).
FROM node:24-alpine

LABEL org.opencontainers.image.title="spur" \
      org.opencontainers.image.description="A private running diary you host yourself" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"

ENV NODE_ENV=production \
    PORT=4219 \
    SPUR_DATA_DIR=/data

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

# The database lives in /data, owned by the unprivileged "node" user.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4219

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4219)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
