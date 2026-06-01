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

        const recStats = calculateRecommendationStats(simulatedRaces);
        renderRecommendationTable(recStats);

        drawEquityCurve(simulatedRaces);

        const outliers = detectOutliers(rowsWithRank);
        renderOutliers(outliers);

        const md = generateUltimateMarkdown(riskStats, classStats, recStats, outliers);
        geminiOutput.value = md;

        makeTableSortable(document.querySelector('#analysisResultArea table'));
        makeTableSortable(document.querySelector('#recommendationResultArea table'));
    }

    const WIN_CORE_CLASSES = ['X', 'B1', 'D1', 'B2', 'B3', 'A2', 'B0+'];
    const PLACE_CORE_CLASSES_FULL = ['S0', 'S1', 'S2', 'A0', 'B0+', 'A1', 'C0', 'B0'];
    const AXIS_CLASSES = ['S0', 'S1', 'S2', 'A0', 'B0+', 'A1', 'C0'];
    const WIN_PRIORITY = ['X', 'B1', 'D1', 'B2', 'B3', 'A2', 'B0+'];
    const TRIO_ROW2_DEFENSE = ['S0', 'S1', 'S2', 'A0', 'A1', 'B0+'];
    const TRIO_ROW2_ATTACK = ['B1', 'B2', 'X', 'D1', 'B3', 'A2'];

    function enrichHorses(horses) {
        let totalScore = 0;
        horses.forEach(h => {
            let score = 0;
            const r = (h["評価"] || "").toUpperCase().trim();
            const odds = parseFloat(h["最終確定オッズ"]) || parseFloat(h["購入時オッズ"]) || 0;
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
            totalScore += score;
        });

        horses.forEach(h => {
            h.expectedWinRate = totalScore > 0 ? h.score / totalScore : 0;
            const cls = (h["最終確定クラス"] || h["購入時クラス"] || "").trim();
            const odds = parseFloat(h["最終確定オッズ"]) || parseFloat(h["購入時オッズ"]) || 0;
            
            let mao = 999;
            if (h.expectedWinRate > 0) {
                if (PLACE_CORE_CLASSES_FULL.includes(cls)) mao = 0.50 / h.expectedWinRate;
                else if (['B1', 'B2', 'B3', 'A2'].includes(cls)) mao = 0.90 / h.expectedWinRate;
                else if (cls === 'X') mao = 3.00 / h.expectedWinRate;
                else if (cls === 'D1') mao = 1.00 / h.expectedWinRate;
            }
            h.calculatedMao = mao;
            
            let amberPass = false;
            if (cls === 'X' || cls === 'D1') {
                amberPass = odds >= mao;
            } else {
                amberPass = odds >= (mao * 1.2);
            }
            h.amberPass = amberPass;
        });
        return horses;
    }

    function calculateSSDensity(raceHorses) {
        const qualifiedCount = raceHorses.filter(h => {
            const ev = parseFloat(h["最終確定期待値"]) || parseFloat(h["購入時期待値"]) || 0;
            const rating = (h["評価"] || "").toUpperCase().trim();
            return ev >= 1.300 && ['S', 'A', 'B', 'D'].includes(rating);
        }).length;
        const validCount = raceHorses.filter(h => (parseFloat(h["最終確定オッズ"]) || parseFloat(h["購入時オッズ"]) || 0) > 0).length;
        const denominator = Math.max(12, validCount);
        return qualifiedCount / denominator;
    }

    function determineRecommendation(raceHorses) {
        const density = calculateSSDensity(raceHorses);
        const classes = raceHorses.map(h => (h["最終確定クラス"] || h["購入時クラス"] || "").trim());
        const hasS0orS1 = classes.some(c => c === 'S0' || c === 'S1');
        const hasAxis = classes.some(c => AXIS_CLASSES.includes(c));

        if (density >= 0.250 && hasS0orS1) return 'SSS';
        if (density >= 0.250 && hasAxis) return 'SS';
        if (density >= 0.150) return 'S';
        return 'Low';
    }

    function simulateRace(raceHorses, raceId) {
        raceHorses = enrichHorses(raceHorses);
        const classes = raceHorses.map(h => (h["最終確定クラス"] || h["購入時クラス"] || "").trim());
        const density = calculateSSDensity(raceHorses);
        
        const hasAxis = classes.some(c => AXIS_CLASSES.includes(c));
        const isGraded = raceHorses[0] && ((raceHorses[0]["グレード・頭数"] || "").includes("G") || (raceHorses[0]["グレード・頭数"] || "").includes("重賞"));
        const minDensity = isGraded ? 0.100 : 0.150;
        const skipTrio = !hasAxis || density < minDensity;

        let winCandidates = raceHorses.filter(h => h.amberPass && WIN_PRIORITY.includes((h["最終確定クラス"] || h["購入時クラス"] || "").trim()));
        winCandidates.sort((a, b) => {
            const clsA = (a["最終確定クラス"] || a["購入時クラス"] || "").trim();
            const clsB = (b["最終確定クラス"] || b["購入時クラス"] || "").trim();
            const pA = WIN_PRIORITY.indexOf(clsA);
            const pB = WIN_PRIORITY.indexOf(clsB);
            if (pA !== pB) return pA - pB;
            const evA = parseFloat(a["最終確定期待値"]) || 0;
            const evB = parseFloat(b["最終確定期待値"]) || 0;
            if (Math.abs(evA - evB) <= 0.100) return parseInt(b["馬番"]) - parseInt(a["馬番"]);
            return evA - evB; 
        });

        let finalWinBets = [];
        for (let h of winCandidates) {
            if (finalWinBets.length >= 2) break;
            const umaban = parseInt(h["馬番"]);
            const cls = (h["最終確定クラス"] || h["購入時クラス"] || "").trim();
            if (umaban >= 13 && ['A1', 'S2', 'A0'].includes(cls)) continue;
            finalWinBets.push(h);
        }

        let finalTrioCombos = [];
        if (!skipTrio) {
            let axisCandidates = raceHorses.filter(h => AXIS_CLASSES.includes((h["最終確定クラス"] || h["購入時クラス"] || "").trim()));
            axisCandidates.sort((a, b) => {
                const pA = AXIS_CLASSES.indexOf((a["最終確定クラス"] || a["購入時クラス"] || "").trim());
                const pB = AXIS_CLASSES.indexOf((b["最終確定クラス"] || b["購入時クラス"] || "").trim());
                if (pA !== pB) return pA - pB;
                return parseInt(a["馬番"]) - parseInt(b["馬番"]);
            });
            let axisHorse = axisCandidates.length > 0 ? axisCandidates[0] : null;

            if (axisHorse) {
                let row2Defense = raceHorses.filter(h => h !== axisHorse && TRIO_ROW2_DEFENSE.includes((h["最終確定クラス"] || h["購入時クラス"] || "").trim()));
                row2Defense.sort((a, b) => {
                    const pA = TRIO_ROW2_DEFENSE.indexOf((a["最終確定クラス"] || a["購入時クラス"] || "").trim());
                    const pB = TRIO_ROW2_DEFENSE.indexOf((b["最終確定クラス"] || b["購入時クラス"] || "").trim());
                    if (pA !== pB) return pA - pB;
                    return parseInt(a["馬番"]) - parseInt(b["馬番"]);
                });
                row2Defense = row2Defense.slice(0, 2);

                let row2Attack = raceHorses.filter(h => h !== axisHorse && TRIO_ROW2_ATTACK.includes((h["最終確定クラス"] || h["購入時クラス"] || "").trim()));
                row2Attack.sort((a, b) => {
                    const pA = TRIO_ROW2_ATTACK.indexOf((a["最終確定クラス"] || a["購入時クラス"] || "").trim());
                    const pB = TRIO_ROW2_ATTACK.indexOf((b["最終確定クラス"] || b["購入時クラス"] || "").trim());
                    if (pA !== pB) return pA - pB;
                    const evA = parseFloat(a["最終確定期待値"]) || 0;
                    const evB = parseFloat(b["最終確定期待値"]) || 0;
                    if (Math.abs(evA - evB) <= 0.100) return parseInt(b["馬番"]) - parseInt(a["馬番"]);
                    return evA - evB;
                });
                row2Attack = row2Attack.slice(0, 1);

                let row2 = [...row2Defense, ...row2Attack];
                let row3 = new Set([...row2]);
                
                raceHorses.filter(h => (h["評価"] || "").toUpperCase().trim() === 'S').forEach(h => row3.add(h));
                raceHorses.filter(h => TRIO_ROW2_ATTACK.includes((h["最終確定クラス"] || h["購入時クラス"] || "").trim())).forEach(h => row3.add(h));
                
                let c0 = raceHorses.filter(h => (h["最終確定クラス"] || h["購入時クラス"] || "").trim() === 'C0');
                c0.sort((a, b) => parseInt(a["馬番"]) - parseInt(b["馬番"]));
                c0.forEach(h => row3.add(h));

                let nClasses = raceHorses.filter(h => (h["最終確定クラス"] || h["購入時クラス"] || "").trim() === 'N' || (h["最終確定クラス"] || h["購入時クラス"] || "").trim() === '');
                nClasses.sort((a, b) => {
                    if (a.expectedWinRate !== b.expectedWinRate) return b.expectedWinRate - a.expectedWinRate;
                    return parseInt(b["馬番"]) - parseInt(a["馬番"]);
                });
                nClasses.forEach(h => row3.add(h));

                row3.delete(axisHorse);
                let row3Array = Array.from(row3).slice(0, 10);

                row2.forEach(h2 => {
                    row3Array.forEach(h3 => {
                        if (h2 !== h3 && h2 !== axisHorse && h3 !== axisHorse) {
                            const trio = [parseInt(axisHorse["馬番"]), parseInt(h2["馬番"]), parseInt(h3["馬番"])].sort((a,b) => a-b).join('-');
                            if (!finalTrioCombos.includes(trio)) finalTrioCombos.push(trio);
                        }
                    });
                });
            }
        }

        let winReturn = 0;
        finalWinBets.forEach(h => {
            if (parseInt(h["着順"]) === 1) winReturn += (parseFloat(h["最終確定オッズ"]) || 0) * 100;
        });

        let trioReturn = 0;
        let trioHit = false;
        const winners = raceHorses.filter(h => parseInt(h["着順"]) <= 3).map(h => parseInt(h["馬番"])).sort((a,b) => a-b);
        if (winners.length === 3) {
            const winningTrio = winners.join('-');
            if (finalTrioCombos.includes(winningTrio)) {
                trioHit = true;
                trioReturn = parseFloat(raceHorses[0]["三連複払戻"]) || 0;
            }
        }

        return {
            id: raceId,
            horses: raceHorses,
            rec: determineRecommendation(raceHorses),
            winInvest: finalWinBets.length * 100,
            winReturn: winReturn,
            trioInvest: finalTrioCombos.length * 100,
            trioReturn: trioReturn
        };
    }

    function calculateRiskMetrics(simulatedRaces) {
        let cumulative = 0;
        let peak = 0;
        let maxDD = 0;
        let totalInvest = 0;
        let totalReturn = 0;
        let clvTotal = 0;
        let clvCount = 0;

        const sortedData = [...simulatedRaces].sort((a,b) => a.id.localeCompare(b.id));

        sortedData.forEach(r => {
            const invest = r.winInvest + r.trioInvest;
            const p = r.winReturn + r.trioReturn;
            totalInvest += invest;
            totalReturn += p;
            cumulative += (p - invest);
            if (cumulative > peak) peak = cumulative;
            const dd = peak - cumulative;
            if (dd > maxDD) maxDD = dd;

            r.horses.forEach(h => {
                const fo = parseFloat(h["最終確定オッズ"]);
                const po = parseFloat(h["購入時オッズ"]) || fo;
                if (fo > 0) { clvTotal += (po / fo); clvCount++; }
            });
        });

        return {
            raceCount: simulatedRaces.length,
            horseCount: simulatedRaces.reduce((acc, r) => acc + r.horses.length, 0),
            roi: totalInvest > 0 ? (totalReturn / totalInvest) * 100 : 0,
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

    function calculateRecommendationStats(simulatedRaces) {
        const order = ['SSS', 'SS', 'S', 'Low'];
        return order.map(rec => {
            const races = simulatedRaces.filter(r => r.rec === rec);
            const raceCount = races.length;
            if (raceCount === 0) return { rec, raceCount: 0, winInvest: 0, winROI: 0, trioInvest: 0, trioROI: 0, totalInvest: 0, totalROI: 0 };

            let winInvest = 0;
            let winReturn = 0;
            let trioInvest = 0;
            let trioReturn = 0;

            races.forEach(r => {
                winInvest += r.winInvest;
                winReturn += r.winReturn;
                trioInvest += r.trioInvest;
                trioReturn += r.trioReturn;
            });

            const winROI = winInvest > 0 ? (winReturn / winInvest) * 100 : 0;
            const trioROI = trioInvest > 0 ? (trioReturn / trioInvest) * 100 : 0;
            const totalInvest = winInvest + trioInvest;
            const totalROI = totalInvest > 0 ? ((winReturn + trioReturn) / totalInvest) * 100 : 0;

            return { rec, raceCount, winInvest, winROI, trioInvest, trioROI, totalInvest, totalROI };
        }).filter(s => s.raceCount > 0);
    }

    function renderRecommendationTable(stats) {
        const recColors = { 'SSS': 'text-yellow-300', 'SS': 'text-orange-400', 'S': 'text-blue-400', 'Low': 'text-slate-400' };
        let html = `
            <div class="overflow-x-auto">
                <table class="analysis-table w-full text-sm">
                    <thead>
                        <tr>
                            <th>推奨度</th>
                            <th>レース数</th>
                            <th>単勝投資</th>
                            <th>単勝回収率</th>
                            <th>三連複投資</th>
                            <th>三連複回収率</th>
                            <th>合算投資額</th>
                            <th>合算回収率</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${stats.map(s => `
                            <tr>
                                <td class="font-bold ${recColors[s.rec] || ''}">${s.rec}</td>
                                <td>${s.raceCount}</td>
                                <td>${s.winInvest.toLocaleString()}円</td>
                                <td class="${s.winROI >= 100 ? 'text-green-400 font-bold' : ''}">${s.winROI.toFixed(1)}%</td>
                                <td>${s.trioInvest.toLocaleString()}円</td>
                                <td class="${s.trioROI >= 100 ? 'text-green-400 font-bold' : ''}">${s.trioROI.toFixed(1)}%</td>
                                <td>${s.totalInvest.toLocaleString()}円</td>
                                <td class="${s.totalROI >= 100 ? 'text-green-400 font-bold' : ''}">${s.totalROI.toFixed(1)}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
        recommendationResultArea.innerHTML = html;
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
    function drawEquityCurve(simulatedRaces) {
        const sorted = [...simulatedRaces].sort((a,b) => a.id.localeCompare(b.id));
        const labels = [];
        const expData = [];
        const actData = [];
        let cumExp = 0; let cumAct = 0;

        sorted.forEach((r, idx) => {
            r.horses.forEach(h => {
                cumExp += (parseFloat(h["最終確定期待値"]) || 0) * 100;
            });
            cumAct += r.winReturn + r.trioReturn - (r.winInvest + r.trioInvest);
            
            labels.push(`R${idx+1}`);
            expData.push(cumExp);
            actData.push(cumAct);
        });

        if (equityChartInstance) equityChartInstance.destroy();
        equityChartInstance = new Chart(document.getElementById('equityChart').getContext('2d'), {
            type: 'line',
            data: { labels, datasets: [
                { label: '期待累積収支(全馬理論)', data: expData, borderColor: '#3b82f6', tension: 0.1, pointRadius: 0 },
                { label: '実績累積収支(シミュレーション)', data: actData, borderColor: '#10b981', fill: true, backgroundColor: 'rgba(16, 185, 129, 0.1)', tension: 0.1, pointRadius: 0 }
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
    function generateUltimateMarkdown(risk, stats, recStats, outliers) {
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

        md += `## 2. クラス別詳細レポート (Kelly推奨率)
`;
        md += `| クラス | サンプル | 的中率 | 複勝率 | 回収率 | EV | Kelly% |
|---|---|---|---|---|---|---|
`;
        stats.forEach(s => {
            md += `| ${s.cls} | ${s.sample} | ${s.winRate.toFixed(1)}% | ${s.top3Rate.toFixed(1)}% | ${s.roi.toFixed(1)}% | ${s.avgEv.toFixed(3)} | **${s.kelly.toFixed(1)}%** |
`;
        });

        md += `
## 3. 推奨度別パフォーマンス（シミュレーション: SSS/SS/S/Low）
`;
        md += `| 推奨度 | レース数 | 単勝投資 | 単勝回収率 | 三連複投資 | 三連複回収率 | 合算投資 | 合算回収率 |
|---|---|---|---|---|---|---|---|
`;
        recStats.forEach(s => {
            md += `| ${s.rec} | ${s.raceCount} | ${s.winInvest.toLocaleString()}円 | ${s.winROI.toFixed(1)}% | ${s.trioInvest.toLocaleString()}円 | ${s.trioROI.toFixed(1)}% | ${s.totalInvest.toLocaleString()}円 | ${s.totalROI.toFixed(1)}% |
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

        md += `
---
### ✨ Gemini 3 解析プロンプト
`;
        md += `上記の「リスク管理指標」「推奨度別成績」「異常値リスト」に基づき、以下の点を詳細に分析してください。
`;
        md += `1. 回収率を上げるために除外すべきクラスや推奨度、または特定の環境条件（会場・距離）は存在するか。
`;
        md += `2. 異常値リストに共通する特徴（例：特定の会場での期待値暴落、あるいはMAOフィルターの漏れ）を特定してください。
`;
        md += `3. 最大ドローダウンを 10% 以下に抑えつつ、利益を最大化するための資金配分（ケリー基準の調整案）を提案してください。`;

        return md;
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
