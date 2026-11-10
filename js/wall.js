/**
 * 모두의 타임캡슐 - 서약문 월(Wall) 컨트롤러
 */
(function() {
  'use strict';

  var state = {
    sessionId: '',
    lastSince: '',
    knownIds: new Set(),
    isPolling: false,
    pollTimer: null,
    isPlayingBgm: false,
    synthCtx: null,
    synthGain: null,
    synthInterval: null,
    closingDismissed: false,
    lastPhase: 'LIVE'
  };

  var dom = {
    sessionTitle: document.getElementById('wall-session-title'),
    sessionSubtitle: document.getElementById('wall-session-subtitle'),
    counter: document.getElementById('pledge-counter'),
    tilesGrid: document.getElementById('tiles-grid'),
    emptyState: document.getElementById('wall-empty'),
    btnBgm: document.getElementById('btn-toggle-bgm'),
    bgmIcon: document.getElementById('bgm-icon'),
    bgmText: document.getElementById('bgm-text'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    audio: document.getElementById('bgm-audio'),
    closingOverlay: document.getElementById('closing-overlay'),
    closingMessage: document.getElementById('closing-message-text'),
    btnCloseClosing: document.getElementById('btn-close-closing'),
    wallNavJoin: document.getElementById('wall-nav-join'),
    qrcodeEl: document.getElementById('wall-qrcode')
  };

  /**
   * 초기화
   */
  function init() {
    var params = new URLSearchParams(window.location.search);
    var s = params.get('s');

    if (!s) {
      s = prompt('월(Wall)에 표시할 6자리 세션 코드를 입력해주세요:');
      if (s) {
        window.location.search = '?s=' + encodeURIComponent(s.trim().toUpperCase());
        return;
      } else {
        alert('세션 코드가 필요합니다.');
        return;
      }
    }

    state.sessionId = s.trim().toUpperCase();

    if (dom.wallNavJoin) {
      dom.wallNavJoin.href = 'index.html?s=' + encodeURIComponent(state.sessionId);
    }

    // 1. 별빛 배경 시작
    initStarfield();

    // 2. QR 코드 렌더링
    renderQrCode();

    // 3. 버튼 이벤트 바인딩
    bindEvents();

    // 4. 폴링 시작
    startPolling();
  }

  /**
   * QR 코드 렌더링 (참가자용 모바일 주소)
   */
  function renderQrCode() {
    var origin = window.location.origin;
    var pathname = window.location.pathname.replace('wall.html', 'index.html');
    var participantUrl = origin + pathname + '?s=' + encodeURIComponent(state.sessionId);

    // QRCode 라이브러리 확인
    if (typeof QRCode !== 'undefined') {
      try {
        dom.qrcodeEl.innerHTML = '';
        new QRCode(dom.qrcodeEl, {
          text: participantUrl,
          width: 96,
          height: 96,
          colorDark: '#0f172a',
          colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch (e) {
        console.warn('QR 렌더링 실패, 폴백 사용:', e);
        fallbackQr(participantUrl);
      }
    } else {
      fallbackQr(participantUrl);
    }
  }

  function fallbackQr(url) {
    dom.qrcodeEl.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=96x96&data=' +
      encodeURIComponent(url) + '" alt="QR" width="96" height="96">';
  }

  /**
   * 증분 폴링 실행
   */
  async function poll() {
    if (state.isPolling) return;
    state.isPolling = true;

    try {
      var res = await Api.get('getWallPledges', {
        sessionId: state.sessionId,
        since: state.lastSince || ''
      });

      // 헤더 및 카운터 정보
      if (res.sessionName) {
        dom.sessionTitle.textContent = res.sessionName;
      }
      dom.counter.textContent = res.totalCount || 0;

      // 마무리 연출 확인
      var currentPhase = res.wallPhase || 'LIVE';
      if (currentPhase !== state.lastPhase) {
        state.lastPhase = currentPhase;
        if (currentPhase === 'CLOSING') {
          state.closingDismissed = false; // 관리자가 새로 켰을 때 다시 보이도록
        }
      }

      if (currentPhase === 'CLOSING' && !state.closingDismissed) {
        if (res.closingMessage) {
          dom.closingMessage.textContent = res.closingMessage;
        }
        dom.closingOverlay.classList.add('active');
      } else {
        dom.closingOverlay.classList.remove('active');
      }

      // 새 서약문 렌더링
      if (res.items && res.items.length > 0) {
        dom.emptyState.classList.add('hidden');

        var isInitial = (state.lastSince === '');

        // 최신 항목이 맨 위/앞에 오도록 역순(또는 도착순) 배치
        res.items.forEach(function(item) {
          if (!state.knownIds.has(item.capsuleId)) {
            state.knownIds.add(item.capsuleId);
            var tile = createTileElement(item, !isInitial);
            dom.tilesGrid.insertBefore(tile, dom.tilesGrid.firstChild);
          }
        });
      }

      // 마지막 갱신 시각 갱신
      if (res.serverTime) {
        state.lastSince = res.serverTime;
      }

    } catch (err) {
      console.warn('폴링 일시 오류:', err.message);
    } finally {
      state.isPolling = false;
    }
  }

  function startPolling() {
    poll(); // 즉시 1회 실행
    var interval = (window.APP_CONFIG && window.APP_CONFIG.WALL_POLL_INTERVAL_MS) || 4000;
    state.pollTimer = setInterval(poll, interval);
  }

  /**
   * 개별 서약 타일 요소 생성
   */
  function createTileElement(item, isNew) {
    var card = document.createElement('div');
    card.className = 'pledge-tile' + (isNew ? ' new-arrival' : '');

    var top = document.createElement('div');
    top.className = 'tile-top';

    var author = document.createElement('div');
    author.className = 'tile-author';
    author.innerHTML = '<span style="color:#60a5fa;">✦</span> ' + escapeText(item.nickname || '익명의 선생님');

    var time = document.createElement('div');
    time.className = 'tile-time';
    time.textContent = formatTileTime(item.createdAt);

    top.appendChild(author);
    top.appendChild(time);

    var sentence = document.createElement('div');
    sentence.className = 'tile-sentence';
    sentence.innerHTML = '"나는 다음 수업에서 <span class="tile-pledge-a">' +
      escapeText(item.pledgeA) + '</span> 대신,<br><span class="tile-pledge-b">' +
      escapeText(item.pledgeB) + '</span>을(를) 실천하겠다."';

    card.appendChild(top);
    card.appendChild(sentence);

    return card;
  }

  function escapeText(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTileTime(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  /**
   * 이벤트 바인딩
   */
  function bindEvents() {
    // BGM 토글
    dom.btnBgm.addEventListener('click', function() {
      toggleBgm();
    });

    // 전체화면 토글
    if (dom.btnFullscreen) {
      dom.btnFullscreen.addEventListener('click', function() {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(function(e) {
            console.warn('전체화면 전환 실패:', e);
          });
        } else {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          }
        }
      });
    }

    // 마무리 오버레이 닫기 (개별 화면 보기 전환)
    if (dom.btnCloseClosing) {
      dom.btnCloseClosing.addEventListener('click', function() {
        state.closingDismissed = true;
        dom.closingOverlay.classList.remove('active');
      });
    }
  }

  /**
   * BGM 재생/정지 제어
   * (mp3 파일 우선 재생, 없거나 실패 시 브라우저 내장 Web Audio 신시사이저 가동)
   */
  function toggleBgm() {
    if (state.isPlayingBgm) {
      stopBgm();
    } else {
      startBgm();
    }
  }

  function startBgm() {
    state.isPlayingBgm = true;
    dom.bgmIcon.textContent = '🔊';
    dom.bgmText.textContent = '음악 끄기';

    // 먼저 mp3 파일 시도
    dom.audio.play().then(function() {
      // 재생 성공
    }).catch(function() {
      // mp3 파일이 없거나 재생할 수 없는 경우 아름다운 앰비언트 신시사이저 폴백 가동
      console.log('로컬 BGM 음원 대신 내장 앰비언트 사운드 신스를 시작합니다.');
      startAmbientSynth();
    });
  }

  function stopBgm() {
    state.isPlayingBgm = false;
    dom.bgmIcon.textContent = '🎵';
    dom.bgmText.textContent = '음악 켜기';

    dom.audio.pause();
    dom.audio.currentTime = 0;
    stopAmbientSynth();
  }

  /**
   * Web Audio API 기반 몽환적 앰비언트 신시사이저
   */
  function startAmbientSynth() {
    try {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;

      state.synthCtx = new AudioContext();
      state.synthGain = state.synthCtx.createGain();
      state.synthGain.gain.setValueAtTime(0.08, state.synthCtx.currentTime);
      state.synthGain.connect(state.synthCtx.destination);

      // 따뜻한 펜타토닉 음계 (C Major / A Minor 톤)
      var notes = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25];

      function playChime() {
        if (!state.isPlayingBgm || !state.synthCtx) return;
        var osc = state.synthCtx.createOscillator();
        var noteGain = state.synthCtx.createGain();

        var freq = notes[Math.floor(Math.random() * notes.length)];
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, state.synthCtx.currentTime);

        var now = state.synthCtx.currentTime;
        noteGain.gain.setValueAtTime(0, now);
        noteGain.gain.linearRampToValueAtTime(0.12, now + 1.2);
        noteGain.gain.exponentialRampToValueAtTime(0.0001, now + 5.0);

        osc.connect(noteGain);
        noteGain.connect(state.synthGain);

        osc.start(now);
        osc.stop(now + 5.2);
      }

      playChime();
      state.synthInterval = setInterval(playChime, 2400);

    } catch (e) {
      console.warn('신시사이저 실행 실패:', e);
    }
  }

  function stopAmbientSynth() {
    if (state.synthInterval) {
      clearInterval(state.synthInterval);
      state.synthInterval = null;
    }
    if (state.synthCtx) {
      state.synthCtx.close();
      state.synthCtx = null;
    }
  }

  /**
   * 은하수 별빛 캔버스 애니메이션
   */
  function initStarfield() {
    var canvas = document.getElementById('galaxy-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var stars = [];
    var numStars = 120;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    for (var i = 0; i < numStars; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: Math.random() * 1.5 + 0.5,
        alpha: Math.random(),
        speed: Math.random() * 0.02 + 0.005
      });
    }

    function render() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (var j = 0; j < stars.length; j++) {
        var s = stars[j];
        s.alpha += s.speed;
        if (s.alpha > 1 || s.alpha < 0) s.speed = -s.speed;

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, ' + Math.abs(s.alpha) + ')';
        ctx.fill();
      }
      requestAnimationFrame(render);
    }
    render();
  }

  // 초기화 실행
  document.addEventListener('DOMContentLoaded', init);

})();
