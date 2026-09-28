/**
 * MoreSheet — the phone "More" menu.
 *
 * A proper app menu rather than a wall of identical buttons:
 *   · a player header (avatar, level, XP to next level, coins/streak/gems) that
 *     doubles as the way into the profile;
 *   · destinations grouped by purpose — Study, Compete, Community, Rewards;
 *   · account actions as quiet rows at the bottom (support, install, sign out).
 *
 * Bottom sheet on phones (drag the header down to close), centred card from
 * `sm` up. Every tab in MORE_TABS is always reachable: anything not placed in a
 * group lands in a trailing "More" group, so new tabs never go missing.
 */
import {ArrowUpRight, Briefcase, ChevronRight, Coins, Flame, Gem, LifeBuoy, LogOut, Shield, X} from 'lucide-react';
import {setExperience} from '../lib/mode';
import {AnimatePresence, motion, useDragControls} from 'motion/react';
import {useEffect} from 'react';
import type {ReactNode} from 'react';
import {Avatar} from './ui';
import InstallApp from './InstallApp';
import {MORE_TABS, TABS} from '../lib/nav';
import type {Tab} from '../lib/nav';
import {formatNumber} from '../lib/format';
import {overlayVariants} from '../lib/motion';
import {useSession} from '../store/session';

type Tone = 'nova' | 'pulse' | 'flare' | 'gold' | 'mint' | 'cyan' | 'amber';

/* Full class strings so Tailwind picks them up. */
const TONES: Record<Tone, {chip: string; icon: string; card: string}> = {
  nova: {
    chip: 'from-nova-400/30 to-nova-600/10 border-nova-400/30',
    icon: 'text-nova-200',
    card: 'from-nova-500/22 via-nova-500/8 to-transparent border-nova-400/25',
  },
  pulse: {
    chip: 'from-pulse-400/30 to-pulse-600/10 border-pulse-400/30',
    icon: 'text-pulse-200',
    card: 'from-pulse-500/22 via-pulse-500/8 to-transparent border-pulse-400/25',
  },
  flare: {
    chip: 'from-flare-400/30 to-flare-600/10 border-flare-400/30',
    icon: 'text-flare-200',
    card: 'from-flare-500/22 via-flare-500/8 to-transparent border-flare-400/25',
  },
  gold: {
    chip: 'from-gold-400/30 to-gold-600/10 border-gold-400/30',
    icon: 'text-gold-200',
    card: 'from-gold-500/22 via-gold-500/8 to-transparent border-gold-400/25',
  },
  mint: {
    chip: 'from-mint-400/30 to-mint-600/10 border-mint-400/30',
    icon: 'text-mint-200',
    card: 'from-mint-500/22 via-mint-500/8 to-transparent border-mint-400/25',
  },
  cyan: {
    chip: 'from-cyan-400/30 to-cyan-600/10 border-cyan-400/30',
    icon: 'text-cyan-200',
    card: 'from-cyan-500/22 via-cyan-500/8 to-transparent border-cyan-400/25',
  },
  amber: {
    chip: 'from-amber-400/30 to-amber-600/10 border-amber-400/30',
    icon: 'text-amber-200',
    card: 'from-amber-500/22 via-amber-500/8 to-transparent border-amber-400/25',
  },
};

const META: Partial<Record<Tab, {tone: Tone; hint: string}>> = {
  tutor: {tone: 'nova', hint: 'Ask anything, get it explained'},
  materials: {tone: 'cyan', hint: 'Course notes, topics & PDFs'},
  arena: {tone: 'flare', hint: 'Party games'},
  ranked: {tone: 'pulse', hint: 'Climb divisions'},
  events: {tone: 'amber', hint: 'Timed specials'},
  mystery: {tone: 'mint', hint: 'Solve cases'},
  friends: {tone: 'nova', hint: 'Chat & challenge'},
  ranks: {tone: 'gold', hint: 'Leaderboards'},
  feed: {tone: 'cyan', hint: 'What’s happening'},
  shop: {tone: 'gold', hint: 'Spend your coins'},
  prizes: {tone: 'flare', hint: 'Claim rewards'},
};

type Group = {id: string; title: string; tabs: Tab[]; style: 'feature' | 'tiles' | 'wide'};

