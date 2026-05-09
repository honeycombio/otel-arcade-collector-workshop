// OTel SDK bootstrap. Required (-r) before any other module so the
// auto-instrumentation can patch http/express on first import.
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-grpc');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-grpc');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { Resource } = require('@opentelemetry/resources');
const {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} = require('@opentelemetry/semantic-conventions');

const serviceName = process.env.OTEL_SERVICE_NAME || 'arcade-ui';
const endpoint = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector-agent:4317')
  .replace(/^grpc:\/\//, 'http://');

const resource = new Resource({
  [ATTR_SERVICE_NAME]: serviceName,
  [ATTR_SERVICE_VERSION]: '0.1.0',
  // DELIBERATE smell: redundant with service.name. Lab 2 removes this.
  'app.name': serviceName,
});

const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({ url: endpoint }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: endpoint }),
    exportIntervalMillis: 15000,
  }),
  logRecordProcessors: [
    new BatchLogRecordProcessor(new OTLPLogExporter({ url: endpoint })),
  ],
  instrumentations: [
    getNodeAutoInstrumentations({
      // Keep /health and /ready spans (deliberate noise — Lab 2 filters them).
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

function shutdown() {
  sdk.shutdown().catch(() => {}).finally(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
