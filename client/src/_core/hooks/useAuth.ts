import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useMemo } from "react";

export function useAuth() {
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: data => {
      utils.auth.me.setData(undefined, data.user);
    },
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: data => {
      utils.auth.me.setData(undefined, data.user);
    },
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      await loginMutation.mutateAsync(input);
      await utils.auth.me.invalidate();
    },
    [loginMutation, utils],
  );

  const register = useCallback(
    async (input: { name: string; email: string; password: string }) => {
      await registerMutation.mutateAsync(input);
      await utils.auth.me.invalidate();
    },
    [registerMutation, utils],
  );

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED") {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(
    () => ({
      user: meQuery.data ?? null,
      loading: meQuery.isLoading,
      error: meQuery.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    }),
    [meQuery.data, meQuery.error, meQuery.isLoading],
  );

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    login,
    loginPending: loginMutation.isPending,
    loginError: loginMutation.error,
    register,
    registerPending: registerMutation.isPending,
    registerError: registerMutation.error,
    logout,
  };
}
