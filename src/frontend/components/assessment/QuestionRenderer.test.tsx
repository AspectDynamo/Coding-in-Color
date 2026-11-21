import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicQuestion, ResponseValue } from '@shared/api';
import { QuestionRenderer } from './QuestionRenderer';

const base = { id: 'q1', prompt: 'Prompt', skillCategory: 'loops', points: 1, order: 1 } as const;
const q = (type: PublicQuestion['type'], config: Record<string, unknown>): PublicQuestion => ({
  ...base,
  type,
  config,
});

function Harness({
  question,
  onValue,
}: {
  question: PublicQuestion;
  onValue: (v: ResponseValue | undefined) => void;
}) {
  const [value, setValue] = useState<ResponseValue | undefined>();
  return (
    <>
      <h1 id="p">{question.prompt}</h1>
      <QuestionRenderer
        question={question}
        value={value}
        labelledBy="p"
        onChange={(v) => {
          setValue(v);
          onValue(v);
        }}
      />
    </>
  );
}

afterEach(cleanup);

describe('QuestionRenderer', () => {
  it('multiple choice: selects one option in a labelled radiogroup', async () => {
    const onValue = vi.fn();
    render(
      <Harness
        question={q('multiple_choice', {
          options: [
            { id: 'a', label: 'Red' },
            { id: 'b', label: 'Blue' },
          ],
        })}
        onValue={onValue}
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Prompt' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Blue/ }));
    expect(onValue).toHaveBeenLastCalledWith({ kind: 'single', optionId: 'b' });
    expect(screen.getByRole('radio', { name: /Blue/ })).toBeChecked();
  });

  it('predict output: shows the code in a monospace block with line numbers', () => {
    render(
      <Harness
        question={q('predict_output', {
          code: 'x = 1\nprint(x)',
          language: 'python',
          options: [
            { id: 'a', label: '1' },
            { id: 'b', label: '2' },
          ],
        })}
        onValue={() => {}}
      />,
    );
    const block = screen.getByLabelText(/python code, 2 lines/);
    expect(block.tagName).toBe('PRE');
    expect(block).toHaveTextContent('print(x)');
  });

  it('multiple select: toggles options and clears when none are left', async () => {
    const onValue = vi.fn();
    render(
      <Harness
        question={q('multiple_select', {
          options: [
            { id: 'a', label: 'A1' },
            { id: 'b', label: 'B1' },
            { id: 'c', label: 'C1' },
          ],
        })}
        onValue={onValue}
      />,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'A1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'C1' }));
    expect(onValue).toHaveBeenLastCalledWith({ kind: 'multi', optionIds: ['a', 'c'] });
    await userEvent.click(screen.getByRole('checkbox', { name: 'A1' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'C1' }));
    expect(onValue).toHaveBeenLastCalledWith(undefined);
  });

  it('debugging: tapping a numbered line records its 1-based line number', async () => {
    const onValue = vi.fn();
    render(
      <Harness
        question={q('debugging', { code: 'total = 0\nfor i in range(3)\n  total += i' })}
        onValue={onValue}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: /Line 2: for i in range\(3\)/ }));
    expect(onValue).toHaveBeenLastCalledWith({ kind: 'line', line: 2 });
    expect(screen.getByText('You picked line 2.')).toBeInTheDocument();
  });

  it('ordering: up/down buttons reorder and announce the move', async () => {
    const onValue = vi.fn();
    render(
      <Harness
        question={q('ordering', {
          items: [
            { id: 'x', label: 'Boil' },
            { id: 'y', label: 'Pour' },
            { id: 'z', label: 'Drink' },
          ],
        })}
        onValue={onValue}
      />,
    );
    expect(screen.getByRole('button', { name: 'Move “Boil” up' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move “Drink” up' }));
    expect(onValue).toHaveBeenLastCalledWith({ kind: 'order', itemIds: ['x', 'z', 'y'] });
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items[1]).toHaveTextContent('Drink');
    expect(screen.getByText('Drink moved to position 2 of 3.')).toBeInTheDocument();
  });

  it('ordering: the presented order can be confirmed without moving anything', async () => {
    const onValue = vi.fn();
    render(
      <Harness
        question={q('ordering', {
          items: [
            { id: 'x', label: 'One' },
            { id: 'y', label: 'Two' },
          ],
        })}
        onValue={onValue}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'This order is already right' }));
    expect(onValue).toHaveBeenLastCalledWith({ kind: 'order', itemIds: ['x', 'y'] });
    expect(screen.getByText('Order saved')).toBeInTheDocument();
  });

  it('short logic: typed text is recorded; whitespace-only clears', async () => {
    const onValue = vi.fn();
    render(<Harness question={q('short_logic', { maxLength: 5 })} onValue={onValue} />);
    const input = screen.getByRole('textbox', { name: 'Prompt' });
    await userEvent.type(input, '1234567');
    expect(onValue).toHaveBeenLastCalledWith({ kind: 'text', text: '12345' });
    await userEvent.clear(input);
    expect(onValue).toHaveBeenLastCalledWith(undefined);
  });

  it('confidence likert: clearly labelled as unscored self-report with 1–5 scale', async () => {
    const onValue = vi.fn();
    render(
      <Harness
        question={q('confidence_likert', { minLabel: 'Not at all', maxLabel: 'Very' })}
        onValue={onValue}
      />,
    );
    const panel = screen.getByTestId('likert-panel');
    expect(panel).toHaveTextContent('About you — not scored');
    expect(panel).toHaveTextContent('How confident do you feel?');
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    await userEvent.click(screen.getByRole('radio', { name: '5 out of 5 — Very' }));
    expect(onValue).toHaveBeenLastCalledWith({ kind: 'likert', value: 5 });
  });
});
