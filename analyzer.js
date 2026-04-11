/**
 * SS-Analyzer v2.1 | 統合・解析・視覚化システム
 * Core Logic (analyzer.js)
 */

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const dropzone = document.getElementById('dropzone');
    const fileList = document.getElementById('file-list');
    const integrateBtn = document.getElementById('integrateBtn');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const analysisSection = document.getElementById('analysisSection');
    const analysisResultArea = document.getElementById('analysisResultArea');
    const geminiOutput = document.getElementById('geminiOutput');
    const geminiExportSection = document.getElementById('geminiExportSection');
    const copyBtn = document.getElementById('copyBtn');
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
        // 旧フォーマット検知
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
        const date = row["日付"] || "Legacy";
        const name = row["レース名"] || "";
        const course = row["コース詳細"] || "";
        if (date === "Legacy") return `${name}_${course}`;
        return `${date}_${name}_${course}`;
    }

    function addFileBadge(name, count) {
        const badge = document.createElement('div');
        badge.className = 'status-badge status-info text-xs';
        badge.textContent = `📁 ${name} (${count}頭)`;
        fileList.appendChild(badge);
    }

    function updateControlPanel() {
        if (allData.size > 0) { integrateBtn.disabled = false; analyzeBtn.disabled = false; }
    }

    // --- Integration & Export with Empty Lines ---
    integrateBtn.addEventListener('click', () => {
        const sortedData = Array.from(allData.values()).sort((a, b) => {
            const dateA = a["日付"] || "Legacy";
            const dateB = b["日付"] || "Legacy";
            if (dateA !== dateB) return dateA.localeCompare(dateB);
            const rA = getRaceId(a);
            const rB = getRaceId(b);
            if (rA !== rB) return rA.localeCompare(rB);
            return parseInt(a["馬番"]) - parseInt(b["馬番"]);
        });

        const outputRows = [];
        let lastRaceId = "";

        sortedData.forEach((row, idx) => {
            const currentRaceId = getRaceId(row);
            
            // レースの切り替わりで空行を挿入（1行目以外）
            if (lastRaceId !== "" && lastRaceId !== currentRaceId) {
                outputRows.push(Array(EXPECTED_HEADERS.length).fill(""));
            }
            
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

    // --- Analysis ---
    analyzeBtn.addEventListener('click', async () => {
        const activeRows = Array.from(allData.values()).filter(d => d["着順"] && d["着順"].trim() !== "");
        if (activeRows.length === 0) { alert("着順確定済みのデータが見つかりません。"); return; }

        // 1. 各集計
        const classStats = calculateByGroup(activeRows, "最終確定クラス");
        const maoStats = calculateByGroup(activeRows, "実行フラグ");
        
        // 2. 画面描画 (innerHTML)
        renderResults(classStats, maoStats);
        
        // 3. グラフ描画
        drawEquityCurve(activeRows);
        
        // 4. Markdown生成
        const md = generateMD(classStats, maoStats, activeRows);
        geminiOutput.value = md;

        // 5. UX: 自動コピー & 通知
        try {
            await navigator.clipboard.writeText(md);
            showToast("解析完了：サマリーをコピーしました");
        } catch (err) {
            console.error("Clipboard copy failed", err);
            alert("解析完了：結果を表示しました（コピーは手動で行ってください）");
        }

        // 表示切り替え
        analysisSection.classList.remove('hidden');
        geminiExportSection.classList.remove('hidden');
    });

    function calculateByGroup(rows, key) {
        const groups = {};
        rows.forEach(r => {
            const val = r[key] || (key === "最終確定クラス" ? r["購入時クラス"] : "-") || "-";
            if (!groups[val]) groups[val] = [];
            groups[val].push(r);
        });

        return Object.keys(groups).sort().map(val => {
            const groupRows = groups[val];
            const sample = groupRows.length;
            const winCount = groupRows.filter(r => parseInt(r["着順"]) === 1).length;
            const top3Count = groupRows.filter(r => parseInt(r["着順"]) <= 3).length;
            
            let totalReturn = 0;
            let totalClv = 0;
            groupRows.forEach(r => {
                const finalOdds = parseFloat(r["最終確定オッズ"]) || 0;
                const purchaseOdds = parseFloat(r["購入時オッズ"]) || finalOdds;
                if (parseInt(r["着順"]) === 1) totalReturn += (finalOdds * 100);
                if (finalOdds > 0) totalClv += (purchaseOdds / finalOdds);
            });

            return {
                label: val,
                sample,
                winRate: (winCount / sample) * 100,
                top3Rate: (top3Count / sample) * 100,
                roi: (totalReturn / (sample * 100)) * 100,
                avgEv: groupRows.reduce((a, r) => a + (parseFloat(r["最終確定期待値"]) || 0), 0) / sample,
                clv: totalClv / sample,
                reliability: sample >= 30 ? "✅" : "⚠️"
            };
        });
    }

    function renderResults(classStats, maoStats) {
        let html = `
            <div class="mb-12">
                <h3 class="text-xl font-bold mb-4 text-white">● クラス別成績</h3>
                <div class="overflow-x-auto">
                    <table class="analysis-table w-full">
                        <thead>
                            <tr>
                                <th>クラス</th>
                                <th>頭数</th>
                                <th>1着率</th>
                                <th>3着内率</th>
                                <th>回収率</th>
                                <th>CLV</th>
                                <th>平均EV</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${classStats.map(s => `
                                <tr>
                                    <td>${s.reliability} ${s.label}</td>
                                    <td>${s.sample}</td>
                                    <td>${s.winRate.toFixed(1)}%</td>
                                    <td>${s.top3Rate.toFixed(1)}%</td>
                                    <td class="${s.roi >= 100 ? 'text-green-400 font-bold' : ''}">${s.roi.toFixed(1)}%</td>
                                    <td class="${s.clv >= 1.05 ? 'text-blue-400' : ''}">${s.clv.toFixed(2)}</td>
                                    <td>${s.avgEv.toFixed(3)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="mb-12">
                <h3 class="text-xl font-bold mb-4 text-purple-400">● MAOフィルター分析 (○=監査合格)</h3>
                <div class="overflow-x-auto">
                    <table class="analysis-table w-full">
                        <thead>
                            <tr>
                                <th>実行フラグ</th>
                                <th>頭数</th>
                                <th>1着率</th>
                                <th>3着内率</th>
                                <th>回収率</th>
                                <th>平均EV</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${maoStats.filter(s => s.label === "○" || s.label === "×").map(s => `
                                <tr>
                                    <td class="font-bold">${s.label}</td>
                                    <td>${s.sample}</td>
                                    <td>${s.winRate.toFixed(1)}%</td>
                                    <td>${s.top3Rate.toFixed(1)}%</td>
                                    <td>${s.roi.toFixed(1)}%</td>
                                    <td>${s.avgEv.toFixed(3)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        analysisResultArea.innerHTML = html;
    }

    function drawEquityCurve(rows) {
        // 時系列ソート
        const sorted = [...rows].sort((a, b) => getRaceId(a).localeCompare(getRaceId(b)));
        const raceMap = {};
        sorted.forEach(r => { const id = getRaceId(r); if (!raceMap[id]) raceMap[id] = []; raceMap[id].push(r); });

        const labels = [];
        const expData = [];
        const actData = [];
        let cumExp = 0; let cumAct = 0;

        Object.keys(raceMap).forEach((id, idx) => {
            const raceRows = raceMap[id];
            raceRows.forEach(r => {
                cumExp += (parseFloat(r["最終確定期待値"]) || 0) * 100;
                if (parseInt(r["着順"]) === 1) cumAct += (parseFloat(r["最終確定オッズ"]) || 0) * 100;
            });
            labels.push(`Race ${idx + 1}`);
            expData.push(cumExp);
            actData.push(cumAct);
        });

        if (equityChartInstance) equityChartInstance.destroy();
        const ctx = document.getElementById('equityChart').getContext('2d');
        equityChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: '累積期待払戻額', data: expData, borderColor: '#3b82f6', tension: 0.1, pointRadius: 0 },
                    { label: '累積実払戻額', data: actData, borderColor: '#ef4444', tension: 0.1, pointRadius: 0 }
                ]
            },
            options: { 
                responsive: true, maintainAspectRatio: false, 
                plugins: { legend: { labels: { color: '#e2e8f0' } } },
                scales: { 
                    x: { display: false }, 
                    y: { grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#94a3b8' } } 
                }
            }
        });
    }

    function generateMD(classStats, maoStats, allRows) {
        const overallSample = allRows.length;
        const overallReturn = allRows.reduce((acc, r) => acc + (parseInt(r["着順"]) === 1 ? (parseFloat(r["最終確定オッズ"]) * 100) : 0), 0);
        const overallROI = (overallReturn / (overallSample * 100)) * 100;

        let md = `### 全体パフォーマンス\n- 総対象数: ${overallSample}\n- 全体回収率: **${overallROI.toFixed(1)}%**\n\n`;
        
        md += `### クラス別成績報告\n| 信頼 | クラス | 頭数 | 的中率 | 複勝率 | 回収率 | CLV | EV |\n|---|---|---|---|---|---|---|---|\n`;
        classStats.forEach(s => {
            md += `| ${s.reliability} | ${s.label} | ${s.sample} | ${s.winRate.toFixed(1)}% | ${s.top3Rate.toFixed(1)}% | ${s.roi.toFixed(1)}% | ${s.clv.toFixed(2)} | ${s.avgEv.toFixed(3)} |\n`;
        });

        const maoFiltered = maoStats.filter(s => s.label === "○" || s.label === "×");
        if (maoFiltered.length > 0) {
            md += `\n### MAOフィルター分析\n| フラグ | 頭数 | 的中率 | 複勝率 | 回収率 | EV |\n|---|---|---|---|---|---|\n`;
            maoFiltered.forEach(s => {
                md += `| ${s.label} | ${s.sample} | ${s.winRate.toFixed(1)}% | ${s.top3Rate.toFixed(1)}% | ${s.roi.toFixed(1)}% | ${s.avgEv.toFixed(3)} |\n`;
            });
        }

        const anchor = [...classStats].sort((a,b) => b.top3Rate - a.top3Rate)[0];
        const striker = [...classStats].sort((a,b) => b.roi - a.roi)[0];

        md += `\n### 3連複・推奨戦略\n- **軸適正 (Anchor)**: ${anchor.label} (複勝率: ${anchor.top3Rate.toFixed(1)}%)\n- **爆発力 (Striker)**: ${striker.label} (回収率: ${striker.roi.toFixed(1)}%)\n\n---\n**考察依頼:**\n3連複・推奨戦略: 3着以内率（軸適正）と単勝回収率（爆発力）に基づき、軸と相手の最適解を考察してください。`;
        
        return md;
    }

    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    copyBtn.addEventListener('click', () => {
        geminiOutput.select();
        document.execCommand('copy');
        showToast("コピーしました！");
    });
});
