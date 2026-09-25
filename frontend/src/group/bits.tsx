/** Small shared building blocks for the study-group sections. */
import {Crown, ShieldCheck} from 'lucide-react';
import type {ReactNode} from 'react';
import {Avatar, Chip} from '../components/ui';
import type {PresenceStatus, StudentChip} from '../lib/types';

/** A section root that scrolls internally — the page itself never grows. */
export function SectionScroll({children, className = ''}: {children: ReactNode; className?: string}) {
  return <div className={`h-full min-h-0 overflow-y-auto overscroll-contain ${className}`}>{children}</div>;
}

export function SectionHead({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
      {icon && <span className="grid size-8 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-nova-300">{icon}</span>}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[0.98rem] font-extrabold text-mist-50 sm:text-[1.05rem]">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[0.74rem] font-medium text-mist-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const PRESENCE_TONE: Record<PresenceStatus, string> = {
  online: 'bg-mint-400',
  away: 'bg-gold-400',
  offline: 'bg-mist-600',
};

/** Subtle presence dot — online (mint), away (amber), offline (grey). */
export function PresenceDot({status, className = ''}: {status: PresenceStatus; className?: string}) {
  return (
    <span
      title={status}
      className={`inline-block size-2 shrink-0 rounded-full ring-2 ring-ink-900 ${PRESENCE_TONE[status] ?? PRESENCE_TONE.offline} ${className}`}
    />
  );
}

export function RoleChip({role}: {role: string}) {
  if (role === 'owner')
    return (
      <Chip className="border-gold-500/30 bg-gold-500/12 text-gold-200" icon={<Crown className="size-3" />}>
        Owner
      </Chip>
    );
  if (role === 'moderator')
    return (
      <Chip className="border-nova-500/30 bg-nova-500/12 text-nova-200" icon={<ShieldCheck className="size-3" />}>
        Mod
      </Chip>
    );
  return null;
}

export function MemberAvatar({
  member,
  size = 36,
  status,
}: {
  member: StudentChip | {id?: number; student_id?: number; name: string; initials?: string; avatar_hue: number; has_photo: boolean};
  size?: number;
  status?: PresenceStatus;
}) {
  // The photo is always of the *student*: prefer an explicit student_id (chat
  // messages carry their own message id in `id`), else fall back to `id`
  // (StudentChip / member rows where id *is* the student id).
  const sid = (member as {student_id?: number}).student_id;
  const id = sid ?? ('id' in member && member.id ? member.id : 0);
  return (
    <span className="relative inline-flex shrink-0">
      <Avatar
        name={member.name}
        hue={member.avatar_hue}
        initials={(member as {initials?: string}).initials}
        size={size}
        photo={{id, has: member.has_photo}}
      />
      {status && (
        <span className={`absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-ink-900 ${PRESENCE_TONE[status]}`} style={{width: Math.max(9, size * 0.26), height: Math.max(9, size * 0.26)}} />
      )}
    </span>
  );
}
