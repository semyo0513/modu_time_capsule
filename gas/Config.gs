/**
 * 모두의 타임캡슐 - 설정 및 상수
 */
var CONFIG = {
  // 시트 탭 이름
  SHEETS: {
    SESSIONS: 'Sessions',
    CAPSULES: 'Capsules',
    LOGS: 'Logs'
  },

  // 헤더 정의 (시트 순서에 의존하지 않고 헤더명으로 매핑)
  HEADERS: {
    SESSIONS: [
      'sessionId', 'name', 'defaultSendAt', 'allowCustomDate',
      'maxSendAt', 'isOpen', 'purgeAfterSend', 'closingMessage',
      'wallPhase', 'createdAt'
    ],
    CAPSULES: [
      'capsuleId', 'sessionId', 'nickname', 'pledgeA', 'pledgeB',
      'emailTo', 'subject', 'body', 'sendMode', 'customSendAt',
      'status', 'retryCount', 'lastError', 'createdAt', 'sentAt'
    ],
    LOGS: [
      'time', 'level', 'action', 'detail'
    ]
  },

  // 발송 제약 사항
  BATCH_SIZE: 30,          // 1회 트리거 시 최대 처리 건수 (GAS 6분 타임아웃 방지)
  MAX_RETRY: 3,            // 발송 실패 시 최대 재시도 횟수
  LOCK_TIMEOUT_MS: 30000,  // 락 획득 타임아웃 (30초)
  TOKEN_TTL_SEC: 7200,     // 관리자 세션 토큰 유효시간 (2시간)

  // 입력값 검증 제한
  LIMITS: {
    MAX_CAPSULES_PER_SESSION: 1000,
    PLEDGE_MIN_LEN: 2,
    PLEDGE_MAX_LEN: 40,
    SUBJECT_MIN_LEN: 1,
    SUBJECT_MAX_LEN: 80,
    BODY_MIN_LEN: 1,
    BODY_MAX_LEN: 2000,
    NICKNAME_MAX_LEN: 20
  },

  // 기본 문구
  DEFAULT_CLOSING_MESSAGE: 
    "선생님들, 오늘 모듈 4의 4시간은 지도안 양식을 채우는 시간이 아니었습니다.\n" +
    "기술에 주눅 들지 않고 교사의 주권으로 수업을 깎아내는 '진짜 전문가의 시간'이었습니다.\n" +
    "교실에 돌아가셨을 때, 오늘 여러분이 세운 이 원칙 하나가 학생들의 생각을 깨우는 거대한 물결이 될 것입니다."
};
