'use strict';

/* =========================================================================
 * 지오게스 — 스트리트뷰 위치 추측 게임
 * 순수 JS. 빌드 단계 없음. Google Maps JavaScript API 사용.
 * ========================================================================= */

const KEY_STORAGE = 'geoguess.gmaps.key';
const WORLD_MAP_SIZE_KM = 14916; // 전세계 모드 점수 스케일 (GeoGuessr 기준값)
const MAX_PANO_ATTEMPTS = 70;    // 스트리트뷰를 찾기 위한 최대 시도 횟수
const PANO_RADIUS_M = 100000;    // 임의 좌표에서 스냅할 최대 반경(100km)

const state = {
  mode: 'world',
  country: null,      // 국가 모드일 때 선택된 COUNTRIES 항목
  rounds: 5,
  allowMove: true,
  current: 0,         // 현재 라운드 인덱스 (0-base)
  results: [],        // { actual, guess, distance, points }
  actual: null,       // 이번 라운드 정답 좌표 {lat,lng}
  guess: null,        // 이번 라운드 추측 좌표 {lat,lng}
};

// Google Maps 객체들
let panorama = null;
let guessMap = null;
let guessMarker = null;
let resultMap = null;
let svService = null;

/* ------------------------------------------------------------------ DOM */
const $ = (sel) => document.querySelector(sel);
const screens = {
  key: $('#screen-key'),
  menu: $('#screen-menu'),
  game: $('#screen-game'),
  result: $('#screen-result'),
  final: $('#screen-final'),
};
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
}

/* ============================================================ 지오 유틸 */
const toRad = (d) => (d * Math.PI) / 180;

