"""OTel SDK init for the leaderboard service.

Sets up traces, metrics, and logs exporters over OTLP gRPC, and applies the
auto-instrumentations for Flask, requests, and sqlite3. Imported for side
effects from app.py before any Flask code runs.
"""
import logging
import os

from opentelemetry import metrics, trace
from opentelemetry._logs import set_logger_provider
from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.logging import LoggingInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.instrumentation.sqlite3 import SQLite3Instrumentor
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def _strip_scheme(value: str) -> str:
    for prefix in ("http://", "https://", "grpc://"):
        if value.startswith(prefix):
            return value[len(prefix):]
    return value


def setup() -> None:
    service_name = os.getenv("OTEL_SERVICE_NAME", "leaderboard")
    endpoint = _strip_scheme(os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "otel-collector:4317"))

    resource = Resource.create({
        "service.name": service_name,
        "service.version": "0.1.0",
        # DELIBERATE: redundant attribute. Lab 2 removes this.
        "app.name": service_name,
    })

    # Traces
    trace_provider = TracerProvider(resource=resource)
    trace_provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint, insecure=True))
    )
    trace.set_tracer_provider(trace_provider)

    # Metrics
    metric_reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=endpoint, insecure=True),
        export_interval_millis=15000,
    )
    metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[metric_reader]))

    # Logs
    log_provider = LoggerProvider(resource=resource)
    log_provider.add_log_record_processor(
        BatchLogRecordProcessor(OTLPLogExporter(endpoint=endpoint, insecure=True))
    )
    set_logger_provider(log_provider)

    # DELIBERATE smell: DEBUG level by default — high-volume noise for log filtering exercises.
    log_level = os.getenv("LOG_LEVEL", "DEBUG")
    handler = LoggingHandler(level=getattr(logging, log_level), logger_provider=log_provider)
    root = logging.getLogger()
    root.setLevel(getattr(logging, log_level))
    root.addHandler(handler)
    # Also keep a stderr handler so logs are visible during local dev.
    stream = logging.StreamHandler()
    stream.setLevel(getattr(logging, log_level))
    stream.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root.addHandler(stream)

    LoggingInstrumentor().instrument(set_logging_format=False)
    RequestsInstrumentor().instrument()
    SQLite3Instrumentor().instrument()
