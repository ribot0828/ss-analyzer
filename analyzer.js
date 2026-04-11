/**
 * SS-Analyzer | 高度統合・解析システム
 * Core Logic (analyzer.js)
 * v2.0 - Advanced Metrics & Visualization
 */

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const dropzone = document.getElementById('dropzone');
    const fileList = document.getElementById('file-list');
    const btnIntegrate = document.getElementById('btn-integrate');
    const btnAnalyze = document.getElementById('btn-analyze');
    const analysisView = document.getElementById('analysis-view');
    const analysisTbody = document.getElementById('analysis-tbody');
    const maoTbody = document.getElementById('mao-tbody');
    const analysisSummary = document.getElementById('analysis-summary');
    const geminiExport = document.getElementById('gemini-export');
    const markdownOutput = document.getElementById('markdown-output');
    const btnCopyMarkdown = document.getElementById('btn-copy-markdown');
    const toast = document.getElementById('toast');

    let allData = new Map(); 
    let equityChartInstance = null;
    
    const EXPECTED_HEADERS = [
        "日付", "レース名", "コース詳細", "グレード・頭数", "馬番", "馬名", "購入時人気", "購入時オッズ", 
        "評価", "購入時期待値", "購入時クラス", "最終確定人気", "最終確定オッズ", "最終確定期待値", 
        "最終確定クラス", "着順", "MAO", "実行フラグ", "単勝払戻", "ワイド払戻", "三連複払戻"
    ];

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
        for (const file of files) {
            if (file.name.endsWith('.csv')) {
                const results = await parseCSV(file);
                processRows(results.data);
                addFileBadge(file.name, results.data.length);
            }
        }
        updateControlPanel();
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
        mapped["コース詳細"] = row["コース詳細(開催場も含めた)"] || row["コース詳細"];
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
        mapped["単勝払戻"] = row["単勝払戻"];
        mapped["ワイド払戻"] = row["ワイド払戻"];
        mapped["三連複払戻"] = row["三連複払戻"];
        return mapped;
    }

    function getRaceId(row) {
        const date = row["日付"];
        const name = row["レース名"];
        const course = row["コース詳細"];
        if (!date || date === "Legacy") return `${name}_${course}`;
        return `${date}_${name}_${course}`;
    }

    function addFileBadge(name, count) {
        const badge = document.createElement('div');
        badge.className = 'status-badge status-info text-xs';
        badge.textContent = `📁 ${name} (${count}頭)`;
        fileList.appendChild(badge);
    }

    function updateControlPanel() {
        if (allData.size > 0) { btnIntegrate.disabled = false; btnAnalyze.disabled = false; }
    }

    // --- Integration ---
    btnIntegrate.addEventListener('click', () => {
        const sortedData = Array.from(allData.values()).sort((a, b) => {
            if (a["日付"] !== b["日付"]) return a["日付"].localeCompare(b["日付"]);
            if (a["レース名"] !== b["レース名"]) return a["レース名"].localeCompare(b["レース名"]);
            return parseInt(a["馬番"]) - parseInt(b["馬番"]);
        });
        const outputRows = [];
        let lastRaceId = "";
        sortedData.forEach(row => {
            const currentRaceId = getRaceId(row);
            if (lastRaceId !== "" && lastRaceId !== currentRaceId) outputRows.push(Array(EXPECTED_HEADERS.length).fill(""));
            outputRows.push(EXPECTED_HEADERS.map(h => row[h] || ""));
            lastRaceId = currentRaceId;
        });
        const csvContent = Papa.unparse({ fields: EXPECTED_HEADERS, data: outputRows });
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `SS_Integrated_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
    });

    // --- Analysis Logic ---
    btnAnalyze.addEventListener('click', () => {
        const data = Array.from(allData.values()).filter(d => d["着順"] && d["着順"].trim() !== "");
        if (data.length === 0) { alert("結果(着順)が入力されたデータがありません。"); return; }

        // 1. 全体サマリー計算
        const totalSummary = calculateOverall(data);
        renderSummaryHeader(totalSummary);

        // 2. クラス別解析 (信頼性・CLV・スコア含む)
        const classStats = calculateClassStats(data);
        renderClassTable(classStats);

        // 3. MAO解析
        const maoStats = calculateMaoStats(data);
        renderMaoTable(maoStats);

        // 4. Equity Curve 描画
        drawEquityCurve(data);

        // 5. Geminiサマリー生成
        const md = generateMarkdown(totalSummary, classStats, maoStats);
        markdownOutput.value = md;

        // UI Feedback & Auto-copy
        analysisView.classList.remove('hidden');
        geminiExport.classList.remove('hidden');
        copyToClipboard(md);
        showToast();
    });

    function calculateOverall(data) {
        const raceCount = new Set(data.map(d => getRaceId(d))).size;
        const horseCount = data.length;
        const totalInvest = horseCount * 100;
        const totalReturn = data.reduce((acc, row) => acc + (parseInt(row["着順"]) === 1 ? (parseFloat(row["最終確定オッズ"]) * 100) : 0), 0);
        return { raceCount, horseCount, roi: (totalReturn / totalInvest) * 100 };
    }

    function calculateClassStats(data) {
        const groups = {};
        data.forEach(row => {
            const cls = row["最終確定クラス"] || row["購入時クラス"] || "不明";
            if (!groups[cls]) groups[cls] = [];
            groups[cls].push(row);
        });

        return Object.keys(groups).sort().map(cls => {
            const rows = groups[cls];
            const sample = rows.length;
            const wins = rows.filter(r => parseInt(r["着順"]) === 1).length;
            const top3 = rows.filter(r => parseInt(r["着順"]) <= 3).length;
            
            let totalReturn = 0;
            let totalClv = 0;
            rows.forEach(r => {
                const finalOdds = parseFloat(r["最終確定オッズ"]) || 0;
                const purchaseOdds = parseFloat(r["購入時オッズ"]) || finalOdds;
                if (parseInt(r["着順"]) === 1) totalReturn += (finalOdds * 100);
                if (finalOdds > 0) totalClv += (purchaseOdds / finalOdds);
            });

            const roi = (totalReturn / (sample * 100)) * 100;
            const clv = totalClv / sample;
            const avgEv = rows.reduce((acc, r) => acc + (parseFloat(r["最終確定期待値"]) || 0), 0) / sample;

            return { cls, sample, winRate: (wins / sample) * 100, top3Rate: (top3 / sample) * 100, roi, avgEv, clv };
        });
    }

    function calculateMaoStats(data) {
        const maoGroups = { "○": [], "×": [] };
        data.forEach(row => {
            const flag = row["実行フラグ"];
            if (maoGroups[flag]) maoGroups[flag].push(row);
        });

        return Object.keys(maoGroups).map(flag => {
            const rows = maoGroups[flag];
            const sample = rows.length;
            if (sample === 0) return null;
            const wins = rows.filter(r => parseInt(r["着順"]) === 1).length;
            const top3 = rows.filter(r => parseInt(r["着順"]) <= 3).length;
            const totalReturn = rows.reduce((acc, r) => acc + (parseInt(r["着順"]) === 1 ? (parseFloat(r["最終確定オッズ"]) * 100) : 0), 0);
            return { flag, sample, winRate: (wins / sample) * 100, top3Rate: (top3 / sample) * 100, roi: (totalReturn / (sample * 100)) * 100, avgEv: rows.reduce((acc, r) => acc + (parseFloat(r["最終確定期待値"]) || 0), 0) / sample };
        }).filter(s => s !== null);
    }

    function renderSummaryHeader(s) {
        analysisSummary.innerHTML = `
            <div class="glass-panel text-center p-4">
                <p class="text-sm text-slate-400">総レース数</p>
                <p class="text-2xl font-bold">${s.raceCount}</p>
            </div>
            <div class="glass-panel text-center p-4">
                <p class="text-sm text-slate-400">対象馬数</p>
                <p class="text-2xl font-bold">${s.horseCount}</p>
            </div>
            <div class="glass-panel text-center p-4">
                <p class="text-sm text-slate-400">全体単勝回収率</p>
                <p class="text-2xl font-bold ${s.roi >= 100 ? 'text-green-400' : 'text-red-400'}">${s.roi.toFixed(1)}%</p>
            </div>
        `;
    }

    function renderClassTable(stats) {
        analysisTbody.innerHTML = '';
        stats.forEach(s => {
            const reliability = s.sample >= 30 ? '✅' : '⚠️';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-bold">${reliability} ${s.cls}</td>
                <td>${s.sample}</td>
                <td>${s.winRate.toFixed(1)}%</td>
                <td>${s.top3Rate.toFixed(1)}%</td>
                <td class="${s.roi >= 100 ? 'text-green-400 font-bold' : ''}">${s.roi.toFixed(1)}%</td>
                <td class="${s.clv >= 1.05 ? 'text-blue-400' : ''}">${s.clv.toFixed(2)}</td>
                <td>${s.avgEv.toFixed(3)}</td>
            `;
            analysisTbody.appendChild(tr);
        });
    }

    function renderMaoTable(stats) {
        maoTbody.innerHTML = '';
        stats.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-bold ${s.flag === '○' ? 'text-green-400' : 'text-red-400'}">${s.flag}</td>
                <td>${s.sample}</td>
                <td>${s.winRate.toFixed(1)}%</td>
                <td>${s.top3Rate.toFixed(1)}%</td>
                <td>${s.roi.toFixed(1)}%</td>
                <td>${s.avgEv.toFixed(3)}</td>
            `;
            maoTbody.appendChild(tr);
        });
    }

    function drawEquityCurve(data) {
        const sortedByRace = [...data].sort((a, b) => getRaceId(a).localeCompare(getRaceId(b)));
        const labels = [];
        const expectedData = [];
        const actualData = [];
        
        let cumulativeInvest = 0;
        let cumulativeExpected = 0;
        let cumulativeActual = 0;

        // レース単位で集計
        const raceMap = {};
        sortedByRace.forEach(d => {
            const id = getRaceId(d);
            if (!raceMap[id]) raceMap[id] = [];
            raceMap[id].push(d);
        });

        Object.keys(raceMap).forEach((id, idx) => {
            const raceRows = raceMap[id];
            raceRows.forEach(r => {
                cumulativeInvest += 100;
                cumulativeExpected += (parseFloat(r["最終確定期待値"]) || 0) * 100;
                if (parseInt(r["着順"]) === 1) cumulativeActual += (parseFloat(r["最終確定オッズ"]) || 0) * 100;
            });
            labels.push(`Race ${idx + 1}`);
            expectedData.push(cumulativeExpected);
            actualData.push(cumulativeActual);
        });

        if (equityChartInstance) equityChartInstance.destroy();
        const ctx = document.getElementById('equityChart').getContext('2d');
        equityChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: '累積期待払戻(理論値)', data: expectedData, borderColor: '#60a5fa', tension: 0.1, pointRadius: 0 },
                    { label: '累積実払戻(実績)', data: actualData, borderColor: '#4ade80', tension: 0.1, pointRadius: 0 }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e2e8f0' } } }, scales: { x: { display: false }, y: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#94a3b8' } } } }
        });
    }

    function generateMarkdown(summary, classStats, maoStats) {
        let md = "### 全体解析サマリー\n";
        md += `- 総レース数: ${summary.raceCount}\n- 総対象馬数: ${summary.horseCount}\n- 全体単勝回収率: **${summary.roi.toFixed(1)}%**\n\n`;

        md += "### クラス別パフォーマンスレポート\n";
        md += "| 信頼性 | クラス | 頭数 | 1着率 | 3着内率 | 回収率 | CLV | 平均EV |\n";
        md += "|---|---|---|---|---|---|---|---|\n";
        classStats.forEach(s => {
            const rel = s.sample >= 30 ? "✅ (信頼)" : "⚠️ (不足)";
            const highlight = s.clv >= 1.05 ? "🌟" : "";
            md += `| ${rel} | ${s.cls} | ${s.sample} | ${s.winRate.toFixed(1)}% | ${s.top3Rate.toFixed(1)}% | ${s.roi.toFixed(1)}% | ${s.clv.toFixed(2)}${highlight} | ${s.avgEv.toFixed(3)} |\n`;
        });

        md += "\n### MAOフィルター（実行フラグ）分析\n";
        md += "| フラグ | 頭数 | 1着率 | 3着内率 | 回収率 | 平均EV |\n";
        md += "|---|---|---|---|---|---|\n";
        maoStats.forEach(s => {
            md += `| ${s.flag} | ${s.sample} | ${s.winRate.toFixed(1)}% | ${s.top3Rate.toFixed(1)}% | ${s.roi.toFixed(1)}% | ${s.avgEv.toFixed(3)} |\n`;
        });

        // 推奨戦略
        const anchor = [...classStats].sort((a,b) => b.top3Rate - a.top3Rate)[0];
        const striker = [...classStats].sort((a,b) => b.roi - a.roi)[0];
        md += "\n### 📈 3連複・推奨戦略\n";
        md += `- **軸適正 (Anchor)**: ${anchor.cls} (3着内率: ${anchor.top3Rate.toFixed(1)}%)\n`;
        md += `- **爆発力 (Striker)**: ${striker.cls} (回収率: ${striker.roi.toFixed(1)}%)\n\n`;
        
        md += "---\n**Gemini 3 への依頼用プロンプト:**\n";
        md += "上記のデータに基づき、回収率と安定性を最大化するために、3連複の1列目（軸）と単勝（Striker）に設定すべきクラスの組み合わせを考察してください。";
        
        return md;
    }

    function copyToClipboard(text) {
        const temp = document.createElement("textarea");
        document.body.appendChild(temp);
        temp.value = text;
        temp.select();
        document.execCommand("copy");
        document.body.removeChild(temp);
    }

    function showToast() {
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    btnCopyMarkdown.addEventListener('click', () => {
        markdownOutput.select();
        document.execCommand('copy');
        btnCopyMarkdown.textContent = 'コピー完了！';
        setTimeout(() => btnCopyMarkdown.textContent = 'クリップボードにコピー', 2000);
    });
});
