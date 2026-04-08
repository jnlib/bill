const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);

    try {
      // ── OCR: 고지서 이미지 인식 ──
      if (url.pathname === '/ocr' && request.method === 'POST') {
        const { image, billType } = await request.json();
        if (!image) return jsonErr('이미지가 필요합니다', 400);

        const prompt = `이 이미지는 한국의 ${billType || '공과금'} 고지서입니다.
다음 정보를 추출해서 JSON만 반환하세요 (설명 금지):

{"usage_amount": 사용량숫자, "usage_unit": "단위(kWh/m³/MJ 등)", "bill_amount": 청구금액숫자, "year": 연도숫자, "month": 월숫자}

- 사용량과 금액은 반드시 숫자만 (쉼표 제거)
- 연도/월은 청구 기준 연월
- 정보를 찾을 수 없으면 null로 표시`;

        const result = await env.AI.run(VISION_MODEL, {
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } }
            ]
          }]
        });

        const raw = typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
        let parsed;
        try {
          parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
        } catch(e) {
          parsed = { raw: raw, error: 'JSON 파싱 실패 — 수동 입력 필요' };
        }
        return json({ ocr: parsed });
      }

      // ── 고지서 CRUD ──
      if (url.pathname === '/bills' && request.method === 'GET') {
        const type = url.searchParams.get('type') || '전기';
        const year = url.searchParams.get('year');
        let query = `bill_type=eq.${encodeURIComponent(type)}&order=year.desc,month.asc`;
        if (year) query += `&year=eq.${year}`;
        const data = await supaGet(env, `/rest/v1/bills?${query}`);
        return json(data);
      }

      if (url.pathname === '/bills' && request.method === 'POST') {
        const body = await request.json();
        // upsert (같은 type+year+month 있으면 업데이트)
        const data = await supaPost(env, '/rest/v1/bills', body, true);
        return json({ ok: true, data });
      }

      if (url.pathname.startsWith('/bills/') && request.method === 'DELETE') {
        const id = url.pathname.split('/')[2];
        await supaDelete(env, `/rest/v1/bills?id=eq.${id}`);
        return json({ ok: true });
      }

      // ── 날씨 데이터 ──
      if (url.pathname === '/weather' && request.method === 'GET') {
        const year = url.searchParams.get('year');
        if (!year) return jsonErr('year 파라미터 필요', 400);

        // 캐시 먼저 확인
        const cached = await supaGet(env, `/rest/v1/weather_cache?year=eq.${year}&order=month.asc`);
        if (cached && cached.length > 0) return json(cached);

        // 기상청 API 호출 후 캐싱
        if (!env.WEATHER_API_KEY) return jsonErr('날씨 API 키 미설정', 500);
        const weatherData = await fetchWeather(env, year);
        if (weatherData.length > 0) {
          await supaPost(env, '/rest/v1/weather_cache', weatherData, true);
        }
        return json(weatherData);
      }

      // ── AI 분석 ──
      if (url.pathname === '/analyze' && request.method === 'POST') {
        const { billType, bills, weather } = await request.json();

        const prompt = `당신은 공공기관 에너지 관리 전문가예요. 해요체로 분석해주세요.

[${billType} 사용 데이터]
${JSON.stringify(bills)}

[월별 평균기온]
${JSON.stringify(weather)}

분석해주세요:
1. 사용량/요금 추이 (전년 대비)
2. 날씨(기온)와 사용량의 상관관계
3. 특이사항 (비정상적으로 높은/낮은 달)
4. 절약 제안
5. 향후 예상

반드시 JSON만 반환:
{"summary":"전체 요약 2-3문장","trend":"추이 분석","correlation":"기온 상관관계","anomalies":"특이사항","suggestions":"절약 제안","forecast":"향후 예상"}`;

        const result = await env.AI.run(AI_MODEL, {
          messages: [
            { role: 'system', content: 'JSON만 반환. 한국어 해요체. 마크다운 금지.' },
            { role: 'user', content: prompt }
          ]
        });

        const raw = typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
        let parsed;
        try {
          parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
        } catch(e) {
          parsed = { summary: raw };
        }
        return json({ analysis: parsed });
      }

      // ── 예상 금액 예측 ──
      if (url.pathname === '/predict' && request.method === 'POST') {
        const { billType, bills, weather, targetYear, targetMonth } = await request.json();

        // 통계 기반 예측
        const prediction = calculatePrediction(bills, weather, targetYear, targetMonth);

        // AI 해석
        const prompt = `공공기관 ${billType} 요금을 예측해주세요. 해요체로 답변.

과거 데이터: ${JSON.stringify(bills.slice(-24))}
날씨 데이터: ${JSON.stringify(weather)}
예측 대상: ${targetYear}년 ${targetMonth}월
통계 예측값: ${prediction.amount}원

JSON만 반환:
{"predicted_amount":예측금액숫자,"predicted_usage":예측사용량숫자,"reason":"예측 근거 2-3문장","confidence":"높음/보통/낮음"}`;

        const result = await env.AI.run(AI_MODEL, {
          messages: [
            { role: 'system', content: 'JSON만 반환. 한국어.' },
            { role: 'user', content: prompt }
          ]
        });

        const raw = typeof result.response === 'string' ? result.response : JSON.stringify(result.response);
        let aiPrediction;
        try {
          aiPrediction = JSON.parse(raw.replace(/```json|```/g, '').trim());
        } catch(e) {
          aiPrediction = { reason: raw };
        }

        return json({ statistical: prediction, ai: aiPrediction });
      }

      // ── 상태 확인 ──
      if (url.pathname === '/' || url.pathname === '/health') {
        return json({ status: 'ok', service: 'bill-worker' });
      }

      return jsonErr('Not Found', 404);

    } catch(e) {
      return jsonErr(e.message, 500);
    }
  }
};

