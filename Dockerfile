FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Traffic data is refreshed and versioned by the dedicated data workflow.
# Production builds publish the last accepted snapshot instead of depending on
# the external Detran portal being reachable at deploy time.
RUN npm run build:app

FROM nginx:1.27-alpine
ENV PORT=80
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT:-80}/healthz || exit 1
