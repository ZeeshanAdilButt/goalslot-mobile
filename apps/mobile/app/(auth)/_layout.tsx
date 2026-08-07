import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/providers/auth-provider";

export default function AuthLayout() {
  const { status } = useAuth();

  // Already signed in — the (auth) group's only screen is the login form,
  // which an authenticated user has no reason to see.
  if (status === "authenticated") {
    return <Redirect href="/" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
