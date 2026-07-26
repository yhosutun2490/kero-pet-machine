# Kero 桌面寵物

Kero 是一個使用 React + Tauri 製作的小桌面寵物，採用升級版 v2 Kerolet 精靈圖。

## 功能介紹

- 固定顯示在螢幕底部。
- 原地播放待機、揮手、跳躍和審查等動作。
- 自動持續行動，不會追蹤滑鼠。
- 在透明、無邊框視窗中以 50% 大小渲染。
- 點擊時會蹲下縮到螢幕底部，再次點擊後醒來並繼續動作。
- 觸碰或點擊 Kero 不會暫停自動動作。

## 執行方式

```bash
npm install
npm run tauri:dev
```

僅限瀏覽器預覽：

```bash
npm install
npm run dev
```

## 測試

```bash
npm test
```

## 備註

行為邏輯以 reducer 架構實作於 `src/keroMachine.js`，讓移動與動畫邏輯可以在不啟動桌面視窗的情況下進行測試。精靈圖素材位於 `public/kerolet-spritesheet.webp`。
