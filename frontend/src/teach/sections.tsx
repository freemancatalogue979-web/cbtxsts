/** Teacher Network hub sections — hero, subject browser, how-it-works path,
 *  teach CTA and a learning snapshot. Token-driven, so they fit both the Pro
 *  workspace and the Standard arena skin (game.css). The slime only appears in
 *  Standard mode; Pro never shows mascots. */
import {BadgeCheck, BookOpen, CheckCircle2, GraduationCap, Inbox, MessageSquare, Presentation, Search, ShieldCheck, Sparkles, Star, UserPlus, Users} from 'lucide-react';
import Character from '../components/Character';
import {PageBanner} from '../components/ui';
import type {Catalog, Learning} from '../lib/teachers';
import {goTo, subjectLook, useArena} from './ui';

export function HubHero({catalog, learning, groups, onFind, compact}: {catalog: Catalog | null; learning: Learning | null; groups: number | null; onFind: () => void; compact?: boolean}) {
  const arena = useArena();
  const mine = learning?.teachers.filter((t) => t.relationship.status === 'active').length ?? 0;
  if (compact && arena) {
    const shared = (learning?.materials.length ?? 0) + (learning?.quizzes.length ?? 0);
    return (
      <PageBanner
        eyebrow="Mentor guild"
        title="Your teachers & groups"
        subtitle="Chat with your teachers, open what they share and join their study groups."
        icon={<GraduationCap />}
        tone="nova"
        stats={[
          {value: mine, label: mine === 1 ? 'teacher' : 'teachers', tone: 'nova'},
          {value: learning ? learning.groups.length : '—', label: 'groups', tone: 'cyan'},
          {value: shared, label: 'shared', tone: 'gold'},
        ]}
      />
    );
  }
  if (compact) {
    return (
      <section className="t-hub-hero t-hub-hero-compact" aria-labelledby="t-hub-title">
        <div className="relative z-[1] flex min-w-0 items-center gap-3">
          <span className="t-hub-art-cap !size-11 !rounded-full shrink-0" aria-hidden>
            <GraduationCap className="!size-5" />
          </span>
          <div className="min-w-0">
            <p className="pro-eyebrow">{arena ? 'Mentor guild' : 'Teacher network'}</p>
            <h1 id="t-hub-title" className="pro-h2 truncate">
              Your teachers &amp; groups
            </h1>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="t-hub-hero" aria-labelledby="t-hub-title">
      <div className="relative z-[1] grid min-w-0 gap-3.5">
        <p className="pro-eyebrow flex items-center gap-1.5">
          <Sparkles className="size-3.5" /> {arena ? 'Mentor guild · Teacher network' : 'Teacher network'}
        </p>
        <h1 id="t-hub-title" className="t-hub-title max-w-[17ch] [overflow-wrap:anywhere]">
          Learn faster with a <em>real teacher</em>
        </h1>
        <p className="pro-secondary max-w-xl max-md:pr-16">
          Find a verified teacher for the exact topic you're stuck on. Chat one-on-one, join their study groups, read their notes and take their quizzes.
        </p>
        <div className="t-hub-stats">
          <span className="t-hub-stat" data-hue="violet">
            <i>
              <ShieldCheck />
            </i>
            <b>{catalog?.teacher_count ?? '—'}</b> teachers
          </span>
          <span className="t-hub-stat" data-hue="blue">
            <i>
              <BookOpen />
            </i>
            <b>{catalog?.subjects.length ?? '—'}</b> subjects
          </span>
          <span className="t-hub-stat" data-hue="teal">
            <i>
              <Users />
            </i>
            <b>{groups ?? '—'}</b> study groups
          </span>
          {mine > 0 && (
            <span className="t-hub-stat" data-hue="green">
              <i>
                <GraduationCap />
              </i>
              <b>{mine}</b> yours
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className="pro-btn pro-btn-primary" onClick={onFind}>
            <Search className="size-4" /> Find a teacher
          </button>
          <button type="button" className="pro-btn" onClick={() => goTo({tab: 'studio'})}>
            <Presentation className="size-4" /> Teach on Genesis
          </button>
        </div>
      </div>
      {arena ? (
        <Character mood="idle" size={128} className="t-hub-slime max-md:!w-[84px] max-md:!h-[94px]" label="Genesis slime" />
      ) : (
        <div className="t-hub-art" aria-hidden>
          <span className="t-orbit" />
          <span className="t-orbit" />
          <span className="t-hub-art-cap">
            <GraduationCap />
          </span>
          <span className="t-float" data-hue="amber" style={{left: 6, top: 18}}>
            <Star />
          </span>
          <span className="t-float" data-hue="green" style={{right: 4, top: 34}}>
            <MessageSquare />
          </span>
          <span className="t-float" data-hue="teal" style={{left: 26, bottom: 4}}>
            <Users />
          </span>
        </div>
      )}
    </section>
  );
}

export function SectionHead({icon, title, sub, action}: {icon?: React.ReactNode; title: string; sub?: string; action?: React.ReactNode}) {
  return (
    <div className="t-sec-head">
      <div className="min-w-0">
        <h2 className="pro-h3">
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        {sub && <p className="pro-meta mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function SubjectGrid({catalog, active, onPick}: {catalog: Catalog | null; active: string; onPick: (subject: string) => void}) {
  if (!catalog || catalog.subjects.length === 0) return null;
  return (
    <section className="grid min-w-0 gap-3">
      <SectionHead icon={<BookOpen />} title="Browse by subject" sub="Tap a subject to see who teaches it" />
      <div className="t-subjects">
        {catalog.subjects.map((s) => {
          const look = subjectLook(s.subject);
          return (
            <button
              key={s.subject}
              type="button"
              className="t-subject-tile"
              style={{['--deg' as string]: String(look.deg)}}
              aria-pressed={active === s.subject}
              onClick={() => onPick(active === s.subject ? '' : s.subject)}
            >
              <span className="t-subject-orb">
                <look.Icon />
              </span>
              <span className="min-w-0">
                <b>{s.subject}</b>
                <small>{s.topics.length ? s.topics.slice(0, 2).join(' · ') : 'All topics'}</small>
              </span>
              <look.Icon className="t-subject-ghost" aria-hidden />
            </button>
          );
        })}
      </div>
    </section>
  );
}

const STEPS = [
  {icon: Search, hue: 'blue', title: 'Find your teacher', body: 'Search by topic. Check verified badges, reviews and reply time.'},
  {icon: UserPlus, hue: 'violet', title: 'Send a request', body: 'Say what you need help with and when. Teachers accept or decline.'},
  {icon: MessageSquare, hue: 'teal', title: 'Learn together', body: 'Chat, get notes and quizzes, and join their study groups.'},
  {icon: Star, hue: 'amber', title: 'Leave a review', body: 'When you finish, rate your teacher to help other students choose.'},
] as const;

export function HowItWorks({compact}: {compact?: boolean}) {
  return (
    <section className="grid min-w-0 gap-3">
      {!compact && <SectionHead icon={<Sparkles />} title="How it works" sub="From stuck to sorted in four steps" />}
      <ol className="t-how">
        {STEPS.map((s) => (
          <li key={s.title} className="t-step" data-hue={s.hue}>
            <span className="t-step-orb">
              <s.icon />
            </span>
            <div className="min-w-0">
              <b>{s.title}</b>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function TeachCta() {
  return (
    <section className="t-cta">
      <span className="t-cta-orb" aria-hidden>
        <Presentation />
      </span>
      <div className="min-w-0">
        <p className="pro-h3">Know your subject? Teach on Genesis</p>
        <p className="pro-secondary mt-0.5">Apply in a few minutes. Our team checks your qualifications before you appear in search.</p>
        <ul>
          <li>
            <CheckCircle2 /> Verified badge
          </li>
          <li>
            <CheckCircle2 /> Your own study groups
          </li>
          <li>
            <CheckCircle2 /> Quizzes &amp; materials
          </li>
        </ul>
      </div>
      <button type="button" className="pro-btn pro-btn-primary justify-self-start sm:justify-self-end" onClick={() => goTo({tab: 'studio'})}>
        <BadgeCheck className="size-4" /> Apply to teach
      </button>
    </section>
  );
}

export function LearningSnapshot({learning, onTab}: {learning: Learning | null; onTab: (view: 'mine' | 'requests' | 'groups') => void}) {
  if (!learning) return null;
  const active = learning.teachers.filter((t) => t.relationship.status === 'active').length;
  const pending = learning.requests.filter((r) => r.status === 'pending').length;
  const content = learning.materials.length + learning.quizzes.length;
  if (!active && !pending && !content && !learning.groups.length) return null;
  return (
    <div className="t-snap">
      <button type="button" data-hue="green" onClick={() => onTab('mine')}>
        <GraduationCap />
        <b>{active}</b>
        <span>active teacher{active === 1 ? '' : 's'}</span>
      </button>
      <button type="button" data-hue="amber" onClick={() => onTab('requests')}>
        <Inbox />
        <b>{pending}</b>
        <span>pending request{pending === 1 ? '' : 's'}</span>
      </button>
      <button type="button" data-hue="blue" onClick={() => onTab('mine')}>
        <BookOpen />
        <b>{content}</b>
        <span>notes &amp; quizzes</span>
      </button>
    </div>
  );
}
