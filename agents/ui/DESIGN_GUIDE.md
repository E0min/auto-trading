# Design Guide — Minimal Refined

이 문서는 대시보드 UI의 디자인 시스템을 정의합니다. 모든 UI 변경은 이 가이드를 따라야 합니다.

---

## 1. Design Philosophy

- **Less is more** — 모든 요소는 존재 이유를 증명해야 함
- **Typography-driven** — 폰트 자체가 디자인의 핵심. 장식 최소화
- **Surgical color** — 거의 무채색. 수익/손실 숫자에만 컬러 사용
- **Generous space** — 넓은 여백이 고급감을 만듦
- **Precision** — 모든 간격, 크기, 색상이 의도적

---

## 2. Color Palette

### CSS Variables (`globals.css`)

| Token | Value | Usage |
|---|---|---|
| `--bg-primary` | `#08080A` | 페이지 배경 |
| `--bg-elevated` | `#0E0E12` | 카드, 패널 |
| `--bg-surface` | `#15151A` | 입력, 프로그레스 트랙 |
| `--border-subtle` | `#1C1C22` | 기본 보더 |
| `--border-muted` | `#28282F` | 호버 보더, 구분선 |
| `--text-primary` | `#EAEAEC` | 제목, 주요 텍스트 |
| `--text-secondary` | `#7C7C84` | 라벨, 보조 텍스트 |
| `--text-muted` | `#44444C` | 비활성, 힌트 |
| `--accent` | `#C4A87C` | 골드 액센트 (극히 절제) |
| `--accent-subtle` | `rgba(196, 168, 124, 0.08)` | 액센트 배경 |
| `--profit` | `#4ADE80` | 수익 표시 전용 |
| `--loss` | `#F87171` | 손실 표시 전용 |

### 색상 사용 규칙

- **무채색이 기본** — UI 요소의 95%는 `--bg-*`, `--text-*`, `--border-*`만 사용
- **Profit/Loss** — 오직 PnL 숫자, 포지션 방향(Long/Short)에만 사용
- **Accent (골드)** — 액티브 탭 underline, 차트 라인, primary 버튼 보더에만 사용
- 절대 사용 금지: 무지개 색, 그라디언트 배경, 밝은 배경색

---

## 3. Typography Scale

### 폰트 패밀리

| Font | CSS Variable | Usage |
|---|---|---|
| Plus Jakarta Sans | `--font-sans` | 모든 UI 텍스트 (라벨, 버튼, 네비게이션) |
| JetBrains Mono | `--font-mono` | 데이터 테이블, 가격, 퍼센트, 코드 |
| `.font-display` class | italic mono | 핵심 금액 숫자 (총 자산, PnL 헤드라인) |

### 크기 스케일

| Size | Usage | Example |
|---|---|---|
| `text-3xl` | Hero 수치 (총 자산, 리스크 스코어) | `$12,345.67` |
| `text-lg` | 보조 Hero 수치 (가용 잔고, PnL) | `$8,920.00` |
| `text-sm` (14px) | 일반 본문, 테이블 셀 | 전략명, 심볼 |
| `text-[11px]` | 라벨, 뱃지, 보조 텍스트 | `활성`, `추천`, 탭 |
| `text-[10px]` | 극소 정보, 타임스탬프, 카테고리 | `가격행동`, `12:34:56` |

### 라벨 스타일

카드 제목, 섹션 헤더 등 라벨에는 항상:
```
text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)]
```

---

## 4. Spacing System

4px 기반 스케일. Tailwind 유틸리티 사용:

| Tailwind | px | Usage |
|---|---|---|
| `gap-1` / `p-1` | 4px | 아이콘-텍스트 간격 |
| `gap-1.5` | 6px | 인라인 요소 간격 |
| `gap-2` | 8px | 컴팩트 그룹 간격 |
| `gap-3` | 12px | 카드 내 요소 간격 |
| `gap-4` | 16px | 섹션 내 카드 간격 |
| `gap-6` | 24px | 섹션 간 간격 |
| `p-6` | 24px | 카드 내부 패딩 |
| `px-6 py-8` | 24/32px | 페이지 외부 패딩 |

### 핵심 원칙

- 카드 패딩은 항상 `p-6` (24px)
- 테이블은 `-mx-6 -mb-6`으로 카드 패딩을 오버라이드하여 edge-to-edge
- 섹션 간: `space-y-6` 또는 `gap-6`
- max-width: `1440px`, `mx-auto`

---

## 5. Component Patterns

### Card
```tsx
<div className="bg-[var(--bg-elevated)] border border-[var(--border-subtle)] rounded-lg p-6
     hover:border-[var(--border-muted)] transition-colors">
  <h3 className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-secondary)] mb-4">
    제목
  </h3>
  {/* content */}
</div>
```

### Button
- **Primary**: 골드 보더 아웃라인 + 투명 배경
- **Danger**: 레드 보더 아웃라인
- **Ghost**: 텍스트만, 배경/보더 없음
- `rounded-md`, 사이즈: `px-3 py-1.5 text-[11px]` (sm) / `px-4 py-2 text-sm` (md)

### Badge
도트 + 텍스트만. 배경 채움 없음:
```tsx
<span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--profit)]">
  <span className="w-1.5 h-1.5 rounded-full bg-[var(--profit)]" />
  활성
</span>
```

### Table
```css
/* thead */
text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]
border-b border-[var(--border-subtle)]

/* tbody tr */
border-b border-[var(--border-subtle)]/50
hover:bg-[var(--bg-surface)]/50

/* td */
py-3 px-4 text-[var(--text-secondary)]
font-mono (숫자 셀)
```

