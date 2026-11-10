/**
 * ============================================================================
 * 모두의 타임캡슐 (Everyone's Time Capsule) — 통합 백엔드 스크립트 (Code.gs)
 * ============================================================================
 * Google Apps Script에 여러 파일 생성할 필요 없이, 이 파일 전체를 복사하여
 * Apps Script 기본 Code.gs에 붙여넣으면 즉시 동작합니다.
 *
 * [주요 구성]
 * 1. CONFIG: 시트명, 헤더 매핑, 제약 상수
 * 2. Utils: 헤더 기반 시트 I/O, 수식 인젝션 방어, HTML 이스케이프, 날짜 유틸
 * 3. Auth: 관리자 비밀번호 검증 및 CacheService 토큰 관리
 * 4. Sessions: 세션 CRUD, 대시보드 통계
 * 5. Capsules: 서약문 제출, 서버 검증, 월 화면용 조회 (개인정보 제외)
 * 6. Mailer: 반응형 HTML 메일 템플릿, 이스케이프, 발송
 * 7. Scheduler: 예약일 도래 캡슐 자동 발송, 10분 트리거 관리
 * 8. Router & Setup: doGet, doPost, setup(), processDueCapsules()
 */

/* ============================================================================
   1. CONFIG (설정 및 상수)
   ============================================================================ */
var CONFIG = {
  SHEETS: {
    SESSIONS: 'Sessions',
    CAPSULES: 'Capsules',
    LOGS: 'Logs'
  },

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

  BATCH_SIZE: 30,          // 1회 트리거 시 최대 처리 건수 (GAS 6분 타임아웃 방지)
  MAX_RETRY: 3,            // 발송 실패 시 최대 재시도 횟수
  LOCK_TIMEOUT_MS: 30000,  // 락 획득 타임아웃 (30초)
  TOKEN_TTL_SEC: 7200,     // 관리자 세션 토큰 유효시간 (2시간)

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

  DEFAULT_CLOSING_MESSAGE: 
    "선생님들, 오늘 모듈 4의 4시간은 지도안 양식을 채우는 시간이 아니었습니다.\n" +
    "기술에 주눅 들지 않고 교사의 주권으로 수업을 깎아내는 '진짜 전문가의 시간'이었습니다.\n" +
    "교실에 돌아가셨을 때, 오늘 여러분이 세운 이 원칙 하나가 학생들의 생각을 깨우는 거대한 물결이 될 것입니다."
};

/* ============================================================================
   2. Utils (공통 유틸리티)
   ============================================================================ */
var Utils = {
  getSpreadsheet: function() {
    var props = PropertiesService.getScriptProperties();
    var sheetId = props.getProperty('SHEET_ID');
    if (!sheetId) {
      throw new Error('Script Properties에 SHEET_ID가 설정되지 않았습니다.');
    }
    return SpreadsheetApp.openById(sheetId);
  },

  getSheet: function(sheetName) {
    var ss = this.getSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error('시트를 찾을 수 없습니다: ' + sheetName);
    }
    return sheet;
  },

  readAllRows: function(sheetName) {
    var sheet = this.getSheet(sheetName);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];

    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = values[0].map(function(h) { return String(h).trim(); });

    var rows = [];
    for (var r = 1; r < values.length; r++) {
      var rowObj = { _rowNumber: r + 1 };
      for (var c = 0; c < headers.length; c++) {
        var header = headers[c];
        if (header) {
          rowObj[header] = values[r][c];
        }
      }
      rows.push(rowObj);
    }
    return rows;
  },

  getHeaderMap: function(sheet) {
    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) return {};
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var map = {};
    for (var i = 0; i < headers.length; i++) {
      var h = String(headers[i]).trim();
      if (h) {
        map[h] = i + 1; // 1-based
      }
    }
    return map;
  },

  sanitizeFormula: function(val) {
    if (val === null || val === undefined) return '';
    var str = String(val);
    if (/^[=\+\-@]/.test(str)) {
      return "'" + str;
    }
    return str;
  },

  appendRow: function(sheetName, obj, headerOrder) {
    var sheet = this.getSheet(sheetName);
    var headers = headerOrder || CONFIG.HEADERS[sheetName.toUpperCase()];
    if (!headers) {
      throw new Error('헤더 정의를 찾을 수 없습니다: ' + sheetName);
    }

    var rowValues = [];
    for (var i = 0; i < headers.length; i++) {
      var key = headers[i];
      var rawVal = obj[key] !== undefined ? obj[key] : '';
      if (typeof rawVal === 'string') {
        rawVal = this.sanitizeFormula(rawVal);
      }
      rowValues.push(rawVal);
    }

    sheet.appendRow(rowValues);
  },

  updateRow: function(sheetName, rowNumber, updateObj) {
    var sheet = this.getSheet(sheetName);
    var headerMap = this.getHeaderMap(sheet);

    for (var key in updateObj) {
      if (updateObj.hasOwnProperty(key)) {
        var colIndex = headerMap[key];
        if (colIndex) {
          var val = updateObj[key];
          if (typeof val === 'string') {
            val = this.sanitizeFormula(val);
          }
          sheet.getRange(rowNumber, colIndex).setValue(val);
        }
      }
    }
  },

  escapeHtml: function(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  generateUuid: function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  generateSessionCode: function() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var code = '';
    for (var i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  },

  nowKSTString: function() {
    var now = new Date();
    return Utilities.formatDate(now, 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ss");
  },

  formatKST: function(dateOrStr) {
    if (!dateOrStr) return '';
    var d = (dateOrStr instanceof Date) ? dateOrStr : new Date(dateOrStr);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ss");
  },

  parseKST: function(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return dateStr;
    var d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  },

  isValidEmail: function(email) {
    if (!email || typeof email !== 'string') return false;
    var emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email.trim());
  },

  log: function(level, action, detail) {
    try {
      var sheet = this.getSheet(CONFIG.SHEETS.LOGS);
      var timeStr = this.nowKSTString();
      var safeDetail = typeof detail === 'object' ? JSON.stringify(detail) : String(detail);
      sheet.appendRow([timeStr, level, action, this.sanitizeFormula(safeDetail)]);
    } catch (e) {
      console.error('로그 작성 실패: ' + e.message);
    }
  }
};

