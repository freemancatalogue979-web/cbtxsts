/**
 * Digital Evolution — the living cyber-nature progression showcase.
 *
 * Visualizes how the player's personal ecosystem evolves as they study:
 * SEED → SPROUT → NETWORK → NEURAL CORE → CYBER TREE → KNOWLEDGE NODE → ASCENSION
 */
import {Dna, Info} from 'lucide-react';
import {useState} from 'react';
import {Card, Modal, ProgressBar} from './ui';
import {
  EVOLUTION_STAGES,
  evolutionPhaseProgress,
  evolutionStageFor,
  nextEvolutionStage,
} from '../lib/evolution';

export default function DigitalEvolution({
  level,
  compact = false,
  className = '',
}: {
  level: number;
  compact?: boolean;
  className?: string;
}) {
  const [showModal, setShowModal] = useState(false);
  const current = evolutionStageFor(level);
  const next = nextEvolutionStage(level);
  const progress = evolutionPhaseProgress(level);

  if (compact) {
    return (
      <button
        onClick={() => setShowModal(true)}
        className={`inline-flex items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-1 text-[0.68rem] font-black transition-colors hover:bg-teal-500/20 ${className}`}
        style={{color: current.color}}
      >
        <span className="text-[0.8rem] leading-none">{current.glyph}</span>
        <span className="truncate">{current.name}</span>
 <span className="text-[0.58rem] font-bold text-mist-500">Phase {current.phase}/7</span>
      </button>
    );
  }

  return (
    <>
      <Card className={`relative overflow-hidden border border-teal-500/25 p-4 sm:p-5 ${className}`}>
        {/* Soft bioluminescent glow */}
        <span
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-12 size-48 rounded-full blur-3xl opacity-30"
          style={{background: current.color}}
        />

        <div className="relative flex flex-col gap-3">
          {/* Header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-xl biolum-glow">
                {current.glyph}
              </span>
              <div>
 <p className="flex items-center gap-1.5 text-[0.65rem] font-black tracking-[0.16em]" style={{color: current.color}}>
                  <Dna className="size-3" /> Digital Evolution · Phase {current.phase} of 7
                </p>
                <h3 className="text-[0.95rem] font-black text-mist-50 sm:text-[1.05rem]">{current.title}</h3>
              </div>
            </div>

            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] px-2 py-1 text-[0.64rem] font-bold text-mist-400 hover:text-mist-200"
            >
              <Info className="size-3" /> All phases
            </button>
          </div>

          {/* Biome lore snippet */}
          <p className="text-[0.76rem] leading-relaxed font-medium text-mist-300">
            {current.blurb}
          </p>

          {/* 7-Phase Living Ecosystem Pipeline */}
          <div className="evolution-track gap-1 pt-1">
            {EVOLUTION_STAGES.map((stage) => {
              const done = stage.phase < current.phase;
              const active = stage.phase === current.phase;
              return (
                <div key={stage.key} className="flex flex-col items-center gap-1 text-center">
                  <span
                    className={`grid size-7 sm:size-8 place-items-center rounded-xl border text-[0.8rem] sm:text-[0.9rem] transition-transform ${
                      active
                        ? 'scale-110 border-teal-400/80 bg-teal-500/20 shadow-[0_0_12px_rgba(20,184,166,0.5)]'
                        : done
                          ? 'border-emerald-500/40 bg-emerald-500/10 opacity-80'
                          : 'border-white/8 bg-white/[0.02] opacity-40'
                    }`}
                  >
                    {stage.glyph}
                  </span>
 <span className={`hidden sm:block text-[0.55rem] font-extrabold tracking-tight truncate w-full ${active ? 'text-teal-300 font-black' : done ? 'text-mist-400' : 'text-mist-600'}`}>
                    {stage.name}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Evolution Progress */}
          <div className="mt-1 space-y-1.5">
            <div className="flex items-center justify-between text-[0.66rem] font-bold text-mist-400">
              <span>
                Biome: <strong className="text-mist-100">{current.biome}</strong>
              </span>
              <span>
                {next ? (
                  <>
                    Next phase at <strong className="text-mist-100">Lv {next.minLevel}</strong> ({next.name})
                  </>
                ) : (
                  <strong className="text-flare-300">Max Ascension Reached</strong>
                )}
              </span>
            </div>
            <ProgressBar value={progress} max={100} tone="brand" />
          </div>
        </div>
      </Card>

      {/* Evolutionary Codex Modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Digital Evolution Codex" subtitle="A living digital ecosystem shaped by your study milestones" size="lg">
        <div className="space-y-3">
          <p className="text-[0.78rem] leading-relaxed text-mist-300">
            In the CBT Arena, knowledge becomes living energy. As you complete exams, win duels, and level up, your personal digital biome evolves through seven evolutionary phases:
          </p>

          <div className="space-y-2">
            {EVOLUTION_STAGES.map((stage) => {
              const active = stage.phase === current.phase;
              const reached = level >= stage.minLevel;
              return (
                <div
                  key={stage.key}
                  className={`flex items-start gap-3 rounded-2xl border p-3 transition-colors ${
                    active
                      ? 'border-teal-400/60 bg-teal-500/10'
                      : reached
                        ? 'border-white/10 bg-white/[0.03]'
                        : 'border-white/5 bg-white/[0.01] opacity-50'
                  }`}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-xl">
                    {stage.glyph}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[0.82rem] font-black text-mist-50">{stage.title}</span>
 <span className="rounded-full px-1.5 py-0.5 text-[0.55rem] font-black tracking-wider" style={{background: `${stage.color}25`, color: stage.color}}>
                        Phase {stage.phase} · Levels {stage.minLevel}–{stage.maxLevel}
                      </span>
                      {active && (
                        <span className="rounded-full bg-teal-400 px-1.5 py-0.5 text-[0.52rem] font-black text-ink-950">
                          CURRENT
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[0.72rem] text-mist-300">{stage.blurb}</p>
                    <p className="mt-0.5 text-[0.62rem] font-bold text-mist-500">Biome Environment: {stage.biome}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
}
