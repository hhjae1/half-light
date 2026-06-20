import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

/*
 * Enemy(좀비) — 스킨드 메쉬(GLB) + 스켈레톤 애니메이션.
 * --------------------------------------------------------------
 * 강의 매핑: Skeleton/Skinning/Animation (L6)
 *   - GLB의 뼈대(Skeleton)와 스키닝 메쉬, AnimationMixer로 클립 재생
 *   - SkeletonUtils.clone 으로 인스턴스마다 독립 스켈레톤
 *
 * 메커니즘: "눈이 멀어 빛(감지도)으로 사냥"
 *   - 감지도 높음 -> 추적(Run), 감지도 낮음 -> 배회(Walk), 정지 -> Idle
 *   - 접촉(catchRadius) -> 발각/게임오버
 */
const CHASE_SPEED = 3.5;    // m/s (플레이어 달리기 4.6보다 약간 느림 -> 달려야 도망 가능)
const SEARCH_SPEED = 2.2;   // 마지막 목격 위치 수색 속도
const WANDER_SPEED = 0.7;
const SIGHT_MIN = 2.0;        // 완전한 어둠에서도 '보이는' 최소 거리(코앞)
const SIGHT_MAX = 14;         // 완전히 밝을 때(노출100) 시야 거리(m)
const FOV_HALF = Math.PI / 3; // 시야각 반각 (60° -> 총 120°)
const CLOSE_RANGE = 2.2;      // 근접 감지(소리/냄새): 시야 밖/어둠이어도(코앞)
const LAMP_RANGE = 22;        // 손전등 사거리
const LAMP_HALF = Math.PI / 5;// 손전등 조준 반각(이 안에 좀비가 들면 발각)
const MEMORY_TIME = 5.0;    // 놓친 뒤 마지막 위치를 수색하는 시간(초)
const CATCH_RADIUS = 0.9;
const TARGET_HEIGHT = 1.8;  // 모델 키(m)로 정규화
const MODEL_YAW = 0;        // 모델 정면 보정(Mixamo 좀비는 +Z 정면)

