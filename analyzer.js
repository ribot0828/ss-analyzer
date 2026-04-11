/**
 * SS-Analyzer | 期待値統合・解析システム
 * Core Logic (analyzer.js)
 */

document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('dropzone');
    const fileList = document.getElementById('file-list');
    const btnIntegrate = document.getElementById('btn-integrate');
    const btnAnalyze = document.getElementById('btn-analyze');
    const analysisView = document.getElementById('analysis-view');
    const analysisTbody = document.getElementById('analysis-tbody');
    const geminiExport = document.getElementById('gemini-export');
    const markdownOutput = document.getElementById('markdown-output');
    const btnCopyMarkdown = document.getElementById('btn-copy-markdown');

    let allData = new Map(); // Key: RaceID + HorseNumber, Value: Object
    const EXPECTED_HEADERS = [
        "日付", "レース名", "コース詳細", "グレード・頭数", "馬番", "馬名", "購入時人気", "購入時オッズ", 
        "評価", "購入時期待値", "購入時クラス", "最終確定人気", "最終確定オッズ", "最終確定期待値", 
        "最終確定クラス", "着順", "MAO", "実行フラグ", "単勝払戻", "ワイド払戻", "三連複払戻"
    ];

    // Drag & Drop
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });

    dropzone.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '.csv';
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
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => resolve(results)
            });
        });
    }

    function processRows(rows) {
        rows.forEach(row => {
            // カラムの存在確認（必要最小限のキー）
            if (!row["日付"] || !row["レース名"] || !row["馬番"]) return;

            const raceId = `${row["日付"]}_${row["レース名"]}_${row["コース詳細"]}`;
            const uniqueKey = `${raceId}_${row["馬番"]}`;
            
            // 重複排除（後から読み込んだデータで上書き）
            allData.set(uniqueKey, row);
        });
    }

    function addFileBadge(name, count) {
        const badge = document.createElement('div');
        badge.className = 'status-badge status-info text-xs';
        badge.textContent = `📁 ${name} (${count}行読み込み)`;
        fileList.appendChild(badge);
    }

    function updateControlPanel() {
        if (allData.size > 0) {
            btnIntegrate.disabled = false;
            btnAnalyze.disabled = false;
        }
    }

    // --- Integration Logic ---
    btnIntegrate.addEventListener('click', () => {
        const sortedData = Array.from(allData.values()).sort((a, b) => {
            if (a["日付"] !== b["日付"]) return a["日付"].localeCompare(b["日付"]);
            const raceA = `${a["レース名"]}_${a["コース詳細"]}`;
            const raceB = `${b["レース名"]}_${b["コース詳細"]}`;
            if (raceA !== raceB) return raceA.localeCompare(raceB);
            return parseInt(a["馬番"]) - parseInt(b["馬番"]);
        });

        const outputRows = [];
        let lastRaceId = "";

        sortedData.forEach(row => {
            const currentRaceId = `${row["日付"]}_${row["レース名"]}_${row["コース詳細"]}`;
            
            // レースが変わるごとに空行を挿入
            if (lastRaceId !== "" && lastRaceId !== currentRaceId) {
                outputRows.push(Array(EXPECTED_HEADERS.length).fill(""));
            }
            
            const rowArray = EXPECTED_HEADERS.map(h => row[h] || "");
            outputRows.push(rowArray);
            lastRaceId = currentRaceId;
        });

        const csvContent = Papa.unparse({
            fields: EXPECTED_HEADERS,
            data: outputRows
        });

        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `SS_Integrated_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });

    // --- Analysis Logic ---
    btnAnalyze.addEventListener('click', () => {
        const data = Array.from(allData.values()).filter(d => d["着順"] && d["着順"].trim() !== "");
        
        if (data.length === 0) {
            alert("着順が入っているデータが見つかりませんでした。結果未反映の可能性があります。");
            return;
        }

        const groups = {}; // Key: Class, Value: Array of rows
        data.forEach(row => {
            const cls = row["最終確定クラス"] || row["購入時クラス"] || "不明";
            if (!groups[cls]) groups[cls] = [];
            groups[cls].push(row);
        });

        const stats = Object.keys(groups).sort().map(cls => {
            const rows = groups[cls];
            const sample = rows.length;
            const wins = rows.filter(r => parseInt(r["着順"]) === 1).length;
            const top3 = rows.filter(r => parseInt(r["着順"]) <= 3).length;
            
            let totalReturn = 0;
            rows.forEach(r => {
                if (parseInt(r["着順"]) === 1) {
                    const odds = parseFloat(r["最終確定オッズ"]) || 0;
                    totalReturn += (odds * 100);
                }
            });
            
            const roi = (totalReturn / (sample * 100)) * 100;
            
            const evs = rows.map(r => parseFloat(r["最終確定期待値"]) || 0);
            const avgEv = evs.reduce((a, b) => a + b, 0) / sample;

            return {
                cls,
                sample,
                winRate: (wins / sample) * 100,
                top3Rate: (top3 / sample) * 100,
                roi,
                avgEv
            };
        });

        renderAnalysis(stats);
        generateMarkdown(stats);
    });

    function renderAnalysis(stats) {
        analysisTbody.innerHTML = '';
        stats.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-bold">${s.cls}</td>
                <td>${s.sample}</td>
                <td>${s.winRate.toFixed(1)}%</td>
                <td>${s.top3Rate.toFixed(1)}%</td>
                <td class="${s.roi >= 100 ? 'text-green-400 font-bold' : ''}">${s.roi.toFixed(1)}%</td>
                <td>${s.avgEv.toFixed(3)}</td>
            `;
            analysisTbody.appendChild(tr);
        });
        analysisView.classList.remove('hidden');
    }

    function generateMarkdown(stats) {
        let md = "### クラス別パフォーマンスレポート\n";
        md += "| クラス | 頭数 | 1着率 | 3着以内率 | 単勝回収率 | 平均EV |\n";
        md += "|---|---|---|---|---|---|\n";
        
        stats.forEach(s => {
            md += `| ${s.cls} | ${s.sample} | ${s.winRate.toFixed(1)}% | ${s.top3Rate.toFixed(1)}% | ${s.roi.toFixed(1)}% | ${s.avgEv.toFixed(3)} |\n`;
        });

        markdownOutput.value = md;
        geminiExport.classList.remove('hidden');
    }

    btnCopyMarkdown.addEventListener('click', () => {
        markdownOutput.select();
        document.execCommand('copy');
        btnCopyMarkdown.textContent = 'コピー完了！';
        setTimeout(() => btnCopyMarkdown.textContent = 'クリップボードにコピー', 2000);
    });
});
