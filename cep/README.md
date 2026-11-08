# whgtctl パネル（CEP）

計算をパネル側（HTML / JavaScript）で行う版です。スクリプト版（`scripts/OpticalCorrection.jsx`）と同じ計算を使い、結果も同じです。
Illustrator のスクリプト環境より計算がずっと速く、解析は読み込み時に 1 回、スライダー操作中は変形と書き込みだけを行います。

## 入れ方

- macOS：`install-mac.command` をダブルクリック（開けないときは右クリック > 開く）
- Windows：`install-win.bat` をダブルクリック

どちらも、パネルを Adobe の拡張機能フォルダーにコピーし、署名していないパネルを読み込めるよう設定（PlayerDebugMode）します。
Illustrator を再起動し、「ウィンドウ > エクステンション（レガシー）> whgtctl 光学補正」を開きます。

## 使い方

1. 文字（1 文字 = 1 グループ、複数可）を選択して「選択を読み込む」
2. スライダーで調整（その場でプレビュー）
3. 「適用（確定）」で確定、「元に戻す」で読み込む前に戻す。続けて別の文字を選んで読み込めます

## 構成

| ファイル | 役割 |
|---|---|
| `whgtctl/CSXS/manifest.xml` | パネルの定義（Illustrator 22.0 以降） |
| `whgtctl/index.html`, `js/ui.js` | パネルの画面 |
| `whgtctl/js/panel.js` | Illustrator から受け取った形を入れ物に組み立て、計算する |
| `whgtctl/js/engine.js` | 計算部分。`tools/cep/build.py` がスクリプト版から書き出す（直接編集しない） |
| `whgtctl/jsx/host.jsx` | Illustrator 側：選択の読み出し、結果の書き込み、確定・取り消し |

エンジンを直したら `python3 tools/cep/build.py` を実行して `engine.js` を更新します。
`node tests/run-cep-flow.js tests/user/noto-black-abc.svg` で、パネルの流れとスクリプト版との一致を確かめられます。
