import { FirebaseError } from 'firebase/app';
import { doc, getDoc } from 'firebase/firestore';
import { getPlatformFirestore } from './firestore';
import { ADMIN_ROLES, type AdminRecord, type AdminRole } from './models';
import { adminDocumentPath } from './paths';

export interface AdminAuthorization {
  authorized: boolean;
  role: AdminRole | null;
}

export class AdminServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminServiceError';
  }
}

function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === 'string' && (ADMIN_ROLES as readonly string[]).includes(value);
}

export async function getOwnAdminAuthorization(
  githubUserId: string,
): Promise<AdminAuthorization> {
  try {
    const snapshot = await getDoc(
      doc(getPlatformFirestore(), adminDocumentPath(githubUserId)),
    );

    if (!snapshot.exists()) return { authorized: false, role: null };

    const data = snapshot.data() as Partial<AdminRecord>;
    const authorized =
      data.githubUserId === githubUserId && data.active === true && isAdminRole(data.role);

    return { authorized, role: authorized ? data.role ?? null : null };
  } catch (error) {
    throw toAdminServiceError(error, 'Admin authorization could not be verified.');
  }
}

export function toAdminServiceError(error: unknown, fallback: string): AdminServiceError {
  if (error instanceof AdminServiceError) return error;

  if (error instanceof FirebaseError) {
    const messages: Record<string, string> = {
      'firestore/permission-denied': 'Access denied.',
      'firestore/unavailable': 'The admin service is temporarily unavailable.',
      'firestore/aborted': 'The queue changed during this operation. Please try again.',
      'firestore/deadline-exceeded': 'The admin operation timed out. Please try again.',
    };
    return new AdminServiceError(messages[error.code] ?? fallback);
  }

  return new AdminServiceError(fallback);
}
