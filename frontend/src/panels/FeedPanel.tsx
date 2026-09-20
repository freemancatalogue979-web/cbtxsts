/** Feed tab: your own activity plus the public arena feed. */
import {Activity, Award, ChevronDown, Coins, Flame, Gift, Globe, Heart, ScrollText, Sparkles, Swords, Trophy, Users, Zap} from 'lucide-react';
import {motion} from 'motion/react';
import {useCallback, useEffect, useState} from 'react';
import {Avatar, Card, Chip, EmptyState, SectionHeading, Segmented, Skeleton} from '../components/ui';
import {api} from '../lib/api';
import {sfx} from '../lib/sfx';
import {formatRelative, KIND_META} from '../lib/format';
import {iconFor} from '../lib/icons';
import {staggerContainer, staggerItem} from '../lib/motion';
import {useSize} from '../lib/responsive';
import {useSession} from '../store/session';
import type {ActivityItem, Notice} from '../lib/types';

type Feed = 'mine' | 'arena';

const FEED_FACTS = [
  {icon: ScrollText, label: 'Exam submissions award XP + coins'},
  {icon: Swords, label: 'Duels pay the winner the full pot'},
  {icon: Flame, label: 'Daily bonuses build your streak'},
  {icon: Award, label: 'Badges carry one-off XP rewards'},
  {icon: Trophy, label: 'Top-3 ranks earn season bonuses'},
  {icon: Gift, label: 'Coins buy prizes from the vault'},
  {icon: Coins, label: 'Stakes are refunded on cancels'},
];

