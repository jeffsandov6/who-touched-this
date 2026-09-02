/** @jsxImportSource react */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AdminServiceError, getOwnAdminAuthorization } from '../firebase/admin';
import {
  loadSeasonOneAdminQueue,
  promoteWaitingQueueEntry,
  restoreWaitingQueueEntry,
  type AdminQueueItem,
} from '../firebase/admin-queue';
import {
  filterQueueEntries,
  getEffectiveWaitingQueue,
  sortByEffectiveQueueOrder,
} from '../firebase/admin-queue-logic';
import {
  AuthenticationError,
  observeAuthState,
  resolveGitHubIdentity,
  signInWithGitHub,
  signOutOfPlatform,
} from '../firebase/auth';
import {
  reconcileGitHubIdentity,
  type GitHubIdentity,
} from '../firebase/github-identity';
import { QUEUE_STATUSES, type AdminRole } from '../firebase/models';
import {
  expireCurrentTurn,
  loadAdminCurrentTurn,
  markCurrentTurnUnderReview,
  recordPullRequestSubmission,
  recordMergedContribution,
  skipCurrentTurn,
  startTurn,
  type AdminCurrentTurn,
} from '../firebase/turns';
import AdminCurrentTurnPanel from '../components/AdminCurrentTurn';

type AccessState = 'checking' | 'signed-out' | 'denied' | 'authorized';

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof AdminServiceError || error instanceof AuthenticationError
    ? error.message
    : fallback;
}

