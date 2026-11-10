/**
 * 모두의 타임캡슐 - 메일 템플릿 및 발송 모듈
 */
var Mailer = {
  /**
   * HTML 메일 본문 빌더
   */
  buildHtmlBody: function(sessionName, nickname, pledgeA, pledgeB, bodyText, sealedDate, arrivalDate) {
    var safeSessionName = Utils.escapeHtml(sessionName || '연수');
    var safeNickname = Utils.escapeHtml(nickname || '선생님');
    var safePledgeA = Utils.escapeHtml(pledgeA || '');
    var safePledgeB = Utils.escapeHtml(pledgeB || '');
    var safeBody = Utils.escapeHtml(bodyText || '').replace(/\r?\n/g, '<br>');
    var safeSealed = Utils.escapeHtml(sealedDate ? sealedDate.substring(0, 10) : '');
    var safeArrival = Utils.escapeHtml(arrivalDate ? arrivalDate.substring(0, 10) : '');

    return '' +
      '<!DOCTYPE html>' +
      '<html>' +
      '<head>' +
      '<meta charset="UTF-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
      '<title>모두의 타임캡슐</title>' +
      '</head>' +
      '<body style="margin: 0; padding: 0; background-color: #f4f6fb; font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, \'Helvetica Neue\', Arial, sans-serif; color: #2d3748; line-height: 1.6;">' +
      '  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f6fb; padding: 30px 15px;">' +
      '    <tr>' +
      '      <td align="center">' +
      '        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.06);">' +
      '          <!-- 헤더 -->' +
      '          <tr>' +
      '            <td style="background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%); padding: 36px 30px; text-align: center; color: #ffffff;">' +
      '              <div style="display: inline-block; padding: 6px 14px; background: rgba(255,255,255,0.2); border-radius: 20px; font-size: 13px; font-weight: 600; letter-spacing: 0.5px; margin-bottom: 12px;">' +
      '                TIME CAPSULE ARRIVED' +
      '              </div>' +
      '              <h1 style="margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; line-height: 1.3;">' +
      '                미래의 나에게 부친 편지가 도착했습니다' +
      '              </h1>' +
      '              <p style="margin: 10px 0 0 0; font-size: 14px; opacity: 0.9;">' +
      '                [' + safeSessionName + '] 에서 봉인된 타임캡슐' +
      '              </p>' +
      '            </td>' +
      '          </tr>' +
      '          <!-- 본문 -->' +
      '          <tr>' +
      '            <td style="padding: 36px 30px;">' +
      '              <p style="font-size: 16px; color: #4b5563; margin-top: 0;">' +
      '                안녕하세요, <strong>' + safeNickname + '</strong>님.' +
      '              </p>' +
      '              <p style="font-size: 15px; color: #4b5563;">' +
      '                지난 ' + safeSealed + ', 연수를 마무리하며 스스로와 약속했던 그 다짐을 기억하시나요?<br>' +
      '                선생님께서 정성껏 봉인해 두었던 원칙과 편지를 지금 열어 전해드립니다.' +
      '              </p>' +
      '              <!-- 서약문 카드 -->' +
      '              <div style="margin: 28px 0; padding: 22px 24px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 8px;">' +
      '                <div style="font-size: 12px; font-weight: 700; color: #1d4ed8; text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.5px;">' +
      '                  선생님이 세운 실천 서약문' +
      '                </div>' +
      '                <div style="font-size: 17px; font-weight: 700; color: #1e293b; line-height: 1.5;">' +
      '                  "나는 다음 수업에서 <span style="color: #dc2626; text-decoration: line-through; background: #fee2e2; padding: 2px 6px; border-radius: 4px;">' + safePledgeA + '</span> 대신,<br>' +
      '                  <span style="color: #2563eb; background: #dbeafe; padding: 2px 6px; border-radius: 4px;">' + safePledgeB + '</span>을(를) 평가/실천하겠다."' +
      '                </div>' +
      '              </div>' +
      '              <!-- 편지 카드 -->' +
      '              <div style="margin: 28px 0; padding: 24px; background: #fafafa; border: 1px solid #e5e7eb; border-radius: 12px;">' +
      '                <div style="font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.5px;">' +
      '                  미래의 나에게 쓴 편지' +
      '                </div>' +
      '                <div style="font-size: 15px; color: #374151; line-height: 1.8; word-break: break-word;">' +
      '                  ' + safeBody + '' +
      '                </div>' +
      '              </div>' +
      '              <!-- 날짜 정보 -->' +
      '              <table role="presentation" width="100%" style="font-size: 13px; color: #9ca3af; border-top: 1px dashed #e5e7eb; padding-top: 16px;">' +
      '                <tr>' +
      '                  <td>봉인 일시: ' + safeSealed + '</td>' +
      '                  <td align="right">개봉 일시: ' + safeArrival + '</td>' +
      '                </tr>' +
      '              </table>' +
      '            </td>' +
      '          </tr>' +
      '          <!-- 푸터 -->' +
      '          <tr>' +
      '            <td style="background-color: #f8fafc; padding: 24px 30px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; line-height: 1.5;">' +
      '              본 메일은 연수 프로그램 중 선생님 본인이 미래의 본인에게 예약 발송 신청한 타임캡슐 메일입니다.<br>' +
      '              시스템 관련 문의 및 안내: 주관 기관 연수 담당자' +
      '            </td>' +
      '          </tr>' +
      '        </table>' +
      '      </td>' +
      '    </tr>' +
      '  </table>' +
      '</body>' +
      '</html>';
  },

  /**
   * 폴백 텍스트 본문 빌더
   */
  buildPlainTextBody: function(sessionName, nickname, pledgeA, pledgeB, bodyText, sealedDate, arrivalDate) {
    return '[' + sessionName + ' - 모두의 타임캡슐]\n\n' +
      '안녕하세요, ' + (nickname || '선생님') + '님.\n\n' +
      '지난 ' + (sealedDate ? sealedDate.substring(0, 10) : '') + ' 연수를 마무리하며 봉인했던 타임캡슐이 도착했습니다.\n\n' +
      '--------------------------------------------------\n' +
      '■ 나의 실천 서약문\n' +
      '"나는 다음 수업에서 [' + pledgeA + '] 대신, [' + pledgeB + ']을(를) 평가/실천하겠다."\n' +
      '--------------------------------------------------\n\n' +
      '■ 미래의 나에게 쓴 편지\n' +
      bodyText + '\n\n' +
      '--------------------------------------------------\n' +
      '봉인일: ' + (sealedDate ? sealedDate.substring(0, 10) : '') + ' / 도착일: ' + (arrivalDate ? arrivalDate.substring(0, 10) : '') + '\n' +
      '본 메일은 연수 마무리 시 본인이 직접 예약 발송한 메일입니다.';
  },

  /**
   * 메일 단일 발송 실행
   */
  send: function(capsule, session) {
    if (!capsule.emailTo || !Utils.isValidEmail(capsule.emailTo)) {
      throw new Error('수신 이메일 주소가 유효하지 않습니다: ' + capsule.emailTo);
    }

    var subject = '[타임캡슐] ' + (capsule.subject || '미래의 나에게서 온 편지');
    var htmlContent = this.buildHtmlBody(
      session ? session.name : '',
      capsule.nickname,
      capsule.pledgeA,
      capsule.pledgeB,
      capsule.body,
      capsule.createdAt,
      Utils.nowKSTString()
    );
    var plainContent = this.buildPlainTextBody(
      session ? session.name : '',
      capsule.nickname,
      capsule.pledgeA,
      capsule.pledgeB,
      capsule.body,
      capsule.createdAt,
      Utils.nowKSTString()
    );

    MailApp.sendEmail({
      to: capsule.emailTo,
      subject: subject,
      body: plainContent,
      htmlBody: htmlContent,
      name: '모두의 타임캡슐'
    });
  },

  /**
   * 관리자: 테스트 메일 발송
   */
  sendTestMail: function(token, targetEmail) {
    Auth.verifyToken(token);
    if (!targetEmail || !Utils.isValidEmail(targetEmail)) {
      throw new Error('올바른 테스트 수신 이메일 주소를 입력해주세요.');
    }

    var sampleCapsule = {
      emailTo: targetEmail.trim(),
      nickname: '홍길동 선생님',
      pledgeA: '단순 요약 과제',
      pledgeB: '비판적 사고를 요구하는 질문 토론',
      subject: '테스트 - 미래의 나에게 보내는 다짐',
      body: '안녕! 지난 연수에서 배웠던 학생 참여형 수업 설계를 잘 실천하고 있니? 초심을 잃지 말고 오늘도 힘내자!',
      createdAt: Utils.nowKSTString()
    };

    var sampleSession = {
      name: '테스트 연수 세션'
    };

    this.send(sampleCapsule, sampleSession);
    Utils.log('INFO', 'admin_send_test', { targetEmail: targetEmail });

    return {
      success: true,
      sentTo: targetEmail,
      remainingQuota: MailApp.getRemainingDailyQuota()
    };
  }
};
