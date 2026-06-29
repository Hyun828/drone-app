# 드론 배우기 — 안드로이드 오프라인 앱 (WebView APK)

이 프로젝트는 웹 앱(`out/` 정적 빌드)을 **완전 오프라인**으로 실행하는 안드로이드 래퍼입니다.
`WebViewAssetLoader`로 내부 `assets/`를 `https://appassets.androidplatform.net/` 로 제공하기 때문에
인터넷·로컬 서버 없이 **아이콘 한 번 탭**으로 실행됩니다.

## 동작 원리
- 웹 자산은 `app/src/main/assets/` 안에 통째로 들어 있습니다(= `out/` 복사본).
- `MainActivity`가 `assets/index.html`을 WebView로 로드합니다.
- Next.js의 절대경로(`/_next/...`)와 ES 모듈이 `file://` 제약 없이 그대로 동작합니다.

## 빌드 방법 (택 1)

### A) Android Studio (가장 쉬움, 권장)
1. Android Studio에서 `android-app` 폴더를 **Open**
2. Gradle 동기화가 끝나면 상단 ▶(Run) 또는
   `Build > Build Bundle(s)/APK(s) > Build APK(s)`
3. 만들어진 `app/build/outputs/apk/debug/app-debug.apk` 를 태블릿에 복사 후 설치

### B) 명령줄 (Gradle 설치되어 있는 PC)
```bash
cd android-app
gradle wrapper          # 최초 1회 (gradlew 생성)
./gradlew assembleDebug  # Windows: gradlew.bat assembleDebug
```
결과물: `app/build/outputs/apk/debug/app-debug.apk`

## 태블릿에 설치
1. APK 파일을 태블릿으로 옮김(USB/이메일/드라이브 등)
2. 파일을 탭 → "출처를 알 수 없는 앱 설치" 허용 → 설치
3. 홈 화면의 **드론 배우기** 아이콘 탭 → 완전 오프라인 실행

## 앱(웹) 내용을 수정했을 때 갱신하는 법
프로젝트 루트(`drone-app`)에서:
```bash
npm run build
rm -rf android-app/app/src/main/assets/*
cp -R out/. android-app/app/src/main/assets/
```
그 후 다시 빌드하면 됩니다.

## 참고
- `minSdk = 26` (Android 8.0+) — 적응형 아이콘 사용을 위해 설정.
- 인터넷 권한 없음(완전 로컬). WebGL(three.js)·오디오 모두 WebView에서 동작.
- 배포(스토어/장기 사용)용으로는 release 서명 키로 `assembleRelease` 권장.
