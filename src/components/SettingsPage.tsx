/**
 * The Settings View. Placeholder for now — ticket 03 fills it with the model
 * radio, the 男/女 voice picker, and the Save button. Presentational only; it
 * owns no connection state (that lives in the Shell).
 */
export default function SettingsPage() {
  return (
    <main className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center px-4 py-3 border-b border-border shrink-0">
        <span className="text-lg font-semibold">⚙️ 設定</span>
      </header>
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">設定即將推出</p>
      </div>
    </main>
  );
}