/* ============================================================================
   3. Auth (관리자 인증 모듈)
   ============================================================================ */
var Auth = {
  login: function(password) {
    var props = PropertiesService.getScriptProperties();
    var adminPassword = props.getProperty('ADMIN_PASSWORD');

    if (!adminPassword) {
      throw new Error('시스템 오류: 관리자 비밀번호가 Script Properties에 설정되지 않았습니다.');
    }

    if (!password || String(password).trim() !== String(adminPassword).trim()) {
      Utils.log('WARN', 'admin_login_fail', '비밀번호 불일치');
      throw new Error('관리자 비밀번호가 일치하지 않습니다.');
    }

    var token = 'atk_' + Utils.generateUuid().replace(/-/g, '');
    var cache = CacheService.getScriptCache();
    cache.put(token, 'ADMIN_LOGGED_IN', CONFIG.TOKEN_TTL_SEC);

    Utils.log('INFO', 'admin_login_success', '토큰 발급 완료');
    return {
      token: token,
      expiresIn: CONFIG.TOKEN_TTL_SEC
    };
  },

  verifyToken: function(token) {
    if (!token) {
      throw new Error('관리자 권한이 필요합니다. (토큰 누락)');
    }
    var cache = CacheService.getScriptCache();
    var val = cache.get(token);
    if (!val || val !== 'ADMIN_LOGGED_IN') {
      throw new Error('관리자 세션이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.');
    }
    return true;
  },

  changePassword: function(token, newPassword) {
    this.verifyToken(token);
    if (!newPassword || newPassword.length < 4) {
      throw new Error('새 비밀번호는 최소 4자 이상이어야 합니다.');
    }
    var props = PropertiesService.getScriptProperties();
    props.setProperty('ADMIN_PASSWORD', String(newPassword).trim());
    Utils.log('INFO', 'admin_password_change', '관리자 비밀번호 변경됨');
    return true;
  }
};

/* ============================================================================
   4. Sessions (세션 관리 모듈)
   ============================================================================ */
