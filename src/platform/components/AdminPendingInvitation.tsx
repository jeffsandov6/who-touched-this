/** @jsxImportSource react */

import { useEffect, useState } from 'react';
import type { AdminPendingInvitation as PendingInvitation } from '../firebase/invitations';
import { canExpireInvitation, formatTurnDuration } from '../invitation';
import Countdown from './Countdown';

interface Props {
  invitation: PendingInvitation;
  busy: boolean;
  onExpire: () => Promise<void>;
  onRetryEmail: () => Promise<void>;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

function deliveryLabel(invitation: PendingInvitation): string {
  if (!invitation.emailDelivery || invitation.emailDelivery.status === 'sending') {
    return 'Pending';
  }
  if (invitation.emailDelivery.status === 'failed') return 'Failed';
  return invitation.emailDelivery.sentAt
    ? `Sent ${formatDate(invitation.emailDelivery.sentAt)}`
    : 'Sent';
}

export default function AdminPendingInvitation({ invitation, busy, onExpire, onRetryEmail }: Props) {
  const [nowMillis, setNowMillis] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMillis(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="admin-turn-panel">
      <p className="notice">Invitation pending. Contact the contributor manually for now.</p>
      <dl className="admin-current-turn-details">
        <div><dt>Contributor</dt><dd><strong>{invitation.displayName}</strong></dd></div>
        <div><dt>GitHub</dt><dd><a href={invitation.githubProfileUrl} rel="noreferrer">@{invitation.githubUsername}</a></dd></div>
        <div><dt>Private contact</dt><dd><a href={`mailto:${invitation.email}`}>{invitation.email}</a></dd></div>
        <div><dt>Invited</dt><dd>{formatDate(invitation.invitedAt)}</dd></div>
        <div><dt>Accept by</dt><dd>{formatDate(invitation.acceptBy)}</dd></div>
        <div><dt>Contribution duration</dt><dd>{formatTurnDuration(invitation.turnDurationHours)}</dd></div>
        <div><dt>Email</dt><dd>{deliveryLabel(invitation)}</dd></div>
        <div><dt>Time to accept</dt><dd><Countdown dueAtMillis={invitation.acceptBy.getTime()} /></dd></div>
      </dl>
      {invitation.emailDelivery?.status === 'failed' && (
        <div>
          <p className="notice notice-error" role="status">
            Automatic email failed. Contact the contributor manually or retry delivery.
          </p>
          <div className="admin-toolbar-actions">
            <button className="button" type="button" disabled={busy} onClick={() => void onRetryEmail()}>
              {busy ? 'Retrying…' : 'Retry email'}
            </button>
            <a className="button button-secondary" href={`mailto:${invitation.email}`}>Contact manually</a>
          </div>
        </div>
      )}
      {canExpireInvitation('pending', invitation.acceptBy.getTime(), nowMillis) && (
        <button
          className="button button-danger"
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Expire this invitation? This cannot be undone in the application.')) {
              void onExpire();
            }
          }}
        >
          {busy ? 'Expiring…' : 'Expire invitation'}
        </button>
      )}
    </div>
  );
}
