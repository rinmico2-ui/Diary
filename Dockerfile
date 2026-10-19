# syntax=docker/dockerfile:1

FROM node:20-bookworm AS build
WORKDIR /app

# Install dependencies for both workspaces first (better layer caching).
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY web/package.json ./web/package.json
RUN npm ci --workspaces --include-workspace-root

# Copy the rest of the source.
COPY . .

# Build server + client.
RUN npm run build

# --- runtime image ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# sharp / libsql ship prebuilt binaries; keep libc compat.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy built artifacts + production deps.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/web ./web

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data

# Persistent volume mount point (created by Fly).
RUN mkdir -p /data

EXPOSE 8080
CMD ["npm", "run", "start"]
