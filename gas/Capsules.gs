/**
 * 모두의 타임캡슐 - 캡슐 제출 및 서약문 월 조회 모듈
 */
var Capsules = {
  /**
   * 캡슐 제출 (참가자 API)
   * LockService를 적용하여 동시 제출 시 시트 데이터 덮어쓰기 방지
   */
  submit: function(data) {
    if (!data) throw new Error('제출 데이터가 없습니다.');

    var lock = LockService.getScriptLock();
    try {
      var hasLock = lock.tryLock(CONFIG.LOCK_TIMEOUT_MS);
      if (!hasLock) {
        throw new Error('접속자가 많아 잠시 지연되고 있습니다. 5초 후 다시 제출해 주세요.');
      }

      // 1. 세션 검증
      var sessionId = String(data.sessionId || '').trim().toUpperCase();
      var session = Sessions.findSessionRow(sessionId);
      if (!session) {
        throw new Error('유효하지 않은 세션입니다.');
      }
      var isOpen = session.isOpen === true || String(session.isOpen).toUpperCase() === 'TRUE';
      if (!isOpen) {
        throw new Error('현재 세션은 제출이 마감되었습니다.');
      }

      // 2. 서약문 검증
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

      // 3. 편지 및 이메일 검증
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

      // 4. 발송일 검증
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

        // 서버 KST 기준 내일 00:00 이후인지 검증
        var now = new Date();
        var tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
        if (customDate < tomorrowStart) {
          throw new Error('발송일은 내일 이후의 날짜여야 합니다.');
        }

        // maxSendAt 검증
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

      // 5. 스팸/중복 및 세션당 상한 검증
      var existingCapsules = Utils.readAllRows(CONFIG.SHEETS.CAPSULES);
      var sessionCapsules = existingCapsules.filter(function(c) {
        return String(c.sessionId).toUpperCase() === sessionId;
      });

      if (sessionCapsules.length >= CONFIG.LIMITS.MAX_CAPSULES_PER_SESSION) {
        throw new Error('세션 제출 상한에 도달했습니다.');
      }

      // 동일 이메일 + 동일 내용 중복 방지
      var isDuplicate = sessionCapsules.some(function(c) {
        return String(c.emailTo).toLowerCase() === emailTo.toLowerCase() &&
               String(c.pledgeA) === pledgeA &&
               String(c.pledgeB) === pledgeB &&
               String(c.body) === body;
      });
      if (isDuplicate) {
        throw new Error('동일한 내용의 캡슐이 이미 제출되었습니다.');
      }

      // 6. 저장
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

  /**
   * 월(Wall) 화면용 서약문 목록 조회 (공개 API)
   * 중요: 이메일(emailTo), 편지 본문(body), 제목(subject)은 절대 반환하지 않음!
   */
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

  /**
   * 관리자: 실패한 발송 목록 조회
   */
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

  /**
   * 관리자: 실패한 건 재시도 상태로 변경
   */
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

  /**
   * 관리자: 서약문 CSV 데이터 내보내기 (이메일 및 편지 본문 제외)
   */
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
