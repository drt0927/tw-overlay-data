const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// 캐릭터 한글명 -> 코드 매핑
const CharacterCodeByName = {
  "루시안": 0,
  "보리스": 1,
  "막시민": 2,
  "시벨린": 3,
  "조슈아": 4,
  "란지에": 5,
  "이자크": 6,
  "밀라": 7,
  "티치엘": 8,
  "이스핀": 9,
  "나야트레이": 10,
  "아나이스": 11,
  "클로에": 12,
  "벤야": 13,
  "이솔렛": 14,
  "로아미니": 15,
  "녹턴": 16,
  "리체": 17,
  "예프넨": 18
};

// 헬퍼: 대기 함수
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scrapeServer(browser, serverCode) {
  const serverName = serverCode === 16 ? "네냐플" : "하이아칸";
  console.log(`[SCRAPER] ${serverName} 서버 에타 랭킹 크롤링 시작...`);
  
  const entries = [];
  let pageNum = 1;
  let hasMore = true;
  let lastUpdate = '';

  const page = await browser.newPage();
  
  // 봇 차단 우회 및 브라우저 환경 흉내
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  // 속도 극대화: 불필요한 리소스 로딩을 사전에 차단
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const resourceType = req.resourceType();
    if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  while (hasMore) {
    const url = `https://tales.nexon.com/Community/Ranking/EtaRank?page=${pageNum}&cc=99&sc=${serverCode}`;
    console.log(`[SCRAPER] ${serverName} - 페이지 ${pageNum} 요청 중...`);
    
    try {
      // 리소스 차단을 했기 때문에 DOM 내용만 로드되면 바로 처리하도록 타임아웃 단축
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const html = await page.content();
      
      // Last Update 날짜 추출 (첫 페이지에서만)
      if (pageNum === 1) {
        const dateMatch = html.match(/<dt>Last Update\s*:<\/dt>\s*<dd>([^<]+)<\/dd>/i);
        if (dateMatch) {
          lastUpdate = dateMatch[1].trim();
          console.log(`[SCRAPER] ${serverName} 업데이트 날짜: ${lastUpdate}`);
        }
      }
      
      // 랭킹 행 정규식 매치
      const rowRegex = /<td[^>]*class="col_rank"[^>]*>.*?<span[^>]*class="number"[^>]*>(\d+)<\/span>.*?<td[^>]*class="col_char"[^>]*>.*?<span[^>]*class="charname"[^>]*>([^<]+)<\/span>.*?<span[^>]*class="nickname"[^>]*>([^<]+)<\/span>.*?<\/td>.*?<td[^>]*class="number col_level"[^>]*>(\d+)<\/td>.*?<td[^>]*class="number col_point"[^>]*>([\d,]+)<\/td>/gs;
      
      let match;
      let pageEntryCount = 0;
      let zeroLevelCount = 0;
      
      while ((match = rowRegex.exec(html)) !== null) {
        pageEntryCount++;
        const rank = parseInt(match[1], 10);
        const charName = match[2].trim();
        const nickname = match[3].trim();
        const level = parseInt(match[4], 10);
        const point = parseInt(match[5].replace(/,/g, ''), 10);
        
        if (level === 0) {
          zeroLevelCount++;
        }
        
        const characterCode = CharacterCodeByName[charName] !== undefined ? CharacterCodeByName[charName] : 99;
        
        entries.push({
          ServerCode: serverCode,
          CharacterCode: characterCode,
          UserId: nickname,
          Level: level,
          Essence: point
        });
      }
      
      console.log(`[SCRAPER] 페이지 ${pageNum} 수집 결과: ${pageEntryCount}명 (에타 레벨 0인 유저: ${zeroLevelCount}명)`);
      
      // 종료 조건 체크:
      // 1. 페이지 내 유저 정보가 아예 없거나
      // 2. 수집된 유저 전부 에타 레벨이 0인 경우 (에타 레벨 달성 유저가 끝난 시점)
      if (pageEntryCount === 0 || zeroLevelCount === pageEntryCount) {
        console.log(`[SCRAPER] ${serverName} 서버의 에타 랭커 수집이 만료되어 종료합니다. (종료 페이지: ${pageNum})`);
        hasMore = false;
      } else {
        pageNum++;
        // 브라우저 렌더러가 돌기 때문에 200ms만 대기해도 안전
        await delay(200);
      }
      
    } catch (err) {
      console.error(`[SCRAPER] 페이지 ${pageNum} 수집 중 오류 발생:`, err.message);
      console.log('[SCRAPER] 3초 대기 후 해당 서버 수집을 중단합니다.');
      hasMore = false;
    }
  }
  
  await page.close();
  return { entries, lastUpdate };
}

async function run() {
  const start = Date.now();
  console.log('[SCRAPER] 테일즈위버 에타 랭킹 수집 작업을 시작합니다. (Puppeteer Engine)');
  
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    const neyaffle = await scrapeServer(browser, 16); // 네냐플
    await delay(1000); // 서버 전환 간 1초 대기
    const haiacan = await scrapeServer(browser, 7);  // 하이아칸
    
    // 수집된 데이터 검증
    if (!neyaffle.entries || neyaffle.entries.length === 0) {
      throw new Error("네냐플 서버에서 수집된 에타 랭킹 데이터가 없습니다.");
    }
    if (!haiacan.entries || haiacan.entries.length === 0) {
      throw new Error("하이아칸 서버에서 수집된 에타 랭킹 데이터가 없습니다.");
    }

    const allRankings = [...neyaffle.entries, ...haiacan.entries];
    
    // 최종 업데이트 날짜 조율
    const finalUpdateDate = neyaffle.lastUpdate || haiacan.lastUpdate || new Date().toISOString().split('T')[0];
    
    const payload = {
      CollectDate: finalUpdateDate,
      Rankings: allRankings
    };
    
    const outputPath = path.join(__dirname, 'eta_ranking.json');
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf-8');
    
    console.log(`[SCRAPER] 수집 완료! 총 수집 유저 수: ${allRankings.length}명`);
    console.log(`[SCRAPER] 저장 완료: ${outputPath}`);
    console.log(`[SCRAPER] 소요 시간: ${((Date.now() - start) / 1000).toFixed(1)}초`);
    
  } catch (err) {
    console.error('[SCRAPER] 수집 프로세스 중 중명적인 에러 발생:', err);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

run();