function ActivityRow({item, onReact}: {item: ActivityItem; onReact: (item: ActivityItem) => void}) {
  const meta = KIND_META[item.kind] ?? KIND_META.xp;
  const Icon = iconFor(item.kind, Activity);
  const face = useSize(32, 38);
  return (
    <motion.li
      variants={staggerItem}
      className="flex items-start gap-2.5 rounded-2xl border border-white/6 bg-white/[0.025] px-3 py-2.5 transition-colors hover:border-white/14 sm:gap-3 sm:px-3.5 sm:py-3"
    >
      {item.student ? (
        <Avatar name={item.student.name} hue={item.student.avatar_hue} initials={item.student.initials} size={face} online={item.student.online} />
      ) : (
        <span className={`grid size-8 shrink-0 place-items-center rounded-xl border sm:size-9 ${meta.className}`}>
          <Icon className="size-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.82rem] font-extrabold text-mist-100 sm:text-[0.86rem]">{item.title}</p>
        {item.detail && <p className="mt-0.5 truncate text-[0.74rem] font-medium text-mist-500 sm:text-[0.76rem]">{item.detail}</p>}
 <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.64rem] font-bold tracking-wider text-mist-600 sm:gap-2 sm:text-[0.68rem]">
          <Chip className={meta.className}>{meta.label}</Chip>
          <span className="min-w-0 break-words">{item.student ? `${item.student.name.split(' ')[0]} · ` : ''}{formatRelative(item.created_at)}</span>
          <button
            onClick={() => onReact(item)}
            aria-label={item.reacted ? 'Remove heart' : 'Heart this moment'}
            className={`ml-auto flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 transition-colors touch-manipulation ${
              item.reacted ? 'border-flare-500/40 bg-flare-500/14 text-flare-300' : 'border-white/10 text-mist-600 hover:text-flare-300'
            }`}
          >
            <Heart className={`size-3 ${item.reacted ? 'fill-current' : ''}`} />
            {(item.reactions ?? 0) > 0 && <span className="tabular">{item.reactions}</span>}
          </button>
        </p>
      </div>
      {item.amount !== 0 && (
        <span
          className={`shrink-0 rounded-xl px-2.5 py-1.5 text-[0.76rem] font-black tabular ${
            item.amount > 0 ? 'bg-mint-500/12 text-mint-300' : 'bg-flare-500/12 text-flare-300'
          }`}
        >
          {item.amount > 0 ? '+' : ''}
          {item.amount}
        </span>
      )}
    </motion.li>
  );
}

function NoticeCard({notice}: {notice: Notice}) {
  const [open, setOpen] = useState(false);
  const long = notice.message.length > 150;
  return (
    <motion.li variants={staggerItem} className="min-w-0">
      <Card className="min-w-0 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-nova-400" />
          <p className="min-w-0 flex-1 truncate text-[0.84rem] font-extrabold text-mist-50 sm:text-[0.9rem]">{notice.title}</p>
          <Chip className="shrink-0">{formatRelative(notice.created_at)}</Chip>
        </div>
        <p
          className={`mt-1.5 break-words text-[0.76rem] font-medium leading-relaxed text-mist-400 sm:mt-2 sm:text-[0.84rem] ${
            long && !open ? 'line-clamp-3' : ''
          }`}
        >
          {notice.message}
        </p>
        {long && (
          <button
            onClick={() => setOpen((value) => !value)}
 className="mt-1 text-[0.68rem] font-black tracking-wider text-nova-300 touch-manipulation"
          >
            {open ? 'Show less' : 'Read more'}
          </button>
        )}
 <p className="mt-1.5 truncate text-[0.66rem] font-bold tracking-wider text-mist-600">{notice.author}</p>
      </Card>
    </motion.li>
  );
}

export default function FeedPanel() {
  const {notices, toast, on} = useSession();
  const [feed, setFeed] = useState<Feed>('mine');
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [loading, setLoading] = useState(true);

  const react = useCallback(
    async (item: ActivityItem) => {
      sfx.play('tap');
      try {
        const result = await api.react(item.id);
        setItems((rows) => (rows ?? []).map((row) => (row.id === item.id ? {...row, reactions: result.count, reacted: result.mine} : row)));
      } catch {
        /* the count simply stays as-is */
      }
    },
    [],
  );

  const load = useCallback(
    (target: Feed) => {
      setLoading(true);
      const request = target === 'mine' ? api.activity() : api.globalActivity();
      request
        .then((rows) => {
          setItems(rows);
          setLoading(false);
        })
        .catch((error: Error) => {
          toast('error', 'Could not load the feed', error.message);
          setLoading(false);
        });
    },
    [toast],
  );

  useEffect(() => load(feed), [feed, load]);

  useEffect(
    () =>
      on('*', (data) => {
        void data;
        if (feed === 'arena') load('arena');
      }),
    [on, feed, load],
  );

  return (
    <div className="min-w-0 space-y-4 overflow-x-clip sm:space-y-6">
      <SectionHeading
        title="Arena feed"
        subtitle="Every XP drop, duel and badge — yours and everyone else's."
        icon={<Activity className="size-4" />}
        action={
          <Chip className="border-pulse-500/28 bg-pulse-500/12 text-pulse-300" icon={<Globe className="size-3.5" />}>
            Live
          </Chip>
        }
      />

      <Segmented
        value={feed}
        options={[
          {value: 'mine', label: 'My activity', icon: Zap},
          {value: 'arena', label: 'Everyone', icon: Users},
        ]}
        onChange={setFeed}
      />

      <div className="grid min-w-0 gap-3.5 sm:gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section className="min-w-0">
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((key) => (
                <Skeleton key={key} className="h-14 sm:h-16" />
              ))}
            </div>
          ) : (items?.length ?? 0) === 0 ? (
            <EmptyState
              icon={feed === 'mine' ? <Zap className="size-6" /> : <Globe className="size-6" />}
              title={feed === 'mine' ? 'No activity yet' : 'The arena is quiet'}
              detail={feed === 'mine' ? 'Take an exam or win a duel and your feed fills up instantly.' : 'Scores will stream in as players compete.'}
            />
          ) : (
            <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="space-y-1.5">
              {items!.map((item) => (
                <ActivityRow key={item.id} item={item} onReact={react} />
              ))}
            </motion.ul>
          )}
        </section>

        <section className="min-w-0 space-y-2.5 sm:space-y-3">
          <SectionHeading title="Announcements" subtitle="From the arena staff." icon={<ScrollText className="size-4" />} />
          {notices.length === 0 ? (
            <EmptyState icon={<ScrollText className="size-6" />} title="No announcements" />
          ) : (
            <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="min-w-0 space-y-2.5 sm:space-y-3">
              {notices.map((notice) => (
                <NoticeCard key={notice.id} notice={notice} />
              ))}
            </motion.ul>
          )}

          <Card className="min-w-0 p-3 sm:p-4">
            <details className="group sm:hidden">
 <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[0.66rem] font-black tracking-[0.2em] text-mist-500 touch-manipulation">
                What feeds the arena
                <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <ul className="mt-2.5 space-y-1.5 text-[0.74rem] font-semibold text-mist-400">
                {FEED_FACTS.map((row) => {
                  const Icon = row.icon;
                  return (
                    <li key={row.label} className="flex items-center gap-2.5">
                      <Icon className="size-3.5 shrink-0 text-nova-400" />
                      <span className="min-w-0 break-words">{row.label}</span>
                    </li>
                  );
                })}
              </ul>
            </details>
 <p className="hidden text-[0.68rem] font-black tracking-[0.2em] text-mist-500 sm:block">What feeds the arena</p>
            <ul className="mt-2.5 hidden space-y-2 text-[0.82rem] font-semibold text-mist-400 sm:block">
              {FEED_FACTS.map((row) => {
                const Icon = row.icon;
                return (
                  <li key={row.label} className="flex items-center gap-2.5">
                    <Icon className="size-4 shrink-0 text-nova-400" />
                    {row.label}
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      </div>
    </div>
  );
}
