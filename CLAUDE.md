# bill (공과금 관리 대시보드)

## 한 줄 설명
종로도서관 전기·수도 공과금을 한 화면(원페이퍼·무스크롤)에서 보는 대시보드. 실측 데이터 + 실제 날씨(Open-Meteo)로 연말 예산 전망·작년 대비 증감·날씨 기반 해명·행동 지침을 제공. PDF/이미지 고지서는 Cloudflare Worker OCR로 자동 입력.

## 스택
- **프론트**: `index.html` 단일 파일 (인라인 CSS + 인라인 JS). CDN: Chart.js 4.4.4, pdf.js, Noto Sans KR.
- **백엔드(선택)**: `worker.js` (Cloudflare Worker) — OCR + Supabase 저장/로드 + 날씨 수집.
- **배포**: 프론트 = GitHub Pages (jnlib/bill, public) / Worker = `bill-worker.hdh1231.workers.dev`.

## ⚠️ 핵심 도메인 규칙 (검침주기)
- **"N월분 고지서" = 전월 10일 ~ 당월 9일 사용분** (검침일 매월 9일).
  - 예: 1월분 = 2024.12.10~2025.01.09, 2월분 = 2025.01.10~02.09.
  - 즉 "N월" 기록은 사실상 **전월 사용분**. 날씨 비교도 이 검침주기로 버킷팅해야 맞음 (달력월로 비교하면 틀림).
- **2024년 제외**: 선납/완납 정산으로 월별 값이 왜곡 → 사용 안 함. **2025(기준연도) + 2026(진행중)만** 사용.
- **2025년 8월 요금(16,955,990원)**: 정산 catch-up으로 튄 값. 예측은 요금이 아니라 **사용량×올해평균단가**로 계산해 이 왜곡을 회피.

## 데이터 모델 (index.html 내 하드코딩, 입력표/하단표에서 수정 가능)
- `D[type][year][month] = {u:사용량, a:요금원}` — 전기 kWh / 수도 m³(격월·홀수월).
- `D[type].budget[year]` — **전기 105,600,000 / 수도 12,000,000** (연간 예산, 실제값).
- `W[year][month] = {avg}` — 검침주기로 버킷팅한 평균기온 (Open-Meteo, 2024-12-01부터, 무료·키 불필요).

## 분석 엔진 (결정적 계산, AI 없이 동작)
- `yoyTrend` 작년 대비 사용량 추세 / `wFactor` 전기 계절(기온) 보정(여름↑·겨울↑) / `expectedU` 기대 사용량.
- `detectAnomalies` 기대치 대비 ±18% 벗어나면 급증/누수의심 / `forecastNext` 다음달 예측.
- `monthlyExplain` 작년比 |7%|↑ 달을 **그 검침기간 실제 기온**으로 해명(더 추웠어요/난방비 등), 설명 안 되면 ⚠️점검.

## 화면 구성 (원페이퍼)
- **상단 좌**: AI 분석·조언 (일침 배너 + 권장조치 카드). 결정적 엔진으로 동기 렌더.
- **상단 우 (탭 패널)**: `📊 월별 누적`(예산 게이지, 작년比 ▲▼% 배지) / `📷 PDF 업로드`(드롭존→OCR) / `✏️ 입력표`(실시간 편집).
  - **입력표 셀 수정 → setVal → render() → 게이지·차트·AI·기온표 즉시 연동.**
- **하단**: 월별 사용량 차트(작년 좌·올해 우, 급증=빨강, 예측=빗금, 월별 작년比 ▲▼% 배지) + 월별 기온표(올해/작년/한줄설명).

## 외부 연결
| 대상 | 용도 |
|---|---|
| Open-Meteo API | 과거 날씨 (무료, 키 불필요, CORS OK) |
| Cloudflare Workers AI (Llama Vision) | 고지서 OCR (`/ocr`) |
| Supabase | 고지서/예산/날씨 저장 (`bill_*` 테이블, RLS) — 현재 /load는 비어있어 하드코딩 우선 |

## ⚠️ 주의사항
- **git 신원**: 이 레포는 jnlib. 글로벌 config는 runclean이라 **로컬 config로 jnlib 강제** 필요 (`user.name=jnlib`, `user.email=hdh1231@sen.go.kr`). 안 그러면 Vercel Hobby 차단.
- public 레포 — 민감정보 커밋 금지.
- 무스크롤(원페이퍼)이 기본. 요소 추가 시 `height:calc(100vh-52px); overflow:hidden` 유지 확인.

## 로컬 실행
- `npx serve C:\Users\user\bill -l 5051` (launch.json에 `bill` 등록됨).

## 관련 문서
- 전역 대시보드: `~/PROJECTS.md` / 인프라: `~/INFRASTRUCTURE.md`
