# app-editor（面宣言 x 設定）— itonami（dapp）上の分散型設計

状態: 第 1 スライス実装（2026-10-20）。正本はこの文書。
追跡: Linear JUN-128（親 JUN-116）。

## 位置づけ

app-editor は editor.etzhayyim.com —— Web コードエディタ + プロジェクト管理
（CodeMirror 6 + Sandpack）。本スライスの対象は appview 面の**自己宣言**
（default-db）。この port は **scaffold の stale 値（routeCount 0 / [] / []）を
wrangler.jsonc の実値で訂正済み** —— 宣言と実設定の一致が判定の対象。

## このスライス: 面宣言 x 設定の整合判定コア

| 層 | 実体 | 状態 |
|---|---|---|
| 判定コア guest | `aiueos/editor_surface.cljk` — route-count は routes の数と一致 / **vars-count は wrangler の vars キーと一致** / kind は閉じた集合 / source path の明示 | **実装済み・実測** |
| 記述子 | `aiueos/editor-surface.edn` | **実装済み** |
| parity | `cljs/test/editor/surface_parity_test.cljk` — 宣言（default-db）と **wrangler.jsonc の実データ整合**（ルート数・vars キー集合）を照合 | **実装済み・実測** |

実測: `amu test aiueos/editor_surface.cljk` → **15/15**（jvm-kir / js / wasm）。
parity → 3 assertions / 0 failures。

## この repo 固有の点（app-contacts / app-slides との違い）

- contacts / slides は scaffold の宣言を**バイトどおり保持**（移植の指示）。
  この port は wrangler.jsonc から**訂正**した（「corrects them from the
  component's actual wrangler.jsonc」）。面宣言判定はこの「訂正が正しい」
  ことを固定する —— parity が wrangler の実値と照合する所以。
- wrangler.jsonc は jsonc（行コメントあり）。parity は**行頭コメントのみ**
  除去して parse する（URL 内の `//` を消さない。実測でこの罠に当たった）。

## 未実装境界

- エディタ本体（CodeMirror / Sandpack / llm-codegen）の判定。
- dispatcher Worker（app.ts）と xrpc-proxy（未配線）の判定。
- 面宣言判定の fleet 共通化（contacts / slides / editor の 3 repo で同形状）。
- mon（DNA）化、aiueos session 載せ（fleet 共通）。
