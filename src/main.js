import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { createRoom } from './room.js';
import { Player } from './player.js';
import { ProbeGI } from './gi.js';
import { Enemy } from './enemy.js';
import { createAudio } from './audio.js';
import { buildNav } from './nav.js';
import { loadTextures } from './textures.js';
import { loadProps, placeProp } from './props.js';

/*
 * HALF-LIGHT
 * --------------------------------------------------------------
 * 강의 매핑(리포트용):
 *  - 카메라/이동/점프: View Transform, LookAt, 변환 (L1)
 *  - 방 구조: Scene Graph 계층 (L1, L6)
 *  - 재질/조명: PBR, emissive, 직접광 (L4)
 *  - GI: probe 격자 DDGI -> indirect diffuse, color bleeding (GI 강의)
 *  - [TODO] 좀비: Skeleton/Animation, Mixamo OBJ/GLB (L6)
 *  - [TODO] 장애물/맵 텍스처(normal/AO/albedo) (L5)
 * --------------------------------------------------------------
 */

const canvas = document.getElementById('app');
const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const radEl = document.getElementById('rad');
const detEl = document.getElementById('detval');

// ---- 렌더러 ----
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

// ---- 씬 ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080a);
scene.fog = new THREE.FogExp2(0x05080a, 0.035);

// ---- 카메라 (1인칭) ----
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 4);

// ---- 컨트롤 (PointerLock) ----
const audio = createAudio();
const giStateEl = document.getElementById('gistate');
const objectiveEl = document.getElementById('objective');
const promptEl = document.getElementById('prompt');
const termCountEl = document.getElementById('termcount');
const doorStateEl = document.getElementById('doorstate');
const flareCountEl = document.getElementById('flarecount');
const staminaEl = document.getElementById('stamina');
const staminaBar = document.getElementById('staminabar');
const controls = new PointerLockControls(camera, document.body);
overlay.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => {
  overlay.classList.add('hidden'); hud.classList.remove('hidden');
  giStateEl.classList.remove('hidden'); objectiveEl.classList.remove('hidden');
  staminaEl.classList.remove('hidden');
  audio.start();
});
controls.addEventListener('unlock', () => {
  overlay.classList.remove('hidden'); hud.classList.add('hidden');
  giStateEl.classList.add('hidden'); objectiveEl.classList.add('hidden'); promptEl.classList.add('hidden');
  staminaEl.classList.add('hidden');
  audio.setChase(false);
});

// ---- 환경광(완전 암흑 방지용 베이스 가시성) ----
scene.add(new THREE.AmbientLight(0x2a302a, 0.25));

// ---- 헤드램프(손전등): 카메라를 따라다니는 SpotLight (F로 토글) ----
scene.add(camera); // 카메라의 자식 광원이 렌더되도록 씬에 추가
const headlamp = new THREE.SpotLight(0xfff1d0, 12, 24, Math.PI / 4.5, 0.4, 1.2);
headlamp.castShadow = false;
camera.add(headlamp);
headlamp.target.position.set(0, 0, -1);
camera.add(headlamp.target);
let lampOn = true;
const LAMP_INTENSITY = 12;

// ---- 텍스처(L5) ----
const mats = loadTextures(renderer);

// ---- 방 + 방사능 광원 ----
const room = createRoom(mats);
scene.add(room.group);
camera.position.copy(room.playerStart);

// ---- 플레이어 ----
const player = new Player(controls, room.colliders, room.lowBarriers, room.jumpBarriers);

// ---- GI: probe 격자 (확장 맵 내부를 덮음) ----
const gi = new ProbeGI(
  renderer, scene,
  new THREE.Vector3(-11, 0.6, -11),
  new THREE.Vector3(11, 3.4, 11),
  [7, 2, 7]
);
gi.applyToScene(room.group); // 모든 PBR 머티리얼에 indirect diffuse 주입

