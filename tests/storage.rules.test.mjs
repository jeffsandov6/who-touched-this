import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import {
  deleteObject,
  getBytes,
  listAll,
  ref,
  uploadBytes,
} from 'firebase/storage';

const rules = await readFile(new URL('../storage.rules', import.meta.url), 'utf8');
// Cross-service Storage Rules lookups use the Firebase CLI's configured project.
const projectId = 'who-touched-this';
const owner = { uid: 'firebase-owner', id: '9001' };
const admin = { uid: 'firebase-admin', id: '9002' };
const inactiveAdmin = { uid: 'firebase-inactive', id: '9003' };
const contributor = { uid: 'firebase-contributor', id: '1001' };
const invitedContributor = { uid: 'firebase-invited', id: '1002' };
const activeContributor = { uid: 'firebase-active', id: '1003' };
const assetId = '123e4567-e89b-42d3-a456-426614174000';
const publicPath = `public/canvas/founder/${assetId}/known.png`;
let environment;

function claims(id, username = 'presentation-only') {
  return {
    firebase: { identities: { 'github.com': [id] }, sign_in_provider: 'github.com' },
    username,
  };
}

function contextFor(identity, customClaims = claims(identity.id)) {
  return environment.authenticatedContext(identity.uid, customClaims);
}

function mediaReference(context, path = publicPath) {
  return ref(context.storage(), path);
}

async function upload(context, path, type, bytes = new Uint8Array([1, 2, 3])) {
  return uploadBytes(mediaReference(context, path), bytes, { contentType: type });
}

before(async () => {
  environment = await initializeTestEnvironment({ projectId, storage: { rules } });
});

beforeEach(async () => {
  await Promise.all([environment.clearFirestore(), environment.clearStorage()]);
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, `admins/${owner.id}`), { githubUserId: owner.id, role: 'owner', active: true }),
      setDoc(doc(firestore, `admins/${admin.id}`), { githubUserId: admin.id, role: 'admin', active: true }),
      setDoc(doc(firestore, `admins/${inactiveAdmin.id}`), { githubUserId: inactiveAdmin.id, role: 'owner', active: false }),
      upload(context, publicPath, 'image/png'),
      upload(context, 'private/internal/secret.png', 'image/png'),
    ]);
  });
});

after(async () => environment?.cleanup());

test('anonymous visitors can fetch a known founder object but not unrelated media', async () => {
  const anonymous = environment.unauthenticatedContext();
  await assertSucceeds(getBytes(mediaReference(anonymous)));
  await assertFails(getBytes(mediaReference(anonymous, 'private/internal/secret.png')));
});

test('anonymous visitors cannot upload, overwrite, or delete founder objects', async () => {
  const anonymous = environment.unauthenticatedContext();
  const newPath = `public/canvas/founder/223e4567-e89b-42d3-a456-426614174000/new.png`;
  await assertFails(upload(anonymous, newPath, 'image/png'));
  await assertFails(upload(anonymous, publicPath, 'image/png'));
  await assertFails(deleteObject(mediaReference(anonymous)));
});

test('ordinary, invited, and active authenticated contributors cannot upload', async () => {
  for (const identity of [contributor, invitedContributor, activeContributor]) {
    const path = `public/canvas/founder/323e4567-e89b-42d3-a456-42661417400${identity.id.at(-1)}/clip.mp4`;
    await assertFails(upload(contextFor(identity), path, 'video/mp4'));
  }
});

test('inactive admin cannot upload founder media', async () => {
  const path = 'public/canvas/founder/423e4567-e89b-42d3-a456-426614174000/audio.mp3';
  await assertFails(upload(contextFor(inactiveAdmin), path, 'audio/mpeg'));
});

test('active owner can create valid image, audio, and video objects', async () => {
  const ownerContext = contextFor(owner);
  await assertSucceeds(upload(ownerContext, 'public/canvas/founder/523e4567-e89b-42d3-a456-426614174000/image.jpg', 'image/jpeg'));
  await assertSucceeds(upload(ownerContext, 'public/canvas/founder/623e4567-e89b-42d3-a456-426614174000/audio.mp3', 'audio/mpeg'));
  await assertSucceeds(upload(ownerContext, 'public/canvas/founder/723e4567-e89b-42d3-a456-426614174000/video.mp4', 'video/mp4'));
});

test('active admin role can create founder media', async () => {
  await assertSucceeds(upload(contextFor(admin), 'public/canvas/founder/823e4567-e89b-42d3-a456-426614174000/image.webp', 'image/webp'));
});

test('matching username cannot substitute for the stable admin GitHub ID', async () => {
  const impersonator = { uid: 'firebase-impostor', id: '7001' };
  const path = 'public/canvas/founder/923e4567-e89b-42d3-a456-426614174000/image.png';
  await assertFails(upload(contextFor(impersonator, claims(impersonator.id, owner.id)), path, 'image/png'));
});

test('active admin cannot upload outside founder namespace or with invalid paths', async () => {
  const ownerContext = contextFor(owner);
  await assertFails(upload(ownerContext, 'public/canvas/other/123e4567-e89b-42d3-a456-426614174000/image.png', 'image/png'));
  await assertFails(upload(ownerContext, 'public/canvas/founder/not-a-uuid/image.png', 'image/png'));
  await assertFails(upload(ownerContext, 'public/canvas/founder/123e4567-e89b-42d3-a456-426614174000/nested/image.png', 'image/png'));
});

test('invalid and zero-byte media objects are rejected', async () => {
  const ownerContext = contextFor(owner);
  await assertFails(upload(ownerContext, 'public/canvas/founder/a23e4567-e89b-42d3-a456-426614174000/index.html', 'text/html'));
  await assertFails(upload(ownerContext, 'public/canvas/founder/b23e4567-e89b-42d3-a456-426614174000/empty.png', 'image/png', new Uint8Array()));
});

test('existing founder objects are immutable and cannot be overwritten', async () => {
  await assertFails(upload(contextFor(owner), publicPath, 'image/png', new Uint8Array([9])));
  const contents = await assertSucceeds(getBytes(mediaReference(environment.unauthenticatedContext())));
  assert.deepEqual([...new Uint8Array(contents)], [1, 2, 3]);
});

test('only active admins can delete founder objects', async () => {
  const path = 'public/canvas/founder/d23e4567-e89b-42d3-a456-426614174000/delete-me.png';
  await assertSucceeds(upload(contextFor(owner), path, 'image/png'));
  await assertFails(deleteObject(mediaReference(contextFor(contributor), path)));
  await assertSucceeds(deleteObject(mediaReference(contextFor(owner), path)));
  await assert.rejects(getBytes(mediaReference(environment.unauthenticatedContext(), path)), (error) => error?.code === 'storage/object-not-found');
});

test('public read remains available after a normal admin upload', async () => {
  const path = 'public/canvas/founder/c23e4567-e89b-42d3-a456-426614174000/public.mp4';
  await assertSucceeds(upload(contextFor(owner), path, 'video/mp4'));
  await assertSucceeds(getBytes(mediaReference(environment.unauthenticatedContext(), path)));
});

test('anonymous users cannot enumerate founder media while active admins can list it', async () => {
  const founderRoot = 'public/canvas/founder';
  await assertFails(listAll(ref(environment.unauthenticatedContext().storage(), founderRoot)));
  const listing = await assertSucceeds(listAll(ref(contextFor(admin).storage(), founderRoot)));
  assert.ok(listing.prefixes.length > 0);
});
