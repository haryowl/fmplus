/** Armada 429 / gateway waits. Capped so one header cannot stall a load for minutes. */
export function retryWaitMs(retryAfterHeader, attempt) {
  const seconds = Number(retryAfterHeader);
  if (retryAfterHeader != null && retryAfterHeader !== "" && Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30_000);
  }
  return Math.min(1000 * 2 ** Math.min(Math.max(0, attempt), 5), 20_000);
}

/** Brief gap so a 5xx outage does not spin the pool at full concurrency. */
export const GATEWAY_GAP_MS = 300;
export const MIN_429_CAP = 3;
export const RECOVER_SUCCESS_STREAK = 4;

export function isRetryableArmadaStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function reducedCapOn429(currentCap, minCap = MIN_429_CAP) {
  const next = Math.floor(currentCap / 2);
  return Math.max(minCap, next);
}

/**
 * Only 429 pauses the whole pool and drops concurrency.
 * Timeout / network (status 0) requeues with no wait.
 * Other retryable 5xx requeue; honor Retry-After if present, else a short gap.
 */
export function planArmadaRetry(status, retryAfter, attempts) {
  if (status === 429) {
    return {
      dropCap: true,
      cooldownMs: retryWaitMs(retryAfter, attempts),
    };
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return {
      dropCap: false,
      cooldownMs: retryAfter ? retryWaitMs(retryAfter, 0) : GATEWAY_GAP_MS,
    };
  }
  return { dropCap: false, cooldownMs: 0 };
}
