package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math/rand"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	scoredb "github.com/honeycombio/o11ycon-arcade/score-api/db"
	"github.com/honeycombio/o11ycon-arcade/score-api/models"
)

var (
	tracer = otel.Tracer("score-api/handlers")
	meter  = otel.Meter("score-api/handlers")

	leaderboardClient = &http.Client{
		Timeout:   3 * time.Second,
		Transport: otelhttp.NewTransport(http.DefaultTransport),
	}
)

func leaderboardURL() string {
	if v := os.Getenv("LEADERBOARD_URL"); v != "" {
		return v
	}
	return "http://leaderboard:5000"
}

type sessionMetrics struct {
	active   metric.Int64UpDownCounter
	score    metric.Int64Histogram
	events   metric.Int64Counter
}

func newSessionMetrics() *sessionMetrics {
	active, _ := meter.Int64UpDownCounter("game.sessions.active",
		metric.WithDescription("Active game sessions"),
	)
	score, _ := meter.Int64Histogram("game.score.value",
		metric.WithDescription("Final score per completed session"),
	)
	events, _ := meter.Int64Counter("game.events.processed",
		metric.WithDescription("Game events processed"),
	)
	return &sessionMetrics{active: active, score: score, events: events}
}

func RegisterSessions(r chi.Router, store *scoredb.Store) {
	m := newSessionMetrics()

	r.Post("/sessions", func(w http.ResponseWriter, req *http.Request) {
		// DELIBERATE smell: span name "game.session.start" — inconsistent with other handlers.
		ctx, span := tracer.Start(req.Context(), "game.session.start")
		defer span.End()

		var body models.CreateSessionRequest
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if body.Game == "" || body.PlayerID == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "game and player_id required"})
			return
		}

		sess := &models.Session{
			ID:         uuid.NewString(),
			Game:       body.Game,
			PlayerID:   body.PlayerID,
			PlayerName: body.PlayerName,
			StartedAt:  time.Now().UTC(),
		}

		// DELIBERATE smell: player.id PII attribute on every span.
		span.SetAttributes(
			attribute.String("game.name", sess.Game),
			attribute.String("game.session.id", sess.ID),
			attribute.String("player.id", sess.PlayerID),
		)

		if err := store.CreateSession(ctx, sess); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		m.active.Add(ctx, 1, metric.WithAttributes(attribute.String("game.name", sess.Game)))
		slog.InfoContext(ctx, "session created", "session_id", sess.ID, "game", sess.Game, "player.id", sess.PlayerID)

		writeJSON(w, http.StatusCreated, sess)
	})

	r.Get("/sessions/{id}", func(w http.ResponseWriter, req *http.Request) {
		id := chi.URLParam(req, "id")
		sess, err := store.GetSession(req.Context(), id)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		writeJSON(w, http.StatusOK, sess)
	})

	r.Post("/sessions/{id}/events", func(w http.ResponseWriter, req *http.Request) {
		// DELIBERATE smell: snake_case + version number — inconsistent style.
		ctx, span := tracer.Start(req.Context(), "game_session_v2_event")
		defer span.End()

		id := chi.URLParam(req, "id")
		sess, err := store.GetSession(ctx, id)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
			return
		}

		var body models.CreateEventRequest
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json"})
			return
		}
		if body.Type == "" {
			body.Type = "action"
		}

		span.SetAttributes(
			attribute.String("game.name", sess.Game),
			attribute.String("game.session.id", sess.ID),
			attribute.String("game.event.type", body.Type),
			attribute.String("player.id", sess.PlayerID),
		)

		eventID, err := store.AppendEvent(ctx, sess.ID, body.Type, body.Data)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		m.events.Add(ctx, 1, metric.WithAttributes(
			attribute.String("game.name", sess.Game),
			attribute.String("event.type", body.Type),
		))

		writeJSON(w, http.StatusCreated, map[string]interface{}{
			"id":         eventID,
			"session_id": sess.ID,
			"type":       body.Type,
		})
	})

	r.Post("/sessions/{id}/complete", func(w http.ResponseWriter, req *http.Request) {
		// DELIBERATE smell: PascalCase + slash naming — third style.
		ctx, span := tracer.Start(req.Context(), "GameSession/Complete")
		defer span.End()

		id := chi.URLParam(req, "id")
		sess, err := store.GetSession(ctx, id)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
			return
		}

		var body struct {
			Difficulty string `json:"difficulty"`
		}
		json.NewDecoder(req.Body).Decode(&body) //nolint:errcheck
		if body.Difficulty == "" {
			body.Difficulty = "medium"
		}

		span.SetAttributes(
			attribute.String("game.name", sess.Game),
			attribute.String("game.session.id", sess.ID),
			attribute.String("player.id", sess.PlayerID),
			attribute.Int("game.events_count", sess.EventsCount),
			attribute.String("game.difficulty", body.Difficulty),
		)

		score := computeScore(ctx, sess, body.Difficulty)
		if err := store.CompleteSession(ctx, sess.ID, score); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		// Persist as a Score row.
		row := &models.Score{
			SessionID:  sess.ID,
			Game:       sess.Game,
			PlayerID:   sess.PlayerID,
			PlayerName: sess.PlayerName,
			Score:      score,
			Difficulty: body.Difficulty,
		}
		if err := store.InsertScore(ctx, row); err != nil {
			slog.WarnContext(ctx, "insert score failed", "err", err)
		}

		m.active.Add(ctx, -1, metric.WithAttributes(attribute.String("game.name", sess.Game)))
		m.score.Record(ctx, int64(score), metric.WithAttributes(attribute.String("game.name", sess.Game)))

		// Forward to Leaderboard. otelhttp.NewTransport injects W3C TraceContext.
		go forwardToLeaderboard(context.WithoutCancel(ctx), row)

		sess.Score = &score
		now := time.Now().UTC()
		sess.CompletedAt = &now
		writeJSON(w, http.StatusOK, sess)
	})
}

