'use strict';

/* =========================================================================
 * NEON RUSH — pseudo-3D 고속 레이싱 (외부 의존성/이미지 없음, 순수 Canvas)
 * 도로 렌더링은 Jake Gordon 의 고전 pseudo-3D 기법을 기반으로 직접 구현.
 * ========================================================================= */

/* ----------------------------------------------------------- 상수/설정 */
const STEP = 1 / 60;
const SEGMENT_LENGTH = 200;
const RUMBLE_LENGTH = 3;
const LANES = 3;
const ROAD_WIDTH = 2200;
const CAMERA_HEIGHT = 1000;
const DRAW_DISTANCE = 240;
const FOG_DENSITY = 4;
const FIELD_OF_VIEW = 100;
const CAMERA_DEPTH = 1 / Math.tan(((FIELD_OF_VIEW / 2) * Math.PI) / 180);
const PLAYER_Z = CAMERA_HEIGHT * CAMERA_DEPTH;

const MAX_SPEED = SEGMENT_LENGTH / STEP; // 12000 (units/s)
const ACCEL = MAX_SPEED / 4.5;
const BREAKING = -MAX_SPEED;
const OFFROAD_DECEL = -MAX_SPEED / 1.5;
const OFFROAD_LIMIT = MAX_SPEED / 4;
const CENTRIFUGAL = 0.32;
const PLAYER_W = 0.46;
const TOP_KMH = 320;
const UNIT_TO_M = TOP_KMH / 3.6 / MAX_SPEED;
const RUN_TIME = 90; // 타임어택 제한시간(초)

const ROAD = {
  LENGTH: { SHORT: 25, MEDIUM: 50, LONG: 100 },
  CURVE: { EASY: 2, MEDIUM: 4, HARD: 6 },
  HILL: { LOW: 20, MEDIUM: 40, HIGH: 60 },
};

const COLORS = {
  LIGHT: { road: '#3a3a47', grass: '#241b3a', rumble: '#ff2d95', lane: '#19e3ff' },
  DARK: { road: '#32323d', grass: '#2b2150', rumble: '#19e3ff', lane: '' },
  START: { road: '#dddddd', grass: '#dddddd', rumble: '#dddddd', lane: '' },
  FINISH: { road: '#111111', grass: '#111111', rumble: '#111111', lane: '' },
  FOG: '#3a1d6e',
};
const CAR_COLORS = ['#ff4d6d', '#19e3ff', '#ffd23f', '#7af96f', '#c77dff', '#ff8e3c'];

/* ----------------------------------------------------------- 캔버스 */
const stage = document.getElementById('stage');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let width = 0, height = 0;

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  width = stage.clientWidth;
  height = stage.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);

/* ----------------------------------------------------------- 상태 */
let segments = [];
let cars = [];
let trackLength = 0;

let position = 0;    // 카메라 z 위치
let speed = 0;       // units/s
let playerX = 0;     // -1..1 (도로 절반폭 기준)
let bgOffset = 0;    // 배경 시차용
let shakeMag = 0;    // 화면 흔들림
let distanceM = 0;
let best = parseFloat(localStorage.getItem('neonrush.best') || '0');
let timeLeft = RUN_TIME;
let state = 'menu';  // menu | play | over

const input = { left: false, right: false, brake: false };

/* ----------------------------------------------------------- 유틸 */
const lerp = (a, b, p) => a + (b - a) * p;
const easeIn = (a, b, p) => a + (b - a) * p * p;
const easeOut = (a, b, p) => a + (b - a) * (1 - (1 - p) * (1 - p));
const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
const limit = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
const percentRemaining = (n, total) => (n % total) / total;
const exponentialFog = (d, density) => 1 / Math.pow(Math.E, d * d * density);

function increase(start, inc, max) {
  let r = start + inc;
  while (r >= max) r -= max;
  while (r < 0) r += max;
  return r;
}
function findSegment(z) {
  return segments[Math.floor(z / SEGMENT_LENGTH) % segments.length];
}
function overlap(x1, w1, x2, w2, pct) {
  const half = (pct || 1) / 2;
  const min1 = x1 - w1 * half, max1 = x1 + w1 * half;
  const min2 = x2 - w2 * half, max2 = x2 + w2 * half;
  return !(max1 < min2 || min1 > max2);
}

