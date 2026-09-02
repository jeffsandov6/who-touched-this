import type { ParticipationStatus } from './firebase/models';

export function participationStatusMessage(status: ParticipationStatus): string {
  switch (status) {
    case 'waiting':
      return "You're already in the queue. Your exact position is private.";
    case 'invited':
      return 'You have a pending invitation.';
    case 'active':
      return 'Your contribution is already in progress.';
    case 'completed':
      return "You've already contributed this season.";
    case 'expired':
      return 'Your turn expired this season.';
    case 'invitation_expired':
      return 'Your invitation expired this season.';
    case 'skipped':
      return 'Your turn was skipped this season.';
    case 'withdrawn':
      return 'A participation record already exists for this season and will not be recreated automatically.';
  }
}
