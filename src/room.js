import * as THREE from 'three';

/*
 * 폐허 맵 (확장판) — 빛/그림자로 스텔스 루트가 생기도록 설계.
 *  - 외벽 + 내부 기둥/칸막이(빛 차단 -> 어두운 안전지대 + GI 색번짐)
 *  - 엄폐용 상자(cover). [TODO] L5에서 OBJ+텍스처로 교체
 *  - 방사능 드럼통(emissive 광원) 여러 개 -> 일부 구역만 밝게
 *
 * 반환: group, colliders, radSources, tick(t),
 *       playerStart, exitPos, enemySpawns  (레이아웃 좌표)
 */
const W = 24, D = 24, H = 4;

export function createRoom(mats) {
  const group = new THREE.Group();
  const colliders = [];
  const radSources = [];
  const lowBarriers = [];   // 앉아야 통과(개구멍)
  const jumpBarriers = [];  // 점프해야 통과(낮은 잔해)

  // 텍스처 위에 색을 곱해 GI 색번짐 유지(외벽 틴트). map 타일은 면 크기에 맞게 복제.
  const tinted = (hex, repeatX, repeatY) => {
    const m = mats.wall.clone();
    m.color = new THREE.Color(hex);
    for (const k of ['map', 'normalMap', 'roughnessMap']) {
      if (m[k]) { m[k] = m[k].clone(); m[k].needsUpdate = true; m[k].repeat.set(repeatX, repeatY); }
    }
    return m;
  };

  // 바닥/천장
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mats.floor);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  group.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mats.ceil);
  ceil.rotation.x = Math.PI / 2; ceil.position.y = H;
  group.add(ceil);

  // 외벽(텍스처 + 색 틴트 -> GI 번짐 확인)
  const walls = [
    { c: 0x995555, p: [0, H / 2, -D / 2], r: 0 },
    { c: 0x5566aa, p: [0, H / 2, D / 2], r: Math.PI },
    { c: 0x668855, p: [-W / 2, H / 2, 0], r: Math.PI / 2 },
    { c: 0xaa8855, p: [W / 2, H / 2, 0], r: -Math.PI / 2 },
  ];
  for (const w of walls) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(W, H), tinted(w.c, 6, 1.5));
    m.position.set(...w.p); m.rotation.y = w.r; m.receiveShadow = true;
    group.add(m);
  }
  const t = 0.5;
  pushBox(colliders, -W / 2 - t, -D / 2 - t, W / 2 + t, -D / 2);
  pushBox(colliders, -W / 2 - t, D / 2, W / 2 + t, D / 2 + t);
  pushBox(colliders, -W / 2 - t, -D / 2 - t, -W / 2, D / 2 + t);
  pushBox(colliders, W / 2, -D / 2 - t, W / 2 + t, D / 2 + t);

  // 가로 벽(미로) — 좌우 교차 8m 틈. wall1/wall3 좌측엔 특수 통로(점프/개구멍).
  const pillarMat = tinted(0x888888, 4, 1);
  const barrierMat = tinted(0x777766, 2, 0.6);
  const addWall = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), pillarMat);
    m.position.set(x, H / 2, z); m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    pushBox(colliders, x - w / 2, z - d / 2, x + w / 2, z + d / 2);
  };

  addWall(4, -1, 16, 0.6); // wall2 (좌측 틈)
  addWall(4, 8, 16, 0.6);  // wall4 (좌측 틈)

  // wall1 (z=-6): 우측 8m 틈 + 좌측(x≈-8)에 '점프 노치'(낮은 잔해)
  addWall(-10.55, -6, 2.9, 0.6);
  addWall(-1.45, -6, 10.9, 0.6);
  {
    const x = -8, z = -6, w = 2.2, top = 1.0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, top, 0.6), barrierMat);
    m.position.set(x, top / 2, z); m.castShadow = true; group.add(m);
    jumpBarriers.push(new THREE.Box3(new THREE.Vector3(x - w / 2, 0, z - 0.3), new THREE.Vector3(x + w / 2, top, z + 0.3)));
  }

  // wall3 (z=4): 우측 8m 틈 + 좌측(x≈-8)에 '개구멍'(빔 아래로 기어가기)
  addWall(-10.55, 4, 2.9, 0.6);
  addWall(-1.45, 4, 10.9, 0.6);
  {
    const x = -8, z = 4, w = 2.2, bottom = 1.3, topY = 2.6;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, topY - bottom, 0.6), barrierMat);
    m.position.set(x, (bottom + topY) / 2, z); m.castShadow = true; group.add(m);
    lowBarriers.push(new THREE.Box3(new THREE.Vector3(x - w / 2, 0, z - 0.3), new THREE.Vector3(x + w / 2, H, z + 0.3)));
  }

  // 엄폐용 소품(콜라이더는 props 로드 후 실제 크기로 생성 -> 타고 넘는 장애물)
  const propPlacements = [];
  const coverTypes = ['barrel', 'stove', 'trash', 'chest', 'barrel', 'stove'];
  const crates = [[1, -9], [8, -9.5], [-8, -3], [1, 1.5], [-2, 6], [9, 5]];
  crates.forEach(([x, z], i) => {
    propPlacements.push({ type: coverTypes[i], x, z, yaw: Math.random() * Math.PI * 2, fitHeight: 1.0 });
  });

  // 콘크리트 도로 바리어 (폐건물 잔해) — 콜라이더만, 시각은 props 로드 후.
  // [x, z, footprint, yaw] — 외벽 따라 배치, 통로 막지 않음.
  const barriers = [
    [-3, -11.3, 1.4, 0], [6, -11.3, 1.4, 0.1],
    [-7, 11.3, 1.4, 0.05], [2.5, 11.3, 1.4, -0.1],
    [-11.3, -2, 1.4, Math.PI / 2], [-11.3, 6.5, 1.4, Math.PI / 2],
    [11.3, -2, 1.4, Math.PI / 2], [11.3, 8.5, 1.4, Math.PI / 2],
  ];
  barriers.forEach(([x, z, fit, yaw], i) => {
    propPlacements.push({ type: i % 2 ? 'barrier2' : 'barrier1', x, z, yaw, fitFootprint: fit });
  });

  // 렌치(바닥에 널브러진 장식, 충돌 없음) — 공구함 근처
  const decorPlacements = [
    { type: 'wrench', x: 1.7, z: -9, yaw: 0.6, flat: true },
    { type: 'wrench', x: -8.6, z: -3.3, yaw: 2.1, flat: true },
  ];

  // 방사능 단말기(터미널) = emissive 광원 + 활성화 대상. 4개 다 켜야 출구 개방.
  const terminals = [];
  const termSpots = [[-6, -9, 2.6], [7, -4, 2.4], [-8, 1, 2.2], [8, 6, 2.4], [8, 10, 2.4]];
  for (const [x, z, strength] of termSpots) {
    const b = makeRadBarrel(0x7dff5a, strength, mats.barrel);
    b.position.set(x, 0, z);
    group.add(b);
    radSources.push(b.userData.core);
    pushBox(colliders, x - 0.6, z - 0.6, x + 0.6, z + 0.6);
    terminals.push({
      group: b,
      core: b.userData.core,
      light: b.userData.core.userData.light,
      position: new THREE.Vector3(x, 0, z),
      activated: false,
    });
  }

  function tick(time) {
    for (const src of radSources) {
      if (src.userData.activated) { // 활성화된 단말기는 점멸 멈추고 안정
        src.material.emissiveIntensity = src.userData.baseEmissive;
        if (src.userData.light) src.userData.light.intensity = src.userData.baseLight;
        continue;
      }
      const flick = 0.85 + 0.15 * Math.sin(time * 3 + src.position.x);
      src.material.emissiveIntensity = src.userData.baseEmissive * flick;
      if (src.userData.light) src.userData.light.intensity = src.userData.baseLight * flick;
    }
  }

  return {
    group, colliders, radSources, tick, terminals, lowBarriers, jumpBarriers,
    propPlacements, decorPlacements,
    playerStart: new THREE.Vector3(9.5, 1.6, -10),     // 우하단 시작
    exitPos: new THREE.Vector3(-9.5, 0, 10),           // 좌상단 출구(반대편)
    enemySpawns: [new THREE.Vector3(0, 0, -3), new THREE.Vector3(0, 0, 6)],
    bounds: { W, D, H },
  };
}

function makeRadBarrel(color, strength, bodyMat) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 1.1, 16),
    bodyMat // 금속 + 환경맵 반사
  );
  body.position.y = 0.55; body.castShadow = true; g.add(body);

  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.3, 0.25, 16),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: new THREE.Color(color), emissiveIntensity: 2.0 })
  );
  core.position.y = 1.2; g.add(core);

  const light = new THREE.PointLight(color, strength, 15, 2.0);
  light.position.y = 1.2; light.castShadow = true; light.shadow.mapSize.set(512, 512);
  g.add(light);

  core.userData.strength = strength;
  core.userData.baseEmissive = 2.0;
  core.userData.baseLight = strength;
  core.userData.light = light;
  g.userData.core = core;
  return g;
}

function pushBox(arr, minx, minz, maxx, maxz) {
  arr.push(new THREE.Box3(new THREE.Vector3(minx, 0, minz), new THREE.Vector3(maxx, H, maxz)));
}
