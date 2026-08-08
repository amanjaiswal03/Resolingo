import type { ConfigContext, ExpoConfig } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => {
  const isDev = process.env.APP_VARIANT !== "production";
  const identifier = isDev ? "com.resolingo.app.dev" : "com.resolingo.app";
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  const googleInfoPlist = process.env.GOOGLE_SERVICES_INFO_PLIST;

  return {
    ...config,
    name: isDev ? "Resolingo Dev" : "Resolingo",
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
      googleServicesFile: googleInfoPlist,
      infoPlist: { UIBackgroundModes: ["audio", "remote-notification"] },
    },
    android: {
      package: identifier,
      googleServicesFile,
      adaptiveIcon: {
        foregroundImage: "./assets/resolingo-icon.png",
        backgroundColor: "#08152F",
      },
      permissions: ["POST_NOTIFICATIONS"],
    },
    plugins: [
      "expo-router",
      ["expo-splash-screen", { image: "./assets/resolingo-icon.png", imageWidth: 180, resizeMode: "contain", backgroundColor: "#08152F", dark: { backgroundColor: "#08152F" } }],
      ["expo-audio", { enableBackgroundPlayback: true, recordAudioAndroid: false, microphonePermission: false }],
      ["expo-notifications", { color: "#FF775F", defaultChannel: "lessons" }],
      "expo-apple-authentication",
      "expo-secure-store",
      "@react-native-firebase/app",
      "@react-native-google-signin/google-signin",
      ["expo-build-properties", { ios: { useFrameworks: "static" } }],
    ],
    experiments: { typedRoutes: true },
    extra: {
      eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? "REPLACE_WITH_EAS_PROJECT_ID" },
    },
  };
};
