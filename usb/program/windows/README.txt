[program/windows] 폴더 — 윈도우 PC 실행
======================================

■ 실행 방법
  1) run.bat 더블클릭
  2) 자동으로 브라우저가 http://127.0.0.1:8080/ 을 엽니다 (인터넷 불필요)
  3) 종료: 검은 명령창을 닫거나 Ctrl+C

■ 구성 파일
  - run.bat    : 실행 런처 (이 파일을 더블클릭)
  - index.exe  : 컴파일된 로컬 웹서버 실행파일 (설치 불필요)
  - out\       : 웹 애플리케이션 본체 (시작 파일: index.html)

■ 참고
  본 소프트웨어는 웹 애플리케이션(HTML / JavaScript / WebGL)입니다.
  Next.js 구조상 out\index.html 을 더블클릭으로 직접 열면 실행되지 않습니다.
  (브라우저가 보안상 file:// 환경에서 모듈 스크립트를 차단하기 때문)
  그래서 컴파일된 실행파일 index.exe(로컬 웹서버)를 run.bat 이 자동으로 구동하여
  설치 과정 없이 즉시 실행되도록 구성했습니다.

■ 화면은 뜨는데 드론·버튼이 안 될 때
  1) run.bat 로 연 주소가 http://127.0.0.1:8080/ 인지 확인 (파일 직접 열기 금지)
  2) Chrome 또는 Edge 사용 (Internet Explorer 사용 금지)
  3) 브라우저에서 Ctrl+Shift+R (강력 새로고침) 또는 캐시 삭제 후 다시 run.bat 실행
  4) 그래도 안 되면 index.exe·out 폴더가 같은 program\windows 안에 있는지 확인
