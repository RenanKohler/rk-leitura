"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
 *
 * `initialData` vem do componente de servidor: quando o HTML ja chegou com os
 * dados, a montagem nao dispara requisicao nenhuma. Sem isso a tela pediria de
 * novo, pela rede, exatamente o que acabou de renderizar.
 */
export function useResource<T>(path: string, initialData?: T): Resource<T> {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<State<T>>(() =>
    initialData === undefined
      ? { key: "", data: null, error: null }
      : { key: `${path}::0`, data: initialData, error: null }
  );

  const key = `${path}::${nonce}`;
  // Chaves ja atendidas: a inicial quando o servidor entregou os dados, e cada
  // uma que ja disparou uma requisicao.
  const servedRef = useRef<string | null>(initialData === undefined ? null : `${path}::0`);

  useEffect(() => {
    if (servedRef.current === key) return;
    servedRef.current = key;

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