// ---- 정적 소품(Poly Haven glTF) 배치 + 실제 크기로 climbable 콜라이더 생성 ----
const _pbox = new THREE.Box3();
loadProps().then((tpl) => {
  const propsGroup = new THREE.Group();
  for (const p of room.propPlacements) {
    const t = tpl[p.type];
    if (!t) continue;
    const m = placeProp(t, { x: p.x, z: p.z, yaw: p.yaw, fitFootprint: p.fitFootprint, fitHeight: p.fitHeight });
    propsGroup.add(m);
    // 실제 모델 AABB -> 타고 넘는 장애물(jumpBarriers)로 등록 (윗면 높이 = 모델 높이)
    _pbox.setFromObject(m);
    room.jumpBarriers.push(new THREE.Box3(
      new THREE.Vector3(_pbox.min.x, 0, _pbox.min.z),
      new THREE.Vector3(_pbox.max.x, Math.min(_pbox.max.y, 1.3), _pbox.max.z)
    ));
  }
  for (const d of room.decorPlacements) {
    const t = tpl[d.type];
    if (!t) continue;
    const m = placeProp(t, { x: d.x, z: d.z, yaw: d.yaw, fitHeight: 0.12 });
    if (d.flat) m.rotation.x = -Math.PI / 2; // 바닥에 눕힘 (충돌 없음)
    propsGroup.add(m);
  }
  scene.add(propsGroup);
  gi.applyToScene(propsGroup);
  console.log('[Props] placed', room.propPlacements.length, '+ decor', room.decorPlacements.length);

  // 소품 콜라이더까지 포함해 길찾기 구성 후 좀비 로드
  const nav = buildNav(
    [...room.colliders, ...room.lowBarriers, ...room.jumpBarriers],
    new THREE.Vector3(-12, 0, -12), new THREE.Vector3(12, 0, 12),
    0.7, 0.45
  );
  loadEnemies(nav);
}).catch((e) => console.error('[Props] load failed', e));

// ---- 좀비: Mixamo FBX 로드 (idle 메쉬 + walk/run/attack 클립 결합) ----
const enemies = [];
const SPAWNS = room.enemySpawns;
const fbx = new FBXLoader();
const ZB = `${import.meta.env.BASE_URL}models/zombie1/`;
function loadFBX(url) {
  return new Promise((res, rej) => fbx.load(url, res, undefined, rej));
}
const ZB2 = `${import.meta.env.BASE_URL}models/zombie2/`;
function loadEnemies(nav) {
Promise.all([
  loadFBX(`${ZB}character.fbx`),  // 좀비1 텍스처 메쉬
  loadFBX(`${ZB2}character.fbx`), // 좀비2 텍스처 메쉬(다른 외형)
  loadFBX(`${ZB}idle.fbx`),
  loadFBX(`${ZB}walk.fbx`),
  loadFBX(`${ZB}run.fbx`),
  loadFBX(`${ZB}attack.fbx`),
  loadFBX(`${ZB}turn.fbx`),
  loadFBX(`${ZB}scream.fbx`),
  loadFBX(`${ZB}agonize.fbx`),
]).then(([character, character2, idle, walk, run, attack, turn, scream, agonize]) => {
  // 각 동작 FBX에서 '트랙이 가장 많은' 클립 선택(빈 클립 회피) + 이름 부여
  const clips = [];
  const bestClip = (grp, name) => {
    const list = grp.animations || [];
    let best = null;
    for (const c of list) if (!best || c.tracks.length > best.tracks.length) best = c;
    if (best && best.tracks.length > 0) { best.name = name; clips.push(best); }
  };
  bestClip(idle, 'Idle');
  bestClip(walk, 'Walk');
  bestClip(run, 'Run');
  bestClip(attack, 'Attack');
  bestClip(turn, 'Turn');
  bestClip(scream, 'Scream');
  bestClip(agonize, 'Agonize');

  // 임베드 텍스처 유지하되 Phong->Standard로 변환(GI·그림자 일관성)
  const hasImg = (t) => t && (t.image || (t.source && t.source.data));
  const fixMats = (root) => root.traverse((o) => {
    if (o.isMesh && o.material) {
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      const conv = arr.map((m) => {
        const s = new THREE.MeshStandardMaterial({
          map: hasImg(m.map) ? m.map : null,           // 이미지 있는 맵만(빈 슬롯 경고 방지)
          normalMap: hasImg(m.normalMap) ? m.normalMap : null,
          color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
          roughness: 0.9, metalness: 0.0,
        });
        if (s.map) s.map.colorSpace = THREE.SRGBColorSpace;
        return s;
      });
      o.material = Array.isArray(o.material) ? conv : conv[0];
    }
  });
  fixMats(character); fixMats(character2);

  // 두 외형을 번갈아 스폰 (clips는 Mixamo 공용 스켈레톤이라 둘 다 호환)
  const scenes = [character, character2];
  SPAWNS.forEach((sp, i) => {
    const e = new Enemy({ scene: scenes[i % scenes.length], animations: clips }, sp, nav);
    scene.add(e.group);
    gi.applyToScene(e.group);
    enemies.push(e);
  });
  console.log('[Enemy] zombies spawned', enemies.length, 'clips:', clips.map((c) => c.name));
}).catch((err) => console.error('[Enemy] FBX load FAILED', err));
}