export class Enemy {
  constructor(gltf, spawnPos, nav) {
    this.radius = 0.35;
    this.nav = nav;
    this.group = new THREE.Group();
    this.group.position.copy(spawnPos);

    // 독립 스켈레톤으로 복제
    const model = cloneSkeleton(gltf.scene);
    model.updateMatrixWorld(true);

    // 키 정규화 + 발을 바닥(y=0)에
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    const h = size.y > 0.001 ? size.y : 1;
    const s = TARGET_HEIGHT / h;
    model.scale.setScalar(s);
    model.position.y = -box.min.y * s;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false; // 스킨드 메쉬 컬링으로 사라지는 문제 방지
      }
    });
    this.group.add(model);
    console.log('[Enemy] model size', size.toArray().map((n) => n.toFixed(2)), 'scale', s.toFixed(3));

    // 애니메이션
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of gltf.animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    this.current = null;
    this.currentAction = null;
    this._setAction('Idle');

    this.goal = spawnPos.clone();      // 최종 목적지
    this.lastKnown = spawnPos.clone(); // 마지막 목격 위치
    this.alert = 0;                    // 추격 기억(직접 본 뒤 놓침) — 뛰어서 수색
    this.investigate = 0;              // 수색(소리 들음, 본 적 없음) — 걸어서 확인
    this.investigatePos = spawnPos.clone();
    this.wanderTimer = 0;
    // 길찾기 상태
    this.path = null;
    this.wp = 0;
    this.pathTimer = 0;
    this.lastGoalCell = -1;
    this.distToPlayer = 999;
    this.sensing = false; // 현재 플레이어를 감지 중인가(시야/소리/손전등)
    this.prevSensing = false; this.wasInvestigating = false; // 리액션 엣지 감지
    this.reactionTime = 0; this.screamCD = 0;                // 리액션 재생 시간 / 비명 쿨다운
    this.flank = 0;       // 추격 시 측면 몰이 방향(-1/0/+1), main이 역할 분담으로 지정
    this._tmp = new THREE.Vector3();
    this.facing = new THREE.Vector3(0, 0, 1); // 바라보는 방향(이동 방향)
    this.curYaw = 0; this.targetYaw = 0;      // 부드러운 회전용
    this._ray = new THREE.Ray();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._hit = new THREE.Vector3();
  }

  _setAction(name) {
    if (this.current === name) return;
    const next = this.actions[name] || Object.values(this.actions)[0];
    if (!next) return;
    if (this.currentAction) this.currentAction.fadeOut(0.2);
    next.setLoop(THREE.LoopRepeat, Infinity); // 한번재생(LoopOnce)으로 쓰였던 클립도 다시 루프로
    next.clampWhenFinished = false;
    next.reset().fadeIn(0.2).play();
    this.currentAction = next;
    this.current = name;
  }

  // 한 번만 재생되는 리액션(비명/괴로워함). 끝까지 멈춰 있다가 normal로 복귀.
  _playOnce(name, dur) {
    const a = this.actions[name];
    if (!a) return;
    if (this.currentAction) this.currentAction.fadeOut(0.12);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.fadeIn(0.12).play();
    this.currentAction = a;
    this.current = name;
    this.reactionTime = dur;
  }

  update(dt, playerPos, detection, colliders, lampOn, lampDir, hearRange = CLOSE_RANGE, canSense = true) {
    const pos = this.group.position;
    // 수평(XZ) 거리로 판정 (카메라 눈높이 1.6m 차이 무시)
    this.distToPlayer = Math.hypot(pos.x - playerPos.x, pos.z - playerPos.z);

    // 소리/근접 감지(방향 무관). 단, 조명탄/소리에 시선이 끌려 수색 중이면
    // 딴 데 정신이 팔려 청취 범위가 줄어듦 -> 작은 소리(앉아 걷기)는 잘 못 들음.
    // 큰 소리(달리기·점프=hearRange 큼)나 바로 옆(2m 이내)은 그래도 감지.
    const distracted = this.investigate > 0 && this.alert <= 0;
    const effHear = distracted ? Math.max(2.0, hearRange * 0.45) : hearRange;
    const near = this.distToPlayer < effHear;
    const seen = this._seesPlayer(pos, playerPos, detection, colliders);  // 시야각+밝기+가림
    const litByLamp = lampOn && this._inFlashlight(pos, playerPos, lampDir, colliders); // 손전등 피격
    const sensing = canSense && (near || seen || litByLamp);              // 시작 유예 중엔 감지 off
    this.sensing = sensing;
    if (sensing) { this.lastKnown.copy(playerPos); this.alert = MEMORY_TIME; }

    // --- 리액션 트리거 ---
    if (this.screamCD > 0) this.screamCD -= dt;
    // 처음 발각: 비명 한 번 지르고 추격 시작
    if (sensing && !this.prevSensing && this.screamCD <= 0) {
      this._playOnce('Scream', 1.6); this.screamCD = 6;
    }
    this.prevSensing = sensing;
    // 조명탄/소리 첫 인지: 괴로워하며 반응
    const investigating = this.investigate > 0;
    if (investigating && !this.wasInvestigating && !sensing && this.alert <= 0) {
      this._playOnce('Agonize', 1.4);
    }
    this.wasInvestigating = investigating;

    // 리액션 재생 중엔 제자리에서 모션만(이동 없음)
    if (this.reactionTime > 0) {
      this.reactionTime -= dt;
      this.mixer.update(dt);
      return;
    }

    let speed = 0, moveAnim = 'Walk', stillAnim = 'Idle', stop = false;
    if (sensing) {
      // 추격 — flank가 지정되면 측면으로 몰아가기(양옆 협공)
      this.goal.copy(playerPos);
      if (this.flank !== 0) {
        const dx = pos.x - playerPos.x, dz = pos.z - playerPos.z;
        const d = Math.hypot(dx, dz) || 1;
        const px = -dz / d, pz = dx / d;            // 접근선의 수직
        const off = Math.min(2.5, Math.max(0, d - 2)) * this.flank;
        const gx = playerPos.x + px * off, gz = playerPos.z + pz * off;
        // 측면 지점이 walkable이고 벽에 안 가릴 때만 협공(아니면 직접 추격 -> 벽 빙 도는 것 방지)
        if (this.nav.isFree(gx, gz) && !this._losBlocked(playerPos, { x: gx, z: gz }, colliders)) {
          this.goal.set(gx, 0, gz);
        }
      }
      speed = CHASE_SPEED * (0.85 + 0.15 * Math.min(detection, 100) / 100);
      moveAnim = 'Run';
    } else if (this.alert > 0) {
      // 직접 본 뒤 놓침 -> 마지막 목격 위치로 '뛰어서' 수색
      this.alert -= dt;
      this.goal.copy(this.lastKnown);
      speed = CHASE_SPEED;
      moveAnim = 'Run';
      if (pos.distanceTo(this.lastKnown) < 0.6) this.alert = 0;
    } else if (this.investigate > 0) {
      // 소리/조명탄 인지 -> 걸어서 확인. 도착하면 (조명탄 꺼질 때까지) 괴로워함.
      this.investigate -= dt;
      if (pos.distanceTo(this.investigatePos) > 0.9) {
        this.goal.copy(this.investigatePos);
        speed = SEARCH_SPEED;
        moveAnim = 'Walk';
      } else {
        // 도착: 제자리에서 그쪽 바라보며 Agonize 루프 (investigate 만료=조명탄 소멸까지)
        stop = true;
        stillAnim = 'Agonize';
        this.targetYaw = Math.atan2(this.investigatePos.x - pos.x, this.investigatePos.z - pos.z);
      }
    } else {
      // 배회 (걸을 수 있는 칸으로)
      speed = WANDER_SPEED;
      moveAnim = 'Walk';
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0 || pos.distanceTo(this.goal) < 0.6) {
        this.wanderTimer = 2 + Math.random() * 3;
        const w = this.nav.randomFreeNear(pos.x, pos.z, 7);
        this.goal.set(w.x, 0, w.z);
      }
    }

    // 길찾기로 다음 waypoint 결정
    const wp = this._waypoint(pos, dt);
    this._tmp.set(wp.x - pos.x, 0, wp.z - pos.z);
    const len = this._tmp.length();
    const wantMove = !stop && len > 0.06;

    // 목표 방향(yaw) -> 부드럽게 회전
    if (wantMove) this.targetYaw = Math.atan2(this._tmp.x, this._tmp.z);
    let dYaw = this.targetYaw - this.curYaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const TURN_SPEED = 8; // rad/s
    this.curYaw += Math.sign(dYaw) * Math.min(Math.abs(dYaw), TURN_SPEED * dt);
    this.group.rotation.y = this.curYaw + MODEL_YAW;
    this.facing.set(Math.sin(this.curYaw), 0, Math.cos(this.curYaw)); // 시야=바라보는 방향

    // 크게 방향이 틀어지면 제자리에서 Turn 모션으로 돌고, 정렬되면 전진
    const aligning = wantMove && Math.abs(dYaw) > 1.4;
    let anim;
    if (aligning) {
      anim = 'Turn';
    } else if (wantMove) {
      this._tmp.multiplyScalar((speed * dt) / len);
      this._moveAxis(this._tmp.x, 0, colliders);
      this._moveAxis(0, this._tmp.z, colliders);
      anim = moveAnim;
    } else {
      anim = stillAnim; // Idle 또는 (조명탄 도착 시) Agonize 루프
    }

    this._setAction(anim);
    this.mixer.update(dt);
  }

  // A* 경로의 다음 waypoint (없으면 목적지 직접). 0.3초/목적지셀 변경 시 재계산.
  _waypoint(pos, dt) {
    this.pathTimer -= dt;
    const gc = this.nav.cellId(this.goal.x, this.goal.z);
    if (this.pathTimer <= 0 || gc !== this.lastGoalCell) {
      this.pathTimer = 0.3;
      this.lastGoalCell = gc;
      this.path = this.nav.findPath(pos, this.goal);
      this.wp = 0;
    }
    if (this.path && this.path.length) {
      let w = this.path[this.wp];
      while (w && Math.hypot(pos.x - w.x, pos.z - w.z) < 0.5) { this.wp++; w = this.path[this.wp]; }
      if (w) return w;
    }
    return this.goal; // 경로 없으면 직접 향함
  }

  _moveAxis(dx, dz, colliders) {
    const p = this.group.position;
    const nx = p.x + dx, nz = p.z + dz;
    if (!this._blocked(nx, nz, colliders)) { p.x = nx; p.z = nz; }
  }

  _blocked(x, z, colliders) {
    const r = this.radius;
    for (const b of colliders) {
      if (x + r > b.min.x && x - r < b.max.x && z + r > b.min.z && z - r < b.max.z) return true;
    }
    return false;
  }

  // 시야 판정: 밝기 + 거리 + 시야각 + 가림(LOS)
  _seesPlayer(pos, playerPos, exposure, colliders) {
    const dx = playerPos.x - pos.x, dz = playerPos.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-3) return false;
    // 밝을수록 멀리서, 어두우면 코앞에서만 보인다(노출도에 비례한 시야 거리)
    const sightRange = SIGHT_MIN + (SIGHT_MAX - SIGHT_MIN) * (Math.min(exposure, 100) / 100);
    if (dist > sightRange) return false;
    const cos = (this.facing.x * dx + this.facing.z * dz) / dist;
    if (cos < Math.cos(FOV_HALF)) return false;              // 시야각 밖(등 뒤 등)
    return !this._losBlocked(pos, playerPos, colliders);     // 벽/엄폐물에 가리면 안 보임
  }

  // 플레이어 손전등 빔 안에 좀비가 들어왔나 (등 돌리고 있어도 발각)
  _inFlashlight(pos, playerPos, lampDir, colliders) {
    const dx = pos.x - playerPos.x, dz = pos.z - playerPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > LAMP_RANGE || dist < 1e-3) return false;
    const ll = Math.hypot(lampDir.x, lampDir.z) || 1;
    const cos = (lampDir.x * dx + lampDir.z * dz) / (ll * dist);
    if (cos < Math.cos(LAMP_HALF)) return false;             // 빔 밖
    return !this._losBlocked(playerPos, pos, colliders);     // 벽에 가리면 안 비춰짐
  }

  // 좀비 눈(1.2m) -> 플레이어 가슴(1.4m) 사이에 콜라이더가 있나
  _losBlocked(pos, playerPos, colliders) {
    this._a.set(pos.x, 1.2, pos.z);
    this._b.set(playerPos.x, 1.4, playerPos.z);
    this._dir.subVectors(this._b, this._a);
    const dist = this._dir.length();
    this._dir.normalize();
    this._ray.set(this._a, this._dir);
    for (const box of colliders) {
      if (this._ray.intersectBox(box, this._hit) && this._a.distanceTo(this._hit) < dist - 0.4) {
        return true;
      }
    }
    return false;
  }

  // 좀비끼리 겹침 방지: 다른 좀비와 너무 가까우면 서로 밀어냄(벽은 침범 안 함)
  separate(others, colliders) {
    const minDist = this.radius * 2 + 0.2;
    const pos = this.group.position;
    let mx = 0, mz = 0;
    for (const o of others) {
      if (o === this) continue;
      const dx = pos.x - o.group.position.x, dz = pos.z - o.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-3 && d < minDist) {
        const push = (minDist - d) * 0.5;
        mx += (dx / d) * push; mz += (dz / d) * push;
      }
    }
    if (mx || mz) { this._moveAxis(mx, 0, colliders); this._moveAxis(0, mz, colliders); }
  }

  // 소리 경보(단말기/조명탄 등): '그쪽에서 소리 났다'고 인지 -> 걸어가 확인.
  // 직접 본 게 아니므로 추격(alert)이 아니라 수색(investigate). 이미 추격 중이면 무시.
  alertTo(pos) {
    if (this.sensing || this.alert > 0) return;
    this.investigatePos.copy(pos);
    this.investigate = MEMORY_TIME + 2; // 조명탄/소리 살아있는 동안 매 프레임 갱신됨
  }

  caught() {
    return this.distToPlayer < CATCH_RADIUS;
  }
}
