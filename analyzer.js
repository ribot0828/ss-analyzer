/**
 * SS-Analyzer Ultimate v3.0 | アルティメット統合・解析・シミュレーター
 * Core Logic (analyzer.js)
 */

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const dropzone = document.getElementById('dropzone');
    const fileList = document.getElementById('file-list');
    const integrateBtn = document.getElementById('integrateBtn');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const mainAnalysisView = document.getElementById('main-analysis-view');
    const riskDashboard = document.getElementById('risk-dashboard');
    const analysisResultArea = document.getElementById('analysisResultArea');
    const simulatorResultArea = document.getElementById('simulatorResultArea');
    const simChartContainer = document.getElementById('simChartContainer');
    const outlierResultArea = document.getElementById('outlierResultArea');
    const geminiOutput = document.getElementById('geminiOutput');
    const geminiExportSection = document.getElementById('geminiExportSection');
    const copyBtn = document.getElementById('copyBtn');
    const toast = document.getElementById('toast');
    const runSimulatorBtn = document.getElementById('runSimulatorBtn');

    // Filters
    const filterVenue = document.getElementById('filter-venue');
    const filterSurface = document.getElementById('filter-surface');
    const filterCondition = document.getElementById('filter-condition');
    const filterDistCat = document.getElementById('filter-dist-cat');

    // State
    let allData = new Map(); 
    let filteredData = [];
    let equityChartInstance = null;
    let simChartInstance = null;
    let availableClasses = [];

    const EXPECTED_HEADERS = [
        "日付", "レース名", "コース詳細", "グレード・頭数", "馬番", "馬名", "購入時人気", "購入時オッズ", 
        "評価", "購入時期待値", "購入時クラス", "最終確定人気", "最終確定オッズ", "最終確定期待値", 
        "最終確定クラス", "着順", "MAO", "実行フラグ", "単勝払戻", "ワイド払戻", "三連複払戻"
    ];

    // --- Data Pre-processing ---
    function parseCourseDetail(detail) {
        if (!detail) return { venue: "-", surface: "-", distance: 0, distCat: "other", condition: "-" };
        
        // Regex pattern for Venue, Surface, Distance, and Condition
        // Example: "中山芝1600外C 良", "東京ダ1400 稍重"
        const regex = /^(?<venue>[^芝ダ障]+)(?<surface>芝|ダ|障)(?<distance>\d+)(?<rest>[^ ]*)( +(?<condition>良|稍重|重|不良))?/;
        const match = detail.match(regex);
        
        if (!match) return { venue: detail.substring(0,2), surface: "-", distance: 0, distCat: "other", condition: "-" };
        
        const g = match.groups;
        const dist = parseInt(g.distance);
        let distCat = "other";
        if (dist <= 1400) distCat = "short";
        else if (dist <= 1800) distCat = "mile";
        else if (dist <= 2200) distCat = "middle";
        else distCat = "long";

        return {
            venue: g.venue,
            surface: g.surface,
            distance: dist,
            distCat: distCat,
            condition: g.condition || "-"
        };
    }

    // --- File Handling ---
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('dragover'); });
    dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
    dropzone.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file'; input.multiple = true; input.accept = '.csv';
        input.onchange = (e) => handleFiles(e.target.files);
        input.click();
    });

    async function handleFiles(files) {
        showToast("読み込み中...");
        for (const file of files) {
            if (file.name.endsWith('.csv')) {
                const results = await parseCSV(file);
                processRows(results.data);
                addFileBadge(file.name, results.data.length);
            }
        }
        populateFilters();
        updateControlPanel();
        showToast("ロード完了");
    }

    function parseCSV(file) {
        return new Promise((resolve) => {
            Papa.parse(file, { header: true, skipEmptyLines: true, complete: (results) => resolve(results) });
        });
    }

    function processRows(rows) {
        rows.forEach(row => {
            const normalizedRow = detectAndMapLegacy(row);
            if (!normalizedRow["レース名"] || !normalizedRow["馬番"]) return;
            
            // Add custom extracted fields
            const ctx = parseCourseDetail(normalizedRow["コース詳細"]);
            Object.assign(normalizedRow, ctx);

            const raceId = getRaceId(normalizedRow);
            const uniqueKey = `${raceId}_${normalizedRow["馬番"]}`;
            allData.set(uniqueKey, normalizedRow);
        });
    }

    function detectAndMapLegacy(row) {
        const isLegacy = row["実際オッズ"] !== undefined || row["最終詳細クラス"] !== undefined;
        if (!isLegacy) return row;
        const mapped = {};
        mapped["日付"] = row["日付"] || "Legacy";
        mapped["レース名"] = row["レース名"];
        mapped["コース詳細"] = row["コース詳細(開催場も含めた)"] || row["コース詳細"] || "";
        mapped["グレード・頭数"] = row["レースグレード"] || "-";
        mapped["馬番"] = row["馬番"];
        mapped["馬名"] = row["馬名"];
        mapped["購入時人気"] = "-";
        mapped["購入時オッズ"] = row["実際オッズ"];
        mapped["評価"] = row["評価"];
        mapped["購入時期待値"] = row["期待値"];
        mapped["購入時クラス"] = row["最終詳細クラス"];
        mapped["最終確定人気"] = "-";
        mapped["最終確定オッズ"] = row["実際オッズ"];
        mapped["最終確定期待値"] = row["期待値"];
        mapped["最終確定クラス"] = row["最終詳細クラス"];
        mapped["着順"] = row["着順"];
        mapped["MAO"] = "-";
        mapped["実行フラグ"] = "-";
        mapped["単勝払戻"] = row["単勝払戻"] || "";
        mapped["ワイド払戻"] = row["ワイド払戻"] || "";
        mapped["三連複払戻"] = row["三連複払戻"] || "";
        return mapped;
    }

    function getRaceId(row) {
        return `${row["日付"]}_${row["レース名"]}_${row["コース詳細"]}`;
    }

    function addFileBadge(name, count) {
        const badge = document.createElement('div');
        badge.className = 'status-badge status-info text-xs';
        badge.textContent = `📁 ${name} (${count})`;
        fileList.appendChild(badge);
    }

    function populateFilters() {
        const data = Array.from(allData.values());
        const venues = [...new Set(data.map(d => d.venue))].filter(v => v && v !== "-").sort();
        const conditions = [...new Set(data.map(d => d.condition))].filter(c => c && c !== "-").sort();
        availableClasses = [...new Set(data.map(d => d["最終確定クラス"] || d["購入時クラス"]))].filter(c => c).sort();

        updateSelect(filterVenue, venues);
        updateSelect(filterCondition, conditions);
        populateSimulatorClasses();
    }

    function updateSelect(el, items) {
        const current = el.value;
        el.innerHTML = '<option value="all">すべて</option>';
        items.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item; opt.textContent = item;
            el.appendChild(opt);
        });
        el.value = current;
    }

    function populateSimulatorClasses() {
        const containers = ['sim-row1-classes', 'sim-row2-classes', 'sim-row3-classes'];
        containers.forEach(cid => {
            const container = document.getElementById(cid);
            container.innerHTML = '';
            availableClasses.forEach(c => {
                const label = document.createElement('label');
                label.className = 'flex items-center gap-1 cursor-pointer hover:text-blue-400';
                label.innerHTML = `<input type="checkbox" value="${c}" class="rounded bg-slate-800 border-slate-700"> ${c}`;
                container.appendChild(label);
            });
        });
    }

    function updateControlPanel() {
        if (allData.size > 0) {
            integrateBtn.disabled = false;
            analyzeBtn.disabled = false;
            document.getElementById('data-status-badge').textContent = `${allData.size}件ロード済`;
            document.getElementById('data-status-badge').className = 'status-badge bg-green-900 text-green-300';
        }
    }

    // --- Filtering Engine ---
    function applyFilters() {
        const v = filterVenue.value;
        const s = filterSurface.value;
        const c = filterCondition.value;
        const d = filterDistCat.value;

        filteredData = Array.from(allData.values()).filter(row => {
            if (v !== 'all' && row.venue !== v) return false;
            if (s !== 'all' && row.surface !== s) return false;
            if (c !== 'all' && row.condition !== c) return false;
            if (d !== 'all' && row.distCat !== d) return false;
            return true;
        });

        if (filteredData.length > 0) {
            performFullAnalysis();
        }
    }

    [filterVenue, filterSurface, filterCondition, filterDistCat].forEach(el => {
        el.addEventListener('change', applyFilters);
    });

    // --- Analysis ---
    analyzeBtn.addEventListener('click', () => {
        applyFilters();
        mainAnalysisView.classList.remove('hidden');
        riskDashboard.classList.remove('hidden');
        geminiExportSection.classList.remove('hidden');
    });

    function performFullAnalysis() {
        // Result table, Charts, Risk, Outliers
        const rowsWithRank = filteredData.filter(d => d["着順"] && d["着順"].trim() !== "");
        
        // 1. Risk Stats
        const riskStats = calculateRiskMetrics(rowsWithRank);
        renderRiskDashboard(riskStats);

        // 2. Class Statistics
        const classStats = calculateClassStats(rowsWithRank);
        renderClassTable(classStats);

        // 3. Equity Curve
        drawEquityCurve(rowsWithRank);

        // 4. Outliers
        const outliers = detectOutliers(rowsWithRank);
        renderOutliers(outliers);

        // 5. Build Markdown
        const md = generateUltimateMarkdown(riskStats, classStats, outliers);
        geminiOutput.value = md;
    }

    function calculateRiskMetrics(data) {
        const raceIds = [...new Set(data.map(d => getRaceId(d)))];
        const sortedData = [...data].sort((a,b) => getRaceId(a).localeCompare(getRaceId(b)));
        
        let cumulative = 0;
        let peak = 0;
        let maxDD = 0;
        let totalInvest = data.length * 100;
        let totalReturn = 0;
        let clvTotal = 0;
        let clvCount = 0;

        sortedData.forEach(r => {
            const invest = 100;
            let p = 0;
            if (parseInt(r["着順"]) === 1) p = (parseFloat(r["最終確定オッズ"]) || 0) * 100;
            totalReturn += p;
            cumulative += (p - invest);
            if (cumulative > peak) peak = cumulative;
            const dd = peak - cumulative;
            if (dd > maxDD) maxDD = dd;

            const fo = parseFloat(r["最終確定オッズ"]);
            const po = parseFloat(r["購入時オッズ"]) || fo;
            if (fo > 0) { clvTotal += (po / fo); clvCount++; }
        });

        return {
            raceCount: raceIds.size || new Set(data.map(d => getRaceId(d))).size,
            horseCount: data.length,
            roi: (totalReturn / totalInvest) * 100,
            mdd: maxDD,
            mddRate: totalInvest > 0 ? (maxDD / totalInvest) * 100 : 0,
            avgClv: clvCount > 0 ? clvTotal / clvCount : 1.0
        };
    }

    function calculateKelly(winRate, avgOdds) {
        const p = winRate / 100;
        const b = avgOdds - 1;
        if (b <= 0) return 0;
        const q = 1 - p;
        const f = (b * p - q) / b;
        return Math.max(0, f * 100);
    }

    function calculateClassStats(data) {
        const groups = {};
        data.forEach(r => {
            const cls = r["最終確定クラス"] || r["購入時クラス"] || "不明";
            if (!groups[cls]) groups[cls] = [];
            groups[cls].push(r);
        });

        return Object.keys(groups).sort().map(cls => {
            const rows = groups[cls];
            const sample = rows.length;
            const wins = rows.filter(r => parseInt(r["着順"]) === 1).length;
            const top3 = rows.filter(r => parseInt(r["着順"]) <= 3).length;
            const returns = rows.reduce((acc, r) => acc + (parseInt(r["着順"]) === 1 ? (parseFloat(r["最終確定オッズ"]) * 100) : 0), 0);
            const oddsSum = rows.reduce((acc, r) => acc + (parseFloat(r["最終確定オッズ"]) || 0), 0);
            const avgOdds = oddsSum / sample;
            
            const roi = (returns / (sample * 100)) * 100;
            const winRate = (wins / sample) * 100;
            const kelly = calculateKelly(winRate, avgOdds);

            return {
                cls, sample, 
                winRate, 
                top3Rate: (top3 / sample) * 100, 
                roi, 
                avgEv: rows.reduce((acc, r) => acc + (parseFloat(r["最終確定期待値"]) || 0), 0) / sample,
                kelly
            };
        });
    }

    function detectOutliers(data) {
        return data.filter(r => {
            const ev = parseFloat(r["購入時期待値"]) || 0;
            const rank = parseInt(r["着順"]) || 99;
            return (ev >= 2.0 && rank >= 10) || (ev <= 0.5 && rank === 1);
        });
    }

    function renderRiskDashboard(s) {
        document.getElementById('stat-race-count').textContent = s.raceCount;
        document.getElementById('stat-overall-roi').textContent = `${s.roi.toFixed(1)}%`;
        document.getElementById('stat-mdd').textContent = `-${s.mdd.toLocaleString()}円 (${s.mddRate.toFixed(1)}%)`;
        document.getElementById('stat-avg-clv').textContent = s.avgClv.toFixed(3);
    }

    function renderClassTable(stats) {
        let html = `
            <div class="overflow-x-auto">
                <table class="analysis-table w-full text-sm">
                    <thead>
                        <tr>
                            <th>クラス</th>
                            <th>頭数</th>
                            <th>的中率</th>
                            <th>複勝率</th>
                            <th>回収率</th>
                            <th>平均EV</th>
                            <th class="text-orange-400">Kelly推薦%</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stats.map(s => `
                            <tr>
                                <td class="font-bold">${s.sample >= 30 ? '✅' : '⚠️'} ${s.cls}</td>
                                <td>${s.sample}</td>
                                <td>${s.winRate.toFixed(1)}%</td>
                                <td>${s.top3Rate.toFixed(1)}%</td>
                                <td class="${s.roi >= 100 ? 'text-green-400 font-bold' : ''}">${s.roi.toFixed(1)}%</td>
                                <td>${s.avgEv.toFixed(3)}</td>
                                <td class="font-bold ${s.kelly > 5 ? 'text-orange-400' : ''}">${s.kelly.toFixed(1)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        analysisResultArea.innerHTML = html;
    }

    function renderOutliers(list) {
        if (list.length === 0) {
            outlierResultArea.innerHTML = '<p class="text-slate-500 py-4">現在、条件（EV2.0以上で大敗、またはEV0.5以下で的中）に合致する異常値はありません。</p>';
            return;
        }
        let html = `
            <table class="analysis-table w-full text-xs">
                <thead><tr><th>日付</th><th>レース名</th><th>馬名</th><th>EV</th><th>オッズ</th><th>着順</th></tr></thead>
                <tbody>
                    ${list.map(r => `
                        <tr>
                            <td>${r["日付"]}</td>
                            <td>${r["レース名"]}</td>
                            <td class="font-bold text-red-300">${r["馬名"]}</td>
                            <td>${parseFloat(r["購入時期待値"]).toFixed(2)}</td>
                            <td>${parseFloat(r["購入時オッズ"]).toFixed(1)}</td>
                            <td class="font-bold">${r["着順"]}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        outlierResultArea.innerHTML = html;
    }

    // --- Charting ---
    function drawEquityCurve(data) {
        const sorted = [...data].sort((a,b) => getRaceId(a).localeCompare(getRaceId(b)));
        const labels = [];
        const expData = [];
        const actData = [];
        let cumExp = 0; let cumAct = 0;

        const raceMap = {};
        sorted.forEach(r => { const id = getRaceId(r); if (!raceMap[id]) raceMap[id] = []; raceMap[id].push(r); });

        Object.keys(raceMap).forEach((id, idx) => {
            const rows = raceMap[id];
            rows.forEach(r => {
                cumExp += (parseFloat(r["最終確定期待値"]) || 0) * 100;
                if (parseInt(r["着順"]) === 1) cumAct += (parseFloat(r["最終確定オッズ"]) || 0) * 100;
            });
            labels.push(`R${idx+1}`);
            expData.push(cumExp);
            actData.push(cumAct);
        });

        if (equityChartInstance) equityChartInstance.destroy();
        equityChartInstance = new Chart(document.getElementById('equityChart').getContext('2d'), {
            type: 'line',
            data: { labels, datasets: [
                { label: '期待払戻(理論)', data: expData, borderColor: '#3b82f6', tension: 0.1, pointRadius: 0 },
                { label: '実績払戻', data: actData, borderColor: '#10b981', tension: 0.1, pointRadius: 0 }
            ]},
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#fff' } } }, scales: { x:{display:false}, y:{grid:{color:'#334155'}, ticks:{color:'#94a3b8'}} } }
        });
    }

    // --- Simulator (Trio Backtest) ---
    runSimulatorBtn.addEventListener('click', () => {
        const r1 = Array.from(document.querySelectorAll('#sim-row1-classes input:checked')).map(i => i.value);
        const r2 = Array.from(document.querySelectorAll('#sim-row2-classes input:checked')).map(i => i.value);
        const r3 = Array.from(document.querySelectorAll('#sim-row3-classes input:checked')).map(i => i.value);

        if (r1.length === 0 || r2.length === 0 || r3.length === 0) {
            alert("1〜3列目の各列に1つ以上のクラスを選択してください。");
            return;
        }

        runSimulation(r1, r2, r3);
    });

    function runSimulation(r1, r2, r3) {
        const rowsByRace = {};
        filteredData.forEach(r => { const id = getRaceId(r); if (!rowsByRace[id]) rowsByRace[id] = []; rowsByRace[id].push(r); });

        let totalBets = 0;
        let totalReturn = 0;
        let hits = 0;
        const equity = [];
        let cumBalance = 0;

        Object.keys(rowsByRace).sort().forEach(id => {
            const horses = rowsByRace[id];
            const set1 = horses.filter(h => r1.includes(h["最終確定クラス"] || h["購入時クラス"])).map(h => h["馬番"]);
            const set2 = horses.filter(h => r2.includes(h["最終確定クラス"] || h["購入時クラス"])).map(h => h["馬番"]);
            const set3 = horses.filter(h => r3.includes(h["最終確定クラス"] || h["購入時クラス"])).map(h => h["馬番"]);

            // Combinations calculation
            const combos = [];
            set1.forEach(h1 => {
                set2.forEach(h2 => {
                    if (h2 === h1) return;
                    set3.forEach(h3 => {
                        if (h3 === h1 || h3 === h2) return;
                        // Unique set representing a trio
                        const trio = [parseInt(h1), parseInt(h2), parseInt(h3)].sort((a,b) => a-b).join('-');
                        if (!combos.includes(trio)) combos.push(trio);
                    });
                });
            });

            const raceBets = combos.length;
            totalBets += raceBets;
            
            // Check Hit
            const winners = horses.filter(h => parseInt(h["着順"]) <= 3).map(h => parseInt(h["馬番"])).sort((a,b) => a-b);
            let raceReturn = 0;
            if (winners.length === 3) {
                const winningTrio = winners.join('-');
                if (combos.includes(winningTrio)) {
                    hits++;
                    // Find actual payout (from any row of the race, since it's race-based)
                    raceReturn = (parseFloat(horses[0]["三連複払戻"]) || 0);
                    totalReturn += raceReturn;
                }
            }
            cumBalance += (raceReturn - (raceBets * 100));
            equity.push(cumBalance);
        });

        const roi = totalBets > 0 ? (totalReturn / (totalBets * 100)) * 100 : 0;
        renderSimResults(totalBets, totalReturn, hits, roi, equity);
    }

    function renderSimResults(bets, returns, hits, roi, equity) {
        simulatorResultArea.innerHTML = `
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                <div class="p-4 bg-slate-800 rounded">
                    <p class="text-xs text-slate-400">仮想投資額</p>
                    <p class="text-lg font-bold">${(bets * 100).toLocaleString()}円</p>
                </div>
                <div class="p-4 bg-slate-800 rounded">
                    <p class="text-xs text-slate-400">仮想払戻額</p>
                    <p class="text-lg font-bold text-green-400">${returns.toLocaleString()}円</p>
                </div>
                <div class="p-4 bg-slate-800 rounded">
                    <p class="text-xs text-slate-400">仮想回収率</p>
                    <p class="text-xl font-bold ${roi >= 100 ? 'text-green-400' : 'text-red-400'}">${roi.toFixed(1)}%</p>
                </div>
                <div class="p-4 bg-slate-800 rounded">
                    <p class="text-xs text-slate-400">的中数</p>
                    <p class="text-lg font-bold">${hits}件</p>
                </div>
            </div>
        `;
        simulatorResultArea.classList.remove('hidden');
        simChartContainer.classList.remove('hidden');
        drawSimChart(equity);
    }

    function drawSimChart(data) {
        if (simChartInstance) simChartInstance.destroy();
        simChartInstance = new Chart(document.getElementById('simChart').getContext('2d'), {
            type: 'line',
            data: { labels: data.map((_,i) => i), datasets: [
                { label: '仮想累積収支', data: data, borderColor: '#f97316', backgroundColor: 'rgba(249, 115, 22, 0.1)', fill: true, tension: 0.1, pointRadius: 0 }
            ]},
            options: { responsive: true, maintainAspectRatio: false, plugins:{legend:{labels:{color:'#fff'}}}, scales:{x:{display:false}, y:{grid:{color:'#334155'}, ticks:{color:'#94a3b8'}}}}
        });
    }

    // --- Markdown Export ---
    function generateUltimateMarkdown(risk, stats, outliers) {
        let md = `# SS-Analyzer Ultimate 解析レポート\n\n`;
        md += `## 1. リスク・収支ダッシュボード\n`;
        md += `- 全体回収率: **${risk.roi.toFixed(1)}%**\n`;
        md += `- 最大ドローダウン: **-${risk.mdd.toLocaleString()}円 (${risk.mddRate.toFixed(1)}%)**\n`;
        md += `- 平均CLV: **${risk.avgClv.toFixed(3)}**\n`;
        md += `- 対象レース数: ${risk.raceCount} / 馬頭数: ${risk.horseCount}\n\n`;

        md += `## 2. クラス別詳細レポート (Kelly推奨率)\n`;
        md += `| クラス | サンプル | 的中率 | 回収率 | EV | Kelly% |\n|---|---|---|---|---|---|\n`;
        stats.forEach(s => {
            md += `| ${s.cls} | ${s.sample} | ${s.winRate.toFixed(1)}% | ${s.roi.toFixed(1)}% | ${s.avgEv.toFixed(3)} | **${s.kelly.toFixed(1)}%** |\n`;
        });

        md += `\n## 3. 異常値（Outlier）分析リスト\n`;
        if (outliers.length > 0) {
            md += `| 日付 | レース | 馬名 | EV | 着順 |\n|---|---|---|---|---|\n`;
            outliers.slice(0, 10).forEach(o => {
                md += `| ${o["日付"]} | ${o["レース名"]} | ${o["馬名"]} | ${parseFloat(o["購入時期待値"]).toFixed(2)} | **${o["着順"]}** |\n`;
            });
            if (outliers.length > 10) md += `*他 ${outliers.length - 10} 件の異常値を検出*\n`;
        } else {
            md += `*顕著な異常値は検出されませんでした。*\n`;
        }

        md += `\n---\n### ✨ Gemini 3 解析プロンプト\n`;
        md += `上記の「リスク管理指標」と「異常値リスト」に基づき、以下の点を詳細に分析してください。\n`;
        md += `1. 回収率を上げるために除外すべきクラス、または特定の環境条件（会場・距離）は存在するか。\n`;
        md += `2. 異常値リストに共通する特徴（例：特定の会場での期待値暴落、あるいはMAOフィルターの漏れ）を特定してください。\n`;
        md += `3. 最大ドローダウンを 10% 以下に抑えつつ、利益を最大化するための資金配分（ケリー基準の調整案）を提案してください。`;

        return md;
    }

    // --- Others ---
    integrateBtn.addEventListener('click', () => {
        const sortedData = Array.from(allData.values()).sort((a,b) => a["日付"].localeCompare(b["日付"]));
        const csv = Papa.unparse(sortedData);
        const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `SS_Ultimate_Integrated.csv`;
        link.click();
    });

    copyBtn.addEventListener('click', () => {
        geminiOutput.select();
        document.execCommand('copy');
        showToast("コピーしました");
    });

    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
});
