/**
 * 모두의 타임캡슐 - 관리자 대시보드 컨트롤러
 */
(function() {
  'use strict';

  var state = {
    token: null,
    sessions: [],
    currentSessionId: null,
    currentSessionData: null,
    qrInstance: null
  };

  var dom = {
    loginModal: document.getElementById('login-modal'),
    loginForm: document.getElementById('login-form'),
    adminPwd: document.getElementById('admin-pwd'),
    btnLogout: document.getElementById('btn-logout'),
    authStatusText: document.getElementById('auth-status-text'),
    adminMain: document.getElementById('admin-main'),
    selectSession: document.getElementById('select-session'),
    btnOpenCreateModal: document.getElementById('btn-open-create-modal'),
    btnEditCurrentSession: document.getElementById('btn-edit-current-session'),
    btnViewWall: document.getElementById('btn-view-wall'),
    // 통계
    statTotal: document.getElementById('stat-total'),
    statPending: document.getElementById('stat-pending'),
    statSent: document.getElementById('stat-sent'),
    statFailed: document.getElementById('stat-failed'),
    // QR & 빠른 작업
    adminQrBox: document.getElementById('admin-qr-box'),
    adminQrUrl: document.getElementById('admin-qr-url'),
    btnCopyUrl: document.getElementById('btn-copy-url'),
    btnDownloadQr: document.getElementById('btn-download-qr'),
    btnPhaseClosing: document.getElementById('btn-phase-closing'),
    btnPhaseLive: document.getElementById('btn-phase-live'),
    currentPhaseStatus: document.getElementById('current-phase-status'),
    btnExportCsv: document.getElementById('btn-export-csv'),
    // 발송 & 스케줄러
    triggerStatusBadge: document.getElementById('trigger-status-badge'),
    remainingQuotaBadge: document.getElementById('remaining-quota-badge'),
    btnInstallTrigger: document.getElementById('btn-install-trigger'),
    btnRemoveTrigger: document.getElementById('btn-remove-trigger'),
    btnRunNow: document.getElementById('btn-run-now'),
    inputTestEmail: document.getElementById('input-test-email'),
    btnSendTest: document.getElementById('btn-send-test'),
    // 실패 테이블
    btnRefreshFailed: document.getElementById('btn-refresh-failed'),
    failedTableBody: document.getElementById('failed-table-body'),
    // 세션 모달
    sessionModal: document.getElementById('session-modal'),
    sessionForm: document.getElementById('session-form'),
    modalSessionTitle: document.getElementById('modal-session-title'),
    modalSessionId: document.getElementById('modal-session-id'),
    sessName: document.getElementById('sess-name'),
    sessDefaultSend: document.getElementById('sess-default-send'),
    sessAllowCustom: document.getElementById('sess-allow-custom'),
    wrapMaxSend: document.getElementById('wrap-max-send'),
    sessMaxSend: document.getElementById('sess-max-send'),
    sessIsOpen: document.getElementById('sess-is-open'),
    sessPurge: document.getElementById('sess-purge'),
    sessClosingMsg: document.getElementById('sess-closing-msg'),
    btnCloseSessionModal: document.getElementById('btn-close-session-modal'),
    toastContainer: document.getElementById('toast-container')
  };

  /**
   * 토스트 알림 표시
   */
  function showToast(message) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    dom.toastContainer.appendChild(el);
    setTimeout(function() {
      el.remove();
    }, 3500);
  }

  /**
   * 초기화
   */
  async function init() {
    bindEvents();

    var savedToken = sessionStorage.getItem(APP_CONFIG.STORAGE_KEYS.ADMIN_TOKEN);
    if (savedToken) {
      state.token = savedToken;
      try {
        await loadAllSessions();
        showAdminMain();
      } catch (e) {
        sessionStorage.removeItem(APP_CONFIG.STORAGE_KEYS.ADMIN_TOKEN);
        state.token = null;
        showLoginModal();
      }
    } else {
      showLoginModal();
    }
  }

  function showLoginModal() {
    dom.loginModal.classList.remove('hidden');
    dom.adminMain.classList.add('hidden');
    dom.btnLogout.classList.add('hidden');
    dom.authStatusText.textContent = '인증 필요';
  }

  function showAdminMain() {
    dom.loginModal.classList.add('hidden');
    dom.adminMain.classList.remove('hidden');
    dom.btnLogout.classList.remove('hidden');
    dom.authStatusText.textContent = '관리자 로그인 중 (세션 유효)';
  }

  /**
   * 전체 세션 목록 로드
   */
  async function loadAllSessions() {
    var sessions = await Api.post('adminGetAllSessions', null, state.token);
    state.sessions = sessions || [];

    dom.selectSession.innerHTML = '';
    if (state.sessions.length === 0) {
      dom.selectSession.innerHTML = '<option value="">등록된 세션이 없습니다 (생성 필요)</option>';
      state.currentSessionId = null;
      state.currentSessionData = null;
      return;
    }

    state.sessions.forEach(function(s) {
      var opt = document.createElement('option');
      opt.value = s.sessionId;
      opt.textContent = '[' + s.sessionId + '] ' + s.name + (s.isOpen ? '' : ' (마감)');
      dom.selectSession.appendChild(opt);
    });

    // 기본 선택
    if (!state.currentSessionId || !state.sessions.some(function(s) { return s.sessionId === state.currentSessionId; })) {
      state.currentSessionId = state.sessions[0].sessionId;
    }

    dom.selectSession.value = state.currentSessionId;
    await onSelectSessionChanged(state.currentSessionId);
  }

  /**
   * 세션 변경 시 대시보드 및 세부 내용 갱신
   */
  async function onSelectSessionChanged(sessionId) {
    if (!sessionId) return;
    state.currentSessionId = sessionId;

    state.currentSessionData = state.sessions.find(function(s) {
      return s.sessionId === sessionId;
    });

    // 월 화면 링크 갱신
    dom.btnViewWall.href = 'wall.html?s=' + encodeURIComponent(sessionId);

    // QR 갱신
    renderParticipantQr(sessionId);

    // 대시보드 통계 조회
    try {
      var dash = await Api.post('adminGetDashboard', { sessionId: sessionId }, state.token);
      updateDashboardStats(dash);
    } catch (e) {
      console.warn('대시보드 조회 실패:', e.message);
    }

    // 트리거 상태 확인
    checkTriggerStatus();

    // 실패 목록 갱신
    loadFailedList();
  }

  /**
   * 대시보드 숫자 갱신
   */
  function updateDashboardStats(dash) {
    var counts = dash.counts || {};
    dom.statTotal.textContent = counts.total || 0;
    dom.statPending.textContent = counts.pending || 0;
    dom.statSent.textContent = counts.sent || 0;
    dom.statFailed.textContent = counts.failed || 0;

    var phase = (dash.session && dash.session.wallPhase) ? dash.session.wallPhase : 'LIVE';
    dom.currentPhaseStatus.textContent = '현재 상태: ' + phase;
  }

  /**
   * 참가자용 QR 렌더링
   */
  function renderParticipantQr(sessionId) {
    var origin = window.location.origin;
    var pathname = window.location.pathname.replace('admin.html', 'index.html');
    var participantUrl = origin + pathname + '?s=' + encodeURIComponent(sessionId);

    dom.adminQrUrl.value = participantUrl;
    dom.adminQrBox.innerHTML = '';

    if (typeof QRCode !== 'undefined') {
      try {
        state.qrInstance = new QRCode(dom.adminQrBox, {
          text: participantUrl,
          width: 160,
          height: 160,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.H
        });
      } catch (e) {
        fallbackAdminQr(participantUrl);
      }
    } else {
      fallbackAdminQr(participantUrl);
    }
  }

  function fallbackAdminQr(url) {
    dom.adminQrBox.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=' +
      encodeURIComponent(url) + '" alt="QR" width="160" height="160">';
  }

  /**
   * 트리거 상태 및 잔여 쿼터 확인
   */
  async function checkTriggerStatus() {
    try {
      var res = await Api.post('adminGetTriggerStatus', null, state.token);
      if (res.installed) {
        dom.triggerStatusBadge.textContent = '정상 작동 중 (10분 주기)';
        dom.triggerStatusBadge.style.color = 'var(--success)';
      } else {
        dom.triggerStatusBadge.textContent = '설치되지 않음 (수동 발송 필요)';
        dom.triggerStatusBadge.style.color = 'var(--danger)';
      }
      dom.remainingQuotaBadge.textContent = res.remainingQuota;
    } catch (e) {
      console.warn('트리거 상태 확인 오류:', e.message);
    }
  }

  /**
   * 실패 목록 로드
   */
  async function loadFailedList() {
    if (!state.currentSessionId) return;
    try {
      var failed = await Api.post('adminGetFailed', { sessionId: state.currentSessionId }, state.token);
      dom.failedTableBody.innerHTML = '';

      if (!failed || failed.length === 0) {
        dom.failedTableBody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding: 30px;">실패한 캡슐이 없습니다.</td></tr>';
        return;
      }

      failed.forEach(function(item) {
        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td><strong>' + escapeHtml(item.nickname) + '</strong></td>' +
          '<td>' + escapeHtml(item.emailTo) + '</td>' +
          '<td>' + escapeHtml(item.subject) + '</td>' +
          '<td class="text-danger" style="font-size: 12px;">' + escapeHtml(item.lastError) + '</td>' +
          '<td><button type="button" class="btn btn-outline btn-retry" data-id="' + item.capsuleId + '" style="padding: 4px 8px; min-height: 32px; font-size: 12px;">재시도</button></td>';
        dom.failedTableBody.appendChild(tr);
      });

    } catch (e) {
      console.warn('실패 목록 조회 오류:', e.message);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /**
   * 세션 생성/수정 모달 열기
   */
  function openSessionModal(sessionData) {
    dom.sessionForm.reset();

    if (sessionData) {
      dom.modalSessionTitle.textContent = '세션 설정 수정 (' + sessionData.sessionId + ')';
      dom.modalSessionId.value = sessionData.sessionId;
      dom.sessName.value = sessionData.name || '';
      dom.sessDefaultSend.value = formatForDateTimeInput(sessionData.defaultSendAt);
      dom.sessAllowCustom.checked = sessionData.allowCustomDate;
      dom.wrapMaxSend.style.display = sessionData.allowCustomDate ? 'block' : 'none';
      dom.sessMaxSend.value = formatForDateTimeInput(sessionData.maxSendAt);
      dom.sessIsOpen.checked = sessionData.isOpen;
      dom.sessPurge.checked = sessionData.purgeAfterSend;
      dom.sessClosingMsg.value = sessionData.closingMessage || '';
    } else {
      dom.modalSessionTitle.textContent = '새 세션 생성';
      dom.modalSessionId.value = '';
      // 추천 실천일: 7일 뒤 오전 9시
      var nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      nextWeek.setHours(9, 0, 0, 0);
      dom.sessDefaultSend.value = formatForDateTimeInput(nextWeek.toISOString());
      dom.sessAllowCustom.checked = true;
      dom.wrapMaxSend.style.display = 'block';
      dom.sessIsOpen.checked = true;
      dom.sessPurge.checked = true;
      dom.sessClosingMsg.value = '';
    }

    dom.sessionModal.classList.remove('hidden');
  }

  function formatForDateTimeInput(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    var pad = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /**
   * 이벤트 바인딩
   */
  function bindEvents() {
    // 1. 로그인 폼
    dom.loginForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      var pwd = dom.adminPwd.value;
      if (!pwd) return;

      try {
        var res = await Api.post('adminLogin', { password: pwd });
        state.token = res.token;
        sessionStorage.setItem(APP_CONFIG.STORAGE_KEYS.ADMIN_TOKEN, res.token);
        dom.adminPwd.value = '';
        showToast('관리자 로그인에 성공했습니다.');
        await loadAllSessions();
        showAdminMain();
      } catch (err) {
        alert('로그인 실패: ' + err.message);
      }
    });

    // 2. 로그아웃
    dom.btnLogout.addEventListener('click', function() {
      sessionStorage.removeItem(APP_CONFIG.STORAGE_KEYS.ADMIN_TOKEN);
      state.token = null;
      showLoginModal();
      showToast('로그아웃되었습니다.');
    });

    // 3. 세션 선택 변경
    dom.selectSession.addEventListener('change', function() {
      onSelectSessionChanged(dom.selectSession.value);
    });

    // 4. 세션 생성/수정 모달 제어
    dom.btnOpenCreateModal.addEventListener('click', function() {
      openSessionModal(null);
    });

    dom.btnEditCurrentSession.addEventListener('click', function() {
      if (!state.currentSessionData) {
        alert('수정할 세션을 먼저 선택해주세요.');
        return;
      }
      openSessionModal(state.currentSessionData);
    });

    dom.btnCloseSessionModal.addEventListener('click', function() {
      dom.sessionModal.classList.add('hidden');
    });

    dom.sessAllowCustom.addEventListener('change', function() {
      dom.wrapMaxSend.style.display = dom.sessAllowCustom.checked ? 'block' : 'none';
    });

    // 5. 세션 저장 폼 제출
    dom.sessionForm.addEventListener('submit', async function(e) {
      e.preventDefault();

      var payload = {
        sessionId: dom.modalSessionId.value || undefined,
        name: dom.sessName.value.trim(),
        defaultSendAt: dom.sessDefaultSend.value,
        allowCustomDate: dom.sessAllowCustom.checked,
        maxSendAt: dom.sessAllowCustom.checked ? dom.sessMaxSend.value : '',
        isOpen: dom.sessIsOpen.checked,
        purgeAfterSend: dom.sessPurge.checked,
        closingMessage: dom.sessClosingMsg.value.trim()
      };

      try {
        var saved = await Api.post('adminSaveSession', payload, state.token);
        dom.sessionModal.classList.add('hidden');
        showToast('세션 설정이 저장되었습니다.');
        state.currentSessionId = saved.sessionId;
        await loadAllSessions();
      } catch (err) {
        alert('세션 저장 실패: ' + err.message);
      }
    });

    // 6. 탭 전환
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
        document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.add('hidden'); });

        btn.classList.add('active');
        var targetId = btn.getAttribute('data-tab');
        document.getElementById(targetId).classList.remove('hidden');
      });
    });

    // 7. URL 복사
    dom.btnCopyUrl.addEventListener('click', function() {
      dom.adminQrUrl.select();
      navigator.clipboard.writeText(dom.adminQrUrl.value).then(function() {
        showToast('참가 URL이 클립보드에 복사되었습니다.');
      });
    });

    // 8. QR 이미지 다운로드
    dom.btnDownloadQr.addEventListener('click', function() {
      var canvas = dom.adminQrBox.querySelector('canvas');
      var img = dom.adminQrBox.querySelector('img');
      var src = canvas ? canvas.toDataURL('image/png') : (img ? img.src : null);

      if (src) {
        var a = document.createElement('a');
        a.href = src;
        a.download = '타임캡슐_세션_' + state.currentSessionId + '_QR.png';
        a.click();
      } else {
        alert('QR 이미지를 찾을 수 없습니다.');
      }
    });

    // 9. 마무리 연출 제어
    dom.btnPhaseClosing.addEventListener('click', async function() {
      if (!state.currentSessionId) return;
      if (!confirm('월 화면에 마무리 멘트 오버레이를 표시하시겠습니까?')) return;
      try {
        await Api.post('adminSetWallPhase', { sessionId: state.currentSessionId, wallPhase: 'CLOSING' }, state.token);
        dom.currentPhaseStatus.textContent = '현재 상태: CLOSING (마무리 연출 중)';
        showToast('월 화면에 마무리 연출이 시작되었습니다.');
      } catch (e) {
        alert('실패: ' + e.message);
      }
    });

    dom.btnPhaseLive.addEventListener('click', async function() {
      if (!state.currentSessionId) return;
      try {
        await Api.post('adminSetWallPhase', { sessionId: state.currentSessionId, wallPhase: 'LIVE' }, state.token);
        dom.currentPhaseStatus.textContent = '현재 상태: LIVE';
        showToast('월 화면이 라이브 모드로 복귀되었습니다.');
      } catch (e) {
        alert('실패: ' + e.message);
      }
    });

    // 10. 서약문 CSV 내보내기
    dom.btnExportCsv.addEventListener('click', async function() {
      if (!state.currentSessionId) return;
      try {
        var res = await Api.post('adminExportPledges', { sessionId: state.currentSessionId }, state.token);
        var blob = new Blob(['\uFEFF' + res.csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = '서약문목록_' + state.currentSessionId + '.csv';
        a.click();
        URL.revokeObjectURL(url);
        showToast('CSV 파일이 다운로드되었습니다.');
      } catch (e) {
        alert('CSV 내보내기 실패: ' + e.message);
      }
    });

    // 11. 트리거 설치/삭제
    dom.btnInstallTrigger.addEventListener('click', async function() {
      if (!confirm('10분 주기 자동 발송 트리거를 설치하시겠습니까?')) return;
      try {
        await Api.post('adminInstallTrigger', null, state.token);
        showToast('10분 주기 자동 발송 트리거가 설치되었습니다.');
        checkTriggerStatus();
      } catch (e) {
        alert('트리거 설치 실패: ' + e.message);
      }
    });

    dom.btnRemoveTrigger.addEventListener('click', async function() {
      if (!confirm('자동 발송 트리거를 삭제하시겠습니까?')) return;
      try {
        await Api.post('adminRemoveTrigger', null, state.token);
        showToast('자동 발송 트리거가 삭제되었습니다.');
        checkTriggerStatus();
      } catch (e) {
        alert('트리거 삭제 실패: ' + e.message);
      }
    });

    // 12. 수동 즉시 발송
    dom.btnRunNow.addEventListener('click', async function() {
      if (!confirm('발송 예정일이 도래한 대상을 지금 즉시 발송하시겠습니까?')) return;
      dom.btnRunNow.disabled = true;
      dom.btnRunNow.textContent = '발송 처리 중...';

      try {
        var res = await Api.post('adminRunNow', null, state.token);
        showToast('발송 처리 완료: 처리 ' + (res.processed || 0) + '건 (성공: ' + (res.success || 0) + ', 실패: ' + (res.fail || 0) + ')');
        await onSelectSessionChanged(state.currentSessionId);
      } catch (e) {
        alert('즉시 발송 실패: ' + e.message);
      } finally {
        dom.btnRunNow.disabled = false;
        dom.btnRunNow.textContent = '🚀 지금 즉시 발송 실행';
      }
    });

    // 13. 테스트 메일 발송
    dom.btnSendTest.addEventListener('click', async function() {
      var email = dom.inputTestEmail.value.trim();
      if (!email) {
        alert('테스트 수신 이메일 주소를 입력해주세요.');
        return;
      }
      dom.btnSendTest.disabled = true;
      dom.btnSendTest.textContent = '발송 중...';

      try {
        await Api.post('adminSendTest', { targetEmail: email }, state.token);
        showToast(email + ' 주소로 테스트 메일이 발송되었습니다.');
        checkTriggerStatus();
      } catch (e) {
        alert('테스트 발송 실패: ' + e.message);
      } finally {
        dom.btnSendTest.disabled = false;
        dom.btnSendTest.textContent = '발송';
      }
    });

    // 14. 실패 재시도
    dom.btnRefreshFailed.addEventListener('click', loadFailedList);

    dom.failedTableBody.addEventListener('click', async function(e) {
      var retryBtn = e.target.closest('.btn-retry');
      if (retryBtn) {
        var id = retryBtn.getAttribute('data-id');
        try {
          await Api.post('adminRetry', { capsuleId: id }, state.token);
          showToast('재시도 대기 상태로 변경되었습니다.');
          loadFailedList();
        } catch (err) {
          alert('재시도 변경 실패: ' + err.message);
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);

})();
