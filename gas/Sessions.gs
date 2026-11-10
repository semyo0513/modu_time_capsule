/**
 * 모두의 타임캡슐 - 세션 관리 모듈
 */
var Sessions = {
  /**
   * 세션 ID로 세션 행 조회 (내부용)
   */
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

  /**
   * 공개용 세션 정보 반환 (참가자 화면 및 월 화면에서 호출)
   */
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

  /**
   * 관리자: 전체 세션 목록 조회
   */
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

  /**
   * 관리자: 세션 생성 또는 수정
   */
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

    var sheet = Utils.getSheet(CONFIG.SHEETS.SESSIONS);
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

  /**
   * 관리자: 월 화면 상태 전환 (LIVE <-> CLOSING)
   */
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

  /**
   * 관리자: 대시보드 통계 조회
   */
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

      // 발송 예정일
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
