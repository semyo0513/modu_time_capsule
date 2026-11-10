/**
 * 모두의 타임캡슐 - 자동 발송 스케줄러 및 트리거 관리 모듈
 */
var Scheduler = {
  /**
   * 예약일이 도래한 캡슐 발송 처리 (10분 주기 트리거 또는 수동 실행)
   */
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

      // 1. 세션 맵 로드
      var sessionRows = Utils.readAllRows(CONFIG.SHEETS.SESSIONS);
      var sessionMap = {};
      for (var s = 0; s < sessionRows.length; s++) {
        sessionMap[String(sessionRows[s].sessionId).toUpperCase()] = sessionRows[s];
      }

      // 2. 캡슐 로드
      var capsuleRows = Utils.readAllRows(CONFIG.SHEETS.CAPSULES);
      var now = new Date();
      var dueCapsules = [];

      for (var c = 0; c < capsuleRows.length; c++) {
        var cap = capsuleRows[c];
        var st = String(cap.status || '').toUpperCase();
        if (st !== 'PENDING') continue;

        var sess = sessionMap[String(cap.sessionId).toUpperCase()];
        if (!sess) continue;

        // 발송 예정 시각 결정: CUSTOM이면 customSendAt, ADMIN이면 세션의 defaultSendAt을 실시간 참조!
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

      // 1회 최대 BATCH_SIZE(30건) 제한 및 잔여 쿼터 제한
      var processLimit = Math.min(CONFIG.BATCH_SIZE, dueCapsules.length, remainingQuota);
      var processedCount = 0;
      var successCount = 0;
      var failCount = 0;

      for (var i = 0; i < processLimit; i++) {
        var item = dueCapsules[i];
        var currentCap = item.capsule;
        var currentSess = item.session;
        var rowNumber = currentCap._rowNumber;

        // 중복 발송 방지를 위해 시트에 먼저 SENDING 상태 기록
        Utils.updateRow(CONFIG.SHEETS.CAPSULES, rowNumber, {
          status: 'SENDING'
        });

        try {
          Mailer.send(currentCap, currentSess);

          // 발송 성공 처리
          var shouldPurge = currentSess.purgeAfterSend === true || String(currentSess.purgeAfterSend).toUpperCase() === 'TRUE';
          var updateData = {
            status: 'SENT',
            sentAt: Utils.nowKSTString(),
            lastError: ''
          };

          // 발송 완료 후 개인정보(이메일, 제목, 본문) 즉시 파기 옵션
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

  /**
   * 관리자: 10분 주기 시간 기반 트리거 설치
   */
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

  /**
   * 내부용 트리거 제거
   */
  removeTriggerInternal: function() {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'processDueCapsules') {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
  },

  /**
   * 관리자: 트리거 삭제
   */
  removeTrigger: function(token) {
    Auth.verifyToken(token);
    this.removeTriggerInternal();
    Utils.log('INFO', 'trigger_removed', '트리거 삭제 완료');
    return { installed: false };
  },

  /**
   * 관리자: 트리거 설치 상태 확인
   */
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

  /**
   * 관리자: 지금 즉시 발송 대상 처리
   */
  runNow: function(token) {
    Auth.verifyToken(token);
    return this.processDueCapsules();
  }
};

/**
 * 시간 기반 트리거가 호출하는 글로벌 핸들러 함수
 */
function processDueCapsules() {
  return Scheduler.processDueCapsules();
}
