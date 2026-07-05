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
    const recommendationResultArea = document.getElementById('recommendationResultArea');
    const geminiOutput = document.getElementById('geminiOutput');
    const claudeOutput = document.getElementById('claudeOutput');
    const geminiExportSection = document.getElementById('geminiExportSection');
    const copyGeminiBtn = document.getElementById('copyGeminiBtn');
    const copyClaudeBtn = document.getElementById('copyClaudeBtn');
    const toast = document.getElementById('toast');

    // Filters
    const filterVenue = document.getElementById('filter-venue');
    const filterSurface = document.getElementById('filter-surface');
    const filterCondition = document.getElementById('filter-condition');
    const filterDistCat = document.getElementById('filter-dist-cat');

    // State
    let allData = new Map(); 
    let filteredData = [];
    let equityChartInstance = null;
    let calibrationChartInstance = null;

    const EXPECTED_HEADERS = [
        "日付", "開催場所", "レース名", "コース詳細", "グレード・頭数", "馬番", "馬名", "購入時人気", "購入時オッズ",
        "評価", "購入時期待値", "購入時クラス", "最終確定人気", "最終確定オッズ", "最終確定期待値",
        "最終確定クラス", "着順", "MAO", "実行フラグ", "単勝払戻", "ワイド払戻", "三連複払戻", "三連単払戻"
    ];

    // --- 共通フィールドアクセサ ---
    // 判定（クラス分類・EV・勝率・MAO・Amber・SS密度・推奨度・オッズ帯ビニング）は購入時オッズ基準で行う。
    // evOf/clsOf は購入時値優先（欠損時のみ最終確定値にフォールバック）。
    const evOf = r => parseFloat(r["購入時期待値"]) || parseFloat(r["最終確定期待値"]) || 0;
    const clsOf = r => (r["購入時クラス"] || r["最終確定クラス"] || "").trim();
    // oddsOf は払戻（回収金額の計算とそのフォールバック）専用。確定オッズ優先・購入時値フォールバック。
    const oddsOf = r => parseFloat(r["最終確定オッズ"]) || parseFloat(r["購入時オッズ"]) || 0;
    // buyOddsOf は判定用。購入時オッズ優先（欠損しているレガシーデータのみ確定値にフォールバック）。
    const buyOddsOf = r => parseFloat(r["購入時オッズ"]) || parseFloat(r["最終確定オッズ"]) || 0;
    const ratingOf = r => (r["評価"] || "").toUpperCase().trim();
    const finishOf = r => parseInt(r["着順"]);

    // --- チャート共通テーマ ---
    const TICK_COLOR = '#94a3b8';
    const GRID_COLOR = 'rgba(51, 65, 85, 0.5)';
    const TEXT_COLOR = '#e2e8f0';

    // --- 共通定数: X/D1 オッズ帯別監査分析のオッズ帯 ---
    const ODDS_BINS = [
        { label: '10.0未満', min: 0, max: 10.0 },
        { label: '10.0〜19.9', min: 10.0, max: 20.0 },
        { label: '20.0〜29.9', min: 20.0, max: 30.0 },
        { label: '30.0〜39.9', min: 30.0, max: 40.0 },
        { label: '40.0〜49.9', min: 40.0, max: 50.0 },
        { label: '50.0以上', min: 50.0, max: 999999 }
    ];

    // arr から k 個選ぶ全組み合わせ（順序は元の並び順を保持）
    function combinationsOf(arr, k) {
        const result = [];
        const f = (prefix, rest) => {
            if (prefix.length === k) { result.push(prefix); return; }
            for (let i = 0; i < rest.length; i++) f([...prefix, rest[i]], rest.slice(i + 1));
        };
        f([], arr);
        return result;
    }

    // シミュレーション済みレースの時系列ソート（日付 → レースID）
    const byRaceDateOrder = (a, b) => {
        const dateA = a.horses[0] ? (a.horses[0]["日付"] || "ZZZZ") : "ZZZZ";
        const dateB = b.horses[0] ? (b.horses[0]["日付"] || "ZZZZ") : "ZZZZ";
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        return a.id.localeCompare(b.id);
    };

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
    const fileInput = document.getElementById('fileInput');
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    dropzone.addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
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
            
            const ctx = parseCourseDetail(normalizedRow["コース詳細"]);
            Object.assign(normalizedRow, ctx);
            if (normalizedRow["開催場所"] && normalizedRow["開催場所"].trim() && normalizedRow["開催場所"].trim() !== "-") {
                normalizedRow.venue = normalizedRow["開催場所"].trim();
            }

            // 近走監査の読み取りとauditStatus付与
            const auditRaw = (normalizedRow["近走監査"] || "").trim();
            if (auditRaw === "✕") {
                normalizedRow.auditStatus = 'NG';
            } else if (auditRaw === "〇") {
                normalizedRow.auditStatus = 'OK';
            } else {
                // 列なし・空欄・"-" → X/D1はOK扱い（後方互換性）
                normalizedRow.auditStatus = 'OK';
            }

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
        mapped["三連単払戻"] = row["三連単払戻"] || "";
        return mapped;
    }

    function getRaceId(row) {
        return `${row["日付"]}_${row["レース名"]}_${row["コース詳細"]}`;
    }

    // 払戻パース: '1090円'→{pay:1090,key:null} / '12: 6,700円'→{pay:6700,key:"12"} / '1-3-5: 5930円'→{pay:5930,key:"1-3-5"}
    // ※2026-06-06以降のCSVは「馬番(or組): 金額円」形式。parseFloatだと先頭数字を誤読するため専用パーサで処理。
    function parseColonPayout(raw) {
        if (raw == null) return { pay: 0, key: null };
        const s = String(raw).trim();
        if (!s || s === '-') return { pay: 0, key: null };
        if (s.includes(':') || s.includes('：')) {
            const parts = s.split(/[:：]/);
            const key = (parts[0] || '').replace(/[^0-9-]/g, '');
            const pay = parseInt((parts.slice(1).join(':') || '').replace(/[^0-9]/g, ''), 10) || 0;
            return { pay, key: key || null };
        }
        const m = s.match(/([\d,]+)\s*円/);
        if (m) return { pay: parseInt(m[1].replace(/,/g, ''), 10) || 0, key: null };
        const p = parseInt(s.replace(/[^0-9]/g, ''), 10) || 0;
        return { pay: p, key: null };
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

        updateSelect(filterVenue, venues);
        updateSelect(filterCondition, conditions);
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
        try {
            const rowsWithRank = filteredData.filter(d => d["着順"] && d["着順"].trim() !== "");
            
            const raceMap = {};
            rowsWithRank.forEach(r => {
                const id = getRaceId(r);
                if (!raceMap[id]) raceMap[id] = [];
                raceMap[id].push(r);
            });

            const simulatedRaces = Object.keys(raceMap).map(id => simulateRace(raceMap[id], id));

            const riskStats = calculateRiskMetrics(simulatedRaces);
            renderRiskDashboard(riskStats);

            const classStats = calculateClassStats(rowsWithRank);
            renderClassTable(classStats);

            try {
                renderOddsAuditAnalysis(rowsWithRank);
            } catch (e) {
                console.error("Odds Audit rendering error:", e);
            }

            const recStats = calculateRecommendationStats(simulatedRaces);
            renderRecommendationTable(recStats);
            let amberStats = [];
            try {
                amberStats = calculateAmberStats(simulatedRaces);
                renderAmberReport(amberStats);
            } catch (e) {
                console.error("Amber Report rendering error:", e);
            }

            try {
                const calibrationStats = calculateCalibrationStats(simulatedRaces);
                renderCalibrationReport(calibrationStats);
            } catch (e) {
                console.error("Calibration Report rendering error:", e);
            }

            renderRiskAnalysisDetails(riskStats);
            drawEquityCurve(simulatedRaces);

            initRankEvTabs(rowsWithRank);
            renderRankEvAnalysis('S', rowsWithRank);

            calibRows = rowsWithRank;
            initCalibTabs();
            setCalibFilter(activeCalibFilter); // デフォルト: Win-Core（単勝買い目）
            // JSON出力用には Win-Core（本命）と 全馬（参考）の両方を保持
            window.latestCalibration = {
                basis: 'winCore_primary',
                winCore: calculateCalibration(filterCalibRows(rowsWithRank, 'wincore')),
                all: calculateCalibration(filterCalibRows(rowsWithRank, 'all'))
            };

            const outliers = detectOutliers(rowsWithRank);

            const aiPrompts = generateUltimateMarkdown(riskStats, classStats, recStats, outliers, simulatedRaces);
            geminiOutput.value = aiPrompts.gemini;
            claudeOutput.value = aiPrompts.claude;

            window.latestSimData = { rowsWithRank, riskStats, classStats, amberStats, recStats, simulatedRaces };

            const jsonBtn = document.getElementById('downloadJsonBtn');
            if (jsonBtn) jsonBtn.classList.remove('hidden');

            const analysisTbl = document.querySelector('#analysisResultArea table');
            if (analysisTbl) makeTableSortable(analysisTbl);

            const recTbl = document.querySelector('#recommendationResultArea table');
            if (recTbl) makeTableSortable(recTbl);

        } catch (e) {
            console.error("Full Analysis Error:", e);
            showToast("解析中にエラーが発生しました。詳細はコンソールを確認してください。");
        }
    }

    const WIN_CORE_CLASSES = ['A3', 'B2', 'A2', 'B1', 'D1', 'B3', 'X'];
    const PLACE_CORE_CLASSES_FULL = ['S0', 'S1', 'S2', 'A0', 'B0+', 'A1', 'B0'];
    const AXIS_CLASSES = ['S0', 'S1', 'S2', 'A0', 'B0+', 'A1', 'B0'];

    // クラス分類・MAO・Amber判定ロジックを共通化（購入時/確定オッズどちらの評価にも使い回す）
    function classifyHorse(rating, odds, winRate, ev) {
        let cls = 'N';

        if (odds > 0) {
            if (rating === 'S' && ev < 0.700) cls = 'S0';
            else if (rating === 'S' && ev >= 0.700 && ev <= 0.999) cls = 'S1';
            else if (rating === 'S' && ev >= 1.200 && ev <= 1.499) cls = 'S2';
            else if (rating === 'B' && ev <= 0.500) cls = 'B0+';
            else if (rating === 'A' && ev < 0.600) cls = 'A0';
            else if (rating === 'B' && ev > 0.500 && ev <= 0.900) cls = 'B0';
            else if (rating === 'A' && ev >= 0.600 && ev <= 0.899) cls = 'A1';
            else if (rating === 'D' && ev >= 3.000 && ev <= 3.999) cls = 'X';
            else if (rating === 'B' && ev >= 1.500 && ev <= 1.699) cls = 'B2';
            else if (rating === 'B' && ev >= 1.100 && ev <= 1.350) cls = 'B1';
            else if (rating === 'B' && ev >= 2.000 && ev <= 4.500) cls = 'B3';
            else if (rating === 'A' && ev >= 1.000 && ev <= 1.250) cls = 'A2';
            else if (rating === 'A' && ev >= 1.500 && ev <= 1.699) cls = 'A3';
            else if (rating === 'D' && ev >= 1.300 && ev <= 1.799) cls = 'D1';
        }

        let mao = 999;
        if (winRate > 0) {
            if (['S0','S1','S2','A0','B0+','A1','B0'].includes(cls)) mao = 0.60 / winRate; // Ver.5.3: 防御系係数 0.50→0.60
            else if (['B1', 'B2', 'B3', 'A2', 'A3'].includes(cls)) mao = 0.90 / winRate;
            else if (cls === 'X') mao = 3.00 / winRate;
            else if (cls === 'D1') mao = 1.00 / winRate;
        }

        let amberPass = false;
        if (cls === 'X' || cls === 'D1') {
            amberPass = odds >= mao;
        } else if (['S0','S1','S2','A0','B0+','A1','B0','B1','B2','B3','A2', 'A3'].includes(cls)) {
            amberPass = odds >= (mao * 1.2);
        }

        return { cls, mao, amberPass };
    }

    function enrichHorses(horses) {
        let totalScore = 0;

        // 1. スコア付与と合計計算（判定は購入時オッズ基準）
        horses.forEach(h => {
            let score = 0;
            const r = ratingOf(h);
            const odds = buyOddsOf(h);
            if (odds > 0) {
                if (r === 'S') score = 100;
                else if (r === 'A') score = 65;
                else if (r === 'B') score = 40;
                else if (r === 'C') score = 20;
                else if (r === 'D') score = 10;
                else if (r === 'E') score = 3;
                else if (r === 'F') score = 0.5;
            }
            h.score = score;
            h.usedOdds = odds;
            totalScore += score;
        });

        // 2. 完全再計算とプロパティ上書き（判定＝購入時オッズが正）
        horses.forEach(h => {
            h.expectedWinRate = (totalScore > 0 && h.usedOdds > 0) ? h.score / totalScore : 0;
            const rawEv = h.expectedWinRate * h.usedOdds;
            h.calculatedEv = Math.floor(rawEv * 1000 + 1e-9) / 1000;

            const r = ratingOf(h);
            const winRate = h.expectedWinRate;
            const { cls, amberPass } = classifyHorse(r, h.usedOdds, winRate, h.calculatedEv);

            h.amberPass = amberPass;
            // simulateRace 等が参照する購入時ベースの判定値（正）
            h["購入時クラス"] = cls;
            h["購入時期待値"] = h.calculatedEv;

            // 確定オッズでの参照値（表示・参考用。購入時値が欠損した場合のみ購入時値を流用）
            const finalOdds = parseFloat(h["最終確定オッズ"]) || h.usedOdds;
            const finalWinRate = (totalScore > 0 && finalOdds > 0) ? h.score / totalScore : 0;
            const finalRawEv = finalWinRate * finalOdds;
            const finalEv = Math.floor(finalRawEv * 1000 + 1e-9) / 1000;
            const finalResult = classifyHorse(r, finalOdds, finalWinRate, finalEv);
            h["最終確定クラス"] = finalResult.cls;
            h["最終確定期待値"] = finalEv;
        });

        return horses;
    }

    function calculateSSDensity(raceHorses) {
        const qualifiedCount = raceHorses.filter(h => {
            const ev = evOf(h);
            const rating = ratingOf(h);
            return ev >= 1.300 && ['S', 'A', 'B', 'D'].includes(rating);
        }).length;
        const validCount = raceHorses.filter(h => (buyOddsOf(h)) > 0).length;
        const denominator = Math.max(12, validCount);
        return qualifiedCount / denominator;
    }

    function determineRecommendation(raceHorses) {
        const density = calculateSSDensity(raceHorses);
        const classes = raceHorses.map(h => clsOf(h));
        const hasS0orS1 = classes.some(c => c === 'S0' || c === 'S1');
        const hasAxis = classes.some(c => AXIS_CLASSES.includes(c));

        if (density >= 0.250 && hasS0orS1) return 'SSS';
        if (density >= 0.250 && hasAxis) return 'SS';
        if (density >= 0.150) return 'S';
        return 'Low';
    }

    function simulateRace(raceHorses, raceId) {
        raceHorses = enrichHorses(raceHorses);
        const classes = raceHorses.map(h => clsOf(h));
        const density = calculateSSDensity(raceHorses);
        
        // 優先順位の定数定義（念のため関数内に明記）
        const PLACE_CORE_CLASSES = ['S0', 'S1', 'S2', 'A0', 'B0+', 'A1', 'B0'];
        const WIN_CORE_CLASSES = ['A3', 'B2', 'A2', 'D1', 'B1', 'B3', 'X'];
        const WIN_PRIORITY_LOCAL = ['A3', 'B2', 'A2', 'D1', 'B1', 'B3', 'X']; // [10] D1>B1
        const TRIO_ROW2_DEFENSE_LOCAL = ['S0', 'S1', 'S2', 'A0', 'B0+', 'A1', 'B0'];
        const TRIO_ROW2_ATTACK_LOCAL = ['A3', 'B2', 'A2', 'D1', 'B1', 'B3', 'X']; // [10] D1>B1

        const hasAxis = classes.some(c => PLACE_CORE_CLASSES.includes(c));
        const isGraded = raceHorses[0] && ((raceHorses[0]["グレード・頭数"] || "").includes("G") || (raceHorses[0]["グレード・頭数"] || "").includes("重賞"));
        const minDensity = isGraded ? 0.100 : 0.150;
        const rec = determineRecommendation(raceHorses);
        const baseSkipTrio = !hasAxis || density < minDensity;
        const skipTrio = baseSkipTrio || rec === 'S' || rec === 'Low';

        // 【攻撃ソート関数】EV差が0.100以内なら馬番が小さい方（内枠）を優先、それ以外はEV低を優先
        const attackSort = (a, b) => {
            const evA = evOf(a);
            const evB = evOf(b);
            const umA = parseInt(a["馬番"]);
            const umB = parseInt(b["馬番"]);
            
            if (Math.abs(evA - evB) <= 0.100 + 1e-9) {
                return umA - umB; // 馬番が小さい方（内枠）を優先
            } else {
                return evA - evB; // EVが低い方を優先
            }
        };

        // 【防御ソート関数】スコアや枠順の比較は廃止し、純粋にEVが低い方を優先
        const pureEvSort = (a, b) => {
            const evA = evOf(a);
            const evB = evOf(b);
            return evA - evB;
        };

        // 【単勝シミュレーション馬選定とAmber検証用グループ分け】
        let finalWinBets = [];
        let amberFailBets = [];
        
        let allWinCandidates = [];
        for (let clsName of WIN_PRIORITY_LOCAL) {
            let cands = raceHorses.filter(h => clsOf(h) === clsName);
            if (cands.length > 0) {
                cands.sort(attackSort); // 攻撃ソート適用
                for (let h of cands) {
                    const umaban = parseInt(h["馬番"]);
                    // 壁フィルター
                    if (umaban >= 13 && ['A1', 'S2', 'A0'].includes(clsName)) continue;
                    allWinCandidates.push(h);
                }
            }
        }

        // 1. グループA：Amber通過（実購入）
        for (let h of allWinCandidates) {
            if (finalWinBets.length >= 2) break;
            if (h.amberPass) finalWinBets.push(h);
        }

        // 2. グループB：Amber見送り（回避した罠: Amber無視で上位2頭に入るはずだったが弾かれた馬）
        amberFailBets = allWinCandidates.slice(0, 2).filter(h => !h.amberPass);

        // 【三連複シミュレーション買い目選定】
        let finalTrioCombos = new Set();
        let axisHorse = null;
        let row2 = [];
        let row3Array = [];

        if (!baseSkipTrio) {
            // 軸の選定（優先順位順に探し、同クラスなら防御ソート=純粋EV）
            for (let c of PLACE_CORE_CLASSES) {
                let cands = raceHorses.filter(h => clsOf(h) === c);
                if (cands.length > 0) {
                    cands.sort(pureEvSort); // 新防御ソート
                    axisHorse = cands[0];
                    break;
                }
            }

            if (axisHorse) {
                // 2列目防衛 (優先順位順に最大2枚)
                let defCount = 0;
                for (let c of TRIO_ROW2_DEFENSE_LOCAL) {
                    if (defCount >= 2) break;
                    let cands = raceHorses.filter(h => h !== axisHorse && clsOf(h) === c);
                    if (cands.length > 0) {
                        cands.sort(pureEvSort); // 新防御ソート
                        for (let h of cands) {
                            if (defCount >= 2) break;
                            if (!row2.includes(h)) {
                                row2.push(h);
                                defCount++;
                            }
                        }
                    }
                }

                // 2列目攻撃 (優先順位順に最大1枚)
                let atkCount = 0;
                for (let c of TRIO_ROW2_ATTACK_LOCAL) {
                    if (atkCount >= 1) break;
                    let cands = raceHorses.filter(h => h !== axisHorse && clsOf(h) === c);
                    if (cands.length > 0) {
                        cands.sort(attackSort); // 攻撃ソート
                        for (let h of cands) {
                            if (atkCount >= 1) break;
                            if (!row2.includes(h)) {
                                row2.push(h);
                                atkCount++;
                            }
                        }
                    }
                }

                // [12] 三連複 軸1頭ながし: 網を撤廃。買い目 = 軸 × C(相手row2, 2)。上限3点
                // row2 が「相手」（最大3頭）。row3(網)は生成しない。
                row3Array = []; // 網は廃止（UI互換のため空配列を維持）
                for (let i = 0; i < row2.length; i++) {
                    for (let j = i + 1; j < row2.length; j++) {
                        const h2 = row2[i], h3 = row2[j];
                        if (h2 !== h3 && h2 !== axisHorse && h3 !== axisHorse) {
                            const trio = [parseInt(axisHorse["馬番"]), parseInt(h2["馬番"]), parseInt(h3["馬番"])].sort((a,b) => a-b).join('-');
                            finalTrioCombos.add(trio);
                        }
                    }
                }
                // 自己検査: 全買い目に軸を含む & 点数<=3
                const axisNo = parseInt(axisHorse["馬番"]);
                finalTrioCombos.forEach(t => {
                    if (!t.split('-').map(Number).includes(axisNo)) console.error('[三連複] 軸欠落:', t);
                });
                if (finalTrioCombos.size > 3) console.error('[三連複] 点数超過:', finalTrioCombos.size);
            }
        }

        const dateStr = (raceHorses[0] && raceHorses[0]["日付"]) ? raceHorses[0]["日付"].trim() : "";
        const forceRecalculateWin = dateStr === "Legacy" || dateStr === "" || dateStr < "2026-04-05";

        let actualWinPayoutMap = {};
        let actualTrioPayout = 0;

        raceHorses.forEach(h => {
            if (forceRecalculateWin && finishOf(h) === 1) {
                // 2026-04-05以前は、単勝払戻データを無視してオッズから自己検算
                const odds = oddsOf(h);
                if (odds > 0) {
                    actualWinPayoutMap[h["馬番"]] = Math.round(odds * 10) * 10;
                }
            } else {
                // それ以降はCSVの値を優先（コロン形式 '馬番: 金額円' を正しく解釈）
                const w = parseColonPayout(h["単勝払戻"]);
                if (w.key !== null && w.pay > 0) {
                    actualWinPayoutMap[w.key] = w.pay;        // 勝ち馬の馬番に紐付け
                } else if (w.pay > 0) {
                    actualWinPayoutMap[h["馬番"]] = w.pay;     // 旧レース値形式
                } else if (finishOf(h) === 1) {
                    // フォールバック
                    const odds = oddsOf(h);
                    if (odds > 0) actualWinPayoutMap[h["馬番"]] = Math.round(odds * 10) * 10;
                }
            }

            const tPay = parseColonPayout(h["三連複払戻"]).pay; // '1-3-5: 5930円'→5930
            if (tPay > 0) actualTrioPayout = tPay;
        });

        let winInvest = 0;
        let winReturn = 0;
        let amberFailInvest = 0;
        let amberFailReturn = 0;

        // [8][9] 単勝ロット適正化（推奨度×クラス）
        const UNIT_TABLE = {
            'A3': { SSS: 6, SS: 5, S: 5, Low: 0 },
            'B2': { SSS: 3, SS: 2, S: 2, Low: 0 }, // [9]
            'A2': { SSS: 2, SS: 2, S: 2, Low: 0 },
            'B1': { SSS: 1, SS: 1, S: 1, Low: 0 }, // [8] 全推奨度1U (Low=0)
            'D1': { SSS: 1, SS: 1, S: 1, Low: 0 },
            'B3': { SSS: 1, SS: 1, S: 1, Low: 0 },
            'X':  { SSS: 1, SS: 1, S: 1, Low: 0 }
        };
        const getUnits = (cls) => {
            if (rec === 'Low') return 0;
            const entry = UNIT_TABLE[cls] && UNIT_TABLE[cls][rec];
            return entry !== undefined ? entry : 1;
        };

        finalWinBets.forEach(h => {
            const cls = clsOf(h);
            const units = getUnits(cls);
            winInvest += units * 100; // 1U = 100円計算

            if (finishOf(h) === 1) {
                const umaban = h["馬番"];
                if (actualWinPayoutMap[umaban]) {
                    winReturn += actualWinPayoutMap[umaban] * units;
                } else {
                    winReturn += (oddsOf(h)) * 100 * units;
                }
            }
        });
        amberFailBets.forEach(h => {
            const cls = clsOf(h);
            const units = getUnits(cls);
            amberFailInvest += units * 100;

            if (finishOf(h) === 1) {
                const umaban = h["馬番"];
                if (actualWinPayoutMap[umaban]) {
                    amberFailReturn += actualWinPayoutMap[umaban] * units;
                } else {
                    amberFailReturn += (oddsOf(h)) * 100 * units;
                }
            }
        });
        let trioReturn = 0;
        let trioHit = false;

        // 三連複の的中判定と払戻集計
        const winners = raceHorses.filter(h => finishOf(h) <= 3).map(h => parseInt(h["馬番"])).sort((a,b) => a-b);
        if (winners.length >= 3) {
            const combos = combinationsOf(winners, 3);
            for (let c of combos) {
                if (finalTrioCombos.has(c.join('-'))) {
                    trioHit = true;
                    break; // 的中の重複カウント防止：1回のみで確定
                }
            }

            // ※三連単計算の影響分離: 三連単払戻(h["三連単払戻"])は一切参照・利用せず、
            // 独立して取得した三連複払戻(actualTrioPayout)のみを加算しています。
            if (trioHit) trioReturn = actualTrioPayout;
        }

        const refTrioInvest = finalTrioCombos.size * 100;
        const refTrioReturn = trioReturn;

        return {
            id: raceId,
            horses: raceHorses,
            rec: rec,
            ssDensity: density,
            skipTrio: skipTrio,
            axisHorse: axisHorse,
            row2: row2,
            row3: row3Array,
            finalWinBets: finalWinBets,
            amberFailBets: amberFailBets,
            winInvest: rec === 'Low' ? 0 : winInvest,
            winReturn: rec === 'Low' ? 0 : winReturn,
            amberFailInvest: amberFailInvest,
            amberFailReturn: amberFailReturn,
            trioInvest: skipTrio ? 0 : refTrioInvest,
            trioReturn: skipTrio ? 0 : refTrioReturn,
            refTrioInvest: refTrioInvest,
            refTrioReturn: refTrioReturn
        };
    }

    function wilsonCI(k, n) {
        if (!n || n === 0) return null;
        const z = 1.96;
        const p = k / n;
        const denom = 1 + (z * z) / n;
        const center = (p + (z * z) / (2 * n)) / denom;
        const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
        return { lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
    }

    function calculateRiskMetrics(simulatedRaces) {
        let clvTotal = 0;
        let clvCount = 0;

        // Sort properly by date then race id
        const sortedData = [...simulatedRaces].sort(byRaceDateOrder);

        const winBetRaces = sortedData.filter(r => r.winInvest > 0);
        let winTotalInvest = 0;
        let winTotalReturn = 0;
        
        let cumulativeU = 0;
        let hwmU = 0;
        let maxDDU = 0;

        const pnlUnits = [];
        let currentLosingStreak = 0;
        let maxLosingStreak = 0;
        const allStreaks = [];

        winBetRaces.forEach(r => {
            winTotalInvest += r.winInvest;
            winTotalReturn += r.winReturn;

            const investU = r.winInvest / 100.0;
            const returnU = r.winReturn / 100.0;
            const pnlU = returnU - investU;
            pnlUnits.push(pnlU);

            cumulativeU += pnlU;
            if (cumulativeU > hwmU) hwmU = cumulativeU;
            const ddU = hwmU - cumulativeU;
            if (ddU > maxDDU) maxDDU = ddU;

            if (r.winReturn <= 0) {
                currentLosingStreak++;
            } else {
                if (currentLosingStreak > 0) {
                    allStreaks.push(currentLosingStreak);
                }
                currentLosingStreak = 0;
            }
            if (currentLosingStreak > maxLosingStreak) maxLosingStreak = currentLosingStreak;
        });

        if (currentLosingStreak > 0) allStreaks.push(currentLosingStreak);

        let meanPnl = 0;
        let sharpe = 0;
        if (pnlUnits.length >= 2) {
            meanPnl = pnlUnits.reduce((a, b) => a + b, 0) / pnlUnits.length;
            const variance = pnlUnits.reduce((a, b) => a + Math.pow(b - meanPnl, 2), 0) / (pnlUnits.length - 1);
            const stdev = Math.sqrt(variance);
            if (stdev > 0) sharpe = meanPnl / stdev;
        } else if (pnlUnits.length === 1) {
            meanPnl = pnlUnits[0];
        }

        const dist = { "1-3": 0, "4-6": 0, "7-9": 0, "10-14": 0, "15-19": 0, "20-24": 0, "25-29": 0, "30+": 0 };
        allStreaks.forEach(s => {
            if (s <= 3) dist["1-3"]++;
            else if (s <= 6) dist["4-6"]++;
            else if (s <= 9) dist["7-9"]++;
            else if (s <= 14) dist["10-14"]++;
            else if (s <= 19) dist["15-19"]++;
            else if (s <= 24) dist["20-24"]++;
            else if (s <= 29) dist["25-29"]++;
            else dist["30+"]++;
        });

        // Monte Carlo Simulation for Max DD
        const MC_ITERATIONS = 10000;
        const THRESHOLDS = [100, 150, 200, 250, 300, 400, 500];
        const exceedCounts = { 100: 0, 150: 0, 200: 0, 250: 0, 300: 0, 400: 0, 500: 0 };
        
        for (let i = 0; i < MC_ITERATIONS; i++) {
            // Shuffle
            const shuffled = [...pnlUnits];
            for (let j = shuffled.length - 1; j > 0; j--) {
                const k = Math.floor(Math.random() * (j + 1));
                [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
            }
            
            let mcCum = 0;
            let mcHwm = 0;
            let mcMaxDd = 0;
            for (let j = 0; j < shuffled.length; j++) {
                mcCum += shuffled[j];
                if (mcCum > mcHwm) mcHwm = mcCum;
                const dd = mcHwm - mcCum;
                if (dd > mcMaxDd) mcMaxDd = dd;
            }
            
            for (const t of THRESHOLDS) {
                if (mcMaxDd >= t) exceedCounts[t]++;
            }
        }
        
        const mcProbs = {};
        for (const t of THRESHOLDS) {
            mcProbs[`exceeds_${t}U`] = parseFloat(((exceedCounts[t] / MC_ITERATIONS) * 100).toFixed(2));
        }

        // Calculate old totals for UI compatibility
        let totalInvest = 0;
        let totalReturn = 0;
        sortedData.forEach(r => {
            totalInvest += r.winInvest + r.trioInvest;
            totalReturn += r.winReturn + r.trioReturn;

            r.horses.forEach(h => {
                const fo = parseFloat(h["最終確定オッズ"]);
                const po = parseFloat(h["購入時オッズ"]) || fo;
                if (fo > 0) { clvTotal += (po / fo); clvCount++; }
            });
        });

        // 単勝回収率のブートストラップ95%信頼区間（B=2000回, 復元抽出）
        let winRoiBootstrapCI95 = null;
        if (winBetRaces.length >= 10) {
            const n = winBetRaces.length;
            const B = 2000;
            const rois = [];
            for (let b = 0; b < B; b++) {
                let sumInvest = 0;
                let sumReturn = 0;
                for (let j = 0; j < n; j++) {
                    const idx = Math.floor(Math.random() * n);
                    const r = winBetRaces[idx];
                    sumInvest += r.winInvest;
                    sumReturn += r.winReturn;
                }
                rois.push(sumInvest > 0 ? (sumReturn / sumInvest) * 100 : 0);
            }
            rois.sort((a, b) => a - b);
            const loIdx = Math.floor(0.025 * B);
            const hiIdx = Math.min(B - 1, Math.floor(0.975 * B));
            winRoiBootstrapCI95 = { lo: rois[loIdx], hi: rois[hiIdx] };
        }

        // 時系列 前半/後半 安定性分割（日付順ソート済みの winBetRaces を使用）
        const halfSize = Math.ceil(winBetRaces.length / 2);
        const firstHalfRaces = winBetRaces.slice(0, halfSize);
        const secondHalfRaces = winBetRaces.slice(halfSize);
        const summarizeHalf = (races) => {
            if (races.length === 0) return null;
            let inv = 0, ret = 0, hits = 0;
            races.forEach(r => {
                inv += r.winInvest;
                ret += r.winReturn;
                if (r.winReturn > 0) hits++;
            });
            return {
                n: races.length,
                roi: inv > 0 ? (ret / inv) * 100 : 0,
                hitRate: (hits / races.length) * 100
            };
        };
        const timeSplitStability = {
            firstHalf: summarizeHalf(firstHalfRaces),
            secondHalf: summarizeHalf(secondHalfRaces)
        };

        return {
            raceCount: simulatedRaces.length,
            horseCount: simulatedRaces.reduce((acc, r) => acc + r.horses.length, 0),
            roi: totalInvest > 0 ? (totalReturn / totalInvest) * 100 : 0,
            mdd: 0, // Old mdd completely removed
            mddRate: 0,
            avgClv: clvCount > 0 ? clvTotal / clvCount : 1.0,
            
            // Financial & Risk Metrics
            overallWinRecoveryRate: winTotalInvest > 0 ? (winTotalReturn / winTotalInvest) * 100 : 0,
            maxDrawdownUnits: maxDDU,
            sharpeRatio: sharpe,
            maxWinLosingStreak: maxLosingStreak,
            losingStreakDistribution: dist,
            monteCarloMddProbabilities: mcProbs,
            winRoiBootstrapCI95: winRoiBootstrapCI95,
            timeSplitStability: timeSplitStability
        };
    }

    function calculateClassStats(data) {
        const groups = {};
        data.forEach(r => {
            let cls = r["購入時クラス"] || r["最終確定クラス"] || "不明";
            // X/D1で監査NGの場合、集計キーを分離
            if ((cls === 'X' || cls === 'D1') && r.auditStatus === 'NG') {
                cls = cls + '(NG)';
            }
            if (!groups[cls]) groups[cls] = [];
            groups[cls].push(r);
        });

        return Object.keys(groups).sort().map(cls => {
            const rows = groups[cls];
            const sample = rows.length;
            const wins = rows.filter(r => finishOf(r) === 1).length;
            const top2 = rows.filter(r => finishOf(r) <= 2).length;
            const top3 = rows.filter(r => finishOf(r) <= 3).length;
            const returns = rows.reduce((acc, r) => acc + (finishOf(r) === 1 ? (parseFloat(r["最終確定オッズ"]) * 100) : 0), 0);

            const roi = (returns / (sample * 100)) * 100;
            const winRate = (wins / sample) * 100;

            return {
                cls, sample, wins,
                winRate,
                winRateCI95: wilsonCI(wins, sample),
                top2, top2Rate: (top2 / sample) * 100,
                top3, top3Rate: (top3 / sample) * 100,
                roi,
                avgEv: rows.reduce((acc, r) => acc + evOf(r), 0) / sample
            };
        });
    }
    function calculateAmberStats(simulatedRaces) {
        let passInvest = 0, passReturn = 0, passHits = 0, passRaces = 0;
        let failInvest = 0, failReturn = 0, failHits = 0, failRaces = 0;

        simulatedRaces.forEach(r => {
            if (r.winInvest > 0) {
                passRaces++;
                passInvest += r.winInvest;
                passReturn += r.winReturn;
                if (r.winReturn > 0) passHits++;
            }
            if (r.amberFailInvest > 0) {
                failRaces++;
                failInvest += r.amberFailInvest;
                failReturn += r.amberFailReturn;
                if (r.amberFailReturn > 0) failHits++;
            }
        });

        return [
            {
                name: '🟢 通過 (実購入)',
                races: passRaces,
                invest: passInvest,
                return: passReturn,
                hits: passHits,
                roi: passInvest > 0 ? (passReturn / passInvest) * 100 : 0
            },
            {
                name: '⚠️ 見送り (回避した罠)',
                races: failRaces,
                invest: failInvest,
                return: failReturn,
                hits: failHits,
                roi: failInvest > 0 ? (failReturn / failInvest) * 100 : 0
            }
        ];
    }

    // 評価ランク別キャリブレーション検証: 勝率モデル（score/totalScore）の予測勝率と実勝率を比較
    function calculateCalibrationStats(simulatedRaces) {
        const ranksList = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
        const groups = {};
        ranksList.forEach(rank => { groups[rank] = []; });

        (simulatedRaces || []).forEach(race => {
            (race.horses || []).forEach(h => {
                const rank = ratingOf(h);
                if (!groups[rank]) return; // 想定外の評価値は除外
                if (isNaN(finishOf(h))) return; // 着順が無効な行は除外
                if (!(buyOddsOf(h) > 0)) return; // 購入時オッズが無い行は除外
                groups[rank].push(h);
            });
        });

        return ranksList.map(rank => {
            const rows = groups[rank];
            const n = rows.length;
            if (n === 0) {
                return { rank, n: 0, predictedWinRate: 0, actualWinRate: 0, actualWinRateCI95: null, ratio: null, marketSupportRate: null };
            }

            const wins = rows.filter(h => finishOf(h) === 1).length;
            const predictedWinRate = rows.reduce((acc, h) => acc + (h.expectedWinRate || 0), 0) / n;
            const actualWinRate = wins / n;
            const actualWinRateCI95 = wilsonCI(wins, n);
            const ratio = predictedWinRate > 0 ? actualWinRate / predictedWinRate : null;

            // おまけ: 市場基準（単勝支持率 ≒ 1/オッズ の平均）
            const marketSupportRate = rows.reduce((acc, h) => acc + (1 / buyOddsOf(h)), 0) / n;

            return { rank, n, predictedWinRate, actualWinRate, actualWinRateCI95, ratio, marketSupportRate };
        });
    }

    function renderAmberReport(stats) {
        let html = `
            <div class="overflow-x-auto">
                <table class="analysis-table w-full text-sm">
                    <thead>
                        <tr>
                            <th>判定ステータス</th>
                            <th>対象レース数</th>
                            <th>仮想投資額</th>
                            <th>的中率</th>
                            <th>回収率</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stats.map(s => `
                            <tr>
                                <td class="font-bold">${s.name}</td>
                                <td>${s.races}</td>
                                <td>${s.invest.toLocaleString()}円</td>
                                <td>${s.races > 0 ? (s.hits / s.races * 100).toFixed(1) : '0'}% (${s.hits}/${s.races})</td>
                                <td class="${s.roi >= 100 ? 'text-green-400 font-bold' : ''}">${s.roi.toFixed(1)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        const el = document.getElementById('amberReportArea');
        if(el) el.innerHTML = html;
    }

    function renderCalibrationReport(stats) {
        const rows = (stats || []).filter(s => s.n > 0);

        let html = `
            <div class="overflow-x-auto">
                <table class="analysis-table w-full text-sm">
                    <thead>
                        <tr>
                            <th>評価</th>
                            <th>頭数</th>
                            <th>予測勝率</th>
                            <th>実勝率</th>
                            <th>実勝率95%CI</th>
                            <th>乖離(実/予測)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(s => {
                            const warn = s.ratio !== null && (s.ratio < 0.8 || s.ratio > 1.25);
                            const ciStr = s.actualWinRateCI95 ? `${(s.actualWinRateCI95.lo * 100).toFixed(1)}% - ${(s.actualWinRateCI95.hi * 100).toFixed(1)}%` : '-';
                            const ratioStr = s.ratio !== null ? s.ratio.toFixed(2) : '-';
                            return `
                            <tr class="${warn ? 'text-red-400 font-bold' : ''}">
                                <td class="font-bold">${s.rank}</td>
                                <td>${s.n}</td>
                                <td>${(s.predictedWinRate * 100).toFixed(1)}%</td>
                                <td>${(s.actualWinRate * 100).toFixed(1)}%</td>
                                <td>${ciStr}</td>
                                <td>${ratioStr}${warn ? ' ⚠️' : ''}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
        const el = document.getElementById('calibrationReportArea');
        if (el) el.innerHTML = html;

        // 予測勝率 vs 実勝率のランク別棒グラフ
        const chartEl = document.getElementById('calibrationChart');
        if (chartEl) {
            if (calibrationChartInstance) calibrationChartInstance.destroy();
            const labels = rows.map(s => s.rank);
            const predicted = rows.map(s => s.predictedWinRate * 100);
            const actual = rows.map(s => s.actualWinRate * 100);

            calibrationChartInstance = new Chart(chartEl.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: '予測勝率 (%)',
                            data: predicted,
                            backgroundColor: 'rgba(59, 130, 246, 0.5)',
                            borderColor: '#3b82f6',
                            borderWidth: 1
                        },
                        {
                            label: '実勝率 (%)',
                            data: actual,
                            backgroundColor: 'rgba(245, 158, 11, 0.5)',
                            borderColor: '#f59e0b',
                            borderWidth: 1
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { labels: { color: TEXT_COLOR, usePointStyle: true } }
                    },
                    scales: {
                        x: { ticks: { color: TICK_COLOR }, grid: { color: GRID_COLOR } },
                        y: { ticks: { color: TICK_COLOR }, grid: { color: GRID_COLOR }, beginAtZero: true }
                    }
                }
            });
        }
    }

    function calculateRecommendationStats(simulatedRaces) {
        const order = ['SSS', 'SS', 'S', 'Low'];
        return order.map(rec => {
            const races = simulatedRaces.filter(r => r.rec === rec);
            const raceCount = races.length;
            if (raceCount === 0) return { rec, raceCount: 0, winInvest: 0, winROI: 0, winHits: 0, winBetRaces: 0, winRateCI95: null, trioInvest: 0, trioROI: 0, trioHits: 0, trioBetRaces: 0, totalInvest: 0, totalROI: 0, refTrioInvest: 0, refTrioROI: 0, refTrioHits: 0, refTrioBetRaces: 0 };

            let winInvest = 0;
            let winReturn = 0;
            let trioInvest = 0;
            let trioReturn = 0;
            let winHits = 0;
            let winBetRaces = 0;
            let trioHits = 0;
            let trioBetRaces = 0;
            let refTrioInvest = 0;
            let refTrioReturn = 0;
            let refTrioHits = 0;
            let refTrioBetRaces = 0;

            races.forEach(r => {
                winInvest += r.winInvest;
                winReturn += r.winReturn;
                trioInvest += r.trioInvest;
                trioReturn += r.trioReturn;
                if (r.winInvest > 0) {
                    winBetRaces++;
                    if (r.winReturn > 0) winHits++;
                }
                if (r.trioInvest > 0) {
                    trioBetRaces++;
                    if (r.trioReturn > 0) trioHits++;
                }
                if (r.refTrioInvest > 0) {
                    refTrioInvest += r.refTrioInvest;
                    refTrioReturn += r.refTrioReturn;
                    refTrioBetRaces++;
                    if (r.refTrioReturn > 0) refTrioHits++;
                }
            });

            const winROI = winInvest > 0 ? (winReturn / winInvest) * 100 : 0;
            const trioROI = trioInvest > 0 ? (trioReturn / trioInvest) * 100 : 0;
            const totalInvest = winInvest + trioInvest;
            const totalROI = totalInvest > 0 ? ((winReturn + trioReturn) / totalInvest) * 100 : 0;
            const refTrioROI = refTrioInvest > 0 ? (refTrioReturn / refTrioInvest) * 100 : 0;

            return { rec, raceCount, winInvest, winROI, winHits, winBetRaces, winRateCI95: wilsonCI(winHits, winBetRaces), trioInvest, trioROI, trioHits, trioBetRaces, totalInvest, totalROI, refTrioInvest, refTrioROI, refTrioHits, refTrioBetRaces };
        }).filter(s => s.raceCount > 0);
    }

    function renderRecommendationTable(stats) {
        const recColors = { 'SSS': 'text-yellow-300', 'SS': 'text-orange-400', 'S': 'text-blue-400', 'Low': 'text-slate-400' };
        const fmtHitRate = (hits, total) => total > 0 ? `${(hits / total * 100).toFixed(1)}% (${hits}/${total})` : '-';
        const fmtCIPctUI = (ci) => ci ? `${(ci.lo * 100).toFixed(1)}〜${(ci.hi * 100).toFixed(1)}%` : '-';
        let html = `
            <div class="overflow-x-auto">
                <table class="analysis-table w-full text-sm">
                    <thead>
                        <tr>
                            <th>推奨度</th>
                            <th>レース数</th>
                            <th>単勝投資</th>
                            <th>単勝的中率</th>
                            <th>単勝的中率95%CI</th>
                            <th>単勝回収率</th>
                            <th>三連複投資</th>
                            <th>三連複的中率</th>
                            <th>三連複回収率</th>
                            <th>合算投資額</th>
                            <th>合算回収率</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stats.map(s => {
                            const isSkippedTrio = (s.rec === 'S' || s.rec === 'Low');
                            const trioLabel = isSkippedTrio && s.refTrioInvest > 0
                                ? `<span class="text-slate-500" title="参照値（実際はスキップ）">（参照: ${s.refTrioROI.toFixed(1)}%）</span>`
                                : '';
                            return `
                            <tr>
                                <td class="font-bold ${recColors[s.rec] || ''}">${s.rec}${isSkippedTrio ? ' <span class="text-xs text-slate-500">単勝のみ</span>' : ''}</td>
                                <td>${s.raceCount}</td>
                                <td>${s.winInvest.toLocaleString()}円</td>
                                <td>${fmtHitRate(s.winHits, s.winBetRaces)}</td>
                                <td>${fmtCIPctUI(s.winRateCI95)}</td>
                                <td class="${s.winROI >= 100 ? 'text-green-400 font-bold' : ''}">${s.winROI.toFixed(1)}%</td>
                                <td>${s.trioInvest.toLocaleString()}円</td>
                                <td>${fmtHitRate(s.trioHits, s.trioBetRaces)}</td>
                                <td class="${s.trioROI >= 100 ? 'text-green-400 font-bold' : ''}">${s.trioROI.toFixed(1)}% ${trioLabel}</td>
                                <td>${s.totalInvest.toLocaleString()}円</td>
                                <td class="${s.totalROI >= 100 ? 'text-green-400 font-bold' : ''}">${s.totalROI.toFixed(1)}%</td>
                            </tr>`}).join('')}
                    </tbody>
                </table>
            </div>
        `;
        recommendationResultArea.innerHTML = html;
    }



    // --- 評価ランク用固定EV帯(Bin) 0.1刻み ---
    const RANK_EV_BINS = (() => {
        const bins = [];
        for (let i = 0; i < 30; i++) {
            const min = i / 10;
            const max = (i + 1) / 10;
            bins.push({
                label: `${min.toFixed(1)}〜${(max - 0.01).toFixed(2)}`,
                min: min,
                max: max
            });
        }
        bins.push({ label: "3.0以上", min: 3.0, max: 999.0 });
        return bins;
    })();

    // --- 動的EV帯(Bin)生成ヘルパー ---
    function generateDynamicEvBins(rows) {
        const evValues = rows.map(r => evOf(r)).filter(v => !isNaN(v));
        if (evValues.length === 0) {
            return [{ label: '0.0〜', min: 0.0, max: 999.0 }];
        }
        const minEvRaw = Math.min(...evValues);
        const maxEvRaw = Math.max(...evValues);

        let minEv = Math.floor(minEvRaw * 10) / 10;
        let maxEv = Math.ceil(maxEvRaw * 10) / 10;
        if (maxEv === minEv) maxEv += 0.1;

        // 異常値対策として最大30ビン（EV差3.0）に制限
        if ((maxEv - minEv) > 3.0) {
            maxEv = minEv + 3.0;
        }

        const evBins = [];
        for (let v = minEv; v < maxEv - 0.001; v += 0.1) {
            const minBound = parseFloat(v.toFixed(1));
            const maxBound = parseFloat((v + 0.1).toFixed(1));
            evBins.push({
                label: `${minBound.toFixed(1)}〜${(maxBound - 0.01).toFixed(2)}`,
                min: minBound,
                max: maxBound
            });
        }
        
        // もし最大値が制限で切られた場合のための最後の受け皿
        if ((maxEvRaw * 10) / 10 > maxEv) {
             evBins.push({
                label: `${maxEv.toFixed(1)}以上`,
                min: maxEv,
                max: 999.0
            });
        }
        
        return evBins;
    }

    // --- JSONエクスポート処理 ---
    function generateAndDownloadJSON() {
        if (!window.latestSimData) {
            showToast('シミュレーションが実行されていません');
            return;
        }
        
        try {
            const { rowsWithRank, classStats, riskStats, amberStats, recStats, simulatedRaces } = window.latestSimData;
            const totalRaces = parseInt(document.getElementById('stat-race-count')?.textContent || '0') || 0;
            const overallRoi = parseFloat(document.getElementById('stat-overall-roi')?.textContent || '0') || 0;

            // 推奨度別成績
            const recommendationPerformance = {
                "SSS": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0 },
                "SS": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0 },
                "S": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0 },
                "Low": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0 }
            };
            
            if (recStats && Array.isArray(recStats)) {
                recStats.forEach(rs => {
                    const rec = rs?.rec;
                    if (rec && recommendationPerformance[rec]) {
                        recommendationPerformance[rec] = {
                            sampleRaces: rs?.raceCount || 0,
                            hitRate: rs?.totalBetRaces > 0 ? (rs.totalHits / rs.totalBetRaces) * 100 : 0.0,
                            recoveryRate: rs?.totalROI || 0.0,
                            winRecoveryRate: rs?.winROI || 0.0,
                            wideRecoveryRate: 0.0,
                            trifectaRecoveryRate: rs?.trioROI || 0.0,
                            winHitRate: rs?.winBetRaces > 0 ? (rs.winHits / rs.winBetRaces) * 100 : 0.0,
                            winRateCI95: rs?.winRateCI95 ? { lo: rs.winRateCI95.lo * 100, hi: rs.winRateCI95.hi * 100 } : null,
                            wideHitRate: 0.0,
                            trifectaHitRate: rs?.trioBetRaces > 0 ? (rs.trioHits / rs.trioBetRaces) * 100 : 0.0,
                            refTrifectaRecoveryRate: rs?.refTrioROI || 0.0,
                            refTrifectaHitRate: rs?.refTrioBetRaces > 0 ? (rs.refTrioHits / rs.refTrioBetRaces) * 100 : 0.0,
                            refTrifectaInvest: rs?.refTrioInvest || 0
                        };
                    }
                });
            }

            // SS密度別成績
            const densityPerformance = {
                "80%以上": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0, _hits: 0, _invest: 0, _return: 0, _betRaces: 0 },
                "70%〜79%": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0, _hits: 0, _invest: 0, _return: 0, _betRaces: 0 },
                "60%〜69%": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0, _hits: 0, _invest: 0, _return: 0, _betRaces: 0 },
                "50%〜59%": { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0, _hits: 0, _invest: 0, _return: 0, _betRaces: 0 },
                "50%未満":  { sampleRaces: 0, hitRate: 0.0, recoveryRate: 0.0, _hits: 0, _invest: 0, _return: 0, _betRaces: 0 }
            };

            (simulatedRaces || []).forEach(r => {
                const d = r?.ssDensity || 0;
                let bin = "50%未満";
                if (d >= 0.8) bin = "80%以上";
                else if (d >= 0.7) bin = "70%〜79%";
                else if (d >= 0.6) bin = "60%〜69%";
                else if (d >= 0.5) bin = "50%〜59%";

                const dp = densityPerformance[bin];
                dp.sampleRaces++;

                const wInv = r?.winInvest || 0;
                const wRet = r?.winReturn || 0;
                const tInv = r?.trioInvest || 0;
                const tRet = r?.trioReturn || 0;
                
                dp._invest += wInv + tInv;
                dp._return += wRet + tRet;
                if (wInv > 0) { dp._betRaces++; if (wRet > 0) dp._hits++; }
                if (tInv > 0) { dp._betRaces++; if (tRet > 0) dp._hits++; }
            });

            Object.keys(densityPerformance).forEach(k => {
                const dp = densityPerformance[k];
                dp.hitRate = dp._betRaces > 0 ? (dp._hits / dp._betRaces) * 100 : 0.0;
                dp.recoveryRate = dp._invest > 0 ? (dp._return / dp._invest) * 100 : 0.0;
                delete dp._hits; delete dp._invest; delete dp._return; delete dp._betRaces;
            });

            // オッズ帯別分析 (X/D1)
            const oddsBinAnalysis = { "D1": [], "X": [] };
            const bins = ODDS_BINS;

            ['D1', 'X'].forEach(cls => {
                const clsRows = (rowsWithRank || []).filter(r => clsOf(r) === cls);
                bins.forEach(b => {
                    let okCount = 0, okInvest = 0, okReturn = 0, okHits = 0;
                    let ngCount = 0, ngInvest = 0, ngReturn = 0, ngHits = 0;

                    clsRows.forEach(r => {
                        const buyOdds = buyOddsOf(r); // オッズ帯ビニングは購入時オッズで判定
                        const payoutOdds = oddsOf(r); // 払戻計算は確定オッズ
                        if (buyOdds >= b.min && buyOdds < b.max) {
                            const isHit = finishOf(r) === 1;
                            if (r?.auditStatus === 'NG') {
                                ngCount++;
                                ngInvest += 100;
                                if (isHit) { ngReturn += payoutOdds * 100; ngHits++; }
                            } else {
                                okCount++;
                                okInvest += 100;
                                if (isHit) { okReturn += payoutOdds * 100; okHits++; }
                            }
                        }
                    });

                    oddsBinAnalysis[cls].push({
                        bin: b.label,
                        auditOK: {
                            samples: okCount,
                            hitRate: okCount > 0 ? (okHits / okCount) * 100 : 0.0,
                            recovery: okInvest > 0 ? (okReturn / okInvest) * 100 : 0.0
                        },
                        auditNG: {
                            samples: ngCount,
                            hitRate: ngCount > 0 ? (ngHits / ngCount) * 100 : 0.0,
                            recovery: ngInvest > 0 ? (ngReturn / ngInvest) * 100 : 0.0
                        }
                    });
                });
            });

            // クラス別成績（馬番詳細付き）
            const classPerformance = (classStats || []).map(c => {
                const isNGClass = c?.cls?.endsWith('(NG)') || false;
                const baseCls = isNGClass ? c.cls.replace('(NG)', '') : (c?.cls || '');
                
                const clsRows = (rowsWithRank || []).filter(r => {
                    const rCls = r?.["購入時クラス"] || r?.["最終確定クラス"] || "";
                    if (isNGClass) {
                        return rCls === baseCls && r?.auditStatus === 'NG';
                    } else {
                        if (baseCls === 'X' || baseCls === 'D1') {
                            return rCls === baseCls && r?.auditStatus !== 'NG';
                        }
                        return rCls === c?.cls;
                    }
                });

                // 馬番別成績
                const gateStats = {};
                clsRows.forEach(r => {
                    const um = parseInt(r?.["馬番"]);
                    if (isNaN(um)) return;
                    const odds = oddsOf(r);
                    if (!gateStats[um]) gateStats[um] = { count: 0, win: 0, top3: 0, invest: 0, return: 0 };
                    gateStats[um].count++;
                    gateStats[um].invest += 100;
                    const rank = finishOf(r);
                    if (rank === 1) {
                        gateStats[um].win++;
                        gateStats[um].return += odds * 100;
                    }
                    if (rank <= 3) {
                        gateStats[um].top3++;
                    }
                });

                const umabanDetails = Object.keys(gateStats).map(Number).sort((a, b) => a - b).map(g => ({
                    umaban: g,
                    samples: gateStats[g].count,
                    winRate: gateStats[g].count > 0 ? (gateStats[g].win / gateStats[g].count) * 100 : 0.0,
                    placeRate: gateStats[g].count > 0 ? (gateStats[g].top3 / gateStats[g].count) * 100 : 0.0,
                    recoveryRate: gateStats[g].invest > 0 ? (gateStats[g].return / gateStats[g].invest) * 100 : 0.0
                }));

                const evBins = generateDynamicEvBins(clsRows);
                
                const evStats = evBins.map(b => ({ label: b.label, count: 0, win: 0, top3: 0, invest: 0, return: 0 }));

                clsRows.forEach(r => {
                    const ev = evOf(r);
                    const odds = oddsOf(r);
                    const rank = finishOf(r);

                    const binIdx = evBins.findIndex(b => ev >= b.min && ev < b.max);
                    if (binIdx !== -1) {
                        evStats[binIdx].count++;
                        evStats[binIdx].invest += 100;
                        if (rank === 1) {
                            evStats[binIdx].win++;
                            evStats[binIdx].return += odds * 100;
                        }
                        if (rank <= 3) {
                            evStats[binIdx].top3++;
                        }
                    }
                });

                const evDetails = evStats.map(s => ({
                    evBin: s.label,
                    samples: s.count,
                    winRate: s.count > 0 ? (s.win / s.count) * 100 : 0.0,
                    placeRate: s.count > 0 ? (s.top3 / s.count) * 100 : 0.0,
                    recoveryRate: s.invest > 0 ? (s.return / s.invest) * 100 : 0.0
                }));

                return {
                    cls: c?.cls || "",
                    sampleSize: c?.sample || 0,
                    winRate: c?.winRate || 0.0,
                    winRateCI95: c?.winRateCI95 ? { lo: c.winRateCI95.lo * 100, hi: c.winRateCI95.hi * 100 } : null,
                    rentaiRate: c?.top2Rate || 0.0,
                    placeRate: c?.top3Rate || 0.0,
                    winRecoveryRate: c?.roi || 0.0,
                    umabanDetails: umabanDetails,
                    evDetails: evDetails
                };
            });

            // 評価ランク別成績
            const evaluationPerformance = [];
            const ranksList = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
            ranksList.forEach(rank => {
                const rankRows = (rowsWithRank || []).filter(r => ratingOf(r) === rank);
                
                const stats = RANK_EV_BINS.map(b => ({
                    evBin: b.label, count: 0, win: 0, top3: 0, invest: 0, return: 0
                }));

                rankRows.forEach(r => {
                    const ev = evOf(r);
                    const odds = oddsOf(r);
                    const pos = finishOf(r);

                    const binIdx = RANK_EV_BINS.findIndex(b => ev >= b.min && ev < b.max);
                    if (binIdx !== -1) {
                        stats[binIdx].count++;
                        stats[binIdx].invest += 100;
                        if (pos === 1) {
                            stats[binIdx].win++;
                            stats[binIdx].return += odds * 100;
                        }
                        if (pos <= 3) {
                            stats[binIdx].top3++;
                        }
                    }
                });

                const evDetails = stats.map(s => ({
                    evBin: s.evBin,
                    samples: s.count,
                    winRate: s.count > 0 ? (s.win / s.count) * 100 : 0.0,
                    recoveryRate: s.invest > 0 ? (s.return / s.invest) * 100 : 0.0,
                    placeRate: s.count > 0 ? (s.top3 / s.count) * 100 : 0.0
                }));

                evaluationPerformance.push({
                    rank: rank,
                    evDetails: evDetails
                });
            });

            const jsonPayload = {
                summary: {
                    totalRaces: totalRaces,
                    overallRecoveryRate: overallRoi,
                    overallWinRecoveryRate: riskStats?.overallWinRecoveryRate || 0,
                    maxDrawdownUnits: riskStats?.maxDrawdownUnits || 0,
                    sharpeRatio: riskStats?.sharpeRatio || 0,
                    maxWinLosingStreak: riskStats?.maxWinLosingStreak || 0,
                    losingStreakDistribution: riskStats?.losingStreakDistribution || {},
                    monteCarloMddProbabilities: riskStats?.monteCarloMddProbabilities || {},
                    winRoiBootstrapCI95: riskStats?.winRoiBootstrapCI95 || null,
                    timeSplitStability: riskStats?.timeSplitStability || null
                },
                evaluationPerformance: evaluationPerformance,
                recommendationPerformance: recommendationPerformance,
                densityPerformance: densityPerformance,
                amberAudit: {
                    passed: {
                        sampleSize: (amberStats && amberStats[0]) ? amberStats[0].races : 0,
                        hitRate: (amberStats && amberStats[0]) && amberStats[0].races > 0 ? (amberStats[0].hits / amberStats[0].races) * 100 : 0.0,
                        recoveryRate: (amberStats && amberStats[0]) ? amberStats[0].roi : 0
                    },
                    failed: {
                        sampleSize: (amberStats && amberStats[1]) ? amberStats[1].races : 0,
                        hitRate: (amberStats && amberStats[1]) && amberStats[1].races > 0 ? (amberStats[1].hits / amberStats[1].races) * 100 : 0.0,
                        recoveryRate: (amberStats && amberStats[1]) ? amberStats[1].roi : 0
                    }
                },
                oddsBinAnalysis: oddsBinAnalysis,
                classPerformance: classPerformance,
                // H2: EV較正（予測EV vs 実回収率）。slope≈1 なら較正済み、1から外れるほどEV式の見直し優先度↑
                // winCore=単勝買い目クラスのみ（本命）。all=N等を含む全馬の生EV参考値。
                evCalibration: window.latestCalibration ? {
                    winCore: window.latestCalibration.winCore || null,
                    all: window.latestCalibration.all || null
                } : null
            };

            // --- 出力最適化: サンプル0の項目を除去 / 数値を丸め / 改行・空白を排してファイルを軽量化 ---
            const isEmptyEntry = (o) => {
                if (!o || typeof o !== 'object') return false;
                if ('samples' in o) return (o.samples || 0) === 0;
                if ('sampleSize' in o) return (o.sampleSize || 0) === 0;
                if ('sampleRaces' in o) return (o.sampleRaces || 0) === 0;
                if (o.auditOK && o.auditNG) return ((o.auditOK.samples || 0) + (o.auditNG.samples || 0)) === 0;
                return false;
            };
            const roundNum = (v) => {
                if (typeof v !== 'number' || !isFinite(v)) return v;
                if (Number.isInteger(v)) return v;
                // 率(%)は小数2桁、|v|<1のシャープレシオ等は4桁で十分
                return Math.abs(v) < 1 ? Math.round(v * 1e4) / 1e4 : Math.round(v * 100) / 100;
            };
            const optimize = (node) => {
                if (Array.isArray(node)) {
                    return node.map(optimize).filter(item => !isEmptyEntry(item));
                }
                if (node && typeof node === 'object') {
                    const out = {};
                    for (const k of Object.keys(node)) out[k] = optimize(node[k]);
                    return out;
                }
                return roundNum(node);
            };
            const optimizedPayload = optimize(jsonPayload);

            const jsonString = JSON.stringify(optimizedPayload);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ss_feedback_data.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showToast('JSONデータをダウンロードしました');
        } catch (e) {
            console.error("JSON生成エラー:", e);
            showToast('JSONデータの生成に失敗しました: ' + e.message);
        }
    }

    const downloadJsonBtn = document.getElementById('downloadJsonBtn');
    if (downloadJsonBtn) {
        downloadJsonBtn.addEventListener('click', generateAndDownloadJSON);
    }

    let oddsAuditChartInstance = null;
    function renderOddsAuditAnalysis(rows) {
        // 対象クラス (X, D1) のみ抽出
        const targetData = rows.filter(r => {
            const cls = clsOf(r);
            return cls === 'X' || cls === 'D1';
        });

        // オッズ帯の定義（共通定数）
        const bins = ODDS_BINS;

        // 各binの集計用構造
        const stats = bins.map(b => ({
            label: b.label,
            okCount: 0, okInvest: 0, okReturn: 0,
            ngCount: 0, ngInvest: 0, ngReturn: 0
        }));

        targetData.forEach(r => {
            const buyOdds = buyOddsOf(r); // オッズ帯ビニングは購入時オッズで判定
            const payoutOdds = oddsOf(r); // 払戻計算は確定オッズ
            const isNG = r.auditStatus === 'NG';
            const isHit = finishOf(r) === 1;

            const binIdx = bins.findIndex(b => buyOdds >= b.min && buyOdds < b.max);
            if (binIdx === -1) return;

            if (isNG) {
                stats[binIdx].ngCount++;
                stats[binIdx].ngInvest += 100;
                if (isHit) stats[binIdx].ngReturn += payoutOdds * 100;
            } else {
                stats[binIdx].okCount++;
                stats[binIdx].okInvest += 100;
                if (isHit) stats[binIdx].okReturn += payoutOdds * 100;
            }
        });

        // 配列化
        const labels = stats.map(s => s.label);
        const okRoi = stats.map(s => s.okInvest > 0 ? (s.okReturn / s.okInvest) * 100 : 0);
        const ngRoi = stats.map(s => s.ngInvest > 0 ? (s.ngReturn / s.ngInvest) * 100 : 0);
        const totalCounts = stats.map(s => s.okCount + s.ngCount);

        if (oddsAuditChartInstance) oddsAuditChartInstance.destroy();
        const ctx = document.getElementById('oddsAuditChart').getContext('2d');
        
        oddsAuditChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        type: 'line',
                        label: '出走頭数(件)',
                        data: totalCounts,
                        borderColor: '#94a3b8',
                        backgroundColor: '#94a3b8',
                        yAxisID: 'y1',
                        tension: 0.3,
                        pointRadius: 4,
                        order: 0
                    },
                    {
                        type: 'bar',
                        label: '監査OK 回収率(%)',
                        data: okRoi,
                        backgroundColor: 'rgba(59, 130, 246, 0.8)', // blue-500
                        yAxisID: 'y',
                        order: 1
                    },
                    {
                        type: 'bar',
                        label: '監査NG 回収率(%)',
                        data: ngRoi,
                        backgroundColor: 'rgba(239, 68, 68, 0.8)', // red-500
                        yAxisID: 'y',
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: { labels: { color: TEXT_COLOR } },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.dataset.yAxisID === 'y') {
                                    label += context.parsed.y.toFixed(1) + '%';
                                    const stat = stats[context.dataIndex];
                                    if (context.datasetIndex === 1) { // OK ROI
                                        label += ` (n=${stat.okCount})`;
                                    } else if (context.datasetIndex === 2) { // NG ROI
                                        label += ` (n=${stat.ngCount})`;
                                    }
                                } else {
                                    label += context.parsed.y + '件';
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: '確定オッズ帯', color: TICK_COLOR },
                        ticks: { color: TICK_COLOR },
                        grid: { color: GRID_COLOR }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: '単勝回収率 (%)', color: TICK_COLOR },
                        min: 0,
                        ticks: { color: TICK_COLOR },
                        grid: { color: GRID_COLOR }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: '出走頭数', color: TICK_COLOR },
                        min: 0,
                        ticks: { color: TICK_COLOR },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    }

    function makeTableSortable(tableEl) {
        if (!tableEl) return;
        const headers = tableEl.querySelectorAll('th');
        headers.forEach((th, idx) => {
            th.style.cursor = 'pointer';
            th.title = "クリックでソート";
            th.addEventListener('click', () => {
                const tbody = tableEl.querySelector('tbody');
                const rows = Array.from(tbody.querySelectorAll('tr'));
                const isAsc = th.classList.contains('sort-asc');
                
                headers.forEach(h => { h.classList.remove('sort-asc', 'sort-desc'); });
                th.classList.add(isAsc ? 'sort-desc' : 'sort-asc');
                
                rows.sort((a, b) => {
                    let valA = a.children[idx].textContent.trim();
                    let valB = b.children[idx].textContent.trim();
                    
                    const cleanA = valA.replace(/[%円,⚠️✅ ]/g, '');
                    const cleanB = valB.replace(/[%円,⚠️✅ ]/g, '');
                    
                    const numA = parseFloat(cleanA);
                    const numB = parseFloat(cleanB);
                    
                    if (!isNaN(numA) && !isNaN(numB)) {
                        return isAsc ? numA - numB : numB - numA;
                    }
                    return isAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
                });
                
                rows.forEach(r => tbody.appendChild(r));
            });
        });
    }
    function detectOutliers(data) {
        return data.filter(r => {
            const ev = parseFloat(r["購入時期待値"]) || 0;
            const rank = finishOf(r) || 99;
            return (ev >= 2.0 && rank >= 10) || (ev <= 0.5 && rank === 1);
        });
    }

    function renderRiskDashboard(s) {
        document.getElementById('stat-race-count').textContent = s.raceCount;
        document.getElementById('stat-overall-roi').textContent = `${s.roi.toFixed(1)}%`;
        document.getElementById('stat-mdd').textContent = `-${s.mdd.toLocaleString()}円 (${s.mddRate.toFixed(1)}%)`;
        document.getElementById('stat-avg-clv').textContent = s.avgClv.toFixed(3);
        
        const winRoiEl = document.getElementById('stat-win-roi');
        if(winRoiEl) winRoiEl.textContent = `${s.overallWinRecoveryRate.toFixed(1)}%`;
        
        const winMddEl = document.getElementById('stat-win-mdd');
        if(winMddEl) winMddEl.textContent = `-${s.maxDrawdownUnits.toFixed(1)}U`;
        
        const sharpeEl = document.getElementById('stat-sharpe');
        if(sharpeEl) sharpeEl.textContent = s.sharpeRatio.toFixed(4);
        
        const streakEl = document.getElementById('stat-losing-streak');
        if(streakEl) streakEl.textContent = `${s.maxWinLosingStreak}連敗`;

        const winRoiCiEl = document.getElementById('stat-win-roi-ci');
        if(winRoiCiEl) {
            winRoiCiEl.textContent = s.winRoiBootstrapCI95
                ? `${s.winRoiBootstrapCI95.lo.toFixed(1)}〜${s.winRoiBootstrapCI95.hi.toFixed(1)}%`
                : 'サンプル不足(n<10)';
        }
    }

    function renderRiskAnalysisDetails(s) {
        const distEl = document.getElementById('streakDistributionArea');
        if (distEl && s.losingStreakDistribution) {
            let html = '';
            for (const [bracket, count] of Object.entries(s.losingStreakDistribution)) {
                const bar = '█'.repeat(count);
                html += `<div><span class="inline-block w-20 text-right mr-4">${bracket}連敗:</span><span class="inline-block w-12 text-right mr-4">${count}回</span><span class="text-blue-500">${bar}</span></div>`;
            }
            distEl.innerHTML = html;
        }

        const mcEl = document.getElementById('monteCarloArea');
        if (mcEl && s.monteCarloMddProbabilities) {
            let html = '<div class="mb-2 text-slate-400">各閾値における最大DD超過確率</div>';
            for (const [key, prob] of Object.entries(s.monteCarloMddProbabilities)) {
                const t = key.replace('exceeds_', '').replace('U', '');
                const barLen = Math.floor(prob / 5);
                const bar = '█'.repeat(barLen);
                html += `<div><span class="inline-block w-24 text-right mr-4">-${t}U 超過:</span><span class="inline-block w-16 text-right mr-4">${prob.toFixed(2)}%</span><span class="text-red-500">${bar}</span></div>`;
            }
            mcEl.innerHTML = html;
        }
    }

    function renderClassTable(stats) {
        const fmtCIPctUI = (ci) => ci ? `${(ci.lo * 100).toFixed(1)}〜${(ci.hi * 100).toFixed(1)}%` : '-';
        let html = `
            <div class="overflow-x-auto">
                <table class="analysis-table w-full text-sm">
                    <thead>
                        <tr>
                            <th>クラス</th>
                            <th>頭数</th>
                            <th>的中率</th>
                            <th>的中率95%CI</th>
                            <th>連対率</th>
                            <th>複勝率</th>
                            <th>回収率</th>
                            <th>平均EV</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stats.map(s => `
                            <tr data-cls="${s.cls}" class="cursor-pointer hover:bg-slate-700/50 transition-colors" title="クリックで馬番別詳細を表示">
                                <td class="font-bold">${s.sample >= 30 ? '✅' : '⚠️'} ${s.cls}</td>
                                <td>${s.sample}</td>
                                <td>${s.winRate.toFixed(1)}% (${s.wins}/${s.sample})</td>
                                <td>${fmtCIPctUI(s.winRateCI95)}</td>
                                <td>${s.top2Rate.toFixed(1)}% (${s.top2}/${s.sample})</td>
                                <td>${s.top3Rate.toFixed(1)}% (${s.top3}/${s.sample})</td>
                                <td class="${s.roi >= 100 ? 'text-green-400 font-bold' : ''}">${s.roi.toFixed(1)}%</td>
                                <td>${s.avgEv.toFixed(3)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        analysisResultArea.innerHTML = html;

        // 行クリックイベントの登録
        analysisResultArea.querySelectorAll('tr[data-cls]').forEach(row => {
            row.addEventListener('click', () => {
                const cls = row.getAttribute('data-cls');
                openClassDrilldown(cls);
            });
        });
    }

    let drilldownChartInstance = null;

    function openClassDrilldown(cls) {
        // 監査NG付きクラスの場合、元のクラス名と監査ステータスで絞り込む
        const isNGClass = cls.endsWith('(NG)');
        const baseCls = isNGClass ? cls.replace('(NG)', '') : cls;

        const clsData = filteredData.filter(r => {
            const rCls = r["購入時クラス"] || r["最終確定クラス"] || "";
            if (isNGClass) {
                return rCls === baseCls && r.auditStatus === 'NG';
            } else {
                // 通常クラス: NGではないものすべて
                if (baseCls === 'X' || baseCls === 'D1') {
                    return rCls === baseCls && r.auditStatus !== 'NG';
                }
                return rCls === cls;
            }
        }).filter(r => r["着順"] && r["着順"].trim() !== "");

        if (clsData.length === 0) {
            showToast(`${cls} のデータがありません`);
            return;
        }

        // 馬番別集計（1〜18）
        const gateStats = {};
        clsData.forEach(r => {
            const um = parseInt(r["馬番"]);
            if (isNaN(um) || um < 1) return;
            if (!gateStats[um]) gateStats[um] = { count: 0, win: 0, top2: 0, top3: 0 };
            gateStats[um].count++;
            const rank = finishOf(r);
            if (rank === 1) gateStats[um].win++;
            if (rank <= 2) gateStats[um].top2++;
            if (rank <= 3) gateStats[um].top3++;
        });

        const maxGate = Math.max(...Object.keys(gateStats).map(Number), 18);
        const labels = [];
        const counts = [];
        const winRates = [];
        const top2Rates = [];
        const top3Rates = [];
        const lowSampleFlags = [];

        for (let i = 1; i <= maxGate; i++) {
            labels.push(i.toString());
            const g = gateStats[i] || { count: 0, win: 0, top2: 0, top3: 0 };
            counts.push(g.count);
            winRates.push(g.count > 0 ? (g.win / g.count) * 100 : 0);
            top2Rates.push(g.count > 0 ? (g.top2 / g.count) * 100 : 0);
            top3Rates.push(g.count > 0 ? (g.top3 / g.count) * 100 : 0);
            lowSampleFlags.push(g.count < 5);
        }

        // EV帯別集計 (動的0.1刻み)
        const evBins = generateDynamicEvBins(clsData);
        
        const evStats = evBins.map(b => ({ label: b.label, count: 0, win: 0, top3: 0, invest: 0, return: 0 }));

        clsData.forEach(r => {
            const ev = evOf(r);
            const odds = oddsOf(r);
            const rank = finishOf(r);

            const binIdx = evBins.findIndex(b => ev >= b.min && ev < b.max);
            if (binIdx !== -1) {
                evStats[binIdx].count++;
                evStats[binIdx].invest += 100;
                if (rank === 1) {
                    evStats[binIdx].win++;
                    evStats[binIdx].return += odds * 100;
                }
                if (rank <= 3) {
                    evStats[binIdx].top3++;
                }
            }
        });

        const evLabels = evStats.map(s => s.label);
        const evCounts = evStats.map(s => s.count);
        const evWinRates = evStats.map(s => s.count > 0 ? (s.win / s.count) * 100 : 0);
        const evPlaceRates = evStats.map(s => s.count > 0 ? (s.top3 / s.count) * 100 : 0);
        const evRecoveryRates = evStats.map(s => s.invest > 0 ? (s.return / s.invest) * 100 : 0);

        // モーダル表示
        document.getElementById('drilldownTitle').textContent = `📊 ${cls} クラス 詳細分析 (n=${clsData.length})`;
        document.getElementById('classDrilldownModal').classList.remove('hidden');

        // チャート描画
        if (drilldownChartInstance) drilldownChartInstance.destroy();
        const ctx = document.getElementById('drilldownChart').getContext('2d');
        drilldownChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        type: 'bar',
                        label: '出走回数',
                        data: counts,
                        backgroundColor: counts.map((_, i) => lowSampleFlags[i] ? 'rgba(239, 68, 68, 0.25)' : 'rgba(148, 163, 184, 0.2)'),
                        borderColor: counts.map((_, i) => lowSampleFlags[i] ? 'rgba(239, 68, 68, 0.5)' : 'rgba(148, 163, 184, 0.4)'),
                        borderWidth: 1,
                        yAxisID: 'y1',
                        order: 3
                    },
                    {
                        type: 'line',
                        label: '複勝率',
                        data: top3Rates,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: top3Rates.map((_, i) => lowSampleFlags[i] ? '#ef4444' : '#3b82f6'),
                        yAxisID: 'y',
                        order: 0
                    },
                    {
                        type: 'line',
                        label: '連対率',
                        data: top2Rates,
                        borderColor: '#a855f7',
                        backgroundColor: 'rgba(168, 85, 247, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: top2Rates.map((_, i) => lowSampleFlags[i] ? '#ef4444' : '#a855f7'),
                        yAxisID: 'y',
                        order: 1
                    },
                    {
                        type: 'line',
                        label: '勝率',
                        data: winRates,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: winRates.map((_, i) => lowSampleFlags[i] ? '#ef4444' : '#10b981'),
                        yAxisID: 'y',
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: TEXT_COLOR, usePointStyle: true } },
                    tooltip: {
                        callbacks: {
                            afterBody: (items) => {
                                const idx = items[0].dataIndex;
                                if (lowSampleFlags[idx]) return '⚠️ サンプル数不足 (n<5)';
                                return '';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: '馬番', color: TICK_COLOR },
                        ticks: { color: TICK_COLOR },
                        grid: { color: GRID_COLOR }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: '率 (%)', color: TICK_COLOR },
                        min: 0,
                        max: 100,
                        ticks: { color: TICK_COLOR, callback: v => v + '%' },
                        grid: { color: GRID_COLOR }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: '出走回数', color: TICK_COLOR },
                        min: 0,
                        ticks: { color: TICK_COLOR, stepSize: 1 },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });

        if (window.drilldownEvChartInstance) window.drilldownEvChartInstance.destroy();
        const evCtx = document.getElementById('drilldownEvChart').getContext('2d');
        window.drilldownEvChartInstance = new Chart(evCtx, {
            type: 'bar',
            data: {
                labels: evLabels,
                datasets: [
                    {
                        type: 'bar',
                        label: '出走回数',
                        data: evCounts,
                        backgroundColor: 'rgba(148, 163, 184, 0.2)',
                        borderColor: 'rgba(148, 163, 184, 0.4)',
                        borderWidth: 1,
                        yAxisID: 'y1',
                        order: 3
                    },
                    {
                        type: 'line',
                        label: '複勝率 (%)',
                        data: evPlaceRates,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: '#3b82f6',
                        yAxisID: 'y',
                        order: 0
                    },
                    {
                        type: 'line',
                        label: '勝率 (%)',
                        data: evWinRates,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: '#10b981',
                        yAxisID: 'y',
                        order: 1
                    },
                    {
                        type: 'line',
                        label: '単勝回収率 (%)',
                        data: evRecoveryRates,
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: '#f59e0b',
                        yAxisID: 'y',
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: TEXT_COLOR, usePointStyle: true } }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'EV帯', color: TICK_COLOR },
                        ticks: { color: TICK_COLOR },
                        grid: { color: GRID_COLOR }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: '回収率 (%)', color: TICK_COLOR },
                        min: 0,
                        ticks: { color: TICK_COLOR, callback: v => v + '%' },
                        grid: { color: GRID_COLOR }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: '出走回数', color: TICK_COLOR },
                        min: 0,
                        ticks: { color: TICK_COLOR, stepSize: 1 },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });

        // テーブル描画
        let tblHtml = `
            <table class="analysis-table w-full text-xs mt-4">
                <thead>
                    <tr>
                        <th>馬番</th><th>出走数</th><th>勝率</th><th>連対率</th><th>複勝率</th><th>1着</th><th>2着</th><th>3着</th>
                    </tr>
                </thead>
                <tbody>
        `;
        for (let i = 1; i <= maxGate; i++) {
            const g = gateStats[i] || { count: 0, win: 0, top2: 0, top3: 0 };
            if (g.count === 0) continue;
            const warnCls = g.count < 5 ? 'text-red-400' : '';
            const wr = ((g.win / g.count) * 100).toFixed(1);
            const t2r = ((g.top2 / g.count) * 100).toFixed(1);
            const t3r = ((g.top3 / g.count) * 100).toFixed(1);
            tblHtml += `
                <tr class="${warnCls}">
                    <td class="font-bold">${g.count < 5 ? '⚠️' : ''} ${i}</td>
                    <td>${g.count}</td>
                    <td>${wr}%</td>
                    <td>${t2r}%</td>
                    <td>${t3r}%</td>
                    <td>${g.win}</td>
                    <td>${g.top2 - g.win}</td>
                    <td>${g.top3 - g.top2}</td>
                </tr>
            `;
        }
        tblHtml += '</tbody></table>';
        document.getElementById('drilldownTableArea').innerHTML = tblHtml;
    }

    // --- Charting ---
    function drawEquityCurve(simulatedRaces) {
        // Sort properly by date then race id
        const sorted = [...simulatedRaces].sort(byRaceDateOrder);
        
        const labels = [];
        const actData = [];
        let cumAct = 0;

        const winBetRaces = sorted.filter(r => r.winInvest > 0);

        winBetRaces.forEach((r, idx) => {
            cumAct += (r.winReturn - r.winInvest) / 100.0;
            
            labels.push(`Win Race ${idx+1}`);
            actData.push(cumAct);
        });

        if (equityChartInstance) equityChartInstance.destroy();
        equityChartInstance = new Chart(document.getElementById('equityChart').getContext('2d'), {
            type: 'line',
            data: { labels, datasets: [
                { label: '実績累積収支 (単勝Unit)', data: actData, borderColor: '#10b981', fill: true, backgroundColor: 'rgba(16, 185, 129, 0.1)', tension: 0.1, pointRadius: 0 }
            ]},
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#fff' } } }, scales: { x:{display:false}, y:{grid:{color:'#334155'}, ticks:{color:'#94a3b8'}} } }
        });
    }

    // --- EV較正分析 (H2): 予測EV vs 実回収率 ---
    let calibRows = [];
    let activeCalibFilter = 'wincore';
    const CALIB_LABELS = { wincore: 'Win-Core（単勝買い目）', placecore: 'Place-Core（三連複軸）', bet: '買い目クラス全体', all: '全馬（生EV）' };

    function filterCalibRows(rows, key) {
        if (key === 'all') return rows || [];
        if (key === 'wincore') return (rows || []).filter(r => WIN_CORE_CLASSES.includes(clsOf(r)));
        if (key === 'placecore') return (rows || []).filter(r => PLACE_CORE_CLASSES_FULL.includes(clsOf(r)));
        if (key === 'bet') return (rows || []).filter(r => { const c = clsOf(r); return WIN_CORE_CLASSES.includes(c) || PLACE_CORE_CLASSES_FULL.includes(c); });
        return rows || [];
    }

    function setCalibFilter(key) {
        activeCalibFilter = key;
        document.querySelectorAll('.calib-filter-btn').forEach(b => {
            const on = b.getAttribute('data-filter') === key;
            b.classList.toggle('bg-cyan-600', on);
            b.classList.toggle('text-white', on);
            b.classList.toggle('bg-slate-800', !on);
            b.classList.toggle('text-slate-300', !on);
        });
        const calib = calculateCalibration(filterCalibRows(calibRows, key));
        renderCalibration(calib, CALIB_LABELS[key] || key);
    }

    function initCalibTabs() {
        document.querySelectorAll('.calib-filter-btn').forEach(btn => {
            const nb = btn.cloneNode(true);
            btn.parentNode.replaceChild(nb, btn);
            nb.addEventListener('click', () => setCalibFilter(nb.getAttribute('data-filter')));
        });
    }

    function calculateCalibration(rows) {
        // EV帯 0.25刻み（0.0〜3.0）+ 3.0以上。較正はサンプル確保が重要なので粗めに区切る
        const bins = [];
        for (let v = 0; v < 3.0 - 1e-9; v += 0.25) {
            bins.push({ min: parseFloat(v.toFixed(2)), max: parseFloat((v + 0.25).toFixed(2)) });
        }
        bins.push({ min: 3.0, max: Infinity });

        const stats = bins.map(b => ({ min: b.min, max: b.max, n: 0, evSum: 0, returnSum: 0 }));
        (rows || []).forEach(r => {
            const ev = evOf(r);
            const odds = oddsOf(r);
            if (ev <= 0 || odds <= 0) return;
            const idx = stats.findIndex(b => ev >= b.min && ev < b.max);
            if (idx === -1) return;
            stats[idx].n++;
            stats[idx].evSum += ev;
            if (finishOf(r) === 1) stats[idx].returnSum += odds; // 1着なら オッズ倍(×100円)を回収
        });

        // 各ビン: x=平均予測EV, y=実回収率(倍率)= 回収合計 ÷ 投入件数
        const points = stats.filter(b => b.n > 0).map(b => ({
            ev: b.evSum / b.n,
            recovery: b.returnSum / b.n,
            n: b.n
        }));

        // 母集団全体の平均回収（倍率）＝ 全帯の回収合計 ÷ 全件数。100%割れがEV見直しの引き金。
        const grandN = stats.reduce((a, b) => a + b.n, 0);
        const grandReturn = stats.reduce((a, b) => a + b.returnSum, 0);
        const meanRecovery = grandN > 0 ? grandReturn / grandN : null;

        // サンプル数で重み付けした最小二乗回帰 (y = slope*x + intercept)
        let slope = null, intercept = null, r2 = null;
        const usable = points.filter(p => p.n >= 3); // ノイズ除去
        const W = usable.reduce((a, p) => a + p.n, 0);
        if (usable.length >= 2 && W > 0) {
            const mx = usable.reduce((a, p) => a + p.n * p.ev, 0) / W;
            const my = usable.reduce((a, p) => a + p.n * p.recovery, 0) / W;
            let sxx = 0, sxy = 0, syy = 0;
            usable.forEach(p => {
                sxx += p.n * (p.ev - mx) * (p.ev - mx);
                sxy += p.n * (p.ev - mx) * (p.recovery - my);
                syy += p.n * (p.recovery - my) * (p.recovery - my);
            });
            if (sxx > 0) {
                slope = sxy / sxx;
                intercept = my - slope * mx;
                r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : null;
            }
        }
        return { points, slope, intercept, r2, totalSamples: W, meanRecovery, sampleCount: grandN };
    }

    let calibChartInstance = null;
    function renderCalibration(calib, basisLabel) {
        const readout = document.getElementById('calibReadout');
        const ctx = document.getElementById('calibChart');
        if (!ctx) return;

        if (readout) {
            const parts = [];
            if (basisLabel) parts.push(`<span class="text-cyan-400 font-bold">${basisLabel}</span> (n=${calib.sampleCount || 0})`);

            // 水準（平均回収）= 見直しの引き金。100%割れで赤＋警告。
            if (calib.meanRecovery !== null && calib.meanRecovery !== undefined) {
                const lvl = calib.meanRecovery * 100;
                const lvlColor = lvl >= 100 ? 'text-green-400' : 'text-red-400';
                const lvlTag = lvl >= 100 ? '黒字' : '赤字';
                let lvlStr = `平均回収 <strong class="${lvlColor}">${lvl.toFixed(0)}%（${lvlTag}）</strong>`;
                if (lvl < 100) lvlStr += ` <span class="text-red-400 font-bold">⚠️ EV式見直しの検討時期</span>`;
                parts.push(lvlStr);
            }

            // 傾き = 倍率の較正情報（見直しトリガーではない）
            if (calib.slope === null) {
                parts.push(`<span class="text-slate-500">傾き算出不可（各EV帯 n≧3 が2帯以上必要）</span>`);
            } else {
                const dev = Math.abs(calib.slope - 1);
                const color = dev <= 0.15 ? 'text-green-400' : (dev <= 0.4 ? 'text-yellow-400' : 'text-orange-400');
                const verdict = dev <= 0.15 ? '倍率も較正' : (dev <= 0.4 ? '倍率はやや圧縮' : '倍率は未較正（EVの大小は割引いて解釈）');
                parts.push(`傾き <strong class="${color}">${calib.slope.toFixed(2)}</strong> / R² ${calib.r2 !== null ? calib.r2.toFixed(2) : '-'} <span class="${color}">— ${verdict}</span>`);
            }

            readout.innerHTML = parts.join('　/　');
        }

        const evs = calib.points.map(p => p.ev);
        const xMin = evs.length ? Math.min(...evs, 0) : 0;
        const xMax = evs.length ? Math.max(...evs, 1.5) : 1.5;
        const idealLine = [{ x: xMin, y: xMin }, { x: xMax, y: xMax }];
        const datasets = [
            {
                type: 'scatter',
                label: '実測（EV帯）',
                data: calib.points.map(p => ({ x: p.ev, y: p.recovery, n: p.n })),
                backgroundColor: 'rgba(34, 211, 238, 0.85)',
                borderColor: '#22d3ee',
                pointRadius: calib.points.map(p => Math.min(18, 3 + Math.sqrt(p.n))),
                pointHoverRadius: calib.points.map(p => Math.min(20, 5 + Math.sqrt(p.n))),
                order: 0
            },
            {
                type: 'line',
                label: '完全較正 y=x',
                data: idealLine,
                borderColor: 'rgba(148, 163, 184, 0.8)',
                borderDash: [6, 6],
                pointRadius: 0,
                fill: false,
                order: 2
            }
        ];
        if (calib.slope !== null) {
            datasets.push({
                type: 'line',
                label: `回帰直線 (傾き ${calib.slope.toFixed(2)})`,
                data: [{ x: xMin, y: calib.slope * xMin + calib.intercept }, { x: xMax, y: calib.slope * xMax + calib.intercept }],
                borderColor: '#f59e0b',
                borderWidth: 2,
                pointRadius: 0,
                fill: false,
                order: 1
            });
        }

        if (calibChartInstance) calibChartInstance.destroy();
        calibChartInstance = new Chart(ctx.getContext('2d'), {
            type: 'scatter',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: TEXT_COLOR, usePointStyle: true } },
                    tooltip: {
                        callbacks: {
                            label: (c) => {
                                if (c.dataset.type === 'scatter') {
                                    const n = c.raw.n;
                                    return `予測EV ${c.parsed.x.toFixed(2)} / 実回収 ${(c.parsed.y * 100).toFixed(0)}% (n=${n})`;
                                }
                                return `${c.dataset.label}: ${(c.parsed.y * 100).toFixed(0)}%`;
                            }
                        }
                    }
                },
                scales: {
                    x: { title: { display: true, text: '予測EV（倍率）', color: TICK_COLOR }, ticks: { color: TICK_COLOR }, grid: { color: GRID_COLOR } },
                    y: { title: { display: true, text: '実回収率（倍率, 1.0=100%）', color: TICK_COLOR }, ticks: { color: TICK_COLOR }, grid: { color: GRID_COLOR } }
                }
            }
        });
    }

    let rankEvChartInstance = null;

    function initRankEvTabs(rows) {
        const tabs = document.querySelectorAll('.rank-tab-btn');
        tabs.forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', () => {
                document.querySelectorAll('.rank-tab-btn').forEach(b => {
                    b.classList.remove('bg-purple-600', 'text-white', 'shadow-lg');
                    b.classList.add('bg-slate-800', 'text-slate-300');
                });
                newBtn.classList.remove('bg-slate-800', 'text-slate-300');
                newBtn.classList.add('bg-purple-600', 'text-white', 'shadow-lg');
                
                const rank = newBtn.getAttribute('data-rank');
                renderRankEvAnalysis(rank, rows);
            });
        });
    }

    function renderRankEvAnalysis(rank, rows) {
        const rankRows = rows.filter(r => ratingOf(r) === rank);
        
        const stats = RANK_EV_BINS.map(b => ({
            label: b.label, count: 0, win: 0, top3: 0, invest: 0, return: 0
        }));

        rankRows.forEach(r => {
            const ev = evOf(r);
            const odds = oddsOf(r);
            const pos = finishOf(r);

            const binIdx = RANK_EV_BINS.findIndex(b => ev >= b.min && ev < b.max);
            if (binIdx !== -1) {
                stats[binIdx].count++;
                stats[binIdx].invest += 100;
                if (pos === 1) {
                    stats[binIdx].win++;
                    stats[binIdx].return += odds * 100;
                }
                if (pos <= 3) {
                    stats[binIdx].top3++;
                }
            }
        });

        const labels = stats.map(s => s.label);
        const counts = stats.map(s => s.count);
        const placeRates = stats.map(s => s.count > 0 ? (s.top3 / s.count) * 100 : 0.0);
        const recoveryRates = stats.map(s => s.invest > 0 ? (s.return / s.invest) * 100 : 0.0);

        const ctx = document.getElementById('rankEvChart');
        if (!ctx) return;
        if (rankEvChartInstance) rankEvChartInstance.destroy();
        
        rankEvChartInstance = new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        type: 'bar',
                        label: 'サンプル数',
                        data: counts,
                        backgroundColor: 'rgba(148, 163, 184, 0.2)',
                        borderColor: 'rgba(148, 163, 184, 0.4)',
                        borderWidth: 1,
                        yAxisID: 'y1',
                        order: 3
                    },
                    {
                        type: 'line',
                        label: '複勝率 (%)',
                        data: placeRates,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: '#3b82f6',
                        yAxisID: 'y',
                        order: 0
                    },
                    {
                        type: 'line',
                        label: '単勝回収率 (%)',
                        data: recoveryRates,
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.08)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 4,
                        pointBackgroundColor: '#f59e0b',
                        yAxisID: 'y',
                        order: 2
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: TEXT_COLOR, usePointStyle: true } }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'EV帯', color: TICK_COLOR },
                        ticks: { color: TICK_COLOR },
                        grid: { color: GRID_COLOR }
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        title: { display: true, text: '率 (%)', color: TICK_COLOR },
                        min: 0,
                        ticks: { color: TICK_COLOR, callback: v => v + '%' },
                        grid: { color: GRID_COLOR }
                    },
                    y1: {
                        type: 'linear',
                        position: 'right',
                        title: { display: true, text: 'サンプル数', color: TICK_COLOR },
                        min: 0,
                        ticks: { color: TICK_COLOR, stepSize: 1 },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    }

    // --- Markdown Export ---
    function generateUltimateMarkdown(risk, stats, recStats, outliers, simulatedRaces) {
        let md = `# SS-Analyzer Ultimate 解析レポート

`;
        md += `## 1. リスク・収支ダッシュボード（シミュレーションベース）
`;
        md += `- 全体回収率: **${risk.roi.toFixed(1)}%**
`;
        md += `- 最大ドローダウン: **-${risk.mdd.toLocaleString()}円 (${risk.mddRate.toFixed(1)}%)**
`;
        md += `- 平均CLV: **${risk.avgClv.toFixed(3)}**
`;
        md += `- 対象レース数: ${risk.raceCount} / 馬頭数: ${risk.horseCount}
`;
        const bootCI = risk.winRoiBootstrapCI95;
        md += `- 単勝回収率 95%CI（ブートストラップ）: ${bootCI ? `${bootCI.lo.toFixed(1)}%〜${bootCI.hi.toFixed(1)}%` : 'サンプル不足(n<10)'}
`;
        const tss = risk.timeSplitStability;
        const fmtHalf = (h) => h ? `ROI ${h.roi.toFixed(1)}% (n=${h.n})` : 'データなし';
        md += `- 時系列安定性: 前半${tss && tss.firstHalf ? ` ${fmtHalf(tss.firstHalf)}` : ' データなし'} ／ 後半${tss && tss.secondHalf ? ` ${fmtHalf(tss.secondHalf)}` : ' データなし'}

`;

        md += `## 2. クラス別詳細レポート
`;
        md += `| クラス | サンプル | 的中率 | 的中率95%CI | 連対率 | 複勝率 | 回収率 | EV |
|---|---|---|---|---|---|---|---|
`;
        const fmtCIPct = (ci) => ci ? `${(ci.lo * 100).toFixed(1)}〜${(ci.hi * 100).toFixed(1)}%` : '-';
        stats.forEach(s => {
            md += `| ${s.cls} | ${s.sample} | ${s.winRate.toFixed(1)}% (${s.wins}/${s.sample}) | ${fmtCIPct(s.winRateCI95)} | ${s.top2Rate.toFixed(1)}% (${s.top2}/${s.sample}) | ${s.top3Rate.toFixed(1)}% (${s.top3}/${s.sample}) | ${s.roi.toFixed(1)}% | ${s.avgEv.toFixed(3)} |
`;
        });

        md += `
## 3. 推奨度別パフォーマンス（シミュレーション: SSS/SS/S/Low）
`;
        const fmtHitRateMd = (hits, total) => total > 0 ? `${(hits / total * 100).toFixed(1)}% (${hits}/${total})` : '-';
        md += `| 推奨度 | レース数 | 単勝投資 | 単勝的中率 | 単勝的中率95%CI | 単勝回収率 | 三連複投資 | 三連複的中率 | 三連複回収率 | 合算投資 | 合算回収率 |
|---|---|---|---|---|---|---|---|---|---|---|
`;
        recStats.forEach(s => {
            md += `| ${s.rec} | ${s.raceCount} | ${s.winInvest.toLocaleString()}円 | ${fmtHitRateMd(s.winHits, s.winBetRaces)} | ${fmtCIPct(s.winRateCI95)} | ${s.winROI.toFixed(1)}% | ${s.trioInvest.toLocaleString()}円 | ${fmtHitRateMd(s.trioHits, s.trioBetRaces)} | ${s.trioROI.toFixed(1)}% | ${s.totalInvest.toLocaleString()}円 | ${s.totalROI.toFixed(1)}% |
`;
        });

        md += `
## 4. 異常値（Outlier）分析リスト
`;
        if (outliers.length > 0) {
            md += `| 日付 | レース | 馬名 | EV | 着順 |
|---|---|---|---|---|
`;
            outliers.slice(0, 10).forEach(o => {
                md += `| ${o["日付"]} | ${o["レース名"]} | ${o["馬名"]} | ${parseFloat(o["購入時期待値"]).toFixed(2)} | **${o["着順"]}** |
`;
            });
            if (outliers.length > 10) md += `*他 ${outliers.length - 10} 件の異常値を検出*
`;
        } else {
            md += `*顕著な異常値は検出されませんでした。*
`;
        }

        // ここまでの md = データ本体（リスク指標・クラス別・推奨度別・異常値）。両AI共通で先頭に付ける。
        const reportBody = md;

        const specBlock = `
---
### ◤ SS-Engine 現行仕様（前提）◢
- スコア: S=100, A=65, B=40, C=20, D=10, E=3, F=0.5
- 予想勝率 = 自スコア ÷ 出走全馬スコア合計（オッズ>0の馬のみ）
- 期待値EV = 予想勝率 × 単勝オッズ（小数第3位以下を切り捨て）
- クラス分類（評価ランク × EV帯）:
  - S0: S かつ EV<0.700 ／ S1: S かつ 0.700〜0.999 ／ S2: S かつ 1.200〜1.499
  - A0: A かつ EV<0.600 ／ A1: A かつ 0.600〜0.899 ／ A2: A かつ 1.000〜1.250 ／ A3: A かつ 1.500〜1.699
  - B0+: B かつ EV≦0.500 ／ B0: B かつ 0.500〜0.900 ／ B1: B かつ 1.100〜1.350 ／ B2: B かつ 1.500〜1.699 ／ B3: B かつ 2.000〜4.500
  - X: D かつ 3.000〜3.999 ／ D1: D かつ 1.300〜1.799
  - 上記いずれにも該当しなければ N（買い目対象外）
- 系統: Place-Core/軸・防御 = {S0,S1,S2,A0,B0+,A1,B0}／ Win-Core/攻撃 = {A3,B2,A2,B1,D1,B3,X}
- MAO（最低必要オッズ）: 防御系=0.60÷勝率, 攻撃系(B1,B2,B3,A2,A3)=0.90÷勝率, X=3.00÷勝率, D1=1.00÷勝率
- 琥珀監査(Amber)通過条件: X・D1 → オッズ≧MAO ／ その他 → オッズ≧MAO×1.2
- SS密度 = (EV≧1.300 かつ 評価∈{S,A,B,D} の頭数) ÷ max(12, 出走頭数)
- 推奨度: 密度≧0.250 かつ S0/S1あり→SSS ／ 密度≧0.250 かつ 軸あり→SS ／ 密度≧0.150→S ／ それ未満→Low
- 三連複の執行判定: 軸不在、または 密度 <（重賞0.10 / 平場0.15）なら SKIP
- 単勝ユニット配分: SSS(A3=6,B2=4,他=2) ／ SS(A3=5,B2=3,他=2) ／ S(A3=3,B2=2,他=1) ／ Low(すべて1)
`;

        // 詳細なレース別データは「AI分析用データ出力 (JSON)」ボタンで出力したファイルを
        // 各AIのチャットに添付して渡す運用。コピーには文字数節約のためJSONを含めない。

        // ① 提案用（Gemini に貼る）
        const geminiMd = reportBody + specBlock + `
---
## 🟦 あなたの役割: 改善提案者（ステップ①）

あなたは競馬投資モデル「SS-Engine」の定量アナリストです。上の現行仕様と実績データ、および添付JSON（ss_feedback_data.json: summary / evaluationPerformance / recommendationPerformance / densityPerformance / amberAudit / oddsBinAnalysis / classPerformance / evCalibration）に基づき、パラメータ改善案を提案してください。あなたの提案は次段階で別のAIが厳格に検証します。根拠の数値とサンプル数が無い提案はすべて却下されます。

### 手順（この順で実行）
1. 【最優先・H2】evCalibration.winCore.slope を確認し、値と判定を回答の最初に宣言する（0.85〜1.15なら較正OK。範囲外なら、個別パラメータの調整より先に EV計算式＝スコア配点・予想勝率算出の補正を提案の第1候補にする。all は N等を含む参考値）。
2. クラス別・推奨度別・EV帯別・オッズ帯別の表から、回収率が明確に高い／低いセグメントを特定する。必ずサンプル数 n を併記する。表に95%信頼区間（CI）がある場合は必ず考慮し、CIが100%を跨ぐ回収率・区間が広すぎる的中率を根拠の中心にしない。
3. 変更すべきパラメータ（クラス境界EV、MAO係数、Amber係数、SS密度閾値、ユニット配分、三連複SKIP条件）を「現行値 → 提案値」の具体的な数値で提案する。

### 制約
- 提案は優先度順に最大7件。それ以上は出さない。
- n<30 のセグメントのみを根拠とする提案は原則出さない。どうしても出す場合は信頼度を「低」とし、n を明記する。
- 数値根拠のない定性的提案・一般論は禁止。
- 資金管理は定額フラット（1U=100円）＋1レース投入上限キャップが確定方針。ケリー比例・変動ベットの提案は禁止（上限キャップ値の調整提案は可）。
- 現行仕様の枠外のアイデア（新指標・新データ源など）は、最後に「追加検討（仕様外）」として最大2件まで分けて書く。
- 前置き・全体要約・挨拶は不要。次の出力形式のみで回答する。

### 出力形式（厳守）
1行目: 「EV較正判定: slope=（値） → OK／要補正」
続けて各提案:

【提案N】（信頼度: 高／中／低）
- 対象: パラメータ名
- 現行値 → 提案値:
- 根拠: 参照した表・JSONフィールド名と数値（n=サンプル数 必須）
- 期待効果: 何がどれだけ改善する見込みか
- 副作用リスク: 想定される悪影響

この回答全文をコピーし、次に「Claude用コピー」を貼ったClaudeチャットの末尾に貼り付けてください。
`;

        // ②③ 検証・統合用（Claude に貼る）
        const claudeMd = reportBody + specBlock + `
---
## 🟧 あなたの役割: 改善案の検証者・統合者（ステップ②→③）

あなたは競馬投資モデル「SS-Engine」の保守的なリスク管理者です。上の現行仕様・実績データ（添付のレース別データJSONがあればそれも）と、このメッセージ末尾に貼り付けられたGeminiの提案リストを査定してください。あなたの仕事は良い提案を通すことではなく、悪い変更からモデルを守ることです。提案の全件採用は検証の失敗とみなします。データが変更を強く支持しない限り「現状維持」が正解です。

【ステップ②: 検証】各提案を個別に査定する。
判定軸:
1. 統計的妥当性: 根拠の n は十分か（n<30は要注意、n<10は原則却下）。回収率の差はその n で偶然生じうる範囲ではないか。単勝回収率は高オッズ的中1本で大きく振れる点に特に注意する。95%CIが併記されている場合は区間で判断する（点推定の差ではなくCIの重なり・100%跨ぎを確認）。
2. 多重比較: クラス×EV帯×オッズ帯を総当たりで眺めれば偶然の凸凹は必ず見つかる。そのセグメントに構造的な理由（オッズ市場の歪み、ロジック上の必然）を説明できない提案は割り引く。
3. 過学習リスク: 特定期間・特定会場・特定条件への過剰適合ではないか。今後のレースにも汎化するか。
4. 内部整合性: クラス境界の連続性（変更で隙間・重複が生じないか）、MAO／Amber／SS密度／推奨度の定義との矛盾、単勝ユニット配分との整合。
5. 副作用: 他クラス・的中率・最大ドローダウン・買い目件数への影響。
6. H2優先則: evCalibration.winCore.slope が 0.85〜1.15 を外れている場合、EV計算式本体の補正を最優先で扱い、個別境界の微調整は保留に回す。

各提案の判定は「採用／条件付き採用（修正内容を明記）／保留（次回データで検証。検証条件を明記）／却下」＋理由（2〜4行）。Geminiが付けた信頼度は参考にとどめ、必ず自分で元の表の数値を確認して判定する。

【ステップ③: 統合】← ②の直後、この同じチャットでそのまま続けて実行
②の査定を踏まえ「実際にコードへ反映する最終変更リスト」を作る。
- 最大5件。確度の高いものだけに絞る。0件（今回は変更なし）も正当な結論。
- 各項目の形式: 対象パラメータ／現行値 → 最終値／採用理由（根拠データの要約）／想定リスクと撤退条件（次回データがどうなったら元に戻すか）
- 最後に「次回データで検証すべき仮説」を箇条書きで示す（②で保留にした提案を必ず含める）。

もし末尾にGeminiの提案が貼られていない場合は、査定を行わず「Geminiの提案（ステップ①の回答）を貼り付けてください」とだけ返答する。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
↓↓↓ ここに Gemini の提案（ステップ①の回答）を貼り付け ↓↓↓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;

        return { gemini: geminiMd, claude: claudeMd };
    }
    // --- Others ---
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

        // レース間に空行を挿入
        const outputRows = [];
        let lastRaceId = "";
        sortedData.forEach(row => {
            const currentRaceId = getRaceId(row);
            if (lastRaceId !== "" && lastRaceId !== currentRaceId) {
                outputRows.push(Array(EXPECTED_HEADERS.length).fill(""));
            }
            outputRows.push(EXPECTED_HEADERS.map(h => row[h] || ""));
            lastRaceId = currentRaceId;
        });

        const csvContent = Papa.unparse({ fields: EXPECTED_HEADERS, data: outputRows });
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });

        // 最新日付をファイル名に含める
        const dates = sortedData.map(d => d["日付"]).filter(d => d && d !== "Legacy").sort();
        const latestDate = dates.length > 0 ? dates[dates.length - 1] : new Date().toISOString().split('T')[0];
        const safeDate = latestDate.replace(/\//g, '-');

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `SS_Integrated_${safeDate}.csv`;
        link.click();
        showToast(`統合CSV出力完了 (最新: ${latestDate})`);
    });

    const copyTextarea = (el, label) => {
        if (!el || !el.value) { showToast("先に解析を実行してください"); return; }
        el.focus();
        el.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        if (ok) {
            showToast(`${label}をコピーしました`);
        } else if (navigator.clipboard) {
            navigator.clipboard.writeText(el.value)
                .then(() => showToast(`${label}をコピーしました`))
                .catch(() => showToast("コピーに失敗しました"));
        } else {
            showToast("コピーに失敗しました");
        }
        window.getSelection().removeAllRanges();
    };

    if (copyGeminiBtn) copyGeminiBtn.addEventListener('click', () => copyTextarea(geminiOutput, "Gemini用"));
    if (copyClaudeBtn) copyClaudeBtn.addEventListener('click', () => copyTextarea(claudeOutput, "Claude用"));

    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
});