function project(p, camX, camY, camZ) {
  p.camera.x = (p.world.x || 0) - camX;
  p.camera.y = (p.world.y || 0) - camY;
  p.camera.z = (p.world.z || 0) - camZ;
  const scale = CAMERA_DEPTH / p.camera.z;
  p.screen.scale = scale;
  p.screen.x = Math.round(width / 2 + (scale * p.camera.x * width) / 2);
  p.screen.y = Math.round(height / 2 - (scale * p.camera.y * height) / 2);
  p.screen.w = Math.round((scale * ROAD_WIDTH * width) / 2);
}

/* ----------------------------------------------------------- 트랙 생성 */
function lastY() {
  return segments.length === 0 ? 0 : segments[segments.length - 1].p2.world.y;
}
function addSegment(curve, y) {
  const n = segments.length;
  segments.push({
    index: n,
    p1: { world: { y: lastY(), z: n * SEGMENT_LENGTH }, camera: {}, screen: {} },
    p2: { world: { y, z: (n + 1) * SEGMENT_LENGTH }, camera: {}, screen: {} },
    curve,
    sprites: [],
    cars: [],
    color: Math.floor(n / RUMBLE_LENGTH) % 2 ? COLORS.DARK : COLORS.LIGHT,
  });
}
function addRoad(enter, hold, leave, curve, y) {
  const startY = lastY();
  const endY = startY + y * SEGMENT_LENGTH;
  const total = enter + hold + leave;
  let n;
  for (n = 0; n < enter; n++) addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
  for (n = 0; n < hold; n++) addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
  for (n = 0; n < leave; n++) addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
}
const addStraight = (n) => addRoad(n || ROAD.LENGTH.MEDIUM, n || ROAD.LENGTH.MEDIUM, n || ROAD.LENGTH.MEDIUM, 0, 0);
const addHill = (n, h) => addRoad(n, n, n, 0, h);
const addCurve = (n, c, h) => addRoad(n, n, n, c, h || 0);
function addSCurves() {
  const M = ROAD.LENGTH.MEDIUM;
  addRoad(M, M, M, -ROAD.CURVE.EASY, ROAD.HILL.NONE | 0);
  addRoad(M, M, M, ROAD.CURVE.MEDIUM, ROAD.HILL.MEDIUM);
  addRoad(M, M, M, ROAD.CURVE.EASY, -ROAD.HILL.LOW);
  addRoad(M, M, M, -ROAD.CURVE.EASY, ROAD.HILL.MEDIUM);
  addRoad(M, M, M, -ROAD.CURVE.MEDIUM, -ROAD.HILL.MEDIUM);
}
function addBumps() {
  const seq = [5, -2, -5, 8, 5, -7, 5, -2];
  seq.forEach((h) => addRoad(10, 10, 10, 0, h));
}
function addLowRollingHills(n, h) {
  n = n || ROAD.LENGTH.SHORT;
  h = h || ROAD.HILL.LOW;
  addRoad(n, n, n, 0, h / 2);
  addRoad(n, n, n, 0, -h);
  addRoad(n, n, n, 0, h);
  addRoad(n, n, n, 0, 0);
  addRoad(n, n, n, 0, h / 2);
  addRoad(n, n, n, 0, 0);
}
function addDownhillToEnd(n) {
  n = n || 200;
  addRoad(n, n, n, -ROAD.CURVE.EASY, -lastY() / SEGMENT_LENGTH);
}