function formatJoinedAt(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function defaultDeadlineValue(): string {
  const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
  const localTime = new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

export default function AdminPage() {
  const requestSequence = useRef(0);
  const [accessState, setAccessState] = useState<AccessState>('checking');
  const [identity, setIdentity] = useState<GitHubIdentity | null>(null);
  const [adminRole, setAdminRole] = useState<AdminRole | null>(null);
  const [queue, setQueue] = useState<AdminQueueItem[]>([]);
  const [currentTurn, setCurrentTurn] = useState<AdminCurrentTurn | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [deadline, setDeadline] = useState(defaultDeadlineValue);
  const [turnBusy, setTurnBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function refreshAdminData(sequence = requestSequence.current) {
    setQueueLoading(true);
    try {
      const [nextQueue, nextTurn] = await Promise.all([
        loadSeasonOneAdminQueue(),
        loadAdminCurrentTurn(),
      ]);
      if (sequence === requestSequence.current) {
        setQueue(nextQueue);
        setCurrentTurn(nextTurn);
      }
    } catch (error) {
      if (sequence === requestSequence.current) {
        setQueue([]);
        setCurrentTurn(null);
        setErrorMessage(safeErrorMessage(error, 'Admin turn data could not be loaded.'));
      }
    } finally {
      if (sequence === requestSequence.current) setQueueLoading(false);
    }
  }

  async function loadAdminState(nextIdentity: GitHubIdentity) {
    const sequence = ++requestSequence.current;
    setIdentity((current) => reconcileGitHubIdentity(current, nextIdentity));
    setAdminRole(null);
    setQueue([]);
    setCurrentTurn(null);
    setQueueLoading(false);
    setAccessState('checking');
    setErrorMessage(null);

    try {
      const authorization = await getOwnAdminAuthorization(nextIdentity.githubUserId);
      if (sequence !== requestSequence.current) return;

      if (!authorization.authorized || !authorization.role) {
        setAccessState('denied');
        return;
      }

      setAdminRole(authorization.role);
      setAccessState('authorized');
      await refreshAdminData(sequence);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setAccessState('denied');
      setQueue([]);
      setErrorMessage(safeErrorMessage(error, 'Admin authorization could not be verified.'));
    }
  }

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    try {
      unsubscribe = observeAuthState((user) => {
        void (async () => {
          if (!user) {
            ++requestSequence.current;
            if (active) {
              setIdentity(null);
              setAdminRole(null);
              setQueue([]);
              setCurrentTurn(null);
              setAccessState('signed-out');
              setErrorMessage(null);
            }
            return;
          }

          try {
            const nextIdentity = await resolveGitHubIdentity(user);
            if (active) await loadAdminState(nextIdentity);
          } catch {
            if (active) {
              ++requestSequence.current;
              setIdentity(null);
              setAdminRole(null);
              setQueue([]);
              setCurrentTurn(null);
              setAccessState('denied');
              setErrorMessage(null);
            }
          }
        })();
      });
    } catch {
      setAccessState('denied');
      setErrorMessage('Firebase configuration is unavailable. Check the local environment setup.');
    }

    return () => {
      active = false;
      ++requestSequence.current;
      unsubscribe();
    };
  }, []);

  const waitingQueue = useMemo(() => getEffectiveWaitingQueue(queue), [queue]);
  const orderedQueue = useMemo(() => {
    const nonWaiting = sortByEffectiveQueueOrder(
      queue.filter((entry) => entry.status !== 'waiting'),
    );
    return [...waitingQueue, ...nonWaiting];
  }, [queue, waitingQueue]);
  const positionedQueue = useMemo(
    () => {
      const waitingPositions = new Map(
        waitingQueue.map((entry, index) => [entry.githubUserId, index + 1]),
      );
      return orderedQueue.map((entry) => ({
        ...entry,
        effectivePosition: waitingPositions.get(entry.githubUserId) ?? null,
      }));
    },
    [orderedQueue, waitingQueue],
  );
  const visibleQueue = useMemo(
    () => filterQueueEntries(positionedQueue, searchTerm, statusFilter),
    [positionedQueue, searchTerm, statusFilter],
  );

  async function handleSignIn() {
    setAuthBusy(true);
    setErrorMessage(null);
    try {
      const nextIdentity = await signInWithGitHub();
      await loadAdminState(nextIdentity);
    } catch (error) {
      setErrorMessage(safeErrorMessage(error, 'GitHub sign-in could not be completed.'));
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    setAuthBusy(true);
    setErrorMessage(null);
    ++requestSequence.current;
    setQueue([]);
    setCurrentTurn(null);
    try {
      await signOutOfPlatform();
    } catch {
      setErrorMessage('Sign out could not be completed. Please try again.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handlePriorityAction(entry: AdminQueueItem) {
    setBusyEntryId(entry.githubUserId);
    setErrorMessage(null);
    try {
      if (entry.priority > 0) {
        await restoreWaitingQueueEntry(entry.githubUserId);
      } else {
        await promoteWaitingQueueEntry(entry.githubUserId);
      }
      await refreshAdminData();
    } catch (error) {
      setErrorMessage(safeErrorMessage(error, 'The queue priority could not be changed.'));
    } finally {
      setBusyEntryId(null);
    }
  }

  async function handleStartTurn() {
    const selected = waitingQueue[0];
    if (!selected || !identity) return;

    const dueAt = new Date(deadline);
    if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= Date.now()) {
      setErrorMessage('Choose a deadline in the future.');
      return;
    }
    if (!window.confirm(`Start ${selected.displayName}'s turn with this deadline?`)) return;

    setTurnBusy(true);
    setErrorMessage(null);
    try {
      await startTurn({
        adminGithubUserId: identity.githubUserId,
        selectedGithubUserId: selected.githubUserId,
        dueAt,
      });
      await refreshAdminData();
    } catch (error) {
      setErrorMessage(safeErrorMessage(error, 'The turn could not be started.'));
    } finally {
      setTurnBusy(false);
    }
  }

  async function runCurrentTurnAction(action: () => Promise<unknown>, fallback: string) {
    setTurnBusy(true);
    setErrorMessage(null);
    try {
      await action();
      await refreshAdminData();
    } catch (error) {
      setErrorMessage(safeErrorMessage(error, fallback));
    } finally {
      setTurnBusy(false);
    }
  }

  return (
    <section className="page-content admin-page" aria-labelledby="admin-heading">
      <h1 id="admin-heading">Admin</h1>

      {errorMessage && (
        <p className="notice notice-error" role="alert">
          {errorMessage}
        </p>
      )}

      {accessState === 'checking' ? (
        <p role="status">Verifying admin access…</p>
      ) : accessState === 'signed-out' ? (
        <div className="admin-auth-panel">
          <p>Authenticate with GitHub to access protected project administration.</p>
          <button className="button" type="button" onClick={handleSignIn} disabled={authBusy}>
            {authBusy ? 'Opening GitHub…' : 'Continue with GitHub'}
          </button>
        </div>
      ) : accessState === 'denied' ? (
        <div className="admin-auth-panel">
          <p className="notice" role="status">Access denied.</p>
          <button className="button-link" type="button" onClick={handleSignOut} disabled={authBusy}>
            Sign out
          </button>
        </div>
      ) : (
        <>
          <div className="admin-toolbar">
            <div>
              <p className="admin-authenticated-as">
                Authorized as{' '}
                {identity?.githubUsername
                  ? `@${identity.githubUsername}`
                  : 'GitHub administrator'}
                {adminRole ? ` (${adminRole})` : ''}.
              </p>
              <p className="admin-private-note">Queue positions and contact details are private.</p>
            </div>
            <div className="admin-toolbar-actions">
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void refreshAdminData()}
                disabled={queueLoading || busyEntryId !== null || turnBusy}
              >
                {queueLoading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                className="button-link"
                type="button"
                onClick={handleSignOut}
                disabled={authBusy}
              >
                Sign out
              </button>
            </div>
          </div>

          <section className="admin-current-turn" aria-labelledby="current-turn-heading">
            <h2 id="current-turn-heading">Current turn</h2>
            {currentTurn ? (
              <AdminCurrentTurnPanel
                turn={currentTurn}
                busy={turnBusy}
                onRecordSubmission={(prUrl, prNumber) => runCurrentTurnAction(
                  () => recordPullRequestSubmission({ adminGithubUserId: identity!.githubUserId, prUrl, prNumber }),
                  'The pull request submission could not be recorded.',
                )}
                onMarkUnderReview={() => runCurrentTurnAction(
                  () => markCurrentTurnUnderReview(identity!.githubUserId),
                  'The turn could not be marked under review.',
                )}
                onRecordMerged={(summary, contributorMessage) => runCurrentTurnAction(
                  () => recordMergedContribution({
                    adminGithubUserId: identity!.githubUserId,
                    summary,
                    contributorMessage,
                  }),
                  'The merged contribution could not be recorded.',
                )}
                onExpire={() => runCurrentTurnAction(
                  () => expireCurrentTurn(identity!.githubUserId),
                  'The turn could not be expired.',
                )}
                onSkip={() => runCurrentTurnAction(
                  () => skipCurrentTurn(identity!.githubUserId),
                  'The turn could not be skipped.',
                )}
              />
            ) : waitingQueue[0] ? (
              <div className="admin-start-turn">
                <p>
                  Next waiting contributor: <strong>{waitingQueue[0].displayName}</strong>{' '}
                  (<a href={waitingQueue[0].githubProfileUrl} rel="noreferrer">
                    @{waitingQueue[0].githubUsername}
                  </a>)
                </p>
                <p>
                  Private contact: <a href={`mailto:${waitingQueue[0].email}`}>
                    {waitingQueue[0].email}
                  </a>
                </p>
                <div className="form-field">
                  <label htmlFor="turn-deadline">Turn deadline</label>
                  <input
                    id="turn-deadline"
                    type="datetime-local"
                    value={deadline}
                    onChange={(event) => setDeadline(event.target.value)}
                    disabled={turnBusy}
                    required
                  />
                  <small>The absolute deadline is editable. The public countdown derives from it.</small>
                </div>
                <button
                  className="button"
                  type="button"
                  onClick={() => void handleStartTurn()}
                  disabled={turnBusy || queueLoading}
                >
                  {turnBusy ? 'Starting turn…' : 'Start turn'}
                </button>
              </div>
            ) : (
              <p className="empty-state">No active turn and no waiting contributors.</p>
            )}
          </section>

          <div className="admin-filters" aria-label="Queue filters">
            <div className="form-field">
              <label htmlFor="queue-search">Search queue</label>
              <input
                id="queue-search"
                type="search"
                placeholder="Name, GitHub username, or email"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="queue-status">Status</label>
              <select
                id="queue-status"
                value={statusFilter ?? ''}
                onChange={(event) => setStatusFilter(event.target.value || null)}
              >
                <option value="">All statuses</option>
                {QUEUE_STATUSES.map((status) => (
                  <option value={status} key={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {queueLoading && queue.length === 0 ? (
            <p role="status">Loading private queue…</p>
          ) : queue.length === 0 ? (
            <p className="empty-state">No Season 1 queue entries.</p>
          ) : visibleQueue.length === 0 ? (
            <p className="empty-state">No queue entries match these filters.</p>
          ) : (
            <div className="admin-table-wrapper">
              <table className="admin-queue-table">
                <caption className="visually-hidden">Private Season 1 contribution queue</caption>
                <thead>
                  <tr>
                    <th scope="col">Position</th>
                    <th scope="col">Contributor</th>
                    <th scope="col">GitHub</th>
                    <th scope="col">Contact</th>
                    <th scope="col">Joined</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleQueue.map((entry) => (
                    <tr key={entry.githubUserId}>
                      <td>{entry.effectivePosition ?? '—'}</td>
                      <td>
                        <strong>{entry.displayName}</strong>
                        {entry.socialUrl && (
                          <>
                            <br />
                            <a href={entry.socialUrl} rel="noreferrer">
                              Social link
                            </a>
                          </>
                        )}
                      </td>
                      <td>
                        <a href={entry.githubProfileUrl} rel="noreferrer">
                          @{entry.githubUsername}
                        </a>
                      </td>
                      <td>{entry.email}</td>
                      <td>{formatJoinedAt(entry.joinedAt)}</td>
                      <td>
                        {entry.priority}
                        {entry.priority > 0 && <span className="promoted-label"> Promoted</span>}
                      </td>
                      <td>{entry.status}</td>
                      <td>
                        {entry.status === 'waiting' ? (
                          <button
                            className="button button-secondary admin-action"
                            type="button"
                            onClick={() => void handlePriorityAction(entry)}
                            disabled={busyEntryId !== null}
                          >
                            {busyEntryId === entry.githubUserId
                              ? 'Updating…'
                              : entry.priority > 0
                                ? 'Restore natural order'
                                : 'Move to top'}
                          </button>
                        ) : (
                          <span>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
