/**
 * 모두의 타임캡슐 - 공통 API 통신 래퍼
 * CORS 프리플라이트 방지를 위해 POST 시 Content-Type: text/plain 을 사용합니다.
 */
var Api = {
  /**
   * GAS 웹앱 URL 가져오기
   */
  getUrl: function() {
    return (window.APP_CONFIG && window.APP_CONFIG.GAS_URL) ? window.APP_CONFIG.GAS_URL : '';
  },

  /**
   * GET 요청
   * @param {string} action 액션명
   * @param {Object} params 쿼리 파라미터
   */
  get: async function(action, params) {
    var baseUrl = this.getUrl();
    if (!baseUrl || baseUrl.indexOf('EXAMPLE_CHANGE_ME') !== -1) {
      throw new Error('config.js에 올바른 GAS_URL을 설정해주세요.');
    }

    var queryParams = Object.assign({ action: action }, params || {});
    var queryParts = [];
    for (var key in queryParams) {
      if (queryParams.hasOwnProperty(key) && queryParams[key] !== undefined && queryParams[key] !== null) {
        queryParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(queryParams[key]));
      }
    }

    var fullUrl = baseUrl + (baseUrl.indexOf('?') === -1 ? '?' : '&') + queryParts.join('&');

    try {
      var res = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      if (!res.ok) {
        throw new Error('네트워크 응답 오류: ' + res.status);
      }
      var data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || '요청 처리에 실패했습니다.');
      }
      return data.data;
    } catch (err) {
      console.error('API GET 오류 [' + action + ']:', err);
      throw err;
    }
  },

  /**
   * POST 요청
   * @param {string} action 액션명
   * @param {Object} payload 전송할 데이터
   * @param {string} token 관리자 토큰 (선택)
   */
  post: async function(action, payload, token) {
    var baseUrl = this.getUrl();
    if (!baseUrl || baseUrl.indexOf('EXAMPLE_CHANGE_ME') !== -1) {
      throw new Error('config.js에 올바른 GAS_URL을 설정해주세요.');
    }

    var bodyObj = {
      action: action,
      token: token || null
    };

    if (payload !== undefined && payload !== null) {
      // payload 안에 data로 감싸져 있거나 직접 전달된 경우 처리
      if (typeof payload === 'object' && payload.data !== undefined) {
        Object.assign(bodyObj, payload);
      } else {
        bodyObj.data = payload;
      }
    }

    try {
      var res = await fetch(baseUrl, {
        method: 'POST',
        // 브라우저 CORS Simple Request 요건 충족을 위해 text/plain 지정
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(bodyObj)
      });

      if (!res.ok) {
        throw new Error('네트워크 응답 오류: ' + res.status);
      }
      var data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || '요청 처리에 실패했습니다.');
      }
      return data.data;
    } catch (err) {
      console.error('API POST 오류 [' + action + ']:', err);
      throw err;
    }
  }
};