function resetRoad() {
  segments = [];
  addStraight(ROAD.LENGTH.SHORT);
  addLowRollingHills();
  addSCurves();
  addCurve(ROAD.LENGTH.MEDIUM, ROAD.CURVE.MEDIUM, ROAD.HILL.LOW);
  addBumps();
  addLowRollingHills();
  addCurve(ROAD.LENGTH.LONG * 2, ROAD.CURVE.MEDIUM, ROAD.HILL.MEDIUM);
  addStraight();
  addHill(ROAD.LENGTH.MEDIUM, ROAD.HILL.HIGH);
  addSCurves();
  addCurve(ROAD.LENGTH.LONG, -ROAD.CURVE.MEDIUM, ROAD.HILL.NONE | 0);
  addHill(ROAD.LENGTH.LONG, ROAD.HILL.HIGH);
  addCurve(ROAD.LENGTH.LONG, ROAD.CURVE.MEDIUM, -ROAD.HILL.LOW);
  addBumps();
  addHill(ROAD.LENGTH.LONG, -ROAD.HILL.MEDIUM);
  addStraight();
  addSCurves();
  addCurve(ROAD.LENGTH.LONG, -ROAD.CURVE.HARD, ROAD.HILL.LOW);
  addDownhillToEnd();

  // 출발선 / 결승선 표시
  segments[2].color = COLORS.START;
  segments[3].color = COLORS.START;
  for (let n = 0; n < RUMBLE_LENGTH; n++) segments[segments.length - 1 - n].color = COLORS.FINISH;

  trackLength = segments.length * SEGMENT_LENGTH;
}

function resetSprites() {
  for (let n = 12; n < segments.length; n += 4 + Math.floor(Math.random() * 9)) {
    const side = Math.random() < 0.5 ? -1 : 1;
    segments[n].sprites.push({ offset: side * (1.35 + Math.random() * 1.6), w: 0.55 + Math.random() * 0.25 });
  }
}

function resetCars() {
  cars = [];
  const total = 55;
  for (let i = 0; i < total; i++) {
    const offset = (Math.random() * 2 - 1) * 0.7;
    const z = Math.floor(Math.random() * segments.length) * SEGMENT_LENGTH;
    const sp = MAX_SPEED / 5 + Math.random() * (MAX_SPEED / 2);
    const car = {
      offset,
      z,
      speed: sp,
      w: 0.5,
      percent: 0,
      color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
    };
    findSegment(car.z).cars.push(car);
    cars.push(car);
  }
}

/* ----------------------------------------------------------- 업데이트 */
function update(dt) {
  const playerSegment = findSegment(position + PLAYER_Z);
  const speedPercent = speed / MAX_SPEED;
  const dx = dt * 2 * speedPercent;

  updateCars(dt, playerSegment);

  position = increase(position, dt * speed, trackLength);

  if (input.left) playerX -= dx;
  else if (input.right) playerX += dx;
  playerX -= dx * speedPercent * playerSegment.curve * CENTRIFUGAL;

  // 자동 가속 (브레이크 누르면 감속)
  if (input.brake) speed += BREAKING * dt;
  else speed += ACCEL * dt;

  // 도로 이탈 시 감속 + 흔들림
  let offroad = false;
  if ((playerX < -1 || playerX > 1) && speed > OFFROAD_LIMIT) {
    speed += OFFROAD_DECEL * dt;
    offroad = true;
    if (speed > OFFROAD_LIMIT * 1.2) shake(4 + 6 * speedPercent);
  }

  // 교통 차량 충돌
  for (let n = 0; n < playerSegment.cars.length; n++) {
    const car = playerSegment.cars[n];
    if (speed > car.speed && overlap(playerX, PLAYER_W, car.offset, car.w, 0.8)) {
      speed = car.speed * (car.speed / speed);
      position = increase(car.z, -PLAYER_Z, trackLength);
      shake(18);
      break;
    }
  }

  playerX = limit(playerX, -2, 2);
  speed = limit(speed, 0, MAX_SPEED);

  bgOffset += playerSegment.curve * speedPercent * dt;
  shakeMag *= Math.pow(0.0008, dt);

  distanceM += speed * dt * UNIT_TO_M;
  if (distanceM > best) best = distanceM;

  timeLeft -= dt;
  if (timeLeft <= 0) {
    timeLeft = 0;
    gameOver();
  }
}

