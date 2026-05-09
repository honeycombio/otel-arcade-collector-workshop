package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/runtime"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploggrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetricgrpc"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/log/global"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

func initTelemetry(ctx context.Context) (func(context.Context) error, error) {
	serviceName := getenv("OTEL_SERVICE_NAME", "score-api")

	res, err := resource.New(ctx,
		resource.WithFromEnv(),
		resource.WithProcess(),
		resource.WithHost(),
		resource.WithAttributes(
			semconv.ServiceName(serviceName),
			semconv.ServiceVersion("0.1.0"),
			// DELIBERATE smell: redundant with service.name. Lab 2 removes this.
			attribute.String("app.name", serviceName),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("resource: %w", err)
	}

	endpoint := stripScheme(getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "otel-collector:4317"))

	traceExp, err := otlptracegrpc.New(ctx,
		otlptracegrpc.WithEndpoint(endpoint),
		otlptracegrpc.WithInsecure(),
	)
	if err != nil {
		return nil, fmt.Errorf("trace exporter: %w", err)
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(traceExp),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	metricExp, err := otlpmetricgrpc.New(ctx,
		otlpmetricgrpc.WithEndpoint(endpoint),
		otlpmetricgrpc.WithInsecure(),
	)
	if err != nil {
		return nil, fmt.Errorf("metric exporter: %w", err)
	}
	mp := sdkmetric.NewMeterProvider(
		sdkmetric.WithResource(res),
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExp,
			sdkmetric.WithInterval(15*time.Second),
		)),
	)
	otel.SetMeterProvider(mp)

	if err := runtime.Start(runtime.WithMinimumReadMemStatsInterval(time.Second)); err != nil {
		return nil, fmt.Errorf("runtime metrics: %w", err)
	}

	logExp, err := otlploggrpc.New(ctx,
		otlploggrpc.WithEndpoint(endpoint),
		otlploggrpc.WithInsecure(),
	)
	if err != nil {
		return nil, fmt.Errorf("log exporter: %w", err)
	}
	lp := sdklog.NewLoggerProvider(
		sdklog.WithResource(res),
		sdklog.WithProcessor(sdklog.NewBatchProcessor(logExp)),
	)
	global.SetLoggerProvider(lp)

	return func(ctx context.Context) error {
		var errs []error
		if err := tp.Shutdown(ctx); err != nil {
			errs = append(errs, err)
		}
		if err := mp.Shutdown(ctx); err != nil {
			errs = append(errs, err)
		}
		if err := lp.Shutdown(ctx); err != nil {
			errs = append(errs, err)
		}
		return errors.Join(errs...)
	}, nil
}

func stripScheme(s string) string {
	for _, p := range []string{"http://", "https://", "grpc://"} {
		s = strings.TrimPrefix(s, p)
	}
	return s
}
