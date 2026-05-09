FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx vite build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8090 \
    OTLP_PORT=4318 \
    COLLECTOR_METRICS_URL=http://otel-collector:8888/metrics \
    SCRAPE_INTERVAL_MS=5000
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/client/dist ./client/dist
COPY package.json .
EXPOSE 8090 4318
CMD ["node", "server/index.js"]
