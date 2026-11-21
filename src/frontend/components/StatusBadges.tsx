import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Clock,
  DoorClosed,
  DoorOpen,
  Hourglass,
} from 'lucide-react';
import type { ConsentStatus, SessionStatus, StudentStatus, AssessmentStage } from '@shared/types';
import { Badge, type BadgeTone } from '@frontend/components/ui';
import { STAGE_SHORT, titleCase } from '@frontend/lib/format';

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  if (status === 'open')
    return (
      <Badge tone="good" icon={<DoorOpen size={13} aria-hidden="true" />}>
        Open
      </Badge>
    );
  if (status === 'scheduled')
    return (
      <Badge tone="info" icon={<Clock size={13} aria-hidden="true" />}>
        Scheduled
      </Badge>
    );
  return <Badge icon={<DoorClosed size={13} aria-hidden="true" />}>Closed</Badge>;
}

export function StageBadge({ stage }: { stage: AssessmentStage }) {
  return <span className={`stage stage-${stage}`}>{STAGE_SHORT[stage]}</span>;
}

export function StudentStatusBadge({ status }: { status: StudentStatus }) {
  if (status === 'active') return <Badge tone="good">Active</Badge>;
  if (status === 'pending_consent') return <Badge tone="warn">Waiting for consent</Badge>;
  return <Badge tone="bad">Withdrawn</Badge>;
}

export function ConsentBadge({ status }: { status: ConsentStatus }) {
  const tone: Record<ConsentStatus, BadgeTone> = {
    not_required: 'neutral',
    pending: 'warn',
    granted: 'good',
    denied: 'bad',
    withdrawn: 'bad',
  };
  return <Badge tone={tone[status]}>{titleCase(status)}</Badge>;
}

export type SeatStatus = 'not_started' | 'in_progress' | 'submitted' | 'blocked_consent';
export function SeatStatusBadge({ status }: { status: SeatStatus }) {
  switch (status) {
    case 'submitted':
      return (
        <Badge tone="good" icon={<CheckCircle2 size={13} aria-hidden="true" />}>
          Submitted
        </Badge>
      );
    case 'in_progress':
      return (
        <Badge tone="info" icon={<Hourglass size={13} aria-hidden="true" />}>
          In progress
        </Badge>
      );
    case 'blocked_consent':
      return (
        <Badge tone="warn" icon={<CircleSlash size={13} aria-hidden="true" />}>
          Needs consent
        </Badge>
      );
    default:
      return <Badge icon={<CircleDashed size={13} aria-hidden="true" />}>Not started</Badge>;
  }
}
