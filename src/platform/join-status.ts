import type { ParticipationStatus } from './firebase/models';

export function participationStatusMessage(status: ParticipationStatus): string {
  switch (status) {
    case 'waiting':
      return "you're already in the queue. your exact position is private.";

    case 'invited':
      return 'you have a pending invitation.';

    case 'active':
      return 'your turn is currently active.';

    case 'completed':
      return "you've already contributed this season.";

    case 'expired':
      return 'your contribution window expired this season.';

    case 'invitation_expired':
      return 'your invitation expired before it was accepted.';

    case 'skipped':
      return 'your turn was skipped this season.';

    case 'withdrawn':
      return 'your participation was withdrawn for this season.';
  }
}