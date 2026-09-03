/** Armada 429 / gateway waits. Capped so one header cannot stall a load for minutes. */
export function retryWaitMs(retryAfterHeader, attempt) {
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30_000);
  }
  return Math.min(1000 * 2 ** Math.min(Math.max(0, attempt), 5), 20_000);
}

export function isRetryableArmadaStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}
