import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { onAuthStateChanged, type FirebaseAuthTypes } from "@react-native-firebase/auth";
import type { UserProfile } from "@resolingo/shared";
import { firebaseAuth, initializeFirebaseSecurity } from "@/services/firebase";
import { subscribeProfile } from "@/services/lessons";
import { report, setTelemetryEnabled } from "@/services/telemetry";

type Session = {
  loading: boolean;
  user: FirebaseAuthTypes.User | null;
  profile: UserProfile | null;
  /** The profile could not be read, for example when App Check or the network fails. */
  error: Error | null;
  /** Listen for the profile again after an error. */
  retry: () => void;
};

const SessionContext = createContext<Session>({ loading: true, user: null, profile: null, error: null, retry: () => {} });

export function SessionProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  const signedInUid = useRef<string | null>(null);

  useEffect(() => {
    let unsubscribe = () => {};
    let mounted = true;
    void initializeFirebaseSecurity().finally(() => {
      if (!mounted) return;
      unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
        const nextUid = nextUser?.uid ?? null;
        setUser(nextUser);
        if (!nextUser) {
          signedInUid.current = null;
          setProfile(null);
          setError(null);
          setLoading(false);
          return;
        }
        if (signedInUid.current !== nextUid) {
          signedInUid.current = nextUid;
          setLoading(true);
        }
      });
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    return subscribeProfile(user.uid, (nextProfile) => {
      setProfile(nextProfile);
      setError(null);
      setLoading(false);
      void setTelemetryEnabled(nextProfile?.telemetryConsent ?? false);
    }, (nextError) => {
      // Without this the app would wait on a spinner forever, or send a signed-in learner to onboarding.
      report(nextError);
      setError(nextError);
      setLoading(false);
    });
  }, [user, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setAttempt((value) => value + 1);
  }, []);

  const value = useMemo(() => ({ loading, user, profile, error, retry }), [loading, user, profile, error, retry]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
