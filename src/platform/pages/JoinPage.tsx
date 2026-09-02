/** @jsxImportSource react */

import { useEffect, useState, type SyntheticEvent } from 'react';
import {
  AuthenticationError,
  observeAuthState,
  resolveGitHubIdentity,
  signInWithGitHub,
  signOutOfPlatform,
} from '../firebase/auth';
import {
  getJoinIdentityView,
  reconcileGitHubIdentity,
  type GitHubIdentity,
} from '../firebase/github-identity';
import {
  DISPLAY_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  SOCIAL_URL_MAX_LENGTH,
  validateJoinForm,
  type JoinFormValues,
} from '../firebase/join-validation';
import type { ParticipationStatus } from '../firebase/models';
import type { OwnPendingInvitation } from '../firebase/invitations';
import InvitationAcceptance from '../components/InvitationAcceptance';
import { participationStatusMessage } from '../join-status';

const initialFormValues: JoinFormValues = {
  displayName: '',
  email: '',
  socialUrl: '',
  rulesAcknowledged: false,
};

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof AuthenticationError ||
    (error instanceof Error && (error.name === 'JoinError' || error.name === 'InvitationError'))
    ? error.message
    : fallback;
}

export default function JoinPage() {
  const [authLoading, setAuthLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState<GitHubIdentity | null>(null);
  const [participationStatus, setParticipationStatus] = useState<ParticipationStatus | null>(null);
  const [invitation, setInvitation] = useState<OwnPendingInvitation | null>(null);
  const [formValues, setFormValues] = useState<JoinFormValues>(initialFormValues);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function loadAuthenticatedState(nextIdentity: GitHubIdentity) {
    setIdentity((current) => reconcileGitHubIdentity(current, nextIdentity));
    setFormValues((current) => ({
      ...current,
      email: current.email || nextIdentity.suggestedEmail || '',
    }));
    const { getOwnParticipationState } = await import('../firebase/join');
    const participation = await getOwnParticipationState(nextIdentity.githubUserId);
    setParticipationStatus(participation?.status ?? null);
    if (participation?.status === 'invited' && participation.invitationId) {
      const { getOwnPendingInvitation } = await import('../firebase/invitations');
      setInvitation(await getOwnPendingInvitation(
        nextIdentity.githubUserId,
        participation.invitationId,
      ));
    } else {
      setInvitation(null);
    }
  }

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    try {
      unsubscribe = observeAuthState((user) => {
        void (async () => {
          setAuthLoading(true);
          setErrorMessage(null);

          if (!user) {
            if (active) {
              setIdentity(null);
              setParticipationStatus(null);
              setInvitation(null);
              setFormValues(initialFormValues);
              setMessage(null);
              setAuthLoading(false);
            }
            return;
          }

          try {
            const nextIdentity = await resolveGitHubIdentity(user);
            if (active) await loadAuthenticatedState(nextIdentity);
          } catch (error) {
            if (active) {
              setIdentity(null);
              setErrorMessage(
                safeMessage(error, 'Your authenticated GitHub identity could not be loaded.'),
              );
            }
          } finally {
            if (active) setAuthLoading(false);
          }
        })();
      });
    } catch {
      setErrorMessage('Firebase configuration is unavailable. Check the local environment setup.');
      setAuthLoading(false);
    }

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function handleGitHubSignIn() {
    setBusy(true);
    setErrorMessage(null);
    setMessage(null);

    try {
      const nextIdentity = await signInWithGitHub();
      await loadAuthenticatedState(nextIdentity);
    } catch (error) {
      setErrorMessage(safeMessage(error, 'GitHub sign-in could not be completed.'));
    } finally {
      setBusy(false);
      setAuthLoading(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    setErrorMessage(null);

    try {
      await signOutOfPlatform();
    } catch {
      setErrorMessage('Sign out could not be completed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!identity) return;

    setBusy(true);
    setErrorMessage(null);
    setMessage(null);

    try {
      // Validate in the interactive UI before loading the Firestore join service. The service
      // repeats this validation before constructing any records.
      const validatedValues = validateJoinForm(formValues);
      const normalizedFormValues: JoinFormValues = {
        displayName: validatedValues.displayName,
        email: validatedValues.email,
        socialUrl: validatedValues.socialUrl ?? '',
        rulesAcknowledged: true,
      };
      setFormValues(normalizedFormValues);

      const { joinCurrentSeason } = await import('../firebase/join');
      const result = await joinCurrentSeason(identity, normalizedFormValues);
      setParticipationStatus(result.status);
      setMessage(
        result.kind === 'joined'
          ? "You're in the queue. Your exact position is private."
          : participationStatusMessage(result.status),
      );
    } catch (error) {
      setErrorMessage(safeMessage(error, 'The queue could not be joined. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptInvitation() {
    if (!identity || !invitation) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const { acceptInvitation } = await import('../firebase/invitations');
      await acceptInvitation(identity.githubUserId, invitation.invitationId);
      setInvitation(null);
      setParticipationStatus('active');
      setMessage('Your turn is active. The contribution countdown has started.');
    } catch (error) {
      setErrorMessage(safeMessage(error, 'The invitation could not be accepted.'));
    } finally {
      setBusy(false);
    }
  }

  const joinIdentityView = getJoinIdentityView(identity, participationStatus);

  return (
    <section className="page-content join-page" aria-labelledby="join-heading">
      <h1 id="join-heading">Join</h1>
      <p>
        Authenticate with GitHub to join the private Season 1 contribution queue. Joining does not
        grant write access to the repository or guarantee an immediate turn.
      </p>

      {errorMessage && (
        <p className="notice notice-error" role="alert">
          {errorMessage}
        </p>
      )}

      {authLoading ? (
        <p role="status">Checking authentication…</p>
      ) : !identity ? (
        <div className="join-auth-panel">
          <p>
            Your stable GitHub provider identity—not your username, display name, or email—is used
            to enforce one ordinary contribution per GitHub account per season.
          </p>
          <button className="button" type="button" onClick={handleGitHubSignIn} disabled={busy}>
            {busy ? 'Opening GitHub…' : 'Continue with GitHub'}
          </button>
        </div>
      ) : (
        <>
          <section className="github-identity" aria-labelledby="github-identity-heading">
            <div>
              <h2 id="github-identity-heading">Authenticated GitHub identity</h2>
              {identity.githubUsername ? (
                <p>
                  <a href={identity.profileUrl ?? undefined} rel="noreferrer">
                    @{identity.githubUsername}
                  </a>
                </p>
              ) : (
                <p>GitHub account authenticated; username unavailable in this browser session.</p>
              )}
            </div>
            {identity.avatarUrl && (
              <img
                className="github-avatar"
                src={identity.avatarUrl}
                alt=""
                width="64"
                height="64"
                referrerPolicy="no-referrer"
              />
            )}
          </section>

          {participationStatus === 'invited' && invitation ? (
            <InvitationAcceptance
              invitation={invitation}
              busy={busy}
              onAccept={handleAcceptInvitation}
            />
          ) : joinIdentityView === 'participation' && participationStatus ? (
            <p className="notice" role="status">
              {message ?? participationStatusMessage(participationStatus)}
            </p>
          ) : joinIdentityView === 'reauthenticate' ? (
            <div className="notice">
              <p>
                Reopen GitHub authentication to recover presentation details before joining. Your
                stable GitHub provider ID is already verified.
              </p>
              <button
                className="button button-secondary"
                type="button"
                onClick={handleGitHubSignIn}
                disabled={busy}
              >
                Refresh GitHub identity
              </button>
            </div>
          ) : (
            <form className="join-form" onSubmit={handleSubmit}>
              <div className="form-field">
                <label htmlFor="display-name">Display name or nickname (required)</label>
                <input
                  id="display-name"
                  name="displayName"
                  type="text"
                  required
                  maxLength={DISPLAY_NAME_MAX_LENGTH}
                  autoComplete="nickname"
                  aria-describedby="display-name-help"
                  value={formValues.displayName}
                  onChange={(event) =>
                    setFormValues((current) => ({ ...current, displayName: event.target.value }))
                  }
                />
                <small id="display-name-help">
                  Required. This is the public name that may appear in contribution history.
                </small>
              </div>

              <div className="form-field">
                <label htmlFor="contact-email">Contact email</label>
                <input
                  id="contact-email"
                  name="email"
                  type="email"
                  required
                  maxLength={EMAIL_MAX_LENGTH}
                  autoComplete="email"
                  value={formValues.email}
                  onChange={(event) =>
                    setFormValues((current) => ({ ...current, email: event.target.value }))
                  }
                />
                <small>
                  This email is private and is used to contact you when your turn is approaching or
                  active.
                </small>
              </div>

              <div className="form-field">
                <label htmlFor="social-url">Social link (optional)</label>
                <input
                  id="social-url"
                  name="socialUrl"
                  type="text"
                  inputMode="url"
                  maxLength={SOCIAL_URL_MAX_LENGTH}
                  autoComplete="url"
                  placeholder="https://instagram.com/yourname"
                  value={formValues.socialUrl}
                  onChange={(event) =>
                    setFormValues((current) => ({ ...current, socialUrl: event.target.value }))
                  }
                />
              </div>

              <label className="rules-acknowledgement">
                <input
                  type="checkbox"
                  required
                  checked={formValues.rulesAcknowledged}
                  onChange={(event) =>
                    setFormValues((current) => ({
                      ...current,
                      rulesAcknowledged: event.target.checked,
                    }))
                  }
                />
                <span>
                  I understand that I receive at most one ordinary contribution per GitHub account
                  per season; a future turn will be bounded and every PR reviewed; my GitHub
                  identity, public display name, accepted contribution, PR, and contributor message
                  may become public; my contact email remains private; joining does not guarantee an
                  immediate turn; and my exact queue position is not publicly displayed.
                </span>
              </label>

              <button className="button" type="submit" disabled={busy}>
                {busy ? 'Joining…' : 'Join Season 1 queue'}
              </button>
            </form>
          )}

          <button className="button-link" type="button" onClick={handleSignOut} disabled={busy}>
            Sign out
          </button>
        </>
      )}
    </section>
  );
}
