package handlers

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/honeycombio/o11ycon-arcade/score-api/db"
)

func RegisterScores(r chi.Router, store *db.Store) {
	r.Get("/scores/recent", func(w http.ResponseWriter, req *http.Request) {
		limit := 20
		if v := req.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 200 {
				limit = n
			}
		}
		scores, err := store.RecentScores(req.Context(), limit)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, scores)
	})
}