const GROUPS: Group[] = [
  {id: 'study', title: 'Study', tabs: ['tutor', 'materials'], style: 'feature'},
  {id: 'compete', title: 'Compete', tabs: ['arena', 'ranked', 'events', 'mystery'], style: 'tiles'},
  {id: 'community', title: 'Community', tabs: ['friends', 'ranks', 'feed'], style: 'tiles'},
  {id: 'rewards', title: 'Rewards', tabs: ['shop', 'prizes'], style: 'wide'},
];
/* Handled by the header (profile) and the account rows (support). */
const HANDLED_ELSEWHERE: Tab[] = ['profile', 'support'];

function SectionLabel({children}: {children: ReactNode}) {
  return (
    <h4 className="mb-2 px-0.5 text-[0.64rem] font-bold tracking-[0.16em] text-mist-500 uppercase">{children}</h4>
  );
}

function IconChip({tone, size = 'md', children}: {tone: Tone; size?: 'md' | 'lg'; children: ReactNode}) {
  const t = TONES[tone];
  return (
    <span
      className={`grid shrink-0 place-items-center border bg-gradient-to-br shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] ${t.chip} ${t.icon} ${
        size === 'lg' ? 'size-11 rounded-[0.95rem]' : 'size-11 rounded-[0.9rem] sm:size-12'
      }`}
    >
      {children}
    </span>
  );
}

function Badge({count}: {count: number}) {
  if (count <= 0) return null;
  return (
    <span className="absolute -top-1 -right-1 grid min-w-[1.15rem] place-items-center rounded-full border-2 border-ink-900 bg-flare-500 px-1 text-[0.58rem] leading-[0.95rem] font-black text-white tabular">
      {count > 99 ? '99+' : count}
    </span>
  );
}