// ---- 리사이즈 ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- GI 제어: G=on/off 토글, [ ]=세기 조절 (리포트 비교 + 실시간 튜닝) ----
let giOn = true;
let giStrength = gi.strength; // 기본 4.0
function updateGiHud() {
  giStateEl.classList.toggle('off', !giOn);
  giStateEl.innerHTML = giOn
    ? `GI: ON ×${giStrength.toFixed(1)} <span class="hint">(G 끄기 · [ ] 세기)</span>`
    : `GI: OFF <span class="hint">(G 켜기)</span>`;
}
const freeLookQuat = new THREE.Quaternion(); // Alt 자유시점 복귀용 저장
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyQ') {                         // Q 조명탄 던지기
    throwFlare();
  } else if (e.code === 'KeyE') {                  // E 단말기 활성화
    if (!controls.isLocked || gameOver || won) return;
    for (const tm of room.terminals) {
      if (tm.activated) continue;
      const d = Math.hypot(camera.position.x - tm.position.x, camera.position.z - tm.position.z);
      if (d < INTERACT_RADIUS) { activateTerminal(tm); break; }
    }
  } else if (e.code === 'KeyF') {                  // F 손전등 토글
    lampOn = !lampOn;
    headlamp.intensity = lampOn ? LAMP_INTENSITY : 0;
    console.log('[Lamp]', lampOn ? 'ON' : 'OFF');
  } else if (e.code === 'KeyG') {
    giOn = !giOn;
    gi.setStrength(giOn ? giStrength : 0.0);
    console.log('[GI]', giOn ? 'ON' : 'OFF');
    updateGiHud();
  } else if (e.code === 'BracketRight') {        // ] 세게
    giStrength = Math.min(16, giStrength + 1);
    if (giOn) gi.setStrength(giStrength);
    console.log('[GI] strength', giStrength);
    updateGiHud();
  } else if (e.code === 'BracketLeft') {          // [ 약하게
    giStrength = Math.max(0, giStrength - 1);
    if (giOn) gi.setStrength(giStrength);
    console.log('[GI] strength', giStrength);
    updateGiHud();
  } else if (e.code === 'AltLeft' || e.code === 'AltRight') { // Alt 자유 시점
    e.preventDefault();
    if (!player.freeLook && controls.isLocked) {
      freeLookQuat.copy(camera.quaternion); // 복귀용으로 현재 시점 저장
      player.enterFreeLook();
    }
  }
});
// Alt 떼면 원래 시점으로 스냅 복귀
window.addEventListener('keyup', (e) => {
  if ((e.code === 'AltLeft' || e.code === 'AltRight') && player.freeLook) {
    camera.quaternion.copy(freeLookQuat);
    player.exitFreeLook();
  }
});
updateGiHud();

// ---- 감지도 자동 보정 (베이크 후 맵을 샘플링해 SAFE/EXPOSED 결정) ----
const DET_NEAR = 1.2;      // 단말기에 이만큼 가까우면 노출도 100%
const DET_RANGE = 6.5;     // 이 거리 밖이면 0%
const LAMP_BASE = 35;      // 손전등 켜면 깔리는 기본 노출(피탐)
const _ray2 = new THREE.Ray();
const _b1 = new THREE.Vector3(), _b2 = new THREE.Vector3();
const _dir2 = new THREE.Vector3(), _hit2 = new THREE.Vector3();

