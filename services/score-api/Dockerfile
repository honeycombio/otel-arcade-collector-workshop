FROM golang:1.26-alpine AS builder
WORKDIR /src

# Cache module downloads (modernc.org/sqlite is large).
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/score-api .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
WORKDIR /app
COPY --from=builder /out/score-api /app/score-api
USER app
EXPOSE 8080
ENV SCORE_API_ADDR=:8080 \
    OTEL_EXPORTER_OTLP_ENDPOINT=otel-collector:4317 \
    OTEL_SERVICE_NAME=score-api \
    SCORE_API_DB=/tmp/scores.db
ENTRYPOINT ["/app/score-api"]