var Sessions = {
  findSessionRow: function(sessionId) {
    if (!sessionId) return null;
    var rows = Utils.readAllRows(CONFIG.SHEETS.SESSIONS);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].sessionId).toUpperCase() === String(sessionId).trim().toUpperCase()) {
        return rows[i];
      }
    }
    return null;
  },

  getPublicInfo: function(sessionId) {
    var session = this.findSessionRow(sessionId);
    if (!session) {
      throw new Error('존재하지 않는 세션입니다. 코드를 다시 확인해주세요.');
    }

    return {
      sessionId: session.sessionId,
      name: session.name,
      defaultSendAt: Utils.formatKST(session.defaultSendAt),
      allowCustomDate: session.allowCustomDate === true || String(session.allowCustomDate).toUpperCase() === 'TRUE',
      maxSendAt: Utils.formatKST(session.maxSendAt),
      isOpen: session.isOpen === true || String(session.isOpen).toUpperCase() === 'TRUE',
      wallPhase: session.wallPhase || 'LIVE',
      closingMessage: session.closingMessage || CONFIG.DEFAULT_CLOSING_MESSAGE
    };
  },

  getAllForAdmin: function(token) {
    Auth.verifyToken(token);
    var rows = Utils.readAllRows(CONFIG.SHEETS.SESSIONS);
    return rows.map(function(s) {
      return {
        sessionId: s.sessionId,
        name: s.name,
        defaultSendAt: Utils.formatKST(s.defaultSendAt),
        allowCustomDate: s.allowCustomDate === true || String(s.allowCustomDate).toUpperCase() === 'TRUE',
        maxSendAt: Utils.formatKST(s.maxSendAt),
        isOpen: s.isOpen === true || String(s.isOpen).toUpperCase() === 'TRUE',
        purgeAfterSend: s.purgeAfterSend === true || String(s.purgeAfterSend).toUpperCase() === 'TRUE',
        closingMessage: s.closingMessage || CONFIG.DEFAULT_CLOSING_MESSAGE,
        wallPhase: s.wallPhase || 'LIVE',
        createdAt: Utils.formatKST(s.createdAt)
      };
    });
  },

  saveSession: function(token, data) {
    Auth.verifyToken(token);

    if (!data.name || data.name.trim().length === 0) {
      throw new Error('세션 이름을 입력해주세요.');
    }
    if (!data.defaultSendAt) {
      throw new Error('기본 발송일시를 지정해주세요.');
    }

    var defaultSendAtStr = Utils.formatKST(data.defaultSendAt);
    var maxSendAtStr = data.maxSendAt ? Utils.formatKST(data.maxSendAt) : '';

    var isNew = !data.sessionId;
    var sessionId = isNew ? Utils.generateSessionCode() : String(data.sessionId).trim().toUpperCase();

    var sessionObj = {
      sessionId: sessionId,
      name: data.name.trim(),
      defaultSendAt: defaultSendAtStr,
      allowCustomDate: data.allowCustomDate === true || data.allowCustomDate === 'true' || data.allowCustomDate === 'TRUE',
      maxSendAt: maxSendAtStr,
      isOpen: data.isOpen !== false && data.isOpen !== 'false' && data.isOpen !== 'FALSE',
      purgeAfterSend: data.purgeAfterSend === true || data.purgeAfterSend === 'true' || data.purgeAfterSend === 'TRUE',
      closingMessage: data.closingMessage ? data.closingMessage.trim() : CONFIG.DEFAULT_CLOSING_MESSAGE,
      wallPhase: data.wallPhase || 'LIVE'
    };

    if (isNew) {
      sessionObj.createdAt = Utils.nowKSTString();
      Utils.appendRow(CONFIG.SHEETS.SESSIONS, sessionObj);
      Utils.log('INFO', 'create_session', { sessionId: sessionId, name: sessionObj.name });
    } else {
      var existing = this.findSessionRow(sessionId);
      if (!existing) {
        throw new Error('수정할 세션을 찾을 수 없습니다: ' + sessionId);
      }
      Utils.updateRow(CONFIG.SHEETS.SESSIONS, existing._rowNumber, sessionObj);
      Utils.log('INFO', 'update_session', { sessionId: sessionId, name: sessionObj.name });
    }

    return sessionObj;
  },

  setWallPhase: function(token, sessionId, wallPhase) {
    Auth.verifyToken(token);
    var existing = this.findSessionRow(sessionId);
    if (!existing) {
      throw new Error('세션을 찾을 수 없습니다: ' + sessionId);
    }
    var phase = (wallPhase === 'CLOSING') ? 'CLOSING' : 'LIVE';
    Utils.updateRow(CONFIG.SHEETS.SESSIONS, existing._rowNumber, { wallPhase: phase });
    Utils.log('INFO', 'set_wall_phase', { sessionId: sessionId, wallPhase: phase });
    return { sessionId: sessionId, wallPhase: phase };
  },

  getDashboard: function(token, sessionId) {
    Auth.verifyToken(token);
    var session = this.findSessionRow(sessionId);
    if (!session) {
      throw new Error('세션을 찾을 수 없습니다: ' + sessionId);
    }

    var allCapsules = Utils.readAllRows(CONFIG.SHEETS.CAPSULES);
    var sessionCapsules = allCapsules.filter(function(c) {
      return String(c.sessionId).toUpperCase() === String(sessionId).toUpperCase();
    });

    var counts = {
      total: sessionCapsules.length,
      pending: 0,
      sending: 0,
      sent: 0,
      failed: 0
    };

    var dateDistribution = {};

    sessionCapsules.forEach(function(c) {
      var st = String(c.status).toUpperCase();
      if (counts[st.toLowerCase()] !== undefined) {
        counts[st.toLowerCase()]++;
      } else {
        counts.pending++;
      }

      var dateKey = '미정';
      if (c.sendMode === 'CUSTOM' && c.customSendAt) {
        dateKey = String(c.customSendAt).substring(0, 10);
      } else if (session.defaultSendAt) {
        dateKey = String(session.defaultSendAt).substring(0, 10);
      }
      dateDistribution[dateKey] = (dateDistribution[dateKey] || 0) + 1;
    });

    return {
      session: {
        sessionId: session.sessionId,
        name: session.name,
        defaultSendAt: Utils.formatKST(session.defaultSendAt),
        allowCustomDate: session.allowCustomDate === true || String(session.allowCustomDate).toUpperCase() === 'TRUE',
        isOpen: session.isOpen === true || String(session.isOpen).toUpperCase() === 'TRUE',
        wallPhase: session.wallPhase || 'LIVE'
      },
      counts: counts,
      dateDistribution: dateDistribution
    };
  }
};

/* ============================================================================
   5. Capsules (캡슐 제출 및 월 화면 조회 모듈)
   ============================================================================ */
