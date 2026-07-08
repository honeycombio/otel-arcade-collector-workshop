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
  // DELIBERATE smell: redundant with service.name.
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
      // Keep /health and /ready spans (deliberate noise — filtered by processor).
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

// Bridge console output to the OTel LoggerProvider so arcade-ui logs reach the Collector.
// Must run after sdk.start() so the LoggerProvider is registered.
const { logs, SeverityNumber } = require('@opentelemetry/api-logs');
const _otelLogger = logs.getLogger('arcade-ui');
const _bridge = (severityNumber, args) => {
  _otelLogger.emit({ body: args.map(String).join(' '), severityNumber });
};
const _origLog   = console.log.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);
console.log   = (...args) => { _origLog(...args);   _bridge(SeverityNumber.INFO,  args); };
console.warn  = (...args) => { _origWarn(...args);  _bridge(SeverityNumber.WARN,  args); };
console.error = (...args) => { _origError(...args); _bridge(SeverityNumber.ERROR, args); };

function shutdown() {
  sdk.shutdown().catch(() => {}).finally(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
