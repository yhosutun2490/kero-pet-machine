# Kero 桌面寵物

Kero 是一個使用 React + Tauri 製作的小桌面寵物，採用升級版 v2 Kerolet 精靈圖。

## 功能介紹

- 固定顯示在螢幕底部，在透明、無邊框視窗中以 50% 大小渲染。
- 自動循環播放待機、揮手、跳躍、審查等動作，無需使用者操作。
- 點擊後會縮到螢幕底部進入休眠，再次點擊恢復動作。
- 可自由拖曳到任意位置，拖曳時播放跑步動畫並依移動方向左右翻轉。
- 支援多螢幕：可拖過多個顯示器，邊界自動延伸涵蓋所有螢幕。
- 行為由 XState 狀態機驅動（performing / resting / dragging），邏輯與 UI 完全分離。

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
