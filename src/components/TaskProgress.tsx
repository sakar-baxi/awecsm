import { useEffect, useState } from 'react';

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0s';
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

type TaskProgressBannerProps = {
  running: boolean;
  taskName: string;
  progress?: number;
  total?: number;
  currentStep?: string;
  startedAt?: string | null;
  elapsedMs?: number | null;
  estimatedRemainingMs?: number | null;
  percentComplete?: number;
  unitLabel?: string;
  className?: string;
};

export function TaskProgressBanner({
  running,
  taskName,
  progress = 0,
  total = 0,
  currentStep,
  startedAt,
  elapsedMs: serverElapsedMs,
  estimatedRemainingMs,
  percentComplete = 0,
  unitLabel = 'clients',
  className = '',
}: TaskProgressBannerProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  if (!running) return null;

  const liveElapsedMs = startedAt
    ? Math.max(0, Date.now() - new Date(startedAt).getTime())
    : serverElapsedMs || 0;

  const elapsed = startedAt ? liveElapsedMs : (serverElapsedMs ?? liveElapsedMs);
  const pct = total > 0 ? Math.min(100, percentComplete || Math.round((progress / total) * 100)) : 0;

  let etaText = 'Calculating ETA…';
  if (estimatedRemainingMs != null && estimatedRemainingMs >= 0) {
    if (estimatedRemainingMs === 0) etaText = 'Finishing up…';
    else etaText = `~${formatDuration(estimatedRemainingMs)} remaining`;
  } else if (progress > 0 && total > progress && elapsed > 0) {
    const msPerUnit = elapsed / progress;
    const remaining = Math.max(0, msPerUnit * (total - progress));
    etaText = `~${formatDuration(remaining)} remaining`;
  }

  return (
    <div className={`task-progress-banner animate-fade-in ${className}`.trim()}>
      <div className="task-progress-header">
        <div className="task-progress-title">
          <div className="spinner" style={{ width: '0.875rem', height: '0.875rem' }} />
          <span>{taskName}</span>
        </div>
        <span className="task-progress-pct">{pct}%</span>
      </div>

      <div className="task-progress-track">
        <div className="task-progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="task-progress-meta">
        <span>
          {currentStep ? (
            <>
              Current: <strong>{currentStep}</strong>
            </>
          ) : (
            'Starting…'
          )}
        </span>
        <span>
          {progress} / {total || '—'} {unitLabel}
        </span>
      </div>

      <div className="task-progress-timing">
        <span>Elapsed: <strong>{formatDuration(elapsed)}</strong></span>
        <span>{etaText}</span>
        <span>Est. total: <strong>{estimatedRemainingMs != null && elapsed ? formatDuration(elapsed + estimatedRemainingMs) : '—'}</strong></span>
      </div>
    </div>
  );
}

type MinorTaskTimerProps = {
  active: boolean;
  label: string;
  className?: string;
};

export function MinorTaskTimer({ active, label, className = '' }: MinorTaskTimerProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  return (
    <span className={`minor-task-timer ${className}`.trim()}>
      <span className="minor-task-timer-dot" />
      {label} · {formatDuration(elapsed)}
    </span>
  );
}