### Tabs (Underline)
```tsx
<button className="relative pb-2 text-[11px]">
  탭명
  {active && (
    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent)]" />
  )}
</button>
```

---

## 6. Animation Principles

### 허용된 애니메이션

| Name | Duration | Usage |
|---|---|---|
| `animate-fade-in` | 0.4s ease | 컴포넌트 마운트, 탭 전환 |
| `animate-number-up` | 0.6s ease-out | Hero 숫자 등장 |
| `animate-slide-in` | 0.3s ease | 드롭다운, 패널 확장 |
| `animate-pulse-dot` | 2s ease infinite | 라이브 상태 도트 |
| `transition-colors` | 150ms | 호버 색상 변경 |

### 금지 규칙

- 3개 이상 애니메이션 동시 재생 금지
- `bounce`, `shake` 등 과장된 모션 금지
- 0.6초 초과 duration 금지 (pulse-dot 제외)
- 모든 전환은 `ease` 또는 `ease-out` — `linear` 금지

---

## 7. Do's and Don'ts

### Do's
- CSS 변수(`var(--*)`)로 모든 색상 참조
- 숫자 데이터에는 항상 `font-mono`
- 라벨에는 `uppercase tracking-[0.08em]`
- 테이블은 카드 내에서 edge-to-edge (`-mx-6 -mb-6`)
- 상태 표시는 도트(●) + 텍스트
- 버튼은 아웃라인 스타일
- 충분한 여백 확보

### Don'ts
- 배경색으로 상태를 표현하지 않음 (뱃지에 bg 채움 금지)
- 그라디언트 배경 사용 금지
- `border-radius: 9999px` (pill shape) 남용 금지 — 도트에만 사용
- 2px 초과 보더 두께 금지
- 텍스트에 `font-bold` 남용 금지 — `font-medium`이 기본
- PnL 외 데이터에 profit/loss 색상 사용 금지
- 불필요한 아이콘 추가 금지 — 텍스트로 충분하면 텍스트만

---

## 8. Regime / Status Color Map

### Market Regime

| Regime | Text Class | Dot Class |
|---|---|---|
| `TRENDING_UP` | `text-emerald-400/70` | `bg-emerald-400/70` |
| `TRENDING_DOWN` | `text-rose-400/70` | `bg-rose-400/70` |
| `RANGING` | `text-amber-400/70` | `bg-amber-400/70` |
| `VOLATILE` | `text-orange-400/70` | `bg-orange-400/70` |
| `QUIET` | `text-sky-400/70` | `bg-sky-400/70` |
| default | `text-[var(--text-muted)]` | `bg-[var(--text-muted)]` |

### Bot Status

| State | Color |
|---|---|
| running | `var(--profit)` |
| paused | `amber-400` |
| stopped | `var(--text-muted)` |
| error | `var(--loss)` |

### Risk Severity

| Level | Border | Text |
|---|---|---|
| critical | `border-[var(--loss)]/30` | `text-[var(--loss)]` |
| warning | `border-amber-500/20` | `text-amber-400` |
| info | `border-blue-500/10` | `text-blue-400` |

---

## 9. Chart Styling (Recharts)

### 공통 규칙

```tsx
// CartesianGrid 사용 금지
<CartesianGrid /> // ❌

// 축 스타일
<XAxis
  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
  axisLine={{ stroke: 'var(--border-subtle)' }}
  tickLine={false}
/>
<YAxis
  tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
  axisLine={false}
  tickLine={false}
/>

// 툴팁
const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-muted)',
    borderRadius: '6px',
    fontSize: '11px',
    padding: '8px 12px',
  },
  labelStyle: { color: 'var(--text-muted)', fontSize: '10px' },
  itemStyle: { color: 'var(--text-primary)', padding: '2px 0' },
};
```

### 라인 차트

- 기본 라인: `stroke="var(--accent)"`, `strokeWidth={1.5}`
- 보조 라인: `stroke="var(--text-muted)"`, `strokeDasharray="4 4"`
- 도트 표시 금지 (`dot={false}`)

### 바 차트

- `barSize={12}`, `fillOpacity={0.7}`, `radius={[0, 3, 3, 0]}` (가로) 또는 `[3, 3, 0, 0]` (세로)
- Profit: `fill="var(--profit)"` / Loss: `fill="var(--loss)"`

### Area 차트

- 그라디언트: `<stop offset="0%" stopOpacity={0.15}/>` → `<stop offset="95%" stopOpacity={0.02}/>`
- 라인: `strokeWidth={1}`, `strokeOpacity={0.4}`

---

## 10. Responsive Breakpoints

| Breakpoint | Width | Layout |
|---|---|---|
| `sm` | 640px | 1열 스택 |
| `md` | 768px | 2열 기본 그리드 |
| `lg` | 1024px | 비대칭 그리드 (7/5, 5/7) |
| `xl` | 1280px | 전체 레이아웃 |

### 그리드 패턴

```tsx
// 기본 2열 비대칭
<div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
  <div className="lg:col-span-7">넓은 영역</div>
  <div className="lg:col-span-5">좁은 영역</div>
</div>

// 모바일에서 숨김
<div className="hidden md:block">데스크탑 전용</div>
```

### 반응형 규칙

- Hero Stats: 모바일에서 2열 (2x2), 데스크탑에서 4열
- 테이블: `overflow-x-auto`로 가로 스크롤
- 차트: `ResponsiveContainer width="100%"` 필수
- max-width `1440px`은 항상 유지