func difficultyMultiplier(d string) float64 {
	switch d {
	case "easy":
		return 1.0
	case "hard":
		return 3.0
	default:
		return 2.0 // medium
	}
}

func computeScore(ctx context.Context, sess *models.Session, difficulty string) int {
	ctx, span := tracer.Start(ctx, "score.compute")
	defer span.End()

	// Pseudo-realistic algorithm. The numbers don't matter — the span attributes do.
	rawScore := 100 + rand.Intn(900) + sess.EventsCount*5
	gameMult := 1.0
	switch sess.Game {
	case "memory":
		gameMult = 1.2
	case "typing":
		gameMult = 1.5
	case "whackamole":
		gameMult = 1.0
	case "wave-defender":
		gameMult = 1.3
	case "bid-wars":
		gameMult = 1.4
	case "hot-cache":
		gameMult = 1.2
	}
	diffMult := difficultyMultiplier(difficulty)
	final := int(float64(rawScore) * gameMult * diffMult)

	span.SetAttributes(
		attribute.String("algorithm", "weighted-sum-v1"),
		attribute.Int("raw_score", rawScore),
		attribute.Float64("bonus_multiplier", gameMult),
		attribute.String("game.difficulty", difficulty),
		attribute.Float64("difficulty.multiplier", diffMult),
		attribute.String("game.name", sess.Game),
		attribute.String("player.id", sess.PlayerID),
		attribute.Int("final_score", final),
	)
	return final
}

func forwardToLeaderboard(ctx context.Context, sc *models.Score) {
	body, _ := json.Marshal(map[string]interface{}{
		"session_id":  sc.SessionID,
		"game":        sc.Game,
		"player_id":   sc.PlayerID,
		"player_name": sc.PlayerName,
		"score":       sc.Score,
		"difficulty":  sc.Difficulty,
	})
	url := leaderboardURL() + "/scores"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		slog.WarnContext(ctx, "leaderboard request build failed", "err", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := leaderboardClient.Do(req)
	if err != nil {
		slog.WarnContext(ctx, "leaderboard call failed", "err", err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		slog.WarnContext(ctx, "leaderboard returned error",
			"status", resp.StatusCode,
			"body", fmt.Sprintf("%.200s", string(b)),
		)
	}
}
