FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Traffic data is refreshed and versioned by the dedicated data workflow.
# Production builds publish the last accepted snapshot instead of depending on
# the external Detran portal being reachable at deploy time.
RUN mkdir -p public/data && cp src/generated/traffic-intelligence.json public/data/traffic-intelligence.json
RUN npm run build:app
RUN npm run build:server
# TypeScript does not copy non-code migration assets.
RUN mkdir -p .server-dist/db/migrations && cp server/db/migrations/*.sql .server-dist/db/migrations/

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/.server-dist ./.server-dist
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=4s --start-period=8s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT:-80}/healthz || exit 1
CMD ["node", ".server-dist/start.js"]
