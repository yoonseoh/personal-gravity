# Personal Gravity

공간별 라이프스타일을 행성과 포인트클라우드로 탐색하는 인터랙티브 전시 앱입니다.

## 로컬 실행

Node.js 22 이상을 설치한 뒤 프로젝트 폴더에서 실행합니다.

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173`을 엽니다.

## GitHub에 올리기

1. GitHub에서 새 저장소를 생성합니다.
2. 프로젝트 폴더에서 아래 명령을 순서대로 실행합니다.

```bash
git init
git add .
git commit -m "Publish Personal Gravity"
git branch -M main
git remote add origin https://github.com/사용자이름/저장소이름.git
git push -u origin main
```

## GitHub Pages 퍼블리싱

저장소의 `Settings > Pages > Build and deployment > Source`에서
`GitHub Actions`를 선택합니다.

이후 `main` 브랜치에 코드를 올릴 때마다 `.github/workflows/deploy-pages.yml`이
자동으로 빌드하고 GitHub Pages에 배포합니다.

배포 주소는 Actions 작업 완료 후 저장소의 `Settings > Pages`에서 확인할 수 있습니다.

## 주요 폴더

- `src/`: 화면과 인터랙션 소스
- `public/images/`: 행성 및 제품 이미지
- `public/models/`: 포인트클라우드 데이터
- `scripts/`: 포인트클라우드 제작 및 검증 도구
