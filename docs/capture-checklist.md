# HALF-LIGHT 캡처 체크리스트 (리포트용)

> 규정: **모든 개별 내용을 "본인 게임에서 캡처한 이미지"로 설명** (안 하면 0점).
> 캡처 방법: Windows `Win + Shift + S` (영역 캡처) → `docs/images/` 폴더에 저장.
> 파일명은 아래 `파일명` 그대로 쓰면 리포트에 자동으로 들어갑니다.

## 캡처 전 준비
- 게임: https://hhjae1.github.io/half-light/ (또는 로컬 `npm run dev`)
- 게임 안 단축키: `G` GI 토글 · `[` `]` GI 세기 · `F` 손전등 · `Q` 조명탄 · `Alt` 둘러보기 · `C` 앉기

---

## A. 시작/UI (게임 전반 소개)
- [ ] `cap_title.png` — 시작 화면(HALF-LIGHT 타이틀 + 조작 안내)
- [ ] `cap_hud.png` — 플레이 중 HUD 전체 (피폭 게이지·감지도·조명탄·스태미나 보이게)
- [ ] `cap_win.png` — "탈출 성공" 화면 / `cap_gameover.png` — "발각됨" 또는 "치사량 피폭" 화면

## B. 변환·파이프라인 (L1, L2, L3)
- [ ] `cap_fpv.png` — 1인칭 시점으로 방 전경 (원근 투영 = Projection Transform)
- [ ] `cap_freelook.png` — `Alt` 누른 채 고개 돌린 화면 (View/카메라 회전)
- [ ] `cap_scene.png` — 멀리까지 보이는 구도 (여러 오브젝트 배치 = World/Model Transform, Scene Graph)
  - 설명용: 좀비(손에 든 것 없지만), 단말기, 소품들이 각자 위치/회전/스케일 가진 것을 World Transform으로

## C. 조명·셰이딩 (L4) — ★GI 비교가 핵심★
- [ ] `cap_gi_on.png` — 단말기 근처에서 **G로 GI 켠** 상태 (초록빛이 벽·바닥에 번짐 = color bleeding)
- [ ] `cap_gi_off.png` — **같은 자리에서 G로 GI 끈** 상태 (그늘이 새까맣고 색 번짐 없음)
  - → 이 두 장이 GI(채점 20점) 설명의 핵심. **반드시 같은 위치·시점**에서 찍기
- [ ] `cap_emissive.png` — 발광 단말기(emissive) 클로즈업 (스스로 빛내는 광원)
- [ ] `cap_specular.png` — 금속 드럼통/소품에 하이라이트 반사 보이는 화면 (specular)
- [ ] `cap_shadow.png` — 좀비/소품이 바닥에 그림자 드리운 화면 (직접광 그림자)

## D. 텍스처 (L5)
- [ ] `cap_tex_wall.png` — 벽(갈라진 콘크리트) 가까이 (albedo + normal map 질감)
- [ ] `cap_tex_floor.png` — 바닥 콘크리트 질감
- [ ] `cap_props.png` — Poly Haven 소품들(배럴/공구함/바리어) 보이는 화면 (텍스처 입은 외부 모델)
- [ ] `cap_env_reflect.png` — 금속 드럼통 표면 반사 (환경맵 reflection)

## E. 스켈레톤·애니메이션 (L6)
- [ ] `cap_zombie_walk.png` — 좀비가 걷는 순간 (스킨드 메쉬 + Walk 애니)
- [ ] `cap_zombie_run.png` — 좀비가 추격(뛰는) 순간 (Run 애니)
- [ ] `cap_zombie_scream.png` — 발각 시 비명 리액션 순간
- [ ] `cap_zombie_two.png` — 좀비 2마리(서로 다른 외형) 한 화면에
  - 팁: `Alt`로 뒤돌아보며 좀비 다가올 때 찍으면 동작이 잘 잡힘

## F. 게임 메커니즘 (기획 설명용)
- [ ] `cap_detect_high.png` — 단말기 앞(밝은 곳)에서 감지도 높음
- [ ] `cap_detect_safe.png` — 어두운 구석에서 감지도 0 (안전지대)
- [ ] `cap_flare.png` — 조명탄 던져 불꽃 튀고 좀비가 그쪽 보는 화면 (미끼)
- [ ] `cap_terminal_on.png` — 단말기 활성화(청록색으로 변함) + 목표 카운터
- [ ] `cap_maze.png` — 미로 통로 구조 (위에서 보긴 어려우니 통로 전경)
- [ ] `cap_crawl.png` — 개구멍에서 앉아 통과 / `cap_jump.png` — 잔해 점프해 넘기

---

## 캡처 팁
- **GI on/off 비교**는 움직이지 말고 `G`만 눌러 두 장 — 차이가 명확해야 함
- 어두워서 안 보이면 `]`로 GI 세기 올리거나 `F` 손전등
- 좀비 동작은 추격당할 때가 잘 잡힘 (일부러 단말기 켜서 유인)
- 화면비 일정하게(전체화면 권장)
