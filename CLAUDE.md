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

## よくある作業
- バックテスト・集計ロジックの変更 → `analyzer.js`（`EXPECTED_HEADERS`, `HYPOTHESIS_REGISTRY`, フィルタ・シミュレーター関数群）
- 新パラメータの効果測定 → analyzer.jsの集計を使う。Python版バックテスト（`.secretary/research/backtest/` 配下、日付スナップショット）と二重管理になっている場合は最新スペック版か確認
- CSVフォーマット変更・払戻パース修正 → `analyzer.js` 内の `evOf`/`clsOf`/`oddsOf`/`buyOddsOf` 等の共通アクセサ、および払戻パース処理