// 플레이어 눈 -> 단말기 코어 사이가 벽/엄폐물에 가리나 (단말기 자체 박스는 무시)
function losToTerminal(tm) {
  _b1.set(camera.position.x, 1.6, camera.position.z);
  _b2.set(tm.position.x, 1.2, tm.position.z);
  _dir2.subVectors(_b2, _b1);
  const dist = _dir2.length();
  _dir2.normalize();
  _ray2.set(_b1, _dir2);
  for (const box of room.colliders) {
    if (tm.position.x > box.min.x && tm.position.x < box.max.x &&
        tm.position.z > box.min.z && tm.position.z < box.max.z) continue; // 단말기 자체
    if (_ray2.intersectBox(box, _hit2) && _b1.distanceTo(_hit2) < dist - 0.3) return false;
  }
  return true;
}

// 감지도 = 단말기에 대한 직접 노출(거리 + 가시선). 벽 너머/멀면 0%.
function computeDetection() {
  let best = 0;
  for (const tm of room.terminals) {
    const dist = Math.hypot(camera.position.x - tm.position.x, camera.position.z - tm.position.z);
    if (dist >= DET_RANGE) continue;
    if (!losToTerminal(tm)) continue; // 벽에 가리면 노출 없음
    best = Math.max(best, Math.min(1, (DET_RANGE - dist) / (DET_RANGE - DET_NEAR)));
  }
  return Math.round(best * 100);
}

// ---- 방사능 피폭: 누적분(영구) + 노출분(단말기 근처서 증가, 어둠서 회복) ----
// 누적분만으로 5분(=300s)에 100% 도달. 총합(누적+노출) 100% = 치사량 -> 사망.
const PERM_RATE = 100 / 300;   // %/s : 5분에 100%
const EXP_GAIN = 10;           // %/s : 단말기 바로 앞 노출(1.0)에서 최대 증가
const EXP_RECOVER = 12;        // %/s : 어두운 곳에서 노출분 회복
let radPerm = 0;   // 누적 피폭(영구)
let radExp = 0;    // 노출 피폭(회복 가능)
const radGeigerEl = document.getElementById('geiger');
const radPermBar = document.getElementById('radperm');
const radExpBar = document.getElementById('radexp');

function updateRadiation(dt) {
  // 누적분: 지하에 있는 한 계속 증가(회복 없음)
  radPerm += PERM_RATE * dt;

  // 노출분: 단말기 직접 노출(거리+가시선, 0~1)에 비례 증가 / 어두우면 회복
  const exposure01 = computeExposure() / 100; // 0~1
  if (exposure01 > 0.05) radExp += EXP_GAIN * exposure01 * dt;
  else radExp = Math.max(0, radExp - EXP_RECOVER * dt);
  radExp = Math.min(radExp, 100);

  const total = Math.min(100, radPerm + radExp);
  radEl.textContent = Math.round(total);
  radPermBar.style.width = Math.min(100, radPerm) + '%';
  radExpBar.style.width = Math.min(100 - Math.min(100, radPerm), radExp) + '%';
  radGeigerEl.classList.toggle('danger', total >= 80);
  return total;
}

// 노출도(빛) = 단말기 직접 노출(거리+가시선) + 손전등. 좀비가 '볼 때' 보이는지의 입력.
function computeExposure() {
  let e = computeDetection();
  if (lampOn) e = Math.max(e, LAMP_BASE);
  return e;
}

const _tmp = new THREE.Vector3();
const _fwd = new THREE.Vector3();
let awareness = 0; // 감지도 HUD = 실제로 좀비가 당신을 감지하는 정도(평활)

// ---- 베이크 오버레이 ----
function showBaking() {
  const d = document.createElement('div');
  d.id = 'baking';
  d.textContent = 'GI 베이킹 중... (probe 격자 + 멀티바운스)';
  Object.assign(d.style, {
    position: 'fixed', inset: '0', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: '#05080a', color: '#7dff5a',
    font: '1.1rem Consolas, monospace', zIndex: '20',
  });
  document.body.appendChild(d);
  return d;
}

