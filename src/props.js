import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/*
 * 정적 소품(Poly Haven CC0 glTF) 로더 + 배치 헬퍼.
 *  - 7종 모델을 미리 로드해 템플릿으로 보관
 *  - placeProp(): 복제 -> 크기 정규화 -> 바닥에 정렬 -> 회전
 */
const BASE = import.meta.env.BASE_URL;
const FILES = {
  barrel: 'Barrel_01_2k/Barrel_01_2k.gltf',
  stove: 'barrel_stove_2k/barrel_stove_2k.gltf',
  trash: 'metal_trash_can_2k/metal_trash_can_2k.gltf',
  chest: 'metal_tool_chest_2k/metal_tool_chest_2k.gltf',
  barrier1: 'concrete_road_barrier_2k/concrete_road_barrier_2k.gltf',
  barrier2: 'concrete_road_barrier_02_2k/concrete_road_barrier_02_2k.gltf',
  wrench: 'pipe_wrench_2k/pipe_wrench_2k.gltf',
};

export function loadProps() {
  const loader = new GLTFLoader();
  const load = (path) => new Promise((res, rej) =>
    loader.load(`${BASE}models/props/${path}`, (g) => res(g.scene), undefined, rej));
  const names = Object.keys(FILES);
  return Promise.all(names.map((n) => load(FILES[n]))).then((scenes) => {
    const templates = {};
    names.forEach((n, i) => {
      const s = scenes[i];
      // 트래시캔 모델은 통 2개(깨끗+녹슨) 세트 -> 녹슨 통 제거해 1개만
      if (n === 'trash') {
        const drop = [];
        s.traverse((o) => { if (o.name && o.name.toLowerCase().includes('rust')) drop.push(o); });
        drop.forEach((o) => o.parent && o.parent.remove(o));
      }
      s.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      templates[n] = s;
    });
    return templates;
  });
}

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _ctr = new THREE.Vector3();

/**
 * @param template THREE.Object3D
 * @param o { x, z, yaw, fitFootprint?, fitHeight? }
 *   fitFootprint: 수평 최대치를 이 값으로 맞춤(상자/배럴/바리어)
 *   fitHeight: 높이를 이 값으로 맞춤(렌치 같은 작은 것)
 */
export function placeProp(template, o) {
  const m = template.clone(true);
  m.rotation.y = o.yaw || 0;
  m.updateMatrixWorld(true);
  _box.setFromObject(m); _box.getSize(_size);
  let scale = 1;
  if (o.fitHeight) scale = o.fitHeight / (_size.y || 1);
  else scale = (o.fitFootprint || 1) / (Math.max(_size.x, _size.z) || 1);
  m.scale.setScalar(scale);
  m.updateMatrixWorld(true);
  _box.setFromObject(m); _box.getCenter(_ctr);
  // 바닥(y=0)에 발 맞추고, 수평 중심을 (x,z)로
  m.position.x += o.x - _ctr.x;
  m.position.z += o.z - _ctr.z;
  m.position.y += -_box.min.y;
  return m;
}
