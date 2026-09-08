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

	"github.com/matspectrum-ai/Flash-Pag/internal/config"
	"github.com/matspectrum-ai/Flash-Pag/internal/cryptobox"
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
	providers := provider.NewRegistry(providermock.New(), providerpixhub.New())
	app := httpapi.New(cfg, sb, box, providers, log)
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
}