var Capsules = {
  submit: function(data) {
    if (!data) throw new Error('제출 데이터가 없습니다.');

    var lock = LockService.getScriptLock();
    try {
      var hasLock = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);
      if (!hasLock) {
        throw new Error('접속자가 많아 잠시 지연되고 있습니다. 5초 후 다시 제출해 주세요.');
      }

      var sessionId = String(data.sessionId || '').trim().toUpperCase();
      var session = Sessions.findSessionRow(sessionId);
      if (!session) {
        throw new Error('유효하지 않은 세션입니다.');
      }
      var isOpen = session.isOpen === true || String(session.isOpen).toUpperCase() === 'TRUE';
      if (!isOpen) {
        throw new Error('현재 세션은 제출이 마감되었습니다.');
      }

      var pledgeA = String(data.pledgeA || '').trim();
      var pledgeB = String(data.pledgeB || '').trim();
      if (pledgeA.length < CONFIG.LIMITS.PLEDGE_MIN_LEN || pledgeA.length > CONFIG.LIMITS.PLEDGE_MAX_LEN) {
        throw new Error('서약문 첫 번째 빈칸은 ' + CONFIG.LIMITS.PLEDGE_MIN_LEN + '~' + CONFIG.LIMITS.PLEDGE_MAX_LEN + '자 이내로 입력해주세요.');
      }
      if (pledgeB.length < CONFIG.LIMITS.PLEDGE_MIN_LEN || pledgeB.length > CONFIG.LIMITS.PLEDGE_MAX_LEN) {
        throw new Error('서약문 두 번째 빈칸은 ' + CONFIG.LIMITS.PLEDGE_MIN_LEN + '~' + CONFIG.LIMITS.PLEDGE_MAX_LEN + '자 이내로 입력해주세요.');
      }

      var nickname = String(data.nickname || '').trim();
      if (!nickname) {
        nickname = '익명의 선생님';
      } else if (nickname.length > CONFIG.LIMITS.NICKNAME_MAX_LEN) {
        nickname = nickname.substring(0, CONFIG.LIMITS.NICKNAME_MAX_LEN);
      }

      var emailTo = String(data.emailTo || '').trim();
      if (!Utils.isValidEmail(emailTo)) {
        throw new Error('올바른 이메일 주소를 입력해주세요.');
      }

      var subject = String(data.subject || '').trim();
      if (subject.length < CONFIG.LIMITS.SUBJECT_MIN_LEN || subject.length > CONFIG.LIMITS.SUBJECT_MAX_LEN) {
        throw new Error('편지 제목은 ' + CONFIG.LIMITS.SUBJECT_MIN_LEN + '~' + CONFIG.LIMITS.SUBJECT_MAX_LEN + '자 이내로 작성해주세요.');
      }

      var body = String(data.body || '').trim();
      if (body.length < CONFIG.LIMITS.BODY_MIN_LEN || body.length > CONFIG.LIMITS.BODY_MAX_LEN) {
        throw new Error('편지 내용은 ' + CONFIG.LIMITS.BODY_MIN_LEN + '~' + CONFIG.LIMITS.BODY_MAX_LEN + '자 이내로 작성해주세요.');
      }

      var sendMode = String(data.sendMode || 'ADMIN').toUpperCase();
      var customSendAtStr = '';

      if (sendMode === 'CUSTOM') {
        var allowCustom = session.allowCustomDate === true || String(session.allowCustomDate).toUpperCase() === 'TRUE';
        if (!allowCustom) {
          throw new Error('이 세션은 직접 날짜 선택이 허용되지 않습니다.');
        }

        if (!data.customSendAt) {
          throw new Error('발송일을 선택해주세요.');
        }

        var customDate = Utils.parseKST(data.customSendAt);
        if (!customDate) {
          throw new Error('발송일 형식이 올바르지 않습니다.');
        }

        var now = new Date();
        var tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
        if (customDate < tomorrowStart) {
          throw new Error('발송일은 내일 이후의 날짜여야 합니다.');
        }

        if (session.maxSendAt) {
          var maxDate = Utils.parseKST(session.maxSendAt);
          if (maxDate && customDate > maxDate) {
            throw new Error('발송일은 최대 허용일(' + Utils.formatKST(maxDate).substring(0, 10) + ') 이내여야 합니다.');
          }
        }

        customSendAtStr = Utils.formatKST(customDate);
      } else {
        sendMode = 'ADMIN';
      }

      var existingCapsules = Utils.readAllRows(CONFIG.SHEETS.CAPSULES);
      var sessionCapsules = existingCapsules.filter(function(c) {
        return String(c.sessionId).toUpperCase() === sessionId;
      });

      if (sessionCapsules.length >= CONFIG.LIMITS.MAX_CAPSULES_PER_SESSION) {
        throw new Error('세션 제출 상한에 도달했습니다.');
      }

      var isDuplicate = sessionCapsules.some(function(c) {
        return String(c.emailTo).toLowerCase() === emailTo.toLowerCase() &&
               String(c.pledgeA) === pledgeA &&
               String(c.pledgeB) === pledgeB &&
               String(c.body) === body;
      });
      if (isDuplicate) {
        throw new Error('동일한 내용의 캡슐이 이미 제출되었습니다.');
      }

      var capsuleId = Utils.generateUuid();
      var nowStr = Utils.nowKSTString();

      var newCapsule = {
        capsuleId: capsuleId,
        sessionId: sessionId,
        nickname: nickname,
        pledgeA: pledgeA,
        pledgeB: pledgeB,
        emailTo: emailTo,
        subject: subject,
        body: body,
        sendMode: sendMode,
        customSendAt: customSendAtStr,
        status: 'PENDING',
        retryCount: 0,
        lastError: '',
        createdAt: nowStr,
        sentAt: ''
      };

      Utils.appendRow(CONFIG.SHEETS.CAPSULES, newCapsule);
      Utils.log('INFO', 'submit_capsule', { capsuleId: capsuleId, sessionId: sessionId });

      return {
        capsuleId: capsuleId,
        sessionId: sessionId,
        createdAt: nowStr
      };

    } finally {
      lock.releaseLock();
    }
  },

  getWallPledges: function(sessionId, since) {
    if (!sessionId) {
      throw new Error('세션 ID가 필요합니다.');
    }
    var cleanSessionId = String(sessionId).trim().toUpperCase();
    var session = Sessions.findSessionRow(cleanSessionId);
    if (!session) {
      throw new Error('세션을 찾을 수 없습니다.');
    }

    var allRows = Utils.readAllRows(CONFIG.SHEETS.CAPSULES);
    var sessionRows = allRows.filter(function(r) {
      return String(r.sessionId).toUpperCase() === cleanSessionId;
    });

    var totalCount = sessionRows.length;
    var sinceDate = since ? Utils.parseKST(since) : null;

    var newItems = [];
    for (var i = 0; i < sessionRows.length; i++) {
      var row = sessionRows[i];
      var created = Utils.parseKST(row.createdAt);

      if (!sinceDate || (created && created > sinceDate)) {
        // 절대 개인정보 제외 (서약문 + 별명 + 생성시각만 전송)
        newItems.push({
          capsuleId: row.capsuleId,
          nickname: row.nickname || '익명의 선생님',
          pledgeA: row.pledgeA || '',
          pledgeB: row.pledgeB || '',
          createdAt: Utils.formatKST(row.createdAt)
        });
      }
    }

    return {
      sessionId: cleanSessionId,
      sessionName: session.name,
      totalCount: totalCount,
      wallPhase: session.wallPhase || 'LIVE',
      closingMessage: session.closingMessage || CONFIG.DEFAULT_CLOSING_MESSAGE,
      items: newItems,
      serverTime: Utils.nowKSTString()
    };
  },

  getFailed: function(token, sessionId) {
    Auth.verifyToken(token);
    var cleanSessionId = String(sessionId || '').trim().toUpperCase();
    var allRows = Utils.readAllRows(CONFIG.SHEETS.CAPSULES);

    var filtered = allRows.filter(function(r) {
      var matchSession = cleanSessionId ? String(r.sessionId).toUpperCase() === cleanSessionId : true;
      return matchSession && String(r.status).toUpperCase() === 'FAILED';
    });

    return filtered.map(function(r) {
      return {
        capsuleId: r.capsuleId,
        sessionId: r.sessionId,
        nickname: r.nickname,
        emailTo: r.emailTo,
        subject: r.subject,
        retryCount: r.retryCount,
        lastError: r.lastError,
        createdAt: Utils.formatKST(r.createdAt)
      };
    });
  },

  retryCapsule: function(token, capsuleId) {
    Auth.verifyToken(token);
    if (!capsuleId) throw new Error('capsuleId가 필요합니다.');

    var allRows = Utils.readAllRows(CONFIG.SHEETS.CAPSULES);
    for (var i = 0; i < allRows.length; i++) {
      if (allRows[i].capsuleId === capsuleId) {
        Utils.updateRow(CONFIG.SHEETS.CAPSULES, allRows[i]._rowNumber, {
          status: 'PENDING',
          retryCount: 0,
          lastError: '관리자에 의해 재시도 예약됨 (' + Utils.nowKSTString() + ')'
        });
        Utils.log('INFO', 'retry_capsule', { capsuleId: capsuleId });
        return { capsuleId: capsuleId, status: 'PENDING' };
      }
    }
    throw new Error('해당 캡슐을 찾을 수 없습니다.');
  },

  exportPledgesCsv: function(token, sessionId) {
    Auth.verifyToken(token);
    var cleanSessionId = String(sessionId).trim().toUpperCase();
    var allRows = Utils.readAllRows(CONFIG.SHEETS.CAPSULES);

    var filtered = allRows.filter(function(r) {
      return String(r.sessionId).toUpperCase() === cleanSessionId;
    });

    var csvRows = [
      ['순번', '별명', '빈칸1(대체할 대상)', '빈칸2(새로운 실천 원칙)', '제출시각']
    ];

    filtered.forEach(function(r, idx) {
      csvRows.push([
        idx + 1,
        '"' + String(r.nickname || '').replace(/"/g, '""') + '"',
        '"' + String(r.pledgeA || '').replace(/"/g, '""') + '"',
        '"' + String(r.pledgeB || '').replace(/"/g, '""') + '"',
        '"' + Utils.formatKST(r.createdAt) + '"'
      ]);
    });

    return csvRows.map(function(row) { return row.join(','); }).join('\r\n');
  }
};

/* ============================================================================
   6. Mailer (메일 템플릿 및 발송 모듈)
   ============================================================================ */
var Mailer = {
  buildHtmlBody: function(sessionName, nickname, pledgeA, pledgeB, bodyText, sealedDate, arrivalDate) {
    var safeSessionName = Utils.escapeHtml(sessionName || '연수');
    var safeNickname = Utils.escapeHtml(nickname || '선생님');
    var safePledgeA = Utils.escapeHtml(pledgeA || '');
    var safePledgeB = Utils.escapeHtml(pledgeB || '');
    var safeBody = Utils.escapeHtml(bodyText || '').replace(/\r?\n/g, '<br>');
    var safeSealed = Utils.escapeHtml(sealedDate ? sealedDate.substring(0, 10) : '');
    var safeArrival = Utils.escapeHtml(arrivalDate ? arrivalDate.substring(0, 10) : '');

    return '' +
      '<!DOCTYPE html>' +
      '<html>' +
      '<head>' +
      '<meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>모두의 타임캡슐</title>' +
      '</head>' +
      '<body style="margin: 0; padding: 0; background-color: #f4f6fb; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, \'Helvetica Neue\', Arial, sans-serif; color: #2d3748; line-height: 1.6;">' +
      '  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f6fb; padding: 30px 15px;">' +
      '    <tr>' +
      '      <td align="center">' +
      '        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.06);">' +
      '          <tr>' +
      '            <td style="background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%); padding: 36px 30px; text-align: center; color: #ffffff;">' +
      '              <div style="display: inline-block; padding: 6px 14px; background: rgba(255,255,255,0.2); border-radius: 20px; font-size: 13px; font-weight: 600; letter-spacing: 0.5px; margin-bottom: 12px;">' +
      '                TIME CAPSULE ARRIVED' +
      '              </div>' +
      '              <h1 style="margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; line-height: 1.3;">' +
      '                미래의 나에게 부친 편지가 도착했습니다' +
      '              </h1>' +
      '              <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">' +
      '                [' + safeSessionName + '] 에서 봉인된 타임캡슐' +
      '              </p>' +
      '            </td>' +
      '          </tr>' +
      '          <tr>' +
      '            <td style="padding: 36px 30px;">' +
      '              <p style="font-size: 16px; color: #4b5563; margin-top: 0;">' +
      '                안녕하세요, <strong>' + safeNickname + '</strong>님.' +
      '              </p>' +
      '              <p style="font-size: 15px; color: #4b5563;">' +
      '                지난 ' + safeSealed + ', 연수를 마무리하며 스스로와 약속했던 그 다짐을 기억하시나요?<br>' +
      '                선생님께서 정성껏 봉인해 두었던 원칙과 편지를 지금 열어 전해드립니다.' +
      '              </p>' +
      '              <div style="margin: 28px 0; padding: 22px 24px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 8px;">' +
      '                <div style="font-size: 12px; font-weight: 700; color: #1d4ed8; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">' +
      '                  선생님이 세운 실천 서약문' +
      '                </div>' +
      '                <div style="font-size: 17px; font-weight: 700; color: #1e293b; line-height: 1.5;">' +
      '                  "나는 다음 수업에서 <span style="color: #dc2626; text-decoration: line-through; background: #fee2e2; padding: 2px 6px; border-radius: 4px;">' + safePledgeA + '</span> 대신,<br>' +
      '                  <span style="color: #2563eb; background: #dbeafe; padding: 2px 6px; border-radius: 4px;">' + safePledgeB + '</span>을(를) 평가/실천하겠다."' +
      '                </div>' +
      '              </div>' +
      '              <div style="margin: 28px 0; padding: 24px; background: #fafafa; border: 1px solid #e5e7eb; border-radius: 12px;">' +
      '                <div style="font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.5px;">' +
      '                  미래의 나에게 쓴 편지' +
      '                </div>' +
      '                <div style="font-size: 15px; color: #374151; line-height: 1.8; word-break: break-word;">' +
      '                  ' + safeBody + '' +
      '                </div>' +
      '              </div>' +
      '              <table role="presentation" width="100%" style="font-size: 13px; color: #9ca3af; border-top: 1px dashed #e5e7eb; padding-top: 16px;">' +
      '                <tr>' +
      '                  <td>봉인 일시: ' + safeSealed + '</td>' +
      '                  <td align="right">개봉 일시: ' + safeArrival + '</td>' +
      '                </tr>' +
      '              </table>' +
      '            </td>' +
      '          </tr>' +
      '          <tr>' +
      '            <td style="background-color: #f8fafc; padding: 24px 30px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; line-height: 1.5;">' +
      '              본 메일은 연수 프로그램 중 선생님 본인이 미래의 본인에게 예약 발송 신청한 타임캡슐 메일입니다.<br>' +
      '              시스템 관련 문의 및 안내: 주관 기관 연수 담당자' +
      '            </td>' +
      '          </tr>' +
      '        </table>' +
      '      </td>' +
      '    </tr>' +
      '  </table>' +
      '</body>' +
      '</html>';
  },

  buildPlainTextBody: function(sessionName, nickname, pledgeA, pledgeB, bodyText, sealedDate, arrivalDate) {
    return '[' + sessionName + ' - 모두의 타임캡슐]\n\n' +
      '안녕하세요, ' + (nickname || '선생님') + '님.\n\n' +
      '지난 ' + (sealedDate ? sealedDate.substring(0, 10) : '') + ' 연수를 마무리하며 봉인했던 타임캡슐이 도착했습니다.\n\n' +
      '--------------------------------------------------\n' +
      '■ 나의 실천 서약문\n' +
      '"나는 다음 수업에서 [' + pledgeA + '] 대신, [' + pledgeB + ']을(를) 평가/실천하겠다."\n' +
      '--------------------------------------------------\n\n' +
      '■ 미래의 나에게 쓴 편지\n' +
      bodyText + '\n\n' +
      '--------------------------------------------------\n' +
      '봉인일: ' + (sealedDate ? sealedDate.substring(0, 10) : '') + ' / 도착일: ' + (arrivalDate ? arrivalDate.substring(0, 10) : '') + '\n' +
      '본 메일은 연수 마무리 시 본인이 직접 예약 발송한 메일입니다.';
  },

  send: function(capsule, session) {
    if (!capsule.emailTo || !Utils.isValidEmail(capsule.emailTo)) {
      throw new Error('수신 이메일 주소가 유효하지 않습니다: ' + capsule.emailTo);
    }

    var subject = '[타임캡슐] ' + (capsule.subject || '미래의 나에게서 온 편지');
    var htmlContent = this.buildHtmlBody(
      session ? session.name : '',
      capsule.nickname,
      capsule.pledgeA,
      capsule.pledgeB,
      capsule.body,
      capsule.createdAt,
      Utils.nowKSTString()
    );
    var plainContent = this.buildPlainTextBody(
      session ? session.name : '',
      capsule.nickname,
      capsule.pledgeA,
      capsule.pledgeB,
      capsule.body,
      capsule.createdAt,
      Utils.nowKSTString()
    );

    MailApp.sendEmail({
      to: capsule.emailTo,
      subject: subject,
      body: plainContent,
      htmlBody: htmlContent,
      name: '모두의 타임캡슐'
    });
  },

  sendTestMail: function(token, targetEmail) {
    Auth.verifyToken(token);
    if (!targetEmail || !Utils.isValidEmail(targetEmail)) {
      throw new Error('올바른 테스트 수신 이메일 주소를 입력해주세요.');
    }

    var sampleCapsule = {
      emailTo: targetEmail.trim(),
      nickname: '홍길동 선생님',
      pledgeA: '단순 요약 과제',
      pledgeB: '비판적 사고를 요구하는 질문 토론',
      subject: '테스트 - 미래의 나에게 보내는 다짐',
      body: '안녕! 지난 연수에서 배웠던 학생 참여형 수업 설계를 잘 실천하고 있니? 초심을 잃지 말고 오늘도 힘내자!',
      createdAt: Utils.nowKSTString()
    };

    var sampleSession = {
      name: '테스트 연수 세션'
    };

    this.send(sampleCapsule, sampleSession);
    Utils.log('INFO', 'admin_send_test', { targetEmail: targetEmail });

    return {
      success: true,
      sentTo: targetEmail,
      remainingQuota: MailApp.getRemainingDailyQuota()
    };
  }
};

/* ============================================================================
   7. Scheduler (자동 발송 및 트리거 관리 모듈)
   ============================================================================ */
var Scheduler = {
  processDueCapsules: function() {
    var lock = LockService.getScriptLock();
    var hasLock = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);
    if (!hasLock) {
      console.log('이전 발송 프로세스가 아직 실행 중이므로 스킵합니다.');
      return { skipped: true, reason: 'lock_busy' };
    }

    try {
      var remainingQuota = MailApp.getRemainingDailyQuota();
      if (remainingQuota <= 0) {
        Utils.log('WARN', 'trigger_quota_exhausted', 'Gmail 일일 발송 한도 소진');
        return { error: '일일 발송 한도가 소진되었습니다.', remainingQuota: 0 };
      }

      var sessionRows = Utils.readAllRows(CONFIG.SHEETS.SESSIONS);
      var sessionMap = {};
      for (var s = 0; s < sessionRows.length; s++) {
        sessionMap[String(sessionRows[s].sessionId).toUpperCase()] = sessionRows[s];
      }

      var capsuleRows = Utils.readAllRows(CONFIG.SHEETS.CAPSULES);
      var now = new Date();
      var dueCapsules = [];

      for (var c = 0; c < capsuleRows.length; c++) {
        var cap = capsuleRows[c];
        var st = String(cap.status || '').toUpperCase();
        if (st !== 'PENDING') continue;

        var sess = sessionMap[String(cap.sessionId).toUpperCase()];
        if (!sess) continue;

        var targetSendAtStr = (cap.sendMode === 'CUSTOM' && cap.customSendAt) ? cap.customSendAt : sess.defaultSendAt;
        if (!targetSendAtStr) continue;

        var targetDate = Utils.parseKST(targetSendAtStr);
        if (targetDate && targetDate <= now) {
          dueCapsules.push({
            capsule: cap,
            session: sess
          });
        }
      }

      var totalDue = dueCapsules.length;
      if (totalDue === 0) {
        return { processed: 0, totalDue: 0, remainingQuota: remainingQuota };
      }

      var processLimit = Math.min(CONFIG.BATCH_SIZE, dueCapsules.length, remainingQuota);
      var processedCount = 0;
      var successCount = 0;
      var failCount = 0;

      for (var i = 0; i < processLimit; i++) {
        var item = dueCapsules[i];
        var currentCap = item.capsule;
        var currentSess = item.session;
        var rowNumber = currentCap._rowNumber;

        Utils.updateRow(CONFIG.SHEETS.CAPSULES, rowNumber, {
          status: 'SENDING'
        });

        try {
          Mailer.send(currentCap, currentSess);

          var shouldPurge = currentSess.purgeAfterSend === true || String(currentSess.purgeAfterSend).toUpperCase() === 'TRUE';
          var updateData = {
            status: 'SENT',
            sentAt: Utils.nowKSTString(),
            lastError: ''
          };

          if (shouldPurge) {
            updateData.emailTo = '';
            updateData.subject = '';
            updateData.body = '';
          }

          Utils.updateRow(CONFIG.SHEETS.CAPSULES, rowNumber, updateData);
          successCount++;

        } catch (sendErr) {
          console.error('메일 발송 실패 (' + currentCap.capsuleId + '): ' + sendErr.message);
          failCount++;

          var nextRetry = (Number(currentCap.retryCount) || 0) + 1;
          var newStatus = (nextRetry >= CONFIG.MAX_RETRY) ? 'FAILED' : 'PENDING';

          Utils.updateRow(CONFIG.SHEETS.CAPSULES, rowNumber, {
            status: newStatus,
            retryCount: nextRetry,
            lastError: sendErr.message
          });

          Utils.log('ERROR', 'send_failed', {
            capsuleId: currentCap.capsuleId,
            retry: nextRetry,
            status: newStatus,
            error: sendErr.message
          });
        }

        processedCount++;
      }

      var summary = {
        totalDue: totalDue,
        processed: processedCount,
        success: successCount,
        fail: failCount,
        remainingQuota: MailApp.getRemainingDailyQuota()
      };

      Utils.log('INFO', 'process_due_capsules', summary);
      return summary;

    } finally {
      lock.releaseLock();
    }
  },

  installTrigger: function(token) {
    Auth.verifyToken(token);
    this.removeTriggerInternal();

    ScriptApp.newTrigger('processDueCapsules')
      .timeBased()
      .everyMinutes(10)
      .create();

    Utils.log('INFO', 'trigger_installed', '10분 주기 트리거 설치 완료');
    return { installed: true, intervalMinutes: 10 };
  },

  removeTriggerInternal: function() {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'processDueCapsules') {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
  },

  removeTrigger: function(token) {
    Auth.verifyToken(token);
    this.removeTriggerInternal();
    Utils.log('INFO', 'trigger_removed', '트리거 삭제 완료');
    return { installed: false };
  },

  getTriggerStatus: function(token) {
    Auth.verifyToken(token);
    var triggers = ScriptApp.getProjectTriggers();
    var isInstalled = false;
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'processDueCapsules') {
        isInstalled = true;
        break;
      }
    }
    return {
      installed: isInstalled,
      remainingQuota: MailApp.getRemainingDailyQuota()
    };
  },

  runNow: function(token) {
    Auth.verifyToken(token);
    return this.processDueCapsules();
  }
};

