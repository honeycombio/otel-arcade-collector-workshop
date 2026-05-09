FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl && \
    KUBECTL_VER=$(curl -Ls https://dl.k8s.io/release/stable.txt) && \
    curl -Lo /usr/local/bin/kubectl \
      "https://dl.k8s.io/release/${KUBECTL_VER}/bin/linux/amd64/kubectl" && \
    chmod +x /usr/local/bin/kubectl
ENV NODE_ENV=production \
    OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317 \
    OTEL_SERVICE_NAME=arcade-ui \
    SCORE_API_URL=http://score-api:8080 \
    LEADERBOARD_URL=http://leaderboard:5000 \
    PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
CMD ["node", "-r", "./src/tracing.js", "src/server.js"]
