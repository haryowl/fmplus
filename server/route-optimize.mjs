/**
 * Pure TSP helpers for Route plan (haversine matrix + NN + 2-opt).
 * Used when OSRM is unavailable, and as order seed before OSRM route geometry.
 */

export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Build NxN distance matrix (km). points: {lat, lon}[] */
export function buildDistanceMatrix(points) {
  const n = points.length;
  const m = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversineKm(points[i].lat, points[i].lon, points[j].lat, points[j].lon);
      m[i][j] = d;
      m[j][i] = d;
    }
  }
  return m;
}

export function pathCost(order, matrix) {
  let sum = 0;
  for (let i = 0; i < order.length - 1; i++) {
    sum += matrix[order[i]][order[i + 1]];
  }
  return sum;
}

/** Fixed start at index 0; visit all others once. */
export function nearestNeighborOrder(matrix) {
  const n = matrix.length;
  if (n <= 1) return [...Array(n).keys()];
  const used = new Set([0]);
  const order = [0];
  while (order.length < n) {
    const last = order[order.length - 1];
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (used.has(j)) continue;
      const d = matrix[last][j];
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best < 0) break;
    used.add(best);
    order.push(best);
  }
  return order;
}

/** 2-opt on open path (start fixed at order[0]). */
export function twoOptImprove(order, matrix, maxPasses = 40) {
  if (order.length < 4) return order.slice();
  let best = order.slice();
  let improved = true;
  let passes = 0;
  while (improved && passes < maxPasses) {
    improved = false;
    passes += 1;
    for (let i = 1; i < best.length - 2; i++) {
      for (let k = i + 1; k < best.length - 1; k++) {
        const a = best[i - 1];
        const b = best[i];
        const c = best[k];
        const d = best[k + 1];
        const before = matrix[a][b] + matrix[c][d];
        const after = matrix[a][c] + matrix[b][d];
        if (after + 1e-9 < before) {
          const next = best.slice(0, i).concat(best.slice(i, k + 1).reverse(), best.slice(k + 1));
          best = next;
          improved = true;
        }
      }
    }
  }
  return best;
}

/**
 * @param {{ lat: number, lon: number }[]} points index 0 = start
 * @param {number[][] | null} [externalMatrix] optional distance matrix (same units)
 */
export function optimizeOpenTour(points, externalMatrix = null) {
  if (!points.length) return { order: [], distance: 0 };
  if (points.length === 1) return { order: [0], distance: 0 };
  const matrix = externalMatrix || buildDistanceMatrix(points);
  const nn = nearestNeighborOrder(matrix);
  const order = twoOptImprove(nn, matrix);
  return { order, distance: pathCost(order, matrix) };
}
