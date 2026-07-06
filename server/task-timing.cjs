function buildTaskTiming(state) {
  if (!state?.startedAt) {
    return {
      elapsedMs: 0,
      estimatedRemainingMs: null,
      estimatedTotalMs: null,
      percentComplete: 0,
    };
  }

  const now = Date.now();
  const startedAtMs = new Date(state.startedAt).getTime();
  const endMs = state.completedAt ? new Date(state.completedAt).getTime() : now;
  const elapsedMs = Math.max(0, endMs - startedAtMs);
  const progress = Number(state.progress) || 0;
  const total = Number(state.total) || 0;
  const percentComplete = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0;

  let estimatedRemainingMs = null;
  let estimatedTotalMs = null;

  if (state.running && progress > 0 && total > progress) {
    const msPerUnit = elapsedMs / progress;
    estimatedTotalMs = Math.round(msPerUnit * total);
    estimatedRemainingMs = Math.max(0, estimatedTotalMs - elapsedMs);
  } else if (state.running && progress > 0 && total > 0 && progress >= total) {
    estimatedRemainingMs = 0;
    estimatedTotalMs = elapsedMs;
  }

  return {
    elapsedMs,
    estimatedRemainingMs,
    estimatedTotalMs,
    percentComplete,
  };
}

function withTaskTiming(state) {
  const timing = buildTaskTiming(state);
  return {
    running: state.running,
    progress: state.progress,
    total: state.total,
    currentClient: state.currentClient,
    error: state.error,
    startedAt: state.startedAt || null,
    completedAt: state.completedAt || null,
    ...timing,
  };
}

function markTaskStarted(state) {
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.completedAt = null;
  state.progress = 0;
  state.error = null;
}

function markTaskFinished(state) {
  state.running = false;
  state.completedAt = new Date().toISOString();
}

module.exports = {
  buildTaskTiming,
  withTaskTiming,
  markTaskStarted,
  markTaskFinished,
};
