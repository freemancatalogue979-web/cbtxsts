/** Pro settings — experience, appearance, reading, shortcuts and account. */
import {Monitor, Moon, Sun, Settings2, ArrowLeftRight, Palette, BookOpen, VolumeX, Keyboard, UserRound} from 'lucide-react';
import type {ReactNode} from 'react';
import {LINE_HEIGHTS, READ_SIZES, READ_WIDTHS, setAppearance, setExperience, setReadingPref, useExperience, type Appearance} from '../lib/mode';
import {useSession} from '../store/session';
import {PageHeader, Section} from './ui';

const SHORTCUTS: [string, string][] = [
  ['Ctrl K', 'Command menu'],
  ['Ctrl /', 'Search'],
  ['Esc', 'Close a menu or dialog'],
  ['A B C D', 'Select an answer (exams and practice)'],
  ['N / P', 'Next / previous question (exams)'],
  ['Enter', 'Confirm'],
];

function Choice<T extends string>({value, options, onChange, label}: {value: T; options: {id: T; label: ReactNode}[]; onChange: (id: T) => void; label: string}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          onClick={() => onChange(option.id)}
          className="pro-btn pro-btn-sm"
          style={value === option.id ? {borderColor: 'var(--pro-accent)', background: 'var(--pro-accent-soft)', color: 'var(--pro-text)'} : undefined}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Row({title, description, children}: {title: string; description?: string; children: ReactNode}) {
  return (
    <div className="grid min-w-0 gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-6">
      <div className="min-w-0">
        <p className="text-[0.875rem] font-medium" style={{color: 'var(--pro-text)'}}>{title}</p>
        {description && <p className="pro-meta mt-0.5">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default function ProSettings({onSignOut}: {onSignOut: () => void}) {
  const {profile} = useSession();
  const {appearance, reading} = useExperience();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader icon={<Settings2 />} hue="violet" eyebrow="Preferences" title="Settings" description="These preferences are saved on this device. Your courses, progress and history are the same in every mode." />

      <Section icon={<ArrowLeftRight />} hue="violet" title="Experience">
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" className="pro-card p-4 text-left" style={{borderColor: 'var(--pro-accent)', background: 'var(--pro-accent-soft)'}} aria-pressed="true">
            <p className="pro-h3">Pro</p>
            <p className="pro-secondary mt-1">Quiet, focused and professional. No music, sound effects, mascots or reward pop-ups.</p>
          </button>
          <button type="button" className="pro-card p-4 text-left transition-colors hover:border-[var(--pro-border-strong)]" aria-pressed="false" onClick={() => setExperience('standard')}>
            <p className="pro-h3">Standard</p>
            <p className="pro-secondary mt-1">Friendly and visual, with streaks, rewards, competitions and animation.</p>
          </button>
        </div>
      </Section>

      <Section icon={<Palette />} hue="blue" title="Appearance">
        <div className="pro-rows grid">
          <Row title="Theme" description="System follows your device setting.">
            <Choice<Appearance>
              label="Theme"
              value={appearance}
              onChange={setAppearance}
              options={[
                {id: 'light', label: <><Sun className="size-4" /> Light</>},
                {id: 'dark', label: <><Moon className="size-4" /> Dark</>},
                {id: 'system', label: <><Monitor className="size-4" /> System</>},
              ]}
            />
          </Row>
        </div>
      </Section>

      <Section icon={<BookOpen />} hue="amber" title="Reading" description="Applies to study content, notes and materials.">
        <div className="pro-rows grid">
          <Row title="Font size">
            <Choice label="Font size" value={reading.size} onChange={(id) => setReadingPref('size', id)} options={READ_SIZES.map((r) => ({id: r.id, label: r.label}))} />
          </Row>
          <Row title="Line height">
            <Choice label="Line height" value={reading.line} onChange={(id) => setReadingPref('line', id)} options={LINE_HEIGHTS.map((r) => ({id: r.id, label: r.label}))} />
          </Row>
          <Row title="Reading width">
            <Choice label="Reading width" value={reading.width} onChange={(id) => setReadingPref('width', id)} options={READ_WIDTHS.map((r) => ({id: r.id, label: r.label}))} />
          </Row>
          <Row title="Preview">
            <p className="pro-read rounded-lg border p-4" style={{borderColor: 'var(--pro-border)', color: 'var(--pro-text)'}}>
              Mitosis is the process by which a single cell divides to produce two genetically identical daughter cells. It proceeds through prophase, metaphase,
              anaphase and telophase, followed by cytokinesis.
            </p>
          </Row>
        </div>
      </Section>

      <Section icon={<VolumeX />} hue="teal" title="Sound and motion">
        <div className="pro-rows grid">
          <Row title="Sound" description="Pro Mode never plays music or sound effects. Your Standard-mode music setting is kept as you left it.">
            <p className="pro-secondary">Off in Pro</p>
          </Row>
          <Row title="Motion" description="Only short, functional transitions. If your device asks for reduced motion, they are turned off too.">
            <p className="pro-secondary">Functional only</p>
          </Row>
          <Row title="Notifications" description="No achievement, streak or reward pop-ups while you study.">
            <p className="pro-secondary">Quiet</p>
          </Row>
        </div>
      </Section>

      <Section icon={<Keyboard />} hue="green" title="Keyboard shortcuts">
        <dl className="grid gap-2 sm:grid-cols-2">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2" style={{borderColor: 'var(--pro-border)'}}>
              <dt className="pro-secondary min-w-0">{action}</dt>
              <dd className="flex shrink-0 gap-1">
                {keys.split(' ').map((key) => (
                  <kbd key={key} className="pro-kbd">
                    {key}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section icon={<UserRound />} hue="rose" title="Account">
        <div className="pro-rows grid">
          <Row title="Name">
            <p className="pro-body">{profile?.name}</p>
          </Row>
          <Row title="Username">
            <p className="pro-body">@{profile?.username}</p>
          </Row>
          <Row title="Session">
            <button type="button" className="pro-btn" onClick={onSignOut}>
              Sign out
            </button>
          </Row>
        </div>
      </Section>
    </div>
  );
}
