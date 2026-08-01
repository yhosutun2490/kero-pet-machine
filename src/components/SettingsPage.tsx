import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  MODELS,
  MALE_VOICES,
  FEMALE_VOICES,
  genderOf,
  type Settings,
  type Model,
  type Voice,
  type Gender,
} from '@/lib/settings';

const MODEL_LABELS: Record<Model, string> = {
  'gpt-realtime': 'GPT Realtime（標準）',
  'gpt-realtime-mini': 'GPT Realtime Mini（較快）',
};

const GENDER_LABELS: Record<Gender, string> = { male: '男聲', female: '女聲' };
const VOICES_BY_GENDER: Record<Gender, readonly Voice[]> = {
  male: MALE_VOICES,
  female: FEMALE_VOICES,
};

export interface SettingsPageProps {
  saved: Settings;
  onSave: (next: Settings) => void;
}

/**
 * The Settings View. Edits a local draft; nothing takes effect until 儲存.
 * Leaving the View unmounts this component, so an unsaved draft is discarded.
 * Presentational only — the Shell owns persistence and any reconnect.
 */
export default function SettingsPage({ saved, onSave }: SettingsPageProps) {
  const [model, setModel] = useState<Model>(saved.model);
  const [voice, setVoice] = useState<Voice>(saved.voice);
  const [gender, setGender] = useState<Gender>(genderOf(saved.voice));

  const isDirty = model !== saved.model || voice !== saved.voice;

  function selectGender(next: Gender) {
    setGender(next);
    // Switching group does not commit anything; only reveal that group's
    // voices. The selected voice stays until the user picks one in the group.
  }

  return (
    <main className="flex flex-col h-screen bg-background text-foreground">
      <header className="flex items-center px-4 py-3 border-b border-border shrink-0">
        <span className="text-lg font-semibold">⚙️ 設定</span>
      </header>

      <div className="flex flex-col flex-1 gap-8 px-6 py-6 overflow-auto">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">模型</h2>
          <div className="flex flex-col gap-2">
            {MODELS.map((m) => (
              <label
                key={m}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 cursor-pointer hover:bg-muted"
              >
                <input
                  type="radio"
                  name="model"
                  value={m}
                  checked={model === m}
                  onChange={() => setModel(m)}
                />
                <span className="text-sm">{MODEL_LABELS[m]}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">語音</h2>
          <div className="flex gap-2">
            {(Object.keys(GENDER_LABELS) as Gender[]).map((g) => (
              <Button
                key={g}
                size="sm"
                variant={gender === g ? 'default' : 'outline'}
                onClick={() => selectGender(g)}
              >
                {GENDER_LABELS[g]}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {VOICES_BY_GENDER[gender].map((v) => (
              <Button
                key={v}
                size="sm"
                variant={voice === v ? 'default' : 'outline'}
                aria-pressed={voice === v}
                onClick={() => setVoice(v)}
              >
                {v}
              </Button>
            ))}
          </div>
        </section>
      </div>

      <div className="flex justify-end border-t border-border px-6 py-3 shrink-0">
        <Button disabled={!isDirty} onClick={() => onSave({ model, voice })}>
          儲存
        </Button>
      </div>
    </main>
  );
}