// ---- 승패 ----
let gameOver = false;
let won = false;
let grace = 2.0; // 시작 직후 유예(초): 좀비가 바로 달려들지 않음
let noiseTimer = 0; // 점프/착지 소음 지속(초)
const gameoverEl = document.getElementById('gameover');
const winEl = document.getElementById('win');
document.getElementById('restart').addEventListener('click', () => location.reload());
document.getElementById('replay').addEventListener('click', () => location.reload());
const gameoverTitleEl = gameoverEl.querySelector('h1');
const gameoverDescEl = gameoverEl.querySelector('p');
function triggerGameOver(reason = 'zombie') {
  if (gameOver || won) return;
  gameOver = true;
  controls.unlock();
  if (reason === 'radiation') {
    gameoverTitleEl.textContent = '치사량 피폭';
    gameoverDescEl.textContent = '방사능 누적이 한계에 도달했습니다.';
  } else {
    gameoverTitleEl.textContent = '발각됨';
    gameoverDescEl.textContent = '좀비가 당신을 붙잡았습니다.';
  }
  gameoverEl.classList.remove('hidden');
}
function triggerWin() {
  if (gameOver || won) return;
  won = true;
  controls.unlock();
  winEl.classList.remove('hidden');
}

// ---- 목표: 터미널 활성화 -> 출구 개방 ----
const INTERACT_RADIUS = 2.2;
let activatedCount = 0;
let exitUnlocked = false;
let exitMats = [];
document.getElementById('termtotal').textContent = room.terminals.length;

const TERMINAL_NOISE = 16; // 활성화 시 좀비가 이 거리 안이면 몰려옴
function activateTerminal(tm) {
  tm.activated = true;
  tm.core.userData.activated = true;
  tm.core.material.emissive.setHex(0x39c0ff); // 활성화 표시(청록)
  activatedCount++;
  termCountEl.textContent = activatedCount;

  // 큰 소리 -> 주변 좀비가 단말기 위치로 몰려옴(전원 경보)
  audio.terminal();
  for (const e of enemies) {
    const d = Math.hypot(e.group.position.x - tm.position.x, e.group.position.z - tm.position.z);
    if (d < TERMINAL_NOISE) e.alertTo(tm.position);
  }
  if (activatedCount >= room.terminals.length) {
    exitUnlocked = true;
    doorStateEl.textContent = ' — 출구 개방!';
    for (const m of exitMats) m.color.setHex(0x39ff88); // 빨강 -> 초록
  }
}

