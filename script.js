const API_KEY = '7c489c93947d3e1bd16d63b86906201d';

// ブローカー種別ごとの1枚あたりの通貨数
const BROKER_UNIT = {
    domestic: 10000,   // 国内: 1枚 = 1万通貨
    overseas: 100000,  // 海外: 1枚 = 10万通貨
};

// USD建てレートを取得し、必要なクロスレートを返す
async function fetchRates() {
    try {
        const res = await fetch(
            `https://api.exchangerate.host/live?access_key=${API_KEY}&source=USD&currencies=JPY,EUR,GBP,AUD,NZD`
        );
        if (!res.ok) throw new Error('APIレスポンスエラー');
        const data = await res.json();
        if (!data.quotes || !data.quotes['USDJPY']) throw new Error('レートデータ不足');
        return data.quotes; // 例: { USDJPY: 150, USDEUR: 0.92, USDGBP: 0.79, ... }
    } catch (e) {
        // フォールバック: 固定レート
        console.warn('レート取得失敗、フォールバックを使用:', e.message);
        return {
            USDJPY: 149.50,
            USDEUR: 0.9200,
            USDGBP: 0.7880,
            USDAUD: 1.5300,
            USDNZD: 1.6300,
        };
    }
}

// 通貨ペアのレート(1単位目通貨 = ? 2単位目通貨)を計算
function getPairRate(pair, quotes) {
    const usdJpy = quotes['USDJPY'];
    switch (pair) {
        case 'USDJPY': return usdJpy;
        case 'EURJPY': return usdJpy / quotes['USDEUR'];
        case 'GBPJPY': return usdJpy / quotes['USDGBP'];
        case 'AUDJPY': return usdJpy / quotes['USDAUD'];
        case 'NZDJPY': return usdJpy / quotes['USDNZD'];
        case 'EURUSD': return 1 / quotes['USDEUR'];
        case 'GBPUSD': return 1 / quotes['USDGBP'];
        case 'AUDUSD': return 1 / quotes['USDAUD'];
        default: return usdJpy;
    }
}

// 1pip・1枚あたりの利益(JPY)
function pipValueJpy(pair, unitSize, quotes) {
    const usdJpy = quotes['USDJPY'];
    if (pair.endsWith('JPY')) {
        // JPY建て: 1pip = 0.01 JPY/通貨
        return 0.01 * unitSize;
    } else {
        // USD建て: 1pip = 0.0001 USD/通貨
        return 0.0001 * unitSize * usdJpy;
    }
}

// 0.1単位でfloor（国内: 0.1枚刻み）
function floorTenth(n) {
    return Math.floor(n * 10) / 10;
}

// 0.01単位でfloor（海外: 0.01枚刻み）
function floorHundredth(n) {
    return Math.floor(n * 100) / 100;
}

// 枚数を表示用にフォーマット
function formatLots(lots, brokerType) {
    if (brokerType === 'overseas') {
        return lots.toFixed(2) + ' 枚';
    }
    return (lots % 1 === 0 ? lots.toFixed(0) : lots.toFixed(1)) + ' 枚';
}

// JPY金額をカンマ区切りフォーマット
function formatJpy(amount) {
    return '¥ ' + Math.round(amount).toLocaleString('ja-JP');
}

// シミュレーション実行(30日分)
function runSimulation(pair, rate, initialFunds, leverage, pips, lotLimit, brokerType, quotes) {
    const unitSize = BROKER_UNIT[brokerType];
    const floorFn = brokerType === 'overseas' ? floorHundredth : floorTenth;
    const results = [];
    let funds = initialFunds;
    const pipVal = pipValueJpy(pair, unitSize, quotes);
    const usdJpy = quotes['USDJPY'];

    for (let day = 1; day <= 30; day++) {
        let lots;
        if (pair.endsWith('JPY')) {
            // 必要証拠金 = レート × 単位 / レバレッジ
            lots = floorFn(funds * leverage / (rate * unitSize));
        } else {
            // USD建て: JPY換算で証拠金計算
            lots = floorFn(funds * leverage / (rate * unitSize * usdJpy));
        }
        lots = Math.min(lots, lotLimit);

        const profit = Math.round(lots * pips * pipVal);
        funds = funds + profit;

        results.push({ day, lots, profit, funds });
    }

    return results;
}

async function simulate() {
    const btn = document.getElementById('calc-btn');
    btn.disabled = true;
    btn.textContent = '取得中...';

    try {
        const pair = document.getElementById('currency_pair').value;
        const initialFunds = parseFloat(document.getElementById('initial_funds').value);
        const leverage = parseFloat(document.getElementById('leverage').value);
        const pips = parseFloat(document.getElementById('pips').value);
        const lotLimit = parseFloat(document.getElementById('lot_limit').value);
        const brokerType = document.querySelector('input[name="broker_type"]:checked').value;

        if ([initialFunds, leverage, pips, lotLimit].some(v => isNaN(v) || v <= 0)) {
            alert('すべての項目に正の数値を入力してください。');
            return;
        }

        const quotes = await fetchRates();
        const rate = getPairRate(pair, quotes);

        const rows = runSimulation(pair, rate, initialFunds, leverage, pips, lotLimit, brokerType, quotes);

        // 結果表示
        document.getElementById('rate_info').innerHTML =
            `計算に使用した <strong>${pair}</strong> のレート ＝ ${rate.toFixed(2)}`;

        const tbody = document.getElementById('result_body');
        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>${r.day}日</td>
                <td>${formatLots(r.lots, brokerType)}</td>
                <td>${formatJpy(r.profit)}</td>
                <td>${formatJpy(r.funds)}</td>
            </tr>
        `).join('');

        document.getElementById('results').classList.remove('hidden');
        document.getElementById('results').scrollIntoView({ behavior: 'smooth' });

    } catch (e) {
        alert('エラーが発生しました: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '計算する';
    }
}
