package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/matspectrum-ai/Flash-Pag/internal/auth"
	"github.com/matspectrum-ai/Flash-Pag/internal/config"
	"github.com/matspectrum-ai/Flash-Pag/internal/cryptobox"
	"github.com/matspectrum-ai/Flash-Pag/internal/db"
	"github.com/matspectrum-ai/Flash-Pag/internal/httpapi"
	"github.com/matspectrum-ai/Flash-Pag/internal/provider"
	providermock "github.com/matspectrum-ai/Flash-Pag/internal/provider/mock"
	providerpixhub "github.com/matspectrum-ai/Flash-Pag/internal/provider/pixhub"
	"github.com/matspectrum-ai/Flash-Pag/internal/supabase"
	"github.com/matspectrum-ai/Flash-Pag/internal/webhook"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		log.Error("configuration error", "err", err)
		os.Exit(1)
	}
	sb := supabase.New(cfg.SupabaseURL, cfg.SupabaseSecretKey, cfg.SupabasePublishableKey)
	var box *cryptobox.Box
	if len(cfg.MasterKey) > 0 {
		box, err = cryptobox.New(cfg.MasterKey)
		if err != nil {
			log.Error("master key error", "err", err)
			os.Exit(1)
		}
	}

	var authService *auth.Service
	var authStore *auth.PostgresStore
	var mfaService *auth.MFAService
	if cfg.FirstPartyAuthEnabled {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		pool, openErr := db.Open(ctx, cfg.DatabaseURL)
		cancel()
		if openErr != nil {
			log.Error("first-party auth database error", "err", openErr)
			os.Exit(1)
		}
		authStore = auth.NewPostgresStore(pool)
		if err := pool.Ping(context.Background()); err != nil {
			authStore.Close()
			log.Error("first-party auth database ping failed", "err", err)
			os.Exit(1)
		}
		authService = auth.NewService(authStore)
		mfaService = auth.NewMFAService(authStore, box)
		log.Info("first-party auth storage enabled")
	}

	providers := provider.NewRegistry(providermock.New(), providerpixhub.New())
	var app *httpapi.Server
	if cfg.FirstPartyAuthEnabled {
		app = httpapi.NewWithMFA(cfg, sb, box, providers, log, authService, mfaService)
	} else {
		app = httpapi.New(cfg, sb, box, providers, log, authService)
	}
	srv := &http.Server{Addr: cfg.Addr, Handler: app.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go webhook.NewWorker(sb, box, cfg.WebhookPollInterval, log).Run(ctx)
	go func() {
		log.Info("Flash Pag listening", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("http server", "err", err)
			stop()
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	if authStore != nil {
		authStore.Close()
	}
}
