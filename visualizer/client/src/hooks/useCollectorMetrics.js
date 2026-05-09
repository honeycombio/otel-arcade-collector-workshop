import { useEffect, useRef, useState } from 'react';

export function useCollectorStream() {
  const [feed,           setFeed]           = useState([]);
  const [rawFeed,        setRawFeed]        = useState([]);
  const [metrics,        setMetrics]        = useState({ connected: false });
  const [gatewayMetrics, setGatewayMetrics] = useState({ connected: false });
  const [serviceGraph,   setServiceGraph]   = useState([]);
  const [configs,        setConfigs]        = useState({ agent: null, gateway: null });
  const [wsConnected,    setWsConnected]    = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let backoff = 1000;

    function append(setter, item) {
      setter((prev) => {
        const next = prev.concat(item);
        if (next.length > 200) next.splice(0, next.length - 200);
        return next;
      });
    }

    function connect() {
      if (cancelled) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => { setWsConnected(true); backoff = 1000; };

      ws.onmessage = (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch { return; }

        switch (msg.type) {
          case 'snapshot':
            setFeed(msg.payload.slice(-200));
            break;
          case 'raw-snapshot':
            setRawFeed(msg.payload.slice(-200));
            break;
          case 'span':
          case 'log':
          case 'metric':
            append(setFeed, msg.payload);
            break;
          case 'raw-span':
            append(setRawFeed, msg.payload);
            break;
          case 'metrics':
            setMetrics(msg.payload);
            break;
          case 'gateway-metrics':
            setGatewayMetrics(msg.payload);
            break;
          case 'service-graph':
            setServiceGraph(msg.payload);
            break;
          case 'config':
            // payload is now { agent: { ok, pipelines }, gateway: { ok, pipelines } }
            setConfigs(msg.payload);
            break;
          default:
            break;
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (cancelled) return;
        setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      cancelled = true;
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return { feed, rawFeed, metrics, gatewayMetrics, serviceGraph, configs, wsConnected };
}
