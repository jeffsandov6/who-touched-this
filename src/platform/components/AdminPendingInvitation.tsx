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
    return 'pending';
  }
  if (invitation.emailDelivery.status === 'failed') return 'failed';
  return invitation.emailDelivery.sentAt
    ? `sent ${formatDate(invitation.emailDelivery.sentAt)}`
    : 'sent';
}

export default function AdminPendingInvitation({ invitation, busy, onExpire, onRetryEmail }: Props) {
  const [nowMillis, setNowMillis] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMillis(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="admin-turn-panel">
      <p className="notice">invitation pending. contact the contributor manually for now.</p>
      <dl className="admin-current-turn-details">
        <div><dt>contributor</dt><dd><strong>{invitation.displayName}</strong></dd></div>
        <div><dt>GitHub</dt><dd><a href={invitation.githubProfileUrl} rel="noreferrer">@{invitation.githubUsername}</a></dd></div>
        <div><dt>private contact</dt><dd><a href={`mailto:${invitation.email}`}>{invitation.email}</a></dd></div>
        <div><dt>invited</dt><dd>{formatDate(invitation.invitedAt)}</dd></div>
        <div><dt>accept by</dt><dd>{formatDate(invitation.acceptBy)}</dd></div>
        <div><dt>contribution duration</dt><dd>{formatTurnDuration(invitation.turnDurationHours)}</dd></div>
        <div><dt>email</dt><dd>{deliveryLabel(invitation)}</dd></div>
        <div><dt>time to accept</dt><dd><Countdown dueAtMillis={invitation.acceptBy.getTime()} /></dd></div>
      </dl>
      {invitation.emailDelivery?.status === 'failed' && (
        <div>
          <p className="notice notice-error" role="status">
            automatic email failed. contact the contributor manually or retry delivery.
          </p>
          <div className="admin-toolbar-actions">
            <button className="button" type="button" disabled={busy} onClick={() => void onRetryEmail()}>
              {busy ? 'retrying…' : 'retry email'}
            </button>
            <a className="button button-secondary" href={`mailto:${invitation.email}`}>contact manually</a>
          </div>
        </div>
      )}
      {canExpireInvitation('pending', invitation.acceptBy.getTime(), nowMillis) && (
        <button
          className="button button-danger"
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm('expire this invitation? this cannot be undone in the application.')) {
              void onExpire();
            }
          }}
        >
          {busy ? 'expiring…' : 'expire invitation'}
        </button>
      )}
    </div>
  );
}
