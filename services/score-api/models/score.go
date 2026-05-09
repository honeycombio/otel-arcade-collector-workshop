package models

import "time"

type Score struct {
	ID         int64     `json:"id"`
	SessionID  string    `json:"session_id"`
	Game       string    `json:"game"`
	PlayerID   string    `json:"player_id"`
	PlayerName string    `json:"player_name"`
	Score      int       `json:"score"`
	CreatedAt  time.Time `json:"created_at"`
}