// ── 통계 기반 예측 ──
function calculatePrediction(bills, weather, targetYear, targetMonth) {
  // 전년 동월 데이터 찾기
  const lastYear = bills.find(b => b.year === targetYear - 1 && b.month === targetMonth);
  const twoYearsAgo = bills.find(b => b.year === targetYear - 2 && b.month === targetMonth);

  if (!lastYear) return { amount: null, usage: null, method: '데이터 부족' };

  let amount = lastYear.bill_amount;
  let usage = lastYear.usage_amount;

  // 2년치 있으면 증가율 반영
  if (twoYearsAgo && twoYearsAgo.bill_amount > 0) {
    const growthRate = (lastYear.bill_amount - twoYearsAgo.bill_amount) / twoYearsAgo.bill_amount;
    amount = Math.round(lastYear.bill_amount * (1 + growthRate));
    if (twoYearsAgo.usage_amount > 0) {
      const usageGrowth = (lastYear.usage_amount - twoYearsAgo.usage_amount) / twoYearsAgo.usage_amount;
      usage = Math.round(lastYear.usage_amount * (1 + usageGrowth));
    }
  }

  // 날씨 보정 (기온 차이 반영)
  if (weather && weather.length > 0) {
    const thisYearTemp = weather.find(w => w.year === targetYear && w.month === targetMonth);
    const lastYearTemp = weather.find(w => w.year === targetYear - 1 && w.month === targetMonth);
    if (thisYearTemp && lastYearTemp) {
      const tempDiff = thisYearTemp.avg_temp - lastYearTemp.avg_temp;
      // 겨울(난방): 기온 낮으면 사용량 증가, 여름(냉방): 기온 높으면 증가
      if (targetMonth >= 11 || targetMonth <= 3) {
        amount = Math.round(amount * (1 - tempDiff * 0.03));
      } else if (targetMonth >= 6 && targetMonth <= 9) {
        amount = Math.round(amount * (1 + tempDiff * 0.03));
      }
    }
  }

  return { amount, usage, method: '전년동월 + 증가율 + 기온보정' };
}

// ── 기상청 API (ASOS 일평균기온 → 월평균) ──
async function fetchWeather(env, year) {
  const results = [];
  for (let month = 1; month <= 12; month++) {
    const startDt = `${year}${String(month).padStart(2, '0')}01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDt = `${year}${String(month).padStart(2, '0')}${lastDay}`;

    try {
      const qs = new URLSearchParams({
        serviceKey: env.WEATHER_API_KEY,
        numOfRows: '31',
        pageNo: '1',
        dataType: 'JSON',
        dataCd: 'ASOS',
        dateCd: 'DAY',
        startDt, endDt,
        stnIds: '108' // 서울(종로)
      });
      const r = await fetch(`https://apis.data.go.kr/1360000/AsosDalyInfoService/getWthrDataList?${qs}`);
      const d = await r.json();
      const items = d.response?.body?.items?.item || [];
      if (items.length === 0) continue;

      const temps = items.map(i => parseFloat(i.avgTa)).filter(t => !isNaN(t));
      const avgTemp = temps.length > 0 ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length * 10) / 10 : null;
      const maxTemp = temps.length > 0 ? Math.max(...items.map(i => parseFloat(i.maxTa)).filter(t => !isNaN(t))) : null;
      const minTemp = temps.length > 0 ? Math.min(...items.map(i => parseFloat(i.minTa)).filter(t => !isNaN(t))) : null;

      results.push({
        year: parseInt(year), month,
        avg_temp: avgTemp, max_temp: maxTemp, min_temp: minTemp,
        heating_degree_days: avgTemp !== null ? Math.max(0, Math.round((18 - avgTemp) * 30)) : null,
        cooling_degree_days: avgTemp !== null ? Math.max(0, Math.round((avgTemp - 24) * 30)) : null,
      });
    } catch(e) { /* skip failed month */ }
  }
  return results;
}

// ── Supabase 헬퍼 ──
async function supaGet(env, path) {
  const r = await fetch(env.SUPABASE_URL + path, {
    headers: { 'apikey': env.SUPABASE_KEY, 'Authorization': 'Bearer ' + env.SUPABASE_KEY }
  });
  return r.json();
}

async function supaPost(env, path, body, upsert) {
  const headers = {
    'apikey': env.SUPABASE_KEY,
    'Authorization': 'Bearer ' + env.SUPABASE_KEY,
    'Content-Type': 'application/json',
  };
  if (upsert) headers['Prefer'] = 'resolution=merge-duplicates';
  const r = await fetch(env.SUPABASE_URL + path, {
    method: 'POST', headers,
    body: JSON.stringify(Array.isArray(body) ? body : [body])
  });
  if (!r.ok) throw new Error('DB 저장 실패: ' + (await r.text()));
  return true;
}

async function supaDelete(env, path) {
  await fetch(env.SUPABASE_URL + path, {
    method: 'DELETE',
    headers: { 'apikey': env.SUPABASE_KEY, 'Authorization': 'Bearer ' + env.SUPABASE_KEY }
  });
}

// ── 응답 헬퍼 ──
function json(data) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...CORS } });
}

function jsonErr(message, status) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}
