# ss-analyzer

`ss-engine-v2` で運用した競馬単勝予想の結果CSVを読み込み、バックテスト・統計解析・シミュレーションを行うWebアプリ（SS-Analyzer Ultimate v3.0）。姉妹プロジェクトは `ss-engine-v2`（予想生成側）。

## 構成
- `index.html` — フロントエンドUI（Chart.js, PapaParse）
- `analyzer.js` — 統合ロジック本体。CSV読込・フィルタリング・クラス別バックテスト集計・シミュレーター・仮説登録簿(HYPOTHESIS_REGISTRY)・AI向けレポート出力
- `style.css` — カスタムスタイル

## 制約・注意
- **現行仕様の正はこのリポジトリではなく、Obsidianの `SS-Engine_v5.34_ロジック仕様書_2026-07-19.md`**（2026-07時点）。エンジン側(logic.js)とロジックを一致させる必要がある箇所（クラス境界・ユニット配分など）は必ずこれを確認する。
- 想定CSVヘッダーは `EXPECTED_HEADERS` 定数で固定（日付, レース名, コース詳細, 馬番, 購入時期待値, 購入時クラス, 着順, MAO, 実行フラグ, 単勝払戻 等）。ss-engine-v2側の出力フォーマット変更時はここも同時に直す。2026-07時点で `NEW_OPTIONAL_COLUMNS`（発走時刻・天候・馬場状態など9列）が末尾に追加され後方互換。
- **`classPerformance.winRecoveryRate` はフラット買い診断値であり、実際の投資額に基づく回収率ではない**。この誤認が頻発しているので、実運用成績を語る箇所では必ず `liveOnlyView`（実行フラグ記録済みレースのみ・2026-07時点で実装済み）を使うこと。全期間の値には紙上シミュ期間の上振れが混入している。
- CSV単勝払戻列は2026-06-06以降 `馬番: 金額円` 形式に変化。コロンを無視して連結パースすると桁が化けるバグが過去にあった（`parseColonPayout` で修正済み、同種の列を新規に扱う際は要注意）。
- `enrichHorses` はCSVのクラス/EV列を無視し、評価×購入時オッズから現行ロジックで再計算・上書きする。CSV生ラベルとJSON集計は一致しないことがある点に注意。
- ロジック仕様を変更したら analyzer.js の SPEC_BLOCK と SPEC_UPDATED（仕様更新日）を必ずセットで更新する。
- 集計フィールドの母集団定義は `DATA_DICT_BLOCK`（AIプロンプトに挿入）と `jsonPayload._dataDictionary`（JSON先頭に埋め込み）の2箇所にある。集計ロジックを変えたら両方＋SPEC_BLOCKを更新する。この辞書は外部AI（Gemini/Claude）の母集団取り違えを防ぐためのもの。

## R3（小資金モード）の分析機能 — 2026-09-14追加
- **単勝選定ロジックの唯一の実装は `selectWinBets()`**。simulateRace と反実仮想シミュレーターの両方がこれを呼ぶ。優先順位・壁フィルター・Amberの扱いを変える時はここだけを直す（選定を別実装しない）。単勝払戻の決定も `derivePayoutPerUnit()` の1実装に集約済み。
- `smallBankSimulation.classBreakdown` … ★R3で【実際に買った1点目】のクラス別成績。`classPerformance`（クラス該当の全馬）とは母集団が違う。配下に evDetails（クラス内EV帯別）・gateSplit（馬番1〜12／13以上）・hitOdds（的中馬のオッズ一覧）。R3のクラス別の議論は必ずこちらを使う。`fullAllocation.classBreakdown` はフル配分で実際に買った馬（1点目に限らない）。
- `smallBankSimulation.concentration` … 払戻上位1本/3本を除いた損益。マイナスなら単発高配当依存。回収率を根拠にする前に必ず確認する。`recBreakdown`（推奨度別）と `hitOddsDistribution`（的中馬のオッズ帯分布）も同階層。
- `trifectaAxisPerformance` … 三連複の軸クラス別成績。防御系(Place-Core)クラスの取捨は複勝率ではなくこの表で判定する（h22）。executed=現行ルール(SSのみ執行)、reference=SKIPを無視して全部買った場合。
- `r3Variants` … R3反実仮想シミュレーター。同一レース群で「優先順位入替／クラスN降格／軸構成変更／ステーク配分／壁フィルター拡張」を実測し、baseline との deltaPnl・deltaMaxDrawdownUnits・classMix を返す。`evCutSweep` はクラス×EV境界の総当たり。**多重比較になるため、良く見えた1点だけを根拠に採用しない**（構造的な理由＋隣接境界の単調性が必要）。
- 反実仮想は実運用(liveOnly)レースで計算する。トップレベルの `r3Variants` は期間フィルタが「実運用のみ」の時だけ出力（liveOnlyView との重複回避）。
- 検証用ハーネス: analyzer.js は DOM前提のIIFEなので、Nodeで内部関数を叩くには DOM を再帰Proxyでスタブし、末尾の `});` 直前に export 行を注入して DOMContentLoaded コールバックを手動実行する。R3全体値が公式JSON（400点/188.07%/最大DD102.4U/最大連敗32）と一致するかを回帰確認に使う。

## よくある作業
- バックテスト・集計ロジックの変更 → `analyzer.js`（`EXPECTED_HEADERS`, `HYPOTHESIS_REGISTRY`, フィルタ・シミュレーター関数群）
- 新パラメータの効果測定 → analyzer.jsの集計を使う。Python版バックテスト（`.secretary/research/backtest/` 配下、日付スナップショット）と二重管理になっている場合は最新スペック版か確認
- CSVフォーマット変更・払戻パース修正 → `analyzer.js` 内の `evOf`/`clsOf`/`oddsOf`/`buyOddsOf` 等の共通アクセサ、および払戻パース処理
