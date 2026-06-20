import * as THREE from 'three';

/*
 * 1인칭 이동 + 자세 + 특수 통로:
 *  - WASD 이동, Shift 달리기, Space 점프(중력)
 *  - C(토글): 앉기 (느리고 조용, 시점 낮아짐)
 *    (웹에서 Ctrl+W는 탭 닫기라 가로채짐 -> 앉기는 C 전용)
 *  - lowBarriers: 앉아야 통과(빔 아래 개구멍)  / jumpBarriers: 점프해야 통과(낮은 잔해)
 *  - 게임 키의 브라우저 기본동작(스크롤 등) 차단
 */
const EYE_STAND = 1.6;
const EYE_CROUCH = 1.0;
const GRAVITY = 22;
const JUMP_SPEED = 8.2; // 점프 정점 ~1.5m: 장애물(약 1m) 위로 올라탈 수 있음
const HANDLED = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'KeyC', 'ControlLeft', 'ControlRight', 'Space',
]);
const STAMINA_DRAIN = 0.34; // 달리기 소모(/s) -> 약 3초
const STAMINA_REGEN = 0.28; // 회복(/s)

export class Player {
  constructor(controls, colliders, lowBarriers = [], jumpBarriers = []) {
    this.controls = controls;
    this.camera = controls.object;
    this.colliders = colliders;
    this.lowBarriers = lowBarriers;
    this.jumpBarriers = jumpBarriers;

    this.walkSpeed = 3.0;
    this.runSpeed = 4.6;
    this.crouchSpeed = 1.7;
    this.radius = 0.3;

    this.velY = 0;
    this.onGround = true;
    this.eyeHeight = EYE_STAND;

    this.moving = false;
    this.running = false;
    this.crouch = false;
    this.freeLook = false;                    // 자유 시점(Alt): 둘러보되 이동 방향 고정
    this.lockedDir = new THREE.Vector3(0, 0, -1);
    this.justJumped = false;
    this.justLanded = false;
    this.stamina = 1;        // 0~1
    this.exhausted = false;
    this.ledgeGrace = 0;     // 점프 장벽 윗면에서 막 내려오는 동안 측면 충돌 일시 해제

    this.keys = { f: false, b: false, l: false, r: false, run: false };
    this._bind();

    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move = new THREE.Vector3();
  }

