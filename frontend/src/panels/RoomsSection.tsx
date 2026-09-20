/**
 * RoomsSection — multiplayer quiz nights live inside the Duel arena tab.
 *
 * Hosts create a room (title, question source, length, clock), everyone else
 * joins with the six-character code. Rooms hold up to 15 players and keep a
 * live chat running from the lobby to the final standings.
 */
import {Copy, Crown, DoorOpen, Gamepad2, Plus, Radio, Users} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import {motion} from 'motion/react';
import {Button, Card, Chip, Field, Modal, SectionHeading, TextInput} from '../components/ui';
import {api} from '../lib/api';
import {staggerContainer, staggerItem} from '../lib/motion';
import {useSession} from '../store/session';
import type {Course, RoomState} from '../lib/types';

const LENGTHS = [5, 10, 15, 20];
const CLOCKS = [15, 30, 45, 60];

export default function RoomsSection({onOpenRoom}: {onOpenRoom: (roomId: number) => void}) {
  const {toast, on} = useSession();
  const [rooms, setRooms] = useState<RoomState[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState<number | null>(null);
  const [length, setLength] = useState(10);
  const [clock, setClock] = useState(30);
  const [busy, setBusy] = useState(false);
  const [joinBusy, setJoinBusy] = useState(false);

  const load = useCallback(() => {
    api
      .myRooms()
      .then((data) => setRooms(data.rooms))
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    api.courses().then(setCourses).catch(() => undefined);
  }, []);
  useEffect(() => on('rooms_update', load), [on, load]);
  useEffect(() => {
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const {room} = await api.createRoom({
        title: title.trim() || 'Arena Room',
        course_id: courseId,
        question_count: length,
        per_question_seconds: clock,
      });
      setCreateOpen(false);
      setTitle('');
      toast('success', 'Room open!', `Share code ${room.code} — up to ${room.capacity} players.`);
      onOpenRoom(room.id);
    } catch (error) {
      toast('error', 'Could not create the room', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (joinCode.trim().length < 6) return;
    setJoinBusy(true);
    try {
      const {room} = await api.joinRoom(joinCode);
      setJoinCode('');
      toast('success', 'Joined the room', room.title);
      onOpenRoom(room.id);
    } catch (error) {
      toast('error', 'Could not join', (error as Error).message);
    } finally {
      setJoinBusy(false);
    }
  };

  const copyCode = async (room: RoomState) => {
    try {
      await navigator.clipboard.writeText(room.code);
      toast('success', 'Code copied', room.code);
    } catch {
      toast('info', 'Room code', room.code);
    }
  };

  return (
    <section>
      <SectionHeading
        title="Multiplayer rooms"
        subtitle="Quiz night for up to 15 players — live rounds, live scoreboard, live chat."
        icon={<Users className="size-4" />}
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)} icon={<Plus className="size-4" />}>
            New room
          </Button>
        }
      />

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-[1fr_1.35fr]">
        <Card className="p-4 sm:p-5">
          <h3 className="flex items-center gap-2 text-[0.9rem] font-extrabold text-mist-50">
            <DoorOpen className="size-4 text-nova-300" /> Join with a code
          </h3>
          <p className="mt-1 text-[0.8rem] font-medium text-mist-500">A friend opened a room? Type its six-character code.</p>
          <div className="mt-3 flex gap-2">
            <TextInput
 className="min-w-0 flex-1 tracking-[0.2em] sm:tracking-[0.3em]"
              placeholder="ABC123"
              maxLength={6}
              value={joinCode}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') join();
              }}
            />
            <Button className="shrink-0 px-4 sm:px-5" onClick={join} loading={joinBusy} disabled={joinCode.trim().length < 6}>
              Join
            </Button>
          </div>
        </Card>

        <Card className="relative overflow-hidden p-4 sm:p-5">
          <div className="pointer-events-none absolute -top-16 -right-10 size-44 rounded-full bg-nova-600/18 blur-3xl" />
          <div className="relative">
            <h3 className="flex items-center gap-2 text-[0.9rem] font-extrabold text-mist-50">
              <Crown className="size-4 text-gold-400" /> Host a room
            </h3>
            <p className="mt-1 text-[0.8rem] font-medium text-mist-400">
              Pick the bank, the length and the clock. You control the pace — guests race and chat.
            </p>
            <Button className="mt-3 w-full sm:w-auto" variant="gold" size="lg" onClick={() => setCreateOpen(true)} icon={<Gamepad2 className="size-4" />}>
              Create a room
            </Button>
          </div>
        </Card>
      </div>

      {rooms.length > 0 && (
        <motion.ul variants={staggerContainer} initial="hidden" animate="show" className="mt-3 grid gap-2.5 sm:gap-3 lg:grid-cols-2">
          {rooms.map((room) => (
            <motion.li key={room.id} variants={staggerItem}>
              <Card className="flex items-center gap-3 p-3.5">
                <span className={`grid size-10 shrink-0 place-items-center rounded-2xl ${room.status === 'live' ? 'bg-mint-500/15 text-mint-300' : 'bg-nova-500/15 text-nova-300'}`}>
                  {room.status === 'live' ? <Radio className="size-4.5 animate-pulse" /> : <Users className="size-4.5" />}
                </span>
                <button onClick={() => onOpenRoom(room.id)} className="min-w-0 flex-1 text-left touch-manipulation">
                  <p className="truncate text-[0.86rem] font-extrabold text-mist-50">
                    {room.title} {room.is_host && <Crown className="inline size-3.5 text-gold-400" />}
                  </p>
                  <p className="text-[0.7rem] font-bold text-mist-500">
                    {room.members.length}/{room.capacity} players · {room.status === 'live' ? `Q${Math.max(1, room.round_index + 1)}/${room.questions_total}` : 'lobby'}
                  </p>
                </button>
                <Chip className="border-gold-400/30 bg-gold-400/10 font-display tracking-[0.15em] text-gold-300">{room.code}</Chip>
                <Button variant="ghost" size="sm" onClick={() => copyCode(room)} aria-label="Copy room code">
                  <Copy className="size-4" />
                </Button>
                <Button size="sm" className="shrink-0 px-3" onClick={() => onOpenRoom(room.id)}>
                  Enter
                </Button>
              </Card>
            </motion.li>
          ))}
        </motion.ul>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create a room">
        <div className="space-y-3.5">
          <Field label="Room name" hint="Something your friends will recognise.">
            <TextInput placeholder="Friday Night Arena" value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} />
          </Field>

          <Field label="Question source">
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setCourseId(null)}
                className={`rounded-xl border px-3 py-2 text-[0.76rem] font-extrabold transition-colors touch-manipulation ${
                  courseId === null ? 'border-nova-400/50 bg-nova-500/15 text-nova-200' : 'border-white/10 bg-white/4 text-mist-400'
                }`}
              >
                Whole arena
              </button>
              {courses.map((course) => (
                <button
                  key={course.id}
                  onClick={() => setCourseId(course.id)}
                  className={`rounded-xl border px-3 py-2 text-[0.76rem] font-extrabold transition-colors touch-manipulation ${
                    courseId === course.id ? 'border-nova-400/50 bg-nova-500/15 text-nova-200' : 'border-white/10 bg-white/4 text-mist-400'
                  }`}
                >
                  {course.code}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Questions">
            <div className="flex gap-1.5">
              {LENGTHS.map((count) => (
                <button
                  key={count}
                  onClick={() => setLength(count)}
                  className={`flex-1 rounded-xl border py-2 text-[0.8rem] font-black transition-colors touch-manipulation ${
                    length === count ? 'border-gold-400/50 bg-gold-400/12 text-gold-300' : 'border-white/10 bg-white/4 text-mist-400'
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Seconds per question">
            <div className="flex gap-1.5">
              {CLOCKS.map((seconds) => (
                <button
                  key={seconds}
                  onClick={() => setClock(seconds)}
                  className={`flex-1 rounded-xl border py-2 text-[0.8rem] font-black transition-colors touch-manipulation ${
                    clock === seconds ? 'border-gold-400/50 bg-gold-400/12 text-gold-300' : 'border-white/10 bg-white/4 text-mist-400'
                  }`}
                >
                  {seconds}s
                </button>
              ))}
            </div>
          </Field>

          <Button block size="lg" onClick={create} loading={busy} icon={<Crown className="size-4" />}>
            Open the room
          </Button>
        </div>
      </Modal>
    </section>
  );
}
