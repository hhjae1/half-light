# HALF-LIGHT

방사능 폐허 GI 잠행 게임. 방사능 광원의 **간접 반사광(Global Illumination)** 이 플레이어를 비추고,
좀비는 그 밝기로 당신을 감지한다. **밝은 길 = 보이지만 위험 / 어두운 길 = 안전하지만 장님.**

> 컴퓨터그래픽스 최종 과제. GI 기법(DDGI 방식 probe 격자)을 게임 메커니즘으로 사용.

## 실행

```bash
npm install
npm run dev      # 로컬 개발 서버
npm run build    # dist/ 빌드
npm run preview  # 빌드 미리보기
```

## 조작

- `WASD` / 방향키 : 이동
- 마우스 : 시점
- 클릭 : 시작(포인터 잠금)

## 구조

| 파일 | 역할 | 강의 매핑 |
|---|---|---|
| `src/main.js` | 렌더러/씬/카메라/루프 | View·Projection (L1) |
| `src/room.js` | 폐허 방, emissive 방사능 광원 | 재질·조명 (L4), Scene Graph |
| `src/player.js` | 1인칭 이동 + 충돌 | Transform (L1) |
| (예정) `src/gi/` | probe 격자 DDGI | GI 강의 |
| (예정) 좀비 | Mixamo 스켈레톤 애니 | L6 |

## 배포 (GitHub Pages)

`main` 브랜치 push 시 `.github/workflows/deploy.yml`가 자동 빌드·배포.
저장소 Settings → Pages → Source 를 **GitHub Actions** 로 설정할 것.

## 조작

- WASD/방향키 이동 · Shift 달리기 · Space 점프 · F 손전등
- G: GI on/off (리포트 비교) · `[` `]`: GI 세기

## 진행 상황 (스코프)

- [x] 골격: 방, 1인칭 이동, emissive 광원, HUD
- [x] GI: probe 격자 → indirect diffuse (DDGI 방식, 멀티바운스)
- [x] 감지도 = irradiance 연동 (GI off면 0)
- [x] 좀비: 스킨드 GLB + 애니(Idle/Walk/Run) + 추적/수색/근접/시야각(FOV+LOS) AI
- [x] 승패 루프: 탈출 비콘 도달=승리 / 접촉=발각
- [x] 맵 확장 + 기둥/엄폐물, 헤드램프
- [ ] 텍스처(L5): 벽/바닥/상자 albedo·normal·AO, 상자 OBJ 교체
- [ ] 진짜 좀비 모델 교체(선택)
- [ ] 리포트: 강의 항목별 본인 게임 캡처
- [ ] (리포트용) 좀비 시야 콘 시각화
- [ ] (스트레치) 조명탄 던지기
