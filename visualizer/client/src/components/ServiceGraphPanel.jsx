import React from 'react';

export function ServiceGraphPanel({ edges }) {
  if (!edges || edges.length === 0) return null;

  return (
    <div className="service-graph">
      <div className="service-graph-title">Service Graph</div>
      <table className="service-graph-table">
        <thead>
          <tr>
            <th>Client</th>
            <th></th>
            <th>Server</th>
            <th className="sg-num">Calls</th>
            <th className="sg-num">Errors</th>
            <th className="sg-num">Error %</th>
          </tr>
        </thead>
        <tbody>
          {edges.map((e) => {
            const pct = e.calls > 0 ? (e.errors / e.calls) * 100 : 0;
            const errCls = pct >= 10 ? 'sg-bad' : pct > 0 ? 'sg-warn' : '';
            return (
              <tr key={`${e.client}→${e.server}`}>
                <td className="sg-svc">{e.client}</td>
                <td className="sg-arrow">→</td>
                <td className="sg-svc">{e.server}</td>
                <td className="sg-num">{e.calls.toLocaleString()}</td>
                <td className={`sg-num ${e.errors > 0 ? 'sg-warn' : ''}`}>{e.errors.toLocaleString()}</td>
                <td className={`sg-num ${errCls}`}>{e.calls > 0 ? pct.toFixed(1) + '%' : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="service-graph-hint">
        Derived from trace parent–child relationships. In Lab 5, the <code>servicegraph</code> connector
        generates these same edges as queryable metrics in your backend.
      </div>
    </div>
  );
}
