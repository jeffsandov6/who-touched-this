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
    let unsubscribe = () => { };

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
                safeMessage(error, 'your authenticated GitHub identity could not be loaded.'),
              );
            }
          } finally {
            if (active) setAuthLoading(false);
          }
        })();
      });
    } catch {
      setErrorMessage('Firebase configuration is unavailable. check the local environment setup.');
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
      setErrorMessage('sign out could not be completed. please try again.');
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
          ? "you're in the queue. your exact position is private."
          : participationStatusMessage(result.status),
      );
    } catch (error) {
      setErrorMessage(safeMessage(error, 'the queue could not be joined. Please try again.'));
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
      setMessage('your turn is active. the contribution countdown has started.');
    } catch (error) {
      setErrorMessage(safeMessage(error, 'the invitation could not be accepted.'));
    } finally {
      setBusy(false);
    }
  }

  const joinIdentityView = getJoinIdentityView(identity, participationStatus);

  return (
    <section className="page-content join-page" aria-labelledby="join-heading">
      <h1 id="join-heading">join</h1>
      <p>
        sign in with GitHub to join the private season 1 contribution queue. joining doesn't give you
        write access to the main repository or guarantee an immediate turn.
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
            we use your GitHub account to enforce one ordinary contribution per account per season.
          </p>
          <button className="button" type="button" onClick={handleGitHubSignIn} disabled={busy}>
            {busy ? 'opening GitHub…' : 'continue with GitHub'}
          </button>
        </div>
      ) : (
        <>
          <section className="github-identity" aria-labelledby="github-identity-heading">
            <div>
              <h2 id="github-identity-heading">authenticated GitHub identity</h2>
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
                sign in with GitHub again so we can reload your account details. your GitHub account
                is already verified.
              </p>
              <button
                className="button button-secondary"
                type="button"
                onClick={handleGitHubSignIn}
                disabled={busy}
              >
                refresh GitHub account
              </button>
            </div>
          ) : (
            <form className="join-form" onSubmit={handleSubmit}>
              <div className="form-field">
                <label htmlFor="display-name">display name or nickname (required)</label>
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
                  required. this is the public name that may appear in contribution history.
                </small>
              </div>

              <div className="form-field">
                <label htmlFor="contact-email">contact email</label>
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
                  this email stays private. we'll use it for invitations, reminders, turn updates, & contribution status.
                </small>
              </div>

              <div className="form-field">
                <label htmlFor="social-url">social link (optional)</label>
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

              <div className="join-rules">
                <p className="form-help">
                  please read the <a href="/rules">rules</a> before joining.
                </p>

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
                    i've read & agree to the rules. i understand that i get at most one ordinary contribution per
                    GitHub account per season; joining doesn't guarantee an immediate turn; my GitHub identity,
                    display name, accepted contribution, PR, & contributor message may become public; & my contact
                    email & exact queue position stay private.
                  </span>
                </label>
              </div>

              <button className="button" type="submit" disabled={busy}>
                {busy ? 'joining…' : 'join season 1 queue'}
              </button>
            </form>
          )}

          <button className="button-link" type="button" onClick={handleSignOut} disabled={busy}>
            sign out
          </button>
        </>
      )}
    </section>
  );
}
