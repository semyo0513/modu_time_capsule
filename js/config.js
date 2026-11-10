/**
 * 모두의 타임캡슐 - 클라이언트 환경 설정
 * 구글 앱스 스크립트 웹앱 배포 후 발급받은 URL을 아래 GAS_URL에 입력합니다.
 */
var APP_CONFIG = {
  // 배포된 Google Apps Script 웹앱 URL (새 배포 -> 웹 앱 -> URL)
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwYyQZ1v6M1_EXAMPLE_CHANGE_ME/exec',

  // 서약문 월(Wall) 화면 폴링 간격 (밀리초, 기본 4초)
  WALL_POLL_INTERVAL_MS: 4000,

  // 세션 스토리지 / 로컬 스토리지 키
  STORAGE_KEYS: {
    ADMIN_TOKEN: 'timecapsule_admin_token',
    SEALED_SESSION_PREFIX: 'timecapsule_sealed_'
  }
};