export default function MoreSheet({
  open,
  onClose,
  tab,
  onTab,
  onAdmin,
  onSignOut,
  chatTotal,
}: {
  open: boolean;
  onClose: () => void;
  tab: Tab | null;
  onTab: (tab: Tab) => void;
  onAdmin: () => void;
  onSignOut: () => void;
  chatTotal: number;
}) {
  const {profile, role} = useSession();
  const drag = useDragControls();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const go = (id: Tab) => {
    onClose();
    onTab(id);
  };

  const placed = new Set<Tab>([...GROUPS.flatMap((g) => g.tabs), ...HANDLED_ELSEWHERE]);
  const leftovers = MORE_TABS.filter((id) => !placed.has(id));
  const groups: Group[] = [
    ...GROUPS.map((g) => ({...g, tabs: g.tabs.filter((id) => MORE_TABS.includes(id))})).filter((g) => g.tabs.length),
    ...(leftovers.length ? [{id: 'more', title: 'More', tabs: leftovers, style: 'tiles' as const}] : []),
  ];

  const info = (id: Tab) => TABS.find((row) => row.id === id);
  const progress = profile?.progress;
  const pct = Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0)));

  const renderGroup = (group: Group) => {
    if (group.style === 'feature') {
      return (
        <div className="grid grid-cols-2 gap-2.5">
          {group.tabs.map((id) => {
            const item = info(id);
            if (!item) return null;
            const meta = META[id] ?? {tone: 'nova' as Tone, hint: ''};
            const Icon = item.icon;
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex min-w-0 flex-col items-start gap-2.5 overflow-hidden rounded-[1.25rem] border bg-gradient-to-br p-3 text-left transition-transform touch-manipulation active:scale-[0.97] ${
                  TONES[meta.tone].card
                } ${active ? 'ring-2 ring-nova-400/70' : ''}`}
              >
                <span className="flex w-full items-start justify-between">
                  <IconChip tone={meta.tone} size="lg">
                    <Icon className="size-5" />
                  </IconChip>
                  <ArrowUpRight className="size-4 text-mist-500 transition-colors group-hover:text-mist-200" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-display text-[0.95rem] font-bold text-mist-50">{item.label}</span>
                  <span className="mt-0.5 line-clamp-2 block text-[0.7rem] leading-snug font-medium text-mist-400">{meta.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      );
    }

    if (group.style === 'wide') {
      return (
        <div className="grid grid-cols-2 gap-2.5">
          {group.tabs.map((id) => {
            const item = info(id);
            if (!item) return null;
            const meta = META[id] ?? {tone: 'gold' as Tone, hint: ''};
            const Icon = item.icon;
            const active = tab === id;
            const detail = id === 'shop' && profile ? `${formatNumber(profile.coins)} coins` : meta.hint;
            return (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-w-0 items-center gap-2.5 rounded-[1.1rem] border border-white/8 bg-white/[0.035] p-2.5 text-left transition-transform touch-manipulation active:scale-[0.97] ${
                  active ? 'ring-2 ring-nova-400/70' : ''
                }`}
              >
                <IconChip tone={meta.tone}>
                  <Icon className="size-5" />
                </IconChip>
                <span className="min-w-0">
                  <span className="block truncate text-[0.84rem] font-bold text-mist-50">{item.label}</span>
                  <span className="block truncate text-[0.68rem] font-medium text-mist-400 tabular">{detail}</span>
                </span>
              </button>
            );
          })}
        </div>
      );
    }

    const cols = group.tabs.length >= 4 ? 'grid-cols-4' : group.tabs.length === 3 ? 'grid-cols-3' : 'grid-cols-2';
    return (
      <div className={`grid ${cols} gap-1.5 rounded-[1.25rem] border border-white/8 bg-white/[0.025] p-1.5`}>
        {group.tabs.map((id) => {
          const item = info(id);
          if (!item) return null;
          const meta = META[id] ?? {tone: 'nova' as Tone, hint: ''};
          const Icon = item.icon;
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              aria-current={active ? 'page' : undefined}
              title={meta.hint || item.label}
              className={`flex min-w-0 flex-col items-center gap-1.5 rounded-[1rem] px-1 pt-2.5 pb-2 transition touch-manipulation active:scale-[0.94] ${
                active ? 'bg-white/[0.07] ring-1 ring-nova-400/50' : 'hover:bg-white/[0.04]'
              }`}
            >
              <span className="relative">
                <IconChip tone={meta.tone}>
                  <Icon className="size-5" />
                </IconChip>
                {id === 'friends' && <Badge count={chatTotal} />}
              </span>
              <span className={`w-full truncate text-center text-[0.7rem] font-semibold ${active ? 'text-mist-50' : 'text-mist-200'}`}>
                {item.label.length > 9 ? item.short : item.label}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  const rowClass =
    'flex w-full min-w-0 items-center gap-3 px-3.5 py-3 text-left transition-colors touch-manipulation hover:bg-white/[0.04] active:bg-white/[0.06]';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-60 flex items-end justify-center scrim backdrop-blur-sm sm:items-center sm:p-4"
          variants={overlayVariants}
          initial="hidden"
          animate="show"
          exit="exit"
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            onClick={(event) => event.stopPropagation()}
            initial={{y: '100%'}}
            animate={{y: 0}}
            exit={{y: '100%'}}
            transition={{type: 'spring', stiffness: 420, damping: 40}}
            drag="y"
            dragListener={false}
            dragControls={drag}
            dragConstraints={{top: 0, bottom: 0}}
            dragElastic={{top: 0, bottom: 0.6}}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 600) onClose();
            }}
            className="panel-hero relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-[1.75rem] pb-[env(safe-area-inset-bottom,0px)] sm:max-h-[86dvh] sm:max-w-md sm:rounded-[1.75rem] sm:pb-0"
          >
            {/* --------------------------------------------------- header */}
            <div
              className="relative shrink-0 touch-none select-none"
              onPointerDown={(event) => drag.start(event)}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(120%_90%_at_15%_0%,rgba(139,92,246,0.28),transparent_60%),radial-gradient(90%_80%_at_100%_0%,rgba(250,204,21,0.10),transparent_55%)]"
              />
              <div className="relative flex justify-center pt-2.5 sm:hidden">
                <span className="sheet-handle" />
              </div>

              {profile ? (
                <div className="relative px-4 pt-1.5 pb-3.5 sm:px-5 sm:pt-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => go('profile')}
                      onPointerDown={(event) => event.stopPropagation()}
                      aria-current={tab === 'profile' ? 'page' : undefined}
                      aria-label="Open your profile"
                      className="group flex min-w-0 flex-1 items-center gap-3 text-left touch-manipulation"
                    >
                      <span className="relative shrink-0">
                        <Avatar
                          name={profile.name}
                          hue={profile.avatar_hue}
                          initials={profile.initials}
                          size={46}
                          ring
                          cosmetics={profile.cosmetics ?? null}
                        />
                        {progress && (
                          <span className="absolute -right-1.5 -bottom-1 rounded-full border-2 border-ink-900 bg-gradient-to-br from-gold-300 to-gold-500 px-1.5 text-[0.58rem] leading-[0.9rem] font-black text-ink-950 tabular">
                            {progress.level}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-[1.05rem] leading-tight font-bold text-mist-50">
                          {profile.name}
                        </span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-0.5 text-[0.72rem] font-medium text-mist-400 transition-colors group-hover:text-mist-200">
                          <span className="truncate">
                            {progress?.title ? <span className="text-nova-300">{progress.title}</span> : `@${profile.username}`}
                            {progress?.title ? ' · View profile' : ''}
                          </span>
                          <ChevronRight className="size-3.5 shrink-0" />
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      onPointerDown={(event) => event.stopPropagation()}
                      aria-label="Close menu"
                      className="grid size-9 shrink-0 place-items-center self-start rounded-full border border-white/10 bg-white/[0.05] text-mist-300 transition hover:text-mist-50 active:scale-90"
                    >
                      <X className="size-[18px]" />
                    </button>
                  </div>

                  {progress && (
                    <div className="mt-3 flex items-center gap-2.5 text-[0.64rem] font-semibold tabular">
                      <span className="shrink-0 text-mist-400">Lv {progress.level}</span>
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-nova-400 via-pulse-400 to-gold-300"
                          initial={{width: 0}}
                          animate={{width: `${pct}%`}}
                          transition={{duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15}}
                        />
                      </div>
                      <span className="shrink-0 text-mist-500">
                        {formatNumber(progress.into_level)}/{formatNumber(progress.needed)} XP
                      </span>
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {[
                      {icon: Coins, label: 'coins', value: formatNumber(profile.coins), tone: 'text-gold-300'},
                      {icon: Flame, label: 'streak', value: `${profile.streak}d`, tone: 'text-flare-300'},
                      {icon: Gem, label: 'gems', value: formatNumber(profile.diamonds ?? 0), tone: 'text-cyan-300'},
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="flex min-w-0 items-center gap-1.5 rounded-full border border-white/8 bg-black/20 px-2.5 py-1.5"
                      >
                        <stat.icon className={`size-3.5 shrink-0 ${stat.tone}`} />
                        <span className="min-w-0 truncate text-[0.7rem] font-medium text-mist-500">
                          <span className="font-bold text-mist-50 tabular">{stat.value}</span> {stat.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="relative flex items-start justify-between gap-3 px-4 pt-1.5 pb-3.5 sm:px-5 sm:pt-4">
                  <div className="min-w-0">
                    <p className="font-display text-[1.05rem] font-bold text-mist-50">Absolute Genesis</p>
                    <p className="text-[0.72rem] font-medium text-mist-400">A completely new beginning</p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    onPointerDown={(event) => event.stopPropagation()}
                    aria-label="Close menu"
                    className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-mist-300 transition hover:text-mist-50 active:scale-90"
                  >
                    <X className="size-[18px]" />
                  </button>
                </div>
              )}
              <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            </div>

            {/* ----------------------------------------------------- body */}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pt-4 pb-5 sm:px-5">
              {groups.map((group) => (
                <section key={group.id}>
                  <SectionLabel>{group.title}</SectionLabel>
                  {renderGroup(group)}
                </section>
              ))}

              <section>
                <SectionLabel>Account</SectionLabel>
                <div className="divide-y divide-white/6 overflow-hidden rounded-[1.25rem] border border-white/8 bg-white/[0.025]">
                  {MORE_TABS.includes('support') && (
                    <button type="button" onClick={() => go('support')} className={rowClass}>
                      <LifeBuoy className="size-[18px] shrink-0 text-mint-300" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.84rem] font-semibold text-mist-100">Help & support</span>
                        <span className="block truncate text-[0.68rem] text-mist-500">Report a problem or ask staff</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-mist-600" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      setExperience('pro');
                    }}
                    className={rowClass}
                  >
                    <Briefcase className="size-[18px] shrink-0 text-nova-300" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.84rem] font-semibold text-mist-100">Switch to Pro Mode</span>
                      <span className="block truncate text-[0.68rem] text-mist-500">Quiet, focused and professional — same progress</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-mist-600" />
                  </button>
                  <InstallApp variant="row" className={rowClass} />
                  {role && role !== 'student' && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onAdmin();
                      }}
                      className={rowClass}
                    >
                      <Shield className="size-[18px] shrink-0 text-gold-300" />
                      <span className="min-w-0 flex-1 text-[0.84rem] font-semibold text-mist-100">Staff console</span>
                      <ChevronRight className="size-4 shrink-0 text-mist-600" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSignOut();
                    }}
                    className={rowClass}
                  >
                    <LogOut className="size-[18px] shrink-0 text-flare-300" />
                    <span className="min-w-0 flex-1 text-[0.84rem] font-semibold text-flare-200">Sign out</span>
                  </button>
                </div>
              </section>

              <p className="pt-1 text-center text-[0.62rem] font-medium tracking-[0.14em] text-mist-600 uppercase">
                Absolute Genesis · A completely new beginning
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
