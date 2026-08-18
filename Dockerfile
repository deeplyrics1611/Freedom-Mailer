FROM node:20-bookworm-slim

# better-sqlite3 ships prebuilt binaries for most platforms; build-essential
# and python3 are kept as a fallback so `npm install` can compile from
# source if no prebuilt binary matches the image's platform/libc.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# SQLite database lives here; mount a volume on this path to persist data
# across container restarts/upgrades.
VOLUME ["/app/data"]

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/server.js"]
