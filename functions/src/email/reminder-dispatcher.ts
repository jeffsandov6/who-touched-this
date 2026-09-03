import {
  isInvitationReminderEligible,
  isTurn24HourReminderEligible,
  isTurn72HourReminderEligible,
  isTurnDeadlinePassedEmailEligible,
} from './notification-eligibility.js';
import {
  sendInvitationReminder,
  sendTurnNotification,
  type DateLike,
  type InvitationReminderData,
  type LifecycleDeliveryDependencies,
  type TurnEmailData,
} from './lifecycle-delivery.js';

export interface ReminderDocument<T> { id: string; data: T }

export interface ReminderSweepInput {
  now: Date;
  invitations: Array<ReminderDocument<InvitationReminderData & { invitedAt: unknown }>>;
  turns: Array<ReminderDocument<TurnEmailData>>;
  claimToken(): string;
  onError?(sourceId: string, error: unknown): void;
}

function dateLike(value: unknown): value is DateLike {
  return typeof value === 'object' && value !== null
    && 'toDate' in value && typeof value.toDate === 'function';
}

export async function dispatchEligibleNotifications(
  input: ReminderSweepInput,
  dependencies: LifecycleDeliveryDependencies,
): Promise<void> {
  async function attempt(sourceId: string, send: () => Promise<unknown>) {
    try {
      await send();
    } catch (error) {
      input.onError?.(sourceId, error);
    }
  }
  for (const invitation of input.invitations) {
    if (!dateLike(invitation.data.invitedAt) || !dateLike(invitation.data.acceptBy)) continue;
    if (isInvitationReminderEligible({
      status: String(invitation.data.status),
      invitedAt: invitation.data.invitedAt.toDate(),
      acceptBy: invitation.data.acceptBy.toDate(),
    }, input.now)) {
      await attempt(invitation.id, () => sendInvitationReminder(
        invitation.id, invitation.data, input.claimToken(), dependencies,
      ));
    }
  }

  for (const turn of input.turns) {
    if (!dateLike(turn.data.startedAt) || !dateLike(turn.data.dueAt)) continue;
    const timing = {
      status: String(turn.data.status),
      startedAt: turn.data.startedAt.toDate(),
      dueAt: turn.data.dueAt.toDate(),
    };
    if (isTurn72HourReminderEligible(timing, input.now)) {
      await attempt(turn.id, () => sendTurnNotification(
        'turn_72h_reminder', turn.id, turn.data, input.claimToken(), dependencies,
      ));
    }
    if (isTurn24HourReminderEligible(timing, input.now)) {
      await attempt(turn.id, () => sendTurnNotification(
        'turn_24h_reminder', turn.id, turn.data, input.claimToken(), dependencies,
      ));
    }
    if (isTurnDeadlinePassedEmailEligible(timing, input.now)) {
      await attempt(turn.id, () => sendTurnNotification(
        'turn_deadline_passed', turn.id, turn.data, input.claimToken(), dependencies,
      ));
    }
  }
}
