// Minimal browser-side OTLP/JSON span sender.
// Posts to /api/browser-traces (arcade-ui proxies to the Collector).
// No bundler — just include this script before your game JS.
(function () {
  function hex(len) {
    var b = crypto.getRandomValues(new Uint8Array(len));
    return Array.from(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
  }

  // Returns nanoseconds as a BigInt string suitable for OTLP timeUnixNano.
  function nowNs() {
    return String(BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e6)));
  }

  var pageTraceId = hex(16); // shared across spans on this page

  function makeSpan(name, attrs, startNs, endNs) {
    var playerId = window.Arcade ? window.Arcade.getPlayerId() : 'browser-unknown';
    var merged = Object.assign({
      'player.id':          playerId,          // DELIBERATE: PII on every span
      'browser.user_agent': navigator.userAgent, // DELIBERATE: full UA
      'browser.screen_width':  screen.width,
      'browser.screen_height': screen.height,
    }, attrs);

    var attrList = Object.keys(merged).map(function (k) {
      var v = merged[k];
      var val;
      if (typeof v === 'boolean')       val = { boolValue: v };
      else if (Number.isInteger(v))     val = { intValue: v };
      else if (typeof v === 'number')   val = { doubleValue: v };
      else                              val = { stringValue: String(v) };
      return { key: k, value: val };
    });

    return {
      traceId:            pageTraceId,
      spanId:             hex(8),
      name:               name,
      kind:               3,   // SPAN_KIND_CLIENT
      startTimeUnixNano:  startNs,
      endTimeUnixNano:    endNs,
      attributes:         attrList,
      status:             { code: 1 },
    };
  }

  function send(spans) {
    var playerId = window.Arcade ? window.Arcade.getPlayerId() : 'browser-unknown';
    var payload = JSON.stringify({
      resourceSpans: [{
        resource: {
          attributes: [
            { key: 'service.name',    value: { stringValue: 'arcade-ui-browser' } },
            { key: 'service.version', value: { stringValue: '0.1.0' } },
            { key: 'app.name',        value: { stringValue: 'arcade-ui-browser' } }, // DELIBERATE
          ],
        },
        scopeSpans: [{
          scope: { name: 'arcade-ui-browser' },
          spans: spans,
        }],
      }],
    });

    fetch('/api/browser-traces', {
      method:    'POST',
      headers:   { 'content-type': 'application/json', 'x-player-id': playerId },
      body:      payload,
      keepalive: true,
    }).catch(function () {});  // fire-and-forget
  }

  // Convenience: record a single completed span.
  function record(name, attrs, startNs, endNs) {
    send([makeSpan(name, attrs, startNs, endNs)]);
  }

  window.BrowserTracer = { nowNs: nowNs, makeSpan: makeSpan, send: send, record: record };
})();
