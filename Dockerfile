# ---- Build the Vite client ----
FROM node:22-slim AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- Runtime: Express API + serves the built client (same origin) ----
FROM node:22-slim AS runtime
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/ ./server/
COPY --from=client-build /app/client/dist ./client/dist
# DATA_DIR is the persistent volume mount (SQLite lives here). PORT is set by the host.
ENV DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server/index.js"]
