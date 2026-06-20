/*
 * 격자 기반 A* 길찾기.
 * 콜라이더(Box3 배열)를 에이전트 반경만큼 부풀려 점유 격자를 만들고,
 * 8방향 A*로 벽을 피하는 경로를 찾는다. (좀비가 벽에 비비지 않고 돌아오게)
 */
export function buildNav(colliders, min, max, cell, radius) {
  const nx = Math.ceil((max.x - min.x) / cell);
  const nz = Math.ceil((max.z - min.z) / cell);
  const blocked = new Uint8Array(nx * nz);

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const wx = min.x + (i + 0.5) * cell;
      const wz = min.z + (j + 0.5) * cell;
      let b = 0;
      for (const box of colliders) {
        if (wx > box.min.x - radius && wx < box.max.x + radius &&
            wz > box.min.z - radius && wz < box.max.z + radius) { b = 1; break; }
      }
      blocked[j * nx + i] = b;
    }
  }

  const idx = (i, j) => j * nx + i;
  const inB = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz;
  const toCell = (x, z) => [
    clamp(Math.floor((x - min.x) / cell), 0, nx - 1),
    clamp(Math.floor((z - min.z) / cell), 0, nz - 1),
  ];
  const toWorld = (i, j) => ({ x: min.x + (i + 0.5) * cell, z: min.z + (j + 0.5) * cell });

  function nearestFree(i, j) {
    if (inB(i, j) && !blocked[idx(i, j)]) return [i, j];
    for (let r = 1; r < 10; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          const ni = i + di, nj = j + dj;
          if (inB(ni, nj) && !blocked[idx(ni, nj)]) return [ni, nj];
        }
      }
    }
    return [i, j];
  }

  const DIRS = [
    [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
    [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
  ];
  const h = (i, j, gi, gj) => {
    const dx = Math.abs(i - gi), dy = Math.abs(j - gj);
    return (dx + dy) - 0.586 * Math.min(dx, dy); // octile
  };

  function findPath(startV, goalV) {
    let [si, sj] = toCell(startV.x, startV.z); [si, sj] = nearestFree(si, sj);
    let [gi, gj] = toCell(goalV.x, goalV.z); [gi, gj] = nearestFree(gi, gj);
    const start = idx(si, sj), goal = idx(gi, gj);
    if (start === goal) return [toWorld(gi, gj)];

    const came = new Int32Array(nx * nz).fill(-1);
    const g = new Float32Array(nx * nz).fill(Infinity);
    const f = new Float32Array(nx * nz).fill(Infinity);
    const inOpen = new Uint8Array(nx * nz);
    const open = [start];
    g[start] = 0; f[start] = h(si, sj, gi, gj); inOpen[start] = 1;

    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
      const cur = open[bi];
      open.splice(bi, 1); inOpen[cur] = 0;
      if (cur === goal) return reconstruct(came, cur);
      const ci = cur % nx, cj = (cur - ci) / nx;
      for (const [di, dj, cost] of DIRS) {
        const ni = ci + di, nj = cj + dj;
        if (!inB(ni, nj) || blocked[idx(ni, nj)]) continue;
        if (di !== 0 && dj !== 0 && (blocked[idx(ci + di, cj)] || blocked[idx(ci, cj + dj)])) continue; // 코너 컷 방지
        const n = idx(ni, nj);
        const ng = g[cur] + cost;
        if (ng < g[n]) {
          came[n] = cur; g[n] = ng; f[n] = ng + h(ni, nj, gi, gj);
          if (!inOpen[n]) { open.push(n); inOpen[n] = 1; }
        }
      }
    }
    return null; // 경로 없음
  }

  function reconstruct(came, cur) {
    const path = [];
    while (cur !== -1) {
      const ci = cur % nx, cj = (cur - ci) / nx;
      path.push(toWorld(ci, cj));
      cur = came[cur];
    }
    path.reverse();
    path.shift(); // 시작 셀 제거
    return path;
  }

  const cellId = (x, z) => { const [i, j] = toCell(x, z); return j * nx + i; };
  const isFree = (x, z) => { const [i, j] = toCell(x, z); return !blocked[idx(i, j)]; };

  function randomFreeNear(x, z, range) {
    for (let k = 0; k < 24; k++) {
      const rx = x + (Math.random() - 0.5) * 2 * range;
      const rz = z + (Math.random() - 0.5) * 2 * range;
      if (rx > min.x && rx < max.x && rz > min.z && rz < max.z && isFree(rx, rz)) return { x: rx, z: rz };
    }
    return { x, z };
  }

  return { findPath, cellId, isFree, randomFreeNear };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
