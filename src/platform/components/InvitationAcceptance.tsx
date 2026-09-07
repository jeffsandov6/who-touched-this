/** @jsxImportSource react */

import { useEffect, useState } from 'react';
import type { OwnPendingInvitation } from '../firebase/invitations';
import { formatTurnDuration } from '../invitation';
import Countdown from './Countdown';

interface Props {
  invitation: OwnPendingInvitation;
  busy: boolean;
  onAccept: () => Promise<void>;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default function InvitationAcceptance({ invitation, busy, onAccept }: Props) {
  const [nowMillis, setNowMillis] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMillis(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const deadlinePassed = nowMillis > invitation.acceptBy.getTime();

  return (
    <section className="invitation-acceptance" aria-labelledby="invitation-heading">
      <h2 id="invitation-heading">it&apos;s your turn.</h2>
      <p>
        accept by <strong>{formatDate(invitation.acceptBy)}</strong>. once you accept, your
        contribution window starts immediately.
      </p>
      <p>you&apos;ll have {formatTurnDuration(invitation.turnDurationHours)} from the moment you accept.</p>
      <p>
        time left to accept: <Countdown dueAtMillis={invitation.acceptBy.getTime()} />
      </p>

      <p>
        if you don&apos;t accept before the deadline, the invitation will expire.
      </p>
      <button
        className="button"
        type="button"
        disabled={busy || deadlinePassed}
        onClick={() => void onAccept()}
      >
        {busy ? 'accepting…' : deadlinePassed ? 'acceptance deadline passed' : 'accept turn'}
      </button>
    </section>
  );
}
