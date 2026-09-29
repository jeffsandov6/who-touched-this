import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import {
  parsePublicWttStats,
  type PublicWttStatsState,
} from '../public-wtt-stats';
import { getPlatformFirestore } from './firestore';
import { PUBLIC_WTT_STATS_DOCUMENT_PATH } from './paths';

export function subscribeToPublicWttStats(
  onState: (state: PublicWttStatsState) => void,
): Unsubscribe {
  onState({ status: 'loading' });
  return onSnapshot(
    doc(getPlatformFirestore(), PUBLIC_WTT_STATS_DOCUMENT_PATH),
    (snapshot) => {
      if (!snapshot.exists()) {
        onState({ status: 'missing' });
        return;
      }
      const stats = parsePublicWttStats(snapshot.data());
      onState(stats ? { status: 'ready', stats } : { status: 'error' });
    },
    () => onState({ status: 'error' }),
  );
}
