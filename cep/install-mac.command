#!/bin/bash
# whgtctl パネルを Illustrator に入れる（macOS）
cd "$(dirname "$0")"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/whgtctl"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R whgtctl "$DEST"; rm -rf "$(dirname "$DEST")/hello"; cp -R hello "$(dirname "$DEST")/hello"
# 署名していないパネルを読み込めるようにする（CEP 9〜13）
for v in 9 10 11 12 13; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done
killall cfprefsd 2>/dev/null
echo ""
echo "入れました: $DEST"
echo "Illustrator を再起動して、ウィンドウ > エクステンション（レガシー）> whgtctl 光学補正 を開いてください。"
