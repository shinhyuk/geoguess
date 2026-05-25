// 스트리트뷰 커버리지가 좋은 국가들의 대략적인 경계 상자(bounding box).
// bbox = { s: 남쪽위도, w: 서쪽경도, n: 북쪽위도, e: 동쪽경도 }
// 빈 바다/사막을 줄이기 위해 인구 밀집 지역 위주로 약간 좁게 잡았습니다.
const COUNTRIES = [
  { code: 'KR', ko: '대한민국',      flag: '🇰🇷', bbox: { s: 33.2, w: 126.0, n: 38.5, e: 129.5 } },
  { code: 'JP', ko: '일본',          flag: '🇯🇵', bbox: { s: 31.0, w: 130.0, n: 45.4, e: 145.5 } },
  { code: 'US', ko: '미국',          flag: '🇺🇸', bbox: { s: 25.5, w: -123.5, n: 48.5, e: -69.0 } },
  { code: 'GB', ko: '영국',          flag: '🇬🇧', bbox: { s: 50.2, w: -6.5, n: 58.0, e: 1.6 } },
  { code: 'FR', ko: '프랑스',        flag: '🇫🇷', bbox: { s: 43.0, w: -4.3, n: 50.8, e: 7.2 } },
  { code: 'IT', ko: '이탈리아',      flag: '🇮🇹', bbox: { s: 37.5, w: 7.2, n: 46.2, e: 17.0 } },
  { code: 'ES', ko: '스페인',        flag: '🇪🇸', bbox: { s: 37.0, w: -8.8, n: 43.5, e: 3.0 } },
  { code: 'DE', ko: '독일',          flag: '🇩🇪', bbox: { s: 47.6, w: 6.5, n: 54.5, e: 14.5 } },
  { code: 'NL', ko: '네덜란드',      flag: '🇳🇱', bbox: { s: 51.2, w: 3.6, n: 53.3, e: 6.9 } },
  { code: 'CH', ko: '스위스',        flag: '🇨🇭', bbox: { s: 46.0, w: 6.1, n: 47.6, e: 10.2 } },
  { code: 'PL', ko: '폴란드',        flag: '🇵🇱', bbox: { s: 49.8, w: 14.8, n: 54.4, e: 23.3 } },
  { code: 'SE', ko: '스웨덴',        flag: '🇸🇪', bbox: { s: 55.6, w: 12.2, n: 62.5, e: 18.5 } },
  { code: 'NO', ko: '노르웨이',      flag: '🇳🇴', bbox: { s: 58.6, w: 5.2, n: 63.3, e: 11.3 } },
  { code: 'PT', ko: '포르투갈',      flag: '🇵🇹', bbox: { s: 37.2, w: -9.2, n: 41.7, e: -6.7 } },
  { code: 'IE', ko: '아일랜드',      flag: '🇮🇪', bbox: { s: 51.6, w: -10.0, n: 55.2, e: -6.2 } },
  { code: 'TR', ko: '튀르키예',      flag: '🇹🇷', bbox: { s: 37.2, w: 27.5, n: 41.2, e: 41.5 } },
  { code: 'RU', ko: '러시아(서부)',  flag: '🇷🇺', bbox: { s: 52.5, w: 37.0, n: 59.5, e: 59.0 } },
  { code: 'CA', ko: '캐나다(남부)',  flag: '🇨🇦', bbox: { s: 43.8, w: -122.0, n: 49.5, e: -65.0 } },
  { code: 'MX', ko: '멕시코',        flag: '🇲🇽', bbox: { s: 17.5, w: -105.0, n: 29.0, e: -89.5 } },
  { code: 'BR', ko: '브라질',        flag: '🇧🇷', bbox: { s: -29.5, w: -53.5, n: -3.5, e: -39.0 } },
  { code: 'AR', ko: '아르헨티나',    flag: '🇦🇷', bbox: { s: -39.5, w: -68.5, n: -27.5, e: -57.5 } },
  { code: 'CL', ko: '칠레(중부)',    flag: '🇨🇱', bbox: { s: -38.0, w: -73.3, n: -33.0, e: -70.6 } },
  { code: 'CO', ko: '콜롬비아',      flag: '🇨🇴', bbox: { s: 3.8, w: -76.3, n: 6.8, e: -73.3 } },
  { code: 'ZA', ko: '남아프리카공화국', flag: '🇿🇦', bbox: { s: -34.2, w: 18.0, n: -25.8, e: 31.0 } },
  { code: 'AU', ko: '호주(동/남부)', flag: '🇦🇺', bbox: { s: -38.0, w: 115.0, n: -27.5, e: 153.4 } },
  { code: 'NZ', ko: '뉴질랜드',      flag: '🇳🇿', bbox: { s: -45.3, w: 168.5, n: -36.8, e: 175.3 } },
  { code: 'TH', ko: '태국',          flag: '🇹🇭', bbox: { s: 7.5, w: 98.5, n: 19.0, e: 104.5 } },
  { code: 'ID', ko: '인도네시아(자바)', flag: '🇮🇩', bbox: { s: -8.4, w: 106.2, n: -6.2, e: 113.8 } },
  { code: 'PH', ko: '필리핀(루손)',  flag: '🇵🇭', bbox: { s: 13.8, w: 120.6, n: 15.5, e: 121.4 } },
  { code: 'IN', ko: '인도',          flag: '🇮🇳', bbox: { s: 12.5, w: 73.8, n: 28.0, e: 80.3 } },
];

if (typeof window !== 'undefined') window.COUNTRIES = COUNTRIES;