// ---- 조명탄(미끼): 던진 곳 빛으로 좀비 유인 ----
// 광원/메쉬를 미리 풀로 만들어 재사용 -> 던질 때 씬에 light를 add/remove하지 않음
// (Three.js는 광원 개수가 바뀌면 모든 셰이더를 재컴파일 -> 렉. 풀링으로 방지.)
const FLARE_LIFE = 9, FLARE_LURE = 9, THROW_SPEED = 12;
const FLARE_POOL = 3;
let flareCount = 3;
const _throwDir = new THREE.Vector3();
const flarePool = [];
const FLARE_COLOR = 0xffa030;
for (let i = 0; i < FLARE_POOL; i++) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 12, 8),
    new THREE.MeshBasicMaterial({ color: FLARE_COLOR })
  );
  mesh.visible = false;
  const light = new THREE.PointLight(FLARE_COLOR, 0, 11, 2);
  scene.add(mesh);
  scene.add(light); // 시작 시 한 번만 add (intensity 0) -> 이후 재컴파일 없음

  // 불꽃 스파크(점 파티클) 풀 재사용
  const SPARKS = 24;
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xffd060, size: 0.05, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  sparks.frustumCulled = false; sparks.visible = false;
  scene.add(sparks);
  const sparkData = [];
  for (let k = 0; k < SPARKS; k++) sparkData.push({ life: 0, v: new THREE.Vector3(), p: new THREE.Vector3() });

  flarePool.push({
    mesh, light, active: false, vel: new THREE.Vector3(), life: 0, landed: false,
    sparks, sparkPos, sparkGeo, sparkData, sparkTimer: 0,
  });
}
function throwFlare() {
  if (flareCount <= 0 || !controls.isLocked || gameOver || won) return;
  const f = flarePool.find((p) => !p.active);
  if (!f) return;
  flareCount--; flareCountEl.textContent = flareCount;
  f.active = true; f.life = FLARE_LIFE; f.landed = false;
  f.mesh.visible = true; f.sparks.visible = true;
  for (const s of f.sparkData) s.life = 0;
  f.mesh.position.copy(camera.position);
  f.light.position.copy(camera.position);
  camera.getWorldDirection(_throwDir);
  f.vel.copy(_throwDir).multiplyScalar(THROW_SPEED); f.vel.y += 3;
  audio.flare();
}
function updateFlares(dt) {
  for (const f of flarePool) {
    if (!f.active) continue;
    if (!f.landed) {
      f.vel.y -= 18 * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      if (f.mesh.position.y <= 0.12) { f.mesh.position.y = 0.12; f.landed = true; }
    }
    f.light.position.copy(f.mesh.position);
    f.life -= dt;
    const fade = Math.min(1, f.life / 2);
    f.light.intensity = (f.landed ? 3.2 : 1.0) * fade * (0.85 + 0.15 * Math.sin(clock.elapsedTime * 25));

    // 불꽃: 구체 위치에서 스파크 방출
    f.sparkTimer -= dt;
    const emit = fade > 0.05 ? 2 : 0;
    if (f.sparkTimer <= 0 && emit) {
      f.sparkTimer = 0.04;
      let spawned = 0;
      for (const s of f.sparkData) {
        if (s.life <= 0) {
          s.life = 0.3 + Math.random() * 0.35;
          s.p.copy(f.mesh.position);
          s.v.set((Math.random() - 0.5) * 2.2, 1.4 + Math.random() * 2.2, (Math.random() - 0.5) * 2.2);
          if (++spawned >= emit) break;
        }
      }
    }
    let w = 0;
    for (const s of f.sparkData) {
      if (s.life > 0) {
        s.life -= dt; s.v.y -= 6 * dt; s.p.addScaledVector(s.v, dt);
        f.sparkPos[w * 3] = s.p.x; f.sparkPos[w * 3 + 1] = s.p.y; f.sparkPos[w * 3 + 2] = s.p.z;
      } else {
        f.sparkPos[w * 3] = 9999; f.sparkPos[w * 3 + 1] = 9999; f.sparkPos[w * 3 + 2] = 9999;
      }
      w++;
    }
    f.sparkGeo.attributes.position.needsUpdate = true;

    if (f.life <= 0) { f.active = false; f.mesh.visible = false; f.sparks.visible = false; f.light.intensity = 0; }
  }
}
function flareLure() {
  for (const f of flarePool) {
    if (!f.active || !f.landed) continue;
    for (const e of enemies) {
      const d = Math.hypot(e.group.position.x - f.mesh.position.x, e.group.position.z - f.mesh.position.z);
      if (d < FLARE_LURE) e.alertTo(f.mesh.position);
    }
  }
}

