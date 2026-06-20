/*
 * 절차적 사운드 (Web Audio API) — 외부 에셋 없이 생성.
 *  - 으스스한 앰비언트 드론(저주파 디튠 + 브라운 노이즈 + 느린 필터 LFO)
 *  - 발소리(노이즈 버스트, 달릴 때 더 빠르고 큼)
 *  - 긴장 심박음(감지도 높을 때)
 * AudioContext는 사용자 클릭(잠금) 시 resume.
 */
export function createAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return { start() {}, update() {} };
  const ctx = new Ctx();

  const master = ctx.createGain();
  master.gain.value = 0.0; // 시작 시 페이드인
  master.connect(ctx.destination);

  // ---- 앰비언트 드론(평상시) ----
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 380;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.10;
  lp.connect(droneGain);
  droneGain.connect(master);

  for (const f of [55, 55.4, 73.42, 110]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = 0.22;
    o.connect(g); g.connect(lp); o.start();
  }

  // ---- 추격 레이어(긴박): 평소 음소거, 감지되면 페이드인 ----
  const chaseGain = ctx.createGain();
  chaseGain.gain.value = 0.0;
  chaseGain.connect(master);
  // 불협 디튠 톤
  for (const f of [82, 110, 138]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    o.connect(g); g.connect(chaseGain); o.start();
  }
  // 빠른 펄스(심장 뛰는 리듬)
  const pulse = ctx.createOscillator();
  pulse.type = 'sine'; pulse.frequency.value = 70;
  const pulseLfo = ctx.createOscillator();
  pulseLfo.type = 'square'; pulseLfo.frequency.value = 3.2; // 펄스 속도
  const pulseLfoG = ctx.createGain(); pulseLfoG.gain.value = 0.16;
  const pulseG = ctx.createGain(); pulseG.gain.value = 0.0;
  pulseLfo.connect(pulseLfoG); pulseLfoG.connect(pulseG.gain);
  pulse.connect(pulseG); pulseG.connect(chaseGain);
  pulse.start(); pulseLfo.start();
  // 느린 LFO로 필터 흔들어 불안감
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 160;
  lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();

  // 브라운 노이즈 베드(바람 같은)
  const noise = ctx.createBufferSource();
  noise.buffer = makeBrownNoise(ctx, 2);
  noise.loop = true;
  const nf = ctx.createBiquadFilter();
  nf.type = 'lowpass'; nf.frequency.value = 480;
  const ng = ctx.createGain(); ng.gain.value = 0.05;
  noise.connect(nf); nf.connect(ng); ng.connect(master); noise.start();

  // ---- 발소리용 노이즈 버퍼 ----
  const stepBuf = makeNoise(ctx, 0.15);

  // ---- 심박음 게인(감지도 높을 때) ----
  const heartGain = ctx.createGain();
  heartGain.gain.value = 0;
  heartGain.connect(master);

  let started = false;
  function start() {
    if (ctx.state === 'suspended') ctx.resume();
    if (!started) {
      master.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 2);
      started = true;
    }
  }

  // 추격 BGM 전환: on이면 긴박 레이어 페이드인, off면 평상시로
  let chaseOn = false;
  function setChase(on) {
    if (on === chaseOn) return;
    chaseOn = on;
    const t = ctx.currentTime;
    chaseGain.gain.cancelScheduledValues(t);
    chaseGain.gain.linearRampToValueAtTime(on ? 0.5 : 0.0, t + (on ? 0.4 : 1.5));
    droneGain.gain.cancelScheduledValues(t);
    droneGain.gain.linearRampToValueAtTime(on ? 0.04 : 0.10, t + (on ? 0.4 : 1.5));
  }

  // 발소리 타이밍
  let stepT = 0;
  let heartT = 0;
  function update(dt, moving, running, detect = 0) {
    // 발소리
    if (moving) {
      stepT -= dt;
      if (stepT <= 0) { stepT = running ? 0.30 : 0.52; step(running); }
    } else {
      stepT = 0;
    }
    // 심박음: 감지도 높을수록 빠르게
    if (detect > 45) {
      heartT -= dt;
      const interval = 0.8 - 0.004 * Math.min(detect, 100); // 0.4~0.76s
      if (heartT <= 0) { heartT = interval; heartbeat(Math.min(detect, 100) / 100); }
    } else {
      heartT = 0;
    }
  }

  function step(running) {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = stepBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = running ? 1700 : 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(running ? 0.5 : 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.15);
  }

  function heartbeat(intensity) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = 55;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.5 * intensity, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.25);
  }

  function jump() {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = stepBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.2);
  }

  function land() {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.22);
    // 착지 흙먼지 노이즈
    const src = ctx.createBufferSource();
    src.buffer = stepBuf;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 500;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.4, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(lpf); lpf.connect(g2); g2.connect(master);
    src.start(t); src.stop(t + 0.15);
  }

  function flare() {
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = stepBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start(t); src.stop(t + 0.25);
  }

  // 단말기 활성화: 크고 날카로운 경보음(전원 켜지는 느낌)
  function terminal() {
    const t = ctx.currentTime;
    // 상승 톤
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.7);
    // 저음 쿵
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.setValueAtTime(90, t);
    o2.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.5, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o2.connect(g2); g2.connect(master);
    o2.start(t); o2.stop(t + 0.5);
  }

  return { start, update, setChase, jump, land, flare, terminal };
}

function makeNoise(ctx, dur) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makeBrownNoise(ctx, dur) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.5;
  }
  return buf;
}