  _bind() {
    const set = (e, v) => {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': this.keys.f = v; break;
        case 'KeyS': case 'ArrowDown': this.keys.b = v; break;
        case 'KeyA': case 'ArrowLeft': this.keys.l = v; break;
        case 'KeyD': case 'ArrowRight': this.keys.r = v; break;
        case 'ShiftLeft': case 'ShiftRight': this.keys.run = v; break;
        case 'KeyC': case 'ControlLeft': case 'ControlRight':
          if (v && !e.repeat) this.crouch = !this.crouch; break; // 토글(키 반복 무시)
        case 'Space':
          if (v && this.onGround && !this.crouch) {
            this.velY = JUMP_SPEED; this.onGround = false; this.justJumped = true;
          }
          break;
      }
      if (HANDLED.has(e.code)) e.preventDefault();
    };
    document.addEventListener('keydown', (e) => set(e, true));
    document.addEventListener('keyup', (e) => set(e, false));
  }

  // 자유 시점 진입: 현재 바라보는 수평 방향을 이동 기준으로 고정
  enterFreeLook() {
    this.freeLook = true;
    this.camera.getWorldDirection(this.lockedDir);
    this.lockedDir.y = 0; this.lockedDir.normalize();
  }
  exitFreeLook() { this.freeLook = false; }

  update(dt) {
    // --- 수평 이동 기준 방향 (자유시점이면 고정 방향 사용) ---
    if (this.freeLook) {
      this._dir.copy(this.lockedDir);
    } else {
      this.camera.getWorldDirection(this._dir);
      this._dir.y = 0; this._dir.normalize();
    }
    this._right.crossVectors(this._dir, this.camera.up).normalize();

    this._move.set(0, 0, 0);
    if (this.keys.f) this._move.add(this._dir);
    if (this.keys.b) this._move.sub(this._dir);
    if (this.keys.r) this._move.add(this._right);
    if (this.keys.l) this._move.sub(this._right);

    // 개구멍(낮은 통로) 안에서는 일어설 수 없음 -> 강제로 앉은 상태 유지
    if (!this.crouch && this._underLowBarrier(this.camera.position.x, this.camera.position.z)) {
      this.crouch = true;
    }

    this.moving = this._move.lengthSq() > 0;
    // 스태미나: 달리면 소모, 아니면 회복. 0이 되면 회복(>0.3)될 때까지 달리기 잠금.
    const wantsRun = this.moving && this.keys.run && !this.crouch && !this.exhausted;
    this.running = wantsRun && this.stamina > 0;
    if (this.running) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
      if (this.stamina === 0) this.exhausted = true;
    } else {
      this.stamina = Math.min(1, this.stamina + STAMINA_REGEN * dt);
      if (this.exhausted && this.stamina > 0.3) this.exhausted = false;
    }

    let speed = this.walkSpeed;
    if (this.crouch) speed = this.crouchSpeed;
    else if (this.running) speed = this.runSpeed;

    if (this.moving) {
      this._move.normalize().multiplyScalar(speed * dt);
      this._tryMove(this._move.x, this._move.z);
    }

    // --- 자세에 따른 시점 높이 ---
    const targetEye = this.crouch ? EYE_CROUCH : EYE_STAND;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 12);

    // --- 수직(점프/중력) + 착지 감지 ---
    // 발 밑 지지면(바닥 0 또는 점프 장벽 윗면)을 계산해 그 위에 착지/이동 가능 -> 발판처럼 올라탐
    const px = this.camera.position.x, pz = this.camera.position.z;
    const supportY = this._supportHeight(px, pz);
    const groundCamY = supportY + this.eyeHeight;
    // 렛지 유예: 장벽 윗면에 서 있거나 / 공중에서 장벽 근처에 있으면 갱신.
    // -> 뛰어넘다 어디에 착지하든 직후 0.5초간 측면 충돌이 꺼져 끼임 없이 빠져나옴.
    if ((this.onGround && supportY > 0) || (!this.onGround && this._nearJumpBarrier(px, pz))) {
      this.ledgeGrace = 0.5;
    } else if (this.ledgeGrace > 0) {
      this.ledgeGrace -= dt;
    }
    const wasAir = !this.onGround;
    this.velY -= GRAVITY * dt;
    this.camera.position.y += this.velY * dt;
    if (this.velY <= 0 && this.camera.position.y <= groundCamY) {
      this.camera.position.y = groundCamY;
      this.velY = 0;
      this.onGround = true;
      if (wasAir) this.justLanded = true;
    } else {
      this.onGround = false;
    }
  }

  // 개구멍 footprint 안(반경 포함)에 있나 -> 그 안에선 일어설 수 없음
  _underLowBarrier(x, z) {
    const r = this.radius;
    for (const b of this.lowBarriers) {
      if (x + r > b.min.x && x - r < b.max.x && z + r > b.min.z && z - r < b.max.z) return true;
    }
    return false;
  }

  // 점프 장벽 footprint 근처(반경 포함)에 있나
  _nearJumpBarrier(x, z) {
    for (const b of this.jumpBarriers) if (this._hit(b, x, z)) return true;
    return false;
  }

  // 현재 x,z에서 발을 디딜 수 있는 높이(바닥 0, 또는 그 위에 올라선 점프 장벽 윗면)
  _supportHeight(x, z) {
    let h = 0;
    for (const b of this.jumpBarriers) {
      if (x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && b.max.y > h) h = b.max.y;
    }
    return h;
  }

  _tryMove(dx, dz) {
    const p = this.camera.position;
    const nx = p.x + dx;
    if (!this._blocked(nx, p.z)) p.x = nx;
    const nz = p.z + dz;
    if (!this._blocked(p.x, nz)) p.z = nz;
  }

  _hit(b, x, z) {
    const r = this.radius;
    return x + r > b.min.x && x - r < b.max.x && z + r > b.min.z && z - r < b.max.z;
  }

  _blocked(x, z) {
    for (const b of this.colliders) if (this._hit(b, x, z)) return true;
    // 개구멍: 서 있으면 막힘, 앉으면 통과
    if (!this.crouch) for (const b of this.lowBarriers) if (this._hit(b, x, z)) return true;
    // 낮은 잔해: 발이 윗면보다 낮으면 측면에 막힘(점프로 올라타야 함).
    // 발이 윗면 이상이면 통과 -> 위로 올라서서 걸어 넘을 수 있음.
    // 렛지 유예 중엔 측면 통과 허용(윗면에서 내려오는 중 끼임 방지)
    if (this.ledgeGrace <= 0) {
      const feetY = this.camera.position.y - this.eyeHeight;
      for (const b of this.jumpBarriers) {
        if (feetY < b.max.y - 0.1 && this._hit(b, x, z)) return true;
      }
    }
    return false;
  }
}
