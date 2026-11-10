/**
 * 모두의 타임캡슐 - 관리자 인증 모듈
 */
var Auth = {
  /**
   * 관리자 로그인
   * @param {string} password 입력한 비밀번호
   * @returns {Object} { token: string, expiresIn: number }
   */
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

    // 유효한 토큰 생성
    var token = 'atk_' + Utils.generateUuid().replace(/-/g, '');
    var cache = CacheService.getScriptCache();
    cache.put(token, 'ADMIN_LOGGED_IN', CONFIG.TOKEN_TTL_SEC);

    Utils.log('INFO', 'admin_login_success', '토큰 발급 완료');
    return {
      token: token,
      expiresIn: CONFIG.TOKEN_TTL_SEC
    };
  },

  /**
   * 관리자 토큰 검증
   * @param {string} token
   * @returns {boolean}
   */
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

  /**
   * 관리자 비밀번호 변경
   */
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
