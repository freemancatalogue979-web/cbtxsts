/** "Ask AI Tutor" for a question the student just answered. Sends the question
 * id (the server loads the text/answer itself) plus the option text they chose,
 * so shuffled option letters can never confuse the explanation. */
import {Sparkles} from 'lucide-react';
import {askTutor} from '../../lib/tutor';

export default function AskTutorButton({
  questionId,
  chosenText,
  correct,
  label = 'Question',
  className = '',
}: {
  questionId: number;
  chosenText?: string | null;
  correct: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        askTutor({
          prompt: correct ? 'Why is this answer correct?' : chosenText ? 'Why is my answer wrong?' : 'Explain this question and its answer.',
          mode: correct || !chosenText ? 'QUESTION_HELP' : 'WHY_WRONG',
          context: {question_id: questionId, ...(chosenText ? {selected_text: `The answer I chose: ${chosenText}`} : {})},
          label,
          autoSend: true,
          temporary: true,
        })
      }
      className={`inline-flex items-center gap-1.5 rounded-lg border border-nova-400/35 bg-nova-500/10 px-3 py-1.5 text-[0.76rem] font-bold text-nova-200 hover:bg-nova-500/20 ${className}`}
    >
      <Sparkles className="size-3.5" />
      {correct ? 'Ask AI Tutor' : 'Why was I wrong? Ask AI Tutor'}
    </button>
  );
}
