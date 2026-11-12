# ss-analyzer

`ss-engine-v2` で運用した競馬単勝予想の結果CSVを読み込み、バックテスト・統計解析・シミュレーションを行うWebアプリ（SS-Analyzer Ultimate v3.0）。姉妹プロジェクトは `ss-engine-v2`（予想生成側）。

## 構成
- `index.html` — フロントエンドUI（Chart.js, PapaParse）
- `analyzer.js` — 統合ロジック本体。CSV読込・フィルタリング・クラス別バックテスト集計・シミュレーター・仮説登録簿(HYPOTHESIS_REGISTRY)・AI向けレポート出力
- `style.css` — カスタムスタイル

## 制約・注意
- **現行仕様の正はこのリポジトリではなく、Obsidianの `20_Projects/SS-Engine/Process/SS-Engine_v5.35_ロジック仕様書_2026-10-10.md`**（2026-10-10時点・2026-10-18・10-24追補で仮説h1〜h27と査定ルールまで集約。Vault実体は `C:\Users\abigr\Obsidian`）。エンジン側(logic.js)とロジックを一致させる必要がある箇所（クラス境界・ユニット配分など）は必ずこれを確認する。
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
- `trifectaAxisPerformance` … 三連複の軸クラス別成績。防御系(Place-Core)クラスの取捨は複勝率ではなくこの表で判定する（h22）。executed=現行ルール(SSのみ執行＋軸B0+はSKIP・v5.35)、reference=SKIPを無視して全部買った場合、axisRuleSkipped(SinceChange)=軸クラスSKIPで止めた分の仮想成績（h25の撤退判定用）、pnlExcludingTop1=最大1本を除いた損益、axisCls=ALL=アーム全体。
- `wideReference`（2026-10-24追加・h27）… ワイドの紙上成績（執行しない）。`simulateRace` が `refWide`（pickAxis=単勝1点目×軸／axisMates=軸→三連複の相手へ最大3点）を返し、`computeWideReference` が all（2026-06-06以降）と sinceRegistration（`WIDE_REF_FROM`=2026-10-19以降・判定用）に集計、withR3 でR3単勝だけの場合との損益差・DD差を出す。ワイド払戻は `parseWideMap`（'a-b: X円 / …' 形式＝2026-06-06以降のみ。それ以前の馬番なし3値は組が特定できないので使わない）。
- `r3Variants` … R3反実仮想シミュレーター。同一レース群で「優先順位入替／クラスN降格／軸構成変更／ステーク配分／壁フィルター拡張／レース条件別ステーク（cond-*: ダ1401m+・重賞の半減/SKIP、h26用。`stakeFn` で選定を変えずステークだけ動かす＝deltaSubstitution常に0）」を実測し、baseline との deltaPnl・deltaMaxDrawdownUnits・classMix・affectedBets（基準から変化したベット数）を返す。`evCutSweep` はクラス×EV境界の総当たり。**多重比較になるため、良く見えた1点だけを根拠に採用しない**（構造的な理由＋隣接境界の単調性が必要）。
- `smallBankSimulation.monthly`（2026-11-11追加・h31）… R3を月別に「現行ルールの遡及あり／なし」で並べる。retroR3／retroR3Flat1U は本体と同じ遡及シミュ、asFlaggedTop1Flat1U／asFlaggedAllFlat1U は CSV に記録された当時の判定（`enrichHorses` が上書き前に退避する `h._rawCls`／`h._rawEv`＋実行フラグ○）だけを使う1U均等買い。R3本体の累計回収率は、同じデータを見て決めたルールを遡って当てた値なので、実力の議論ではこちらを併記する。
- r3Variants の `density-noD`／`density-D1pass`（2026-11-11追加・h30）… SS密度の分子の定義を変えた場合。`calculateSSDensity(horses, countFn)`／`determineRecommendation(horses, axis, countFn)` に数える馬の述語を渡す。ステークだけが動き（選定は不変。ただし Low→S/SS で新たに買うベットは deltaSubstitution 側に入る）、`recShift` に推奨度の移動を出す。2026-11-12に `density-sep-q`（主候補: Dを外し、しきい値を件数合わせの0.125/0.0625へ）と `density-sep-167` を追加。`determineRecommendation` の第4引数 thresholds={ss,s} でしきい値を差し替える。各 density-* は `trifecta`（その推奨度で三連複を執行した場合）と `sinceRegistration`（2026-11-12以降だけの直接効果・三連複差＝h30の判定用）を持つ。
- 反実仮想は実運用(liveOnly)レースで計算する。トップレベルの `r3Variants` は期間フィルタが「実運用のみ」の時だけ出力（liveOnlyView との重複回避）。
- 検証用ハーネス: analyzer.js は DOM前提のIIFEなので、Nodeで内部関数を叩くには DOM を再帰Proxyでスタブし、末尾の `});` 直前に export 行を注入して DOMContentLoaded コールバックを手動実行する。R3全体値が公式JSONと一致するかを回帰確認に使う（2026-11-11: SS_Integrated_2026-11-08.csv の live で 534点/的中59/投資106,200円/払戻182,350円 ＝ ss_feedback_data (59).json と一致。それ以前: SS_Integrated_2026-11-01.csv の live で、変更前(5d1b8e3) 510点/的中57/投資115,000円/払戻190,320円 ＝ ss_feedback_data (58).json と一致 → h26採用後(ダ1401m+半減) 510点/投資101,200円/払戻178,660円/176.54%/最大DD132.8U。engine logic.js の smallFundUnits 合計も101,200円で一致）。CSVは PapaParse が無いので最小パーサ（ダブルクォート対応）で読む。

## よくある作業
- バックテスト・集計ロジックの変更 → `analyzer.js`（`EXPECTED_HEADERS`, `HYPOTHESIS_REGISTRY`, フィルタ・シミュレーター関数群）
- 新パラメータの効果測定 → analyzer.jsの集計を使う。Python版バックテスト（`.secretary/research/backtest/` 配下、日付スナップショット）と二重管理になっている場合は最新スペック版か確認
- CSVフォーマット変更・払戻パース修正 → `analyzer.js` 内の `evOf`/`clsOf`/`oddsOf`/`buyOddsOf` 等の共通アクセサ、および払戻パース処理
