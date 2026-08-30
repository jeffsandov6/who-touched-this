import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import {
  DEFAULT_PUBLIC_SITE_STATE,
  parsePublicSiteState,
  type PublicSiteViewState,
} from '../turn-state';
import { getPlatformFirestore } from './firestore';
import { PUBLIC_SITE_DOCUMENT_PATH } from './paths';

export function subscribeToPublicSiteState(
  onState: (state: PublicSiteViewState) => void,
  onError: () => void = () => {},
): Unsubscribe {
  return onSnapshot(
    doc(getPlatformFirestore(), PUBLIC_SITE_DOCUMENT_PATH),
    (snapshot) =>
      onState(
        snapshot.exists()
          ? parsePublicSiteState(snapshot.data())
          : DEFAULT_PUBLIC_SITE_STATE,
      ),
    () => {
      onState(DEFAULT_PUBLIC_SITE_STATE);
      onError();
    },
  );
}
