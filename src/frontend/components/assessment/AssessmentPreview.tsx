import { useState } from 'react';
import { ArrowLeft, ArrowRight, Eye } from 'lucide-react';
import type { PublicQuestion, ResponseValue } from '@shared/api';
import { Button, EmptyState, QuestionCount } from '@frontend/components/ui';
import { QuestionRenderer } from './QuestionRenderer';
import { isAnswered } from './config';

/**
 * Staff preview of the student view: one question at a time, rendered by the same
 * QuestionRenderer students get. Answers live in local state only — nothing is saved, scored
 * or sent anywhere, and the questions passed in must not carry answer keys.
 */
export function AssessmentPreview({
  questions,
  title,
  description,
}: {
  questions: PublicQuestion[];
  title?: string;
  description?: string;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, ResponseValue>>({});
  const total = questions.length;
  const i = Math.min(index, Math.max(total - 1, 0));
  const question = questions[i];

  if (!question) {
    return (
      <EmptyState title="Nothing to preview yet">
        Add a question and it will appear here as a student would see it.
      </EmptyState>
    );
  }
  const answered = questions.map((q) => isAnswered(answers[q.id]));
  const done = answered.filter(Boolean).length;
  const promptId = `preview-${question.id}`;

  return (
    <div className="sheet-ruled" data-testid="assessment-preview">
      <p className="flex items-center gap-2 border-b border-ink bg-yellow px-4 py-2 text-sm font-semibold text-ink sm:px-6">
        <Eye size={16} aria-hidden="true" className="flex-none" />
        Preview — answers are not saved or scored
      </p>
      <div className="p-4 sm:p-6">
        <p className="mb-3 truncate text-sm font-semibold text-ink-2">
          {title?.trim() || 'Untitled assessment'}
        </p>
        <QuestionCount
          answered={answered}
          current={i}
          label={`${done} of ${total} preview questions answered`}
        />
        <p className="t-caption t-num mt-2">
          {done} of {total} answered
        </p>
        {description?.trim() && i === 0 && (
          <p className="t-small mt-4 max-w-prose text-ink-2">{description.trim()}</p>
        )}

        <article
          key={question.id}
          className="rule-heavy mt-5 pt-5 md:grid md:grid-cols-[5.5rem_minmax(0,1fr)] md:gap-x-5"
        >
          <p className="t-figure hidden text-[3.0625rem] md:block" aria-hidden="true">
            {String(i + 1).padStart(2, '0')}
          </p>
          <div className="min-w-0">
            <p className="t-caption t-num">
              Question {i + 1} of {total}
            </p>
            <h3
              id={promptId}
              className="mt-2 whitespace-pre-line break-words text-[1.375rem] font-semibold leading-[1.3] tracking-[-0.01em] text-ink"
            >
              {question.prompt.trim() || (
                <span className="font-normal italic text-ink-3">No prompt written yet</span>
              )}
            </h3>
            <div className="mt-5">
              <QuestionRenderer
                question={question}
                value={answers[question.id]}
                labelledBy={promptId}
                onChange={(v) =>
                  setAnswers((prev) => {
                    const next = { ...prev };
                    if (v === undefined) delete next[question.id];
                    else next[question.id] = v;
                    return next;
                  })
                }
              />
            </div>
          </div>
        </article>

        <div className="mt-8 flex gap-3 border-t border-rule pt-5 md:pl-[6.75rem]">
          <Button
            disabled={i === 0}
            icon={<ArrowLeft size={18} aria-hidden="true" />}
            onClick={() => setIndex(i - 1)}
          >
            Previous
          </Button>
          <Button
            disabled={i >= total - 1}
            iconRight={<ArrowRight size={18} aria-hidden="true" />}
            onClick={() => setIndex(i + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
