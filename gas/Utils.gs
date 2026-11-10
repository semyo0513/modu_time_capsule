/**
 * 모두의 타임캡슐 - 유틸리티 함수 모음
 */
var Utils = {
  /**
   * 스프레드시트 인스턴스 가져오기
   */
  getSpreadsheet: function() {
    var props = PropertiesService.getScriptProperties();
    var sheetId = props.getProperty('SHEET_ID');
    if (!sheetId) {
      throw new Error('Script Properties에 SHEET_ID가 설정되지 않았습니다.');
    }
    return SpreadsheetApp.openById(sheetId);
  },

  /**
   * 특정 이름의 시트 가져오기
   */
  getSheet: function(sheetName) {
    var ss = this.getSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error('시트를 찾을 수 없습니다: ' + sheetName);
    }
    return sheet;
  },

  /**
   * 헤더 기반으로 시트 데이터 전체를 객체 배열로 반환
   */
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

  /**
   * 헤더 인덱스 매핑 캐시 가져오기 (1-based index)
   */
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

  /**
   * 수식 인젝션 방지: =, +, -, @ 로 시작하면 앞에 ' 붙이기
   */
  sanitizeFormula: function(val) {
    if (val === null || val === undefined) return '';
    var str = String(val);
    if (/^[=\+\-@]/.test(str)) {
      return "'" + str;
    }
    return str;
  },

  /**
   * 단일 행 추가
   */
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

  /**
   * 특정 행의 특정 컬럼들을 업데이트
   * @param {string} sheetName 시트명
   * @param {number} rowNumber 대상 행 번호 (1-based)
   * @param {Object} updateObj 업데이트할 컬럼:값 객체
   */
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

  /**
   * HTML 이스케이프
   */
  escapeHtml: function(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  /**
   * UUID v4 생성
   */
  generateUuid: function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  /**
   * 6자리 영숫자 난수 세션 코드 생성 (가독성을 위해 헷갈리는 문자 O, 0, I, 1 제외)
   */
  generateSessionCode: function() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var code = '';
    for (var i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  },

  /**
   * KST 현재 시각 ISO 문자열 (YYYY-MM-DDTHH:mm:ss)
   */
  nowKSTString: function() {
    var now = new Date();
    return Utilities.formatDate(now, 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ss");
  },

  /**
   * 임의의 Date 객체나 날짜 문자열을 KST ISO 문자열로 포맷팅
   */
  formatKST: function(dateOrStr) {
    if (!dateOrStr) return '';
    var d = (dateOrStr instanceof Date) ? dateOrStr : new Date(dateOrStr);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ss");
  },

  /**
   * KST 날짜 파싱 (ISO 문자열 -> Date 객체)
   */
  parseKST: function(dateStr) {
    if (!dateStr) return null;
    if (dateStr instanceof Date) return dateStr;
    var d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  },

  /**
   * 이메일 유효성 검증
   */
  isValidEmail: function(email) {
    if (!email || typeof email !== 'string') return false;
    var emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email.trim());
  },

  /**
   * 로그 기록
   */
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