// 두 좌표 사이 거리(미터) — 하버사인
function haversine(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// bbox 대각선 길이(km) — 국가 모드 점수 스케일에 사용
function bboxDiagonalKm(bbox) {
  return haversine({ lat: bbox.s, lng: bbox.w }, { lat: bbox.n, lng: bbox.e }) / 1000;
}

// bbox 안의 임의 좌표. 위도는 구면 면적이 균등하도록 샘플링.
function randomPointInBBox(bbox) {
  const sinS = Math.sin(toRad(bbox.s));
  const sinN = Math.sin(toRad(bbox.n));
  const lat = (Math.asin(sinS + Math.random() * (sinN - sinS)) * 180) / Math.PI;
  const lng = bbox.w + Math.random() * (bbox.e - bbox.w);
  return { lat, lng };
}

// 점수: GeoGuessr 공식. mapSizeKm 이 작을수록(작은 나라) 더 엄격.
function computeScore(distanceMeters, mapSizeKm) {
  const dKm = distanceMeters / 1000;
  const score = 5000 * Math.exp((-10 * dKm) / mapSizeKm);
  return Math.round(Math.max(0, Math.min(5000, score)));
}

function formatDistance(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 100000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000).toLocaleString()} km`;
}

/* ====================================================== Google Maps 로딩 */
function loadGoogleMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) return resolve();
    window.__gmapsReady = () => resolve();
    const s = document.createElement('script');
    s.src =
      'https://maps.googleapis.com/maps/api/js?key=' +
      encodeURIComponent(apiKey) +
      '&v=weekly&loading=async&callback=__gmapsReady';
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps 스크립트를 불러오지 못했습니다.'));
    document.head.appendChild(s);
  });
}

/* ============================================ 스트리트뷰 파노라마 찾기 */
function snapToPanorama(point) {
  return new Promise((resolve) => {
    svService.getPanorama(
      {
        location: point,
        radius: PANO_RADIUS_M,
        source: google.maps.StreetViewSource.OUTDOOR,
        preference: google.maps.StreetViewPreference.NEAREST,
      },
      (data, status) => {
        if (status === google.maps.StreetViewStatus.OK && data && data.location) {
          const ll = data.location.latLng;
          resolve({ pano: data.location.pano, lat: ll.lat(), lng: ll.lng() });
        } else if (status === google.maps.StreetViewStatus.OK) {
          resolve(null);
        } else if (status === google.maps.StreetViewStatus.ZERO_RESULTS) {
          resolve(null);
        } else {
          // OVER_QUERY_LIMIT / REQUEST_DENIED 등
          resolve({ error: status });
        }
      }
    );
  });
}

// 모드에 맞는 임의의 스트리트뷰 장소를 찾아 반환.
async function findLocation() {
  for (let i = 0; i < MAX_PANO_ATTEMPTS; i++) {
    const bbox =
      state.mode === 'country'
        ? state.country.bbox
        : COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)].bbox;
    const seed = randomPointInBBox(bbox);
    const res = await snapToPanorama(seed);
    if (res && res.error) throw new Error('스트리트뷰 요청 거부됨: ' + res.error);
    if (res) return res;
  }
  throw new Error('스트리트뷰 장소를 찾지 못했습니다. 다시 시도해 주세요.');
}

/* ================================================================ 게임 */
function startGame() {
  state.current = 0;
  state.results = [];
  nextRound();
}

async function nextRound() {
  state.guess = null;
  showScreen('game');
  setupGuessMapForMode(); // 화면이 활성화된 뒤 생성해야 지도가 올바른 크기를 가짐
  showLoading(true, '장소를 찾는 중…');

  try {
    const loc = await findLocation();
    state.actual = { lat: loc.lat, lng: loc.lng };
    renderPanorama(loc);
    resetGuessMap();
    updateHud();
    showLoading(false);
  } catch (err) {
    showLoading(true, '⚠️ ' + err.message);
    console.error(err);
  }
}

function renderPanorama(loc) {
  const options = {
    position: { lat: loc.lat, lng: loc.lng },
    pov: { heading: Math.random() * 360, pitch: 0 },
    zoom: 0,
    addressControl: false,
    showRoadLabels: false,
    fullscreenControl: false,
    motionTracking: false,
    motionTrackingControl: false,
    enableCloseButton: false,
    linksControl: state.allowMove,
    clickToGo: state.allowMove,
    panControl: true,
    zoomControl: true,
  };
  if (!panorama) {
    panorama = new google.maps.StreetViewPanorama($('#pano'), options);
  } else {
    panorama.setOptions(options);
    panorama.setPano(loc.pano);
    panorama.setPov({ heading: options.pov.heading, pitch: 0 });
    panorama.setZoom(0);
  }
  // 처음 위치(스냅된 파노라마)를 저장 — '처음 위치로' 버튼용
  state._startPano = loc.pano;
}

function updateHud() {
  $('#hud-round').textContent = `라운드 ${state.current + 1}/${state.rounds}`;
  $('#hud-mode').textContent =
    state.mode === 'country' ? `${state.country.flag} ${state.country.ko}` : '🌐 전세계';
  $('#hud-score').textContent = `${totalScore()} 점`;
}

function totalScore() {
  return state.results.reduce((s, r) => s + r.points, 0);
}

/* ----------------------------------------------------------- 추측 지도 */
function setupGuessMapForMode() {
  const opts = {
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: 'greedy',
    clickableIcons: false,
    streetViewControl: false,
    mapTypeControl: false,
  };
  if (!guessMap) {
    guessMap = new google.maps.Map($('#guess-map'), { ...opts, center: { lat: 20, lng: 0 }, zoom: 1 });
    guessMap.addListener('click', (e) => placeGuess(e.latLng));
  } else {
    guessMap.setOptions(opts);
  }
}

function resetGuessMap() {
  if (guessMarker) { guessMarker.setMap(null); guessMarker = null; }
  state.guess = null;
  $('#guess-confirm').disabled = true;

  // 모바일에서는 접힌 상태로 시작
  const panel = $('#guess-panel');
  const collapsible = window.matchMedia('(max-width: 819px), (pointer: coarse)').matches;
  panel.classList.toggle('collapsed', collapsible);
  $('#guess-toggle').textContent = '🗺️ 지도 열기';

  if (state.mode === 'country') {
    const b = state.country.bbox;
    guessMap.fitBounds(
      new google.maps.LatLngBounds({ lat: b.s, lng: b.w }, { lat: b.n, lng: b.e })
    );
  } else {
    guessMap.setCenter({ lat: 20, lng: 0 });
    guessMap.setZoom(1);
  }
}

function placeGuess(latLng) {
  state.guess = { lat: latLng.lat(), lng: latLng.lng() };
  if (!guessMarker) {
    guessMarker = new google.maps.Marker({ map: guessMap, position: latLng, draggable: true });
    guessMarker.addListener('dragend', (e) => {
      state.guess = { lat: e.latLng.lat(), lng: e.latLng.lng() };
    });
  } else {
    guessMarker.setPosition(latLng);
  }
  $('#guess-confirm').disabled = false;
}

/* --------------------------------------------------------- 라운드 종료 */
function confirmGuess() {
  if (!state.guess) return;
  const distance = haversine(state.guess, state.actual);
  const mapSize =
    state.mode === 'country' ? bboxDiagonalKm(state.country.bbox) : WORLD_MAP_SIZE_KM;
  const points = computeScore(distance, mapSize);

  state.results.push({
    actual: { ...state.actual },
    guess: { ...state.guess },
    distance,
    points,
  });

  showResult(distance, points);
}

function showResult(distance, points) {
  showScreen('result');
  $('#result-points').textContent = points.toLocaleString();
  $('#result-distance').textContent = formatDistance(distance);
  $('#score-bar-fill').style.width = (points / 5000) * 100 + '%';
  $('#next-round').textContent =
    state.current + 1 >= state.rounds ? '결과 보기' : '다음 라운드';

  if (!resultMap) {
    resultMap = new google.maps.Map($('#result-map'), {
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'greedy',
      clickableIcons: false,
    });
  }
  drawResultMap();
}

function drawResultMap() {
  const actual = state.actual;
  const guess = state.guess;

  // 기존 오버레이 제거
  if (resultMap.__overlays) resultMap.__overlays.forEach((o) => o.setMap(null));
  resultMap.__overlays = [];

  const actualMarker = new google.maps.Marker({
    map: resultMap,
    position: actual,
    label: { text: '정답', color: '#fff', fontSize: '11px' },
    icon: pinIcon('#34d399'),
  });
  const guessMarker2 = new google.maps.Marker({
    map: resultMap,
    position: guess,
    label: { text: '내추측', color: '#fff', fontSize: '11px' },
    icon: pinIcon('#f87171'),
  });
  const line = new google.maps.Polyline({
    map: resultMap,
    path: [guess, actual],
    geodesic: true,
    strokeColor: '#ffffff',
    strokeOpacity: 0.85,
    strokeWeight: 2,
  });
  resultMap.__overlays.push(actualMarker, guessMarker2, line);

  const bounds = new google.maps.LatLngBounds();
  bounds.extend(actual);
  bounds.extend(guess);
  resultMap.fitBounds(bounds, 60);
  // 두 점이 거의 겹치면 너무 확대됨 -> 보정
  google.maps.event.addListenerOnce(resultMap, 'idle', () => {
    if (resultMap.getZoom() > 14) resultMap.setZoom(14);
  });
}

function pinIcon(color) {
  return {
    path: 'M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z',
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#0f1117',
    strokeWeight: 1.5,
    scale: 1.3,
    anchor: new google.maps.Point(12, 36),
    labelOrigin: new google.maps.Point(12, 12),
  };
}

function advance() {
  state.current++;
  if (state.current >= state.rounds) {
    showFinal();
  } else {
    nextRound();
  }
}

/* --------------------------------------------------------- 최종 결과 */
function showFinal() {
  showScreen('final');
  const total = totalScore();
  const max = state.rounds * 5000;
  $('#final-score').textContent = total.toLocaleString();
  $('#final-max').textContent = max.toLocaleString();
  $('#final-grade').textContent = grade(total / max);

  const list = $('#final-rounds');
  list.innerHTML = '';
  state.results.forEach((r, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>라운드 ${i + 1} · ${formatDistance(r.distance)}</span>
      <span class="pts">${r.points.toLocaleString()} 점</span>`;
    list.appendChild(li);
  });
}

