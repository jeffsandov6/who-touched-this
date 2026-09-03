import type { Request, Response } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import { qualifyPullRequestPayload, type CanonicalRepositoryConfig } from './qualification.js';
import {
  processPullRequestQualification,
  recordIgnoredWebhookDelivery,
  type WebhookProcessingResult,
} from './submission.js';
import { verifyGitHubSignature } from './signature.js';

interface WebhookDependencies {
  firestore: Firestore;
  secret: string;
  config: CanonicalRepositoryConfig;
}

function header(request: Request, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function safeRepository(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  const repository = (payload as { repository?: unknown }).repository;
  if (!repository || typeof repository !== 'object' || Array.isArray(repository)) return '';
  const fullName = (repository as { full_name?: unknown }).full_name;
  return typeof fullName === 'string' ? fullName.slice(0, 200) : '';
}

function safeAction(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  const action = (payload as { action?: unknown }).action;
  return typeof action === 'string' ? action.slice(0, 50) : '';
}

export async function handleGitHubWebhook(
  request: Request,
  response: Response,
  dependencies: WebhookDependencies,
): Promise<void> {
  const rawBody = (request as Request & { rawBody?: Buffer }).rawBody;
  const signature = header(request, 'x-hub-signature-256');
  if (!rawBody || rawBody.length > 1_000_000
    || !verifyGitHubSignature(rawBody, signature, dependencies.secret)) {
    response.status(401).json({ ok: false, result: 'invalid_signature' });
    return;
  }
  const event = header(request, 'x-github-event');
  const deliveryId = header(request, 'x-github-delivery');
  if (!event || event.length > 50 || !deliveryId
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deliveryId)) {
    response.status(400).json({ ok: false, result: 'malformed_headers' });
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    response.status(400).json({ ok: false, result: 'malformed_json' });
    return;
  }
  const metadata = {
    deliveryId,
    event,
    action: safeAction(payload),
    repository: safeRepository(payload),
  };
  let result: WebhookProcessingResult;
  if (event !== 'pull_request') {
    result = await recordIgnoredWebhookDelivery(
      dependencies.firestore, metadata, 'unsupported_event',
    );
    response.status(202).json({ ok: true, result });
    return;
  }
  const qualification = qualifyPullRequestPayload(payload, dependencies.config);
  result = await processPullRequestQualification(dependencies.firestore, metadata, qualification);
  response.status(200).json({ ok: true, result });
}