function updateCars(dt, playerSegment) {
  for (let n = 0; n < cars.length; n++) {
    const car = cars[n];
    const oldSeg = findSegment(car.z);
    car.offset = limit(car.offset + carSteer(car, oldSeg, playerSegment), -0.9, 0.9);
    car.z = increase(car.z, dt * car.speed, trackLength);
    car.percent = percentRemaining(car.z, SEGMENT_LENGTH);
    const newSeg = findSegment(car.z);
    if (oldSeg !== newSeg) {
      const i = oldSeg.cars.indexOf(car);
      if (i >= 0) oldSeg.cars.splice(i, 1);
      newSeg.cars.push(car);
    }
  }
}

function carSteer(car, carSeg, playerSeg) {
  const lookahead = 20;
  for (let i = 1; i < lookahead; i++) {
    const seg = segments[(carSeg.index + i) % segments.length];
    if (seg === playerSeg && speed > car.speed && overlap(playerX, PLAYER_W, car.offset, car.w, 1.2)) {
      const dir = playerX > 0.4 ? -1 : playerX < -0.4 ? 1 : car.offset > playerX ? 1 : -1;
      return (dir / i) * ((speed - car.speed) / MAX_SPEED) * 0.35;
    }
    for (let j = 0; j < seg.cars.length; j++) {
      const other = seg.cars[j];
      if (car.speed > other.speed && overlap(car.offset, car.w, other.offset, other.w, 1.2)) {
        const dir = other.offset > car.offset ? -1 : 1;
        return (dir / i) * ((car.speed - other.speed) / MAX_SPEED) * 0.35;
      }
    }
  }
  return 0;
}

function shake(v) {
  if (v > shakeMag) shakeMag = v;
}

/* ----------------------------------------------------------- 렌더 */
function render() {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  if (shakeMag > 0.3) {
    ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
  }

  const baseSegment = findSegment(position);
  const basePercent = percentRemaining(position, SEGMENT_LENGTH);
  const playerSegment = findSegment(position + PLAYER_Z);
  const playerPercent = percentRemaining(position + PLAYER_Z, SEGMENT_LENGTH);
  const playerY = lerp(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);
  let maxy = height;
  let x = 0;
  let dx = -(baseSegment.curve * basePercent);

  renderBackground();

  // 도로 (가까운 곳 -> 먼 곳)
  for (let n = 0; n < DRAW_DISTANCE; n++) {
    const seg = segments[(baseSegment.index + n) % segments.length];
    seg.looped = seg.index < baseSegment.index;
    seg.fog = exponentialFog(n / DRAW_DISTANCE, FOG_DENSITY);
    seg.clip = maxy;

    const camZ = position - (seg.looped ? trackLength : 0);
    project(seg.p1, playerX * ROAD_WIDTH - x, playerY + CAMERA_HEIGHT, camZ);
    project(seg.p2, playerX * ROAD_WIDTH - x - dx, playerY + CAMERA_HEIGHT, camZ);
    x += dx;
    dx += seg.curve;

    if (seg.p1.camera.z <= CAMERA_DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxy) continue;
    renderSegment(seg);
    maxy = seg.p1.screen.y;
  }

  // 스프라이트 + 차량 (먼 곳 -> 가까운 곳)
  for (let n = DRAW_DISTANCE - 1; n > 0; n--) {
    const seg = segments[(baseSegment.index + n) % segments.length];
    for (let i = 0; i < seg.cars.length; i++) {
      const car = seg.cars[i];
      const sc = lerp(seg.p1.screen.scale, seg.p2.screen.scale, car.percent);
      const sx = lerp(seg.p1.screen.x, seg.p2.screen.x, car.percent) + (sc * car.offset * ROAD_WIDTH * width) / 2;
      const sy = lerp(seg.p1.screen.y, seg.p2.screen.y, car.percent);
      drawCar(sc, sx, sy, car, seg.clip);
    }
    for (let i = 0; i < seg.sprites.length; i++) {
      const sp = seg.sprites[i];
      const sc = seg.p1.screen.scale;
      const sx = seg.p1.screen.x + (sc * sp.offset * ROAD_WIDTH * width) / 2;
      drawTree(sc, sx, seg.p1.screen.y, sp, seg.clip);
    }
    if (seg === playerSegment) renderPlayer();
  }

  ctx.restore();
  renderSpeedFX();
  updateHUD();
}

