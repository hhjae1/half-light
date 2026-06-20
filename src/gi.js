import * as THREE from 'three';

/*
 * ProbeGI — probe 격자 기반 Global Illumination (DDGI 계열, 래스터화 캡처판)
 * --------------------------------------------------------------------------
 * 강의(DDGI) 매핑:
 *   1) probe 격자를 공간에 배치                  -> Fixed 3D grid
 *   2) 각 probe에서 주변을 캡처(CubeCamera)       -> "ray tracing from each probe"의 래스터화 대체
 *   3) 방향성 irradiance(ambient-cube 6방향)로 저장 -> per-probe 저장(슬라이드의 L1 SH 대안)
 *   4) 이전 패스의 GI를 다시 먹여 재캡처(멀티패스)  -> recursive feedback / 무한 바운스 수렴
 *   5) 픽셀 셰이더에서 인접 8 probe 위치 가중 블렌딩 -> indirect diffuse 합산
 *
 * WebGL엔 하드웨어 레이트레이싱이 없으므로 probe 캡처를 CubeCamera 렌더로 대체한다.
 * 광원이 정적이라 시작 시 한 번 굽고(bake), 멀티패스로 색 번짐(color bleeding)을 누적한다.
 */

const FACE_DIRS = ['+X', '-X', '+Y', '-Y', '+Z', '-Z']; // WebGLCubeRenderTarget 면 순서

export class ProbeGI {
  /**
   * @param renderer THREE.WebGLRenderer
   * @param scene    THREE.Scene
   * @param min      THREE.Vector3 격자 최소 코너(월드)
   * @param max      THREE.Vector3 격자 최대 코너(월드)
   * @param dims     [nx, ny, nz] probe 개수
   */
  constructor(renderer, scene, min, max, dims) {
    this.renderer = renderer;
    this.scene = scene;
    this.dims = dims;
    this.origin = min.clone();
    this.cell = new THREE.Vector3(
      (max.x - min.x) / (dims[0] - 1),
      (max.y - min.y) / (dims[1] - 1),
      (max.z - min.z) / (dims[2] - 1)
    );
    this.count = dims[0] * dims[1] * dims[2];

    // probe당 6방향 색(RGBA float). 셰이더가 texture2D로 읽음.
    this.texWidth = this.count * 6;
    this.data = new Float32Array(this.texWidth * 4); // 초기값 0 = GI 없음(직접광만)
    this.texture = new THREE.DataTexture(
      this.data, this.texWidth, 1, THREE.RGBAFormat, THREE.FloatType
    );
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;

    // 캡처용 큐브 카메라
    const cubeSize = 16; // diffuse GI는 저해상도로 충분
    this.cubeRT = new THREE.WebGLCubeRenderTarget(cubeSize, { type: THREE.FloatType });
    this.cubeCam = new THREE.CubeCamera(0.1, 60, this.cubeRT);
    scene.add(this.cubeCam);
    this._faceBuf = new Float32Array(cubeSize * cubeSize * 4);
    this._cubeSize = cubeSize;

    this.strength = 5.0;     // GI 세기 기본값. 실시간 [ ] 키로 조절
    this.shaders = [];       // 주입한 머티리얼 셰이더들(uniform 갱신용)
  }

  probePos(ix, iy, iz, out = new THREE.Vector3()) {
    return out.set(
      this.origin.x + ix * this.cell.x,
      this.origin.y + iy * this.cell.y,
      this.origin.z + iz * this.cell.z
    );
  }

  // index = x + nx*(y + ny*z)  (셰이더와 동일 규칙)
  _idx(ix, iy, iz) {
    return ix + this.dims[0] * (iy + this.dims[1] * iz);
  }

