/**
 * 모두의 타임캡슐 - 메인 진입점 및 API 라우터 (Google Apps Script)
 */

/**
 * GET 요청 핸들러
 */
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

/**
 * POST 요청 핸들러
 * CORS 프리플라이트를 피하기 위해 프론트엔드에서 Content-Type: text/plain 으로 보낸 JSON을 파싱
 */
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
      // 1. 참가자 액션
      case 'submitCapsule':
        var submitRes = Capsules.submit(payload.data);
        return createJsonResponse({ ok: true, data: submitRes });

      // 2. 관리자 인증
      case 'adminLogin':
        var loginRes = Auth.login(payload.password);
        return createJsonResponse({ ok: true, data: loginRes });

      case 'adminChangePassword':
        var pwRes = Auth.changePassword(token, payload.newPassword);
        return createJsonResponse({ ok: true, data: pwRes });

      // 3. 세션 관리
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

      // 4. 발송 및 트리거 관리
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

      // 5. 실패 관리 및 내보내기
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

/**
 * JSON 출력 객체 래퍼
 */
function createJsonResponse(data) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

/**
 * 초기 스프레드시트 셋업 함수 (관리자가 Apps Script 콘솔에서 1회 실행)
 * 필요한 시트(Sessions, Capsules, Logs)와 헤더 행을 자동 생성하고 서식을 지정합니다.
 */
function setup() {
  var ss = Utils.getSpreadsheet();

  // 1. Sessions 시트
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

  // 2. Capsules 시트
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

  // 3. Logs 시트
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

  // 기본 시트(Sheet1)가 비어있다면 정리
  var defaultSheet = ss.getSheetByName('Sheet1') || ss.getSheetByName('시트1');
  if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 1) {
    try {
      ss.deleteSheet(defaultSheet);
    } catch (e) {}
  }

  Logger.log('모두의 타임캡슐 초기 셋업이 완료되었습니다!');
}
