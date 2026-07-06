export default function HelpGuide() {
  return (
    <div className="animate-fade-in help-guide">
      <div className="view-header">
        <div>
          <h2 className="results-title">Platform guide</h2>
          <p className="subtitle page-subtitle">
            Product definitions, data sources, and formulas for Health Monitor, Global Search, Sync Metrics, and the cURL library.
            Use this page to validate exports and explain metrics to customers or leadership.
          </p>
        </div>
      </div>

      <div className="help-grid">
        <section className="help-card panel">
          <h3 className="section-title">Data sources</h3>
          <ul className="help-list">
            <li>
              <strong>Active connections</strong> — Tartan vendor Connections API (<code>status=active</code>).
              All pages are fetched so totals match the console (not only the first page).
            </li>
            <li>
              <strong>HRMS provider</strong> — <code>hrms_code</code> on each connection (e.g. <code>csvupload</code>, <code>darwinbox</code>).
              Display names are derived from this code; the raw code is included in CSV exports.
            </li>
            <li>
              <strong>Sync attempts</strong> — Sync Logs API for the date range you select (Client Sync History) or the last 7 days (Global scan).
            </li>
          </ul>
        </section>

        <section className="help-card panel">
          <h3 className="section-title">Connection status (per corporate)</h3>
          <p className="help-p">Each active connection gets exactly one status in the selected period:</p>
          <table className="table help-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Rule</th>
                <th>PM interpretation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="status-badge-premium healthy">healthy</span></td>
                <td>At least one sync attempt, and every attempt succeeded</td>
                <td>Stable integration for the period</td>
              </tr>
              <tr>
                <td><span className="status-badge-premium warning">warning</span></td>
                <td>Mix of success and failure attempts</td>
                <td>Degraded; investigate before it becomes an outage</td>
              </tr>
              <tr>
                <td><span className="status-badge-premium failed">failed</span></td>
                <td>One or more attempts, zero successes</td>
                <td>Outage for that connection in the period</td>
              </tr>
              <tr>
                <td><span className="status-badge-premium no_sync">no sync</span></td>
                <td>Zero sync attempts in the date range</td>
                <td>Stalled or inactive; may be expected for new connections</td>
              </tr>
            </tbody>
          </table>
          <p className="help-note">
            <strong>Reconciliation:</strong> healthy + warning + failed + no sync = total active connections.
            The UI and CSV summary include a check row; if it does not match, re-fetch or contact engineering.
          </p>
        </section>

        <section className="help-card panel">
          <h3 className="section-title">Success rate</h3>
          <div className="help-formula">
            Success rate (%) = round( successful sync attempts ÷ total sync attempts × 100 )
          </div>
          <ul className="help-list">
            <li>If there are no attempts in the period, success rate is <strong>0%</strong> and status is <strong>no sync</strong>.</li>
            <li>
              <strong>Successful + failed + other</strong> = total attempts per connection.
              “Other” covers any log status that is neither success nor failed (shown in CSV).
            </li>
            <li>Daily heatmap cells use the same log data: per calendar day, success wins over failed if both exist.</li>
          </ul>
        </section>

        <section className="help-card panel">
          <h3 className="section-title">Summary KPI cards</h3>
          <ul className="help-list">
            <li><strong>Active connections</strong> — Count of connections returned by the Connections API (active).</li>
            <li><strong>Healthy syncs</strong> — Connections with status <em>healthy</em>. Click the card to filter the table.</li>
            <li><strong>Partial failures</strong> — Connections with status <em>warning</em> (mixed success/failure). Click to filter.</li>
            <li><strong>Critical failures</strong> — Connections with status <em>failed</em> (zero successes). Click to filter.</li>
            <li><strong>No sync / stalled</strong> — Connections with status <em>no sync</em> (zero attempts in the date range). Click to filter.</li>
          </ul>
          <p className="help-p">
            The reconciliation line under the cards shows how all buckets sum to the active connection total:
            healthy + partial + critical + no sync = total.
          </p>
        </section>

        <section className="help-card panel">
          <h3 className="section-title">CSM outage escalation</h3>
          <p className="help-p">
            Lists non-healthy connections with activity in the last N days, measured backward from the report&apos;s end date
            (not from today). At 30 days within a 30-day report, all partial, critical, and stalled connections are shown.
            Click KPI cards above the table to filter by status.
          </p>
        </section>

        <section className="help-card panel">
          <h3 className="section-title">cURL library</h3>
          <ul className="help-list">
            <li>Save labeled cURL commands linked to a connection, client, or corporate name.</li>
            <li>Search by label — curl bodies are <strong>encrypted at rest</strong> and only shown after explicit reveal.</li>
            <li>Reveal and copy actions are audit-logged; use <code>{'{{token}}'}</code> placeholders instead of live bearer tokens when possible.</li>
            <li>From Global Search, use <strong>Save cURL</strong> on a connection profile to pre-fill the form.</li>
          </ul>
        </section>

        <section className="help-card panel">
          <h3 className="section-title">Global connection search</h3>
          <ul className="help-list">
            <li>Indexes all active connections into CSV + in-memory cache for instant search.</li>
            <li>Results paginate at 50 — use <strong>Load more</strong> for larger result sets.</li>
            <li>Employee email search indexes up to <strong>50 employees</strong> per connection during reindex (not exhaustive).</li>
          </ul>
        </section>

        <section className="help-card panel">
          <h3 className="section-title">Global HRMS health</h3>
          <ul className="help-list">
            <li>Runs across <strong>all stored client credentials</strong> (last 7 days of sync logs per client).</li>
            <li>Connections are grouped by <code>hrms_code</code> so you see true HRMS-level blast radius.</li>
            <li>
              <strong>HEALTHY</strong> only when every connection under that HRMS had 100% successful syncs in 7 days (no partial failures, no stalls).
            </li>
            <li>
              <strong>DEGRADED (warning)</strong> if any connection is partial (mixed success/failure), fully failed, or had no sync attempts.
            </li>
            <li>
              <strong>OUTAGE</strong> when all connections are failed or no-sync and at least one hard failure exists.
            </li>
            <li>Expand an HRMS card for <strong>30-day vendor-wise</strong> breakdown with failure reasons per corporate.</li>
            <li>Disruptions report CSV includes failed, partial, and no-sync rows with 7d and 30d metrics.</li>
          </ul>
        </section>

        <section className="help-card panel">
          <h3 className="section-title">Sync metrics page</h3>
          <ul className="help-list">
            <li>Aggregates sync logs across all clients for the selected period (7–365 days).</li>
            <li>Granularity: daily, weekly, monthly, quarterly, yearly buckets for trend charts.</li>
            <li>Employees synced (latest) sums the most recent successful sync headcount per connection; delta shows net change vs start of period.</li>
            <li>Charts stack successful (green) and failed (red) attempts per time bucket.</li>
          </ul>
        </section>

        <section className="help-card panel">
          <h3 className="section-title">CSV export</h3>
          <p className="help-p">Client Sync History → Export CSV Report includes:</p>
          <ol className="help-ol">
            <li>Report metadata (client, date range, generated time)</li>
            <li>Summary block with counts and a reconciliation check</li>
            <li>Per-connection rows with HRMS code, sync counts, computed success rate, and employee/latency totals</li>
          </ol>
          <p className="help-note">
            Verify: for each row, Success + Failed + Other = Total syncs, and Success rate matches the formula above.
          </p>
        </section>

        <section className="help-card panel">
          <h3 className="section-title">Employee & latency metrics</h3>
          <ul className="help-list">
            <li><strong>Employees found / created / updated</strong> — Sum of fields on each sync log in the period (not deduplicated by employee ID).</li>
            <li><strong>Avg latency (sec)</strong> — Mean of <code>duration_seconds</code> across attempts in the period.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