  /** 멀티패스 베이크. bounces=패스 수(2~3 권장) */
  bake(bounces = 3) {
    const [nx, ny, nz] = this.dims;
    const pos = new THREE.Vector3();

    // 베이크 동안은 선형 HDR로 캡처(톤매핑·안개가 GI를 어둡게 누르지 않도록)
    const savedTone = this.renderer.toneMapping;
    const savedFog = this.scene.fog;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.scene.fog = null;

    for (let pass = 0; pass < bounces; pass++) {
      for (let iz = 0; iz < nz; iz++)
        for (let iy = 0; iy < ny; iy++)
          for (let ix = 0; ix < nx; ix++) {
            this.probePos(ix, iy, iz, pos);
            this.cubeCam.position.copy(pos);
            this.cubeCam.update(this.renderer, this.scene);

            const p = this._idx(ix, iy, iz);
            for (let f = 0; f < 6; f++) {
              const c = this._avgFace(f);
              const o = (p * 6 + f) * 4;
              this.data[o] = c.r; this.data[o + 1] = c.g;
              this.data[o + 2] = c.b; this.data[o + 3] = 1;
            }
          }
      // 다음 패스에서 머티리얼이 이번 결과를 샘플 -> 한 바운스 더 누적
      this.texture.needsUpdate = true;
    }

    // 원상복구
    this.renderer.toneMapping = savedTone;
    this.scene.fog = savedFog;

    // 디버그: 베이크 결과 RGB 최댓값/평균(alpha 제외)
    let mx = 0, sum = 0;
    const n = this.count * 6;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const r = this.data[o], g = this.data[o + 1], b = this.data[o + 2];
      mx = Math.max(mx, r, g, b);
      sum += (r + g + b) / 3;
    }
    console.log(`[GI] bake done. probes=${this.count}, passes=${bounces}, max(RGB)=${mx.toFixed(3)}, mean=${(sum / n).toFixed(4)}`);
  }

  // 한 면의 평균 색 = 그 방향 입사 radiance 근사
  _avgFace(face) {
    const s = this._cubeSize, buf = this._faceBuf;
    this.renderer.readRenderTargetPixels(this.cubeRT, 0, 0, s, s, buf, face);
    let r = 0, g = 0, b = 0;
    const n = s * s;
    for (let i = 0; i < n; i++) {
      r += buf[i * 4]; g += buf[i * 4 + 1]; b += buf[i * 4 + 2];
    }
    return { r: r / n, g: g / n, b: b / n };
  }

  // ---- 셰이더 주입 (씬의 모든 MeshStandardMaterial에 indirect diffuse 추가) ----
  applyToScene(root) {
    root.traverse((obj) => {
      if (obj.isMesh && obj.material && obj.material.isMeshStandardMaterial) {
        this._inject(obj.material);
      }
    });
  }

  _inject(material) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.giTex = { value: this.texture };
      shader.uniforms.giTexWidth = { value: this.texWidth };
      shader.uniforms.giOrigin = { value: this.origin };
      shader.uniforms.giCell = { value: this.cell };
      shader.uniforms.giDims = { value: new THREE.Vector3(...this.dims) };
      shader.uniforms.giStrength = { value: this.strength };
      this.shaders.push(shader);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
          '#include <common>\nvarying vec3 vGiPos;\nvarying vec3 vGiNrm;')
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\n vGiPos = (modelMatrix*vec4(transformed,1.0)).xyz;')
        .replace('#include <beginnormal_vertex>',
          '#include <beginnormal_vertex>\n vGiNrm = normalize(mat3(modelMatrix)*objectNormal);');

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GI_GLSL)
        .replace('#include <lights_fragment_end>',
          '#include <lights_fragment_end>\n' +
          'vec3 giIrr = giSample(vGiPos, normalize(vGiNrm)) * giStrength;\n' +
          'reflectedLight.indirectDiffuse += giIrr * BRDF_Lambert( material.diffuseColor );');
    };
    material.needsUpdate = true;
  }

  setStrength(v) {
    this.strength = v;
    for (const s of this.shaders) s.uniforms.giStrength.value = v;
  }

  // ---- CPU 샘플 (감지도 계산용): 플레이어 위치의 평균 irradiance ----
  sampleAmbient(wpos) {
    const lx = (wpos.x - this.origin.x) / this.cell.x;
    const ly = (wpos.y - this.origin.y) / this.cell.y;
    const lz = (wpos.z - this.origin.z) / this.cell.z;
    const x0 = Math.floor(lx), y0 = Math.floor(ly), z0 = Math.floor(lz);
    const fx = clamp01(lx - x0), fy = clamp01(ly - y0), fz = clamp01(lz - z0);
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < 8; i++) {
      const ox = i & 1, oy = (i >> 1) & 1, oz = (i >> 2) & 1;
      const ix = clampi(x0 + ox, 0, this.dims[0] - 1);
      const iy = clampi(y0 + oy, 0, this.dims[1] - 1);
      const iz = clampi(z0 + oz, 0, this.dims[2] - 1);
      const w = (ox ? fx : 1 - fx) * (oy ? fy : 1 - fy) * (oz ? fz : 1 - fz);
      const p = this._idx(ix, iy, iz);
      // 6면 평균
      let pr = 0, pg = 0, pb = 0;
      for (let f = 0; f < 6; f++) {
        const o = (p * 6 + f) * 4;
        pr += this.data[o]; pg += this.data[o + 1]; pb += this.data[o + 2];
      }
      r += w * pr / 6; g += w * pg / 6; b += w * pb / 6;
    }
    return { r, g, b, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b };
  }
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function clampi(x, a, b) { return x < a ? a : x > b ? b : x; }

// 셰이더에서 8-probe 트라이리니어 블렌딩 + ambient-cube 평가
const GI_GLSL = /* glsl */`
uniform sampler2D giTex;
uniform float giTexWidth;
uniform vec3 giOrigin;
uniform vec3 giCell;
uniform vec3 giDims;
uniform float giStrength;
varying vec3 vGiPos;
varying vec3 vGiNrm;

vec3 giFetch(float col){
  return texture2D(giTex, vec2((col + 0.5) / giTexWidth, 0.5)).rgb;
}
// ambient-cube: 법선 방향으로 6방향 색을 n^2 가중 합성
vec3 giEvalProbe(float pidx, vec3 n){
  float base = pidx * 6.0;
  vec3 nsq = n * n;
  vec3 cx = (n.x > 0.0) ? giFetch(base + 0.0) : giFetch(base + 1.0);
  vec3 cy = (n.y > 0.0) ? giFetch(base + 2.0) : giFetch(base + 3.0);
  vec3 cz = (n.z > 0.0) ? giFetch(base + 4.0) : giFetch(base + 5.0);
  return nsq.x * cx + nsq.y * cy + nsq.z * cz;
}
vec3 giSample(vec3 wpos, vec3 n){
  vec3 local = (wpos - giOrigin) / giCell;
  vec3 baseI = floor(local);
  vec3 f = clamp(local - baseI, 0.0, 1.0);
  vec3 acc = vec3(0.0);
  for(int i = 0; i < 8; i++){
    vec3 off = vec3(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1));
    vec3 gi = clamp(baseI + off, vec3(0.0), giDims - 1.0);
    float w = mix(1.0 - f.x, f.x, off.x) * mix(1.0 - f.y, f.y, off.y) * mix(1.0 - f.z, f.z, off.z);
    float pidx = gi.x + giDims.x * (gi.y + giDims.y * gi.z);
    acc += w * giEvalProbe(pidx, n);
  }
  return acc;
}
`;