/**
 * 시간 기반 트리거가 호출하는 글로벌 핸들러
 */
function processDueCapsules() {
  return Scheduler.processDueCapsules();
}

/* ============================================================================
   8. Router & Setup (GET/POST 핸들러 및 원클릭 셋업)
   ============================================================================ */

function doGet(e) {
  try {
    var params = (e && e.parameter) ? e.parameter : {};
    var action = params.action;

    switch (action) {
      case 'getSessionPublic':
        var sessInfo = Sessions.getPublicInfo(params.sessionId);
        return createJsonResponse({ ok: true, data: sessInfo });

      case 'getWallPledges':
        var wallData = Capsules.getWallPledges(params.sessionId, params.since);
        return createJsonResponse({ ok: true, data: wallData });

      case 'ping':
        return createJsonResponse({ ok: true, data: { pong: true, time: Utils.nowKSTString() } });

      default:
        return createJsonResponse({ ok: false, error: '유효하지 않은 GET action입니다: ' + action });
    }
  } catch (err) {
    return createJsonResponse({ ok: false, error: err.message || String(err) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ ok: false, error: '요청 본문(Body)이 비어 있습니다.' });
    }

    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return createJsonResponse({ ok: false, error: '요청 본문이 올바른 JSON 형식이 아닙니다.' });
    }

    var action = payload.action;
    var token = payload.token;

    switch (action) {
      case 'submitCapsule':
        var submitRes = Capsules.submit(payload.data);
        return createJsonResponse({ ok: true, data: submitRes });

      case 'adminLogin':
        var loginRes = Auth.login(payload.password);
        return createJsonResponse({ ok: true, data: loginRes });

      case 'adminChangePassword':
        var pwRes = Auth.changePassword(token, payload.newPassword);
        return createJsonResponse({ ok: true, data: pwRes });

      case 'adminGetAllSessions':
        var sessionsList = Sessions.getAllForAdmin(token);
        return createJsonResponse({ ok: true, data: sessionsList });

      case 'adminSaveSession':
        var savedSession = Sessions.saveSession(token, payload.data);
        return createJsonResponse({ ok: true, data: savedSession });

      case 'adminGetDashboard':
        var dashData = Sessions.getDashboard(token, payload.sessionId);
        return createJsonResponse({ ok: true, data: dashData });

      case 'adminSetWallPhase':
        var phaseRes = Sessions.setWallPhase(token, payload.sessionId, payload.wallPhase);
        return createJsonResponse({ ok: true, data: phaseRes });

      case 'adminSendTest':
        var testRes = Mailer.sendTestMail(token, payload.targetEmail);
        return createJsonResponse({ ok: true, data: testRes });

      case 'adminRunNow':
        var runRes = Scheduler.runNow(token);
        return createJsonResponse({ ok: true, data: runRes });

      case 'adminInstallTrigger':
        var installRes = Scheduler.installTrigger(token);
        return createJsonResponse({ ok: true, data: installRes });

      case 'adminRemoveTrigger':
        var removeRes = Scheduler.removeTrigger(token);
        return createJsonResponse({ ok: true, data: removeRes });

      case 'adminGetTriggerStatus':
        var triggerStatus = Scheduler.getTriggerStatus(token);
        return createJsonResponse({ ok: true, data: triggerStatus });

      case 'adminGetFailed':
        var failedList = Capsules.getFailed(token, payload.sessionId);
        return createJsonResponse({ ok: true, data: failedList });

      case 'adminRetry':
        var retryRes = Capsules.retryCapsule(token, payload.capsuleId);
        return createJsonResponse({ ok: true, data: retryRes });

      case 'adminExportPledges':
        var csvStr = Capsules.exportPledgesCsv(token, payload.sessionId);
        return createJsonResponse({ ok: true, data: { csv: csvStr } });

      default:
        return createJsonResponse({ ok: false, error: '유효하지 않은 POST action입니다: ' + action });
    }
  } catch (err) {
    return createJsonResponse({ ok: false, error: err.message || String(err) });
  }
}

