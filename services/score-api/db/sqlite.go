package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "modernc.org/sqlite"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/honeycombio/o11ycon-arcade/score-api/models"
)

var tracer = otel.Tracer("score-api/db")

type Store struct {
	db *sql.DB
}

func New(path string) (*Store, error) {
	d, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	d.SetMaxOpenConns(1)
	if err := d.Ping(); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	s := &Store{db: d}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate() error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			game TEXT NOT NULL,
			player_id TEXT NOT NULL,
			player_name TEXT NOT NULL DEFAULT '',
			started_at DATETIME NOT NULL,
			completed_at DATETIME,
			score INTEGER,
			events_count INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS scores (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			game TEXT NOT NULL,
			player_id TEXT NOT NULL,
			player_name TEXT NOT NULL DEFAULT '',
			score INTEGER NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id TEXT NOT NULL,
			event_type TEXT NOT NULL,
			data TEXT,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
	}
	for _, q := range stmts {
		if _, err := s.db.Exec(q); err != nil {
			return err
		}
	}
	// Best-effort: add player_name to tables that predate this migration.
	s.db.Exec(`ALTER TABLE sessions ADD COLUMN player_name TEXT NOT NULL DEFAULT ''`)
	s.db.Exec(`ALTER TABLE scores ADD COLUMN player_name TEXT NOT NULL DEFAULT ''`)
	return nil
}

// startQuerySpan creates a child span using the literal SQL (with values
// inlined) as the span name. This is a DELIBERATE telemetry smell that Lab 2
// will normalize to a stable `db.query` span name with parameterized statements.
func startQuerySpan(ctx context.Context, sql string) (context.Context, func(error)) {
	ctx, span := tracer.Start(ctx, sql)
	span.SetAttributes(
		attribute.String("db.system", "sqlite"),
		// DELIBERATE: db.statement contains literal bound values (PII risk + cardinality).
		attribute.String("db.statement", sql),
	)
	return ctx, func(err error) {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
		}
		span.End()
	}
}

func (s *Store) CreateSession(ctx context.Context, sess *models.Session) error {
	displaySQL := fmt.Sprintf(
		"INSERT INTO sessions (id, game, player_id, player_name, started_at) VALUES ('%s','%s','%s','%s','%s')",
		sess.ID, sess.Game, sess.PlayerID, sess.PlayerName, sess.StartedAt.Format(time.RFC3339Nano),
	)
	ctx, end := startQuerySpan(ctx, displaySQL)
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO sessions (id, game, player_id, player_name, started_at) VALUES (?, ?, ?, ?, ?)`,
		sess.ID, sess.Game, sess.PlayerID, sess.PlayerName, sess.StartedAt,
	)
	end(err)
	return err
}

func (s *Store) GetSession(ctx context.Context, id string) (*models.Session, error) {
	displaySQL := fmt.Sprintf("SELECT * FROM sessions WHERE id = '%s'", id)
	ctx, end := startQuerySpan(ctx, displaySQL)
	row := s.db.QueryRowContext(ctx,
		`SELECT id, game, player_id, player_name, started_at, completed_at, score, events_count FROM sessions WHERE id = ?`,
		id,
	)
	var sess models.Session
	var completedAt sql.NullTime
	var score sql.NullInt64
	err := row.Scan(&sess.ID, &sess.Game, &sess.PlayerID, &sess.PlayerName, &sess.StartedAt, &completedAt, &score, &sess.EventsCount)
	end(err)
	if err != nil {
		return nil, err
	}
	if completedAt.Valid {
		t := completedAt.Time
		sess.CompletedAt = &t
	}
	if score.Valid {
		v := int(score.Int64)
		sess.Score = &v
	}
	return &sess, nil
}

func (s *Store) AppendEvent(ctx context.Context, sessionID, eventType string, data map[string]any) (int64, error) {
	blob, _ := json.Marshal(data)
	displaySQL := fmt.Sprintf(
		"INSERT INTO events (session_id, event_type, data) VALUES ('%s','%s','%s')",
		sessionID, eventType, string(blob),
	)
	ctx, end := startQuerySpan(ctx, displaySQL)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		end(err)
		return 0, err
	}
	res, err := tx.ExecContext(ctx,
		`INSERT INTO events (session_id, event_type, data) VALUES (?, ?, ?)`,
		sessionID, eventType, string(blob),
	)
	if err == nil {
		_, err = tx.ExecContext(ctx,
			`UPDATE sessions SET events_count = events_count + 1 WHERE id = ?`, sessionID,
		)
	}
	if err != nil {
		_ = tx.Rollback()
		end(err)
		return 0, err
	}
	err = tx.Commit()
	end(err)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) CompleteSession(ctx context.Context, id string, score int) error {
	now := time.Now().UTC()
	displaySQL := fmt.Sprintf(
		"UPDATE sessions SET completed_at = '%s', score = %d WHERE id = '%s'",
		now.Format(time.RFC3339Nano), score, id,
	)
	ctx, end := startQuerySpan(ctx, displaySQL)
	_, err := s.db.ExecContext(ctx,
		`UPDATE sessions SET completed_at = ?, score = ? WHERE id = ?`,
		now, score, id,
	)
	end(err)
	return err
}

func (s *Store) InsertScore(ctx context.Context, sc *models.Score) error {
	displaySQL := fmt.Sprintf(
		"INSERT INTO scores (session_id, game, player_id, player_name, score) VALUES ('%s','%s','%s','%s',%d)",
		sc.SessionID, sc.Game, sc.PlayerID, sc.PlayerName, sc.Score,
	)
	ctx, end := startQuerySpan(ctx, displaySQL)
	res, err := s.db.ExecContext(ctx,
		`INSERT INTO scores (session_id, game, player_id, player_name, score) VALUES (?, ?, ?, ?, ?)`,
		sc.SessionID, sc.Game, sc.PlayerID, sc.PlayerName, sc.Score,
	)
	end(err)
	if err != nil {
		return err
	}
	id, _ := res.LastInsertId()
	sc.ID = id
	return nil
}

func (s *Store) RecentScores(ctx context.Context, limit int) ([]models.Score, error) {
	displaySQL := fmt.Sprintf(
		"SELECT * FROM scores ORDER BY created_at DESC LIMIT %d", limit,
	)
	ctx, end := startQuerySpan(ctx, displaySQL)
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, session_id, game, player_id, player_name, score, created_at FROM scores ORDER BY created_at DESC LIMIT ?`,
		limit,
	)
	if err != nil {
		end(err)
		return nil, err
	}
	defer rows.Close()
	var out []models.Score
	for rows.Next() {
		var sc models.Score
		if err := rows.Scan(&sc.ID, &sc.SessionID, &sc.Game, &sc.PlayerID, &sc.PlayerName, &sc.Score, &sc.CreatedAt); err != nil {
			end(err)
			return nil, err
		}
		out = append(out, sc)
	}
	end(nil)
	return out, nil
}
