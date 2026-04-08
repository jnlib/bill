-- ══ 고지서 관리 시스템 테이블 ══

-- 고지서 데이터
CREATE TABLE bills (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bill_type TEXT NOT NULL CHECK (bill_type IN ('전기', '가스', '수도')),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  usage_amount NUMERIC,
  usage_unit TEXT DEFAULT 'kWh',
  bill_amount INTEGER,
  memo TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(bill_type, year, month)
);

-- 날씨 캐시
CREATE TABLE weather_cache (
  id SERIAL PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  avg_temp NUMERIC,
  max_temp NUMERIC,
  min_temp NUMERIC,
  heating_degree_days NUMERIC,
  cooling_degree_days NUMERIC,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(year, month)
);

-- 인덱스
CREATE INDEX idx_bills_type_year ON bills(bill_type, year);
CREATE INDEX idx_weather_year ON weather_cache(year, month);

-- RLS 비활성화 (Worker에서만 접근)
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_cache ENABLE ROW LEVEL SECURITY;

-- service_role 키 사용 시 RLS 우회됨
CREATE POLICY "Allow all for service_role" ON bills FOR ALL USING (true);
CREATE POLICY "Allow all for service_role" ON weather_cache FOR ALL USING (true);
