"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend, type ApiError } from "@/lib/api/client";

export function useApi<T>(key: QueryKey, url: string | null, opts: { refetchInterval?: number | false; enabled?: boolean } = {}) {
  return useQuery<T, ApiError>({
    queryKey: key,
    queryFn: () => apiGet<T>(url!),
    enabled: !!url && (opts.enabled ?? true),
    refetchInterval: opts.refetchInterval,
  });
}

export function useApiMutation<TBody, TResult = unknown>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string | ((body: TBody) => string),
  opts: { success?: string | ((r: TResult) => string); invalidate?: QueryKey[]; onSuccess?: (r: TResult) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation<TResult, ApiError, TBody>({
    mutationFn: (body) => apiSend<TResult>(typeof url === "function" ? url(body) : url, method, method === "DELETE" ? undefined : body),
    onSuccess: (r) => {
      if (opts.success) toast.success(typeof opts.success === "function" ? opts.success(r) : opts.success);
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      opts.onSuccess?.(r);
    },
    onError: (e) => toast.error(e.message),
  });
}
