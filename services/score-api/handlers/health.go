package handlers

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

func RegisterHealth(r chi.Router) {
	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	r.Get("/ready", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	})
}
