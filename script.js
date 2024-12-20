async function fetchExchangeRates(baseCurrency) {
    const API_KEY = '7c489c93947d3e1bd16d63b86906201d'; // あなたのAPIキー
    try {
        const response = await fetch(`http://api.exchangerate.host/live?access_key=${API_KEY}&source=USD&currencies=JPY,EUR`);
        if (!response.ok) {
            throw new Error('為替レートの取得に失敗しました');
        }
        const data = await response.json();
        console.log("API response:", data);

        if (!data.quotes || !data.quotes['USDJPY'] || !data.quotes['USDEUR']) {
            throw new Error('為替レートデータが不足しています');
        }

        return {
            usdJpyRate: data.quotes['USDJPY'],
            usdEurRate: data.quotes['USDEUR']
        };
    } catch (error) {
        alert(error.message);
        return null;
    }
}


async function calculateProfit() {
    try {
        const currencyPair = document.getElementById('currency_pair').value;
        const initialFunds = parseFloat(document.getElementById('initial_funds').value);
        const leverage = parseInt(document.getElementById('leverage').value);
        const pips = parseInt(document.getElementById('pips').value);
        const lotLimit = parseInt(document.getElementById('lot_limit').value);
        const lotPerCurrency = parseInt(document.getElementById('lot_per_currency').value);

        const rates = await fetchExchangeRates('USD');
        if (!rates) return;

        const usdJpyRate = rates.usdJpyRate;
        const usdEurRate = rates.usdEurRate;

        if (isNaN(usdJpyRate) || isNaN(usdEurRate)) {
            alert('有効な為替レートを取得できませんでした。');
            return;
        }

        // ドル建ての取引量を計算
        const tradingVolume = (initialFunds * leverage) / usdJpyRate;

        // 初回ロット数を計算
        const initialLot = Math.min(tradingVolume / lotPerCurrency, lotLimit);

        // 利益額 (JPY) を計算
        let profit;
        if (currencyPair === "USDJPY") {
            profit = pips * 0.01 * initialLot * lotPerCurrency; // 円が絡む場合
        } else if (currencyPair === "EURUSD") {
            // EURUSDをUSDJPYでJPY換算
            const jpyProfitPerPip = 0.0001 * lotPerCurrency * usdJpyRate;
            profit = pips * initialLot * jpyProfitPerPip;
        } else {
            profit = pips * 0.0001 * initialLot * lotPerCurrency * usdJpyRate; // その他通貨ペア
        }

        // 結果を表示
        document.getElementById('trading_volume').innerText = `取引量 (USD): ${tradingVolume.toFixed(2)}`;
        document.getElementById('initial_lot').innerText = `初回ロット: ${initialLot.toFixed(2)}`;
        document.getElementById('profit').innerText = `利益額 (JPY): ${profit.toFixed(2)}`;
    } catch (error) {
        alert(error.message);
    }
}