function grade(ratio) {
  if (ratio >= 0.9) return '🏆 지리 마스터!';
  if (ratio >= 0.7) return '🌟 훌륭해요!';
  if (ratio >= 0.5) return '👍 좋아요!';
  if (ratio >= 0.3) return '🙂 나쁘지 않아요';
  return '🌱 다음엔 더 잘할 수 있어요!';
}

/* ------------------------------------------------------------ 로딩 UI */
function showLoading(on, text) {
  $('#loading').hidden = !on;
  if (text) $('#loading-text').textContent = text;
}

/* ====================================================== 메뉴/이벤트 */
function populateCountrySelect() {
  const sel = $('#country-select');
  sel.innerHTML = '';
  COUNTRIES.slice()
    .sort((a, b) => a.ko.localeCompare(b.ko, 'ko'))
    .forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.code;
      opt.textContent = `${c.flag} ${c.ko}`;
      sel.appendChild(opt);
    });
}

function wireMenu() {
  // 모드 선택
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
      $('#country-field').hidden = state.mode !== 'country';
    });
  });

  $('#start-game').addEventListener('click', () => {
    state.rounds = parseInt($('#rounds-select').value, 10);
    state.allowMove = $('#allow-move').checked;
    if (state.mode === 'country') {
      const code = $('#country-select').value;
      state.country = COUNTRIES.find((c) => c.code === code);
    }
    startGame();
  });

  $('#change-key').addEventListener('click', () => {
    localStorage.removeItem(KEY_STORAGE);
    location.reload();
  });
}

