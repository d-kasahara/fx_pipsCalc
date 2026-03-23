const API_KEY = '7c489c93947d3e1bd16d63b86906201d';

// ブローカー種別ごとの1枚あたりの通貨数
const BROKER_UNIT = {
    domestic: 10000,   // 国内: 1枚 = 1万通貨
    overseas: 100000,  // 海外: 1枚 = 10万通貨
};

// 貴金属ペアの仕様（ブローカー種別に関わらず固定）
const METAL_CONFIG = {
    XAUUSD: { unitSize: 100,  pipSize: 0.01  }, // 金: 1lot=100oz, 1pip=0.01USD
    XAGUSD: { unitSize: 5000, pipSize: 0.001 }, // 銀: 1lot=5000oz, 1pip=0.001USD
};

// USD建てレートを取得し、必要なクロスレートを返す
async function fetchRates() {
    try {
        const res = await fetch(
            `https://api.exchangerate.host/live?access_key=${API_KEY}&source=USD&currencies=JPY,EUR,GBP,AUD,NZD,XAU,XAG`
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
            USDXAU: 0.000377, // 金: 約2650 USD/oz
            USDXAG: 0.0333,   // 銀: 約30 USD/oz
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
        case 'XAUUSD': return 1 / quotes['USDXAU']; // 金価格 (USD/oz)
        case 'XAGUSD': return 1 / quotes['USDXAG']; // 銀価格 (USD/oz)
        default: return usdJpy;
    }
}

// 1単位あたりの利益(JPY)
// FX通貨ペア: 1pip あたりの利益
// 貴金属: 1USD変動あたりの利益
function unitProfitJpy(pair, unitSize, quotes) {
    const usdJpy = quotes['USDJPY'];
    const metal = METAL_CONFIG[pair];
    if (metal) {
        // 貴金属: $1変動 × ロットサイズ × USDJPY
        return metal.unitSize * usdJpy;
    }
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

// 枚数/ロット数を表示用にフォーマット
function formatLots(lots, brokerType) {
    if (brokerType === 'overseas') {
        return lots.toFixed(2) + ' lot';
    }
    return (lots % 1 === 0 ? lots.toFixed(0) : lots.toFixed(1)) + ' 枚';
}

// JPY金額をカンマ区切りフォーマット
function formatJpy(amount) {
    return '¥ ' + Math.round(amount).toLocaleString('ja-JP');
}

// 全損ライン（資金がゼロになる逆行幅）を計算
// FX: pips数、貴金属: USD変動幅
function calcBustLine(pair, rate, initialFunds, leverage, brokerType, quotes) {
    const metal = METAL_CONFIG[pair];
    const unitSize = metal ? metal.unitSize : BROKER_UNIT[brokerType];
    const floorFn = (metal || brokerType === 'overseas') ? floorHundredth : floorTenth;
    const usdJpy = quotes['USDJPY'];

    let lots;
    if (pair.endsWith('JPY')) {
        lots = floorFn(initialFunds * leverage / (rate * unitSize));
    } else {
        lots = floorFn(initialFunds * leverage / (rate * unitSize * usdJpy));
    }
    if (lots <= 0) return null;

    const profitPer = unitProfitJpy(pair, unitSize, quotes);
    // 資金 ÷ (枚数 × 1単位あたり利益) = 全損までの逆行幅
    return initialFunds / (lots * profitPer);
}

// シミュレーション実行(30日分)
function runSimulation(pair, rate, initialFunds, leverage, pips, lotLimit, brokerType, quotes) {
    const metal = METAL_CONFIG[pair];
    const unitSize = metal ? metal.unitSize : BROKER_UNIT[brokerType];
    const floorFn = (metal || brokerType === 'overseas') ? floorHundredth : floorTenth;
    const results = [];
    let funds = initialFunds;
    const profitPerUnit = unitProfitJpy(pair, unitSize, quotes);
    const usdJpy = quotes['USDJPY'];

    for (let day = 1; day <= 30; day++) {
        let lots;
        if (pair.endsWith('JPY')) {
            // 必要証拠金 = レート × 単位 / レバレッジ
            lots = floorFn(funds * leverage / (rate * unitSize));
        } else {
            // USD建て（貴金属含む）: JPY換算で証拠金計算
            lots = floorFn(funds * leverage / (rate * unitSize * usdJpy));
        }
        lots = Math.min(lots, lotLimit);

        // pips: FX通貨ペアはpips値、貴金属はUSD変動幅
        const profit = Math.round(lots * pips * profitPerUnit);
        funds = funds + profit;

        results.push({ day, lots, profit, funds });
    }

    return results;
}

// フォームの入力値をlocalStorageに保存
const STORAGE_KEY = 'fx_pipsCalc_form';
const FORM_FIELDS = ['currency_pair', 'initial_funds', 'leverage', 'pips', 'lot_limit'];

function saveFormValues() {
    const data = {};
    FORM_FIELDS.forEach(id => {
        data[id] = document.getElementById(id).value;
    });
    data.broker_type = document.querySelector('input[name="broker_type"]:checked').value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function restoreFormValues() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
        const data = JSON.parse(saved);
        FORM_FIELDS.forEach(id => {
            if (data[id] !== undefined) document.getElementById(id).value = data[id];
        });
        if (data.broker_type) {
            const radio = document.querySelector(`input[name="broker_type"][value="${data.broker_type}"]`);
            if (radio) radio.checked = true;
        }
    } catch (e) {
        // 保存データが壊れていたら無視
    }
}

// ブローカー変更時に枚数/lot表記を切り替え
function updateBrokerLabels() {
    const brokerType = document.querySelector('input[name="broker_type"]:checked').value;
    const isOverseas = brokerType === 'overseas';
    document.getElementById('lot_limit_label').textContent = isOverseas ? 'lot上限' : '枚数上限';
    document.getElementById('lot_limit_unit').textContent = isOverseas ? 'lot' : '枚';
    document.getElementById('lots_header').textContent = isOverseas ? 'lot数' : '枚数';
}

// 通貨ペア変更時に単位ラベルを切り替え
function updatePipsLabel() {
    const pair = document.getElementById('currency_pair').value;
    const unitEl = document.getElementById('pips_unit');
    const input = document.getElementById('pips');
    if (METAL_CONFIG[pair]) {
        unitEl.textContent = 'USD';
        input.placeholder = '5';
        input.step = '0.1';
    } else {
        unitEl.textContent = 'pips';
        input.placeholder = '10';
        input.step = '0.1';
    }
}

// ページ読み込み時に復元、入力変更時に保存
document.addEventListener('DOMContentLoaded', () => {
    restoreFormValues();
    updatePipsLabel();
    updateBrokerLabels();
    FORM_FIELDS.forEach(id => {
        document.getElementById(id).addEventListener('input', saveFormValues);
    });
    document.getElementById('currency_pair').addEventListener('change', updatePipsLabel);
    document.querySelectorAll('input[name="broker_type"]').forEach(radio => {
        radio.addEventListener('change', () => {
            saveFormValues();
            updateBrokerLabels();
        });
    });
});

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

        // 全損ライン表示
        const bustLine = calcBustLine(pair, rate, initialFunds, leverage, brokerType, quotes);
        const bustEl = document.getElementById('bust_line');
        if (bustLine !== null) {
            const isMetal = !!METAL_CONFIG[pair];
            const unitLabel = isMetal ? 'USD' : 'pips';
            const bustValue = isMetal ? bustLine.toFixed(2) : bustLine.toFixed(1);
            bustEl.innerHTML = `⚠ 全損ライン: 約 <strong>${bustValue} ${unitLabel}</strong> 逆行で資金消失`;
        } else {
            bustEl.innerHTML = '';
        }

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

    } catch (e) {
        alert('エラーが発生しました: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '計算する';
    }
}