// ---- 탈출 비콘 (어두운 구석). GI 베이크 후 생성 -> 감지도에 영향 없음 ----
const EXIT_POS = room.exitPos.clone();
const WIN_RADIUS = 1.3;
let exitMesh = null;
function spawnExit() {
  const g = new THREE.Group();
  const lockedColor = 0xff5a4a; // 잠김=빨강 (개방 시 초록)
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 2.2, 0.5),
    new THREE.MeshBasicMaterial({ color: lockedColor })
  );
  slab.position.y = 1.1; g.add(slab);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.95, 24),
    new THREE.MeshBasicMaterial({ color: lockedColor, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
  g.position.copy(EXIT_POS);
  scene.add(g);
  exitMesh = g;
  exitMats = [slab.material, ring.material];
}

// ---- 루프 ----
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (controls.isLocked && !gameOver && !won) {
    // 방사능 누적 -> 100% 도달 시 사망
    const totalRad = updateRadiation(dt);
    if (totalRad >= 100) triggerGameOver('radiation');

    player.update(dt);
    camera.getWorldDirection(_fwd); // 손전등 방향
    updateFlares(dt);
    staminaBar.style.width = (player.stamina * 100) + '%';
    staminaBar.classList.toggle('low', player.exhausted);

    // 사운드: 발소리(앉으면 무음) + 심박음(감지도 = awareness, 직전 프레임)
    audio.update(dt, player.moving && player.onGround && !player.crouch, player.running, awareness);

    // 점프/착지 소리 + 소음 스파이크
    if (player.justJumped) { audio.jump(); player.justJumped = false; noiseTimer = 0.4; }
    if (player.justLanded) { audio.land(); player.justLanded = false; noiseTimer = 0.6; }
    if (noiseTimer > 0) noiseTimer -= dt;

    // 자세별 소음 = 좀비 청취 거리(벽 너머도 들림)
    let hearRange;
    if (!player.moving) hearRange = player.crouch ? 1.5 : 2.5;
    else if (player.crouch) hearRange = 2.5;
    else if (player.running) hearRange = 9;
    else hearRange = 5.5;
    if (noiseTimer > 0) hearRange = Math.max(hearRange, 8);

    // 시작 유예
    if (grace > 0) grace -= dt;
    const canSense = grace <= 0;

    // 노출도(빛): 좀비가 '볼 때' 보이는지의 입력 (벽이 가리면 시야 자체가 막힘)
    const exposure = computeExposure();

    if (canSense) flareLure();

    // 협공: '동시에' 추격 중인 좀비가 2마리 이상일 때만 좌/우로 갈라 몰아감.
    // 한 마리만 걸리면 똑바로 직접 추격.
    const chasers = enemies.filter((e) => e.sensing || e.alert > 0); // 실제 추격 중만 협공
    if (chasers.length >= 2) {
      let side = 1;
      for (const e of chasers) { e.flank = side; side = -side; }
    } else {
      for (const e of enemies) e.flank = 0;
    }

    let aware = 0;
    for (const e of enemies) {
      e.update(dt, camera.position, exposure, room.colliders, lampOn, _fwd, hearRange, canSense);
      if (e.caught()) triggerGameOver();
      if (e.sensing) aware = 100;                 // 직접 감지(추격) 중
      else if (e.alert > 0) aware = Math.max(aware, 65); // 놓친 직후 추격 수색
      else if (e.investigate > 0) aware = Math.max(aware, 35); // 소리 듣고 확인하러 옴
    }
    // 좀비끼리 겹침 방지
    for (const e of enemies) e.separate(enemies, room.colliders);
    // 감지도 HUD = 실제 좀비 감지 정도(평활)
    awareness += (aware - awareness) * Math.min(1, dt * 8);
    detEl.textContent = Math.round(awareness);

    // 긴박 BGM: 좀비가 추격/수색 중이면 추격 음악, 잠잠해지면 평상시로
    audio.setChase(awareness > 45);

    // 상호작용/목표 프롬프트
    let prompt = '';
    let nearTerm = false, nd = INTERACT_RADIUS;
    for (const tm of room.terminals) {
      if (tm.activated) continue;
      const d = Math.hypot(camera.position.x - tm.position.x, camera.position.z - tm.position.z);
      if (d < nd) { nd = d; nearTerm = true; }
    }
    if (nearTerm) prompt = '[E] 단말기 활성화';

    // 탈출구: 모든 단말기 활성화 시에만 승리
    if (exitMesh) {
      const ed = Math.hypot(camera.position.x - EXIT_POS.x, camera.position.z - EXIT_POS.z);
      if (ed < WIN_RADIUS) {
        if (exitUnlocked) triggerWin();
        else prompt = `잠김 — 단말기를 모두 활성화하라 (${activatedCount}/${room.terminals.length})`;
      }
    }

    if (prompt) { promptEl.textContent = prompt; promptEl.classList.remove('hidden'); }
    else promptEl.classList.add('hidden');
  }
  // 비콘 점멸
  if (exitMesh) exitMesh.scale.setScalar(1 + 0.06 * Math.sin(clock.elapsedTime * 4));
  room.tick(clock.elapsedTime);
  renderer.render(scene, camera);
}

// ---- 시작: 한 프레임 그려서 셰이더 컴파일 -> GI 베이크 -> 루프 ----
const baking = showBaking();
renderer.render(scene, camera); // 머티리얼 컴파일(주입 활성화)
requestAnimationFrame(() => requestAnimationFrame(() => {
  gi.bake(3);            // 3패스 멀티바운스(화면 비주얼용 GI)
  spawnExit();           // 베이크 후 생성
  baking.remove();
  animate();
}));
