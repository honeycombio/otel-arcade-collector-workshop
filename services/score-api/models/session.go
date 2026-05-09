package models

import "time"

type Session struct {
	ID          string     `json:"id"`
	Game        string     `json:"game"`
	PlayerID    string     `json:"player_id"`
	PlayerName  string     `json:"player_name"`
	StartedAt   time.Time  `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	Score       *int       `json:"score,omitempty"`
	EventsCount int        `json:"events_count"`
}

type Event struct {
	ID        int64     `json:"id"`
	SessionID string    `json:"session_id"`
	Type      string    `json:"type"`
	Data      string    `json:"data"`
	CreatedAt time.Time `json:"created_at"`
}

type CreateSessionRequest struct {
	Game       string `json:"game"`
	PlayerID   string `json:"player_id"`
	PlayerName string `json:"player_name"`
}

type CreateEventRequest struct {
	Type string                 `json:"type"`
	Data map[string]interface{} `json:"data"`
}
