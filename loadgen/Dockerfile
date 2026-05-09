FROM alpine:3.19
RUN apk add --no-cache bash curl bc
WORKDIR /app
COPY loadgen.sh .
RUN chmod +x loadgen.sh
ENV LOADGEN_RPS=5 \
    SCORE_API_URL=http://score-api:8080
ENTRYPOINT ["./loadgen.sh"]
