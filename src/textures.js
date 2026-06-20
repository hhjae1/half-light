import * as THREE from 'three';

/*
 * 텍스처 로딩 + 머티리얼 생성 (L5: Texture Mapping) — 폐지하철 테마
 *  - ambientCG CC0 PBR 세트: 콘크리트(벽/천장), 타일(바닥), 금속(상자/단말기)
 *  - albedo(Color) + normal(NormalGL) + roughness 맵
 *  - 타일링(RepeatWrapping) + anisotropic filtering
 *  - albedo만 sRGB 색공간
 *  - 환경맵(equirect -> PMREM)으로 금속 반사
 */
const BASE = import.meta.env.BASE_URL;
const loader = new THREE.TextureLoader();

function tex(path, { srgb = false, repeat = 1, repeatY = null } = {}) {
  const t = loader.load(`${BASE}textures/${path}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeatY ?? repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 같은 PBR 세트를 특정 타일링으로 묶어 머티리얼 생성
function pbr(name, repeat, repeatY, extra = {}) {
  return new THREE.MeshStandardMaterial({
    map: tex(`${name}_color.jpg`, { srgb: true, repeat, repeatY }),
    normalMap: tex(`${name}_normal.jpg`, { repeat, repeatY }),
    roughnessMap: tex(`${name}_rough.jpg`, { repeat, repeatY }),
    roughness: 1.0, metalness: 0.0,
    ...extra,
  });
}

export function loadTextures(renderer) {
  // 금속 드럼통/단말기 본체: 환경맵 반사. 로드 완료 후 주입(async 안전)
  const barrel = new THREE.MeshStandardMaterial({
    map: tex('metal_color.jpg', { srgb: true }),
    normalMap: tex('metal_normal.jpg'),
    roughnessMap: tex('metal_rough.jpg'),
    metalnessMap: tex('metal_metal.jpg'),
    color: 0x6a7a55, roughness: 0.6, metalness: 1.0,
  });
  let envMap = null;
  loader.load(`${BASE}textures/env_equirect.jpg`, (equirect) => {
    equirect.mapping = THREE.EquirectangularReflectionMapping;
    equirect.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    envMap = pmrem.fromEquirectangular(equirect).texture;
    pmrem.dispose();
    barrel.envMap = envMap;
    barrel.envMapIntensity = 0.6;
    barrel.needsUpdate = true;
  });

  return {
    get envMap() { return envMap; },
    barrel,

    // 벽: 갈라지고 벗겨진 석고/콘크리트 (폐건물)
    wall: pbr('plaster', 3, 1.2, {
      normalScale: new THREE.Vector2(1.3, 1.3), // 갈라진 요철 강조
      color: 0x9a9388,
    }),

    // 바닥: 더러운 콘크리트 (체크 X)
    floor: pbr('concrete', 6, 6, {
      normalScale: new THREE.Vector2(1, 1),
      color: 0x8a8780, roughness: 0.95,
    }),

    // 천장: 콘크리트 어둡게
    ceil: pbr('concrete', 5, 5, { color: 0x4a4a48 }),

    // 상자: 녹슨 금속
    crate: pbr('metal', 1, 1, {
      color: 0x8a8170, roughness: 0.7, metalness: 0.6,
    }),

    // 무너진 콘크리트 덩어리/벽체 조각 — 폐건물 잔해
    debris: pbr('concrete', 1, 1, {
      color: 0x6e6b64, roughness: 1.0,
    }),
  };
}