function drawPolygon(x1, y1, x2, y2, x3, y3, x4, y4, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

function renderSegment(seg) {
  const c = seg.color;
  const p1 = seg.p1.screen, p2 = seg.p2.screen;
  const r1 = p1.w / Math.max(6, 2 * LANES), r2 = p2.w / Math.max(6, 2 * LANES);
  const l1 = p1.w / Math.max(32, 8 * LANES), l2 = p2.w / Math.max(32, 8 * LANES);

  // 잔디
  ctx.fillStyle = c.grass;
  ctx.fillRect(0, p2.y, width, p1.y - p2.y);
  // 럼블(가장자리)
  drawPolygon(p1.x - p1.w - r1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y, p2.x - p2.w - r2, p2.y, c.rumble);
  drawPolygon(p1.x + p1.w + r1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x + p2.w + r2, p2.y, c.rumble);
  // 도로
  drawPolygon(p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, c.road);
  // 차선
  if (c.lane) {
    const lw1 = (p1.w * 2) / LANES, lw2 = (p2.w * 2) / LANES;
    let lx1 = p1.x - p1.w + lw1, lx2 = p2.x - p2.w + lw2;
    for (let lane = 1; lane < LANES; lane++) {
      drawPolygon(lx1 - l1 / 2, p1.y, lx1 + l1 / 2, p1.y, lx2 + l2 / 2, p2.y, lx2 - l2 / 2, p2.y, c.lane);
      lx1 += lw1;
      lx2 += lw2;
    }
  }
  // 안개(원근감)
  if (seg.fog < 1) {
    ctx.globalAlpha = 1 - seg.fog;
    ctx.fillStyle = COLORS.FOG;
    ctx.fillRect(0, p2.y, width, p1.y - p2.y);
    ctx.globalAlpha = 1;
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCar(sc, sx, sy, car, clip) {
  const sw = (sc * ROAD_WIDTH * width) / 2;
  const w = car.w * sw;
  const h = w * 0.8;
  if (w < 2) return;
  const x = sx - w / 2, y = sy - h;
  ctx.save();
  if (clip < sy) {
    ctx.beginPath();
    ctx.rect(0, 0, width, clip);
    ctx.clip();
  }
  // 그림자
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, w * 0.55, h * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  // 차체
  roundRect(x, y, w, h, w * 0.16);
  ctx.fillStyle = car.color;
  ctx.fill();
  // 창문
  ctx.fillStyle = 'rgba(10,12,24,0.55)';
  roundRect(x + w * 0.16, y + h * 0.12, w * 0.68, h * 0.42, w * 0.1);
  ctx.fill();
  // 후미등
  ctx.fillStyle = '#ff3b3b';
  ctx.fillRect(x + w * 0.1, y + h * 0.64, w * 0.18, h * 0.18);
  ctx.fillRect(x + w * 0.72, y + h * 0.64, w * 0.18, h * 0.18);
  ctx.restore();
}

function drawTree(sc, sx, sy, sp, clip) {
  const sw = (sc * ROAD_WIDTH * width) / 2;
  const w = sp.w * sw;
  const h = w * 2.6;
  if (w < 2) return;
  ctx.save();
  if (clip < sy) {
    ctx.beginPath();
    ctx.rect(0, 0, width, clip);
    ctx.clip();
  }
  const topX = sx, topY = sy - h * 0.78;
  // 줄기
  ctx.strokeStyle = '#2a1846';
  ctx.lineWidth = Math.max(2, w * 0.13);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(sx + w * 0.08, topY + h * 0.3, topX, topY);
  ctx.stroke();
  // 야자수 잎
  ctx.strokeStyle = '#127a52';
  ctx.lineWidth = Math.max(2, w * 0.11);
  for (let a = 0; a < 7; a++) {
    const ang = Math.PI + (a / 6) * Math.PI;
    const lx = topX + Math.cos(ang) * w * 0.8;
    const ly = topY + Math.sin(ang) * w * 0.5 - w * 0.1;
    ctx.beginPath();
    ctx.moveTo(topX, topY);
    ctx.quadraticCurveTo((topX + lx) / 2, topY - w * 0.35, lx, ly);
    ctx.stroke();
  }
  ctx.restore();
}

function renderPlayer() {
  const sc = CAMERA_DEPTH / PLAYER_Z;
  const sw = (sc * ROAD_WIDTH * width) / 2;
  const w = PLAYER_W * sw;
  const h = w * 0.82;
  const speedPercent = speed / MAX_SPEED;
  const bounce = (Math.random() - 0.5) * 2 * speedPercent * (isOffroad() ? 3.2 : 0.8);
  const lean = (input.left ? -1 : input.right ? 1 : 0) * w * 0.06;
  const cx = width / 2 + lean;
  const cy = height * 0.86 + bounce;
  const x = cx - w / 2, y = cy - h;

  // 그림자
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.55, h * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  // 차체
  roundRect(x, y, w, h, w * 0.16);
  ctx.fillStyle = '#ff2d95';
  ctx.fill();
  // 스포일러
  ctx.fillStyle = '#11121f';
  ctx.fillRect(x - w * 0.04, y + h * 0.06, w * 1.08, h * 0.1);
  // 창문
  ctx.fillStyle = 'rgba(10,12,24,0.65)';
  roundRect(x + w * 0.16, y + h * 0.2, w * 0.68, h * 0.4, w * 0.1);
  ctx.fill();
  // 후미등 (네온)
  ctx.fillStyle = '#ff5e5e';
  ctx.shadowColor = '#ff2d2d';
  ctx.shadowBlur = 12;
  ctx.fillRect(x + w * 0.08, y + h * 0.66, w * 0.2, h * 0.18);
  ctx.fillRect(x + w * 0.72, y + h * 0.66, w * 0.2, h * 0.18);
  ctx.shadowBlur = 0;
}

function isOffroad() {
  return (playerX < -1 || playerX > 1) && speed > OFFROAD_LIMIT;
}

/* ----------------------------------------------------------- 배경 */
function renderBackground() {
  const horizon = height * 0.52;
  // 하늘 그라데이션
  const g = ctx.createLinearGradient(0, 0, 0, horizon + height * 0.1);
  g.addColorStop(0, '#0b1026');
  g.addColorStop(0.55, '#3a1d6e');
  g.addColorStop(1, '#ff5e87');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  drawSun(width / 2 - limit(bgOffset, -14, 14) * 6, horizon - height * 0.02);
  drawMountains(horizon);
}

function drawSun(cx, cy) {
  const R = Math.min(width, height) * 0.2;
  ctx.save();
  const g = ctx.createLinearGradient(cx, cy - R, cx, cy + R);
  g.addColorStop(0, '#ffe66d');
  g.addColorStop(0.5, '#ff9a4d');
  g.addColorStop(1, '#ff2d95');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  // 하단 줄무늬(가로 틈)
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 6; i++) {
    const y = cy + R * 0.12 + i * (R * 0.17);
    ctx.fillRect(cx - R, y, R * 2, 2 + i * 1.5);
  }
  ctx.restore();
}

function drawMountains(baseY) {
  const shift = bgOffset * 40;
  ctx.fillStyle = '#160d33';
  ctx.beginPath();
  ctx.moveTo(0, baseY);
  for (let px = 0; px <= width; px += 36) {
    const sxv = px + shift;
    const hh = (Math.sin(sxv * 0.012) + Math.sin(sxv * 0.031 + 2) + Math.sin(sxv * 0.07)) / 3;
    const peak = baseY - (24 + (hh + 1) * 0.5 * height * 0.16);
    ctx.lineTo(px, peak);
  }
  ctx.lineTo(width, baseY);
  ctx.closePath();
  ctx.fill();
  // 능선 네온 라인
  ctx.strokeStyle = 'rgba(255,45,149,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/* ----------------------------------------------------------- 속도 효과 */
function renderSpeedFX() {
  const sp = speed / MAX_SPEED;
  const g = ctx.createRadialGradient(width / 2, height * 0.55, height * 0.18, width / 2, height * 0.55, height * 0.85);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(2,2,12,' + (0.3 + 0.4 * sp) + ')');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  if (sp > 0.35) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(170,225,255,' + (0.04 + 0.1 * sp) + ')';
    ctx.lineWidth = 2;
    const cx = width / 2, cy = height * 0.46;
    const count = 16;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + position * 0.00008;
      const r1 = height * 0.16;
      const r2 = height * (0.5 + 0.6 * sp);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ----------------------------------------------------------- HUD */
const el = {
  speed: document.getElementById('speed'),
  distance: document.getElementById('distance'),
  best: document.getElementById('best'),
  time: document.getElementById('time'),
  gear: document.getElementById('gear'),
};
function fmtM(m) {
  m = Math.floor(m);
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : m + ' m';
}
function updateHUD() {
  el.speed.textContent = Math.round((speed / MAX_SPEED) * TOP_KMH);
  el.distance.textContent = fmtM(distanceM);
  el.best.textContent = fmtM(best);
  if (el.time) el.time.textContent = Math.ceil(timeLeft);
  if (el.gear) el.gear.textContent = input.brake ? 'B' : speed > 0 ? 'D' : 'N';
}

/* ----------------------------------------------------------- 게임 흐름 */
const overlay = document.getElementById('overlay');
const overlayMsg = document.getElementById('overlay-msg');
const overlayScore = document.getElementById('overlay-score');
const startBtn = document.getElementById('start');

function startGame() {
  resetRoad();
  resetSprites();
  resetCars();
  position = 0;
  speed = 0;
  playerX = 0;
  bgOffset = 0;
  shakeMag = 0;
  distanceM = 0;
  timeLeft = RUN_TIME;
  state = 'play';
  overlay.classList.add('hidden');
}

function gameOver() {
  state = 'over';
  localStorage.setItem('neonrush.best', String(Math.floor(best)));
  overlayMsg.textContent = '시간 종료!';
  overlayScore.hidden = false;
  overlayScore.innerHTML =
    '이번 거리 <b>' + fmtM(distanceM) + '</b><br>최고 기록 ' + fmtM(best);
  startBtn.textContent = '🏁 다시 달리기';
  overlay.classList.remove('hidden');
}

startBtn.addEventListener('click', startGame);

/* ----------------------------------------------------------- 입력 */
function bindHold(id, key) {
  const node = document.getElementById(id);
  const on = (e) => { e.preventDefault(); input[key] = true; node.classList.add('on'); };
  const off = (e) => { e.preventDefault(); input[key] = false; node.classList.remove('on'); };
  node.addEventListener('pointerdown', on);
  node.addEventListener('pointerup', off);
  node.addEventListener('pointerleave', off);
  node.addEventListener('pointercancel', off);
}
bindHold('btn-left', 'left');
bindHold('btn-right', 'right');
bindHold('btn-brake', 'brake');

window.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowLeft': case 'a': case 'A': input.left = true; e.preventDefault(); break;
    case 'ArrowRight': case 'd': case 'D': input.right = true; e.preventDefault(); break;
    case 'ArrowDown': case 's': case 'S': case ' ': input.brake = true; e.preventDefault(); break;
    case 'Enter': if (state !== 'play') startGame(); break;
  }
});
window.addEventListener('keyup', (e) => {
  switch (e.key) {
    case 'ArrowLeft': case 'a': case 'A': input.left = false; break;
    case 'ArrowRight': case 'd': case 'D': input.right = false; break;
    case 'ArrowDown': case 's': case 'S': case ' ': input.brake = false; break;
  }
});

/* ----------------------------------------------------------- 루프 */
let last = performance.now();
let acc = 0;
function frame(now) {
  let dt = (now - last) / 1000;
  if (dt > 0.25) dt = 0.25; // 탭 전환 등으로 큰 점프 방지
  last = now;
  if (state === 'play') {
    acc += dt;
    while (acc >= STEP) {
      update(STEP);
      acc -= STEP;
      if (state !== 'play') break;
    }
  }
  render();
  requestAnimationFrame(frame);
}

/* ----------------------------------------------------------- 시작 */
resize();
resetRoad();
resetSprites();
resetCars();
el.best.textContent = fmtM(best);
requestAnimationFrame(frame);
