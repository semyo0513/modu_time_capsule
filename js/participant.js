/**
 * 모두의 타임캡슐 - 참가자 작성 화면 컨트롤러
 */
(function() {
  'use strict';

  // 상태 관리 객체
  var state = {
    sessionId: '',
    sessionInfo: null,
    currentStep: 1
  };

  // DOM 캐시
  var dom = {
    loading: document.getElementById('state-loading'),
    closed: document.getElementById('state-closed'),
    alreadySealed: document.getElementById('state-already-sealed'),
    enterCode: document.getElementById('state-enter-code'),
    form: document.getElementById('capsule-form'),
    progress: document.getElementById('wizard-progress'),
    sessionBadge: document.getElementById('session-badge'),
    sessionTitle: document.getElementById('session-title'),
    sessionSubtitle: document.getElementById('session-subtitle'),
    inputSessionCode: document.getElementById('input-session-code'),
    btnSubmitCode: document.getElementById('btn-submit-code'),
    btnReEnter: document.getElementById('btn-re-enter'),
    btnReSeal: document.getElementById('btn-re-seal'),
    agreeCheck: document.getElementById('agree-check'),
    pledgeA: document.getElementById('pledge-a'),
    pledgeB: document.getElementById('pledge-b'),
    nickname: document.getElementById('nickname'),
    previewA: document.getElementById('preview-a'),
    previewB: document.getElementById('preview-b'),
    letterSubject: document.getElementById('letter-subject'),
    letterBody: document.getElementById('letter-body'),
    emailTo: document.getElementById('email-to'),
    charCount: document.getElementById('char-count'),
    cardModeAdmin: document.getElementById('card-mode-admin'),
    cardModeCustom: document.getElementById('card-mode-custom'),
    customDateContainer: document.getElementById('custom-date-container'),
    customDatePickerWrap: document.getElementById('custom-date-picker-wrap'),
    customSendDate: document.getElementById('custom-send-date'),
    labelDefaultDate: document.getElementById('label-default-date'),
    customDateHint: document.getElementById('custom-date-hint'),
    modeAdminRadio: document.getElementById('mode-admin'),
    modeCustomRadio: document.getElementById('mode-custom'),
    btnSubmit: document.getElementById('btn-submit'),
    linkToWall: document.getElementById('link-to-wall'),
    linkToWall2: document.getElementById('link-to-wall-2'),
    linkToWallSuccess: document.getElementById('link-to-wall-success'),
    // 요약
    summaryNickname: document.getElementById('summary-nickname'),
    summaryPledgeA: document.getElementById('summary-pledge-a'),
    summaryPledgeB: document.getElementById('summary-pledge-b'),
    summaryEmail: document.getElementById('summary-email'),
    summaryDate: document.getElementById('summary-date')
  };

  /**
   * 초기화
   */
  async function init() {
    bindEvents();

    var params = new URLSearchParams(window.location.search);
    var s = params.get('s');

    if (s) {
      state.sessionId = s.trim().toUpperCase();
      loadSession(state.sessionId);
    } else {
      showEnterCodeState();
    }
  }

  /**
   * 세션 정보 불러오기
   */
  async function loadSession(sessionId) {
    dom.loading.classList.remove('hidden');
    dom.closed.classList.add('hidden');
    dom.alreadySealed.classList.add('hidden');
    dom.enterCode.classList.add('hidden');
    dom.form.classList.add('hidden');

    try {
      var info = await Api.get('getSessionPublic', { sessionId: sessionId });
      state.sessionInfo = info;

      // 헤더 정보 세팅
      dom.sessionTitle.textContent = info.name || '모두의 타임캡슐';
      dom.sessionBadge.textContent = '세션: ' + info.sessionId;

      // 월 화면 링크 쿼리 전달
      var wallUrl = 'wall.html?s=' + encodeURIComponent(info.sessionId);
      var navWall = document.getElementById('nav-wall-link');
      if (navWall) navWall.href = wallUrl;
      if (dom.linkToWall) dom.linkToWall.href = wallUrl;
      if (dom.linkToWall2) dom.linkToWall2.href = wallUrl;
      if (dom.linkToWallSuccess) dom.linkToWallSuccess.href = wallUrl;

      dom.loading.classList.add('hidden');

      // 마감 여부 확인
      if (!info.isOpen) {
        dom.closed.classList.remove('hidden');
        dom.progress.classList.add('hidden');
        return;
      }

      // 이미 작성한 이력 확인 (localStorage)
      var storageKey = APP_CONFIG.STORAGE_KEYS.SEALED_SESSION_PREFIX + sessionId;
      if (localStorage.getItem(storageKey) === 'true') {
        dom.alreadySealed.classList.remove('hidden');
        dom.progress.classList.add('hidden');
        return;
      }

      // 작성 폼 설정 및 표시
      setupFormWithSession(info);

    } catch (err) {
      dom.loading.classList.add('hidden');
      alert('세션을 불러오는 중 오류가 발생했습니다: ' + err.message);
      showEnterCodeState();
    }
  }

  /**
   * 세션 정보에 맞춰 폼 동적 세팅
   */
  function setupFormWithSession(info) {
    dom.form.classList.remove('hidden');
    dom.progress.classList.remove('hidden');

    // 추천 실천일 안내 텍스트
    if (info.defaultSendAt) {
      var d = info.defaultSendAt.substring(0, 10);
      var dayName = getDayOfWeekStr(info.defaultSendAt);
      dom.labelDefaultDate.textContent = d + ' (' + dayName + ') 오전 9시경 도착';
    } else {
      dom.labelDefaultDate.textContent = '관리자가 지정한 발송일';
    }

    // 직접 날짜 선택 허용 여부
    if (info.allowCustomDate) {
      dom.customDateContainer.classList.remove('hidden');

      // 내일 날짜 계산 (KST 기준 min)
      var tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      var minDateStr = tomorrow.toISOString().substring(0, 10);
      dom.customSendDate.min = minDateStr;

      if (info.maxSendAt) {
        var maxDateStr = info.maxSendAt.substring(0, 10);
        dom.customSendDate.max = maxDateStr;
        dom.customDateHint.textContent = minDateStr + ' ~ ' + maxDateStr + ' 사이 선택 가능';
      } else {
        dom.customDateHint.textContent = minDateStr + ' 이후 선택 가능';
      }
    } else {
      dom.customDateContainer.classList.add('hidden');
    }

    goToStep(1);
  }

  /**
   * 요일 문자열 구하기
   */
  function getDayOfWeekStr(dateStr) {
    var days = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    var d = new Date(dateStr);
    return isNaN(d.getDay()) ? '' : days[d.getDay()];
  }

  /**
   * 세션 코드 직접 입력 화면 표시
   */
  function showEnterCodeState() {
    dom.loading.classList.add('hidden');
    dom.closed.classList.add('hidden');
    dom.alreadySealed.classList.add('hidden');
    dom.form.classList.add('hidden');
    dom.progress.classList.add('hidden');
    dom.enterCode.classList.remove('hidden');
  }

  /**
   * 스텝 이동
   */
  function goToStep(step) {
    state.currentStep = step;

    // 스텝 팬 전환
    var panes = document.querySelectorAll('.step-pane');
    panes.forEach(function(pane) {
      if (pane.getAttribute('data-step') === String(step)) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });

    // 스텝 진행도 바 갱신
    var progressSteps = document.querySelectorAll('.progress-step');
    progressSteps.forEach(function(el) {
      var s = parseInt(el.getAttribute('data-step'), 10);
      el.classList.remove('active', 'completed');
      if (s === step) {
        el.classList.add('active');
      } else if (s < step) {
        el.classList.add('completed');
      }
    });

    // 5단계(요약) 진입 시 요약 정보 렌더링
    if (step === 5) {
      renderSummary();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * 5단계 요약 데이터 렌더링
   */
  function renderSummary() {
    dom.summaryNickname.textContent = dom.nickname.value.trim() || '익명의 선생님';
    dom.summaryPledgeA.textContent = dom.pledgeA.value.trim();
    dom.summaryPledgeB.textContent = dom.pledgeB.value.trim();
    dom.summaryEmail.textContent = dom.emailTo.value.trim();

    var isCustom = dom.modeCustomRadio.checked;
    if (isCustom) {
      dom.summaryDate.textContent = dom.customSendDate.value + ' (직접 지정)';
    } else {
      var defaultDate = state.sessionInfo && state.sessionInfo.defaultSendAt
        ? state.sessionInfo.defaultSendAt.substring(0, 10)
        : '관리자 추천일';
      dom.summaryDate.textContent = defaultDate + ' (추천 실천일)';
    }
  }

  /**
   * 각 스텝 유효성 검증
   */
  function validateStep(step) {
    if (step === 1) {
      if (!dom.agreeCheck.checked) {
        alert('개인정보 수집 및 이용에 동의해주세요.');
        dom.agreeCheck.focus();
        return false;
      }
      return true;
    }

    if (step === 2) {
      var a = dom.pledgeA.value.trim();
      var b = dom.pledgeB.value.trim();
      if (a.length < 2 || a.length > 40) {
        alert('첫 번째 빈칸은 2~40자 이내로 입력해주세요.');
        dom.pledgeA.focus();
        return false;
      }
      if (b.length < 2 || b.length > 40) {
        alert('두 번째 빈칸은 2~40자 이내로 입력해주세요.');
        dom.pledgeB.focus();
        return false;
      }
      return true;
    }

    if (step === 3) {
      var subj = dom.letterSubject.value.trim();
      var body = dom.letterBody.value.trim();
      var email = dom.emailTo.value.trim();

      if (subj.length < 1 || subj.length > 80) {
        alert('메일 제목을 1~80자 이내로 입력해주세요.');
        dom.letterSubject.focus();
        return false;
      }
      if (body.length < 1 || body.length > 2000) {
        alert('편지 내용을 1~2000자 이내로 입력해주세요.');
        dom.letterBody.focus();
        return false;
      }
      var emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(email)) {
        alert('올바른 이메일 주소를 입력해주세요.');
        dom.emailTo.focus();
        return false;
      }
      return true;
    }

    if (step === 4) {
      if (dom.modeCustomRadio.checked) {
        if (!dom.customSendDate.value) {
          alert('발송일을 선택해주세요.');
          dom.customSendDate.focus();
          return false;
        }
      }
      return true;
    }

    return true;
  }

  /**
   * 이벤트 바인딩
   */
  function bindEvents() {
    // 세션 코드 입력 버튼
    dom.btnSubmitCode.addEventListener('click', function() {
      var code = dom.inputSessionCode.value.trim().toUpperCase();
      if (!code) {
        alert('세션 코드를 입력해주세요.');
        return;
      }
      state.sessionId = code;
      // URL 파라미터 업데이트
      var newUrl = window.location.pathname + '?s=' + encodeURIComponent(code);
      window.history.replaceState(null, '', newUrl);
      loadSession(code);
    });

    // 엔터키 지원
    dom.inputSessionCode.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') dom.btnSubmitCode.click();
    });

    // 재작성 버튼들
    dom.btnReEnter.addEventListener('click', function() {
      if (state.sessionInfo) {
        setupFormWithSession(state.sessionInfo);
      }
    });

    dom.btnReSeal.addEventListener('click', function() {
      if (state.sessionInfo) {
        dom.pledgeA.value = '';
        dom.pledgeB.value = '';
        dom.letterSubject.value = '';
        dom.letterBody.value = '';
        updatePledgePreview();
        setupFormWithSession(state.sessionInfo);
      }
    });

    // 스텝 이동 버튼
    document.addEventListener('click', function(e) {
      var nextBtn = e.target.closest('.btn-next');
      if (nextBtn) {
        var targetStep = parseInt(nextBtn.getAttribute('data-next'), 10);
        var currentStep = targetStep - 1;
        if (validateStep(currentStep)) {
          goToStep(targetStep);
        }
        return;
      }

      var prevBtn = e.target.closest('.btn-prev');
      if (prevBtn) {
        var prevStep = parseInt(prevBtn.getAttribute('data-prev'), 10);
        goToStep(prevStep);
        return;
      }
    });

    // 서약문 실시간 미리보기 바인딩
    dom.pledgeA.addEventListener('input', updatePledgePreview);
    dom.pledgeB.addEventListener('input', updatePledgePreview);

    function updatePledgePreview() {
      var a = dom.pledgeA.value.trim();
      var b = dom.pledgeB.value.trim();
      dom.previewA.textContent = a || 'AI 결과물';
      dom.previewB.textContent = b || '학생의 반론 질문';
    }

    // 편지 글자수 카운터
    dom.letterBody.addEventListener('input', function() {
      dom.charCount.textContent = dom.letterBody.value.length;
    });

    // 발송일 라디오/카드 클릭 제어
    dom.cardModeAdmin.addEventListener('click', function() {
      dom.modeAdminRadio.checked = true;
      dom.cardModeAdmin.classList.add('selected');
      dom.cardModeCustom.classList.remove('selected');
      dom.customDatePickerWrap.style.display = 'none';
    });

    dom.cardModeCustom.addEventListener('click', function() {
      dom.modeCustomRadio.checked = true;
      dom.cardModeCustom.classList.add('selected');
      dom.cardModeAdmin.classList.remove('selected');
      dom.customDatePickerWrap.style.display = 'block';
    });

    // 폼 최종 제출
    dom.form.addEventListener('submit', async function(e) {
      e.preventDefault();

      if (!validateStep(1) || !validateStep(2) || !validateStep(3) || !validateStep(4)) {
        return;
      }

      var payload = {
        sessionId: state.sessionId,
        nickname: dom.nickname.value.trim(),
        pledgeA: dom.pledgeA.value.trim(),
        pledgeB: dom.pledgeB.value.trim(),
        emailTo: dom.emailTo.value.trim(),
        subject: dom.letterSubject.value.trim(),
        body: dom.letterBody.value.trim(),
        sendMode: dom.modeCustomRadio.checked ? 'CUSTOM' : 'ADMIN',
        customSendAt: dom.modeCustomRadio.checked ? dom.customSendDate.value + 'T09:00:00' : ''
      };

      // 중복 제출 방지 버튼 락
      dom.btnSubmit.disabled = true;
      dom.btnSubmit.textContent = '⏳ 봉인 중입니다...';

      try {
        var res = await Api.post('submitCapsule', payload);

        // 성공 시 localStorage에 기록
        var storageKey = APP_CONFIG.STORAGE_KEYS.SEALED_SESSION_PREFIX + state.sessionId;
        localStorage.setItem(storageKey, 'true');

        // 진행도 바 숨김 및 완료 화면 전환
        dom.progress.classList.add('hidden');
        goToStep('success');

      } catch (err) {
        alert('봉인에 실패했습니다: ' + err.message);
        dom.btnSubmit.disabled = false;
        dom.btnSubmit.textContent = '⏳ 타임캡슐 봉인하기';
      }
    });
  }

  // 실행
  document.addEventListener('DOMContentLoaded', init);

})();
