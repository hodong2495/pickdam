# 픽담 코드 실행 내용 정리

## 1. 접속 주소

- 공개 사이트: https://pickdam.onrender.com
- GitHub: https://github.com/hodong2495/pickdam
- 서버 상태: https://pickdam.onrender.com/health

## 2. 실행 환경

- 백엔드: Python 3.12, FastAPI, Uvicorn
- OCR: Tesseract OCR `kor+eng`, Pillow, pytesseract
- 프런트엔드: HTML, CSS, JavaScript
- 배포: Docker, GitHub, Render Web Service
- 사용자 데이터: 브라우저 `localStorage`

## 3. 파일별 실행 역할

```text
backend/main.py      FastAPI, 이미지 OCR, 텍스트 정리, 일정·메모 후보 추출
frontend/index.html  메모·분석·캘린더 화면
frontend/style.css   PC·모바일 반응형 디자인
frontend/app.js      API 호출, 저장, 달력, 메모, ICS 생성
Dockerfile           Python·Tesseract 실행 환경
requirements.txt    Python 패키지 목록
```

## 4. Docker 로컬 실행

```powershell
cd C:\Users\USER\Desktop\Pickdam-Public
docker build --no-cache -t pickdam .
docker run --rm -p 8000:8000 --name pickdam-local pickdam
```

접속:

```text
http://127.0.0.1:8000
http://127.0.0.1:8000/health
```

종료:

```text
Ctrl + C
```

Docker 서버 시작 명령:

```text
uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

Render의 `PORT`가 있으면 해당 포트를 사용하고 로컬에서는 `8000`을 사용한다.

## 5. 서버 API

### `GET /health`

FastAPI와 컨테이너의 정상 작동 여부를 확인한다.

```json
{"message":"AI 일정 도우미 서버가 정상 작동 중입니다."}
```

### `POST /analyze`

이미지를 받아 다음 순서로 처리한다.

1. PNG·JPG MIME 확인
2. 파일 크기 10MB 이하 확인
3. 실제 PNG·JPEG 파일 확인
4. 해상도 2천만 픽셀 이하 확인
5. EXIF 방향 보정
6. 흑백 변환과 자동 대비 보정
7. 세로 포스터의 제목·일정표·하단 정보 영역 분리
8. Tesseract `kor+eng`, `--oem 3 --psm 6` 실행
9. OCR 문장 정리
10. 복수 일정과 중요 메모 후보 생성

이미지는 메모리에서 처리하고 원본 파일은 디스크에 저장하지 않는다.

### `POST /analyze-text`

직접 입력한 텍스트와 기준 연도를 받아 날짜 표현을 정규화하고 일정·메모 후보를 만든다.

```json
{
  "text": "접수 기간 2026.9.1 ~ 9.10 18:00까지",
  "reference_year": 2026
}
```

API 라우트 뒤에서 `app.mount("/")`로 `frontend` 폴더를 제공한다.

## 6. 일정·메모 추출 함수

```text
normalize_korean_date_text()  한글 날짜 표현 정규화
extract_event_title()         행사·교육·공모전 제목 추출
extract_schedule()            기본 일정 추출
extract_schedule_timeline()   단계별 추진 일정 추출
extract_multiple_schedules()  접수 시작·마감과 복수 일정 생성
extract_important_memos()     준비물·문의처·신청 링크 추출
build_analysis_response()     최종 분석 응답 생성
```

반환 항목:

```text
제목, 시작, 종료, 종일 여부, 장소, 메모, 알림,
OCR 원문, 확인 경고, 중요 메모 후보
```

분석 결과는 자동 저장하지 않는다. 사용자가 원문과 비교하고 수정한 뒤 확인 체크박스를 선택해야 저장된다.

## 7. 일정 저장과 달력

일정은 서버가 아니라 현재 브라우저에 저장한다.

```javascript
const SCHEDULE_STORAGE_KEY = "pickdam_schedules_v1";
```

```text
createScheduleId()       일정 ID 생성
readStoredSchedules()    localStorage 일정 조회
writeStoredSchedules()   localStorage 일정 저장
hasDuplicateSchedule()   중복 검사
renderSchedules()        일정 목록 표시
renderCalendar()         월간 달력 표시
```

브라우저별로 데이터가 분리된다. 같은 브라우저에서는 새로고침이나 Render 재시작 후에도 일정이 유지된다.

## 8. 메모 저장

```javascript
const MEMO_STORAGE_KEY = "pickdam_memos_v1";
```

```text
createMemoId()          메모 ID 생성
readStoredMemos()       localStorage 메모 조회
writeStoredMemos()      localStorage 메모 저장
hasDuplicateMemo()      중복 검사
sortStoredMemos()       고정 메모 우선 정렬
renderSavedMemos()      메모 목록 표시
```

메모 작성·검색·수정·삭제·상단 고정과 민감정보 확인을 브라우저에서 처리한다.

## 9. 화면 이동

`showAppPage(pageName)`가 화면을 전환한다.

```text
memo      메모장
analyze   이미지·텍스트 분석
calendar  월간 캘린더
```

PC에서는 상단 메뉴, 모바일에서는 하단 고정 메뉴와 좌우 스와이프를 사용한다. 주소 해시는 `#memo`, `#analyze`, `#calendar`로 갱신된다.

## 10. ICS 생성

`downloadScheduleIcs()`가 서버 전송 없이 브라우저에서 ICS를 만든다.

종일 일정:

```text
DTSTART;VALUE=DATE:20260715
DTEND;VALUE=DATE:20260716
```

시간 일정:

```text
DTSTART;TZID=Asia/Seoul:20260915T180000
```

종료 시간이 있을 때만 `DTEND`를 추가한다. ICS에는 제목, 장소, 메모와 알림이 포함되며 `schedule-{id}.ics`로 내려받는다.

## 11. GitHub·Render 배포

```powershell
git add backend/main.py frontend/index.html frontend/style.css
git commit -m "변경 내용 설명"
git push
```

GitHub `main`에 커밋이 올라가면 Render가 Docker 이미지를 자동 빌드·배포한다. Render `Events`에서 `Deploy live`를 확인한다.

## 12. 현재 저장·보안 구조

```text
Render FastAPI 서버
  - 이미지 OCR
  - 텍스트 정규화
  - 일정·메모 후보 추출
  - 정적 프런트엔드 제공

사용자 브라우저
  - 일정 localStorage 저장
  - 메모 localStorage 저장
  - 월간 캘린더 표시
  - ICS 파일 생성
```

- Google OAuth와 Google Calendar를 사용하지 않는다.
- SQLite 공용 일정·메모 저장 API를 사용하지 않는다.
- 업로드 원본 이미지를 저장하지 않는다.
- 실제 비밀번호·OTP는 localStorage에 저장하지 않는 것이 원칙이다.
- 브라우저 데이터 삭제 시 일정과 메모도 삭제된다.

