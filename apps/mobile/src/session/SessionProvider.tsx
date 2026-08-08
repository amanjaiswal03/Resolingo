import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { onAuthStateChanged, type FirebaseAuthTypes } from "@react-native-firebase/auth";
import type { UserProfile } from "@resolingo/shared";
import { firebaseAuth, initializeFirebaseSecurity } from "@/services/firebase";
import { subscribeProfile } from "@/services/lessons";
import { setTelemetryEnabled } from "@/services/telemetry";

type Session = {
  loading: boolean;
  user: FirebaseAuthTypes.User | null;
  profile: UserProfile | null;
};

const SessionContext = createContext<Session>({ loading: true, user: null, profile: null });

export function SessionProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribe = () => {};
    let mounted = true;
    void initializeFirebaseSecurity().finally(() => {
      if (!mounted) return;
      unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
        setUser(nextUser);
        if (!nextUser) {
          setProfile(null);
          setLoading(false);
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
      setLoading(false);
      void setTelemetryEnabled(nextProfile?.telemetryConsent ?? false);
    });
  }, [user]);

  const value = useMemo(() => ({ loading, user, profile }), [loading, user, profile]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