function wireGame() {
  // 추측 패널 열기/닫기 토글 (모바일)
  $('#guess-toggle').addEventListener('click', () => {
    const panel = $('#guess-panel');
    const nowCollapsed = panel.classList.toggle('collapsed');
    $('#guess-toggle').textContent = nowCollapsed ? '🗺️ 지도 열기' : '✕ 지도 닫기';
    if (!nowCollapsed) {
      google.maps.event.trigger(guessMap, 'resize');
      resetGuessMapView();
    }
  });

  $('#guess-confirm').addEventListener('click', confirmGuess);
  $('#next-round').addEventListener('click', advance);
  $('#recenter').addEventListener('click', () => {
    if (panorama && state._startPano) {
      panorama.setPano(state._startPano);
      panorama.setZoom(0);
    }
  });

  $('#play-again').addEventListener('click', startGame);
  $('#back-menu').addEventListener('click', () => showScreen('menu'));
}

// 패널 크기 변경 후 지도 시야 재설정
function resetGuessMapView() {
  setTimeout(() => {
    if (state.guess) {
      guessMap.setCenter(state.guess);
    } else if (state.mode === 'country') {
      const b = state.country.bbox;
      guessMap.fitBounds(
        new google.maps.LatLngBounds({ lat: b.s, lng: b.w }, { lat: b.n, lng: b.e })
      );
    }
  }, 200);
}

/* ============================================================== 부트스트랩 */
function bootMenu() {
  populateCountrySelect();
  wireMenu();
  wireGame();
  showScreen('menu');
}

async function initWithKey(key) {
  showScreen('key');
  $('#key-error').hidden = true;
  $('#key-save').disabled = true;
  $('#key-save').textContent = '불러오는 중…';
  try {
    await loadGoogleMaps(key);
    svService = new google.maps.StreetViewService();
    localStorage.setItem(KEY_STORAGE, key);
    bootMenu();
  } catch (err) {
    $('#key-error').hidden = false;
    $('#key-error').textContent = err.message + ' 키를 확인 후 다시 시도하세요.';
    $('#key-save').disabled = false;
    $('#key-save').textContent = '시작하기';
  }
}

function init() {
  // URL 파라미터(?key=) 또는 저장된 키 우선 사용
  const params = new URLSearchParams(location.search);
  const urlKey = params.get('key');
  const savedKey = localStorage.getItem(KEY_STORAGE);
  const key = urlKey || savedKey;

  $('#key-save').addEventListener('click', () => {
    const k = $('#key-input').value.trim();
    if (k) initWithKey(k);
  });
  $('#key-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#key-save').click();
  });

  if (key) {
    initWithKey(key);
  } else {
    showScreen('key');
  }
}

document.addEventListener('DOMContentLoaded', init);
