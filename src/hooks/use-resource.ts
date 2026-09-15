"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/client";

interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (updater: (current: T | null) => T | null) => void;
}

interface State<T> {
  key: string;
  data: T | null;
  error: string | null;
}

/**
 * GET com estado de carga, erro e recarga.
 *
 * O estado guarda a chave da requisicao que o produziu; "carregando" e derivado
 * da comparacao com a chave atual, em vez de um setState sincrono dentro do
 * efeito (que dispara renderizacoes em cascata). A requisicao em andamento e
 * cancelada ao desmontar.
 */
export function useResource<T>(path: string): Resource<T> {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<State<T>>({ key: "", data: null, error: null });

  const key = `${path}::${nonce}`;

  useEffect(() => {
    const controller = new AbortController();

    apiGet<T>(path, controller.signal)
      .then((result) => setState({ key, data: result, error: null }))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          key,
          data: null,
          error: cause instanceof Error ? cause.message : "Falha ao carregar.",
        });
      });

    return () => controller.abort();
  }, [path, key]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const setData = useCallback(
    (updater: (current: T | null) => T | null) => {
      setState((current) => ({ ...current, data: updater(current.data) }));
    },
    []
  );

  const settled = state.key === key;

  return {
    data: state.data,
    loading: !settled,
    error: settled ? state.error : null,
    reload,
    setData,
  };
}
