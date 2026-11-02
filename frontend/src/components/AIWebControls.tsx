import { Globe2 } from "lucide-react";
import type { AIWebMode } from "../lib/cloverAI";

export function AIWebControls({ mode, onChange, enabled, disabled, dailyLimit }: {
  mode: AIWebMode; onChange: (mode: AIWebMode) => void; enabled: boolean; disabled: boolean; dailyLimit: number;
}) {
  const options: { value: AIWebMode; label: string }[] = [
    { value: "auto", label: "Auto" }, { value: "on", label: "Always" }, { value: "off", label: "Off" },
  ];
  return <div className="mt-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold text-mute"><Globe2 size={13} className="text-leaf" /> Live web</span>
      <div role="group" aria-label="Live web search mode" className="inline-flex rounded-md border border-edge bg-ink/40 p-0.5">
        {options.map((item) => <button key={item.value} type="button" aria-pressed={mode === item.value} disabled={disabled || (!enabled && item.value !== "off")}
          onClick={() => onChange(item.value)} className={`rounded px-2 py-1 text-[10px] font-bold transition-colors disabled:opacity-40 ${mode === item.value ? "bg-leaf/15 text-leaf" : "text-mute hover:text-text"}`}>{item.label}</button>)}
      </div>
    </div>
    <p className="text-[10px] text-mute leading-relaxed max-w-xl">
      {!enabled ? "Web search is disabled on this server." : mode === "off" ? "No web search for your messages." : mode === "on" ? "Search every message." : "Search automatically for current info, builds, ranked and similar questions."}
      {enabled && mode !== "off" && ` Only your current question is used as the search query; searches may incur costs (up to ${dailyLimit} attempts per member per UTC day).`}
    </p>
  </div>;
}
