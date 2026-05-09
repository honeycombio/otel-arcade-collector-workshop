package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	"github.com/honeycombio/o11ycon-arcade/score-api/db"
	"github.com/honeycombio/o11ycon-arcade/score-api/handlers"
)

func main() {
	ctx := context.Background()

	shutdownTel, err := initTelemetry(ctx)
	if err != nil {
		slog.Error("failed to init telemetry", "err", err)
		os.Exit(1)
	}

	// slog → OTel logs bridge: structured JSON logs gain trace correlation
	// automatically when emitted with InfoContext / WarnContext / ErrorContext.
	slog.SetDefault(otelslog.NewLogger("score-api"))

	store, err := db.New(getenv("SCORE_API_DB", "./scores.db"))
	if err != nil {
		slog.Error("db init failed", "err", err)
		os.Exit(1)
	}
	defer store.Close()

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)

	handlers.RegisterHealth(r)
	handlers.RegisterSessions(r, store)
	handlers.RegisterScores(r, store)

	// otelhttp wraps the entire router so every request gets an HTTP span.
	handler := otelhttp.NewHandler(r, "score-api",
		otelhttp.WithSpanNameFormatter(func(_ string, req *http.Request) string {
			// Keep raw method+path so /health spans are visible (deliberate noise).
			return strings.ToUpper(req.Method) + " " + req.URL.Path
		}),
	)

	addr := getenv("SCORE_API_ADDR", ":8080")
	srv := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second}

	srvErr := make(chan error, 1)
	go func() {
		slog.Info("score-api listening", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			srvErr <- err
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-sigCh:
		slog.Info("shutting down")
	case err := <-srvErr:
		slog.Error("listen failed", "err", err)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("server shutdown failed", "err", err)
	}
	if err := shutdownTel(shutdownCtx); err != nil {
		slog.Error("telemetry shutdown failed", "err", err)
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