function createJsonResponse(data) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * 초기 스프레드시트 셋업 함수 (관리자가 Apps Script 콘솔에서 1회 실행)
 */
function setup() {
  var ss = Utils.getSpreadsheet();

  var sessSheet = ss.getSheetByName(CONFIG.SHEETS.SESSIONS);
  if (!sessSheet) {
    sessSheet = ss.insertSheet(CONFIG.SHEETS.SESSIONS);
  }
  if (sessSheet.getLastRow() === 0) {
    sessSheet.appendRow(CONFIG.HEADERS.SESSIONS);
    sessSheet.getRange(1, 1, 1, CONFIG.HEADERS.SESSIONS.length)
      .setBackground('#1e293b')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sessSheet.setFrozenRows(1);
  }

  var capSheet = ss.getSheetByName(CONFIG.SHEETS.CAPSULES);
  if (!capSheet) {
    capSheet = ss.insertSheet(CONFIG.SHEETS.CAPSULES);
  }
  if (capSheet.getLastRow() === 0) {
    capSheet.appendRow(CONFIG.HEADERS.CAPSULES);
    capSheet.getRange(1, 1, 1, CONFIG.HEADERS.CAPSULES.length)
      .setBackground('#1e293b')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    capSheet.setFrozenRows(1);
  }

  var logSheet = ss.getSheetByName(CONFIG.SHEETS.LOGS);
  if (!logSheet) {
    logSheet = ss.insertSheet(CONFIG.SHEETS.LOGS);
  }
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(CONFIG.HEADERS.LOGS);
    logSheet.getRange(1, 1, 1, CONFIG.HEADERS.LOGS.length)
      .setBackground('#1e293b')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    logSheet.setFrozenRows(1);
  }

  var defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('시트1');
  if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 1) {
    try {
      ss.deleteSheet(defaultSheet);
    } catch (e) {}
  }

  Logger.log('모두의 타임캡슐 초기 셋업이 완료되었습니다!');
}
