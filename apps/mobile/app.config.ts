import type { ConfigContext, ExpoConfig } from "expo/config";

const DEFAULT_EAS_OWNER = "amanjaiswal03";
const DEFAULT_EAS_PROJECT_ID = "89e3143e-acd3-47b4-95ff-3c131a3f2535";
const DEFAULT_APP_IDENTIFIER = "com.resolingo.app";

const orDefault = (value: string | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const isDev = process.env.APP_VARIANT !== "production";
  const identifier = orDefault(process.env.APP_IDENTIFIER, DEFAULT_APP_IDENTIFIER);
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  const googleInfoPlist = process.env.GOOGLE_SERVICES_INFO_PLIST;
  const microphonePermission = "Resolingo uses the microphone when you ask for a translation or turn on spoken answer checking for a lesson.";

  return {
    ...config,
    name: isDev ? "Resolingo Dev" : "Resolingo",
    owner: orDefault(process.env.EXPO_OWNER, DEFAULT_EAS_OWNER),
    slug: "resolingo",
    scheme: "resolingo",
    platforms: ["ios", "android"],
    version: "0.1.0",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    icon: "./assets/resolingo-icon.png",
    ios: {
      bundleIdentifier: identifier,
      supportsTablet: true,
      usesAppleSignIn: true,
      ...(googleInfoPlist ? { googleServicesFile: googleInfoPlist } : {}),
      infoPlist: {
        // audio keeps lesson playback and the answer microphone alive with the screen locked.
        UIBackgroundModes: ["audio", "remote-notification"],
        NSMicrophoneUsageDescription: microphonePermission,
        NSSpeechRecognitionUsageDescription: "Resolingo uses speech recognition on this iPhone to check your spoken lesson answers.",
        // expo-file-system links the Photos API for copying a chosen asset. The app never opens the library.
        NSPhotoLibraryUsageDescription: "Resolingo doesn't access your photos unless you choose to share or save an image.",
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      package: identifier,
      ...(googleServicesFile ? { googleServicesFile } : {}),
      adaptiveIcon: {
        foregroundImage: "./assets/resolingo-icon.png",
        backgroundColor: "#08152F",
      },
      permissions: ["POST_NOTIFICATIONS", "RECORD_AUDIO"],
    },
    plugins: [
      "expo-dev-client",
      "expo-router",
      ["expo-splash-screen", { image: "./assets/resolingo-icon.png", imageWidth: 180, resizeMode: "contain", backgroundColor: "#08152F", dark: { backgroundColor: "#08152F" } }],
      ["expo-audio", {
        enableBackgroundPlayback: true,
        recordAudioAndroid: true,
        microphonePermission,
      }],
      ["expo-notifications", { color: "#0F9D8A", defaultChannel: "lessons" }],
      "expo-apple-authentication",
      "expo-secure-store",
      "@react-native-firebase/app",
      // After the app plugin so this iOS mod runs first and installs RNFBAppCheckModule before FirebaseApp.configure().
      "@react-native-firebase/app-check",
      "@react-native-firebase/crashlytics",
      "@react-native-google-signin/google-signin",
      ["expo-build-properties", { ios: { useFrameworks: "static" } }],
    ],
    experiments: { typedRoutes: true },
    updates: { url: `https://u.expo.dev/${orDefault(process.env.EXPO_PUBLIC_EAS_PROJECT_ID, DEFAULT_EAS_PROJECT_ID)}` },
    runtimeVersion: { policy: "appVersion" },
    extra: {
      eas: { projectId: orDefault(process.env.EXPO_PUBLIC_EAS_PROJECT_ID, DEFAULT_EAS_PROJECT_ID) },
    },
  };
};
