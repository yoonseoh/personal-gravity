Personal Gravity 3D 상세 페이지 전달용 파일입니다.

이 패키지는 홈 화면 없이 바로 3D 모델링 상세 페이지가 열리도록 설정되어 있습니다.

절대 index.html을 더블클릭해서 file:// 로 열지 마세요.
3D 모델은 브라우저 보안 정책 때문에 로컬 서버로 열어야 안정적으로 보입니다.

Mac에서 여는 방법:
1. 압축을 풉니다.
2. start-mac.command 파일을 더블클릭합니다.
3. 브라우저에서 http://localhost:8080 을 엽니다.

Windows에서 여는 방법:
1. 압축을 풉니다.
2. start-windows.bat 파일을 더블클릭합니다.
3. 브라우저에서 http://localhost:8080 을 엽니다.

직접 터미널로 여는 방법:
1. 이 폴더로 이동합니다.
2. 아래 명령어를 실행합니다.

python3 -m http.server 8080

3. 브라우저에서 http://localhost:8080 을 엽니다.

포함된 것:
- index.html: 상세 페이지로 바로 시작
- assets 폴더: React/Three.js/CSS 번들
- models 폴더: 3D GLB 모델

주의:
- 폴더 안의 assets, models 폴더를 index.html과 분리하면 안 됩니다.
- 이미 8080 포트를 쓰고 있으면 8081 같은 다른 번호로 실행해도 됩니다.
