import { getAnalytics, logEvent, setAnalyticsCollectionEnabled } from "@react-native-firebase/analytics";
import { getCrashlytics, recordError, setCrashlyticsCollectionEnabled } from "@react-native-firebase/crashlytics";
import { firebaseApp } from "./firebase";

const analytics = getAnalytics(firebaseApp);
const crashlytics = getCrashlytics();
let telemetryEnabled = false;

export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  telemetryEnabled = enabled;
  await Promise.all([
    setAnalyticsCollectionEnabled(analytics, enabled),
    setCrashlyticsCollectionEnabled(crashlytics, enabled),
  ]);
}

export async function track(name: string, params?: Record<string, string | number>): Promise<void> {
  if (!telemetryEnabled) return;
  await logEvent(analytics, name, params);
}

export function report(error: unknown): void {
  if (!telemetryEnabled) return;
  recordError(crashlytics, error instanceof Error ? error : new Error(String(error)));
}
